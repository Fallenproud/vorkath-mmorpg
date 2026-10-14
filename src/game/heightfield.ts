import { CELL, CHANNEL_POINTS, POI, SCARS, WORLD_HALF, type V2 } from './layout'
import { clamp, fbm, lerp, smooth } from '../engine/noise'

export const GRID = (WORLD_HALF * 2) / CELL + 1

function distSeg(px: number, pz: number, a: V2, b: V2): { d: number; t: number } {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const t = clamp(((px - a.x) * abx + (pz - a.z) * abz) / (abx * abx + abz * abz), 0, 1)
  return { d: Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t)), t }
}

const gauss = (d: number, s: number) => Math.exp(-((d / s) ** 2))

/** Natural terrain before pads, scars and the channel are applied. */
function natural(x: number, z: number): number {
  let h = 2.6 + 2.4 * fbm(x * 0.011 + 10, z * 0.011 + 3, 3) + 0.8 * fbm(x * 0.07, z * 0.07, 3, 7)
  // Life-Core plateau (north-west) gives the spring a believable downhill run to the basin.
  h += 11 * gauss(Math.hypot(x - POI.core.x, z - POI.core.z), 78)
  // Fractured Ridge massif.
  const r = distSeg(x, z, { x: -152, z: -52 }, { x: -96, z: 118 })
  const taper = smooth(0, 0.14, r.t) * smooth(1, 0.8, r.t)
  h += 33 * gauss(r.d, 36) * (0.78 + 0.44 * fbm(x * 0.03, z * 0.03, 3, 3)) * (0.35 + 0.65 * taper)
  // Recovery Basin depression with a soft rim.
  const rb = Math.hypot(x - POI.basin.x, z - POI.basin.z)
  h -= 12.5 * gauss(rb, 40)
  h += 3 * gauss(rb - 50, 9)
  // Observation plateau.
  const ro = Math.hypot(x - POI.observation.x, z - POI.observation.z)
  h += 21 * smooth(66, 24, ro)
  // Crystal Formation Field bowl.
  const rc = Math.hypot(x - POI.crystal.x, z - POI.crystal.z)
  h -= 3.2 * gauss(rc, 24)
  // Life-Core crater: shallow bowl, raised rim and a mound under the exposed structure.
  const rk = Math.hypot(x - POI.core.x, z - POI.core.z)
  h -= 3.2 * gauss(rk, 15)
  h += 1.3 * gauss(rk - 19, 4.5)
  h += 1.5 * gauss(rk, 4.2)
  // Frontier walls: unclimbable mountains keep the player inside the region.
  const m = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF
  h += 70 * smooth(0.7, 0.97, m) * (0.8 + 0.5 * fbm(x * 0.05, z * 0.05, 3, 11))
  return h
}

export type ChannelSample = { x: number; z: number; bed: number; s: number }

export class HeightField {
  readonly data = new Float32Array(GRID * GRID)
  readonly channel: ChannelSample[] = []
  /** Surface height of the dry basin floor and the resting level of the lake after recovery. */
  waterMin = 0
  waterMax = 0
  readonly ledgeHeight: number

