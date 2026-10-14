import * as THREE from 'three'
import type { HeightField } from './heightfield'
import { POI } from './layout'
import type { Props } from './props'
import type { Shot } from './camera'
import { clamp, smooth } from '../engine/noise'

export interface ViewState {
  vit: number
  act: number
  hold: number
  nodes: [boolean, boolean, boolean]
  /** Stabilization shockwave radius in metres (0 = none). */
  pulse: number
}

export interface CineEnv {
  hf: HeightField
  props: Props
  /** Points following the vein from the core to the basin (about 3 m apart). */
  path: THREE.Vector3[]
}

export interface ScriptedExplorer {
  pos: THREE.Vector3
  yaw: number
  speed: number
  reach?: boolean
}

export interface CineOut {
  phase: 'orbit' | 'world'
  orbit: { distance: number; swing: number; lift: number; aim: number; heal: number }
  haze: number
  black: number
  shot: Shot
  caption: { text: string; sub?: string; alpha: number } | null
  view: Partial<ViewState> | null
  explorer: ScriptedExplorer | null
  events: string[]
}

export const OPENING_SECONDS = 20
export const OPENING_HANDOVER = 18.6
export const TEASER_SECONDS = 66

const ease = (x: number) => x * x * (3 - 2 * x)
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1)
const capAlpha = (t: number, a: number, b: number, fade = 0.7) => Math.min(smooth(a, a + fade, t), 1 - smooth(b - fade, b, t))

export function emptyOut(): CineOut {
  return {
    phase: 'world', orbit: { distance: 5, swing: 0, lift: 0, aim: 0, heal: 0 }, haze: 0, black: 0,
    shot: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 }, caption: null, view: null, explorer: null, events: [],
  }
}

function catmull(pts: THREE.Vector3[], u: number, out: THREE.Vector3): THREE.Vector3 {
  const n = pts.length - 1
  const x = clamp(u, 0, 1) * n
  const i = Math.min(n - 1, Math.floor(x))
  const f = x - i
  const p0 = pts[Math.max(0, i - 1)]
  const p1 = pts[i]
  const p2 = pts[i + 1]
  const p3 = pts[Math.min(n, i + 2)]
  const f2 = f * f
  const f3 = f2 * f
  const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f2 + (-a + 3 * b - 3 * cc + d) * f3)
  return out.set(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z))
}

/** Position along a polyline by distance travelled. */
function alongPath(path: THREE.Vector3[], lens: number[], dist: number, out: THREE.Vector3): { yaw: number } {
  const total = lens[lens.length - 1]
  const d = clamp(dist, 0, total)
  let i = 1
  while (i < lens.length - 1 && lens[i] < d) i += 1
  const seg = lens[i] - lens[i - 1] || 1
  const f = (d - lens[i - 1]) / seg
  out.copy(path[i - 1]).lerp(path[i], f)
  const a = path[i - 1]
  const b = path[i]
  return { yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) }
}

export class Cinematics {
  private readonly tmp = new THREE.Vector3()
  private readonly tmp2 = new THREE.Vector3()
  private readonly lens: number[] = []
  private readonly smoothPath: THREE.Vector3[]

  constructor(private readonly env: CineEnv) {
    // Resample the vein to about 6 m spacing so explorer motion stays smooth.
    const p = env.path
    this.smoothPath = []
    for (let i = 0; i < p.length; i += 2) this.smoothPath.push(p[i].clone())
    this.smoothPath.push(p[p.length - 1].clone())
    this.lens.push(0)
    for (let i = 1; i < this.smoothPath.length; i += 1) this.lens.push(this.lens[i - 1] + Math.hypot(this.smoothPath[i].x - this.smoothPath[i - 1].x, this.smoothPath[i].z - this.smoothPath[i - 1].z))
  }

  private g(x: number, z: number): number {
    return this.env.hf.heightAt(x, z)
  }

