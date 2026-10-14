import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics, RAPIER } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { FollowCamera } from './camera'
import { Collectibles } from './collectibles'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { Drones } from './drones'
import { Effects } from './fx'
import { Player, type PlayerEvent } from './player'
import { collect, createRun, damage, tick, type RunState } from './rules'
import { World } from './world'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'
export type Hint = 'move' | 'look' | 'jump' | 'dash' | 'cores'
export type Compass = { angle: number; distance: number; rise: number }

export type GameHooks = {
  popup(text: string, screen: { x: number; y: number }, kind: 'score' | 'hurt'): void
  hurt(): void
  hint(hint: Hint | null): void
  /** The first-run tutorial reached its last step. */
  tutorialDone(): void
  end(run: RunState): void
}

/**
 * One playable scene: owns world, physics, player, camera, enemies and the run rules, and
 * translates simulation events into audio, particles and UI hooks. `main.ts` drives it from the
 * fixed-step loop; the UI never reaches inside.
 */
export class Game {
  mode: Mode = 'attract'
  run: RunState
  reducedMotion = false
  private readonly physics: Physics
  private readonly world: World
  private readonly player: Player
  private readonly cam: FollowCamera
  private readonly cores: Collectibles
  private readonly drones: Drones
  private readonly fx = new Effects()
  private simTime = 0
  private time = 0
  private tutorial: Hint | null = null
  private tutorialStart = new THREE.Vector3()
  private readonly down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
  ) {
    this.physics = new Physics(CONFIG.player.gravity)
    this.world = new World(this.physics, renderer.shadowMapSize)
    this.player = new Player(this.physics, this.world.spawn, this.world.movers)
    this.cam = new FollowCamera(this.physics, this.player.collider)
    this.cores = new Collectibles(this.world.coreSpots)
    this.drones = new Drones(this.physics, this.world.droneRoutes)
    this.world.scene.add(this.player.root, this.player.shadowMesh, this.cores.group, this.drones.group, this.fx.mesh)
    this.run = createRun(this.cores.total)
    this.cam.reset(this.world.spawn, 0.6)
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cam.camera
  }

  /** Begin (or restart) a run. `tutorial` shows first-time control hints. */
  start(tutorial: boolean): void {
    tuning.activate('run')
    this.cores.reset()
    this.fx.clear()
    this.player.teleport(this.world.spawn)
    this.player.facing = 0
    this.cam.pitch = 0.42
    this.cam.reset(this.world.spawn, 0)
    this.run = { ...createRun(this.cores.total), unranked: tuning.unranked }
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
    this.tutorial = tutorial ? 'move' : null
    this.tutorialStart.copy(this.world.spawn)
    this.hooks.hint(this.tutorial)
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
  }

  toTitle(): void {
    this.mode = 'attract'
    this.hooks.hint(null)
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const size = this.renderer.shadowMapSize
    const shadow = this.world.sun.shadow
    shadow.map?.dispose()
    shadow.map = null
    shadow.mapSize.set(size, size)
    // Shadow support is compiled into shaders: recompile after toggling shadows at runtime.
    this.world.scene.traverse(obj => {
      const material = (obj as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }

  step(dt: number): void {
    this.simTime += dt
    // Presses are always consumed so a jump pressed in a menu never fires on resume.
    const jumpPressed = this.input.consume('jump')
    const dashPressed = this.input.consume('dash')
    const playing = this.mode === 'playing'
    const rage = playing && this.run.timeLeft <= CONFIG.drones.rageAt

    this.world.stepMovers(this.simTime)
    const events: PlayerEvent[] = []
    if (playing) {
      this.player.step(
        dt,
        {
          moveX: this.input.move.x,
          moveY: this.input.move.y,
          sprint: this.input.held('sprint'),
          jumpPressed,
          jumpHeld: this.input.held('jump'),
          dashPressed,
        },
        this.cam.yaw,
        events,
      )
    }
    this.drones.step(dt, rage)
    this.physics.step(dt)
    if (!playing) return
    this.run.unranked ||= tuning.unranked

    const pos = this.player.position
    for (const e of events) this.onPlayerEvent(e, pos)

    for (const at of this.cores.collect(pos, CONFIG.player.radius + 0.75)) {
      const result = collect(this.run)
      this.run = result.state
      this.audio.play('pickup')
      this.fx.burst(at, '#ffd35c', 26, 7)
      const combo = this.run.combo > 1 ? `  ×${this.run.combo}` : ''
      this.hooks.popup(`+${result.points}${combo}`, this.project(at), 'score')
      if (this.tutorial === 'cores') {
        this.advanceTutorial(null)
        this.hooks.tutorialDone()
      }
    }

    const hitFrom = this.drones.hits(pos, CONFIG.player.radius)[0]
    if (hitFrom) {
      const result = damage(this.run)
      if (result.hurt) {
        this.run = result.state
        this.player.knockback(hitFrom)
        this.onHurt(pos)
      }
    }

    if (pos.y < CONFIG.run.killY) {
      this.run = damage(this.run, true).state
      this.onHurt(pos)
      if (this.run.phase === 'playing') {
        this.player.teleport(this.player.safe)
        this.cam.reset(this.player.safe)
      }
    }

    this.run = tick(this.run, dt)
    this.updateTutorial(pos)
    if (this.run.phase !== 'playing') {
      this.mode = 'ended'
      this.hooks.hint(null)
      this.audio.play(this.run.phase === 'won' ? 'win' : 'lose')
      if (this.run.phase === 'won') this.fx.burst(pos.clone().setY(pos.y + 1), '#7ef9ff', 60, 10)
      this.hooks.end(this.run)
    }
  }

  render(alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    this.physics.sync(alpha)
    const target = this.player.root.position
    if (this.mode === 'attract') {
      // Slow establishing orbit around the archipelago; the title menu sits on the left third.
      const t = this.time * 0.045 + 0.9
      const cam = this.cam.camera
      cam.position.set(Math.sin(t) * 34, 15 + Math.sin(this.time * 0.2) * 1.5, -8 + Math.cos(t) * 34)
      cam.lookAt(Math.sin(t + 1.9) * 6, 3, -8 + Math.cos(t + 1.9) * 6)
    } else {
      const look = this.mode === 'playing' ? this.input.takeLook() : { x: 0, y: 0 }
      if (this.mode === 'playing' && this.tutorial === 'look' && Math.abs(look.x) + Math.abs(look.y) > 0.05) this.advanceTutorial('jump')
      this.cam.update(target, look, frameSeconds, false, this.reducedMotion)
    }
    this.player.animate(frameSeconds, this.time, this.run.invulnerable > 0 && this.mode === 'playing', this.groundBelow(target))
    this.cores.animate(frameSeconds)
    this.drones.animate(frameSeconds, this.mode === 'playing' && this.run.timeLeft <= CONFIG.drones.rageAt)
    this.fx.update(frameSeconds)
    this.world.update(frameSeconds, target)
    this.renderer.render(this.world.scene, this.cam.camera)
  }

  /** Direction to the nearest remaining core relative to the camera (HUD compass). */
  compass(): Compass | null {
    const pos = this.player.root.position
    let best: THREE.Vector3 | undefined
    let bestD = Infinity
    for (const c of this.cores.remaining()) {
      const d = c.distanceToSquared(pos)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    if (!best) return null
    const toCore = Math.atan2(-(best.x - pos.x), -(best.z - pos.z))
    let angle = toCore - this.cam.yaw
    angle = Math.atan2(Math.sin(angle), Math.cos(angle))
    return { angle, distance: Math.sqrt(bestD), rise: best.y - pos.y }
  }

  private onPlayerEvent(e: PlayerEvent, pos: THREE.Vector3): void {
    const feet = pos.clone().setY(pos.y - CONFIG.player.halfHeight - CONFIG.player.radius)
    if (e.type === 'jump') {
      this.audio.play('jump')
      this.fx.puff(feet, 0.3)
      if (this.tutorial === 'jump') this.advanceTutorial('dash')
    } else if (e.type === 'land') {
      this.audio.play('land')
      this.fx.puff(feet, e.impact)
      if (e.impact > 0.5) this.cam.addShake(e.impact * 0.5)
    } else if (e.type === 'dash') {
      this.audio.play('dash')
      this.fx.burst(pos, '#7ef9ff', 10, 3)
      if (this.tutorial === 'dash') this.advanceTutorial('cores')
    }
  }

  private onHurt(pos: THREE.Vector3): void {
    this.audio.play('hurt')
    this.cam.addShake(0.8)
    this.fx.burst(pos, '#ff4d6d', 30, 8)
    this.hooks.hurt()
    this.hooks.popup(`-1`, this.project(pos.clone().setY(pos.y + 1)), 'hurt')
  }

  private updateTutorial(pos: THREE.Vector3): void {
    if (this.tutorial === 'move' && pos.distanceTo(this.tutorialStart) > 2.5) this.advanceTutorial(this.input.method === 'touch' ? 'jump' : 'look')
  }

  private advanceTutorial(next: Hint | null): void {
    this.tutorial = next
    this.hooks.hint(next)
  }

  private groundBelow(p: THREE.Vector3): number | null {
    this.down.origin = { x: p.x, y: p.y, z: p.z }
    const hit = this.physics.world.castRay(this.down, 30, true, undefined, undefined, this.player.collider)
    return hit ? p.y - hit.timeOfImpact : null
  }

  project(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.cam.camera)
    const canvas = this.renderer.canvas
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight }
  }
}