  constructor() {
    // Arrival and viewpoint pads are flattened toward a target height computed from the natural terrain.
    const arrivalH = 2.4
    const ridgeBase = this.pre(POI.ridge.x, POI.ridge.z)
    this.ledgeHeight = ridgeBase - 1.2
    const obsFlat = natural(POI.observation.x, POI.observation.z)

    // Monotonic channel bed (water must flow downhill, so the carved bed never rises downstream).
    const pts = CHANNEL_POINTS
    let s = 0
    let prev = Infinity
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]
      const b = pts[i + 1]
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const steps = Math.ceil(len / 2)
      for (let k = 0; k < steps; k += 1) {
        const t = k / steps
        const x = lerp(a.x, b.x, t)
        const z = lerp(a.z, b.z, t)
        const bed = Math.min(prev - 0.025, this.pre(x, z) - 1.6)
        prev = bed
        this.channel.push({ x, z, bed, s: s + len * t })
      }
      s += len
    }
    // Smooth the bed a little while preserving monotonic descent.
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < this.channel.length - 1; i += 1) {
        this.channel[i].bed = (this.channel[i - 1].bed + this.channel[i].bed * 2 + this.channel[i + 1].bed) / 4
      }
      for (let i = 1; i < this.channel.length; i += 1) this.channel[i].bed = Math.min(this.channel[i].bed, this.channel[i - 1].bed - 0.01)
    }

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const x = -WORLD_HALF + i * CELL
        const z = -WORLD_HALF + j * CELL
        this.data[j * GRID + i] = this.finalHeight(x, z, arrivalH, obsFlat)
      }
    }
    // Basin floor and lake level derive from the finished terrain.
    this.waterMin = this.heightAt(POI.basin.x + 4, POI.basin.z + 4) - 0.2
    this.waterMax = this.waterMin + 1.9
  }

  /** Terrain with scars but without pads/channel (used to place those features). */
  private pre(x: number, z: number): number {
    let h = natural(x, z)
    h -= this.scarDepth(x, z)
    return h
  }

  private scarDepth(x: number, z: number): number {
    let depth = 0
    for (const s of SCARS) {
      const r = distSeg(x, z, s.a, s.b)
      const along = smooth(0, 0.18, r.t) * smooth(1, 0.82, r.t)
      // Ragged edge so the fracture reads as broken rock, not a smooth trench.
      const ragged = 0.75 + 0.5 * fbm(x * 0.2, z * 0.2, 2, 21)
      depth += s.depth * along * ragged * gauss(r.d, s.sigma)
    }
    return depth
  }

  private finalHeight(x: number, z: number, arrivalH: number, _obsFlat: number): number {
    let h = this.pre(x, z)
    const da = Math.hypot(x - POI.arrival.x, z - POI.arrival.z)
    h = lerp(h, arrivalH + 0.15 * fbm(x * 0.2, z * 0.2, 2), smooth(34, 14, da))
    const dr = Math.hypot(x - POI.ridge.x, z - POI.ridge.z)
    h = lerp(h, this.ledgeHeight + 0.2 * fbm(x * 0.3, z * 0.3, 2), smooth(15, 7, dr))
    // Carve the dormant conduit channel.
    let best = Infinity
    let bi = 0
    for (let i = 0; i < this.channel.length; i += 1) {
      const c = this.channel[i]
      const d = (c.x - x) ** 2 + (c.z - z) ** 2
      if (d < best) {
        best = d
        bi = i
      }
    }
    const dc = Math.sqrt(best)
    const mask = Math.exp(-((dc / 4.6) ** 2))
    const last = bi === this.channel.length - 1
    // Past the end of the channel the bed merges into the basin floor (no extra carving).
    const bedH = this.channel[bi].bed + dc * dc * 0.09
    h = lerp(h, Math.min(h, bedH), mask * (last ? 0.5 : 1))
    return h
  }

  /** Bilinear height. Outside the grid clamps to the border. */
  heightAt(x: number, z: number): number {
    const fx = clamp((x + WORLD_HALF) / CELL, 0, GRID - 1.001)
    const fz = clamp((z + WORLD_HALF) / CELL, 0, GRID - 1.001)
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const tx = fx - i
    const tz = fz - j
    const a = this.data[j * GRID + i]
    const b = this.data[j * GRID + i + 1]
    const c = this.data[(j + 1) * GRID + i]
    const d = this.data[(j + 1) * GRID + i + 1]
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
  }

  /** Slope in degrees from central differences. */
  slopeAt(x: number, z: number): number {
    const e = 1.2
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e)
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e)
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
  }

  /** Distance to the nearest channel sample and that sample's index. */
  channelDistance(x: number, z: number): { d: number; i: number } {
    let best = Infinity
    let bi = 0
    for (let i = 0; i < this.channel.length; i += 1) {
      const c = this.channel[i]
      const d = (c.x - x) ** 2 + (c.z - z) ** 2
      if (d < best) {
        best = d
        bi = i
      }
    }
    return { d: Math.sqrt(best), i: bi }
  }
}

let cached: HeightField | undefined
export function getHeightField(): HeightField {
  cached ??= new HeightField()
  return cached
}