  /** Slow orbit around the explorer at the Arrival Site, used behind the title menu. */
  title(t: number, out: Shot, anchor: THREE.Vector3): void {
    const a = 0.55 + t * 0.045
    const r = 9.5
    out.pos.set(anchor.x + Math.sin(a) * r, anchor.y + 2.0 + Math.sin(t * 0.2) * 0.35, anchor.z + Math.cos(a) * r)
    out.look.set(anchor.x - Math.sin(a) * 2, anchor.y + 2.2, anchor.z - Math.cos(a) * 2 - 6)
    out.fov = 52
  }

  /** The skippable intro: planet, dive through the cloud deck, descent to the Arrival Site. */
  opening(t: number, out: CineOut, spawn: THREE.Vector3): void {
    out.events.length = 0
    out.view = null
    out.explorer = null
    if (t < 9.7) {
      out.phase = 'orbit'
      const u = ramp(t, 0, 9.5)
      out.orbit.distance = 7.6 - 6.4 * easeOut(u) - 0.1 * ease(ramp(t, 8, 9.6)) * 4
      out.orbit.swing = -0.9 + u * 0.8
      out.orbit.lift = 0.35 - 0.3 * u
      out.orbit.aim = 0.85 * ease(ramp(t, 3, 9))
      out.orbit.heal = 0
      out.haze = ease(ramp(t, 8.3, 9.6))
      out.black = 1 - smooth(0, 1.2, t)
      out.caption = t < 6 ? { text: 'VORATH PRIME', sub: 'A world scarred, a signal still alive', alpha: capAlpha(t, 0.9, 5.8) } : { text: 'THE SCARRED FRONTIER', sub: 'Survey Drop - Day 1', alpha: capAlpha(t, 6.3, 9.4) }
      return
    }
    out.phase = 'world'
    const u = ramp(t, 9.7, OPENING_HANDOVER + 1.2)
    out.haze = 1 - smooth(9.7, 11.6, t)
    out.black = 0
    const gy = spawn.y
    const e = easeOut(u)
    const start = this.tmp.set(spawn.x + 70, gy + 260, spawn.z + 150)
    const endPos = this.tmp2.set(spawn.x + 0.4, gy + 2.7, spawn.z + 8.6)
    out.shot.pos.copy(start).lerp(endPos, e)
    out.shot.pos.x += Math.sin(u * 3.1) * 14 * (1 - u)
    // Look from the far ridge/beacon down to the explorer.
    out.shot.look.set(spawn.x - 6 * (1 - e), gy + 1.6 + 40 * (1 - e) * (1 - e), spawn.z - 70 * (1 - e) - 1 * e)
    out.shot.fov = 62 - 6 * e
    out.caption = t > 12.2 && t < 17.6 ? { text: 'A faint pulse to the north', sub: 'Find the signal. Scan the world with Q.', alpha: capAlpha(t, 12.2, 17.6) } : null
  }

