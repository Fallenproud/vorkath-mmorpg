import * as THREE from 'three'
import crystalUrl from '../../assets/models/crystal_cluster.glb?url'
import frondUrl from '../../assets/models/frondtree.glb?url'
import pylonUrl from '../../assets/models/lifecore_pylon.glb?url'
import grazerUrl from '../../assets/models/mossgrazer.glb?url'
import podUrl from '../../assets/models/landing_pod.glb?url'
import { EcoGrid, ECO_STAGES, ecoSettling, requestEcoAdvance, type EcoResult } from './ecostate'
import { loadV2, type V2Imports } from './v2assets'
import { SurveyModel } from './surveymodel'
import type { Assets } from '../engine/assets'
import type { AudioEngine } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics, RAPIER } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import { QUALITY_PRESETS } from '../engine/renderer'
import type { SaveStore, Settings } from '../engine/save'
import { clamp, smooth } from '../engine/noise'
import { Atmosphere } from './atmosphere'
import { CameraRig, type Shot } from './camera'
import { Cinematics, emptyOut, OPENING_HANDOVER, OPENING_SECONDS, TEASER_SECONDS, TRANSFORM_SECONDS, type CineOut, type ViewState } from './cinematics'
import { CONFIG } from './config'
import { DISCOVERY_BY_ID, DISCOVERIES, type Discovery } from './discoveries'
import { Explorer } from './explorer'
import { Flora } from './flora'
import { Spires } from './crystals'
import { Biota } from './biota'
import { BIOME_NAMES, biomeAt, stageAt } from './ecology'
import { Creatures } from './creatures'
import { extractModel } from './gfx'
import { getHeightField, type HeightField } from './heightfield'
import { POI, POI_NAMES, regionAt, type RegionId } from './layout'
import { OrbitScene } from './orbit'
import { Props, VENT_RADIUS, type ModelSet, type Pickup } from './props'
import { buildScannables, pickTarget, type ReadCtx, type Scannable } from './scannables'
import { Lighting, SkyDome, buildEnvironment } from './sky'
import { advance, defaultProgress, has, nodeCount, objectiveFor, STAGES, type Objective, type Progress, type Stage } from './state'
import { createTerrain } from './terrain'
import { U } from './uniforms'
import { Veins } from './veins'
import { Water } from './water'

export type Mode = 'boot' | 'title' | 'opening' | 'playing' | 'paused' | 'teaser'

export interface GameEvents {
  toast(text: string, kind?: 'info' | 'discovery' | 'warn' | 'objective'): void
  discovery(d: Discovery, isNew: boolean, readings: [string, string][]): void
  objectiveChanged(o: Objective): void
  complete(): void
  /** The pause key was pressed in a playable state; main decides what to close/open. */
  pauseKey(): void
  helpKey(): void
  journalToggled(open: boolean): void
  teaserEnded(): void
  region(name: string): void
}

export interface Tag {
  x: number
  y: number
  label: string
  known: boolean
  dist: number
}

export interface Hud {
  mode: Mode
  objective: Objective
  prompt: { text: string; key: string; hold: number | null; blocked: boolean } | null
  integrity: number
  shards: number
  ore: number
  nodes: number
  vitality: number
  discoveries: number
  scanner: { active: boolean; state: 'idle' | 'target' | 'scanning'; label: string; dist: number; progress: number; known: boolean }
  tags: Tag[]
  waypoint: { x: number; y: number; behind: boolean; dist: number; label: string } | null
  caption: CineOut['caption']
  haze: number
  black: number
  flash: number
  hurt: number
  yaw: number
  bearing: number | null
  skipVisible: boolean
  survey: boolean
  walk: boolean
  teaser: { time: number; duration: number; paused: boolean } | null
  speed: number
  region: string | null
  /** Biome and ecological stage under the explorer. */
  land: string | null
  /** Global ecological state (Scarred / Pioneer / Growth / Thriving) and its index 0..3. */
  eco: string
  ecoIndex: number
  hidden: boolean
}

interface Ripple {
  mesh: THREE.Mesh
  t: number
  dur: number
  max: number
  active: boolean
  flat: boolean
}

const QUALITY_LEVEL: Record<string, number> = { low: 0, medium: 1, high: 2 }
const stageIndex = (s: Stage) => (STAGES as readonly Stage[]).indexOf(s)

const QUALITY_DENSITY = {
  low: { flora: 0.4, atmo: 0.4 },
  medium: { flora: 0.7, atmo: 0.7 },
  high: { flora: 1, atmo: 1 },
} as const

export class Game {
  readonly scene = new THREE.Scene()
  readonly physics = new Physics()
  readonly hf: HeightField = getHeightField()
  mode: Mode = 'boot'
  progress: Progress = defaultProgress()
  readonly view: ViewState = { vit: 0, act: 0, hold: 0, nodes: [false, false, false], pulse: 0 }
  readonly hud: Hud
  time = 0
  journalOpen = false
  scanMode = false
  survey = false
  walkMode = false
  reducedMotion = false

  private camRig!: CameraRig
  private lighting!: Lighting
  private sky!: SkyDome
  private water!: Water
  private veins!: Veins
  private props!: Props
  private flora!: Flora
  private spires!: Spires
  private biota!: Biota
  private creatures!: Creatures
  private atmosphere!: Atmosphere
  private explorer!: Explorer
  private readonly orbit = new OrbitScene()
  private cine!: Cinematics
  private scannables: Scannable[] = []
  private models: ModelSet = {}
  /** Ecology tile grid, V2 imports and the evidence log of Life-Core events (accepted and rejected). */
  eco!: EcoGrid
  v2: V2Imports | null = null
  successionModel: SurveyModel | null = null
  readonly ecoLog: { t: number; id: number; accepted: boolean; reason: string; from: number; to: number }[] = []
  ecoRestored = false
  private ecoClock = 0
  readonly perf = { frames: 0, avg: 0, p95: 0, max: 0, samples: [] as number[] }
  private readonly ripples: Ripple[] = []
  private readonly spawn = new THREE.Vector3()
  private readonly lastSafe = new THREE.Vector3()
  private lastSafeYaw = 0
  private safeTimer = 0
  private floraDensity = -1
  private fill!: THREE.DirectionalLight

