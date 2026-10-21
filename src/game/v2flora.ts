import * as THREE from 'three'
import { fbm, mulberry32 } from '../engine/noise'
import type { Physics } from '../engine/physics'
import { biomeAt, passage, type Biome } from './ecology'
import type { EcoGrid } from './ecostate'
import { growable } from './flora'
import { instanced, type Placement } from './gfx'
import type { HeightField } from './heightfield'
import { POI } from './layout'
import { triCount, upgradeProp, type PropId, type V2Imports } from './v2assets'
import { U } from './uniforms'
import { enhanceCrystal } from './crystalfx'
/**
 * Ecology-weighted placement of the V2 prototype props (WP-03/WP-04).
 *
 * Every instance is accepted or rejected from the tile data in EcoGrid (slope, soil/nutrient, water
 * availability, land-cover biome) so vegetation follows the terrain rather than being scattered at random.
 * Each prop is rendered at two levels of detail from the SAME placements: the upgraded smooth mesh near the
 * camera and the unmodified imported blockout mesh farther away, with distance culling per spatial chunk.
 * Species names are PROPOSED (not canon). The GLB sources are blockout geometry; the upgraded meshes are
 * procedural refinements of those silhouettes, classified as newly produced assets in the report.
 */
export type V2SpeciesId = 'pioneer' | 'reed' | 'shrub' | 'canopy' | 'rubble' | 'outcrop'
export interface V2Specimen {
  species: V2SpeciesId
  pos: THREE.Vector3
  threshold: number
  height: number
}
interface V2Def {
  id: V2SpeciesId
  name: string
  prop: PropId
  biomes: Biome[]
  count: number
  /** Ecological age (vitality units after the front passes) at which growth starts; 0 for static props. */
  offset: number
  slope: [number, number]
  water?: [number, number]
  nutrient?: number
  scale: [number, number]
  cluster?: { size: number; radius: number }
  /** Minimum distance between cluster centres / individuals. */
  spacing?: number
  grows: boolean
  near: number
  far: number
  height: number
  cast: boolean
  /** Placement search area: sources the succession spreads from, or the whole region. */
  area: 'living' | 'region'
}
export const V2_SPECIES: V2Def[] = [
  { id: 'pioneer', name: 'Pioneer Cushion', prop: 'pioneer', biomes: ['scarFoothill', 'crystalField', 'conduitHalo', 'basinSoil', 'highlandRidge'], count: 420, offset: -0.15, slope: [0, 30], nutrient: 0.1, scale: [1.1, 2.2], cluster: { size: 6, radius: 3.2 }, grows: true, near: 40, far: 95, height: 0.35, cast: false, area: 'living' },
  { id: 'reed', name: 'Marsh Reed', prop: 'reed', biomes: ['wetCorridor', 'basinSoil'], count: 480, offset: 0.2, slope: [0, 14], water: [0.42, 1], scale: [0.9, 1.6], cluster: { size: 8, radius: 2.4 }, grows: true, near: 45, far: 110, height: 2.2, cast: false, area: 'living' },
  { id: 'shrub', name: 'Ember Shrub', prop: 'shrub', biomes: ['basinSoil', 'scarFoothill', 'conduitHalo', 'wetCorridor'], count: 150, offset: 0.3, slope: [0, 24], water: [0.1, 1], nutrient: 0.3, scale: [1, 1.9], grows: true, near: 55, far: 140, height: 1.4, cast: true, area: 'living' },
  { id: 'canopy', name: 'Shelter Tree', prop: 'tree', biomes: ['basinSoil', 'wetCorridor'], count: 14, offset: 0.7, slope: [0, 17], water: [0.22, 1], nutrient: 0.45, scale: [1.6, 2.4], spacing: 11, grows: true, near: 100, far: 240, height: 4.5, cast: true, area: 'living' },
  { id: 'rubble', name: 'Basalt Rubble', prop: 'rock', biomes: ['highlandRidge', 'scarFoothill', 'crystalField', 'conduitHalo', 'basinSoil'], count: 230, offset: 0.25, slope: [4, 42], scale: [0.9, 3.4], grows: false, near: 70, far: 170, height: 1, cast: true, area: 'region' },
  { id: 'outcrop', name: 'Crystal Outcrop', prop: 'crystals', biomes: ['crystalField', 'conduitHalo'], count: 44, offset: 0, slope: [0, 32], scale: [1.0, 2.6], grows: false, near: 80, far: 230, height: 4, cast: true, area: 'region' },
]
type G = THREE.BufferGeometry
/** Re-colour an imported geometry from its own vertex colour, position and normal. Writes `color` and `aGlow`. */
function repaint(src: G, fn: (r: number, g: number, b: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number, number]): G {
  const g = src.index ? src.toNonIndexed() : src.clone()
  g.deleteAttribute('uv')
  if (!g.attributes.normal) g.computeVertexNormals()
  const p = g.attributes.position
  const n = g.attributes.normal
  const c = g.attributes.color
  const col = new Float32Array(p.count * 3)
  const glow = new Float32Array(p.count)
  for (let i = 0; i < p.count; i += 1) {
    const o = fn(c.getX(i), c.getY(i), c.getZ(i), p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i))
    col[i * 3] = o[0]
    col[i * 3 + 1] = o[1]
    col[i * 3 + 2] = o[2]
    glow[i] = o[3]
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
  return g
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const sm = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** Species painters: biome-appropriate palettes layered on the supplied vertex colours (used only as a shading/part mask). */
function painterFor(id: V2SpeciesId): Parameters<typeof repaint>[1] {
  switch (id) {
    case 'rubble':
      return (_r, _g, _b, x, y, z, _nx, ny) => {
        const strata = 0.5 + 0.5 * Math.sin(y * 9 + fbm(x * 3, z * 3, 2, 5) * 4)
        const n = fbm(x * 5 + y * 2, z * 5, 3, 9)
        const v = 0.028 + n * 0.06 + strata * 0.02 + Math.max(0, ny) * 0.012
        return [v * 1.15, v * 0.98, v * 0.9, 0]
      }
    case 'outcrop':
      return (r, g, _b, x, y, z, _nx, ny) => {
        const crystal = g > 0.5 || r < 0.15 && g > 0.4
        if (!crystal) {
          const n = fbm(x * 4, z * 4, 2, 3)
          const v = 0.03 + n * 0.035
          return [v, v * 0.95, v * 0.92, 0]
        }
        const h = sm(0, 3.4, y)
        const v = 0.2 + 0.1 * Math.sin(y * 7 + x * 3 + z * 5) + (ny > 0.4 ? 0.05 : 0)
        return [v * (0.7 + h * 0.3), v * (0.75 + h * 0.25), v * (0.8 + h * 0.2), 0.1 + h * 0.32]
      }
    case 'pioneer':
      return (_r, _g, _b, x, y, z) => {
        const h = sm(0, 0.3, y)
        const n = fbm(x * 10, z * 10, 2, 4)
        const edge = 1 - h
        return [mix(0.5, 0.36, edge) + n * 0.12, mix(0.5, 0.2, edge) + n * 0.1, mix(0.12, 0.1, edge), 0.12 + h * 0.2]
      }
    case 'reed':
      return (_r, _g, _b, x, y, z) => {
        const h = sm(0.1, 2.0, y)
        const n = fbm(x * 8, z * 8, 2, 6)
        return [mix(0.1, 0.52, h) + n * 0.05, mix(0.17, 0.58, h) + n * 0.05, mix(0.06, 0.2, h), 0.04 + h * 0.18]
      }
    case 'shrub':
      return (r, g, _b, x, y, z, _nx, ny) => {
        const woody = r > g
        if (woody) return [0.15, 0.11, 0.09, 0]
        const h = sm(0.1, 1.5, y)
        const n = fbm(x * 6, z * 6 + y * 3, 3, 8)
        return [mix(0.17, 0.4, h) + n * 0.08, mix(0.2, 0.34, h) + n * 0.08, mix(0.08, 0.16, h), 0.05 + h * 0.25 * (ny > 0 ? 1 : 0.5)]
      }
    case 'canopy':
      return (r, g, _b, x, y, z, _nx, ny) => {
        const bark = r > g
        const n = fbm(x * 5, z * 5 + y, 3, 12)
        if (bark) return [0.16 + n * 0.06, 0.12 + n * 0.04, 0.1, 0]
        const h = sm(1.8, 4.6, y)
        return [mix(0.1, 0.24, h) + n * 0.06, mix(0.22, 0.4, h) + n * 0.08, mix(0.1, 0.14, h), (0.1 + (1 - h) * 0.25) * (ny < 0.2 ? 1 : 0.4)]
      }
  }
}
function floraMaterial(def: V2Def): THREE.MeshStandardMaterial {
  const base = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: def.id === 'outcrop' ? 0.28 : 0.85, metalness: def.id === 'outcrop' ? 0.1 : 0, side: THREE.DoubleSide })
  const glowK = def.id === 'outcrop' ? 1.7 : def.id === 'canopy' ? 1.0 : def.id === 'rubble' ? 0 : 1.2
  const mat = def.grows ? growable(base, def.id === 'reed' ? 0.5 : def.id === 'canopy' ? 0.05 : def.id === 'shrub' ? 0.12 : 0) : base
  const prev = def.grows ? mat.onBeforeCompile : null
  const moss = def.id === 'rubble'
  mat.onBeforeCompile = (s, r) => {
    prev?.(s, r)
    s.uniforms.uTime = U.uTime
    s.uniforms.uVit = U.uVit
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying float vPh;\n${moss ? 'attribute float aThr;\nuniform float uVit;\nvarying float vMoss;' : ''}`)
      .replace('void main() {', 'void main() {\nvGlow = aGlow;\n#ifdef USE_INSTANCING\nvPh = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.45;\n#else\nvPh = 0.0;\n#endif')
    if (moss) {
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n{ vec3 wn = normalize(mat3(instanceMatrix) * objectNormal); vMoss = smoothstep(0.0, 0.3, uVit - aThr) * smoothstep(0.2, 0.7, wn.y); }`,
      )
    }
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGlow;\nvarying float vPh;\nuniform float uTime;\n${moss ? 'varying float vMoss;' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * ${glowK.toFixed(2)} * (0.75 + 0.25 * sin(uTime * 1.4 + vPh));`)
    if (moss) {
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.2, 0.06) * (0.7 + 0.6 * fract(vPh * 3.1)), vMoss * 0.9);`)
    }
  }
  mat.customProgramCacheKey = () => `v2-${def.id}`
  if (def.id === 'outcrop') enhanceCrystal(mat, 'outcrop', 0.9)
  return mat
}
interface Chunk {
  hi: THREE.InstancedMesh
  lo: THREE.InstancedMesh
  centre: THREE.Vector3
  radius: number
  def: V2Def
}
const CELL = 64
export interface V2Stats {
  instances: number
  chunks: number
  tris: { id: V2SpeciesId; hi: number; lo: number; instances: number }[]
}
export class V2Flora {
  readonly group = new THREE.Group()
  readonly specimens: Record<V2SpeciesId, V2Specimen[]> = { pioneer: [], reed: [], shrub: [], canopy: [], rubble: [], outcrop: [] }
  readonly counts: Record<V2SpeciesId, number> = { pioneer: 0, reed: 0, shrub: 0, canopy: 0, rubble: 0, outcrop: 0 }
  readonly stats: V2Stats = { instances: 0, chunks: 0, tris: [] }
  private readonly chunks: Chunk[] = []
  private clock = 0
  visibleHi = 0
  /** Growth thresholds of every placed instance (0 = always present), used for per-state counts. */
  readonly thresholds: Record<V2SpeciesId, number[]> = { pioneer: [], reed: [], shrub: [], canopy: [], rubble: [], outcrop: [] }
  /** Number of instances of each species that exist (grown past their threshold) at a vitality. */
  visibleCount(vit: number): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, arr] of Object.entries(this.thresholds)) out[k] = arr.filter(t => t <= vit + 1e-6).length
    return out
  }
  visibleLo = 0
  constructor(hf: HeightField, eco: EcoGrid, v2: V2Imports, level: number, density: number, physics?: Physics) {
    this.group.name = 'v2flora'
    for (const def of V2_SPECIES) {
      const imp = v2.props[def.prop]
      // LOD1 is the supplied blockout (axis-converted/grounded), LOD0 is the upgraded smooth mesh. Both get the same palette.
      const hiGeo = repaint(upgradeProp(def.prop, imp.raw, level), painterFor(def.id))
      const loGeo = repaint(imp.raw, painterFor(def.id))
      imp.report.upgradedTris = triCount(hiGeo)
      const rnd = mulberry32(31337 + def.id.length * 101 + def.count)
      const staticSet = !def.grows
      const want = Math.max(2, Math.round(def.count * (staticSet ? 1 : density)))
      const items: Placement[] = []
      const thr: number[] = []
      const accepted: { x: number; z: number }[] = []
      const ok = (x: number, z: number, strict: boolean): number | null => {
        if (Math.abs(x) > 200 || Math.abs(z) > 200) return null
        const y = hf.heightAt(x, z)
        const wet = def.id === 'reed'
        if (wet ? y < hf.waterMax - 0.35 || y > hf.waterMax + 1.6 : y < hf.waterMax + 0.2) return null
        const sl = hf.slopeAt(x, z)
        if (sl < def.slope[0] || sl > def.slope[1]) return null
        if (Math.hypot(x - POI.core.x, z - POI.core.z) < (def.id === 'outcrop' ? 12 : 9)) return null
        if (Math.hypot(x - POI.arrival.x, z - POI.arrival.z) < 12) return null
        if (!def.biomes.includes(biomeAt(hf, x, z))) return null
        const w = eco.staticWater(x, z)
        if (def.water && (w < def.water[0] || w > def.water[1])) return null
        if (def.nutrient !== undefined && eco.staticNutrient(x, z) < def.nutrient) return null
        if (strict && def.spacing) for (const a of accepted) if (Math.hypot(a.x - x, a.z - z) < def.spacing) return null
        return y
      }
      const place = (x: number, z: number, y: number, thBase: number) => {
        const s = mix(def.scale[0], def.scale[1], rnd())
        const w = eco.staticWater(x, z)
        // Dry ground shrubs read red/purple, wet ground shrubs olive green (VP-VIS-032 scrub palette); outcrops split by land cover.
        let tint: THREE.Color
        if (def.id === 'shrub') tint = w > 0.5 ? new THREE.Color(1, 1.2, 0.9) : rnd() < 0.5 ? new THREE.Color(2.1, 0.5, 0.75) : new THREE.Color(1.2, 0.45, 1.75)
        else if (def.id === 'outcrop') tint = Math.hypot(x - POI.core.x, z - POI.core.z) < 60 ? new THREE.Color(0.25, 1.15, 1.0) : new THREE.Color(1.7, 0.1, 0.14)
        else if (def.id === 'reed') tint = new THREE.Color().setHSL(0.2 + rnd() * 0.06, 0.2, 0.8 + rnd() * 0.5)
        else tint = new THREE.Color().setHSL(0, 0, 0.8 + rnd() * 0.45)
        const sink = def.id === 'rubble' ? 0.25 * s : def.id === 'outcrop' ? 0.12 * s : 0.03
        items.push({ x, y: y - sink, z, scale: s, rotY: rnd() * 6.28, tiltX: (rnd() - 0.5) * (def.id === 'rubble' ? 0.5 : 0.1), tiltZ: (rnd() - 0.5) * (def.id === 'rubble' ? 0.5 : 0.1), color: tint })
        thr.push(thBase + rnd() * 0.05)
        accepted.push({ x, z })
      }
      let tries = 0
      while (items.length < want && tries < want * 140) {
        tries += 1
        let x: number
        let z: number
        if (def.area === 'living') {
          const home = def.id === 'reed' ? POI.basin : rnd() < 0.72 ? POI.basin : POI.core
          const reach = home === POI.basin ? 150 : 90
          const a = rnd() * Math.PI * 2
          const r = Math.sqrt(rnd()) * reach
          x = home.x + Math.cos(a) * r
          z = home.z + Math.sin(a) * r
        } else {
          x = (rnd() - 0.5) * 400
          z = (rnd() - 0.5) * 400
        }
        const y = ok(x, z, true)
        if (y === null) continue
        const thBase = def.grows ? passage(x, z) + def.offset : passage(x, z) + 0.25
        if (thBase > 0.93) continue
        place(x, z, y, thBase)
        if (def.cluster) {
          const n = Math.max(0, Math.round(def.cluster.size * (0.6 + rnd() * 0.8)) - 1)
          for (let k = 0; k < n && items.length < want; k += 1) {
            const a = rnd() * Math.PI * 2
            const r = Math.sqrt(rnd()) * def.cluster.radius
            const cx = x + Math.cos(a) * r
            const cz = z + Math.sin(a) * r
            const cy = ok(cx, cz, false)
            if (cy === null) continue
            place(cx, cz, cy, thBase + rnd() * 0.02)
          }
        }
      }
      this.counts[def.id] = items.length
      if (!items.length) continue
      // Static colliders (first build only; positions are density independent for static props).
      if (physics && staticSet) {
        items.forEach(it => {
          const s = typeof it.scale === 'number' ? it.scale : 1
          if (def.id === 'rubble' && s >= 1.8) physics.addStaticCylinder(new THREE.Vector3(it.x, it.y + 0.5 * s, it.z), 0.62 * s, 1.1 * s)
          if (def.id === 'outcrop' && s >= 1.9) physics.addStaticCylinder(new THREE.Vector3(it.x, it.y + 1.0 * s, it.z), 0.55 * s, 2.0 * s)
        })
      }
      // Spatial chunks, each with an upgraded (hi) and blockout (lo) instanced mesh sharing placements.
      const mat = floraMaterial(def)
      const cells = new Map<string, number[]>()
      items.forEach((it, i) => {
        const key = `${Math.floor(it.x / CELL)},${Math.floor(it.z / CELL)}`
        const l = cells.get(key)
        if (l) l.push(i)
        else cells.set(key, [i])
      })
      for (const idxs of cells.values()) {
        const sub = idxs.map(i => items[i])
        const subThr = new Float32Array(idxs.map(i => thr[i]))
        const make = (geo: G): THREE.InstancedMesh => {
          const g = new THREE.BufferGeometry()
          if (geo.index) g.setIndex(geo.index)
          for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k])
          g.setAttribute('aThr', new THREE.InstancedBufferAttribute(subThr, 1))
          const m = instanced(g, mat, sub, { cast: def.cast, receive: true })
          m.name = `v2-${def.id}`
          return m
        }
        const hi = make(hiGeo)
        const lo = make(loGeo)
        hi.visible = false
        lo.visible = false
        let cx = 0
        let cz = 0
        for (const it of sub) {
          cx += it.x
          cz += it.z
        }
        cx /= sub.length
        cz /= sub.length
        let rad = 0
        for (const it of sub) rad = Math.max(rad, Math.hypot(it.x - cx, it.z - cz))
        this.chunks.push({ hi, lo, centre: new THREE.Vector3(cx, 0, cz), radius: rad + def.height * 2.5, def })
        this.group.add(hi, lo)
      }
      this.stats.instances += items.length
      this.thresholds[def.id] = def.grows ? thr.slice(0, items.length) : items.map(() => 0)
      this.stats.tris.push({ id: def.id, hi: triCount(hiGeo), lo: triCount(loGeo), instances: items.length })
      // Scan specimens: earliest-growing individuals within walking range of the basin or the core.
      const order = items.map((it, i) => ({ it, th: thr[i] })).filter(o => Math.min(Math.hypot(o.it.x - POI.basin.x, o.it.z - POI.basin.z), Math.hypot(o.it.x - POI.core.x, o.it.z - POI.core.z)) < 80)
      order.sort((a, b) => a.th - b.th)
      for (const o of order.slice(0, 8)) this.specimens[def.id].push({ species: def.id, pos: new THREE.Vector3(o.it.x, o.it.y, o.it.z), threshold: def.grows ? o.th : 0, height: def.height * (typeof o.it.scale === 'number' ? o.it.scale : 1) })
    }
    this.stats.chunks = this.chunks.length
  }
  /** Distance-based LOD and culling per chunk; call every frame (cheap, evaluated at ~6 Hz). */
  update(dt: number, cam: THREE.Vector3, vit: number): void {
    this.clock += dt
    if (this.clock < 0.16) return
    this.clock = 0
    let hi = 0
    let lo = 0
    for (const c of this.chunks) {
      const d = Math.hypot(cam.x - c.centre.x, cam.z - c.centre.z) - c.radius
      // Skip chunks whose plants have not started to grow anywhere yet.
      const near = d < c.def.near
      const far = d < c.def.far
      c.hi.visible = near
      c.lo.visible = !near && far
      if (near) hi += 1
      else if (far) lo += 1
    }
    this.visibleHi = hi
    this.visibleLo = lo
    void vit
  }
}
