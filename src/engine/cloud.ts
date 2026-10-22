import { ManusAuth } from '../../manus-auth.js'
import { parseProgress, type Progress } from '../game/state'
import type { SaveStore, Settings } from './save'

/**
 * Optional account layer. The game is fully playable without it: every local save path is unchanged and this class
 * only mirrors the local save to the player's account when they are signed in.
 *
 * Safety rules (all covered by tests in scripts/e2e/cloud_e2e.mjs):
 *  - Nothing is pushed before the first successful reconcile of the page session.
 *  - A device never silently overwrites newer cloud progress: pushes carry the revision they were based on, and a
 *    mismatch becomes a visible conflict that only an explicit player choice (cloud / this device) can resolve.
 *  - Cloud progress is only applied while the title screen is showing, never into a running game.
 *  - Local changes made while signed out or offline stay flagged (`dirty`, persisted) and are reconciled later.
 */

export type SyncState = 'unavailable' | 'signedOut' | 'syncing' | 'synced' | 'error' | 'conflict'

export interface CloudSummary { revision: number; runId: string; stage: string; discoveries: number; playTime: number; vitality: number; ecoStage: number; completed: boolean; updatedAt: string | null }
export interface LocalSummary { runId: string; stage: string; discoveries: number; playTime: number; vitality: number; ecoStage: number; completed: boolean }
export interface Bests { completions: number; fastestSeconds: number | null; mostDiscoveries: number | null; reports: number }
export interface ProfileInfo { id: number; displayName: string; memberSince: string | null; save: CloudSummary | null; bests: Bests; ai: { used: number; limit: number } }
export interface RecordRow { runId: string; kind: string; playTime: number; discoveries: number; vitality: number; at: string | null }
export interface ReportBody { title: string; summary: string; findings: string[]; next: string }
export interface ReportRow { id: number; runId: string; title: string; body: ReportBody | null; stage: string; discoveries: number; at: string | null }
export interface RecordsInfo { bests: Bests; records: RecordRow[]; reports: ReportRow[] }

type CloudGet = { exists: false } | { exists: true; summary: CloudSummary; progress: unknown; settings: Partial<Settings> | null }
type PutResult = { ok: true; conflict: false; revision: number } | { ok: false; conflict: true; cloud: CloudSummary | null }

export interface Conflict { cloud: CloudSummary | null; local: LocalSummary | null; canUseCloud: boolean }

export interface CloudHooks {
  /** True only while the title screen is showing (the only moment cloud progress may be applied). */
  atTitle(): boolean
  /** Called after cloud data replaced local data, so the UI and audio can refresh. */
  applied(): void
  notify(text: string, kind?: 'info' | 'warn'): void
  /** Called when a conflict needs the player's decision. */
  conflict(): void
}

interface Meta { uid: number | null; rev: number; dirty: boolean; off: boolean }
const META_KEY = 'vorkath-prime.sync.v1'
const CLIENT_KEY = 'vorkath-prime.client.v1'
const SYNCED_SETTINGS: (keyof Settings)[] = ['master', 'music', 'sfx', 'ambience', 'muted', 'sensitivity', 'invertY', 'reducedMotion', 'hints', 'fov']

export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  if (m === 'online_preview_requires_checkpoint') return 'Accounts are not available in this preview yet.'
  if (/failed to fetch|networkerror|network request|load failed|timeout|aborted|timed out/i.test(m)) return 'You appear to be offline. Your progress is safe on this device.'
  // A static host answers /api with an HTML page; that is "no account service here", not something to show raw.
  if (/unexpected token|not valid json|<!doctype|unexpected end of json/i.test(m)) return 'The account service could not be reached from here.'
  if (/^auth_unavailable$/.test(m)) return 'Sign-in is not available right now.'
  return m.slice(0, 220) || 'Something went wrong.'
}
const isUnauth = (e: unknown) => (e as { data?: { code?: string } } | null)?.data?.code === 'UNAUTHORIZED'

