import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../engine/noise'
import { biomeAt, passage, type Biome } from './ecology'
import { growable } from './flora'
import { instanced, type Placement } from './gfx'
import type { HeightField } from './heightfield'
import { POI } from './layout'
import type { Vent } from './props'
import { U } from './uniforms'
import type { Physics } from '../engine/physics'
import type { EcoGrid } from './ecostate'
import { V2Flora, V2_SPECIES, type V2SpeciesId } from './v2flora'
import type { V2Imports } from './v2assets'

/**
 * Biome-dependent vegetation, NEW procedural assets (no plant meshes existed in the reference pack).
 *
 * Species names and the broad idea of each come from the ecological hierarchy board VP-VIS-004 and the
 * Frontier/Living tile atlases (VP-VIS-042..044); the labels were read from the board and their spelling
 * is uncertain. Silhouettes, colours, sizes, habitats and growth order are NEW_PROPOSED and are not canon.
 * Each species is planted only in the biomes listed in SPECIES and starts growing when the succession
 * front (see ecology.ts) has passed that spot by `offset` vitality units.
 */
type V1Id = 'lichen' | 'sedge' | 'fern' | 'mycoid' | 'lobloom' | 'kelp' | 'gasmat'
export type SpeciesId = V1Id | V2SpeciesId

interface SpeciesDef {
  id: SpeciesId
  name: string
  biomes: Biome[]
  count: number
  /** Ecological age at which this species starts to grow. */
  offset: number
  maxSlope: number
  /** If set, the spot must be within this distance of open water (channel or lake rim). */
  nearWater?: number
}

export const SPECIES: SpeciesDef[] = [
  { id: 'lichen', name: 'Lantern Lichen', biomes: ['scarFoothill', 'crystalField', 'conduitHalo', 'basinSoil', 'highlandRidge'], count: 520, offset: 0.07, maxSlope: 30 },
  { id: 'sedge', name: 'Thorn Sedge', biomes: ['basinSoil', 'scarFoothill', 'conduitHalo'], count: 560, offset: 0.17, maxSlope: 26 },
  { id: 'fern', name: 'Glimmer Fern', biomes: ['wetCorridor', 'basinSoil', 'conduitHalo'], count: 340, offset: 0.2, maxSlope: 24, nearWater: 42 },
  { id: 'mycoid', name: 'Mycoid Spire', biomes: ['scarFoothill', 'basinSoil', 'crystalField'], count: 120, offset: 0.34, maxSlope: 22 },
  { id: 'lobloom', name: 'Lobloom Tree', biomes: ['basinSoil', 'wetCorridor', 'conduitHalo'], count: 22, offset: 0.52, maxSlope: 14, nearWater: 60 },
  { id: 'kelp', name: 'Vent Kelp', biomes: ['wetCorridor'], count: 80, offset: 0, maxSlope: 40 },
  { id: 'gasmat', name: 'Gas Plume Mat', biomes: [], count: 0, offset: 0, maxSlope: 99 },
  // V2 props are placed by V2Flora (ecology-weighted tiles); listed here for names only.
  ...V2_SPECIES.map(d => ({ id: d.id as SpeciesId, name: d.name, biomes: [] as Biome[], count: 0, offset: d.offset, maxSlope: 99 })),
]

export interface Specimen {
  species: SpeciesId
  pos: THREE.Vector3
  threshold: number
  height: number
}

type G = THREE.BufferGeometry

/** Colour + glow painter: writes `color` and `aGlow` and strips uv so geometries can be merged. */
export function paint(geo: G, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number, number]): G {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute('uv')
  const p = g.attributes.position
  if (!g.attributes.normal) g.computeVertexNormals()
  const n = g.attributes.normal
  const col = new Float32Array(p.count * 3)
  const glow = new Float32Array(p.count)
  for (let i = 0; i < p.count; i += 1) {
    const [r, gg, b, gl] = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i))
    col[i * 3] = r
    col[i * 3 + 1] = gg
    col[i * 3 + 2] = b
    glow[i] = gl
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
  return g
}

