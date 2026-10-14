import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'

const C = CONFIG.camera

/**
 * Orbit follow camera. Yaw/pitch come from mouse, right stick or touch drag; the boom shortens
 * when level geometry is between the player and the camera so the player never disappears.
 */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(C.fov, 1, 0.1, 500)
  yaw = 0
  pitch = 0.42
  private distance: number = C.distance
  private readonly focus = new THREE.Vector3()
  private shake = 0

  constructor(private readonly physics: Physics, private readonly exclude: RAPIER.Collider) {}

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount)
  }

  /** Snap without smoothing (spawn, respawn). */
  reset(target: THREE.Vector3, yaw = this.yaw): void {
    this.yaw = yaw
    this.focus.copy(target)
    this.distance = C.distance
    this.update(target, { x: 0, y: 0 }, 1, true)
  }

  update(target: THREE.Vector3, look: { x: number; y: number }, frameSeconds: number, snap = false, reducedMotion = false): void {
    if (this.camera.fov !== C.fov) {
      this.camera.fov = C.fov
      this.camera.updateProjectionMatrix()
    }
    this.yaw -= look.x
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, C.minPitch, C.maxPitch)

    const aim = target.clone().add(new THREE.Vector3(0, C.height * 0.45, 0))
    if (snap) this.focus.copy(aim)
    else {
      // Follow horizontally a bit tighter than vertically so jumps don't bounce the whole view.
      const k = 1 - Math.exp(-C.follow * frameSeconds)
      const kv = 1 - Math.exp(-C.follow * 0.55 * frameSeconds)
      this.focus.x += (aim.x - this.focus.x) * k
      this.focus.z += (aim.z - this.focus.z) * k
      this.focus.y += (aim.y - this.focus.y) * kv
    }

    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    let wanted: number = C.distance
    const hit = this.physics.world.castRay(new RAPIER.Ray(this.focus, dir), C.distance, true, undefined, undefined, this.exclude)
    if (hit) wanted = Math.max(1.2, hit.timeOfImpact - 0.35)
    // Pull in instantly when blocked, ease back out when clear.
    this.distance = wanted < this.distance || snap ? wanted : THREE.MathUtils.damp(this.distance, wanted, 4, frameSeconds)

    this.camera.position.copy(this.focus).addScaledVector(dir, this.distance)
    this.camera.lookAt(this.focus)
    if (this.shake > 0 && !reducedMotion) {
      const s = this.shake * this.shake * 0.35
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s))
    }
    this.shake = Math.max(0, this.shake - frameSeconds * 2.5)
  }
}
