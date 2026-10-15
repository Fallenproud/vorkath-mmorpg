import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import { buildExplorerModel } from './character'

const mat = (color: string, rough = 0.5, metal = 0.2, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra })

export interface ExplorerEvents {
  onFootstep?: (speed: number) => void
  onJump?: () => void
  onLand?: (impact: number) => void
}

export interface MoveIntent {
  /** Desired world-space heading (unit-ish vector on XZ) and analog magnitude 0..1. */
  dirX: number
  dirZ: number
  magnitude: number
  sprint: boolean
  walk: boolean
  jumpPressed: boolean
  jumpHeld: boolean
  /** Extra speed multiplier (wading, hazards). */
  speedScale: number
  /** Face this heading when stationary/slow (scanner aiming). */
  faceYaw: number | null
  frozen: boolean
}

/**
 * The player: a procedural articulated explorer in obsidian/graphite practical armour with crimson
 * accents and teal instruments, driven by a Rapier kinematic character controller. Everything is
 * animated procedurally (stride, sway, jump tuck, landing crouch, scanner and reach poses).
 */
export class Explorer {
  readonly root = new THREE.Group()
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  private readonly controller: RAPIER.KinematicCharacterController
  readonly events: ExplorerEvents = {}

  // Simulation state
  velocity = new THREE.Vector3()
  grounded = false
  yaw = 0
  private coyote = 0
  private jumpBuffer = 0
  private prevVy = 0
  private justJumped = 0
  speedH = 0
  readonly feetOffset = CONFIG.player.halfHeight + CONFIG.player.radius

  // Animation state
  private readonly model = new THREE.Group()
  private readonly hips = new THREE.Group()
  private readonly spine = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly thigh: THREE.Group[] = []
  private readonly knee: THREE.Group[] = []
  private readonly arm: THREE.Group[] = []
  private readonly elbow: THREE.Group[] = []
  private readonly scannerScreen: THREE.Mesh
  private readonly visorMat = mat('#2cf0d0', 0.2, 0, { emissive: '#12d8b8', emissiveIntensity: 2.4 })
  private readonly chestMat = mat('#2cf0d0', 0.2, 0, { emissive: '#12d8b8', emissiveIntensity: 1.8 })
  private phase = 0
  private airBlend = 0
  private scanBlend = 0
  private reachTimer = 0
  private landTimer = 0
  private breathe = 0
  private stepSide = 0
  private anim = { scanning: false }