export function summarizeLocal(p: Progress): LocalSummary {
  return { runId: p.runId, stage: p.stage, discoveries: Object.keys(p.discoveries).length, playTime: Math.round(p.playTime), vitality: p.vitality, ecoStage: p.eco.stage, completed: p.completed }
}
const milestoneKey = (p: Progress) => `${p.runId}|${p.stage}|${Object.keys(p.discoveries).length}|${p.eco.stage}|${p.stabilized ? 1 : 0}|${p.completed ? 1 : 0}`

export class CloudSync {
  state: SyncState = 'unavailable'
  user: { id: number; name: string | null } | null = null
  displayName = ''
  message = ''
  lastSyncedAt = 0
  revision = 0
  conflict: Conflict | null = null
  /** True once this page session finished one successful reconcile; pushes are refused before that. */
  reconciled = false

  private listeners = new Set<() => void>()
  private meta: Meta = { uid: null, rev: 0, dirty: false, off: false }
  private timer = 0
  private busy = false
  private again = false
  private seq = 0
  private lastPush = 0
  private lastKey = ''
  private readonly clientId: string

  constructor(private readonly store: SaveStore, private readonly hooks: CloudHooks) {
    this.meta = this.readMeta()
    this.clientId = this.readClientId()
    store.onChange = kind => this.noteChange(kind)
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }
  private setState(s: SyncState, message = ''): void {
    this.state = s
    this.message = message
    this.emit()
  }

  get signedIn(): boolean { return this.user !== null }
  get dirty(): boolean { return this.meta.dirty }
  get paused(): boolean { return this.meta.off }

  // ------------------------------------------------------------------------------------------------ lifecycle

  async init(): Promise<void> {
    window.addEventListener('manus-auth-change', ev => this.adopt((ev as CustomEvent<{ status: string; user: { id: number; name: string | null } | null }>).detail))
    // The sign-in tab of an embedded preview is a separate window: re-check when this one regains focus.
    window.addEventListener('focus', () => { if (this.state === 'signedOut') void ManusAuth.prepare().catch(() => undefined) })
    window.addEventListener('online', () => { if (this.user) this.schedule(600) })
    window.setInterval(() => { if (this.user && this.state === 'error') this.schedule(0) }, 30000)
    try {
      this.adopt(await ManusAuth.prepare())
    } catch (e) {
      this.setState('unavailable', errorText(e))
    }
  }

  private adopt(s: { status: string; user: { id: number; name: string | null } | null } | null): void {
    if (!s) return
    if (s.status === 'authenticated' && s.user) {
      const first = this.user?.id !== s.user.id
      this.user = s.user
      if (first || !this.reconciled) void this.reconcile()
    } else if (s.status === 'offline') {
      this.user = null
      this.setState('unavailable', errorText(new Error('online_preview_requires_checkpoint')))
    } else {
      this.user = null
      this.reconciled = false
      this.conflict = null
      this.displayName = ''
      window.clearTimeout(this.timer)
      this.setState('signedOut')
    }
  }

  async login(): Promise<void> {
    try { await ManusAuth.login() } catch (e) { this.hooks.notify(errorText(e), 'warn') }
  }
  async logout(): Promise<void> {
    await this.flush().catch(() => undefined)
    try { await ManusAuth.logout() } catch (e) { this.hooks.notify(errorText(e), 'warn') }
  }

  // ------------------------------------------------------------------------------------------------ reconcile

  /** Compares this device with the cloud and either pushes, pulls, does nothing or raises a conflict. */
  async reconcile(): Promise<void> {
    if (!this.user) return
    if (this.busy) { this.again = true; return }
    this.busy = true
    this.setState('syncing')
    try {
      const user = this.user
      if (this.meta.uid !== user.id) this.meta = { uid: user.id, rev: 0, dirty: !!this.store.progress, off: false }
      this.writeMeta()
      void this.loadProfileName()
      const cloud = await ManusAuth.query<CloudGet>('saveGet')
      await this.decide(cloud, this.store.progress)
      this.reconciled = true
    } catch (e) {
      this.fail(e)
    } finally {
      this.busy = false
      if (this.again) { this.again = false; this.schedule(1500) }
    }
  }

