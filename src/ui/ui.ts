import type { AudioEngine } from '../engine/audio'
import type { SaveStore, Settings, Quality } from '../engine/save'
import { DISCOVERIES, type Category, type Discovery } from '../game/discoveries'
import type { Game, Hud } from '../game/game'
import { POI_NAMES } from '../game/layout'
import { objectiveFor, STAGES } from '../game/state'

export interface UiHandlers {
  newGame(): void
  continueGame(): void
  teaser(): void
  resume(): void
  quit(): void
  skip(): void
  settings(patch: Partial<Settings>): void
  erase(): void
  closeJournal(): void
  openJournal(): void
  returnToSafe(): void
  teaserPause(): boolean
  teaserRestart(): void
  teaserExit(): void
  teaserCapture(): void
  teaserRecord(): boolean
  lockPointer(): void
  keepExploring(): void
}

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'cinematic' | 'teaser'
type Modal = 'settings' | 'controls' | 'journal' | 'about' | 'confirm' | 'complete' | null

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
const CATEGORY_ORDER: Category[] = ['Survey', 'Technology', 'Geology', 'Life-Core', 'Hazard', 'Hydrology', 'Biology']

const CONTROLS: [string, string][] = [
  ['W A S D / Left stick', 'Move (relative to the camera)'],
  ['Mouse / Right stick', 'Look around (click the game to capture the mouse)'],
  ['Right mouse drag', 'Look, if mouse capture is unavailable'],
  ['Shift / L3', 'Sprint (hold)'],
  ['X / RB', 'Toggle walk'],
  ['Space / A', 'Jump (hold for a higher jump)'],
  ['Q / Y', 'Raise or lower the scanner'],
  ['F or Left mouse / RT', 'Hold on a highlighted object to scan it'],
  ['E / X', 'Interact: collect, seat a shard, hold to stabilize'],
  ['J or Tab / Back', 'Open the journal'],
  ['V / R3', 'Survey camera (free flight, after you are comfortable)'],
  ['H', 'Show or hide this help'],
  ['Esc or P / Start', 'Pause'],
]

const STEPS: string[] = [
  'Learn the controls: walk, sprint and jump.',
  'Raise the scanner (Q) and scan your survey capsule to calibrate it.',
  'Climb the Fractured Ridge, scan the strata and the distant pulse.',
  'Cross the Crystal Formation Field. Scan the formations, collect three resonance shards, and keep away from flickering vents.',
  'Reach the Life-Core Exposure in the north crater. Scan it, seat a shard in each of three conduit nodes (E), then hold E to stabilize it.',
  'Follow the new channel to the Recovery Basin and scan what returns. Then climb the Observation Point and scan the panorama.',
]

export class Ui {
  readonly root: HTMLElement
  screen: Screen = 'boot'
  modal: Modal = null
  private confirmAction: (() => void) | null = null
  private confirmText = ''
  private readonly els: Record<string, HTMLElement> = {}
  private readonly cache = new Map<string, string>()
  private selectedDiscovery: string | null = null
  private readonly newIds = new Set<string>()
  private scanPanelT = 0
  private regionT = 0
  private objectiveFlashT = 0
  private recording = false
  private teaserIdle = 0
  private tagEls: HTMLElement[] = []
  private compassEls: HTMLElement[] = []
  private game: Game | null = null