  /** Dedicated live-scene teaser. Drives world state, the explorer and the camera. */
  teaser(t: number, out: CineOut): void {
    const { props } = this.env
    out.events.length = 0
    out.explorer = null
    out.phase = 'world'
    out.haze = 0
    out.black = Math.max(1 - smooth(0, 1.0, t), smooth(TEASER_SECONDS - 1.5, TEASER_SECONDS, t))
    const view: Partial<ViewState> = { vit: 0, act: 0, hold: 0, nodes: [false, false, false], pulse: 0 }
    out.view = view
    const cam = out.shot
    const pylon = props.pylonPos

    // ---- Beat A: planet (0-6.4)
    if (t < 6.4) {
      out.phase = 'orbit'
      const u = ramp(t, 0, 6.4)
      out.orbit.distance = 6.2 - 4.4 * easeOut(u)
      out.orbit.swing = 0.7 - u * 0.9
      out.orbit.lift = -0.1 + 0.2 * u
      out.orbit.aim = 0.6 * ease(ramp(t, 1, 6))
      out.orbit.heal = 0
      out.haze = ease(ramp(t, 5.2, 6.4))
      out.caption = { text: 'VORKATH: VORATH PRIME', sub: 'A prototype vertical slice', alpha: capAlpha(t, 0.8, 5.6) }
      return
    }
    out.haze = 1 - smooth(6.4, 7.6, t)

    // ---- Beat B: barren flyover from the ridge to the crystal field (6.4-15)
    if (t < 15) {
      const u = ramp(t, 6.4, 15)
      const pos = [
        new THREE.Vector3(-125, this.g(-125, 90) + 30, 90),
        new THREE.Vector3(-106, this.g(-106, 38) + 9, 38),
        new THREE.Vector3(-84, this.g(-84, -10) + 11, -10),
        new THREE.Vector3(-70, this.g(-70, -40) + 17, -40),
      ]
      const look = [
        new THREE.Vector3(-98, this.g(-98, 28) + 6, 28),
        new THREE.Vector3(-90, this.g(-90, -10) + 8, -10),
        new THREE.Vector3(-62, this.g(-62, -60) + 6, -60),
        new THREE.Vector3(-58, this.g(-58, -70) + 8, -70),
      ]
      catmull(pos, ease(u * 0.85 + 0.15 * u * u), cam.pos)
      catmull(look, ease(u * 0.85 + 0.15 * u * u), cam.look)
      cam.fov = 58 - 6 * u
      out.caption = { text: 'A world scarred', sub: 'Obsidian, bloodstone and ash', alpha: capAlpha(t, 7.4, 14.2) }
      out.explorer = {
        pos: this.tmp.set(-90, this.g(-90, 62), 62).clone(), yaw: Math.atan2(0.2, -1), speed: 0,
      }
      return
    }

    // ---- Beat C: crystal field orbit with vents (15-24)
    if (t < 24) {
      const u = ramp(t, 15, 24)
      const c = props.spirePos
      const a = 2.2 + u * 1.5
      const r = 21 - 6 * u
      cam.pos.set(c.x + Math.cos(a) * r, this.g(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r) + 3.4 + u * 2, c.z + Math.sin(a) * r)
      cam.look.set(c.x, c.y + 1.5, c.z)
      cam.fov = 52
      const ea = a + Math.PI * 0.62 + u * 0.5
      const ex = c.x + Math.cos(ea) * 12
      const ez = c.z + Math.sin(ea) * 12
      out.explorer = { pos: new THREE.Vector3(ex, this.g(ex, ez), ez), yaw: Math.atan2(-Math.sin(ea + 1.4) , -Math.cos(ea + 1.4)) + 0, speed: 6.4 }
      // Run tangentially (counter-clockwise around the spire).
      const tx = -Math.sin(ea)
      const tz = Math.cos(ea)
      out.explorer.yaw = Math.atan2(-tx, -tz)
      out.caption = { text: 'Beautiful. Unstable. Hostile.', sub: 'Watch the glow before the pulse', alpha: capAlpha(t, 15.8, 23.2) }
      return
    }

    // ---- Beat D: re-seating the Life-Core (24-34)
    if (t < 34) {
      const u = ramp(t, 24, 34)
      const a = 0.6 + u * 1.6
      const r = 30 - 8 * u
      cam.pos.set(pylon.x + Math.cos(a) * r, this.g(pylon.x + Math.cos(a) * r, pylon.z + Math.sin(a) * r) + 7 - 2.5 * u, pylon.z + Math.sin(a) * r)
      cam.look.set(pylon.x, pylon.y + 5.2, pylon.z)
      cam.fov = 54
      const seatAt = [26.6, 28.6, 30.6]
      view.nodes = [t >= seatAt[0], t >= seatAt[1], t >= seatAt[2]]
      view.act = view.nodes.filter(Boolean).length * 0.28
      // Explorer visits each node then faces the core.
      const stand = (i: number) => {
        const n = props.nodes[i].pos
        const dx = n.x - pylon.x
        const dz = n.z - pylon.z
        const l = Math.hypot(dx, dz) || 1
        return new THREE.Vector3(n.x + (dx / l) * 3.4, 0, n.z + (dz / l) * 3.4)
      }
      const stops = [stand(0), stand(1), stand(2), new THREE.Vector3(pylon.x + 2, 0, pylon.z + 13)]
      const times = [24, 26.6, 28.6, 30.6, 32.6]
      const first = stand(0)
      const prev = new THREE.Vector3(pylon.x + 14, 0, pylon.z + 22)
      let from = prev
      let to = first
      let seg = 0
      for (let i = 0; i < stops.length; i += 1) {
        if (t >= times[i]) {
          from = i === 0 ? prev : stops[i - 1]
          to = stops[i]
          seg = i
        }
      }
      const t0 = seg === 0 ? 24 : times[seg - 1]
      const t1 = times[seg]
      void t0
      void t1
      // Phase-by-phase: move to stop i in the 2 s before seatAt[i], then pause for 0.6 s.
      let pos = new THREE.Vector3()
      let moving = false
      let face = 0
      const legs = [
        { s: 24, e: 26.0, a: prev, b: stops[0] },
        { s: 26.6, e: 28.0, a: stops[0], b: stops[1] },
        { s: 28.6, e: 30.0, a: stops[1], b: stops[2] },
        { s: 30.6, e: 32.2, a: stops[2], b: stops[3] },
      ]
      pos = legs[0].a.clone()
      face = Math.atan2(-(legs[0].b.x - legs[0].a.x), -(legs[0].b.z - legs[0].a.z))
      for (const leg of legs) {
        if (t >= leg.s) {
          const k = ramp(t, leg.s, leg.e)
          pos = leg.a.clone().lerp(leg.b, ease(k))
          moving = k > 0 && k < 1
          if (moving) face = Math.atan2(-(leg.b.x - leg.a.x), -(leg.b.z - leg.a.z))
          else face = Math.atan2(-(pylon.x - leg.b.x), -(pylon.z - leg.b.z))
        }
      }
      void from
      void to
      const justSeated = seatAt.some(s => t >= s && t < s + 0.5)
      pos.y = this.g(pos.x, pos.z)
      out.explorer = { pos, yaw: face, speed: moving ? 6.2 : 0, reach: justSeated }
      for (const [i, s] of seatAt.entries()) if (t >= s && t - s < 0.05) out.events.push(`seat${i}`)
      // Stabilize hold at the end.
      view.hold = ramp(t, 32.2, 33.6)
      if (t > 33.6) view.hold = 0
      if (t >= 33.6) {
        view.act = 1
        out.events.push('stabilize')
      }
      out.caption = { text: 'One signal. One chance.', sub: 'Seat the shards. Stabilize the core.', alpha: capAlpha(t, 24.6, 33) }
      return
    }

    // ---- Beat E: the transformation, following the water to the basin (34-54)
    if (t < 54) {
      view.act = 1
      view.nodes = [true, true, true]
      view.vit = ease(ramp(t, 34.4, 55)) * 0.96
      view.pulse = ramp(t, 34, 38.5) * 150
      const dist = ramp(t, 35.5, 54) * this.lens[this.lens.length - 1]
      const ex = this.tmp.set(0, 0, 0)
      const { yaw } = alongPath(this.smoothPath, this.lens, dist, ex)
      const here = ex.clone()
      here.y = this.g(here.x, here.z)
      const walking = t >= 35.5
      out.explorer = { pos: walking ? here : this.explorerAtCore(), yaw: walking ? yaw : Math.atan2(-(pylon.x - 0), 1), speed: walking ? 8.2 : 0 }
      if (!walking) {
        const e = out.explorer
        e.yaw = Math.atan2(-(pylon.x - e.pos.x), -(pylon.z - e.pos.z))
      }
      if (t < 41) {
        // Crater pull-back: the pulse leaves the core and the land answers.
        const k = ramp(t, 34, 41)
        cam.pos.set(pylon.x - 34 + k * 30, pylon.y + 12 + k * 26, pylon.z + 36 + k * 16)
        cam.look.set(pylon.x + 20 + 22 * k, pylon.y + 2, pylon.z + 4 - 4 * k)
        cam.fov = 58
      } else if (t < 49) {
        // Tracking shot beside the runner.
        const k = ramp(t, 41, 49)
        const side = Math.sin(yaw)
        const fwd = Math.cos(yaw)
        cam.pos.set(here.x + fwd * 8.5 + side * 0, here.y + 2.4 + k * 1.5, here.z - side * 8.5 + fwd * 0)
        cam.pos.set(here.x + Math.cos(yaw) * 9 - Math.sin(yaw) * 3 * (1 - k), here.y + 2.6, here.z - Math.sin(yaw) * 9 - Math.cos(yaw) * 3 * (1 - k))
        cam.look.set(here.x, here.y + 1.5, here.z)
        cam.fov = 56
      } else {
        // Crane over the lake: plants, water and light together.
        const k = ramp(t, 49, 54)
        const b = POI.basin
        cam.pos.set(b.x - 52 + k * 14, this.g(b.x - 40, b.z + 50) + 20 + k * 9, b.z + 58 - k * 8)
        cam.look.set(b.x + 4, this.g(b.x, b.z) + 2, b.z - 2)
        cam.fov = 60
      }
      out.caption = t < 48 ? { text: 'The land answers', sub: 'Water first. Then moss, grass and fronds.', alpha: capAlpha(t, 36.6, 47.6) } : { text: 'Recovery has begun', sub: 'Persistent, visible, and yours to explore', alpha: capAlpha(t, 49, 53.6) }
      return
    }

    // ---- Beat F: Observation Point hero shot (54-66)
    const u = ramp(t, 54, TEASER_SECONDS)
    view.act = 1
    view.nodes = [true, true, true]
    view.vit = 1
    const o = POI.observation
    const ex = o.x - 7
    const ez = o.z - 4
    const ey = this.g(ex, ez)
    const faceYaw = Math.atan2(-(POI.basin.x - ex), -(POI.basin.z - ez))
    out.explorer = { pos: new THREE.Vector3(ex, ey, ez), yaw: faceYaw, speed: 0 }
    // Camera swings from behind-left, around to the front, then pulls back to reveal the basin.
    const a = faceYaw + Math.PI + 0.9 - u * 2.6 * Math.min(1, u * 1.4)
    const r = 4.6 + 22 * ease(ramp(u, 0.55, 1))
    cam.pos.set(ex + Math.sin(a) * r * -1, ey + 1.6 + 8 * ease(ramp(u, 0.55, 1)), ez + Math.cos(a) * r * -1)
    cam.look.set(ex - Math.sin(faceYaw) * 6 * ease(ramp(u, 0.55, 1)), ey + 1.5, ez - Math.cos(faceYaw) * 6 * ease(ramp(u, 0.55, 1)))
    cam.fov = 50 + 8 * u
    out.caption = u < 0.62 ? { text: 'VORKATH: VORATH PRIME', sub: 'Scan. Survive. Restore.', alpha: capAlpha(t, 54.6, 60.2) } : { text: 'Replay from the main menu', sub: 'Prototype vertical slice - procedural and generated placeholder assets', alpha: capAlpha(t, 60.4, 65.4) }
  }

  private explorerAtCore(): THREE.Vector3 {
    const p = this.env.props.pylonPos
    const v = new THREE.Vector3(p.x + 2, 0, p.z + 13)
    v.y = this.g(v.x, v.z)
    return v
  }
}
