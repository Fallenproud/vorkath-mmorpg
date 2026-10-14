import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import { clamp } from '../engine/noise'

export interface Shot {
  pos: THREE.Vector3
  look: THREE.Vector3
  fov: number
}

/**
 * One camera, several behaviours blended together:
 *  - follow: cinematic third-person with collision, shoulder offset when scanning
 *  - survey: free-flying photo camera (player frozen)
 *  - shot: scripted cinematic poses (opening, vistas, teaser) that blend in and out smoothly
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  yaw = 0
  pitch = 0.22
  private dist = CONFIG.camera.distance
  private aim = 0
  private readonly followPos = new THREE.Vector3()
  private readonly followLook = new THREE.Vector3()
  private shotBlend = 0
  private shotTarget = 0
  private shotSpeed = 1.2
  private shotFn: ((t: number, out: Shot) => void) | null = null
  private shotTime = 0
  private readonly shotOut: Shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 }
  private shakeAmount = 0
  freeMode = false
  private readonly freePos = new THREE.Vector3()
  private freeYaw = 0
  private freePitch = 0
  private readonly smoothFocus = new THREE.Vector3()
  private initialised = false
  private fovNow = CONFIG.camera.fov
  private readonly tmpDir = new THREE.Vector3()
  private readonly tmpAnchor = new THREE.Vector3()
  private ignore: RAPIER.RigidBody | null = null

  constructor(private readonly physics: Physics, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.1, 2400)
  }

  setIgnoredBody(body: RAPIER.RigidBody): void {
    this.ignore = body
  }

  get shotActive(): boolean {
    return this.shotFn !== null && this.shotTarget > 0
  }
  get blending(): boolean {
    return this.shotBlend > 0.001
  }

  /** Begin a scripted shot. `fn(t)` fills the pose for time `t` seconds since start. */
  playShot(fn: (t: number, out: Shot) => void, blendSeconds = 1.0, instant = false): void {
    this.shotFn = fn
    this.shotTime = 0
    this.shotTarget = 1
    this.shotSpeed = 1 / Math.max(0.01, blendSeconds)
    if (instant) this.shotBlend = 1
  }
  stopShot(blendSeconds = 1.2, instant = false): void {
    this.shotTarget = 0
    this.shotSpeed = 1 / Math.max(0.01, blendSeconds)
    if (instant) {
      this.shotBlend = 0
      this.shotFn = null
    }
  }

  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount)
  }

  snapBehind(yaw: number): void {
    this.yaw = yaw
    this.initialised = false
  }

  enterSurvey(): void {
    this.freeMode = true
    this.freePos.copy(this.camera.position)
    this.freeYaw = this.yaw
    this.freePitch = -this.pitch * 0.5
  }
  exitSurvey(): void {
    this.freeMode = false
  }

  /**
   * @param focus point the follow camera frames (the explorer's upper body)
   * @param look  mouse/stick delta this frame
   * @param opts.move survey-mode flight input (x right, y forward, z up)
   */
  update(dt: number, focus: THREE.Vector3, look: { x: number; y: number }, opts: { scanning: boolean; move: THREE.Vector3; fast: boolean; time: number }): void {
    const C = CONFIG.camera
    if (this.freeMode) {
      this.freeYaw -= look.x
      this.freePitch = clamp(this.freePitch - look.y, -1.45, 1.45)
      const f = this.tmpDir.set(-Math.sin(this.freeYaw) * Math.cos(this.freePitch), Math.sin(this.freePitch), -Math.cos(this.freeYaw) * Math.cos(this.freePitch))
      const right = new THREE.Vector3(Math.cos(this.freeYaw), 0, -Math.sin(this.freeYaw))
      const speed = (opts.fast ? 60 : 18) * dt
      this.freePos.addScaledVector(f, opts.move.y * speed).addScaledVector(right, opts.move.x * speed)
      this.freePos.y += opts.move.z * speed
      this.freePos.y = Math.max(this.freePos.y, -6)
    } else {
      this.yaw -= look.x
      this.pitch = clamp(this.pitch + look.y, C.minPitch, C.maxPitch)
    }
    this.aim += ((opts.scanning ? 1 : 0) - this.aim) * Math.min(1, dt * 7)
    const wantDist = C.distance * (1 - this.aim * 0.4)
    if (!this.initialised) {
      this.smoothFocus.copy(focus)
      this.initialised = true
      this.dist = wantDist
    }
    this.smoothFocus.x = focus.x
    this.smoothFocus.z = focus.z
    this.smoothFocus.y += (focus.y - this.smoothFocus.y) * Math.min(1, dt * C.follow)
    const fx = this.smoothFocus
    const cp = Math.cos(this.pitch)
    const dir = this.tmpDir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp)
    const shoulder = 0.35 + this.aim * 0.55
    const rightX = Math.cos(this.yaw)
    const rightZ = -Math.sin(this.yaw)
    const anchor = this.tmpAnchor.set(fx.x + rightX * shoulder, fx.y + 0.15, fx.z + rightZ * shoulder)
    // Collision: pull the camera in if terrain or props are in the way.
    const ray = new RAPIER.Ray({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: dir.x, y: dir.y, z: dir.z })
    const hit = this.physics.world.castRay(ray, wantDist + 0.4, true, undefined, undefined, undefined, this.ignore ?? undefined)
    const maxD = hit ? Math.max(0.8, hit.timeOfImpact - 0.35) : wantDist
    const goal = maxD < this.dist ? maxD : Math.min(maxD, wantDist)
    this.dist += (goal - this.dist) * Math.min(1, dt * (maxD < this.dist ? 25 : 4))
    this.followPos.copy(anchor).addScaledVector(dir, this.dist)
    this.followLook.set(fx.x + rightX * shoulder * 1.1, fx.y + 0.35 + this.aim * 0.1, fx.z + rightZ * shoulder * 1.1)

    let pos = this.followPos
    let target = this.followLook
    let fov = C.fov - this.aim * 9
    if (this.freeMode) {
      pos = this.freePos
      target = new THREE.Vector3(-Math.sin(this.freeYaw) * Math.cos(this.freePitch), Math.sin(this.freePitch), -Math.cos(this.freeYaw) * Math.cos(this.freePitch)).add(this.freePos)
      fov = C.fov
    }
    const diff = this.shotTarget - this.shotBlend
    this.shotBlend += Math.sign(diff) * Math.min(Math.abs(diff), dt * this.shotSpeed)
    if (this.shotFn && this.shotBlend > 0) {
      this.shotTime += dt
      this.shotFn(this.shotTime, this.shotOut)
      const k = this.shotBlend * this.shotBlend * (3 - 2 * this.shotBlend)
      pos = new THREE.Vector3().copy(pos).lerp(this.shotOut.pos, k)
      target = new THREE.Vector3().copy(target).lerp(this.shotOut.look, k)
      fov = fov + (this.shotOut.fov - fov) * k
    } else if (this.shotBlend <= 0 && this.shotTarget === 0) {
      this.shotFn = null
    }

    this.fovNow += (fov - this.fovNow) * Math.min(1, dt * 8)
    this.camera.position.copy(pos)
    this.camera.lookAt(target)
    if (this.shakeAmount > 0.001) {
      const a = this.shakeAmount
      this.camera.position.x += (Math.sin(opts.time * 71) + Math.sin(opts.time * 43)) * 0.5 * a * 0.12
      this.camera.position.y += Math.sin(opts.time * 59) * a * 0.12
      this.shakeAmount *= Math.exp(-dt * 5)
    }
    if (Math.abs(this.camera.fov - this.fovNow) > 0.01) {
      this.camera.fov = this.fovNow
      this.camera.updateProjectionMatrix()
    }
  }

  /** Horizontal heading that "forward" input moves the explorer toward. */
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
  }
  get rightVec(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
  }
}
