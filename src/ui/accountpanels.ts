import type { CloudSync, CloudSummary, LocalSummary, ProfileInfo, RecordsInfo, ReportBody } from '../engine/cloud'
import type { ChatTurn } from '../engine/analyst'
import { defaultProgress, objectiveFor, type Stage } from '../game/state'
import { DISCOVERIES } from '../game/discoveries'

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export const stageTitle = (stage: string) => objectiveFor({ ...defaultProgress(), stage: stage as Stage }).title
export const fmtTime = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)
export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown')
const ECO = ['Scarred', 'Pioneer', 'Growth', 'Thriving']

export function syncLabel(c: CloudSync): { text: string; tone: 'ok' | 'busy' | 'warn' | 'off' } {
  switch (c.state) {
    case 'unavailable': return { text: 'Offline mode', tone: 'off' }
    case 'signedOut': return { text: 'Guest', tone: 'off' }
    case 'syncing': return { text: 'Syncing...', tone: 'busy' }
    case 'conflict': return { text: 'Choose a save', tone: 'warn' }
    case 'error': return { text: 'Offline, will retry', tone: 'warn' }
    default: return c.paused ? { text: 'Cloud save paused', tone: 'warn' } : { text: c.dirty ? 'Changes pending' : 'Synced', tone: c.dirty ? 'busy' : 'ok' }
  }
}

export function chipHtml(c: CloudSync | null): string {
  if (!c) return ''
  const l = syncLabel(c)
  const who = c.user ? esc(c.displayName || c.user.name || 'Explorer') : c.state === 'unavailable' ? 'Local saves only' : 'Sign in to sync'
  return `<i class="dot ${l.tone}"></i><span class="who">${who}</span><span class="st">${esc(l.text)}</span>`
}

const stat = (b: string, label: string) => `<div><b>${b}</b><span>${label}</span></div>`

function saveCard(title: string, s: CloudSummary | LocalSummary | null, extra = ''): string {
  if (!s) return `<div class="conf-card"><div class="label">${title}</div><p class="muted">No save.</p>${extra}</div>`
  const when = 'updatedAt' in s ? `<div class="muted small">Saved ${esc(fmtDate(s.updatedAt))}</div>` : ''
  return `<div class="conf-card"><div class="label">${title}</div><h3>${esc(stageTitle(s.stage))}</h3>
<div class="mini-stats">${stat(`${s.discoveries}/${DISCOVERIES.length}`, 'Journal')}${stat(fmtTime(s.playTime), 'Play time')}${stat(`${Math.round(s.vitality * 100)}%`, 'Recovery')}</div>
<div class="muted small">${ECO[s.ecoStage] ?? 'Scarred'} world${s.completed ? ' - survey complete' : ''}</div>${when}${extra}</div>`
}

export function conflictHtml(c: CloudSync): string {
  const k = c.conflict
  if (!k) return '<h2>Saves</h2><p>No conflict.</p><div class="row end"><button class="primary" data-act="close">Close</button></div>'
  const cloudBtn = `<button class="primary" data-act="resolveCloud" ${k.canUseCloud && k.cloud ? '' : 'disabled'}>Use account save</button>`
  const note = k.canUseCloud ? '' : '<p class="muted small">Loading the account save is only possible from the main menu. Quit to the menu to choose it.</p>'
  return `<h2>Choose which progress to keep</h2>
<p>Your account and this device hold different progress for this game. Nothing has been overwritten. Pick one; the other is replaced.</p>
<div class="conf-grid">${saveCard('Account (cloud)', k.cloud, `<div class="row">${cloudBtn}</div>`)}${saveCard('This device', k.local, '<div class="row"><button data-act="resolveDevice">Keep this device</button></div>')}</div>${note}
<div class="row end"><button data-act="resolveLater">Decide later</button></div>`
}

export interface AccountView { profile: ProfileInfo | null; records: RecordsInfo | null; loading: boolean; error: string; nameMsg: string }

const KIND: Record<string, string> = { stabilized: 'Life-Core stabilized', thriving: 'World reached Thriving', complete: 'Survey completed' }

export function reportHtml(r: ReportBody, extra = ''): string {
  return `<div class="areport"><div class="label">Field report - AI-generated</div><h3>${esc(r.title)}</h3><p>${esc(r.summary)}</p>
<ul>${r.findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul><p class="next"><b>Next:</b> ${esc(r.next)}</p>${extra}</div>`
}