/** Arched ribbon: path from a base point outward and up, tapering; returns an indexed geometry with normals. */
function ribbon(len: number, width: number, segs: number, az: number, arch: number, base = 0.05, twist = 0): G {
  const pos: number[] = []
  const idx: number[] = []
  const dx = Math.cos(az)
  const dz = Math.sin(az)
  for (let i = 0; i <= segs; i += 1) {
    const t = i / segs
    const h = len * Math.sin(t * Math.PI * 0.5 * (1 - arch * 0.3)) * (1 - arch * 0.25 * t)
    const out = base + len * arch * Math.pow(t, 1.6) * 0.9 + len * 0.1 * t
    const w = width * (1 - t * 0.92) * 0.5
    const tw = twist * t
    const sx = -dz * Math.cos(tw)
    const sz = dx * Math.cos(tw)
    const sy = Math.sin(tw)
    const cx = dx * out
    const cz = dz * out
    pos.push(cx - sx * w, h - sy * w, cz - sz * w, cx + sx * w, h + sy * w, cz + sz * w)
    if (i < segs) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function lichenGeo(rnd: () => number): G {
  const parts: G[] = []
  for (let i = 0; i < 6; i += 1) {
    const r = 0.16 + rnd() * 0.26
    const g = new THREE.CircleGeometry(r, 9)
    g.rotateX(-Math.PI / 2)
    const a = rnd() * 6.28
    const d = i === 0 ? 0 : 0.22 + rnd() * 0.4
    const ox = Math.cos(a) * d
    const oz = Math.sin(a) * d
    const p = g.attributes.position
    for (let k = 0; k < p.count; k += 1) {
      const rr = Math.hypot(p.getX(k), p.getZ(k)) / r
      p.setXYZ(k, p.getX(k) * (0.85 + rnd() * 0.3) + ox, 0.012 + (1 - rr) * 0.07, p.getZ(k) * (0.85 + rnd() * 0.3) + oz)
    }
    g.computeVertexNormals()
    const warm = rnd() < 0.5
    parts.push(
      paint(g, (_x, y, _z) => {
        const c = Math.min(1, (y - 0.012) / 0.07)
        return warm
          ? [0.16 + c * 0.8, 0.14 + c * 0.5, 0.03 + c * 0.04, c * c * 0.9]
          : [0.1 + c * 0.35, 0.14 + c * 0.65, 0.05 + c * 0.2, c * c * 0.8]
      }),
    )
  }
  return mergeGeometries(parts)!
}

function sedgeGeo(rnd: () => number): G {
  const parts: G[] = []
  const n = 13
  for (let i = 0; i < n; i += 1) {
    const len = 0.7 + rnd() * 0.75
    const g = ribbon(len, 0.07 + rnd() * 0.03, 4, (i / n) * Math.PI * 2 + rnd() * 0.5, 0.5 + rnd() * 0.55, 0.03, rnd() * 0.8)
    parts.push(paint(g, (_x, y) => {
      const t = Math.min(1, y / len)
      // olive base -> amber -> crimson thorn tip (VP-VIS-032 red/orange scrub)
      const r = 0.07 + t * 0.55
      const gr = 0.12 + (1 - Math.abs(t - 0.4) * 1.6) * 0.1 - t * 0.06
      return [r, Math.max(0.03, gr), 0.04, t > 0.82 ? 0.22 : 0]
    }))
  }
  return mergeGeometries(parts)!
}

function fernGeo(rnd: () => number): G {
  const parts: G[] = []
  const fronds = 8
  for (let f = 0; f < fronds; f += 1) {
    const az = (f / fronds) * Math.PI * 2 + rnd() * 0.4
    const len = 1.0 + rnd() * 0.7
    const arch = 0.65 + rnd() * 0.3
    const segs = 6
    const dx = Math.cos(az)
    const dz = Math.sin(az)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs
      const h = len * Math.sin(t * Math.PI * 0.5 * (1 - arch * 0.3)) * (1 - arch * 0.25 * t)
      const out = 0.05 + len * arch * Math.pow(t, 1.6) * 0.9 + len * 0.1 * t
      pts.push(new THREE.Vector3(dx * out, h, dz * out))
    }
    const side = new THREE.Vector3(-dz, 0, dx)
    const pos: number[] = []
    let v = 0
    for (let i = 0; i < segs; i += 1) {
      const t = i / segs
      const L = (0.05 + 0.17 * Math.sin(Math.min(1, t * 1.15 + 0.1) * Math.PI)) * (len / 1.4)
      for (const sgn of [-1, 1]) {
        const a = pts[i]
        const b = pts[i + 1]
        const tip = a.clone().addScaledVector(side, sgn * L).add(new THREE.Vector3(0, -L * 0.28, 0)).lerp(b, 0.25)
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z)
        v += 3
      }
    }
    // thin midrib
    const rib = ribbon(len, 0.035, segs, az, arch, 0.05)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    // Triangles are (rib, rib, tip): the third vertex of each is the leaflet tip and carries the teal glow.
    const cols = new Float32Array(pos.length)
    const gl = new Float32Array(pos.length / 3)
    for (let i = 0; i < gl.length; i += 1) {
      const tip = i % 3 === 2
      const t = Math.min(1, pos[i * 3 + 1] / len)
      cols[i * 3] = tip ? 0.07 : 0.03 + t * 0.03
      cols[i * 3 + 1] = tip ? 0.62 : 0.2
      cols[i * 3 + 2] = tip ? 0.55 : 0.12
      gl[i] = tip ? 0.55 : 0
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1))
    parts.push(g)
    parts.push(paint(rib, () => [0.03, 0.12, 0.07, 0]))
  }
  return mergeGeometries(parts)!
}