  private async decide(cloud: CloudGet, local: Progress | null): Promise<void> {
    if (this.meta.off) { this.setState('synced', 'Cloud save is paused.'); return }
    if (!cloud.exists) {
      if (!local) { this.meta.rev = 0; this.meta.dirty = false; this.writeMeta(); this.done(); return }
      this.meta.rev = 0
      await this.push(false)
      return
    }
    const cs = cloud.summary
    if (!local) {
      if (this.hooks.atTitle()) this.applyCloud(cloud, 'Your cloud save was loaded.')
      else this.raise(cs, null, false)
      return
    }
    const ls = summarizeLocal(local)
    const same = cs.runId === ls.runId && cs.playTime === ls.playTime && cs.stage === ls.stage && cs.discoveries === ls.discoveries
    if (same) { this.meta.rev = cs.revision; this.meta.dirty = false; this.writeMeta(); this.done(cs.revision); return }
    if (this.meta.rev === cs.revision) {
      if (this.meta.dirty) await this.push(false)
      else this.done(cs.revision)
      return
    }
    if (!this.meta.dirty && this.meta.rev > 0) {
      // The cloud moved on while this device had no unsynced changes: taking the cloud save loses nothing.
      if (this.hooks.atTitle()) this.applyCloud(cloud, 'Newer progress from your account was loaded.')
      else this.raise(cs, ls, false)
      return
    }
    this.raise(cs, ls, this.hooks.atTitle())
  }

  private done(revision = this.meta.rev): void {
    this.revision = revision
    this.lastSyncedAt = Date.now()
    this.lastKey = this.store.progress ? milestoneKey(this.store.progress) : ''
    this.setState('synced')
  }

  private raise(cloud: CloudSummary | null, local: LocalSummary | null, canUseCloud: boolean): void {
    this.conflict = { cloud, local, canUseCloud }
    window.clearTimeout(this.timer)
    this.setState('conflict', 'This device and your account have different progress.')
    this.hooks.conflict()
  }

  private applyCloud(cloud: Extract<CloudGet, { exists: true }>, note: string): void {
    const progress = parseProgress(cloud.progress)
    if (!progress) { this.fail(new Error('The cloud save could not be read.')); return }
    this.store.applyCloud(progress, cloud.settings)
    this.meta = { uid: this.user?.id ?? null, rev: cloud.summary.revision, dirty: false, off: false }
    this.writeMeta()
    this.conflict = null
    this.hooks.applied()
    this.hooks.notify(note, 'info')
    this.done(cloud.summary.revision)
  }

  /** Player decision for a conflict: 'cloud' replaces this device, 'device' replaces the cloud. */
  async resolve(choice: 'cloud' | 'device'): Promise<void> {
    if (!this.user || !this.conflict || this.busy) return
    if (choice === 'cloud' && !this.hooks.atTitle()) { this.hooks.notify('Return to the main menu to load your cloud save.', 'warn'); return }
    this.busy = true
    this.setState('syncing')
    try {
      const cloud = await ManusAuth.query<CloudGet>('saveGet')
      if (choice === 'cloud' && cloud.exists) {
        this.applyCloud(cloud, 'Your cloud save replaced the save on this device.')
      } else {
        this.meta.rev = cloud.exists ? cloud.summary.revision : 0
        this.conflict = null
        this.meta.off = false
        await this.push(true)
        if (this.state === 'synced') this.hooks.notify('This device\'s progress replaced your cloud save.', 'info')
      }
    } catch (e) {
      this.fail(e)
    } finally {
      this.busy = false
    }
  }

  // ------------------------------------------------------------------------------------------------ pushing

  private async push(force: boolean): Promise<void> {
    const p = this.store.progress
    if (!p) { this.done(); return }
    const seq = this.seq
    this.setState('syncing')
    const settings: Record<string, unknown> = {}
    for (const k of SYNCED_SETTINGS) settings[k] = this.store.data.settings[k]
    const res = await ManusAuth.mutate<PutResult>('savePut', { baseRevision: this.meta.rev, force, clientId: this.clientId, progress: p, settings })
    if (res.ok) {
      this.meta.rev = res.revision
      this.meta.dirty = seq !== this.seq // something was saved while this request was in flight
      this.writeMeta()
      this.lastPush = Date.now()
      this.done(res.revision)
      if (this.meta.dirty) this.schedule(3000)
    } else {
      this.raise(res.cloud, summarizeLocal(p), this.hooks.atTitle())
    }
  }