export function accountHtml(c: CloudSync, v: AccountView): string {
  const head = '<div class="ahead"><h2>Account</h2><span class="grow"></span><button class="primary" data-act="close">Close</button></div>'
  if (c.state === 'unavailable') {
    return `${head}<div class="gate"><h3>Offline mode</h3><p>${esc(c.message || 'Accounts are not available here.')}</p><p class="muted">The game is fully playable. Your progress is saved on this device. Cloud saves, records and the AI Field Analyst need the hosted version of the game.</p></div>`
  }
  if (!c.user) {
    return `${head}<div class="gate"><h3>Play anywhere, keep everything</h3>
<p>Sign in to save your profile, progress and records to your account and continue on any device. You can still play as a guest: guest progress stays on this device and is offered to your account when you sign in.</p>
<ul><li>Cloud save with conflict protection: a device never silently overwrites newer progress.</li><li>Run records and personal bests.</li><li>The AI Field Analyst and field reports.</li></ul>
<div class="row"><button class="primary" data-act="signin">Sign in</button></div></div>`
  }
  const l = syncLabel(c)
  const p = v.profile
  const save = p?.save ?? null
  const b = (v.records ?? p)?.bests
  const bests = b
    ? `<div class="mini-stats wide">${stat(String(b.completions), 'Completed runs')}${stat(b.fastestSeconds == null ? '-' : fmtTime(b.fastestSeconds), 'Fastest completion')}${stat(b.mostDiscoveries == null ? '-' : `${b.mostDiscoveries}/${DISCOVERIES.length}`, 'Most journal entries')}${stat(String(b.reports), 'Field reports')}</div>`
    : '<p class="muted">Loading...</p>'
  const recs = v.records
    ? v.records.records.length
      ? `<ul class="recs">${v.records.records.map(r => `<li><b>${esc(KIND[r.kind] ?? r.kind)}</b><span class="muted">${esc(fmtTime(r.playTime))} - ${r.discoveries} entries - ${esc(fmtDate(r.at))}</span></li>`).join('')}</ul>`
      : '<p class="muted">No records yet. Stabilize the Life-Core to earn your first.</p>'
    : ''
  const reports = v.records && v.records.reports.length
    ? v.records.reports.map(r => (r.body ? `<details class="rep"><summary>${esc(r.title)} <span class="muted small">${esc(fmtDate(r.at))}</span></summary>${reportHtml(r.body)}</details>` : '')).join('')
    : '<p class="muted">No field reports yet. Ask the Field Analyst (N) to write one after logging 3 discoveries.</p>'
  return `${head}
${v.error ? `<p class="err">${esc(v.error)}</p>` : ''}
<div class="acct-top"><div><div class="label">Display name</div><div class="row tight"><input id="nameInput" type="text" maxlength="24" value="${esc(c.displayName)}" autocomplete="off" spellcheck="false"><button data-act="savename">Save name</button></div>${v.nameMsg ? `<div class="muted small">${esc(v.nameMsg)}</div>` : ''}</div>
<div><div class="label">Cloud save</div><div class="syncline"><i class="dot ${l.tone}"></i><b>${esc(l.text)}</b></div><div class="muted small">${c.lastSyncedAt ? `Last synced ${esc(fmtDate(new Date(c.lastSyncedAt).toISOString()))}` : 'Not synced in this session'}${c.revision ? ` - revision ${c.revision}` : ''}</div>${c.message && c.state !== 'synced' ? `<div class="muted small">${esc(c.message)}</div>` : ''}${c.paused ? '<div class="muted small">Syncing is paused because you deleted your cloud data. Press Sync now to upload this device\'s save again.</div>' : ''}</div></div>
<div class="row tight wrap"><button data-act="syncnow" ${c.state === 'syncing' ? 'disabled' : ''}>Sync now</button>${c.conflict ? '<button class="primary" data-act="showconflict">Resolve save conflict</button>' : ''}<button data-act="signout">Sign out</button></div>
<h3>Your cloud save</h3>${save ? `<div class="conf-grid one">${saveCard('Stored in your account', save)}</div>` : '<p class="muted">Nothing stored yet. Play for a moment and your progress is uploaded automatically.</p>'}
<h3>Personal bests</h3>${bests}
<h3>Run records</h3>${recs}
<h3>Field reports</h3>${reports}
<h3>Privacy</h3><p class="muted small">Stored for your account: display name, game progress and settings (not graphics quality), run records and AI field reports. Questions you ask the Field Analyst are not stored in your account; the facts you have scanned are sent to the AI model to answer them. Signing out keeps this device's save.</p>
<div class="row"><button class="danger" data-act="deletecloud">Delete my cloud data</button></div>`
}

