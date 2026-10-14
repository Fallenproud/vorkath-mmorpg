import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import { insertScore, type Locale, type Quality, type SaveData, type SaveStore } from '../engine/save'
import { CONFIG } from '../game/config'
import type { Compass, Hint } from '../game/game'
import { formatClock, stars, type RunState } from '../game/rules'

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'settings' | 'leaderboard' | 'results'

export type UiActions = {
  play(): void
  resume(): void
  restart(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
}

const ICON = {
  core: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1 21 12 12 23 3 12Z" fill="currentColor"/><path d="M12 1 21 12H3Z" fill="#fff" opacity=".35"/></svg>',
  cell: '<svg viewBox="0 0 20 30" aria-hidden="true"><rect x="6" y="0" width="8" height="4" rx="1.5" fill="currentColor"/><rect x="1.5" y="4" width="17" height="25" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><rect class="fill" x="5" y="8" width="10" height="17" rx="2" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6Z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 20 12 15 4 20Z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"/></svg>',
}

/** Glyphs for control hints, per input method. */
const GLYPH = {
  keyboard: { keys: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', jump: '<kbd class="wide">Space</kbd>', dash: '<kbd>F</kbd>', select: '<kbd>Enter</kbd>', back: '<kbd>Esc</kbd>' },
  gamepad: { keys: '<kbd class="round">L</kbd>', stickR: '<kbd class="round">R</kbd>', jump: '<kbd class="round a">A</kbd>', dash: '<kbd class="round x">X</kbd>', select: '<kbd class="round a">A</kbd>', back: '<kbd class="round b">B</kbd>' },
}

/**
 * DOM game UI: title, HUD, pause, settings, results and leaderboard as HTML/CSS layered over the
 * canvas. Every screen is keyboard-, gamepad- and touch-navigable; text comes from i18n keys and
 * re-renders on language change.
 */
export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: Screen[] = []
  private hudCache = new Map<string, string>()
  private hintKey: Hint | null = null
  private navRepeat = 0
  private lastRun?: RunState
  private savedRank = -1
  private stormShown = false
  private lastMethod = ''

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
  ) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onInput(e))
    this.root.addEventListener('focusin', e => {
      if ((e.target as HTMLElement).matches('.btn, .seg button, .toggle')) this.audio.play('ui')
    })
    window.addEventListener('keydown', e => this.onKey(e))
    i18n.onChange(() => this.translate())
    this.translate()
    this.refreshSettings()
  }

  // ─── screens ────────────────────────────────────────────────────────────

  show(screen: Screen): void {
    this.stack.length = 0
    this.setScreen(screen)
  }

  /** Open an overlay screen (settings, leaderboard) that returns to the current one on Back. */
  push(screen: Screen): void {
    this.stack.push(this.screen)
    this.setScreen(screen)
  }

  back(): void {
    const prev = this.stack.pop()
    if (prev) this.setScreen(prev)
    else if (this.screen === 'pause') this.actions.resume()
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = el.dataset.screen === screen || (el.dataset.screen === 'hud' && (screen === 'pause' || screen === 'results' || (screen === 'settings' && this.stack.includes('pause'))))
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    if (screen === 'title') this.renderBest()
    if (screen === 'leaderboard') this.renderLeaderboard()
    if (screen === 'hud') this.stormShown = false
    // Focus the first control so keyboard and gamepad players can act immediately.
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  setBootProgress(progress: number): void {
    const bar = this.q<HTMLElement>('.boot-bar i')
    bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, progress))})`
  }

  // ─── HUD ────────────────────────────────────────────────────────────────

  updateHud(run: RunState, compass: Compass | null): void {
    this.set('cores', `${run.collected}<small>/${run.total}</small>`)
    this.set('score', run.score.toLocaleString(this.i18n.locale))
    this.set('clock', formatClock(run.timeLeft))
    const low = run.timeLeft <= CONFIG.drones.rageAt
    this.q('.hud-clock').classList.toggle('is-low', low)
    if (low && !this.stormShown && run.phase === 'playing') {
      this.stormShown = true
      this.banner(this.i18n.t('hud.storm'))
    }
    const cells = this.q('.hud-cells')
    if (cells.childElementCount !== CONFIG.run.lives) {
      cells.innerHTML = `<span class="hud-cell">${ICON.cell}</span>`.repeat(CONFIG.run.lives)
    }
    for (const [i, cell] of this.qa('.hud-cell').entries()) cell.classList.toggle('is-empty', i >= run.lives)

    const combo = this.q('.hud-combo')
    combo.classList.toggle('is-active', run.combo > 1)
    if (run.combo > 1) {
      if (this.set('combo', `×${run.combo}`)) {
        combo.classList.remove('pop')
        void combo.offsetWidth
        combo.classList.add('pop')
      }
      this.q<HTMLElement>('.hud-combo-bar i').style.transform = `scaleX(${run.comboTimer / CONFIG.score.comboWindow})`
    }

    const compassEl = this.q<HTMLElement>('.hud-compass')
    compassEl.classList.toggle('is-hidden', !compass)
    if (compass) {
      this.q<HTMLElement>('.hud-compass-arrow').style.transform = `rotate(${-compass.angle}rad)`
      this.set('distance', this.i18n.t('hud.nearest', { m: Math.round(compass.distance) }))
      compassEl.dataset.rise = compass.rise > 2 ? 'up' : compass.rise < -2 ? 'down' : ''
    }
  }

  popup(text: string, at: { x: number; y: number }, kind: 'score' | 'hurt'): void {
    const el = document.createElement('div')
    el.className = `popup popup-${kind}`
    el.textContent = text
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
    this.q('.popups').append(el)
    el.addEventListener('animationend', () => el.remove())
  }

  hurt(): void {
    const v = this.q('.hurt-vignette')
    v.classList.remove('flash')
    void (v as HTMLElement).offsetWidth
    v.classList.add('flash')
  }

  hint(hint: Hint | null): void {
    this.hintKey = hint
    this.renderHint()
  }

  private renderHint(): void {
    const el = this.q('.hint')
    const hint = this.hintKey
    if (!hint) {
      el.classList.remove('is-active')
      return
    }
    const method = this.input.method
    const glyph = method === 'gamepad' ? GLYPH.gamepad : GLYPH.keyboard
    const key = hint === 'cores' ? 'hint.cores' : `hint.${hint}.${method === 'touch' && hint === 'look' ? 'keyboard' : method}`
    const vars = { keys: glyph.keys, stick: hint === 'look' ? GLYPH.gamepad.stickR : GLYPH.gamepad.keys, key: hint === 'dash' ? glyph.dash : glyph.jump }
    el.querySelector('span')!.innerHTML = this.i18n.t(key, vars)
    el.classList.add('is-active')
  }

  private banner(text: string): void {
    const el = this.q('.banner')
    el.textContent = text
    el.classList.remove('show')
    void (el as HTMLElement).offsetWidth
    el.classList.add('show')
  }

  // ─── results ────────────────────────────────────────────────────────────

  showResults(run: RunState): void {
    this.lastRun = run
    this.savedRank = -1
    const won = run.phase === 'won'
    const el = this.q('[data-screen="results"]')
    el.classList.toggle('is-won', won)
    const titleKey = won ? 'results.won' : run.loseReason === 'time' ? 'results.lost.time' : 'results.lost.lives'
    this.q('.results-title').setAttribute('data-i18n', titleKey)
    const n = stars(run)
    for (const [i, s] of this.qa('.results-stars .star').entries()) {
      s.classList.toggle('is-on', i < n)
      ;(s as HTMLElement).style.animationDelay = `${0.35 + i * 0.22}s`
    }
    const coreScore = run.score - run.timeBonus - run.lifeBonus
    const fmt = (v: number) => v.toLocaleString(this.i18n.locale)
    this.q('.r-cores').textContent = `${run.collected} / ${run.total}`
    this.q('.r-core-score').textContent = fmt(coreScore)
    this.q('.r-time').textContent = formatClock(run.elapsed)
    this.q('.r-time-bonus').textContent = `+${fmt(run.timeBonus)}`
    this.q('.r-life-bonus').textContent = `+${fmt(run.lifeBonus)}`
    this.q('.r-total').textContent = fmt(run.score)
    const best = this.save.data.leaderboard[0]?.score ?? 0
    this.q('.results-best').classList.toggle('is-active', !run.unranked && run.score > best && run.score > 0)
    const form = this.q('.results-save')
    form.classList.toggle('is-hidden', run.unranked || run.score <= 0 || insertScore(this.save.data.leaderboard, this.entry(run)).rank < 0)
    form.classList.remove('is-saved')
    this.q<HTMLInputElement>('.results-name').value = this.save.data.playerName
    this.q('.results-rank').textContent = ''
    this.translate()
    this.show('results')
  }

  private entry(run: RunState) {
    return { name: this.q<HTMLInputElement>('.results-name')?.value.trim().slice(0, 16) || this.save.data.playerName, score: run.score, seconds: Math.round(run.elapsed), at: Date.now() }
  }

  private saveScore(): void {
    if (!this.lastRun || this.lastRun.unranked || this.savedRank >= 0) return
    const entry = this.entry(this.lastRun)
    const { board, rank } = insertScore(this.save.data.leaderboard, entry)
    this.save.update({ leaderboard: board, playerName: entry.name })
    this.savedRank = rank
    this.q('.results-save').classList.add('is-saved')
    this.q('.results-rank').textContent = rank >= 0 ? this.i18n.t('results.rank', { rank: rank + 1 }) : ''
    this.audio.play('ui')
  }

  private renderLeaderboard(): void {
    const list = this.q('.board')
    const board = this.save.data.leaderboard
    if (board.length === 0) {
      list.innerHTML = `<li class="board-empty">${this.i18n.t('leaderboard.empty')}</li>`
      return
    }
    list.innerHTML = board
      .map((e, i) => `<li class="${i === this.savedRank ? 'is-me' : ''}"><b>${i + 1}</b><span class="board-name"></span><span>${formatClock(e.seconds)}</span><em>${e.score.toLocaleString(this.i18n.locale)}</em></li>`)
      .join('')
    // Names are player-entered text: assign via textContent, never innerHTML.
    list.querySelectorAll('.board-name').forEach((el, i) => (el.textContent = board[i].name))
  }

  private renderBest(): void {
    const best = this.save.data.leaderboard[0]?.score ?? 0
    const el = this.q('.title-best')
    el.classList.toggle('is-hidden', best <= 0)
    el.textContent = this.i18n.t('menu.best', { score: best.toLocaleString(this.i18n.locale) })
  }

  // ─── settings ───────────────────────────────────────────────────────────

  /** Re-read the save into the Settings controls (call after changing settings outside the UI). */
  refreshSettings(): void {
    const d = this.save.data
    this.q<HTMLInputElement>('[name="musicVolume"]').value = String(d.musicVolume)
    this.q<HTMLInputElement>('[name="sfxVolume"]').value = String(d.sfxVolume)
    this.q<HTMLInputElement>('[name="sensitivity"]').value = String(d.sensitivity)
    for (const t of this.qa<HTMLButtonElement>('.toggle')) {
      const on = d[t.dataset.setting as 'muted' | 'invertY' | 'reducedMotion'] === true
      t.setAttribute('aria-pressed', String(on))
      t.querySelector('span')!.setAttribute('data-i18n', on ? 'settings.on' : 'settings.off')
    }
    for (const b of this.qa<HTMLButtonElement>('.seg button')) {
      const key = b.parentElement!.dataset.setting as 'quality' | 'locale'
      const current = key === 'locale' ? this.i18n.locale : d.quality
      b.setAttribute('aria-pressed', String(b.dataset.value === current))
    }
    for (const r of this.qa<HTMLInputElement>('input[type="range"]')) r.style.setProperty('--fill', `${((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`)
    this.translate()
  }

  // ─── events ─────────────────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .toggle, .seg button')
    if (!target) return
    this.audio.unlock()
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'invertY' | 'reducedMotion'
      this.actions.settings({ [key]: !this.save.data[key] })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    if (target.matches('.seg button')) {
      const key = target.parentElement!.dataset.setting
      if (key === 'quality') this.actions.settings({ quality: target.dataset.value as Quality })
      if (key === 'locale') this.actions.settings({ locale: target.dataset.value as Locale })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    const action = target.dataset.action
    switch (action) {
      case 'play': this.actions.play(); break
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'quit': this.actions.quit(); break
      case 'settings': this.push('settings'); break
      case 'leaderboard': this.push('leaderboard'); break
      case 'back': this.back(); break
      case 'save-score': this.saveScore(); break
      case 'pause': window.dispatchEvent(new CustomEvent('game:pause')); break
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el.type !== 'range') return
    el.style.setProperty('--fill', `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`)
    this.actions.settings({ [el.name]: Number(el.value) } as Partial<SaveData>)
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    const typing = (e.target as HTMLElement).matches?.('input[type="text"]')
    if ((e.code === 'Escape' || (e.code === 'Backspace' && !typing)) && this.screen !== 'title') {
      // The pause toggle in main.ts owns Escape on the pause screen itself.
      if (this.screen !== 'pause' && this.screen !== 'results') {
        e.preventDefault()
        // Escape is also the pause toggle; consume it so leaving Settings doesn't resume the run.
        this.input.consume('pause')
        this.back()
      }
      return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault()
      this.moveFocus(e.code === 'ArrowDown' ? 1 : -1)
    }
  }

  /** Per-frame gamepad menu navigation (keyboard uses native focus + onKey). */
  frame(frameSeconds: number): void {
    if (this.input.method !== this.lastMethod) {
      this.lastMethod = this.input.method
      this.renderPrompts()
      this.renderHint()
    }
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.input.method !== 'gamepad') {
      this.input.consume('confirm')
      this.input.consume('back')
      return
    }
    const y = this.input.move.y
    const x = this.input.move.x
    this.navRepeat = Math.max(0, this.navRepeat - frameSeconds)
    const active = document.activeElement as HTMLElement | null
    if (Math.abs(y) > 0.6 && this.navRepeat <= 0) {
      this.moveFocus(y < 0 ? 1 : -1)
      this.navRepeat = 0.22
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.matches('input[type="range"]')) {
      const r = active as HTMLInputElement
      r.value = String(Number(r.value) + Math.sign(x) * Number(r.step || 0.1))
      r.dispatchEvent(new Event('input', { bubbles: true }))
      this.navRepeat = 0.12
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.parentElement?.matches('.seg')) {
      const sib = (Math.sign(x) > 0 ? active.nextElementSibling : active.previousElementSibling) as HTMLElement | null
      sib?.focus()
      this.navRepeat = 0.22
    } else if (Math.abs(y) < 0.3 && Math.abs(x) < 0.3) {
      this.navRepeat = 0
    }
    if (this.input.consume('confirm')) active?.click()
    if (this.input.consume('back') && this.screen !== 'title') this.back()
  }

  private navItems(): HTMLElement[] {
    const screen = this.q(`[data-screen="${this.screen}"]`)
    return [...screen.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null && !el.closest('.is-hidden'))
  }

  private moveFocus(dir: 1 | -1): void {
    const items = this.navItems()
    if (items.length === 0) return
    // Buttons inside one segmented control count as a single row.
    const rows: HTMLElement[][] = []
    for (const el of items) {
      const seg = el.parentElement?.matches('.seg') ? el.parentElement : null
      const last = rows[rows.length - 1]
      if (seg && last && last[0].parentElement === seg) last.push(el)
      else rows.push([el])
    }
    const current = rows.findIndex(r => r.includes(document.activeElement as HTMLElement))
    const next = rows[(current + dir + rows.length) % rows.length]
    ;(next.find(el => el.getAttribute('aria-pressed') === 'true') ?? next[0]).focus()
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private translate(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.i18n.t(el.dataset.i18n!)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.i18n.t(el.dataset.i18nLabel!))
    for (const el of this.root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) el.placeholder = this.i18n.t(el.dataset.i18nPlaceholder!)
    this.renderPrompts()
    this.renderHint()
    if (this.screen === 'title') this.renderBest()
    if (this.screen === 'leaderboard') this.renderLeaderboard()
    this.hudCache.clear()
    document.title = this.i18n.t('game.title')
  }

  /** Bottom-bar button prompts follow the active input method. */
  renderPrompts(): void {
    const g = this.input.method === 'gamepad' ? GLYPH.gamepad : GLYPH.keyboard
    const html = this.input.method === 'touch' ? '' : `<span>${g.select} ${this.i18n.t('prompt.select')}</span><span>${g.back} ${this.i18n.t('prompt.back')}</span>`
    for (const el of this.qa('.prompts')) el.innerHTML = html
  }

  /** Update a HUD text slot only when it changed; returns true if it did. */
  private set(slot: string, html: string): boolean {
    if (this.hudCache.get(slot) === html) return false
    this.hudCache.set(slot, html)
    this.q(`[data-slot="${slot}"]`).innerHTML = html
    return true
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!
  }

  private qa<T extends HTMLElement = HTMLElement>(sel: string): T[] {
    return [...this.root.querySelectorAll<T>(sel)]
  }

  private template(): string {
    const range = (name: string, label: string, min: number, max: number, step: number) =>
      `<label class="row"><span data-i18n="${label}"></span><input data-nav type="range" name="${name}" min="${min}" max="${max}" step="${step}"></label>`
    const toggle = (setting: string, label: string) =>
      `<div class="row"><span data-i18n="${label}"></span><button data-nav class="toggle" data-setting="${setting}" aria-pressed="false"><i></i><span></span></button></div>`
    return /* html */ `
<section class="screen screen-boot is-active" data-screen="boot">
  <div class="boot-logo" data-i18n="game.title"></div>
  <div class="boot-bar"><i></i></div>
  <div class="boot-label" data-i18n="boot.loading"></div>
</section>

<section class="screen screen-title" data-screen="title">
  <div class="title-vignette"></div>
  <div class="title-best is-hidden"></div>
  <div class="title-block">
    <div class="logo">
      <span class="logo-gem">${ICON.core}</span>
      <h1 class="logo-text" data-i18n="game.title"></h1>
    </div>
    <p class="tagline" data-i18n="game.tagline"></p>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="play"><span data-i18n="menu.play"></span></button>
      <button data-nav class="btn" data-action="leaderboard"><span data-i18n="menu.leaderboard"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
    </nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div><small data-i18n="credits.fonts"></small></footer>
</section>

<section class="screen screen-hud" data-screen="hud">
  <div class="hurt-vignette"></div>
  <div class="popups"></div>
  <div class="hud-top-left">
    <div class="hud-panel hud-cores"><span class="hud-core-icon">${ICON.core}</span><b data-slot="cores"></b></div>
    <div class="hud-score"><span data-i18n="hud.score"></span><b data-slot="score"></b></div>
  </div>
  <div class="hud-top-center">
    <div class="hud-clock"><b data-slot="clock"></b></div>
    <div class="hud-compass"><span class="hud-compass-arrow">${ICON.arrow}</span><b data-slot="distance"></b></div>
  </div>
  <div class="hud-top-right">
    <div class="hud-cells">${`<span class="hud-cell">${ICON.cell}</span>`.repeat(CONFIG.run.lives)}</div>
    <button class="hud-pause" data-action="pause" data-i18n-label="touch.pause">${ICON.pause}</button>
  </div>
  <div class="hud-combo"><b data-slot="combo"></b><span data-i18n="hud.combo"></span><div class="hud-combo-bar"><i></i></div></div>
  <div class="banner"></div>
  <div class="hint"><span></span></div>
  <div class="touch">
    <div class="touch-stick"><i></i></div>
    <button class="touch-btn touch-dash" data-touch="dash"><span data-i18n="touch.dash"></span></button>
    <button class="touch-btn touch-jump" data-touch="jump"><span data-i18n="touch.jump"></span></button>
  </div>
</section>

<section class="screen screen-pause screen-modal" data-screen="pause">
  <div class="modal">
    <h2 class="modal-title" data-i18n="pause.title"></h2>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="menu.continue"></span></button>
      <button data-nav class="btn" data-action="restart"><span data-i18n="menu.restart"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="menu.quit"></span></button>
    </nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-settings screen-modal" data-screen="settings">
  <div class="modal modal-wide">
    <h2 class="modal-title" data-i18n="settings.title"></h2>
    <div class="settings-grid">
      <fieldset><legend data-i18n="settings.audio"></legend>
        ${range('musicVolume', 'settings.music', 0, 1, 0.05)}
        ${range('sfxVolume', 'settings.sfx', 0, 1, 0.05)}
        ${toggle('muted', 'settings.mute')}
      </fieldset>
      <fieldset><legend data-i18n="settings.controls"></legend>
        ${range('sensitivity', 'settings.sensitivity', 0.2, 3, 0.1)}
        ${toggle('invertY', 'settings.invertY')}
      </fieldset>
      <fieldset><legend data-i18n="settings.display"></legend>
        <div class="row"><span data-i18n="settings.quality"></span><div class="seg" data-setting="quality">
          <button data-nav data-value="low" data-i18n="settings.quality.low"></button><button data-nav data-value="medium" data-i18n="settings.quality.medium"></button><button data-nav data-value="high" data-i18n="settings.quality.high"></button>
        </div></div>
        ${toggle('reducedMotion', 'settings.reducedMotion')}
        <div class="row"><span data-i18n="settings.language"></span><div class="seg" data-setting="locale">
          <button data-nav data-value="en" lang="en">English</button><button data-nav data-value="zh-CN" lang="zh-CN">简体中文</button>
        </div></div>
      </fieldset>
    </div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-leaderboard screen-modal" data-screen="leaderboard">
  <div class="modal">
    <h2 class="modal-title" data-i18n="leaderboard.title"></h2>
    <div class="board-head"><b>#</b><span></span><span data-i18n="leaderboard.time"></span><em data-i18n="leaderboard.score"></em></div>
    <ol class="board"></ol>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-results screen-modal" data-screen="results">
  <div class="modal modal-results">
    <div class="results-stars">${`<span class="star">${ICON.star}</span>`.repeat(3)}</div>
    <h2 class="results-title modal-title"></h2>
    <div class="results-best" data-i18n="results.newBest"></div>
    <dl class="results-table">
      <div><dt data-i18n="results.cores"></dt><dd class="r-cores"></dd><dd class="r-core-score"></dd></div>
      <div><dt data-i18n="results.time"></dt><dd class="r-time"></dd><dd></dd></div>
      <div class="r-bonus"><dt data-i18n="results.timeBonus"></dt><dd></dd><dd class="r-time-bonus"></dd></div>
      <div class="r-bonus"><dt data-i18n="results.lifeBonus"></dt><dd></dd><dd class="r-life-bonus"></dd></div>
      <div class="r-total-row"><dt data-i18n="results.total"></dt><dd></dd><dd class="r-total"></dd></div>
    </dl>
    <div class="results-save">
      <input data-nav class="results-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" data-i18n-placeholder="results.name">
      <button data-nav class="btn btn-small" data-action="save-score"><span data-i18n="results.save"></span></button>
      <span class="results-saved" data-i18n="results.saved"></span>
      <span class="results-rank"></span>
    </div>
    <nav class="menu menu-row">
      <button data-nav class="btn btn-primary" data-action="restart"><span data-i18n="results.retry"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="results.title"></span></button>
    </nav>
  </div>
</section>`
  }
}