  private cineT = 0
  private cineOut: CineOut = emptyOut()
  private teaserPaused = false
  teaserKind: 'teaser' | 'transform' = 'teaser'
  private readonly teaserFired = new Set<string>()
  private readonly shotSrc: Shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 }

  private lock: { s: Scannable; pos: THREE.Vector3; dist: number } | null = null
  private scanProgress = 0
  private scanSoundClock = 0
  private holdProgress = 0
  private integrity = 100
  private invuln = 0
  private hurtFlash = 0
  private flash = 0
  private pulseT = -1
  private fadeBlack = 0
  private fadeTarget = 0
  private regionNow: RegionId | null = null
  private landT = 0
  private saveClock = 0
  private ambClock = 0
  private wading = 0
  private speedNow = 0
  private captureWanted: ((url: string) => void) | null = null
  private lastObjectiveTitle = ''

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: AudioEngine,
    private readonly store: SaveStore,
    private readonly events: GameEvents,
  ) {
    this.hud = {
      mode: 'boot', objective: objectiveFor(this.progress), prompt: null, integrity: 100, shards: 0, ore: 0, nodes: 0, vitality: 0, discoveries: 0,
      scanner: { active: false, state: 'idle', label: '', dist: 0, progress: 0, known: false }, tags: [], waypoint: null, caption: null,
      haze: 0, black: 1, flash: 0, hurt: 0, yaw: 0, bearing: null, skipVisible: false, survey: false, walk: false, teaser: null, speed: 0, region: null, land: null, eco: 'Scarred', ecoIndex: 0, hidden: true,
    }
  }

  // ------------------------------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------------------------------
  async init(assets: Assets): Promise<void> {
    const load = async (url: string) => {
      try {
        const gltf = await assets.gltf(url)
        return extractModel(gltf.scene)
      } catch (err) {
        console.warn('Model failed to load, using procedural fallback:', url, err)
        return null
      }
    }
    const [crystal, pylon, frond, grazer, pod] = await Promise.all([load(crystalUrl), load(pylonUrl), load(frondUrl), load(grazerUrl), load(podUrl)])
    try {
      this.v2 = await loadV2()
    } catch (err) {
      console.warn('V2 prototypes failed to load; continuing without them:', err)
      this.v2 = null
    }
    this.models = {
      crystal: crystal ?? undefined, pylon: pylon ?? undefined, frond: frond ?? undefined, grazer: grazer ?? undefined, pod: pod ?? undefined,
    }
    this.build()
  }

  private build(): void {
    const settings = this.store.data.settings
    const preset = QUALITY_PRESETS[settings.quality]
    const scene = this.scene
    scene.background = new THREE.Color('#0b0a0e')
    scene.environment = buildEnvironment(this.renderer.gl)
    scene.environmentIntensity = 0.7
    this.lighting = new Lighting(scene, preset.shadowMap, preset.shadows)
    this.fill = new THREE.DirectionalLight('#ffd6c2', 0.55)
    scene.add(this.fill, this.fill.target)
    this.sky = new SkyDome()
    scene.add(this.sky.mesh)
    scene.add(createTerrain(this.hf, this.physics))
    this.water = new Water(this.hf)
    scene.add(this.water.group)
    this.veins = new Veins(this.hf)
    scene.add(this.veins.group)
    this.props = new Props(this.hf, this.physics, this.models)
    scene.add(this.props.group)
    const dens = QUALITY_DENSITY[settings.quality]
    this.spires = new Spires(this.hf, this.physics, dens.flora)
    scene.add(this.spires.group)
    this.flora = new Flora(this.hf, this.models, dens.flora)
    this.floraDensity = dens.flora
    scene.add(this.flora.group)
    this.eco = new EcoGrid(this.hf)
    this.successionModel = new SurveyModel(this.hf, this.v2, this.physics)
    scene.add(this.successionModel.group)
    this.biota = new Biota(this.hf, this.props.vents, dens.flora, this.eco, this.v2, QUALITY_LEVEL[settings.quality], this.physics)
    scene.add(this.biota.group)
    this.creatures = new Creatures(this.hf, this.models.grazer, 5)
    scene.add(this.creatures.group)
    this.atmosphere = new Atmosphere(this.veins.mainPath, dens.atmo)
    scene.add(this.atmosphere.group)

    const sp = POI.arrival
    this.spawn.set(sp.x, this.hf.heightAt(sp.x, sp.z), sp.z)
    this.lastSafe.copy(this.spawn)
    this.explorer = new Explorer(this.physics, this.spawn)
    this.physics.bind(this.explorer.body, this.explorer.root)
    scene.add(this.explorer.root)
    this.explorer.events.onFootstep = speed => {
      if (this.mode !== 'playing' && this.mode !== 'teaser') return
      this.audio.footstep(speed, this.wading > 0.12 ? 'water' : this.groundCover() > 0.5 ? 'moss' : 'rock')
      if (this.wading > 0.12) this.atmosphere.burst(this.explorer.root.position.clone().setY(U.uWaterY.value + 0.1), { count: 4, color: '#bfe8e2', speed: 1.4, life: 0.5, up: 1.2, gravity: 6 })
    }
    this.explorer.events.onJump = () => {
      this.audio.jump()
      if (this.mode === 'playing') this.progress.tutorial.jumped = true
    }
    this.explorer.events.onLand = impact => {
      this.audio.land(impact)
      if (impact > 6) {
        const p = this.explorer.root.position.clone().setY(this.explorer.feetY + 0.1)
        this.atmosphere.burst(p, { count: Math.min(24, Math.round(impact * 1.4)), color: this.groundCover() > 0.5 ? '#9ec47a' : '#b88466', speed: 2.2, life: 0.8, up: 0.8, gravity: 6, spread: 0.6 })
        if (impact > 13 && !this.reducedMotion) this.camRig.shake(0.35)
      }
    }
    this.camRig = new CameraRig(this.physics, window.innerWidth / Math.max(1, window.innerHeight))
    this.camRig.setIgnoredBody(this.explorer.body)

    this.cine = new Cinematics({ hf: this.hf, props: this.props, path: this.veins.mainPath })
    this.scannables = buildScannables({ props: this.props, hf: this.hf, flora: this.flora, creatures: this.creatures, biota: this.biota, eco: this.eco, survey: this.successionModel, player: () => this.explorer.position })

    const ringGeo = new THREE.RingGeometry(0.9, 1, 64)
    for (let i = 0; i < 8; i += 1) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#35f2d2', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }))
      m.visible = false
      m.renderOrder = 6
      this.scene.add(m)
      this.ripples.push({ mesh: m, t: 0, dur: 1, max: 1, active: false, flat: true })
    }
    this.applySettings(settings)
    this.applyProgressToWorld(this.store.data.progress ?? defaultProgress(), false)
    this.camRig.camera.position.set(this.spawn.x + 8, this.spawn.y + 4, this.spawn.z + 12)
  }

  // ------------------------------------------------------------------------------------------
  // Settings / quality
  // ------------------------------------------------------------------------------------------
  applySettings(s: Settings): void {
    this.input.sensitivity = s.sensitivity
    this.input.invertY = s.invertY
    CONFIG.camera.fov = s.fov
    this.reducedMotion = s.reducedMotion
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, ambience: s.ambience, muted: s.muted })
    if (!this.camRig) return
    this.renderer.applyQuality(s.quality)
    this.lighting.setShadows(QUALITY_PRESETS[s.quality].shadows, this.renderer.shadowMapSize)
    const dens = QUALITY_DENSITY[s.quality]
    if (this.floraDensity !== dens.flora) this.rebuildQualityObjects(dens)
  }

  private rebuildQualityObjects(dens: { flora: number; atmo: number }): void {
    const dispose = (g: THREE.Object3D) => {
      g.traverse(o => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
      })
    }
    this.scene.remove(this.flora.group)
    dispose(this.flora.group)
    this.flora = new Flora(this.hf, this.models, dens.flora)
    this.scene.add(this.flora.group)
    this.scene.remove(this.biota.group)
    dispose(this.biota.group)
    this.biota = new Biota(this.hf, this.props.vents, dens.flora, this.eco, this.v2, QUALITY_LEVEL[this.store.data.settings.quality])
    this.scene.add(this.biota.group)
    this.scene.remove(this.atmosphere.group)
    dispose(this.atmosphere.group)
    this.atmosphere = new Atmosphere(this.veins.mainPath, dens.atmo)
    this.scene.add(this.atmosphere.group)
    this.scannables = buildScannables({ props: this.props, hf: this.hf, flora: this.flora, creatures: this.creatures, biota: this.biota, eco: this.eco, survey: this.successionModel, player: () => this.explorer.position })
    this.floraDensity = dens.flora
  }

  /** Apply a progress snapshot to every visual and gameplay object. */
  applyProgressToWorld(p: Progress, teleport: boolean): void {
    this.progress = p
    this.view.vit = p.vitality
    this.view.nodes = [...p.nodes] as [boolean, boolean, boolean]
    this.view.act = p.stabilized ? 1 : nodeCount(p) * 0.28
    this.view.hold = 0
    this.view.pulse = 0
    for (const pk of this.props.pickups) pk.collected = p.shardsFound.includes(pk.id) || p.oreFound.includes(pk.id)
    for (let i = 0; i < 3; i += 1) this.props.setNodeVisual(i, p.nodes[i], false)
    U.uVit.value = this.view.vit
    U.uAct.value = this.view.act
    U.uPulse.value = 0
    this.ecoRestored = p.ecoTiles ? this.eco.restore(p.ecoTiles, p.vitality) : false
    if (!this.ecoRestored) this.eco.apply(p.vitality, true)
    this.water.update(this.view.vit, this.hf)
    if (teleport) {
      const pos = p.pos ? new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]) : this.spawn.clone()
      this.explorer.teleport(pos.x, pos.y, pos.z, p.yaw)
      this.lastSafe.copy(pos)
      this.lastSafeYaw = p.yaw
      this.camRig.snapBehind(p.yaw)
      this.camRig.pitch = 0.22
    }
    this.lastObjectiveTitle = ''
  }

  private groundCover(): number {
    const p = this.explorer.root.position
    const dBasin = Math.hypot(p.x - POI.basin.x, p.z - POI.basin.z)
    const dCore = Math.hypot(p.x - POI.core.x, p.z - POI.core.z)
    const v = this.view.vit
    return Math.max(smooth(0, 34, v * 190 - dBasin), smooth(0, 26, v * 105 - dCore))
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------
  private readonly shotFn = (_t: number, out: Shot): void => {
    out.pos.copy(this.shotSrc.pos)
    out.look.copy(this.shotSrc.look)
    out.fov = this.shotSrc.fov
  }

  private transitionCb: (() => void) | null = null

  /** Fade to black, run `cb` at full black, then fade back in. */
  private transition(cb: () => void): void {
    if (this.transitionCb) return
    this.transitionCb = cb
    this.fadeTarget = 1
  }

  get frozen(): boolean {
    return this.mode !== 'playing' || this.journalOpen
  }

  get hasSave(): boolean {
    return this.store.hasProgress()
  }

  get isPlaying(): boolean {
    return this.mode === 'playing'
  }

  private setMode(m: Mode): void {
    this.mode = m
    this.hud.mode = m
    this.input.enabled = m === 'playing' && !this.journalOpen
    this.hud.hidden = m !== 'playing' && m !== 'paused'
  }

  enterTitle(): void {
    this.setMode('title')
    this.scanMode = false
    this.survey = false
    this.journalOpen = false
    this.camRig.exitSurvey()
    this.audio.holdTone(null)
    this.applyProgressToWorld(this.store.data.progress ?? defaultProgress(), false)
    this.explorer.teleport(this.spawn.x, this.spawn.y, this.spawn.z, 0.2)
    this.explorer.setScanning(false)
    this.cineT = 0
    this.camRig.playShot(this.shotFn, 0.01, true)
    this.audio.setMusic(true)
    this.hud.black = 0
  }

  newGame(): void {
    this.store.clearProgress()
    const p = defaultProgress()
    this.integrity = 100
    this.applyProgressToWorld(p, true)
    this.holdProgress = 0
    this.pulseT = -1
    this.startOpening()
  }

  private startOpening(): void {
    this.setMode('opening')
    this.cineT = 0
    this.scanMode = false
    this.explorer.teleport(this.spawn.x, this.spawn.y, this.spawn.z, 0)
    this.explorer.setScanning(false)
    this.camRig.playShot(this.shotFn, 0.01, true)
    this.audio.setMusic(true)
    this.audio.riser(7)
    this.audio.whoosh(5, 0.1)
    this.hud.skipVisible = true
  }

  continueGame(): void {
    const saved = this.store.data.progress
    if (!saved) {
      this.newGame()
      return
    }
    this.integrity = 100
    this.transition(() => {
      this.applyProgressToWorld(saved, true)
      this.pulseT = -1
      this.holdProgress = 0
      this.camRig.stopShot(0, true)
      this.setMode('playing')
      this.afterEnterPlay()
      this.events.toast(`Welcome back. ${this.hud.objective.title}`, 'objective')
    })
  }

  private afterEnterPlay(): void {
    this.hud.skipVisible = false
    this.hud.caption = null
    this.hud.haze = 0
    this.audio.setMusic(true)
    this.input.enabled = !this.journalOpen
    this.regionNow = null
    this.lastObjectiveTitle = ''
  }

  skipCinematic(): void {
    if (this.mode === 'opening') {
      this.transition(() => {
        this.hud.skipVisible = false
        this.camRig.snapBehind(0)
        this.camRig.stopShot(0, true)
        this.setMode('playing')
        this.afterEnterPlay()
        this.saveNow()
      })
    } else if (this.mode === 'teaser') {
      this.exitTeaser()
    }
  }

  private finishOpening(): void {
    this.hud.skipVisible = false
    this.camRig.snapBehind(0)
    this.camRig.stopShot(1.6)
    this.setMode('playing')
    this.afterEnterPlay()
    this.saveNow()
    this.events.toast('Control is yours. Follow the objective in the top-left.', 'objective')
  }

  pause(): void {
    if (this.mode !== 'playing') return
    this.setMode('paused')
    this.audio.holdTone(null)
    this.holdProgress = 0
    this.saveNow()
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.setMode('playing')
  }

  toTitle(): void {
    if (this.mode === 'playing' || this.mode === 'paused') this.saveNow()
    this.transition(() => {
      this.enterTitle()
      this.hud.skipVisible = false
      this.events.teaserEnded()
    })
  }

  startTeaser(kind: 'teaser' | 'transform' = 'teaser'): void {
    this.teaserKind = kind
    this.setMode('teaser')
    this.cineT = 0
    this.teaserPaused = false
    this.teaserFired.clear()
    this.scanMode = false
    this.journalOpen = false
    this.survey = false
    this.camRig.exitSurvey()
    this.explorer.setScanning(false)
    this.camRig.playShot(this.shotFn, 0.01, true)
    this.audio.setMusic(true)
    this.audio.holdTone(null)
    this.hud.skipVisible = true
  }

  restartTeaser(): void {
    this.cineT = 0
    this.teaserPaused = false
    this.teaserFired.clear()
    this.view.pulse = 0
  }

  toggleTeaserPause(): boolean {
    this.teaserPaused = !this.teaserPaused
    return this.teaserPaused
  }

  get teaserIsPaused(): boolean {
    return this.teaserPaused
  }

  exitTeaser(): void {
    this.transition(() => {
      this.hud.skipVisible = false
      this.hud.caption = null
      this.hud.teaser = null
      this.hud.haze = 0
      this.view.pulse = 0
      U.uPulse.value = 0
      // Restore the real world state after the scripted one.
      this.applyProgressToWorld(this.store.data.progress ?? defaultProgress(), false)
      this.explorer.teleport(this.spawn.x, this.spawn.y, this.spawn.z, 0.2)
      this.enterTitle()
      this.events.teaserEnded()
    })
  }

  captureStill(cb: (dataUrl: string) => void): void {
    this.captureWanted = cb
  }

  openJournal(): void {
    if (this.mode !== 'playing' || this.journalOpen) return
    this.journalOpen = true
    this.scanMode = false
    this.input.enabled = false
    this.audio.holdTone(null)
    this.audio.uiOpen()
    this.events.journalToggled(true)
  }

  closeJournal(): void {
    if (!this.journalOpen) return
    this.journalOpen = false
    this.input.enabled = this.mode === 'playing'
    this.audio.uiClose()
    this.events.journalToggled(false)
  }

  /** Return to the last safe position (pause menu "stuck" helper). */
  returnToSafe(): void {
    this.transition(() => {
      this.explorer.teleport(this.lastSafe.x, this.lastSafe.y, this.lastSafe.z, this.lastSafeYaw)
      this.camRig.snapBehind(this.lastSafeYaw)
      this.audio.respawn()
    })
  }

  eraseSave(): void {
    this.store.clearProgress()
    this.applyProgressToWorld(defaultProgress(), false)
  }

  saveNow(): void {
    if (this.mode === 'title' || this.mode === 'boot' || this.mode === 'teaser') return
    const p = this.progress
    p.pos = [this.lastSafe.x, this.lastSafe.y, this.lastSafe.z]
    p.yaw = this.mode === 'opening' ? 0 : this.camRig.yaw
    this.eco.apply(p.vitality)
    p.ecoTiles = this.eco.serialize()
    this.store.saveProgress(p)
  }

  // ------------------------------------------------------------------------------------------
  // Fixed simulation step
  // ------------------------------------------------------------------------------------------
  private intent = {
    dirX: 0, dirZ: 0, magnitude: 0, sprint: false, walk: false, jumpPressed: false, jumpHeld: false, speedScale: 1, faceYaw: null as number | null, frozen: true,
  }

  step(dt: number): void {
    if (this.mode === 'playing' && !this.journalOpen) {
      this.intent.jumpPressed = this.input.consume('jump')
      this.intent.jumpHeld = this.input.held('jump')
      this.explorer.step(dt, this.intent)
      this.physics.step(dt)
    } else if (this.mode === 'title' || this.mode === 'opening' || this.mode === 'teaser') {
      this.physics.step(dt)
    }
  }

  // ------------------------------------------------------------------------------------------
  // Per-frame update
  // ------------------------------------------------------------------------------------------
  private readonly tmpV = new THREE.Vector3()
  private readonly tmpV2 = new THREE.Vector3()
  private readonly tmpDir = new THREE.Vector3()
  private readonly feet = new THREE.Vector3()
  private scanCooldown = 0
  private missClock = 0

  render(alpha: number, frameSeconds: number): void {
    const dt = Math.min(frameSeconds, 0.1)
    this.recordFrame(frameSeconds)
    this.input.update()
    this.time += dt
    U.uTime.value = this.time
    switch (this.mode) {
      case 'title': this.updateTitle(dt); break
      case 'opening': this.updateOpening(dt); break
      case 'teaser': this.updateTeaser(dt); break
      case 'playing': this.updatePlaying(dt); break
      default: break
    }
    this.updateFade(dt)
    this.physics.sync(alpha)
    this.updateVisuals(dt)
    this.updateCameraAndDraw(dt)
    this.input.endFrame()
  }

  private updateFade(dt: number): void {
    const target = this.fadeTarget
    this.fadeBlack += clamp(target - this.fadeBlack, -dt * 2.2, dt * 4)
    if (this.transitionCb && this.fadeBlack >= 0.99) {
      const cb = this.transitionCb
      this.transitionCb = null
      this.fadeTarget = 0
      cb()
    }
    this.hud.black = Math.max(this.fadeBlack, this.mode === 'opening' || this.mode === 'teaser' ? this.cineOut.black : 0)
  }

  private updateTitle(dt: number): void {
    this.cineT += dt
    this.cine.title(this.cineT, this.shotSrc, this.spawn)
    this.hud.caption = null
    this.hud.haze = 0
    this.cineOut.phase = 'world'
    this.cineOut.black = 0
  }

  private fireOnce(key: string, fn: () => void): void {
    if (this.teaserFired.has(key)) return
    this.teaserFired.add(key)
    fn()
  }

  private updateOpening(dt: number): void {
    this.cineT += dt
    const t = Math.min(this.cineT, OPENING_SECONDS + 3)
    this.cine.opening(t, this.cineOut, this.spawn)
    this.copyShot()
    this.hud.caption = this.cineOut.caption
    this.hud.haze = this.cineOut.haze
    if (this.cineT > 9.55) this.fireOnce('o-impact', () => { this.audio.boom(); this.audio.whoosh(3, 0.2) })
    if (this.cineT >= OPENING_HANDOVER && this.mode === 'opening' && !this.transitionCb) this.finishOpening()
  }

  private copyShot(): void {
    this.shotSrc.pos.copy(this.cineOut.shot.pos)
    this.shotSrc.look.copy(this.cineOut.shot.look)
    this.shotSrc.fov = this.cineOut.shot.fov
  }

  private updateTeaser(dt: number): void {
    if (!this.teaserPaused) this.cineT += dt
    const dur = this.teaserKind === 'transform' ? TRANSFORM_SECONDS : TEASER_SECONDS
    const t = Math.min(this.cineT, dur)
    if (this.teaserKind === 'transform') this.cine.transformation(t, this.cineOut)
    else this.cine.teaser(t, this.cineOut)
    const out = this.cineOut
    this.copyShot()
    this.hud.caption = out.caption
    this.hud.haze = out.haze
    const v = out.view
    if (v) {
      this.view.vit = v.vit ?? 0
      this.view.act = v.act ?? 0
      this.view.hold = v.hold ?? 0
      this.view.nodes = (v.nodes ?? [false, false, false]) as [boolean, boolean, boolean]
      this.view.pulse = v.pulse ?? 0
    }
    const e = out.explorer
    if (e) {
      this.explorer.root.visible = true
      const yaw = this.explorer.yaw
      const d = Math.atan2(Math.sin(e.yaw - yaw), Math.cos(e.yaw - yaw))
      this.explorer.teleport(e.pos.x, e.pos.y, e.pos.z, e.speed > 0.1 ? yaw + d * Math.min(1, dt * 9) : yaw + d * Math.min(1, dt * 4))
      this.explorer.speedH = this.teaserPaused ? 0 : e.speed
      this.explorer.grounded = true
      if (e.reach) this.fireOnce(`reach${Math.floor(t)}`, () => this.explorer.reach())
    } else {
      this.explorer.root.visible = false
    }
    this.speedNow = this.explorer.speedH
    if (this.teaserKind === 'teaser' && t > 0.3) this.fireOnce('t-open', () => { this.audio.riser(6); this.audio.whoosh(4, 0.12) })
    if (this.teaserKind === 'teaser' && t > 6.3) this.fireOnce('t-dive', () => { this.audio.boom(); this.audio.whoosh(3, 0.18) })
    for (const ev of out.events) {
      if (ev.startsWith('seat')) {
        const i = Number(ev.slice(4))
        this.fireOnce(ev, () => {
          this.audio.seat()
          const n = this.props.nodes[i]
          this.atmosphere.burst(n.pos.clone().setY(n.pos.y + 1.5), { count: 40, color: '#35f2d2', speed: 4, life: 1.3, up: 2, gravity: -1 })
          this.ripple(n.pos, '#35f2d2', 9, 1.2, true)
        })
      } else if (ev === 'stabilize') {
        this.fireOnce(ev, () => this.stabilizeEffects())
      }
    }
    this.hud.teaser = { time: t, duration: dur, paused: this.teaserPaused }
    if (this.cineT >= dur && !this.transitionCb) this.exitTeaser()
  }

  private stabilizeEffects(): void {
    this.flash = 1
    if (!this.reducedMotion) this.camRig.shake(1.1)
    this.audio.stabilizeBlast()
    const c = this.props.pylonPos
    this.atmosphere.burst(c.clone().setY(c.y + 5), { count: 220, color: '#5ffbe0', speed: 16, life: 2.6, up: 5, gravity: 1.5, spread: 1.4 })
    this.atmosphere.burst(c.clone().setY(c.y + 2), { count: 90, color: '#ffffff', speed: 9, life: 1.6, up: 3, gravity: 0, spread: 1.1 })
    this.ripple(c, '#5ffbe0', 60, 2.4, true)
    this.ripple(c.clone().setY(c.y + 3), '#aaffee', 40, 1.8, true)
  }

  // ---- playing ---------------------------------------------------------------------------
  private updatePlaying(dt: number): void {
    const inp = this.input
    const P = this.progress
    const sim = this.explorer.simPosition
    this.feet.set(sim.x, sim.y - this.explorer.feetOffset, sim.z)
    const feet = this.feet
    this.speedNow = this.explorer.speedH
    if (this.journalOpen) {
      this.holdProgress = 0
      this.audio.holdTone(null)
      return
    }
    if (inp.consume('pause')) this.events.pauseKey()
    if (inp.consume('journal')) this.openJournal()
    if (inp.consume('help')) this.events.helpKey()
    if (inp.consume('walkToggle')) {
      this.walkMode = !this.walkMode
      this.events.toast(this.walkMode ? 'Walk mode on (X to toggle)' : 'Run mode on', 'info')
    }
    if (inp.consume('freecam')) this.toggleSurvey()
    if (inp.consume('scanner') && !this.survey) {
      this.scanMode = !this.scanMode
      this.explorer.setScanning(this.scanMode)
      if (this.scanMode) this.audio.scanStart()
      else this.audio.uiClose()
      this.scanProgress = 0
    }
    if (this.mode !== 'playing') return

    // --- intent
    const cam = this.camRig
    const f = cam.forward
    const r = cam.rightVec
    const mx = inp.move.x
    const my = inp.move.y
    let dx = f.x * my + r.x * mx
    let dz = f.z * my + r.z * mx
    const l = Math.hypot(dx, dz)
    if (l > 1e-4) {
      dx /= l
      dz /= l
    }
    Object.assign(this.intent, {
      dirX: dx, dirZ: dz, magnitude: l > 0.01 ? inp.analog : 0, sprint: inp.held('sprint') && !this.walkMode, walk: this.walkMode,
      speedScale: this.wading > 0.35 ? 0.62 : 1, faceYaw: this.scanMode ? cam.yaw : null,
      frozen: this.survey || this.fadeBlack > 0.5 || this.transitionCb !== null,
    })

    // --- tutorial flags
    if (!P.tutorial.moved && Math.hypot(feet.x - this.spawn.x, feet.z - this.spawn.z) > 3) P.tutorial.moved = true
    if (!P.tutorial.sprinted && this.explorer.speedH > CONFIG.player.runSpeed + 1.4) P.tutorial.sprinted = true

    // --- water
    const inLake = this.water.group.visible && Math.hypot(feet.x - POI.basin.x, feet.z - POI.basin.z) < 48
    this.wading = inLake ? Math.max(0, U.uWaterY.value - feet.y) : 0

    // --- region + stage
    const region = regionAt(feet.x, feet.z)
    if (region !== this.regionNow) {
      this.regionNow = region
      this.hud.region = region ? POI_NAMES[region] : null
      if (region) this.events.region(POI_NAMES[region])
    }
    this.landT -= dt
    if (this.landT <= 0) {
      this.landT = 0.25
      const bm = biomeAt(this.hf, feet.x, feet.z)
      this.hud.land = `${BIOME_NAMES[bm]} - ${stageAt(feet.x, feet.z, this.view.vit).name}`
      this.hud.eco = ECO_STAGES[P.eco.stage].name + (ecoSettling(P.eco, P.vitality) ? ' (settling)' : '')
      this.hud.ecoIndex = P.eco.stage
    }
    const changed = advance(P, { inRegion: region ? { [region]: true } : {} })
    if (changed) this.onStageChanged(changed)

    // --- safe position + falling
    this.safeTimer -= dt
    if (this.safeTimer <= 0 && this.explorer.grounded && this.wading < 0.5 && this.integrity > 0 && this.invuln <= 0) {
      this.safeTimer = 0.6
      const slope = this.hf.slopeAt(feet.x, feet.z)
      if (slope < 0.8) {
        this.lastSafe.copy(feet)
        this.lastSafeYaw = cam.yaw
      }
    }
    if ((feet.y < this.hf.heightAt(feet.x, feet.z) - 6 || feet.y < -40) && !this.transitionCb) this.respawn(false)

    // --- timers
    this.invuln = Math.max(0, this.invuln - dt)
    if (this.invuln <= 0 && this.integrity < 100) this.integrity = Math.min(100, this.integrity + dt * 8)
    P.playTime += dt
    const ecoTarget = ECO_STAGES[P.eco.stage].vit
    if (P.stabilized && P.vitality < ecoTarget && (this.pulseT < 0 || this.pulseT > 1.2)) {
      P.vitality = Math.min(ecoTarget, P.vitality + (dt * 1.35) / CONFIG.world.recoverySeconds)
    }
    if (this.pulseT >= 0) {
      this.pulseT += dt
      this.view.pulse = this.pulseT * 55
      if (this.pulseT > 6.4) {
        this.pulseT = -1
        this.view.pulse = 0
      }
    }
    this.saveClock += dt
    if (this.saveClock > 12) {
      this.saveClock = 0
      this.saveNow()
    }

    // --- scanner + interaction
    const ctx = this.readCtx()
    this.updateScanner(dt, ctx, feet)
    this.updateInteraction(dt, feet)
    this.fillHudPlaying(feet)
  }

  private readCtx(): ReadCtx {
    return {
      player: this.explorer.root.position, vit: this.view.vit, act: this.view.act, progress: this.progress, props: this.props,
      hf: this.hf, flora: this.flora, creatures: this.creatures, eco: this.eco, time: this.time,
    }
  }

  private onStageChanged(stage: Stage): void {
    this.audio.objective()
    this.saveNow()
    if (stage === 'transform') this.events.toast('The core is steady. Water is moving down the channel.', 'objective')
    else if (stage === 'basinObserve') this.events.toast('The basin is changing. Scan what has returned.', 'objective')
    else if (stage === 'surgeGrowth') this.events.toast('Pioneer life is holding. The core can drive a stronger surge.', 'objective')
    else if (stage === 'surgeThriving') this.events.toast('Growth has taken hold. One more surge remains.', 'objective')
    else if (stage === 'free') {
      this.events.toast('Survey complete.', 'objective')
      this.events.complete()
    }
  }

  private toggleSurvey(): void {
    this.survey = !this.survey
    this.scanMode = false
    this.explorer.setScanning(false)
    if (this.survey) {
      this.camRig.enterSurvey()
      this.events.toast('Survey camera: WASD fly, Space up, C down, Shift fast, V to exit', 'info')
    } else this.camRig.exitSurvey()
  }

  // ---- damage / respawn --------------------------------------------------------------------
  private damage(from: THREE.Vector3): void {
    if (this.invuln > 0 || this.mode !== 'playing') return
    this.integrity -= 34
    this.invuln = 1.4
    this.hurtFlash = 1
    this.audio.hurt()
    if (!this.reducedMotion) this.camRig.shake(0.6)
    const p = this.explorer.root.position
    const dx = p.x - from.x
    const dz = p.z - from.z
    const l = Math.hypot(dx, dz) || 1
    this.explorer.velocity.set((dx / l) * 10, 6.5, (dz / l) * 10)
    this.explorer.grounded = false
    if (this.integrity <= 0) {
      this.events.toast('Suit integrity failed. Restoring at your last safe position.', 'warn')
      this.respawn(true)
    } else {
      this.events.toast('Discharge hit. Suit integrity reduced.', 'warn')
    }
  }

  private respawn(failed: boolean): void {
    void failed
    this.transition(() => {
      this.integrity = 100
      this.invuln = 1.5
      this.explorer.teleport(this.lastSafe.x, this.lastSafe.y, this.lastSafe.z, this.lastSafeYaw)
      this.camRig.snapBehind(this.lastSafeYaw)
      this.audio.respawn()
    })
  }

  // ---- scanner -----------------------------------------------------------------------------
  private updateScanner(dt: number, ctx: ReadCtx, feet: THREE.Vector3): void {
    void feet
    const h = this.hud.scanner
    h.active = this.scanMode
    this.scanCooldown = Math.max(0, this.scanCooldown - dt)
    if (!this.scanMode) {
      this.lock = null
      this.scanProgress = 0
      h.state = 'idle'
      this.hud.tags.length = 0
      return
    }
    const cam = this.camRig.camera
    const dir = cam.getWorldDirection(this.tmpDir)
    const found = pickTarget(this.scannables, cam.position, dir, ctx)
    let target = found
    if (target && target.dist < 90) {
      const o = cam.position
      const to = this.tmpV.copy(target.pos).sub(o)
      const d = to.length()
      to.divideScalar(d)
      const hit = this.physics.world.castRay(new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: to.x, y: to.y, z: to.z }), d, true, undefined, undefined, undefined, this.explorer.body)
      if (hit && hit.timeOfImpact < d - (target.s.radius + 2.6)) target = null
    }
    if (target?.s.key !== this.lock?.s.key) this.scanProgress = 0
    this.lock = target ? { s: target.s, pos: target.pos.clone(), dist: target.dist } : null
    const holding = this.input.held('scanFire')
    if (this.lock) {
      const known = has(this.progress, this.lock.s.discovery)
      h.label = known ? `${this.lock.s.name} (catalogued)` : this.lock.s.name
      h.dist = this.lock.dist
      h.known = known
      if (holding && this.scanCooldown <= 0) {
        this.scanProgress = Math.min(1, this.scanProgress + dt / (this.lock.s.seconds ?? CONFIG.world.scanSeconds))
        this.scanSoundClock -= dt
        if (this.scanSoundClock <= 0) {
          this.scanSoundClock = 0.16
          this.audio.scanLockLoop(this.scanProgress)
        }
        if (this.scanProgress >= 1) this.completeScan(this.lock, ctx)
      } else {
        this.scanProgress = Math.max(0, this.scanProgress - dt * 2)
      }
      h.state = this.scanProgress > 0.01 ? 'scanning' : 'target'
    } else {
      this.scanProgress = Math.max(0, this.scanProgress - dt * 3)
      h.state = 'idle'
      h.label = ''
      this.missClock -= dt
      if (holding && this.missClock <= 0) {
        this.missClock = 0.9
        this.audio.scanFail()
      }
    }
    h.progress = this.scanProgress
    this.buildTags(ctx)
  }

  private buildTags(ctx: ReadCtx): void {
    const tags = this.hud.tags
    tags.length = 0
    const cam = this.camRig.camera
    const v = this.tmpV2
    const list: Tag[] = []
    for (const s of this.scannables) {
      if (!s.enabled(ctx)) continue
      const p = s.pos()
      const d = ctx.player.distanceTo(p)
      if (d > Math.min(s.range, 140) && s.key !== 'signature') continue
      if (s.key === 'signature' && has(this.progress, 'signature')) continue
      v.copy(p).project(cam)
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue
      const known = has(this.progress, s.discovery)
      if (known && d > 30) continue
      list.push({ x: v.x * 0.5 + 0.5, y: -v.y * 0.5 + 0.5, label: s.name, known, dist: d })
    }
    list.sort((a, b) => a.dist - b.dist)
    for (const t of list.slice(0, 9)) tags.push(t)
  }

  private completeScan(lock: { s: Scannable; pos: THREE.Vector3 }, ctx: ReadCtx): void {
    const readings = lock.s.readings(ctx, lock.pos)
    const isNew = this.discover(lock.s.discovery, readings)
    this.scanProgress = 0
    this.scanCooldown = 0.9
    if (isNew) this.audio.scanComplete()
    else {
      this.audio.scanBlip()
      window.setTimeout(() => this.audio.scanBlip(), 90)
    }
    this.ripple(lock.pos, isNew ? '#5ffbe0' : '#9fd8cf', Math.max(3, lock.s.radius * 1.8), 0.9, false)
    this.atmosphere.burst(lock.pos, { count: isNew ? 40 : 14, color: isNew ? '#5ffbe0' : '#9fd8cf', speed: 3.4, life: 0.9, up: 0.5, gravity: 0, spread: 1.4 })
  }

  /** Record a discovery with the readings captured now. Returns true when it is new. */
  discover(id: string, readings: [string, string][]): boolean {
    const d = DISCOVERY_BY_ID.get(id)
    if (!d) return false
    const P = this.progress
    const isNew = !has(P, id)
    P.discoveries[id] = { at: isNew ? Math.round(P.playTime) : P.discoveries[id].at, readings }
    this.events.discovery(d, isNew, readings)
    if (isNew) this.saveNow()
    return isNew
  }

  // ---- interaction ---------------------------------------------------------------------------
  private updateInteraction(dt: number, feet: THREE.Vector3): void {
    const P = this.progress
    const hud = this.hud
    let best: { dist: number; text: string; blocked: boolean; hold: boolean; act: (() => void) | null } | null = null
    const consider = (dist: number, text: string, blocked: boolean, hold: boolean, act: (() => void) | null) => {
      if (!best || dist < best.dist) best = { dist, text, blocked, hold, act }
    }
    for (const pk of this.props.pickups) {
      if (pk.collected) continue
      const d = Math.hypot(pk.pos.x - feet.x, pk.pos.z - feet.z)
      if (d < 3 && Math.abs(pk.pos.y - feet.y) < 3.2) consider(d, pk.kind === 'shard' ? 'Collect resonance shard' : 'Collect bloodstone ore', false, false, () => this.collect(pk))
    }
    for (const n of this.props.nodes) {
      if (n.repaired) continue
      const d = Math.hypot(n.pos.x - feet.x, n.pos.z - feet.z)
      if (d > 4.2 || Math.abs(n.pos.y - feet.y) > 4) continue
      if (stageIndex(P.stage) < stageIndex('repair')) consider(d, 'Dormant conduit node. Scan the Life-Core first (Q).', true, false, null)
      else if (P.shards > 0) consider(d, `Seat resonance shard (${P.shards} carried)`, false, false, () => this.seatNode(n.index))
      else consider(d, 'Needs a resonance shard. Collect them in the crystal field.', true, false, null)
    }
    const pd = Math.hypot(this.props.pylonPos.x - feet.x, this.props.pylonPos.z - feet.z)
    if (pd < 10 && !P.stabilized) {
      if (stageIndex(P.stage) < stageIndex('repair')) consider(pd + 3, 'The Life-Core is unstable. Scan it first (Q).', true, false, null)
      else if (nodeCount(P) < 3) consider(pd + 3, `Link all three conduit nodes first (${nodeCount(P)}/3)`, true, false, null)
      else consider(pd, 'Hold to stabilize the Life-Core', false, true, null)
    } else if (pd < 10 && P.stabilized && P.eco.stage < 3 && stageIndex(P.stage) >= stageIndex('surgeGrowth')) {
      const next = ECO_STAGES[P.eco.stage + 1]
      if (ecoSettling(P.eco, P.vitality)) consider(pd + 3, `The land is still responding (${ECO_STAGES[P.eco.stage].name}). Wait for it to settle.`, true, false, null)
      else consider(pd, `Hold to channel the Life-Core surge (${next.name})`, false, true, null)
    }
    const b = best as { dist: number; text: string; blocked: boolean; hold: boolean; act: (() => void) | null } | null
    if (!b) {
      hud.prompt = null
      this.holdProgress = Math.max(0, this.holdProgress - dt * 0.8)
      if (this.holdProgress <= 0) this.audio.holdTone(null)
      return
    }
    let holdVal: number | null = null
    if (b.hold) {
      if (this.input.held('interact') && !this.survey) {
        this.holdProgress = Math.min(1, this.holdProgress + dt / 3.2)
        this.audio.holdTone(this.holdProgress)
        this.explorer.reach()
        if (!this.reducedMotion) this.camRig.shake(0.05 + this.holdProgress * 0.25)
        if (this.holdProgress >= 1) {
          this.holdProgress = 0
          this.audio.holdTone(null)
          if (!P.stabilized) this.finishStabilize()
          else this.tryEcoAdvance(P.eco.lastEvent + 1)
        }
      } else {
        this.holdProgress = Math.max(0, this.holdProgress - dt * 0.8)
        if (this.holdProgress <= 0) this.audio.holdTone(null)
        else this.audio.holdTone(this.holdProgress)
      }
      holdVal = this.holdProgress
    } else {
      this.holdProgress = Math.max(0, this.holdProgress - dt)
      if (this.holdProgress <= 0) this.audio.holdTone(null)
      if (b.act && this.input.consume('interact')) b.act()
    }
    hud.prompt = { text: b.text, key: 'E', hold: holdVal, blocked: b.blocked }
  }

  private collect(pk: Pickup): void {
    const P = this.progress
    pk.collected = true
    this.explorer.reach()
    const ctx = this.readCtx()
    const sc = this.scannables.find(s => s.key === pk.id)
    const readings = sc ? sc.readings(ctx, pk.pos) : []
    if (pk.kind === 'shard') {
      P.shardsFound.push(pk.id)
      P.shards += 1
      this.audio.pickup('shard')
      this.events.toast(`Resonance shard recovered (${P.shardsFound.length} found, ${P.shards} carried)`, 'info')
    } else {
      P.oreFound.push(pk.id)
      this.audio.pickup('ore')
      this.events.toast(`Bloodstone ore sample collected (${P.oreFound.length})`, 'info')
    }
    this.atmosphere.burst(pk.pos, { count: 26, color: pk.kind === 'shard' ? '#5ffbe0' : '#e0603a', speed: 3, life: 0.9, up: 1.5, gravity: 3 })
    this.ripple(pk.pos, pk.kind === 'shard' ? '#5ffbe0' : '#e0603a', 3.5, 0.7, true)
    this.discover(pk.kind === 'shard' ? 'shard' : 'ore', readings)
    this.saveNow()
  }

  private seatNode(i: number): void {
    const P = this.progress
    if (P.shards <= 0 || P.nodes[i]) return
    P.shards -= 1
    P.nodes[i] = true
    this.explorer.reach()
    this.audio.seat()
    const n = this.props.nodes[i]
    this.atmosphere.burst(n.pos.clone().setY(n.pos.y + 1.5), { count: 44, color: '#35f2d2', speed: 4, life: 1.3, up: 2, gravity: -1 })
    this.ripple(n.pos, '#35f2d2', 10, 1.2, true)
    if (!this.reducedMotion) this.camRig.shake(0.25)
    const count = nodeCount(P)
    this.events.toast(count >= 3 ? 'All three nodes linked. Hold E at the core to stabilize it.' : `Conduit node linked (${count}/3)`, 'objective')
    const sc = this.scannables.find(s => s.key === `node${i}`)
    this.discover('conduit', sc ? sc.readings(this.readCtx(), n.pos) : [])
    this.saveNow()
  }

  private finishStabilize(): void {
    const P = this.progress
    if (P.stabilized) return
    P.stabilized = true
    P.vitality = Math.max(P.vitality, 0.002)
    this.tryEcoAdvance(P.eco.lastEvent + 1, true)
    this.pulseT = 0
    this.explorer.reach()
    this.stabilizeEffects()
    this.events.toast('Life-Core stabilized. Watch the land.', 'objective')
    const changed = advance(P, { inRegion: {} })
    if (changed) this.onStageChanged(changed)
    this.saveNow()
  }

  /**
   * Offer a Life-Core event to the ecological state machine. One accepted event gains exactly one state;
   * duplicates, events during a transition and events past Thriving are rejected without side effects.
   */
  tryEcoAdvance(eventId: number, silent = false): EcoResult {
    const P = this.progress
    const res = requestEcoAdvance(P.eco, eventId, P.vitality)
    this.ecoLog.push({ t: +P.playTime.toFixed(2), id: eventId, accepted: res.accepted, reason: res.reason, from: res.from, to: res.to })
    if (!res.accepted) return res
    this.pulseT = 0
    if (!silent) {
      this.stabilizeEffects()
      const st = ECO_STAGES[res.to]
      this.events.toast(`Life-Core surge accepted: ${st.name}. ${st.summary}`, 'objective')
      const changed = advance(P, { inRegion: {} })
      if (changed) this.onStageChanged(changed)
    }
    this.saveNow()
    return res
  }
  private ripple(pos: THREE.Vector3, color: string, max: number, dur: number, flat: boolean): void {
    const r = this.ripples.find(x => !x.active) ?? this.ripples[0]
    r.active = true
    r.t = 0
    r.dur = dur
    r.max = max
    r.flat = flat
    r.mesh.visible = true
    r.mesh.position.copy(pos)
    if (flat) {
      r.mesh.rotation.set(-Math.PI / 2, 0, 0)
      r.mesh.position.y += 0.4
    }
    ;(r.mesh.material as THREE.MeshBasicMaterial).color.set(color)
  }

  // ---- HUD ------------------------------------------------------------------------------------
  private fillHudPlaying(feet: THREE.Vector3): void {
    const P = this.progress
    const h = this.hud
    const obj = objectiveFor(P)
    h.objective = obj
    if (obj.title !== this.lastObjectiveTitle) {
      if (this.lastObjectiveTitle !== '') this.events.objectiveChanged(obj)
      this.lastObjectiveTitle = obj.title
    }
    h.integrity = this.integrity
    h.shards = P.shards
    h.ore = P.oreFound.length
    h.nodes = nodeCount(P)
    h.vitality = P.vitality
    h.discoveries = Object.keys(P.discoveries).length
    h.survey = this.survey
    h.walk = this.walkMode
    h.speed = this.speedNow
    h.yaw = ((-this.camRig.yaw * 180) / Math.PI + 720) % 360
    // Waypoint toward the current objective region.
    h.waypoint = null
    h.bearing = null
    if (obj.target && !this.survey) {
      const cp = this.props.checkpoints[obj.target]
      const target = obj.target === 'core' ? this.props.pylonPos.clone().setY(this.props.pylonPos.y + 14) : cp.clone().setY(cp.y + 7)
      const dist = Math.hypot(target.x - feet.x, target.z - feet.z)
      h.bearing = ((Math.atan2(target.x - feet.x, -(target.z - feet.z)) * 180) / Math.PI + 360) % 360
      const cam = this.camRig.camera
      const v = this.tmpV2.copy(target).applyMatrix4(cam.matrixWorldInverse)
      const behind = v.z > 0
      const nd = this.tmpV.copy(target).project(cam)
      let x = nd.x
      let y = nd.y
      if (behind) {
        x = v.x >= 0 ? 2 : -2
        y = 0
      }
      h.waypoint = { x: x * 0.5 + 0.5, y: -y * 0.5 + 0.5, behind, dist, label: POI_NAMES[obj.target] }
    }
  }

  // ---- visuals ------------------------------------------------------------------------------
  private ventPhaseBefore = false

  private updateVisuals(dt: number): void {
    const playing = this.mode === 'playing' || this.mode === 'paused' || this.mode === 'title' || this.mode === 'opening'
    const P = this.progress
    if (this.mode !== 'teaser') {
      const targetAct = P.stabilized ? 1 : nodeCount(P) * 0.28
      this.view.act += (targetAct - this.view.act) * Math.min(1, dt * 0.9)
      if (Math.abs(targetAct - this.view.act) < 0.002) this.view.act = targetAct
      this.view.vit = P.vitality
      this.view.nodes = [...P.nodes] as [boolean, boolean, boolean]
      this.view.hold = this.holdProgress
      if (this.mode !== 'playing' && this.mode !== 'paused') this.view.pulse = 0
    }
    if (playing || this.mode === 'teaser') {
      /* continue */
    }
    const v = this.view
    U.uVit.value = v.vit
    U.uAct.value = v.act
    U.uPulse.value = v.pulse
    this.water.update(v.vit, this.hf)
    for (let i = 0; i < 3; i += 1) this.props.setNodeVisual(i, v.nodes[i], this.mode !== 'title')
    const body = this.explorer.root.position
    const camPos = this.camRig.camera.position
    const res = this.props.update(dt, this.time, v.act, v.hold, body, camPos)
    if (res.fired) this.audio.ventFire(Math.min(1, camPos.distanceTo(body) / 70))
    if (res.hit && this.mode === 'playing') {
      let nearest = this.props.vents[0]
      for (const vt of this.props.vents) if (vt.pos.distanceTo(body) < nearest.pos.distanceTo(body)) nearest = vt
      this.damage(nearest.pos)
    }
    // Telegraph sound for vents close to the explorer.
    let charging = false
    for (const vt of this.props.vents) {
      if (vt.pos.distanceTo(body) < 34 && this.props.ventPhase(vt, this.time).charge > 0.02) charging = true
    }
    if (charging && !this.ventPhaseBefore && (this.mode === 'playing' || this.mode === 'teaser')) this.audio.ventCharge()
    this.ventPhaseBefore = charging
    this.creatures.update(dt, this.time, v.vit, body, this.explorer.speedH)
    this.biota.update(dt, camPos, v.vit)
    this.successionModel?.update(this.time, P.eco.stage, v.vit)
    this.ecoClock += dt
    if (this.ecoClock > 0.25) {
      this.ecoClock = 0
      this.eco.apply(v.vit)
    }
    this.atmosphere.update(dt, this.time, camPos, v.vit, v.act, P.stabilized || (this.mode === 'teaser' && v.act >= 1), this.renderer.gl.domElement.height)
    this.explorer.animate(dt, this.time)
    for (const r of this.ripples) {
      if (!r.active) continue
      r.t += dt
      const k = r.t / r.dur
      if (k >= 1) {
        r.active = false
        r.mesh.visible = false
        continue
      }
      const s = r.max * (1 - Math.pow(1 - k, 3)) + 0.2
      r.mesh.scale.set(s, s, s)
      if (!r.flat) r.mesh.lookAt(camPos)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9
    }
    this.flash = Math.max(0, this.flash - dt * 1.1)
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8)
    this.hud.flash = this.flash
    this.hud.hurt = this.hurtFlash
    this.hud.integrity = this.integrity

    this.ambClock -= dt
    if (this.ambClock <= 0) {
      this.ambClock = 0.25
      const wind = Math.min(1, U.uWind.value.length() / 1.8)
      const ch = this.hf.channelDistance(body.x, body.z).d
      const lakeD = Math.hypot(body.x - POI.basin.x, body.z - POI.basin.z)
      const water = Math.max(smooth(0.03, 0.15, v.vit) * (1 - smooth(4, 38, ch)), smooth(0.1, 0.3, v.vit) * (1 - smooth(22, 70, lakeD)))
      this.audio.setAmbience({ wind, vit: v.vit, core: this.props.coreProximity(body), act: v.act, water, tension: this.mode === 'playing' && this.regionNow === 'crystal' ? 1 : 0 })
    }
  }

  // ---- camera + draw --------------------------------------------------------------------------
  private readonly surveyMove = new THREE.Vector3()
  /** Test hook only: places the camera relative to the explorer for close-up inspection. */
  debugCam: { dist: number; side: number; up: number; look: number; fov?: number } | null = null

  private updateCameraAndDraw(dt: number): void {
    const playingNow = this.mode === 'playing' && !this.journalOpen
    const look = this.input.takeLook()
    if (!playingNow) {
      look.x = 0
      look.y = 0
    }
    const rp = this.explorer.root.position
    const focus = this.tmpV.set(rp.x, rp.y + 0.55, rp.z)
    this.surveyMove.set(this.input.move.x, this.input.move.y, (this.input.held('jump') ? 1 : 0) - (this.input.held('descend') ? 1 : 0))
    this.camRig.update(dt, focus, look, { scanning: this.scanMode && playingNow, move: this.surveyMove, fast: this.input.held('sprint'), time: this.time })
    const cam = this.camRig.camera
    if (this.debugCam) {
      const d = this.debugCam
      const fx = -Math.sin(this.explorer.yaw)
      const fz = -Math.cos(this.explorer.yaw)
      cam.position.set(rp.x + fx * d.dist - fz * d.side, rp.y - this.explorer.feetOffset + d.up, rp.z + fz * d.dist + fx * d.side)
      cam.lookAt(rp.x, rp.y - this.explorer.feetOffset + d.look, rp.z)
      cam.fov = d.fov ?? cam.fov
      cam.updateProjectionMatrix()
    }
    this.sky.mesh.position.copy(cam.position)
    this.fill.position.copy(cam.position)
    this.fill.target.position.copy(cam.position).add(cam.getWorldDirection(this.tmpDir).multiplyScalar(12))
    this.lighting.update(this.time, this.view.vit, this.view.act, rp, dt)
    const orbitPhase = (this.mode === 'opening' || this.mode === 'teaser') && this.cineOut.phase === 'orbit'
    if (orbitPhase) {
      const o = this.cineOut.orbit
      const w = this.renderer.canvas.clientWidth || window.innerWidth
      const h = this.renderer.canvas.clientHeight || window.innerHeight
      this.orbit.setAspect(w / h)
      this.orbit.pose(this.time, o.distance, o.swing, o.lift, o.aim)
      this.orbit.setHeal(o.heal)
      this.renderer.render(this.orbit.scene, this.orbit.camera)
    } else {
      this.renderer.render(this.scene, cam)
    }
    if (this.captureWanted) {
      const cb = this.captureWanted
      this.captureWanted = null
      cb(this.renderer.canvas.toDataURL('image/png'))
    }
  }

  // ---- debug / test hooks ---------------------------------------------------------------------
  /** Test hook: put the explorer on the ground at (x, z). */
  /** Rolling frame-time statistics (last 240 frames) for the telemetry overlay and tests. */
  private recordFrame(seconds: number): void {
    const f = this.perf
    f.frames += 1
    f.samples.push(seconds * 1000)
    if (f.samples.length > 240) f.samples.shift()
    if (f.frames % 20 === 0) {
      const sorted = [...f.samples].sort((a, b) => a - b)
      f.avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
      f.p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
      f.max = sorted[sorted.length - 1] ?? 0
    }
  }
  /** Telemetry snapshot: frame times, renderer counters and V2 LOD/cull state. */
  telemetry(): Record<string, unknown> {
    const info = this.renderer.gl.info
    const v2 = this.biota?.v2
    return {
      fps: this.perf.avg > 0 ? +(1000 / this.perf.avg).toFixed(1) : 0, frameMsAvg: +this.perf.avg.toFixed(2), frameMsP95: +this.perf.p95.toFixed(2), frameMsMax: +this.perf.max.toFixed(2),
      drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      v2Instances: v2?.stats.instances ?? 0, v2Chunks: v2?.stats.chunks ?? 0, v2ChunksHi: v2?.visibleHi ?? 0, v2ChunksLo: v2?.visibleLo ?? 0,
      quality: this.store.data.settings.quality,
    }
  }
  /** Test hook: jump the ecological state machine to a state and (optionally) settle the world to it instantly. */
  debugSetEco(stage: 0 | 1 | 2 | 3, instant = true): void {
    const P = this.progress
    if (stage > 0) {
      P.stabilized = true
      P.nodes = [true, true, true]
      for (let i = 0; i < 3; i += 1) this.props.setNodeVisual(i, true, false)
    }
    P.eco.stage = stage
    P.eco.lastEvent = Math.max(P.eco.lastEvent, stage)
    if (instant) P.vitality = ECO_STAGES[stage].vit
    this.view.vit = P.vitality
    this.view.act = P.stabilized ? 1 : this.view.act
    this.eco.apply(P.vitality, true)
  }
  debugEcoSnapshot(x: number, z: number): Record<string, unknown> {
    const t = this.eco.sample(x, z)
    return { stage: this.progress.eco.stage, lastEvent: this.progress.eco.lastEvent, vit: this.progress.vitality, hash: this.eco.hash(), meanLife: +this.eco.meanLife().toFixed(4), lifecycleShare: this.eco.lifecycleShare().map(v => +v.toFixed(3)), tile: t, restored: this.ecoRestored, log: this.ecoLog }
  }
  /** Test hook: seek the running teaser/transformation film to a time (seconds) and keep it paused there. */
  debugCineSeek(t: number): void {
    this.cineT = t
    this.teaserPaused = true
    // Evaluate the film at exactly t and settle the ecology tile grid to that vitality immediately.
    if (this.teaserKind === 'transform') {
      this.cine.transformation(Math.min(t, TRANSFORM_SECONDS), this.cineOut)
      this.eco.apply(this.cineOut.view?.vit ?? 0, true)
    }
  }
  /** Test hook: change the full-recovery duration so ramp/plateau behaviour can be tested quickly. */
  debugRecoverySeconds(s: number): void {
    ;(CONFIG.world as { recoverySeconds: number }).recoverySeconds = s
  }
  debugTeleport(x: number, z: number, yaw = 0): void {
    this.explorer.teleport(x, this.hf.heightAt(x, z), z, yaw)
    this.lastSafe.set(x, this.hf.heightAt(x, z), z)
    this.camRig.snapBehind(yaw)
  }

  debugState(): Record<string, unknown> {
    const p = this.explorer.root.position
    return {
      mode: this.mode, stage: this.progress.stage, pos: [p.x, p.y, p.z], vit: this.progress.vitality, act: this.view.act, nodes: this.progress.nodes,
      shards: this.progress.shards, shardsFound: this.progress.shardsFound.length, discoveries: Object.keys(this.progress.discoveries), stabilized: this.progress.stabilized,
      eco: this.progress.eco, ecoHash: this.eco?.hash(), integrity: this.integrity, scanMode: this.scanMode, lock: this.lock?.s.key ?? null, region: this.regionNow, count: DISCOVERIES.length, vent: VENT_RADIUS,
    }
  }

  get props_(): Props {
    return this.props
  }
  get scannableList(): Scannable[] {
    return this.scannables
  }
  get camera(): THREE.PerspectiveCamera {
    return this.camRig.camera
  }
  get explorerPos(): THREE.Vector3 {
    return this.explorer.root.position
  }
  debugAim(target: THREE.Vector3): void {
    const p = this.explorer.root.position
    const dx = target.x - p.x
    const dz = target.z - p.z
    this.camRig.yaw = Math.atan2(-dx, -dz)
    const dy = target.y - (p.y + 0.6)
    this.camRig.pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.45, 1.2)
  }
}
