import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fbm, mulberry32 } from '../engine/noise'
import crystalsUrl from '../../assets/models/v2/props/VP_PROTOTYPE_CRYSTALS.glb?url'
import pioneerUrl from '../../assets/models/v2/props/VP_PROTOTYPE_PIONEER.glb?url'
import reedUrl from '../../assets/models/v2/props/VP_PROTOTYPE_REED.glb?url'
import rockUrl from '../../assets/models/v2/props/VP_PROTOTYPE_ROCK.glb?url'
import shrubUrl from '../../assets/models/v2/props/VP_PROTOTYPE_SHRUB.glb?url'
import treeUrl from '../../assets/models/v2/props/VP_PROTOTYPE_TREE.glb?url'
import stage1Url from '../../assets/models/v2/stages/VP_STAGE_01.glb?url'
import stage2Url from '../../assets/models/v2/stages/VP_STAGE_02.glb?url'
import stage3Url from '../../assets/models/v2/stages/VP_STAGE_03.glb?url'
import stage4Url from '../../assets/models/v2/stages/VP_STAGE_04.glb?url'
/**
 * Importer for the ten V2 GLB prototypes (WP-03).
 *
 * Measured facts about the supplied files: Z-up (trimesh export), no materials, vertex colours only
 * (COLOR_0, uint8), no normals, no UVs, no rig/LOD/collision. They are blockout geometry. This module
 *  1. merges each file into one Y-up geometry (engine axes, 1 unit = 1 m),
 *  2. validates scale/base/topology and records every issue and fix in an ImportReport,
 *  3. offers `upgrade()` to build a smoother, higher-resolution LOD0 from the blockout silhouette.
 * The untouched import stays available as LOD1 (far distance) so the supplied source is never discarded.
 */
