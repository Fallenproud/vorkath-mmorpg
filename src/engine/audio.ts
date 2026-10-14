/**
 * Fully procedural audio (Web Audio). No samples or external files: wind, drone, Life-Core hum,
 * water, footsteps and a slow generative score are all synthesised at runtime.
 */
export interface Volumes {
  master: number
  music: number
  sfx: number
  ambience: number
  muted: boolean
}

type Surface = 'rock' | 'moss' | 'water'

export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private musicBus!: GainNode
  private sfxBus!: GainNode
  private ambBus!: GainNode
  private noise!: AudioBuffer
  private vol: Volumes = { master: 0.8, music: 0.7, sfx: 0.8, ambience: 0.8, muted: false }
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private droneGain!: GainNode
  private coreGain!: GainNode
  private coreOsc!: OscillatorNode
  private waterGain!: GainNode
  private lifeLevel = 0
  private nextBar = 0
  private barIndex = 0
  private musicOn = false
  private musicVit = 0
  private musicAct = 0
  private musicTension = 0
  private timer = 0
  private holdOsc: OscillatorNode | null = null
  private holdGain: GainNode | null = null
  private chirpClock = 0
  private started = false
  /** Called when the first user gesture unlocks audio. */
  onReady?: () => void

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running'
  }

  /** Must be called from a user gesture (click / key). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        this.ctx = new AC()
        this.build()
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      if (!this.started) {
        this.started = true
        this.onReady?.()
      }
    } catch {
      /* audio unavailable: the game stays silent */
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolumes(v: Volumes): void {
    this.vol = { ...v }
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05)
    this.musicBus.gain.setTargetAtTime(v.music * 0.55, t, 0.05)
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05)
    this.ambBus.gain.setTargetAtTime(v.ambience, t, 0.05)
  }

  private build(): void {
    const ctx = this.ctx!
    this.master = ctx.createGain()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 4
    this.master.connect(comp).connect(ctx.destination)
    this.musicBus = ctx.createGain()
    this.sfxBus = ctx.createGain()
    this.ambBus = ctx.createGain()
    this.musicBus.connect(this.master)
    this.sfxBus.connect(this.master)
    this.ambBus.connect(this.master)
    // Simple feedback-delay reverb on the music and sfx for space.
    const delay = ctx.createDelay(1.5)
    delay.delayTime.value = 0.37
    const fb = ctx.createGain()
    fb.gain.value = 0.42
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    delay.connect(lp).connect(fb).connect(delay)
    lp.connect(wet).connect(this.master)
    this.musicBus.connect(delay)
    this.sfxBus.connect(delay)
    this.setVolumes(this.vol)

    // Noise source
    const len = ctx.sampleRate * 3
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
    }

    // Wind
    const wind = ctx.createBufferSource()
    wind.buffer = this.noise
    wind.loop = true
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.frequency.value = 420
    this.windFilter.Q.value = 0.6
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    wind.connect(this.windFilter).connect(this.windGain).connect(this.ambBus)
    wind.start()

    // Low drone: two detuned saws through a lowpass
    this.droneGain = ctx.createGain()
    this.droneGain.gain.value = 0
    const dlp = ctx.createBiquadFilter()
    dlp.type = 'lowpass'
    dlp.frequency.value = 160
    for (const f of [41.2, 41.9, 61.7]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      o.connect(dlp)
      o.start()
    }
    dlp.connect(this.droneGain).connect(this.ambBus)

    // Life-Core hum: a sine pair with slow tremolo
    this.coreGain = ctx.createGain()
    this.coreGain.gain.value = 0
    this.coreOsc = ctx.createOscillator()
    this.coreOsc.type = 'sine'
    this.coreOsc.frequency.value = 110
    const o2 = ctx.createOscillator()
    o2.type = 'triangle'
    o2.frequency.value = 164.8
    const trem = ctx.createOscillator()
    trem.frequency.value = 0.35
    const tremG = ctx.createGain()
    tremG.gain.value = 0.35
    const tremBase = ctx.createGain()
    tremBase.gain.value = 0.65
    trem.connect(tremG).connect(tremBase.gain)
    this.coreOsc.connect(tremBase)
    o2.connect(tremBase)
    tremBase.connect(this.coreGain).connect(this.ambBus)
    this.coreOsc.start()
    o2.start()
    trem.start()

    // Water trickle
    const water = ctx.createBufferSource()
    water.buffer = this.noise
    water.loop = true
    water.playbackRate.value = 1.7
    const wf = ctx.createBiquadFilter()
    wf.type = 'highpass'
    wf.frequency.value = 1800
    const wlp = ctx.createBiquadFilter()
    wlp.type = 'lowpass'
    wlp.frequency.value = 6200
    this.waterGain = ctx.createGain()
    this.waterGain.gain.value = 0
    water.connect(wf).connect(wlp).connect(this.waterGain).connect(this.ambBus)
    water.start()

    this.timer = window.setInterval(() => this.tick(), 120)
  }

  // ---- ambience control ------------------------------------------------------------------
  /** All values 0..1. */
  setAmbience(o: { wind: number; vit: number; core: number; act: number; water: number; tension?: number }): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.windGain.gain.setTargetAtTime(0.1 + o.wind * 0.22, t, 0.4)
    this.windFilter.frequency.setTargetAtTime(280 + o.wind * 500 + o.vit * 200, t, 0.5)
    this.droneGain.gain.setTargetAtTime(0.09 * (1 - o.vit * 0.7) + 0.02, t, 0.8)
    this.coreGain.gain.setTargetAtTime(o.core * (0.05 + 0.1 * o.act), t, 0.4)
    this.coreOsc.frequency.setTargetAtTime(100 + o.act * 22, t, 0.5)
    this.waterGain.gain.setTargetAtTime(o.water * 0.1, t, 0.4)
    this.lifeLevel = o.vit
    this.musicVit = o.vit
    this.musicAct = o.act
    this.musicTension = o.tension ?? 0
  }

  setMusic(on: boolean): void {
    this.musicOn = on
    if (on && this.ctx) this.nextBar = Math.max(this.nextBar, this.ctx.currentTime + 0.2)
  }

  // ---- generative score -------------------------------------------------------------------
  private tick(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    if (this.musicOn) {
      if (this.nextBar < ctx.currentTime) this.nextBar = ctx.currentTime + 0.1
      while (this.nextBar < ctx.currentTime + 1.2) {
        this.scheduleBar(this.nextBar)
        this.nextBar += 8
      }
    }
    // Recovered-ecosystem chirps and insect ticks.
    this.chirpClock -= 0.12
    if (this.lifeLevel > 0.35 && this.chirpClock <= 0) {
      this.chirp(ctx.currentTime + Math.random() * 0.1, 0.5 + Math.random() * 0.5)
      this.chirpClock = 1.2 + Math.random() * 3.2 * (1.4 - this.lifeLevel)
    }
  }

  private scheduleBar(t: number): void {
    const ctx = this.ctx!
    const roots = [38, 34, 31, 33]
    const root = roots[this.barIndex % roots.length]
    this.barIndex += 1
    const hope = this.musicVit
    const third = hope > 0.5 ? 4 : 3
    const tones = [0, third + 12, 7 + 12, 14 + (hope > 0.3 ? 0 : -2)]
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
    const padV = 0.1 + this.musicAct * 0.05 + this.musicTension * 0.04
    for (const [i, tone] of tones.entries()) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator()
        o.type = i === 0 ? 'sawtooth' : 'triangle'
        o.frequency.value = hz(root + tone + (i === 0 ? 0 : 12))
        o.detune.value = det
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = 500 + hope * 700 + this.musicAct * 400
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(padV / (i === 0 ? 3 : 5), t + 2.6)
        g.gain.setValueAtTime(padV / (i === 0 ? 3 : 5), t + 5.2)
        g.gain.linearRampToValueAtTime(0, t + 8.6)
        o.connect(f).connect(g).connect(this.musicBus)
        o.start(t)
        o.stop(t + 9)
      }
    }
    // Sub pulse
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = hz(root - 12)
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0, t)
    sg.gain.linearRampToValueAtTime(0.16, t + 1.5)
    sg.gain.linearRampToValueAtTime(0, t + 7.8)
    sub.connect(sg).connect(this.musicBus)
    sub.start(t)
    sub.stop(t + 8)
    // Sparse pentatonic plucks that become more frequent as the world heals.
    const pent = [0, 2, 5, 7, 9]
    for (let beat = 0; beat < 4; beat += 1) {
      const p = 0.12 + hope * 0.5 + this.musicAct * 0.25
      if (Math.random() < p) {
        const m = 62 + pent[Math.floor(Math.random() * pent.length)] + (Math.random() < 0.35 ? 12 : 0)
        this.pluck(hz(m), t + beat * 2 + Math.random() * 0.4, 0.07 + hope * 0.05)
      }
    }
  }

  private pluck(freq: number, t: number, vol: number): void {
    const ctx = this.ctx!
    for (const [mul, v] of [[1, 1], [2.01, 0.35], [3.02, 0.12]] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq * mul
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / mul)
      o.connect(g).connect(this.musicBus)
      o.start(t)
      o.stop(t + 2.6)
    }
  }

  private chirp(t: number, v: number): void {
    const ctx = this.ctx!
    const base = 2200 + Math.random() * 1800
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(base, t)
    o.frequency.exponentialRampToValueAtTime(base * (Math.random() < 0.5 ? 1.5 : 0.7), t + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.025 * v * this.lifeLevel, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
    o.connect(g).connect(this.ambBus)
    o.start(t)
    o.stop(t + 0.16)
  }

  // ---- synthesis helpers ------------------------------------------------------------------
  private tone(freq: number, type: OscillatorType, dur: number, vol: number, opts: { slideTo?: number; delay?: number; attack?: number; bus?: GainNode } = {}): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + (opts.delay ?? 0)
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur)
    const g = ctx.createGain()
    const a = opts.attack ?? 0.008
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(opts.bus ?? this.sfxBus)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, f1: number, f2: number, q = 1, delay = 0): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + delay
    const s = ctx.createBufferSource()
    s.buffer = this.noise
    s.playbackRate.value = 0.8 + Math.random() * 0.5
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f1, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(this.sfxBus)
    s.start(t, Math.random() * 1.5)
    s.stop(t + dur + 0.05)
  }

  // ---- sound effects ----------------------------------------------------------------------
  footstep(speed: number, surface: Surface = 'rock'): void {
    if (!this.ready) return
    const v = Math.min(1, 0.35 + speed / 12)
    if (surface === 'water') {
      this.burst(0.22, 0.2 * v, 'bandpass', 2400, 900, 0.9)
      this.burst(0.12, 0.1 * v, 'highpass', 3000, 5000, 0.5)
    } else if (surface === 'moss') {
      this.burst(0.09, 0.16 * v, 'lowpass', 700 + Math.random() * 200, 220, 0.8)
    } else {
      this.burst(0.07, 0.2 * v, 'bandpass', 700 + Math.random() * 600, 260, 1.4)
      this.tone(90 + Math.random() * 20, 'sine', 0.08, 0.1 * v)
    }
  }
  jump(): void {
    if (!this.ready) return
    this.burst(0.2, 0.12, 'bandpass', 500, 1400, 0.8)
  }
  land(impact: number): void {
    if (!this.ready) return
    const v = Math.min(1, impact / 16)
    this.tone(70, 'sine', 0.25, 0.3 * v, { slideTo: 38 })
    this.burst(0.22, 0.25 * v, 'lowpass', 900, 200, 0.7)
  }
  scanStart(): void {
    if (!this.ready) return
    this.tone(300, 'sine', 0.45, 0.07, { slideTo: 820, attack: 0.04 })
  }
  scanBlip(): void {
    if (!this.ready) return
    this.tone(1180, 'square', 0.05, 0.03)
  }
  scanLockLoop(progress: number): void {
    if (!this.ready) return
    this.tone(420 + progress * 700, 'triangle', 0.09, 0.05)
  }
  scanComplete(): void {
    if (!this.ready) return
    ;[0, 4, 7, 12].forEach((s, i) => this.tone(523.25 * Math.pow(2, s / 12), 'sine', 0.8, 0.12, { delay: i * 0.085 }))
    this.tone(1046, 'triangle', 1.0, 0.04, { delay: 0.34 })
  }
  scanFail(): void {
    if (!this.ready) return
    this.tone(220, 'square', 0.18, 0.06, { slideTo: 150 })
  }
  pickup(kind: 'shard' | 'ore'): void {
    if (!this.ready) return
    if (kind === 'shard') {
      this.tone(880, 'sine', 0.5, 0.12)
      this.tone(1318, 'sine', 0.7, 0.1, { delay: 0.07 })
      this.tone(1760, 'triangle', 0.8, 0.05, { delay: 0.14 })
    } else {
      this.tone(330, 'triangle', 0.3, 0.12)
      this.burst(0.1, 0.1, 'lowpass', 600, 200)
    }
  }
  seat(): void {
    if (!this.ready) return
    this.tone(70, 'sine', 0.5, 0.35, { slideTo: 45 })
    this.burst(0.3, 0.2, 'lowpass', 1500, 200, 0.8)
    this.tone(220, 'sawtooth', 1.2, 0.07, { slideTo: 660, attack: 0.3, delay: 0.1 })
    ;[0, 7, 12, 19].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 'sine', 1.0, 0.07, { delay: 0.25 + i * 0.07 }))
  }
  /** Hold-to-stabilize tone: pass progress 0..1 while holding, or null to stop. */
  holdTone(p: number | null): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    if (p === null) {
      if (this.holdOsc) {
        this.holdGain!.gain.setTargetAtTime(0, ctx.currentTime, 0.08)
        const o = this.holdOsc
        window.setTimeout(() => o.stop(), 400)
        this.holdOsc = null
      }
      return
    }
    if (!this.holdOsc) {
      this.holdOsc = ctx.createOscillator()
      this.holdOsc.type = 'sawtooth'
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      this.holdGain = ctx.createGain()
      this.holdGain.gain.value = 0
      this.holdOsc.connect(lp).connect(this.holdGain).connect(this.sfxBus)
      this.holdOsc.start()
    }
    this.holdOsc.frequency.setTargetAtTime(110 + p * 330, ctx.currentTime, 0.05)
    this.holdGain!.gain.setTargetAtTime(0.05 + p * 0.1, ctx.currentTime, 0.05)
  }
  stabilizeBlast(): void {
    if (!this.ready) return
    this.tone(48, 'sine', 2.2, 0.55, { slideTo: 28 })
    this.burst(1.6, 0.35, 'lowpass', 4000, 120, 0.6)
    this.burst(2.4, 0.14, 'highpass', 800, 6000, 0.4, 0.15)
    ;[0, 4, 7, 11, 14, 19].forEach((s, i) => this.tone(261.6 * Math.pow(2, s / 12), 'sine', 2.6, 0.1, { delay: 0.4 + i * 0.16 }))
  }
  ventCharge(): void {
    if (!this.ready) return
    this.burst(1.1, 0.07, 'bandpass', 600, 3200, 3)
  }
  ventFire(distNorm: number): void {
    if (!this.ready) return
    const v = Math.max(0.05, 1 - distNorm)
    this.burst(0.35, 0.3 * v, 'bandpass', 3000, 400, 0.9)
    this.tone(120, 'sawtooth', 0.3, 0.15 * v, { slideTo: 50 })
  }
  hurt(): void {
    if (!this.ready) return
    this.tone(180, 'sawtooth', 0.35, 0.22, { slideTo: 60 })
    this.burst(0.3, 0.25, 'lowpass', 1200, 200)
  }
  respawn(): void {
    if (!this.ready) return
    this.tone(200, 'sine', 0.9, 0.12, { slideTo: 600, attack: 0.2 })
  }
  uiClick(): void {
    if (!this.ready) return
    this.tone(660, 'triangle', 0.07, 0.06)
  }
  uiHover(): void {
    if (!this.ready) return
    this.tone(980, 'sine', 0.04, 0.018)
  }
  uiOpen(): void {
    if (!this.ready) return
    this.tone(440, 'triangle', 0.18, 0.06, { slideTo: 660 })
  }
  uiClose(): void {
    if (!this.ready) return
    this.tone(660, 'triangle', 0.18, 0.06, { slideTo: 440 })
  }
  objective(): void {
    if (!this.ready) return
    this.tone(587, 'sine', 0.5, 0.08)
    this.tone(880, 'sine', 0.7, 0.08, { delay: 0.12 })
  }
  creature(distNorm: number): void {
    if (!this.ready) return
    const v = Math.max(0, 1 - distNorm)
    if (v < 0.05) return
    const f = 380 + Math.random() * 120
    this.tone(f, 'triangle', 0.22, 0.06 * v, { slideTo: f * 1.35 })
    this.tone(f * 1.5, 'sine', 0.18, 0.03 * v, { delay: 0.07, slideTo: f * 1.1 })
  }
  whoosh(len = 1.6, vol = 0.18): void {
    if (!this.ready) return
    this.burst(len, vol, 'bandpass', 200, 3000, 0.7)
  }
  boom(): void {
    if (!this.ready) return
    this.tone(55, 'sine', 2.6, 0.5, { slideTo: 24 })
    this.burst(2, 0.25, 'lowpass', 900, 60, 0.6)
  }
  riser(len = 4): void {
    if (!this.ready) return
    this.tone(110, 'sawtooth', len, 0.05, { slideTo: 660, attack: len * 0.6 })
    this.burst(len, 0.1, 'bandpass', 300, 5000, 0.7)
  }
  dispose(): void {
    window.clearInterval(this.timer)
    void this.ctx?.close()
  }
}
