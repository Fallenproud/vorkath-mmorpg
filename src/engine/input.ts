/**
 * Unified input: keyboard + mouse (pointer lock) and gamepad feed one action state.
 * Gameplay reads `move`, `look` and `pressed()/held()`; it never checks raw keys.
 *
 * Call `endFrame()` once per rendered frame after gameplay consumed edge-triggered presses.
 */
export type Action =
  | 'jump' | 'sprint' | 'pause' | 'confirm' | 'back' | 'interact'
  | 'scanner' | 'scanFire' | 'journal' | 'freecam' | 'walkToggle' | 'descend' | 'skip' | 'help'
export type InputMethod = 'keyboard' | 'gamepad'

const KEY_BINDINGS: Record<Action, string[]> = {
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  back: [],
  interact: ['KeyE'],
  scanner: ['KeyQ'],
  scanFire: ['KeyF'],
  journal: ['KeyJ', 'Tab'],
  freecam: ['KeyV'],
  walkToggle: ['KeyX'],
  descend: ['KeyC', 'ControlLeft'],
  skip: ['Space', 'Enter', 'Escape'],
  help: ['KeyH'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standard gamepad mapping: A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, Back=8, Start=9, L3=10, R3=11.
const PAD_BINDINGS: Record<Action, number[]> = {
  jump: [0], sprint: [4, 10], pause: [9], confirm: [0], back: [1], interact: [2],
  scanner: [3], scanFire: [7], journal: [8], freecam: [11], walkToggle: [5], descend: [6], skip: [0, 9], help: [],
}

export class Input {
  /** Movement intent in [-1, 1]: x = strafe right, y = forward. */
  readonly move = { x: 0, y: 0 }
  /** Raw analog magnitude (0..1) before normalisation, so a half-tilted stick walks. */
  analog = 0
  readonly look = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  sensitivity = 1
  invertY = false
  /** When false (menus, cinematics) key presses are not queued as gameplay actions. */
  enabled = true
  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private padPrev = new Set<Action>()
  private mouseDown = false
  private dragLook = false
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      const typing = (e.target as HTMLElement | null)?.matches?.('input[type="text"], textarea')
      if (!typing && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab')) e.preventDefault()
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      if (!this.enabled) return
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressed_.add(action)
      }
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.mouseDown = false
    })
    on(window, 'mousedown', e => {
      if (e.button === 2 && this.enabled && (e.target as HTMLElement | null) === canvas) this.dragLook = true
      if (document.pointerLockElement === canvas && e.button === 0) {
        this.mouseDown = true
        if (this.enabled) this.pressed_.add('scanFire')
      }
    })
    on(window, 'mouseup', e => {
      if (e.button === 0) this.mouseDown = false
      if (e.button === 2) this.dragLook = false
    })
    on(window, 'contextmenu', e => {
      if ((e.target as HTMLElement | null) === canvas) e.preventDefault()
    })
    on(window, 'mousemove', e => {
      // Pointer-lock look, or right-button drag as a fallback where lock is unavailable.
      if (document.pointerLockElement !== canvas && !(this.dragLook && this.enabled)) return
      this.look.x += e.movementX * 0.0022
      this.look.y += e.movementY * 0.0022
    })
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  /** Request pointer lock for mouse look (must be called from a user gesture). */
  lockPointer(): void {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined
        p?.catch?.(() => undefined)
      } catch {
        /* unsupported in this context (e.g. headless) */
      }
    }
  }
  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  /** Programmatic key state for automated tests and accessibility helpers. */
  simulateKey(code: string, down: boolean): void {
    if (down) {
      this.keys.add(code)
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (codes.includes(code)) this.pressed_.add(action)
    } else this.keys.delete(code)
  }
  press(action: Action): void {
    this.pressed_.add(action)
  }

  /** Sample continuous sources. Call once per rendered frame before gameplay reads input. */
  update(): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    if (this.enabled) {
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (k(codes)) this.held_.add(action)
      }
      if (this.mouseDown) this.held_.add('scanFire')
    } else {
      x = 0
      y = 0
    }
    this.analog = Math.min(1, Math.hypot(x, y))
    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad && this.enabled) {
      const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const rx = dead(pad.axes[2] ?? 0)
      const ry = dead(pad.axes[3] ?? 0)
      const padActive = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || pad.buttons.some(b => b.pressed)
      if (padActive) this.method = 'gamepad'
      if (lx !== 0 || ly !== 0) {
        x = lx
        y = -ly
        this.analog = Math.min(1, Math.hypot(lx, ly))
      }
      this.look.x += rx * 0.045
      this.look.y += ry * 0.045
      const now = new Set<Action>()
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => pad.buttons[i]?.pressed)) now.add(action)
      }
      for (const action of now) {
        this.held_.add(action)
        if (!this.padPrev.has(action)) this.pressed_.add(action)
      }
      this.padPrev = now
    }
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x
    this.move.y = len > 1 ? y / len : y
  }

  held(action: Action): boolean {
    return this.held_.has(action)
  }
  /** True once per physical press. */
  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }
  /**
   * Read and clear a press. Use this inside fixed simulation steps: several steps can run in one
   * rendered frame, and a press must trigger exactly one jump/confirm.
   */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }
  takeLook(): { x: number; y: number } {
    const out = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0
    this.look.y = 0
    return out
  }
  endFrame(): void {
    this.pressed_.clear()
  }
  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