export type PropId = 'crystals' | 'pioneer' | 'reed' | 'rock' | 'shrub' | 'tree'
export const PROP_IDS: PropId[] = ['crystals', 'pioneer', 'reed', 'rock', 'shrub', 'tree']
export const PROP_FILES: Record<PropId, string> = {
  crystals: 'VP_PROTOTYPE_CRYSTALS.glb', pioneer: 'VP_PROTOTYPE_PIONEER.glb', reed: 'VP_PROTOTYPE_REED.glb',
  rock: 'VP_PROTOTYPE_ROCK.glb', shrub: 'VP_PROTOTYPE_SHRUB.glb', tree: 'VP_PROTOTYPE_TREE.glb',
}
const PROP_URLS: Record<PropId, string> = { crystals: crystalsUrl, pioneer: pioneerUrl, reed: reedUrl, rock: rockUrl, shrub: shrubUrl, tree: treeUrl }
const STAGE_URLS = [stage1Url, stage2Url, stage3Url, stage4Url]
export interface ImportReport {
  id: string
  file: string
  meshes: number
  tris: number
  verts: number
  hasColor: boolean
  hasNormals: boolean
  hasUV: boolean
  hasMaterial: boolean
  /** Bounding box after the Z-up to Y-up conversion, in metres. */
  size: [number, number, number]
  minY: number
  issues: string[]
  fixes: string[]
  upgradedTris: number
}
export interface PropImport {
  id: PropId
  /** Merged, Y-up, non-indexed blockout geometry with a `color` attribute (the original source, only axis-converted and grounded). */
  raw: THREE.BufferGeometry
  report: ImportReport
}
const loader = new GLTFLoader()
export interface V2Imports {
  props: Record<PropId, PropImport>
  stages: { group: THREE.Group; report: ImportReport }[]
}
function mergeScene(root: THREE.Object3D): { geo: THREE.BufferGeometry; meshes: number; hasNormals: boolean; hasUV: boolean; hasMaterial: boolean; hasColor: boolean } {
  root.updateMatrixWorld(true)
  const pos: number[] = []
  const col: number[] = []
  let meshes = 0
  let hasNormals = false
  let hasUV = false
  let hasMaterial = false
  let hasColor = true
  const v = new THREE.Vector3()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    meshes += 1
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
    hasNormals = hasNormals || !!m.geometry.attributes.normal
    hasUV = hasUV || !!m.geometry.attributes.uv
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    hasMaterial = hasMaterial || (!!mat && ((mat as THREE.MeshStandardMaterial).map != null))
    const p = g.attributes.position
    const c = g.attributes.color
    if (!c) hasColor = false
    for (let i = 0; i < p.count; i += 1) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
      pos.push(v.x, v.y, v.z)
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i))
      else col.push(0.5, 0.5, 0.5)
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return { geo, meshes, hasNormals, hasUV, hasMaterial, hasColor }
}
/** Convert a trimesh-style Z-up geometry to the engine's Y-up axes (x, y, z) -> (x, z, -y). */
const toYUp = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2)
function inspect(id: string, file: string, geo: THREE.BufferGeometry, info: ReturnType<typeof mergeScene>): ImportReport {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const size = new THREE.Vector3()
  b.getSize(size)
  return {
    id, file, meshes: info.meshes, tris: geo.attributes.position.count / 3, verts: geo.attributes.position.count, hasColor: info.hasColor,
    hasNormals: info.hasNormals, hasUV: info.hasUV, hasMaterial: info.hasMaterial, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
    minY: +b.min.y.toFixed(2), issues: [], fixes: [], upgradedTris: 0,
  }
}
async function importProp(id: PropId): Promise<PropImport> {
  const gltf = await loader.loadAsync(PROP_URLS[id])
  const info = mergeScene(gltf.scene)
  const geo = toYUp(info.geo)
  const report = inspect(id, PROP_FILES[id], geo, info)
  if (!info.hasMaterial && !info.hasNormals) report.issues.push('no materials and no normals: vertex colours only, flat blockout')
  const p = geo.attributes.position
  const minY = report.minY
  if (id === 'tree' && minY > 0.5) {
    // The supplied trunk starts 1.5 m above its origin, so an instanced tree would float. Extend the trunk base to the ground with a root flare.
    report.issues.push(`trunk base floats ${minY} m above the origin`)
    for (let i = 0; i < p.count; i += 1) {
      if (p.getY(i) < minY + 1e-3) p.setXYZ(i, p.getX(i) * 1.7, 0, p.getZ(i) * 1.7)
    }
    report.fixes.push('trunk base extended down to y=0 with a 1.7x root flare')
  } else if (minY > 0.08 && id !== 'crystals') {
    report.issues.push(`geometry sits ${minY} m above the origin`)
    geo.translate(0, -minY, 0)
    report.fixes.push(`translated down ${minY} m so the base touches the ground`)
  }
  geo.computeBoundingBox()
  report.minY = +geo.boundingBox!.min.y.toFixed(2)
  const sz = new THREE.Vector3()
  geo.boundingBox!.getSize(sz)
  report.size = [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)]
  if (sz.y > 8 || sz.x > 8) report.issues.push('unexpectedly large for a prop')
  geo.computeVertexNormals()
  return { id, raw: geo, report }
}
async function importStage(i: number): Promise<{ group: THREE.Group; report: ImportReport }> {
  const gltf = await loader.loadAsync(STAGE_URLS[i])
  const info = mergeScene(gltf.scene)
  const geo = toYUp(info.geo)
  const report = inspect(`stage${i + 1}`, `VP_STAGE_0${i + 1}.glb`, geo, info)
  report.issues.push('14 m x 14 m diorama tile, no materials, vertex colours only')
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }))
  const group = new THREE.Group()
  group.add(mesh)
  group.name = `VP_STAGE_0${i + 1}`
  return { group, report }
}
export async function loadV2(): Promise<V2Imports> {
  const props = {} as Record<PropId, PropImport>
  const list = await Promise.all(PROP_IDS.map(importProp))
  for (const p of list) props[p.id] = p
  const stages = await Promise.all([0, 1, 2, 3].map(importStage))
  return { props, stages }
}
// ----------------------------------------------------------------------------------------------
// Upgrade pipeline: weld -> midpoint subdivision -> volume-preserving smoothing -> deformation
// ----------------------------------------------------------------------------------------------
interface Mesh {
  p: number[]
  c: number[]
  t: number[]
}
function weld(geo: THREE.BufferGeometry): Mesh {
  const pos = geo.attributes.position
  const col = geo.attributes.color
  const map = new Map<string, number>()
  const m: Mesh = { p: [], c: [], t: [] }
  const q = 1e4
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`
    let idx = map.get(key)
    if (idx === undefined) {
      idx = m.p.length / 3
      map.set(key, idx)
      m.p.push(x, y, z)
      m.c.push(col.getX(i), col.getY(i), col.getZ(i))
    }
    m.t.push(idx)
  }
  return m
}
function subdivide(m: Mesh): Mesh {
  const out: Mesh = { p: m.p.slice(), c: m.c.slice(), t: [] }
  const cache = new Map<number, number>()
  const nv = m.p.length / 3
  const mid = (a: number, b: number): number => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = lo * nv + hi
    let id = cache.get(key)
    if (id === undefined) {
      id = out.p.length / 3
      cache.set(key, id)
      for (let k = 0; k < 3; k += 1) {
        out.p.push((m.p[a * 3 + k] + m.p[b * 3 + k]) / 2)
        out.c.push((m.c[a * 3 + k] + m.c[b * 3 + k]) / 2)
      }
    }
    return id
  }
  for (let i = 0; i < m.t.length; i += 3) {
    const a = m.t[i]
    const b = m.t[i + 1]
    const c = m.t[i + 2]
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    out.t.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
  }
  return out
}
function neighbours(m: Mesh): number[][] {
  const n = m.p.length / 3
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
  for (let i = 0; i < m.t.length; i += 3) {
    const a = m.t[i]
    const b = m.t[i + 1]
    const c = m.t[i + 2]
    sets[a].add(b).add(c)
    sets[b].add(a).add(c)
    sets[c].add(a).add(b)
  }
  return sets.map(s => [...s])
}
/** Taubin lambda/mu smoothing: rounds blocky silhouettes without shrinking the volume. `pin` vertices (weight 0) stay fixed. */
function taubin(m: Mesh, iterations: number, pin?: (i: number) => number): void {
  const nb = neighbours(m)
  const n = m.p.length / 3
  const tmp = new Float32Array(m.p.length)
  for (let it = 0; it < iterations * 2; it += 1) {
    const f = it % 2 === 0 ? 0.5 : -0.53
    for (let i = 0; i < n; i += 1) {
      const w = pin ? pin(i) : 1
      const list = nb[i]
      if (!list.length || w <= 0) {
        for (let k = 0; k < 3; k += 1) tmp[i * 3 + k] = m.p[i * 3 + k]
        continue
      }
      for (let k = 0; k < 3; k += 1) {
        let s = 0
        for (const j of list) s += m.p[j * 3 + k]
        s /= list.length
        tmp[i * 3 + k] = m.p[i * 3 + k] + (s - m.p[i * 3 + k]) * f * w
      }
    }
    for (let i = 0; i < tmp.length; i += 1) m.p[i] = tmp[i]
  }
}
function toGeometry(m: Mesh, flat: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.c, 3))
  g.setIndex(m.t)
  const out = flat ? g.toNonIndexed() : g
  out.computeVertexNormals()
  return out
}
export interface UpgradeOpts {
  subdiv: number
  smooth: number
  flat?: boolean
  /** Per-vertex displacement / bend applied after smoothing (positions are modified in place through `p`). */
  deform?: (p: THREE.Vector3, i: number) => void
  /** Smoothing weight per vertex (0 = pinned). Receives the vertex position. */
  pin?: (p: THREE.Vector3) => number
}
export function upgrade(raw: THREE.BufferGeometry, o: UpgradeOpts): THREE.BufferGeometry {
  let m = weld(raw)
  for (let i = 0; i < o.subdiv; i += 1) m = subdivide(m)
  if (o.smooth > 0) {
    const v = new THREE.Vector3()
    taubin(m, o.smooth, o.pin ? i => o.pin!(v.set(m.p[i * 3], m.p[i * 3 + 1], m.p[i * 3 + 2])) : undefined)
  }
  if (o.deform) {
    const v = new THREE.Vector3()
    for (let i = 0; i < m.p.length / 3; i += 1) {
      v.set(m.p[i * 3], m.p[i * 3 + 1], m.p[i * 3 + 2])
      o.deform(v, i)
      m.p[i * 3] = v.x
      m.p[i * 3 + 1] = v.y
      m.p[i * 3 + 2] = v.z
    }
  }
  return toGeometry(m, o.flat ?? false)
}
/** Authored-upgrade recipes per prop. `level` 0..2 is the quality tier (more subdivision on higher tiers). */
export function upgradeProp(id: PropId, raw: THREE.BufferGeometry, level: number): THREE.BufferGeometry {
  const rnd = mulberry32(id.length * 977 + 13)
  const seed = id.length * 31
  switch (id) {
    case 'rock':
      // Boulder: subdivide, round, then break the silhouette with fractal displacement along the radial direction.
      return upgrade(raw, {
        subdiv: 1 + Math.min(1, level), smooth: 1, flat: true,
        deform: p => {
          const r = Math.hypot(p.x, p.y * 1.4, p.z) || 1
          const n = fbm(p.x * 3.6 + p.y * 2.4, p.z * 3.6 + p.y * 2.9, 3, seed) - 0.5
          const k = 1 + n * 0.8
          p.x *= k
          p.z *= k
          p.y = p.y > -0.02 ? p.y * (1 + n * 0.5) : p.y
          p.y += n * 0.04 * (r > 0.1 ? 1 : 0)
        },
      })
    case 'pioneer':
      // Cushion colonies: soft domes with a raised, ruffled rim.
      return upgrade(raw, {
        subdiv: 1 + (level >= 2 ? 1 : 0), smooth: 2,
        deform: (p, i) => {
          const n = fbm(p.x * 9 + i * 0.001, p.z * 9, 2, seed) - 0.5
          p.y *= 1 + n * 0.5
        },
      })
    case 'reed':
      // Blades: bend each stem along a curved arc (height^2 falloff) so the clump reads as grass-like, not as straight rods.
      return upgrade(raw, {
        subdiv: 1 + (level >= 2 ? 1 : 0), smooth: 0,
        deform: p => {
          const h = Math.max(0, p.y)
          const ang = Math.atan2(p.z, p.x)
          const lean = 0.18 * h * h * (0.6 + 0.4 * Math.sin(ang * 3 + p.x * 4))
          p.x += Math.cos(ang) * lean
          p.z += Math.sin(ang) * lean
          p.x += Math.sin(h * 3.1 + ang) * 0.015 * h
        },
      })
    case 'shrub':
      return upgrade(raw, {
        subdiv: level >= 1 ? 1 : 0, smooth: 1,
        deform: p => {
          const n = fbm(p.x * 5, p.z * 5 + p.y * 3, 3, seed) - 0.5
          p.x *= 1 + n * 0.32
          p.z *= 1 + n * 0.32
          p.y += n * 0.08
        },
      })
    case 'tree':
      // Pin the trunk base so the root flare survives; round and break up the canopy lobes.
      return upgrade(raw, {
        subdiv: 1 + (level >= 1 ? 1 : 0), smooth: 1,
        pin: p => (p.y < 0.3 ? 0 : 1),
        deform: p => {
          if (p.y < 1.6) return
          const n = fbm(p.x * 3.2 + p.y * 0.7, p.z * 3.2, 3, seed) - 0.5
          p.x *= 1 + n * 0.35
          p.z *= 1 + n * 0.35
          p.y += n * 0.12
        },
      })
    case 'crystals': {
      // Keep the sharp prisms; enrich the cluster with smaller satellite crystals around the dark base (kept flat shaded).
      const base = raw.clone()
      const parts: THREE.BufferGeometry[] = [base]
      const copies = 4 + level * 2
      for (let i = 0; i < copies; i += 1) {
        const g = raw.clone()
        const s = 0.3 + rnd() * 0.28
        const a = rnd() * Math.PI * 2
        const d = 0.45 + rnd() * 0.55
        g.scale(s, s * (0.9 + rnd() * 0.5), s)
        g.rotateZ((rnd() - 0.5) * 0.7)
        g.rotateX((rnd() - 0.5) * 0.7)
        g.translate(Math.cos(a) * d, -0.02, Math.sin(a) * d)
        parts.push(g)
      }
      let pos: number[] = []
      let col: number[] = []
      for (const g of parts) {
        const p = g.attributes.position
        const c = g.attributes.color
        for (let i = 0; i < p.count; i += 1) {
          pos.push(p.getX(i), p.getY(i), p.getZ(i))
          col.push(c.getX(i), c.getY(i), c.getZ(i))
        }
      }
      const out = new THREE.BufferGeometry()
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      out.computeVertexNormals()
      pos = []
      col = []
      return out
    }
  }
}
export const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3