function mycoidGeo(rnd: () => number): G {
  const parts: G[] = []
  const one = (h: number, ox: number, oz: number, capR: number) => {
    const prof: THREE.Vector2[] = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.1, 0),
      new THREE.Vector2(0.075, h * 0.3),
      new THREE.Vector2(0.05, h * 0.75),
      new THREE.Vector2(0.045, h * 0.97),
      new THREE.Vector2(capR * 0.55, h * 1.0),
      new THREE.Vector2(capR, h * 0.96),
      new THREE.Vector2(capR * 0.92, h * 0.9),
      new THREE.Vector2(capR * 0.3, h * 0.92),
      new THREE.Vector2(0.001, h * 0.92),
    ]
    const g = new THREE.LatheGeometry(prof, 10)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i += 1) {
      const wob = 1 + 0.08 * Math.sin(p.getY(i) * 7 + ox * 9)
      p.setXYZ(i, p.getX(i) * wob + ox + Math.sin(p.getY(i) * 1.3) * 0.04, p.getY(i), p.getZ(i) * wob + oz)
    }
    g.computeVertexNormals()
    parts.push(
      paint(g, (x, y, z, _nx, _ny) => {
        const stem = y < h * 0.92
        if (stem) return [0.5 - y / h * 0.15, 0.44 - y / h * 0.15, 0.34 - y / h * 0.1, 0]
        const edge = Math.min(1, Math.hypot(x - ox, z - oz) / capR)
        // dark crimson cap with brighter spore-lit rim
        return [0.28 + edge * 0.5, 0.04 + edge * 0.12, 0.05 + edge * 0.05, edge > 0.8 ? 0.3 : 0.05]
      }),
    )
  }
  one(1.6, 0, 0, 0.42)
  one(1.0, 0.38, 0.12, 0.28)
  one(0.7, -0.3, 0.28, 0.22)
  one(0.5, 0.05, -0.36, 0.17)
  void rnd
  return mergeGeometries(parts)!
}