export interface AnalystView { turns: ChatTurn[]; pending: boolean; error: string; draft: string; report: ReportBody | null; reportPending: boolean; reportError: string; ai: { used: number; limit: number } | null; discoveries: number }

const CHIPS = ['What should I do next?', 'Summarize what I have learned.', 'What is unusual about this place?', 'Tell me about the Life-Core.']

export function analystHtml(c: CloudSync | null, v: AnalystView): string {
  const head = '<div class="ahead"><h2>Field Analyst</h2><span class="tag-ai">AI-generated</span><span class="grow"></span><button class="primary" data-act="close">Close</button></div>'
  const disclaimer = '<p class="muted small">An AI model answers using only what you have scanned. It can be wrong, and nothing it says is official Vorkath canon.</p>'
  if (!c || c.state === 'unavailable') {
    return `${head}${disclaimer}<div class="gate"><h3>Not available here</h3><p>The Field Analyst needs the hosted game with accounts. ${esc(c?.message ?? '')}</p></div>`
  }
  if (!c.user) {
    return `${head}${disclaimer}<div class="gate"><h3>Sign in to consult the Analyst</h3><p>AI features are tied to your account so they stay fast and fair for everyone. Playing without an account is unaffected.</p><div class="row"><button class="primary" data-act="signin">Sign in</button></div></div>`
  }
  const left = v.ai ? `${Math.max(0, v.ai.limit - v.ai.used)} of ${v.ai.limit} requests left today` : ''
  const log = v.turns.length
    ? v.turns.map(t => `<div class="bubble ${t.role}"><div class="who">${t.role === 'user' ? 'You' : 'Analyst'}</div>${esc(t.text)}</div>`).join('')
    : '<div class="bubble analyst"><div class="who">Analyst</div>Field Analyst online. Ask me about anything you have scanned, or what to do next.</div>'
  const thinking = v.pending ? '<div class="bubble analyst thinking"><div class="who">Analyst</div><span class="dots"><i></i><i></i><i></i></span> Analysing your scans...</div>' : ''
  const chips = v.turns.length === 0 ? `<div class="achips">${CHIPS.map(q => `<button data-act="aq" data-q="${esc(q)}" ${v.pending ? 'disabled' : ''}>${esc(q)}</button>`).join('')}</div>` : ''
  const err = v.error ? `<div class="err">${esc(v.error)} <button data-act="aretry" ${v.pending ? 'disabled' : ''}>Try again</button></div>` : ''
  const canReport = v.discoveries >= 3
  const report = v.reportPending
    ? '<div class="areport thinking"><span class="dots"><i></i><i></i><i></i></span> Writing your field report...</div>'
    : v.report ? reportHtml(v.report, '<div class="muted small">Saved to your account (Account, Field reports).</div>') : ''
  return `${head}${disclaimer}
<div id="aLog" class="alog">${log}${thinking}</div>${err}${chips}
<div class="arow"><textarea id="aInput" maxlength="300" rows="2" placeholder="Ask about what you have scanned..." ${v.pending ? 'disabled' : ''}>${esc(v.draft)}</textarea><button class="primary" data-act="asend" ${v.pending ? 'disabled' : ''}>${v.pending ? 'Thinking...' : 'Ask'}</button></div>
<div class="row tight wrap"><button data-act="areport" ${canReport && !v.reportPending ? '' : 'disabled'} title="${canReport ? '' : 'Log at least 3 discoveries first'}">Write field report</button><span class="muted small">${canReport ? '' : `Log ${3 - v.discoveries} more discover${3 - v.discoveries === 1 ? 'y' : 'ies'} to unlock reports. `}${esc(left)}</span></div>
${v.reportError ? `<div class="err">${esc(v.reportError)}</div>` : ''}${report}`
}