  private noteChange(kind: 'progress' | 'settings' | 'cleared'): void {
    if (kind === 'cleared') return // New Game: the next autosave pushes the new run
    this.seq++
    this.meta.dirty = true
    this.writeMeta()
    if (!this.user || this.conflict || this.meta.off || this.state === 'unavailable') return
    if (kind === 'settings') { this.schedule(4000); return }
    const p = this.store.progress
    if (!p) return
    if (milestoneKey(p) !== this.lastKey) this.schedule(3000)
    else if (Date.now() - this.lastPush > 60000) this.schedule(5000)
  }

  private schedule(ms: number): void {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.pushNow(), ms)
  }

  private async pushNow(): Promise<void> {
    if (!this.user || this.conflict || this.meta.off) return
    if (!this.reconciled) { await this.reconcile(); return }
    if (this.busy) { this.again = true; return }
    if (!this.meta.dirty && this.state !== 'error') return
    this.busy = true
    try {
      await this.push(false)
    } catch (e) {
      this.fail(e)
    } finally {
      this.busy = false
      if (this.again) { this.again = false; this.schedule(1500) }
    }
  }

  /** Push pending changes now (pause, quit to menu, tab hidden, sign out). */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer)
    if (this.user && this.meta.dirty && !this.conflict) await this.pushNow()
  }

  /** Manual "Sync now": also re-enables syncing after the player deleted their cloud data. */
  async syncNow(): Promise<void> {
    if (!this.user) return
    this.meta.off = false
    this.writeMeta()
    this.reconciled = false
    await this.reconcile()
  }

  private fail(e: unknown): void {
    if (isUnauth(e)) { this.adopt({ status: 'logged_out', user: null }); return }
    this.setState('error', errorText(e))
    this.schedule(30000)
  }

  // ------------------------------------------------------------------------------------------------ account data

  private async loadProfileName(): Promise<void> {
    try { this.displayName = (await ManusAuth.query<ProfileInfo>('profile')).displayName; this.emit() } catch { /* shown on demand */ }
  }
  async profile(): Promise<ProfileInfo> {
    const p = await ManusAuth.query<ProfileInfo>('profile')
    this.displayName = p.displayName
    return p
  }
  records(): Promise<RecordsInfo> { return ManusAuth.query<RecordsInfo>('recordsList') }
  async setName(name: string): Promise<string> {
    const r = await ManusAuth.mutate<{ displayName: string }>('profileSet', { displayName: name })
    this.displayName = r.displayName
    this.emit()
    return r.displayName
  }
  /** Deletes the cloud copy. Local saves stay; cloud syncing is paused until the player turns it on again. */
  async deleteCloud(): Promise<void> {
    await ManusAuth.mutate('cloudDelete', { confirm: 'DELETE' })
    this.meta = { uid: this.user?.id ?? null, rev: 0, dirty: false, off: true }
    this.writeMeta()
    this.conflict = null
    this.lastKey = ''
    window.clearTimeout(this.timer)
    this.setState('synced', 'Cloud save is paused.')
  }

  // ------------------------------------------------------------------------------------------------ persistence

  private readMeta(): Meta {
    try {
      const r = JSON.parse(localStorage.getItem(META_KEY) ?? 'null')
      if (r && typeof r === 'object') return { uid: typeof r.uid === 'number' ? r.uid : null, rev: Number.isInteger(r.rev) ? r.rev : 0, dirty: r.dirty === true, off: r.off === true }
    } catch { /* ignore */ }
    return { uid: null, rev: 0, dirty: false, off: false }
  }
  private writeMeta(): void {
    try { localStorage.setItem(META_KEY, JSON.stringify(this.meta)) } catch { /* storage unavailable */ }
  }
  private readClientId(): string {
    try {
      let id = localStorage.getItem(CLIENT_KEY)
      if (!id) { id = `c_${Math.random().toString(36).slice(2, 12)}`; localStorage.setItem(CLIENT_KEY, id) }
      return id
    } catch { return 'c_unknown' }
  }
}