function lobloomGeo(rnd: () => number): G {
  const parts: G[] = []
  const prof: THREE.Vector2[] = []
  const H = 3.4
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8
    prof.push(new THREE.Vector2((0.42 - 0.26 * t) * (i === 0 ? 1.25 : 1), t * H))
  }
  const trunk = new THREE.LatheGeometry(prof, 9)
  const tp = trunk.attributes.position
  for (let i = 0; i < tp.count; i += 1) {
    const y = tp.getY(i)
    tp.setX(i, tp.getX(i) + Math.sin(y * 1.2) * 0.28)
    tp.setZ(i, tp.getZ(i) + Math.cos(y * 0.85) * 0.2)
  }
  trunk.computeVertexNormals()
  parts.push(paint(trunk, (_x, y, _z) => [0.08 + y * 0.012, 0.045, 0.045, 0]))
  const top = new THREE.Vector3(Math.sin(H * 1.2) * 0.28, H, Math.cos(H * 0.85) * 0.2)
  const lobes = 5
  for (let i = 0; i < lobes; i += 1) {
    const a = (i / lobes) * Math.PI * 2 + rnd() * 0.5
    const r = 1.5 + rnd() * 0.8
    const c = new THREE.Vector3(top.x + Math.cos(a) * r, H + 0.35 + rnd() * 0.9, top.z + Math.sin(a) * r)
    const curve = new THREE.CatmullRomCurve3([top.clone(), top.clone().lerp(c, 0.5).add(new THREE.Vector3(0, 0.35, 0)), c.clone().add(new THREE.Vector3(0, -0.3, 0))])
    const tube = new THREE.TubeGeometry(curve, 6, 0.07, 5, false)
    parts.push(paint(tube, () => [0.07, 0.04, 0.04, 0]))
    const s = 0.8 + rnd() * 0.55
    const lobe = new THREE.SphereGeometry(1, 11, 8)
    lobe.scale(s * 1.15, s * 0.8, s * 1.15)
    lobe.translate(c.x, c.y, c.z)
    parts.push(
      paint(lobe, (_x, _y, _z, _nx, ny) => {
        const under = Math.max(0, -ny)
        // plum-crimson canopy, luminous coral-teal underside
        return [0.2 + under * 0.1, 0.035 + under * 0.8, 0.09 + under * 0.62, under * under * 0.85]
      }),
    )
  }
  return mergeGeometries(parts)!
}

function kelpGeo(rnd: () => number): G {
  const parts: G[] = []
  for (let i = 0; i < 7; i += 1) {
    const len = 1.6 + rnd() * 1.6
    const g = ribbon(len, 0.16, 7, (i / 7) * Math.PI * 2, 0.06 + rnd() * 0.12, 0.02 + rnd() * 0.1, 1.2 + rnd())
    parts.push(
      paint(g, (_x, y) => {
        const t = Math.min(1, y / len)
        return [0.07 + t * 0.4, 0.1 + (1 - t) * 0.04, 0.035, t > 0.85 ? 0.35 : 0.04]
      }),
    )
  }
  return mergeGeometries(parts)!
}

function gasMatGeo(rnd: () => number): G {
  const g = new THREE.RingGeometry(0.28, 1, 16, 3)
  g.rotateX(-Math.PI / 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const r = Math.hypot(x, z)
    const a = Math.atan2(z, x)
    const k = 1 + 0.22 * Math.sin(a * 3 + 1) + 0.12 * Math.sin(a * 7)
    p.setXYZ(i, x * k, 0.03 + (r > 0.9 ? 0 : 0.05) + 0.03 * Math.sin(a * 5 + r * 8), z * k)
  }
  g.computeVertexNormals()
  void rnd
  return paint(g, (x, _y, z) => {
    const r = Math.hypot(x, z)
    const t = Math.min(1, Math.max(0, (r - 0.28) / 0.72))
    // sulphur-yellow crust fading to pale mineral rim, hot orange throat at the inner edge
    return [0.78 - t * 0.12 + (1 - t) * 0.15, 0.66 - t * 0.04 - (1 - t) * 0.12, 0.26 + t * 0.34 - (1 - t) * 0.12, t < 0.2 ? 0.45 : 0]
  })
}