  constructor(root: HTMLElement, private readonly store: SaveStore, private readonly audio: AudioEngine, private readonly h: UiHandlers) {
    this.root = root
    root.innerHTML = this.template()
    root.querySelectorAll<HTMLElement>('[id]').forEach(el => { this.els[el.id] = el })
    for (let i = 0; i < 10; i += 1) {
      const t = document.createElement('div')
      t.className = 'tag'
      t.innerHTML = '<span class="tag-dot"></span><span class="tag-label"></span>'
      this.els.tags.appendChild(t)
      this.tagEls.push(t)
    }
    const dirs: [string, number][] = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]]
    for (const [name, deg] of dirs) {
      const c = document.createElement('span')
      c.className = `cmp ${name.length === 1 ? 'major' : ''}`
      c.textContent = name
      c.dataset.deg = String(deg)
      this.els.compassTrack.appendChild(c)
      this.compassEls.push(c)
    }
    this.bind()
    this.refreshSettings()
    this.refreshTitle()
  }

  attach(game: Game): void {
    this.game = game
  }

  // ------------------------------------------------------------------------------------------
  // Template
  // ------------------------------------------------------------------------------------------
  private template(): string {
    return `
<div id="layerBoot" class="layer boot"><div class="boot-inner"><div class="logo-small">VORKATH</div><div class="boot-title">VORATH PRIME</div><div class="bar"><div id="bootBar"></div></div><div id="bootText" class="muted">Calibrating instruments...</div></div></div>

<div id="layerTitle" class="layer title hidden">
  <div class="title-shade"></div>
  <div class="title-wrap">
    <div class="eyebrow">Prototype vertical slice</div>
    <h1 class="logo">VORKATH</h1>
    <div class="logo-sub">VORATH PRIME</div>
    <p class="tagline">An explorer, a scarred frontier and one dying Life-Core. Scan it. Understand it. Bring it back.</p>
    <div class="menu">
      <button id="btnContinue" class="primary" data-act="continue">Continue<small id="continueInfo"></small></button>
      <button id="btnNew" data-act="new">New Game</button>
      <button data-act="teaser">Watch the Teaser</button>
      <button data-act="controls">How to Play</button>
      <button data-act="settings">Settings</button>
      <button data-act="about">About and Limitations</button>
    </div>
    <div class="foot muted">All terrain, effects, audio and the explorer are procedural. Five creature, crystal and structure models are AI-generated placeholders. Lore here is a prototype interpretation, not approved canon.</div>
  </div>
</div>

<div id="layerHud" class="layer hud hidden">
  <div id="scanVignette" class="scan-vignette"></div>
  <div id="objective" class="panel objective"><div class="label">Objective</div><div id="objTitle" class="obj-title"></div><div id="objDetail" class="obj-detail"></div><div id="objProgress" class="obj-progress"></div><div id="objDist" class="obj-dist"></div></div>
  <div class="compass"><div id="compassTrack" class="compass-track"></div><div id="compassMark" class="compass-mark hidden">&#9670;</div><div class="compass-center"></div></div>
  <div class="panel topright"><div id="regionName" class="region-name"></div><div id="landName" class="land-name"></div><div class="stat-row"><span>Journal</span><b id="statDisc">0/25</b></div><div class="stat-row"><span>Recovery</span><b id="statVit">0%</b></div><div class="mini-bar"><div id="vitBar"></div></div></div>
  <div id="regionBanner" class="region-banner"></div>
  <div class="panel bottomleft"><div class="stat-row"><span>Suit</span><b id="statSuit">100%</b></div><div class="mini-bar suit"><div id="suitBar"></div></div><div class="chips"><span class="chip"><i class="ico shard"></i><b id="chipShards">0</b> shards</span><span class="chip"><i class="ico ore"></i><b id="chipOre">0</b> ore</span><span class="chip"><i class="ico node"></i><b id="chipNodes">0</b>/3 nodes</span></div></div>
  <div id="prompt" class="prompt hidden"><span class="key">E</span><span id="promptText"></span><div id="promptHold" class="hold hidden"><div id="promptHoldBar"></div></div></div>
  <div class="keyhints" id="keyHints"><span><b>Q</b> Scanner</span><span><b>J</b> Journal</span><span><b>H</b> Help</span><span><b>Esc</b> Pause</span></div>
  <div id="reticle" class="reticle hidden"><div class="ret-ring"></div><svg viewBox="0 0 100 100" class="ret-prog"><circle id="retArc" cx="50" cy="50" r="44" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="276.5"/></svg><div id="retLabel" class="ret-label"></div></div>
  <div id="scanBanner" class="scan-banner hidden">SCANNER ACTIVE &nbsp; Hold <b>F</b> or <b>Left Mouse</b> on a highlighted object</div>
  <div id="tags" class="tags"></div>
  <div id="waypoint" class="waypoint hidden"><div class="wp-diamond"></div><div class="wp-text"><span id="wpName"></span><b id="wpDist"></b></div></div>
  <div id="scanPanel" class="panel scan-panel hidden"><div class="label" id="scanKind">Scan result</div><div id="scanTitle" class="scan-title"></div><div id="scanCat" class="scan-cat"></div><div id="scanRows" class="scan-rows"></div><div id="scanNote" class="scan-note"></div></div>
  <div id="toasts" class="toasts"></div>
  <div id="lockHint" class="lock-hint hidden">Click the game to capture the mouse <small>or hold the right mouse button to look</small></div>
  <div id="surveyBanner" class="survey-banner hidden">SURVEY CAMERA &nbsp; WASD fly - Space up - C down - Shift fast - V exit</div>
</div>

<div id="layerCine" class="layer cine hidden">
  <div class="bar-top"></div><div class="bar-bottom"></div>
  <div id="haze" class="haze"></div>
  <div id="caption" class="caption"><div id="capTitle"></div><div id="capSub"></div></div>
  <button id="btnSkip" class="skip hidden" data-act="skip">Skip <small>Space</small></button>
  <div id="teaserBar" class="teaser-bar hidden">
    <div class="tb-time"><div class="tb-prog"><div id="tbBar"></div></div><span id="tbClock">0:00</span></div>
    <div class="tb-buttons">
      <button id="tbPause" data-act="tPause">Pause</button>
      <button data-act="tRestart">Restart</button>
      <button data-act="tCapture">Capture still</button>
      <button id="tbRecord" data-act="tRecord">Record clip</button>
      <button data-act="tExit">Exit</button>
    </div>
  </div>
</div>

<div id="fxHurt" class="fx hurt"></div>
<div id="fxFlash" class="fx flash"></div>
<div id="fxBlack" class="fx black"></div>

<div id="layerPause" class="layer pause hidden">
  <div class="pause-card panel">
    <div class="eyebrow">Paused</div>
    <h2>VORKATH: VORATH PRIME</h2>
    <div id="pauseObj" class="pause-obj"></div>
    <div class="menu">
      <button class="primary" data-act="resume">Resume</button>
      <button data-act="journal">Journal</button>
      <button data-act="controls">Controls</button>
      <button data-act="settings">Settings</button>
      <button data-act="safe">Return to last safe position</button>
      <button data-act="quit">Save and exit to menu</button>
    </div>
  </div>
</div>

<div id="modal" class="modal hidden"><div id="modalBody" class="modal-body panel"></div></div>
`
  }

  // ------------------------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------------------------
  private bind(): void {
    this.root.addEventListener('click', e => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
      if (!target || (target as HTMLButtonElement).disabled) return
      this.audio.unlock()
      this.audio.uiClick()
      this.act(target.dataset.act!, target)
    })
    this.root.addEventListener('mouseover', e => {
      const b = (e.target as HTMLElement).closest('button')
      if (b && !(b as HTMLButtonElement).disabled && b !== this.lastHover) {
        this.lastHover = b
        this.audio.uiHover()
      }
    })
    this.root.addEventListener('input', e => {
      const t = e.target as HTMLInputElement
      if (t.dataset.set) this.onSetting(t)
    })
    this.root.addEventListener('change', e => {
      const t = e.target as HTMLInputElement
      if (t.dataset.set) this.onSetting(t)
    })
    window.addEventListener('mousemove', () => { this.teaserIdle = 0 })
  }

  private lastHover: HTMLElement | null = null

  private onSetting(t: HTMLInputElement): void {
    const key = t.dataset.set as keyof Settings
    let value: number | boolean | string
    if (t.type === 'checkbox') value = t.checked
    else if (t.type === 'range') value = Number(t.value)
    else value = t.value
    if (t.type === 'range') {
      const out = t.parentElement?.querySelector<HTMLElement>('.val')
      if (out) out.textContent = key === 'fov' ? `${value}` : `${Math.round(Number(value) * (key === 'sensitivity' ? 100 : 100))}%`
    }
    this.h.settings({ [key]: value } as Partial<Settings>)
    this.audio.unlock()
    if (key === 'sfx' || key === 'master') this.audio.uiHover()
  }

  private act(a: string, el: HTMLElement): void {
    switch (a) {
      case 'continue': this.h.continueGame(); break
      case 'new':
        if (this.store.hasProgress()) this.askConfirm('Start a new game? Your saved progress will be erased.', () => this.h.newGame())
        else this.h.newGame()
        break
      case 'teaser': this.h.teaser(); break
      case 'controls': this.openModal('controls'); break
      case 'settings': this.openModal('settings'); break
      case 'about': this.openModal('about'); break
      case 'journal': this.openModal('journal'); break
      case 'close': this.closeModal(); break
      case 'resume': this.h.resume(); break
      case 'safe': this.h.returnToSafe(); break
      case 'quit': this.h.quit(); break
      case 'skip': this.h.skip(); break
      case 'tPause': { const p = this.h.teaserPause(); this.els.tbPause.textContent = p ? 'Play' : 'Pause'; break }
      case 'tRestart': this.h.teaserRestart(); this.els.tbPause.textContent = 'Pause'; break
      case 'tCapture': this.h.teaserCapture(); break
      case 'tRecord': this.recording = this.h.teaserRecord(); this.els.tbRecord.textContent = this.recording ? 'Stop recording' : 'Record clip'; break
      case 'tExit': this.h.teaserExit(); break
      case 'erase': this.askConfirm('Erase your saved progress? This cannot be undone.', () => { this.h.erase(); this.refreshTitle(); this.openModal('settings') }); break
      case 'yes': { const fn = this.confirmAction; this.confirmAction = null; this.closeModal(); fn?.(); break }
      case 'no': this.closeModal(); break
      case 'keep': this.closeModal(); this.h.keepExploring(); break
      case 'completeTeaser': this.closeModal(); this.h.quit(); window.setTimeout(() => this.h.teaser(), 900); break
      case 'completeMenu': this.closeModal(); this.h.quit(); break
      case 'entry': this.selectedDiscovery = el.dataset.id ?? null; this.newIds.delete(this.selectedDiscovery ?? ''); this.renderModal(); break
      case 'quality': this.h.settings({ quality: el.dataset.q as Quality }); this.refreshSettings(); if (this.modal === 'settings') this.renderModal(); break
      default: break
    }
  }

  // ------------------------------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------------------------------
  show(screen: Screen): void {
    this.screen = screen
    const set = (id: string, on: boolean) => this.els[id].classList.toggle('hidden', !on)
    set('layerBoot', screen === 'boot')
    set('layerTitle', screen === 'title')
    set('layerHud', screen === 'hud' || screen === 'pause')
    set('layerCine', screen === 'cinematic' || screen === 'teaser')
    set('layerPause', screen === 'pause')
    set('teaserBar', screen === 'teaser')
    if (screen === 'title') this.refreshTitle()
    if (screen !== 'pause' && screen !== 'title') this.closeModal(true)
    this.root.dataset.screen = screen
    this.els.btnSkip.classList.toggle('hidden', screen !== 'cinematic')
    if (screen === 'cinematic' || screen === 'teaser') this.els.tbPause.textContent = 'Pause'
  }

  setBoot(progress: number, text?: string): void {
    this.els.bootBar.style.width = `${Math.round(progress * 100)}%`
    if (text) this.els.bootText.textContent = text
  }

  refreshTitle(): void {
    const p = this.store.data.progress
    const btn = this.els.btnContinue as HTMLButtonElement
    btn.disabled = !p
    if (p) {
      const idx = STAGES.indexOf(p.stage)
      const label = objectiveFor(p).title
      this.els.continueInfo.textContent = `${label} - ${Object.keys(p.discoveries).length}/${DISCOVERIES.length} logged - ${Math.round(p.vitality * 100)}% recovery${idx < 0 ? '' : ''}`
    } else this.els.continueInfo.textContent = 'No saved game yet'
  }

  refreshSettings(): void {
    if (this.modal === 'settings') this.renderModal()
  }

  openModal(m: Exclude<Modal, null>): void {
    this.modal = m
    this.renderModal()
    this.els.modal.classList.remove('hidden')
    this.root.classList.add('has-modal')
    this.audio.uiOpen()
  }

  closeModal(silent = false): void {
    if (!this.modal) return
    const was = this.modal
    this.modal = null
    this.els.modal.classList.add('hidden')
    this.root.classList.remove('has-modal')
    this.els.modalBody.innerHTML = ''
    if (!silent) this.audio.uiClose()
    if (was === 'journal' && this.game?.journalOpen) this.h.closeJournal()
  }

  /** Escape/back handling for modal-aware navigation. Returns true if something was closed. */
  back(): boolean {
    if (this.modal) {
      this.closeModal()
      return true
    }
    return false
  }

  setLockHint(on: boolean): void {
    this.els.lockHint.classList.toggle('hidden', !on)
  }

  toggleHelp(): void {
    if (this.modal === 'controls') this.closeModal()
    else this.openModal('controls')
  }

  openJournalModal(): void {
    this.selectedDiscovery ??= null
    this.openModal('journal')
  }

  private askConfirm(text: string, fn: () => void): void {
    this.confirmText = text
    this.confirmAction = fn
    this.openModal('confirm')
  }

  private renderModal(): void {
    const body = this.els.modalBody
    switch (this.modal) {
      case 'settings': body.innerHTML = this.settingsHtml(); break
      case 'controls': body.innerHTML = this.controlsHtml(); break
      case 'about': body.innerHTML = this.aboutHtml(); break
      case 'journal': body.innerHTML = this.journalHtml(); break
      case 'confirm': body.innerHTML = `<h2>Confirm</h2><p>${esc(this.confirmText)}</p><div class="row end"><button data-act="no">Cancel</button><button class="primary" data-act="yes">Confirm</button></div>`; break
      case 'complete': body.innerHTML = this.completeHtml(); break
      default: body.innerHTML = ''
    }
    body.classList.toggle('wide', this.modal === 'journal' || this.modal === 'about')
    const first = body.querySelector<HTMLElement>('button.primary, button')
    if (this.modal === 'confirm') first?.focus()
  }

  showComplete(): void {
    this.openModal('complete')
  }

  private settingsHtml(): string {
    const s = this.store.data.settings
    const slider = (key: string, label: string, min: number, max: number, step: number, val: number, fmt: string) =>
      `<label class="setting"><span>${label}</span><input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val">${fmt}</span></label>`
    const pct = (v: number) => `${Math.round(v * 100)}%`
    const check = (key: string, label: string, on: boolean) => `<label class="setting check"><span>${label}</span><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}></label>`
    const q = (id: Quality, label: string) => `<button class="seg ${s.quality === id ? 'on' : ''}" data-act="quality" data-q="${id}">${label}</button>`
    return `<h2>Settings</h2>
<div class="settings-grid">
<div><h3>Sound</h3>
${slider('master', 'Master volume', 0, 1, 0.01, s.master, pct(s.master))}
${slider('music', 'Music', 0, 1, 0.01, s.music, pct(s.music))}
${slider('sfx', 'Effects', 0, 1, 0.01, s.sfx, pct(s.sfx))}
${slider('ambience', 'Ambience', 0, 1, 0.01, s.ambience, pct(s.ambience))}
${check('muted', 'Mute all sound', s.muted)}
</div>
<div><h3>Controls and display</h3>
${slider('sensitivity', 'Mouse sensitivity', 0.3, 2.5, 0.05, s.sensitivity, `${Math.round(s.sensitivity * 100)}%`)}
${check('invertY', 'Invert vertical look', s.invertY)}
${slider('fov', 'Field of view', 50, 90, 1, s.fov, String(s.fov))}
<div class="setting"><span>Graphics quality</span><div class="segs">${q('low', 'Low')}${q('medium', 'Medium')}${q('high', 'High')}</div></div>
${check('reducedMotion', 'Reduced motion (less camera shake)', s.reducedMotion)}
${check('hints', 'Show on-screen key hints', s.hints)}
</div></div>
<div class="row"><button class="danger" data-act="erase">Erase saved progress</button><span class="grow"></span><button class="primary" data-act="close">Done</button></div>`
  }

  private controlsHtml(): string {
    return `<h2>How to play</h2>
<div class="two">
<div><h3>Controls</h3><table class="keys">${CONTROLS.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table></div>
<div><h3>Your survey</h3><ol class="steps">${STEPS.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
<h3>Tips</h3><ul class="steps"><li>The scanner reads real values from what you aim at. Anything it logs goes into the journal with those readings.</li><li>Flickering crystal vents glow brighter just before they discharge. Leave the ring or step clear when it brightens. Your suit repairs itself when you are not hit.</li><li>Water slows you down. Your progress is saved automatically and when you pause.</li></ul></div>
</div>
<div class="row end"><button class="primary" data-act="close">Close</button></div>`
  }

  private aboutHtml(): string {
    return `<h2>About and limitations</h2>
<div class="two about">
<div><h3>What this is</h3>
<p>A playable vertical slice: one continuous region (the Scarred Frontier) with six places, a scan-collect-repair-stabilize loop, and a visible, persistent ecological recovery.</p>
<h3>What is generated</h3>
<ul><li>Terrain, sky, water, plants, particles, the explorer, sound and music are procedural and created at runtime.</li><li>Five models (crystal, Life-Core pylon, frond-tree, mossgrazer, survey capsule) are AI-generated placeholders, simplified for the browser.</li></ul>
<h3>Not approved canon</h3>
<p>All names, species and explanations in the journal are prototype interpretations written for this slice.</p></div>
<div><h3>Known limitations</h3>
<ul><li>Desktop keyboard and mouse (or a gamepad). There are no touch controls.</li><li>One save slot, stored in this browser only.</li><li>The recovery plays out in accelerated time (about ninety seconds of play), not realistic ecology.</li><li>One creature species, no combat, no inventory beyond shards and ore, no multiplayer.</li><li>Audio starts after your first click or key press (browser policy).</li><li>Very low-end GPUs should use Low quality.</li></ul></div>
</div>
<div class="row end"><button class="primary" data-act="close">Close</button></div>`
  }

  private completeHtml(): string {
    const g = this.game
    const p = g?.progress
    const mins = p ? Math.max(1, Math.round(p.playTime / 60)) : 0
    return `<div class="complete"><div class="eyebrow">Survey complete</div><h2>The Scarred Frontier is breathing again</h2>
<p>The Life-Core is steady, the channel runs and the Recovery Basin is alive. The planet will do what it does next.</p>
<div class="summary"><div><b>${p ? Object.keys(p.discoveries).length : 0}/${DISCOVERIES.length}</b><span>Journal entries</span></div><div><b>${Math.round((p?.vitality ?? 0) * 100)}%</b><span>Recovery</span></div><div><b>${mins} min</b><span>Play time</span></div></div>
<div class="row end"><button data-act="completeMenu">Main menu</button><button data-act="completeTeaser">Watch the teaser</button><button class="primary" data-act="keep">Keep exploring</button></div></div>`
  }

  private journalHtml(): string {
    const p = this.game?.progress
    const found = p ? new Set(Object.keys(p.discoveries)) : new Set<string>()
    const groups = CATEGORY_ORDER.map(cat => ({ cat, items: DISCOVERIES.filter(d => d.category === cat) })).filter(g => g.items.length)
    const sel = this.selectedDiscovery && found.has(this.selectedDiscovery) ? this.selectedDiscovery : [...found][0] ?? null
    this.selectedDiscovery = sel
    const list = groups
      .map(g => `<div class="jgroup"><div class="jcat">${g.cat}</div>${g.items
        .map(d => {
          const known = found.has(d.id)
          return `<button class="jentry ${known ? '' : 'locked'} ${d.id === sel ? 'on' : ''}" ${known ? `data-act="entry" data-id="${d.id}"` : 'disabled'}>${known ? esc(d.title) : '??? Undiscovered'}${this.newIds.has(d.id) ? '<i class="new">NEW</i>' : ''}</button>`
        })
        .join('')}</div>`)
      .join('')
    let detail = '<div class="jempty"><h3>Nothing logged yet</h3><p>Raise the scanner (Q), aim at something in the world and hold F or the left mouse button. Each scan adds an entry here with the readings taken at that moment.</p></div>'
    if (sel) {
      const d = DISCOVERIES.find(x => x.id === sel) as Discovery
      const rec = p!.discoveries[sel]
      detail = `<div class="jdetail"><div class="jmeta">${d.category} - ${POI_NAMES[d.region]}</div><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p>
<div class="jread"><div class="label">Scanner readings${rec ? ` - logged at ${Math.floor(rec.at / 60)}:${String(rec.at % 60).padStart(2, '0')} of play` : ''}</div>${rec.readings.map(([k, v]) => `<div class="rrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>`
    }
    const hints = DISCOVERIES.filter(d => !found.has(d.id)).slice(0, 3).map(d => `<li>${esc(d.hint)}</li>`).join('')
    return `<div class="jhead"><h2>Field journal</h2><span class="muted">${found.size} of ${DISCOVERIES.length} logged</span><span class="grow"></span><button class="primary" data-act="close">Close <small>J</small></button></div>
<div class="jbody"><div class="jlist">${list}</div><div class="jright">${detail}${hints ? `<div class="jhints"><div class="label">Leads</div><ul>${hints}</ul></div>` : ''}</div></div>`
  }

  // ------------------------------------------------------------------------------------------
  // In-game notifications
  // ------------------------------------------------------------------------------------------
  toast(text: string, kind: 'info' | 'discovery' | 'warn' | 'objective' = 'info'): void {
    const t = document.createElement('div')
    t.className = `toast ${kind}`
    t.textContent = text
    this.els.toasts.appendChild(t)
    while (this.els.toasts.children.length > 4) this.els.toasts.firstElementChild?.remove()
    window.setTimeout(() => t.classList.add('out'), kind === 'objective' ? 5200 : 3600)
    window.setTimeout(() => t.remove(), kind === 'objective' ? 5800 : 4200)
  }

  discovery(d: Discovery, isNew: boolean, readings: [string, string][]): void {
    this.els.scanKind.textContent = isNew ? 'New discovery logged' : 'Already catalogued - readings updated'
    this.els.scanPanel.classList.toggle('isnew', isNew)
    this.els.scanTitle.textContent = d.title
    this.els.scanCat.textContent = `${d.category} - ${POI_NAMES[d.region]}`
    this.els.scanRows.innerHTML = readings.map(([k, v]) => `<div class="rrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
    this.els.scanNote.textContent = isNew ? 'Added to your journal (J).' : ''
    this.els.scanPanel.classList.remove('hidden')
    this.scanPanelT = isNew ? 9 : 6
    if (isNew) {
      this.newIds.add(d.id)
      this.selectedDiscovery = d.id
      this.toast(`Discovery: ${d.title}`, 'discovery')
    }
  }

  objectiveChanged(): void {
    this.objectiveFlashT = 1.6
    this.els.objective.classList.add('flash')
  }

  regionBanner(name: string): void {
    this.els.regionBanner.textContent = name
    this.regionT = 3.2
  }

  // ------------------------------------------------------------------------------------------
  // Per-frame
  // ------------------------------------------------------------------------------------------
  private setText(id: string, text: string): void {
    if (this.cache.get(id) === text) return
    this.cache.set(id, text)
    this.els[id].textContent = text
  }

  private setStyle(id: string, prop: string, value: string): void {
    const key = `${id}.${prop}`
    if (this.cache.get(key) === value) return
    this.cache.set(key, value)
    ;(this.els[id].style as unknown as Record<string, string>)[prop] = value
  }

  frame(dt: number, hud: Hud): void {
    // Overlays that exist in every mode.
    this.setStyle('fxBlack', 'opacity', hud.black.toFixed(3))
    this.setStyle('fxFlash', 'opacity', Math.min(1, hud.flash).toFixed(3))
    this.setStyle('fxHurt', 'opacity', Math.min(1, hud.hurt).toFixed(3))
    if (this.screen === 'cinematic' || this.screen === 'teaser') this.frameCinematic(dt, hud)
    if (this.screen !== 'hud' && this.screen !== 'pause') return
    this.frameHud(dt, hud)
  }

  private frameCinematic(dt: number, hud: Hud): void {
    const cap = hud.caption
    if (cap && cap.alpha > 0.01) {
      this.setText('capTitle', cap.text)
      this.setText('capSub', cap.sub ?? '')
      this.setStyle('caption', 'opacity', cap.alpha.toFixed(3))
    } else this.setStyle('caption', 'opacity', '0')
    this.setStyle('haze', 'opacity', hud.haze.toFixed(3))
    if (this.screen === 'teaser' && hud.teaser) {
      const t = hud.teaser
      this.setStyle('tbBar', 'width', `${(100 * t.time) / t.duration}%`)
      const m = Math.floor(t.time / 60)
      this.setText('tbClock', `${m}:${String(Math.floor(t.time % 60)).padStart(2, '0')} / ${Math.floor(t.duration / 60)}:${String(Math.round(t.duration % 60)).padStart(2, '0')}`)
      this.teaserIdle += dt
      this.els.teaserBar.classList.toggle('idle', this.teaserIdle > 3.2)
    }
  }

  private frameHud(dt: number, h: Hud): void {
    this.setText('objTitle', h.objective.title)
    this.setText('objDetail', h.objective.detail)
    this.setText('objProgress', h.objective.progress ? `Progress ${h.objective.progress}` : '')
    this.els.objProgress.classList.toggle('hidden', !h.objective.progress)
    this.setText('objDist', h.waypoint ? `${h.waypoint.label} - ${Math.round(h.waypoint.dist)} m` : '')
    if (this.objectiveFlashT > 0) {
      this.objectiveFlashT -= dt
      if (this.objectiveFlashT <= 0) this.els.objective.classList.remove('flash')
    }
    this.setText('statDisc', `${h.discoveries}/${DISCOVERIES.length}`)
    this.setText('statVit', `${Math.round(h.vitality * 100)}%`)
    this.setStyle('vitBar', 'width', `${Math.round(h.vitality * 100)}%`)
    this.setText('statSuit', `${Math.round(h.integrity)}%`)
    this.setStyle('suitBar', 'width', `${Math.max(0, Math.round(h.integrity))}%`)
    this.els.suitBar.classList.toggle('low', h.integrity < 40)
    this.setText('chipShards', String(h.shards))
    this.setText('chipOre', String(h.ore))
    this.setText('chipNodes', String(h.nodes))
    this.setText('regionName', h.region ?? 'Open ground')
    this.setText('landName', h.land ?? '')
    this.setText('pauseObj', `${h.objective.title}${h.objective.progress ? ` (${h.objective.progress})` : ''}`)

    // Region banner
    if (this.regionT > 0) {
      this.regionT -= dt
      const a = Math.min(1, this.regionT, (3.2 - this.regionT) * 2)
      this.setStyle('regionBanner', 'opacity', Math.max(0, a).toFixed(2))
    } else this.setStyle('regionBanner', 'opacity', '0')

    // Prompt
    const pr = h.prompt
    this.els.prompt.classList.toggle('hidden', !pr)
    if (pr) {
      this.setText('promptText', pr.text)
      this.els.prompt.classList.toggle('blocked', pr.blocked)
      this.els.prompt.querySelector('.key')!.classList.toggle('hidden', pr.blocked)
      this.els.promptHold.classList.toggle('hidden', pr.hold === null)
      if (pr.hold !== null) this.setStyle('promptHoldBar', 'width', `${Math.round(pr.hold * 100)}%`)
    }

    // Scanner
    const sc = h.scanner
    this.els.reticle.classList.toggle('hidden', !sc.active)
    this.els.scanBanner.classList.toggle('hidden', !sc.active || this.screen === 'pause')
    this.els.scanVignette.classList.toggle('on', sc.active)
    this.els.reticle.dataset.state = sc.state
    this.els.reticle.classList.toggle('known', sc.known && sc.state !== 'idle')
    if (sc.active) {
      this.setText('retLabel', sc.state === 'idle' ? '' : `${sc.label} - ${Math.round(sc.dist)} m`)
      this.setStyle('retArc', 'strokeDashoffset', String(276.5 * (1 - sc.progress)))
    }
    for (const [i, el] of this.tagEls.entries()) {
      const tag = sc.active ? h.tags[i] : undefined
      if (!tag) {
        el.style.display = 'none'
        continue
      }
      el.style.display = ''
      el.style.left = `${tag.x * 100}%`
      el.style.top = `${tag.y * 100}%`
      el.classList.toggle('known', tag.known)
      const lab = el.lastElementChild as HTMLElement
      const txt = `${tag.label}${tag.known ? '' : ' - new'}`
      if (lab.textContent !== txt) lab.textContent = txt
    }

    // Waypoint
    const wp = h.waypoint
    this.els.waypoint.classList.toggle('hidden', !wp)
    if (wp) {
      const x = Math.min(0.95, Math.max(0.05, wp.x))
      const y = Math.min(0.9, Math.max(x < 0.42 ? 0.33 : 0.12, wp.y))
      const edge = wp.x < 0.05 || wp.x > 0.95 || wp.y < 0.12 || wp.y > 0.9 || wp.behind
      this.els.waypoint.style.left = `${x * 100}%`
      this.els.waypoint.style.top = `${y * 100}%`
      this.els.waypoint.classList.toggle('edge', edge)
      this.setText('wpName', wp.label)
      this.setText('wpDist', `${Math.round(wp.dist)} m`)
    }

    // Compass
    const heading = h.yaw
    for (const el of this.compassEls) {
      const deg = Number(el.dataset.deg)
      let d = ((deg - heading + 540) % 360) - 180
      d = Math.max(-180, Math.min(180, d))
      el.style.left = `${50 + d * 0.5}%`
      el.style.opacity = String(Math.max(0, 1 - Math.abs(d) / 95))
    }
    const mark = this.els.compassMark
    if (h.bearing !== null) {
      const d = ((h.bearing - heading + 540) % 360) - 180
      mark.classList.remove('hidden')
      mark.style.left = `${50 + Math.max(-90, Math.min(90, d)) * 0.5}%`
      mark.style.opacity = Math.abs(d) > 90 ? '0.5' : '1'
    } else mark.classList.add('hidden')

    // Scan result panel timer
    if (this.scanPanelT > 0) {
      this.scanPanelT -= dt
      if (this.scanPanelT <= 0) this.els.scanPanel.classList.add('hidden')
    }
    this.els.surveyBanner.classList.toggle('hidden', !h.survey)
    this.els.keyHints.classList.toggle('hidden', h.survey || !this.store.data.settings.hints)
    this.els.objective.classList.toggle('hidden', h.survey)
  }
}
