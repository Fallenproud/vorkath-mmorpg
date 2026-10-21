import { parseProgress, type Progress } from '../game/state'

export type Quality = 'low' | 'medium' | 'high' | 'ultra'

export interface Settings {
  master: number
  music: number
  sfx: number
  ambience: number
  muted: boolean
  sensitivity: number
  invertY: boolean
  quality: Quality
  reducedMotion: boolean
  hints: boolean
  fov: number
}

export interface SaveData {
  version: 2
  settings: Settings
  progress: Progress | null
}

export const SAVE_KEY = 'vorkath-prime.save.v2'

export const defaultSettings = (): Settings => ({
  master: 0.8, music: 0.7, sfx: 0.8, ambience: 0.8, muted: false, sensitivity: 1, invertY: false,
  quality: 'high', reducedMotion: false, hints: true, fov: 60,
})
export const defaultSave = (): SaveData => ({ version: 2, settings: defaultSettings(), progress: null })

const clamp = (v: unknown, a: number, b: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d)

export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  return {
    master: clamp(r.master, 0, 1, d.master), music: clamp(r.music, 0, 1, d.music), sfx: clamp(r.sfx, 0, 1, d.sfx),
    ambience: clamp(r.ambience, 0, 1, d.ambience), muted: r.muted === true,
    sensitivity: clamp(r.sensitivity, 0.3, 2.5, d.sensitivity), invertY: r.invertY === true,
    quality: r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' || r.quality === 'ultra' ? r.quality : d.quality,
    reducedMotion: r.reducedMotion === true, hints: r.hints !== false, fov: clamp(r.fov, 50, 85, d.fov),
  }
}

export function parseSave(text: string | null): SaveData {
  if (!text) return defaultSave()
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 2) return defaultSave()
    return { version: 2, settings: parseSettings(raw.settings), progress: parseProgress(raw.progress) }
  } catch {
    return defaultSave()
  }
}

/** Small wrapper over localStorage that never throws (private windows, quota, disabled storage). */
export class SaveStore {
  data: SaveData = defaultSave()
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeStorage()) {
    this.data = parseSave(this.read())
  }
  private read(): string | null {
    try { return this.storage?.getItem(SAVE_KEY) ?? null } catch { return null }
  }
  private write(): void {
    try { this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data)) } catch { /* storage unavailable */ }
  }
  get settings(): Settings { return this.data.settings }
  get progress(): Progress | null { return this.data.progress }
  saveSettings(): void { this.write() }
  saveProgress(p: Progress): void {
    this.data.progress = structuredClone(p)
    this.write()
  }
  clearProgress(): void {
    this.data.progress = null
    this.write()
  }
  hasProgress(): boolean { return this.data.progress !== null }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
