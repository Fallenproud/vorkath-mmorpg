import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import type { DroneRoute } from './world'

type Drone = { root: THREE.Group; body: RAPIER.RigidBody; route: DroneRoute; angle: number; rotor: THREE.Object3D; eye: THREE.Mesh }

/**
 * Patrol drones: kinematic bodies on circular routes. They physically block the player and cost
 * a life on contact (the scene checks `hits()` each step and applies knockback).
 */
export class Drones {
  readonly group = new THREE.Group()
  private drones: Drone[] = []

  constructor(physics: Physics, routes: DroneRoute[]) {
    const shell = new THREE.MeshStandardMaterial({ color: '#3b3656', roughness: 0.35, metalness: 0.4 })
    const trim = new THREE.MeshStandardMaterial({ color: '#ff4d6d', emissive: '#ff2d55', emissiveIntensity: 2.4 })
    for (const route of routes) {
      const root = new THREE.Group()
      const body = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.drones.radius * 0.8, 20, 14), shell)
      body.scale.y = 0.75
      body.castShadow = true
      const band = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.drones.radius * 0.8, 0.06, 8, 32), trim)
      band.rotation.x = Math.PI / 2
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), trim)
      eye.position.set(0, 0, -CONFIG.drones.radius * 0.72)
      const rotor = new THREE.Group()
      for (let i = 0; i < 2; i += 1) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.12), shell)
        blade.rotation.y = (i * Math.PI) / 2
        rotor.add(blade)
      }
      rotor.position.y = CONFIG.drones.radius * 0.72
      root.add(body, band, eye, rotor)
      root.position.copy(this.pointOn(route, route.phase))
      this.group.add(root)
      const rb = physics.addKinematic(root, RAPIER.ColliderDesc.ball(CONFIG.drones.radius * 0.8))
      this.drones.push({ root, body: rb, route, angle: route.phase, rotor, eye })
    }
  }

  private pointOn(route: DroneRoute, angle: number): THREE.Vector3 {
    return new THREE.Vector3(route.center.x + Math.cos(angle) * route.radius, route.center.y + Math.sin(angle * 2) * 0.35, route.center.z + Math.sin(angle) * route.radius)
  }

  step(dt: number, rage: boolean): void {
    const speed = rage ? CONFIG.drones.rageSpeed : CONFIG.drones.speed
    for (const d of this.drones) {
      d.angle += (speed / d.route.radius) * dt * d.route.dir
      d.body.setNextKinematicTranslation(this.pointOn(d.route, d.angle))
    }
  }

  /** Drones touching the player this step (positions, for knockback direction). */
  hits(player: THREE.Vector3, playerRadius: number): THREE.Vector3[] {
    const reach = CONFIG.drones.radius + playerRadius + 0.05
    const out: THREE.Vector3[] = []
    for (const d of this.drones) {
      const t = d.body.translation()
      const p = new THREE.Vector3(t.x, t.y, t.z)
      // The player is a capsule: compare against the nearest point on its segment.
      const dy = THREE.MathUtils.clamp(p.y, player.y - CONFIG.player.halfHeight, player.y + CONFIG.player.halfHeight)
      if (p.distanceTo(new THREE.Vector3(player.x, dy, player.z)) < reach) out.push(p)
    }
    return out
  }

  animate(frameSeconds: number, rage: boolean): void {
    for (const d of this.drones) {
      d.rotor.rotation.y += frameSeconds * 24
      // Face along the route (the eye looks down local -Z).
      d.root.rotation.set(0, d.route.dir > 0 ? Math.PI - d.angle : -d.angle, 0)
      ;(d.eye.material as THREE.MeshStandardMaterial).emissiveIntensity = rage ? 4 : 2.4
    }
  }
}