  constructor(private readonly physics: Physics, spawn: THREE.Vector3) {
    const { radius, halfHeight } = CONFIG.player
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + halfHeight + radius + 0.05, spawn.z))
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0), this.body)
    this.controller = physics.world.createCharacterController(0.02)
    this.controller.setUp({ x: 0, y: 1, z: 0 })
    this.controller.enableAutostep(0.4, 0.2, true)
    this.controller.enableSnapToGround(0.45)
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
    this.controller.setMinSlopeSlideAngle((42 * Math.PI) / 180)
    this.controller.setSlideEnabled(true)
    this.controller.setApplyImpulsesToDynamicBodies(false)
    this.scannerScreen = this.buildModel()
    this.model.position.y = -this.feetOffset
    this.model.scale.setScalar(0.975)
    this.root.add(this.model)
    this.root.position.copy(spawn).y += this.feetOffset
    physics.bind(this.body, this.root)
    this.root.name = 'explorer'
  }

  get position(): THREE.Vector3 {
    return this.root.position
  }
  get feetY(): number {
    return this.root.position.y - this.feetOffset
  }
  /** Body translation without render interpolation (for gameplay logic). */
  get simPosition(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y, t.z)
  }

  teleport(x: number, feetY: number, z: number, yaw = this.yaw): void {
    this.body.setTranslation({ x, y: feetY + this.feetOffset + 0.05, z }, true)
    this.body.setNextKinematicTranslation({ x, y: feetY + this.feetOffset + 0.05, z })
    this.physics.snap(this.body)
    this.root.position.set(x, feetY + this.feetOffset + 0.05, z)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw
    this.model.rotation.y = yaw
  }

  setScanning(on: boolean): void {
    this.anim.scanning = on
    this.scannerScreen.visible = true
  }
  reach(): void {
    this.reachTimer = 0.7
  }

  step(dt: number, intent: MoveIntent): void {
    const P = CONFIG.player
    const t = this.body.translation()
    if (intent.frozen) {
      this.velocity.set(0, 0, 0)
      this.speedH = 0
      this.body.setNextKinematicTranslation(t)
      return
    }
    // --- Horizontal velocity toward the desired heading.
    let target = 0
    if (intent.magnitude > 0.05) {
      const base = intent.sprint ? P.sprintSpeed : intent.walk ? P.walkSpeed : P.runSpeed
      // Partial stick tilt walks; full tilt runs.
      const analog = intent.walk || intent.sprint ? 1 : Math.min(1, 0.35 + intent.magnitude * 0.9)
      target = base * (intent.sprint ? 1 : analog) * intent.speedScale
    }
    const tx = intent.dirX * target
    const tz = intent.dirZ * target
    const accel = P.acceleration * (this.grounded ? 1 : P.airControl)
    const dvx = tx - this.velocity.x
    const dvz = tz - this.velocity.z
    const dvl = Math.hypot(dvx, dvz)
    const maxDv = accel * dt * (target === 0 ? 1.4 : 1)
    if (dvl > maxDv) {
      this.velocity.x += (dvx / dvl) * maxDv
      this.velocity.z += (dvz / dvl) * maxDv
    } else {
      this.velocity.x = tx
      this.velocity.z = tz
    }
    this.speedH = Math.hypot(this.velocity.x, this.velocity.z)

    // --- Jump / gravity.
    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt)
    this.jumpBuffer = intent.jumpPressed ? P.jumpBuffer : Math.max(0, this.jumpBuffer - dt)
    this.justJumped = Math.max(0, this.justJumped - dt)
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.justJumped <= 0) {
      this.velocity.y = P.jumpSpeed
      this.coyote = 0
      this.jumpBuffer = 0
      this.justJumped = 0.2
      this.grounded = false
      this.events.onJump?.()
    }
    if (this.grounded && this.velocity.y <= 0) this.velocity.y = -3
    else this.velocity.y += (this.velocity.y > 0 && !intent.jumpHeld ? P.lowJumpGravity : P.gravity) * dt
    this.velocity.y = Math.max(P.maxFall, this.velocity.y)

    // --- Move through the world.
    this.controller.computeColliderMovement(this.collider, { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt })
    const m = this.controller.computedMovement()
    const wasGrounded = this.grounded
    this.grounded = this.controller.computedGrounded()
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z })
    // Blocked by a wall or ceiling: drop the matching velocity component.
    if (Math.abs(m.x - this.velocity.x * dt) > 1e-3 && Math.abs(m.z - this.velocity.z * dt) > 1e-3) {
      this.velocity.x = m.x / dt
      this.velocity.z = m.z / dt
    }
    if (this.velocity.y > 0 && m.y < this.velocity.y * dt * 0.5) this.velocity.y = 0
    if (!wasGrounded && this.grounded && this.prevVy < -5) {
      this.landTimer = Math.min(1, -this.prevVy / 18)
      this.events.onLand?.(-this.prevVy)
    }
    this.prevVy = this.velocity.y

    // --- Facing.
    let wantYaw: number | null = null
    if (intent.faceYaw !== null) wantYaw = intent.faceYaw
    else if (this.speedH > 0.4) wantYaw = Math.atan2(-this.velocity.x, -this.velocity.z)
    if (wantYaw !== null) {
      let d = wantYaw - this.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.yaw += d * Math.min(1, P.turnSpeed * dt)
    }
  }

  /** Render-rate procedural animation. */
  animate(dt: number, time: number): void {
    this.model.rotation.y = this.yaw
    const sp = this.speedH
    const moving = this.grounded && sp > 0.35
    const amp = Math.min(1.25, sp / CONFIG.player.runSpeed) * 0.95
    const prevPhase = this.phase
    if (moving) this.phase += dt * sp * 1.3
    // Footstep at each half-cycle.
    if (moving && Math.floor(this.phase / Math.PI) !== Math.floor(prevPhase / Math.PI)) {
      this.stepSide = 1 - this.stepSide
      this.events.onFootstep?.(sp)
    }
    this.airBlend += ((this.grounded ? 0 : 1) - this.airBlend) * Math.min(1, dt * 14)
    this.scanBlend += ((this.anim.scanning ? 1 : 0) - this.scanBlend) * Math.min(1, dt * 9)
    this.reachTimer = Math.max(0, this.reachTimer - dt)
    this.landTimer = Math.max(0, this.landTimer - dt * 3.2)
    this.breathe += dt * 1.7

    const s = Math.sin(this.phase)
    const c = Math.cos(this.phase)
    const stride = moving ? amp : 0
    const run = Math.min(1, sp / CONFIG.player.sprintSpeed)
    const air = this.airBlend
    const L = 0
    const R = 1
    const swing = (phase: number) => Math.sin(phase) * stride * 0.85
    const lerp = THREE.MathUtils.lerp

    // Legs
    const tuck = air * (this.velocity.y > 0 ? 0.9 : 0.55)
    this.thigh[L].rotation.x = lerp(swing(this.phase), 0.7 * tuck + 0.1, air)
    this.thigh[R].rotation.x = lerp(swing(this.phase + Math.PI), -0.25 * tuck - 0.05, air)
    const bendL = moving ? Math.max(0, Math.cos(this.phase)) * stride * 1.2 + 0.1 * stride : 0
    const bendR = moving ? Math.max(0, -Math.cos(this.phase)) * stride * 1.2 + 0.1 * stride : 0
    this.knee[L].rotation.x = -lerp(bendL, 1.2 * tuck, air) - this.landTimer * 0.9
    this.knee[R].rotation.x = -lerp(bendR, 0.5 * tuck, air) - this.landTimer * 0.9
    this.thigh[L].rotation.x += this.landTimer * 0.5
    this.thigh[R].rotation.x += this.landTimer * 0.5

    // Hips: step bounce, breathing, landing crouch.
    const bob = moving ? Math.abs(Math.cos(this.phase)) * 0.045 * stride : 0
    this.hips.position.y = 1.0 + bob - this.landTimer * 0.2 - (moving ? 0.02 * run : 0)
    this.hips.rotation.y = moving ? s * 0.09 * stride : 0
    this.spine.rotation.x = -0.04 - run * 0.2 - air * 0.06 + this.landTimer * 0.12
    this.spine.rotation.y = moving ? -s * 0.14 * stride : 0
    this.spine.scale.y = 1 + Math.sin(this.breathe) * 0.008
    this.hips.rotation.z = moving ? c * 0.03 * stride : 0

    // Arms
    const aL = -swing(this.phase + Math.PI) * 0.9
    const aR = -swing(this.phase) * 0.9
    this.arm[L].rotation.x = lerp(aL, -0.9, air)
    this.arm[R].rotation.x = lerp(aR, -0.9, air)
    this.arm[L].rotation.z = 0.08 + air * 0.35
    this.arm[R].rotation.z = -0.08 - air * 0.35
    const elbowBase = 0.18 + stride * 0.5
    this.elbow[L].rotation.x = elbowBase + air * 0.4
    this.elbow[R].rotation.x = elbowBase + air * 0.4

    // Scanner pose: right arm raised toward the target, left braced.
    const sb = this.scanBlend
    this.arm[R].rotation.x = lerp(this.arm[R].rotation.x, 1.35 + Math.sin(time * 6) * 0.02, sb)
    this.arm[R].rotation.z = lerp(this.arm[R].rotation.z, -0.12, sb)
    this.elbow[R].rotation.x = lerp(this.elbow[R].rotation.x, 0.5, sb)
    this.arm[L].rotation.x = lerp(this.arm[L].rotation.x, 0.5, sb * 0.7)
    this.elbow[L].rotation.x = lerp(this.elbow[L].rotation.x, 1.0, sb * 0.7)
    // Interact reach (either hand): short forward push.
    if (this.reachTimer > 0) {
      const k = Math.sin((1 - this.reachTimer / 0.7) * Math.PI)
      this.arm[R].rotation.x = lerp(this.arm[R].rotation.x, 1.15, k)
      this.elbow[R].rotation.x = lerp(this.elbow[R].rotation.x, 0.3, k)
      this.spine.rotation.x -= k * 0.12
    }
    // Idle head scan
    this.head.rotation.y = Math.sin(time * 0.6) * 0.08 * (1 - stride) * (1 - sb)
    this.head.rotation.x = -0.02 + Math.sin(time * 0.37) * 0.02 - sb * 0.1
    const glow = 0.5 + 0.5 * Math.sin(time * 3)
    this.visorMat.emissiveIntensity = 0.8 + glow * 0.4 + sb * 0.9
    this.chestMat.emissiveIntensity = 1.4 + glow * 0.6
    ;(this.scannerScreen.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + sb * 2.5 + glow * 0.4
  }

  private buildModel(): THREE.Mesh {
    this.model.add(this.hips)
    this.hips.position.y = 1.0
    for (const side of [-1, 1]) {
      const idx = side < 0 ? 0 : 1
      const thigh = new THREE.Group()
      thigh.position.set(side * 0.1, -0.05, 0)
      this.hips.add(thigh)
      this.thigh[idx] = thigh
      const knee = new THREE.Group()
      knee.position.y = -0.45
      thigh.add(knee)
      this.knee[idx] = knee
    }
    this.hips.add(this.spine)
    this.spine.position.y = 0.1
    this.spine.add(this.head)
    this.head.position.y = 0.565
    for (const side of [-1, 1]) {
      const idx = side < 0 ? 0 : 1
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.29, 0.4, 0)
      this.spine.add(shoulder)
      this.arm[idx] = shoulder
      const elbow = new THREE.Group()
      elbow.position.y = -0.28
      shoulder.add(elbow)
      this.elbow[idx] = elbow
    }
    const screen = buildExplorerModel({
      hips: this.hips, spine: this.spine, head: this.head, thigh: this.thigh, knee: this.knee, arm: this.arm, elbow: this.elbow,
      visorMat: this.visorMat, chestMat: this.chestMat,
    })
    return screen
  }
}