export function bioMaterial(grow: boolean, sway: number, glowK: number, wind = true): THREE.MeshStandardMaterial {
  const base = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.82, side: THREE.DoubleSide })
  const mat = grow ? growable(base, wind ? sway : 0) : base
  const prev = grow ? mat.onBeforeCompile : null
  mat.onBeforeCompile = (s, r) => {
    prev?.(s, r)
    s.uniforms.uTime = U.uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying float vPh;')
      .replace('void main() {', 'void main() {\nvGlow = aGlow;\n#ifdef USE_INSTANCING\nvPh = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.45;\n#else\nvPh = 0.0;\n#endif')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vPh;\nuniform float uTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * ${glowK.toFixed(2)} * (0.75 + 0.25 * sin(uTime * 1.4 + vPh));`)
  }
  mat.customProgramCacheKey = () => `bio-${grow}-${sway}-${glowK}`
  return mat
}

export class Biota {
  readonly group = new THREE.Group()
  readonly specimens: Record<SpeciesId, Specimen[]> = { lichen: [], sedge: [], fern: [], mycoid: [], lobloom: [], kelp: [], gasmat: [], pioneer: [], reed: [], shrub: [], canopy: [], rubble: [], outcrop: [] }
  readonly counts: Record<SpeciesId, number> = { lichen: 0, sedge: 0, fern: 0, mycoid: 0, lobloom: 0, kelp: 0, gasmat: 0, pioneer: 0, reed: 0, shrub: 0, canopy: 0, rubble: 0, outcrop: 0 }

  v2: V2Flora | null = null
  constructor(hf: HeightField, vents: Vent[], density: number, eco?: EcoGrid, v2?: V2Imports | null, level = 1, physics?: Physics) {
    const rnd = mulberry32(4242)
    const geos: Record<V1Id, G> = {
      lichen: lichenGeo(rnd), sedge: sedgeGeo(rnd), fern: fernGeo(rnd), mycoid: mycoidGeo(rnd), lobloom: lobloomGeo(rnd), kelp: kelpGeo(rnd), gasmat: gasMatGeo(rnd),
    }
    const heights: Record<V1Id, number> = { lichen: 0.1, sedge: 1.2, fern: 1.3, mycoid: 1.6, lobloom: 5.2, kelp: 2.6, gasmat: 0.1 }
    const mats: Record<V1Id, THREE.MeshStandardMaterial> = {
      lichen: bioMaterial(true, 0, 1.3), sedge: bioMaterial(true, 0.3, 1.0), fern: bioMaterial(true, 0.3, 1.5), mycoid: bioMaterial(true, 0.06, 1.1),
      lobloom: bioMaterial(true, 0.07, 1.4), kelp: bioMaterial(true, 0.9, 1.0), gasmat: bioMaterial(false, 0, 1.4),
    }
    const cast: Record<V1Id, boolean> = { lichen: false, sedge: false, fern: false, mycoid: true, lobloom: true, kelp: false, gasmat: false }

    const nearWaterDist = (x: number, z: number) => {
      const cd = hf.channelDistance(x, z).d
      const lake = Math.hypot(x - POI.basin.x, z - POI.basin.z)
      return Math.min(cd, Math.abs(lake - 22))
    }

    for (const sp0 of SPECIES) {
      if (sp0.count === 0) continue
      const sp = sp0 as typeof sp0 & { id: V1Id }
      const items: Placement[] = []
      const thr: number[] = []
      const want = Math.max(2, Math.round(sp.count * density))
      let tries = 0
      while (items.length < want && tries < want * 60) {
        tries += 1
        let x: number
        let z: number
        if (sp.id === 'kelp') {
          const a = rnd() * Math.PI * 2
          const r = Math.sqrt(rnd()) * 24
          x = POI.basin.x + Math.cos(a) * r
          z = POI.basin.z + Math.sin(a) * r
        } else {
          const home = rnd() < 0.72 ? POI.basin : POI.core
          const reach = home === POI.basin ? 140 : 80
          const a = rnd() * Math.PI * 2
          const r = Math.sqrt(rnd()) * reach
          x = home.x + Math.cos(a) * r
          z = home.z + Math.sin(a) * r
        }
        if (Math.abs(x) > 205 || Math.abs(z) > 205) continue
        const y = hf.heightAt(x, z)
        if (sp.id === 'kelp') {
          if (y < hf.waterMin + 0.15 || y > hf.waterMax - 0.5) continue
        } else {
          if (y < hf.waterMax + 0.2) continue
          if (hf.slopeAt(x, z) > sp.maxSlope) continue
          if (Math.hypot(x - POI.core.x, z - POI.core.z) < 9) continue
          if (Math.hypot(x - POI.arrival.x, z - POI.arrival.z) < 10) continue
          if (sp.nearWater !== undefined && nearWaterDist(x, z) > sp.nearWater) continue
        }
        const biome = biomeAt(hf, x, z)
        if (!sp.biomes.includes(biome)) continue
        let th: number
        if (sp.id === 'kelp') th = 0.12 + ((y - hf.waterMin) / Math.max(0.5, hf.waterMax - hf.waterMin)) * 0.42 + rnd() * 0.04
        else th = passage(x, z) + sp.offset + rnd() * 0.07
        if (th > 0.93) continue
        const s = sp.id === 'sedge' ? 0.55 + rnd() * 0.4 : sp.id === 'mycoid' ? 0.7 + rnd() * 0.45 : sp.id === 'fern' ? 0.75 + rnd() * 0.4 : 0.75 + rnd() * 0.65
        const tint = new THREE.Color().setHSL(0, 0, 0.75 + rnd() * 0.5)
        items.push({ x, y: y - 0.03, z, scale: sp.id === 'lobloom' ? s * 0.95 : s, rotY: rnd() * 6.28, tiltX: (rnd() - 0.5) * 0.12, tiltZ: (rnd() - 0.5) * 0.12, color: tint })
        thr.push(th)
      }
      if (!items.length) continue
      const mesh = instanced(geos[sp.id], mats[sp.id], items, { cast: cast[sp.id], receive: true })
      mesh.geometry.setAttribute('aThr', new THREE.InstancedBufferAttribute(new Float32Array(thr), 1))
      mesh.name = `biota-${sp.id}`
      this.group.add(mesh)
      this.counts[sp.id] = items.length
      // Scan specimens: earliest-growing individuals within walking range of the basin or the core.
      const order = items.map((it, i) => ({ it, th: thr[i] })).filter(o => Math.min(Math.hypot(o.it.x - POI.basin.x, o.it.z - POI.basin.z), Math.hypot(o.it.x - POI.core.x, o.it.z - POI.core.z)) < 75)
      order.sort((a, b) => a.th - b.th)
      for (const o of order.slice(0, 6)) this.specimens[sp.id].push({ species: sp.id, pos: new THREE.Vector3(o.it.x, o.it.y, o.it.z), threshold: o.th, height: heights[sp.id] * (typeof o.it.scale === 'number' ? o.it.scale : 1) })
    }

    // Gas plume mats: sulphur crust rings around the discharge vents, present from the start (Subsurface Vents 11/12).
    {
      const items: Placement[] = []
      for (const v of vents) {
        const n = 3
        for (let i = 0; i < n; i += 1) {
          const a = rnd() * Math.PI * 2
          const r = i === 0 ? 0 : 2.2 + rnd() * 3
          const x = v.pos.x + Math.cos(a) * r
          const z = v.pos.z + Math.sin(a) * r
          items.push({ x, y: hf.heightAt(x, z) + 0.01, z, scale: 1.1 + rnd() * 1.6, rotY: rnd() * 6.28, color: new THREE.Color().setHSL(0, 0, 0.8 + rnd() * 0.4) })
        }
        this.specimens.gasmat.push({ species: 'gasmat', pos: new THREE.Vector3(v.pos.x, v.pos.y + 0.2, v.pos.z), threshold: 0, height: 0.2 })
      }
      if (items.length) {
        const mesh = instanced(geos.gasmat, mats.gasmat, items, { cast: false, receive: true })
        mesh.name = 'biota-gasmat'
        this.group.add(mesh)
        this.counts.gasmat = items.length
      }
    }
    if (eco && v2) {
      this.v2 = new V2Flora(hf, eco, v2, level, density, physics)
      this.group.add(this.v2.group)
      for (const id of Object.keys(this.v2.specimens) as V2SpeciesId[]) {
        this.counts[id] = this.v2.counts[id]
        this.specimens[id] = this.v2.specimens[id] as unknown as Specimen[]
      }
    }
    this.group.name = 'biota'
  }
  update(dt: number, cam: THREE.Vector3, vit: number): void {
    this.v2?.update(dt, cam, vit)
  }
}
