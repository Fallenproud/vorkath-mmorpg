import * as THREE from 'three'
import { mulberry32 } from '../engine/noise'
import type { HeightField } from './heightfield'
import { POI } from './layout'
import type { Model } from './props'

type Mode = 'graze' | 'wander' | 'flee' | 'drink'

export interface Mossgrazer {
  mesh: THREE.Group
  pos: THREE.Vector3
  yaw: number
  mode: Mode
  timer: number
  target: THREE.Vector3
  speed: number
  phase: number
  scale: number
  home: THREE.Vector3
}

/**
 * Mossgrazers: small herbivores that only appear once the basin has recovered enough to feed
 * them. They graze on pioneer moss, wander between patches, drink at the lake and bolt when the
 * explorer sprints close. Behaviour is a tiny state machine; movement is terrain-following.
 */
export class Creatures {
  readonly group = new THREE.Group()
  readonly list: Mossgrazer[] = []
  /** Minimum vitality at which the first mossgrazers arrive. */
  static readonly ARRIVE = 0.4
  private readonly rnd = mulberry32(404)
  private readonly lengthMetres = 1.45

  constructor(private readonly hf: HeightField, model: Model | undefined, count: number) {
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + 0.8
      const r = 30 + this.rnd() * 14
      const home = new THREE.Vector3(POI.basin.x + Math.cos(a) * r - 6, 0, POI.basin.z + Math.sin(a) * r)
      this.settle(home)
      const holder = new THREE.Group()
      let body: THREE.Object3D
      if (model) {
        const mesh = new THREE.Mesh(model.geometry, model.material)
        mesh.scale.setScalar(this.lengthMetres)
        mesh.castShadow = true
        body = mesh
      } else {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), new THREE.MeshStandardMaterial({ color: '#4b3a2a', roughness: 0.9 }))
        m.rotation.x = Math.PI / 2
        m.position.y = 0.35
        body = m
      }
      holder.add(body)
      holder.visible = false
      this.group.add(holder)
      this.list.push({
        mesh: holder, pos: home.clone(), yaw: this.rnd() * 6.28, mode: 'graze', timer: 2 + this.rnd() * 4,
        target: home.clone(), speed: 0, phase: this.rnd() * 6, scale: 0, home,
      })
    }
    this.group.name = 'creatures'
  }

  private settle(p: THREE.Vector3): void {
    // Nudge to dry, gentle ground.
    for (let k = 0; k < 20; k += 1) {
      const y = this.hf.heightAt(p.x, p.z)
      if (y > this.hf.waterMax + 0.5 && this.hf.slopeAt(p.x, p.z) < 18) {
        p.y = y
        return
      }
      p.x += (this.rnd() - 0.5) * 6
      p.z += (this.rnd() - 0.5) * 6
    }
    p.y = this.hf.heightAt(p.x, p.z)
  }

  private pickTarget(c: Mossgrazer): void {
    for (let k = 0; k < 12; k += 1) {
      const a = this.rnd() * Math.PI * 2
      const r = 4 + this.rnd() * 12
      const x = c.pos.x + Math.cos(a) * r
      const z = c.pos.z + Math.sin(a) * r
      // Stay within the basin neighbourhood.
      if (Math.hypot(x - c.home.x, z - c.home.z) > 28) continue
      const y = this.hf.heightAt(x, z)
      if (y < this.hf.waterMax + 0.4 || this.hf.slopeAt(x, z) > 20) continue
      c.target.set(x, y, z)
      return
    }
    c.target.copy(c.home)
  }

  update(dt: number, time: number, vit: number, player: THREE.Vector3, playerSpeed: number): void {
    const arrive = THREE.MathUtils.smoothstep(vit, Creatures.ARRIVE, Creatures.ARRIVE + 0.1)
    for (const c of this.list) {
      c.scale += (arrive - c.scale) * Math.min(1, dt * 1.5)
      c.mesh.visible = c.scale > 0.02
      if (!c.mesh.visible) continue
      const dx = c.pos.x - player.x
      const dz = c.pos.z - player.z
      const dPlayer = Math.hypot(dx, dz)
      const scare = dPlayer < 6 + playerSpeed * 0.7
      if (scare && c.mode !== 'flee') {
        c.mode = 'flee'
        c.timer = 2.2
        const l = dPlayer || 1
        c.target.set(c.pos.x + (dx / l) * 14, 0, c.pos.z + (dz / l) * 14)
        c.target.y = this.hf.heightAt(c.target.x, c.target.z)
      }
      c.timer -= dt
      let want = 0
      if (c.mode === 'graze' || c.mode === 'drink') {
        want = 0
        if (c.timer <= 0) {
          this.pickTarget(c)
          c.mode = 'wander'
          c.timer = 12
        }
      } else if (c.mode === 'wander' || c.mode === 'flee') {
        want = c.mode === 'flee' ? 5.2 : 1.1
        const tx = c.target.x - c.pos.x
        const tz = c.target.z - c.pos.z
        const td = Math.hypot(tx, tz)
        if (td < 0.8 || c.timer <= 0) {
          const nearWater = this.hf.heightAt(c.pos.x, c.pos.z) < this.hf.waterMax + 1.2
          c.mode = nearWater && this.rnd() < 0.6 ? 'drink' : 'graze'
          c.timer = 3 + this.rnd() * 6
          want = 0
        } else {
          const desired = Math.atan2(tx, tz)
          let d = desired - c.yaw
          d = Math.atan2(Math.sin(d), Math.cos(d))
          c.yaw += d * Math.min(1, dt * (c.mode === 'flee' ? 8 : 3))
        }
      }
      c.speed += (want - c.speed) * Math.min(1, dt * 4)
      const nx = c.pos.x + Math.sin(c.yaw) * c.speed * dt
      const nz = c.pos.z + Math.cos(c.yaw) * c.speed * dt
      const ny = this.hf.heightAt(nx, nz)
      if (ny > this.hf.waterMax + 0.25 && this.hf.slopeAt(nx, nz) < 30) {
        c.pos.set(nx, ny, nz)
      } else {
        c.mode = 'graze'
        c.timer = 1.5
        c.speed = 0
      }
      c.phase += dt * c.speed * 5.5
      const walk = Math.min(1, c.speed / 2)
      const headDown = c.mode === 'graze' || c.mode === 'drink' ? 0.2 + 0.05 * Math.sin(time * 2.2 + c.phase) : 0
      c.mesh.position.set(c.pos.x, c.pos.y + Math.abs(Math.sin(c.phase)) * 0.05 * walk, c.pos.z)
      c.mesh.rotation.set(headDown, c.yaw, Math.sin(c.phase) * 0.06 * walk, 'YXZ')
      c.mesh.scale.setScalar(Math.max(0.001, c.scale))
    }
  }

  nearest(p: THREE.Vector3): Mossgrazer | null {
    let best: Mossgrazer | null = null
    let bd = Infinity
    for (const c of this.list) {
      if (c.scale < 0.6) continue
      const d = c.pos.distanceTo(p)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return best
  }
}
