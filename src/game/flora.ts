import * as THREE from 'three'
import { mulberry32 } from '../engine/noise'
import type { HeightField } from './heightfield'
import { POI } from './layout'
import { instanced, type Placement } from './gfx'
import type { Model } from './props'
import { U } from './uniforms'

/**
 * Clone a material so its vertices scale up from nothing as the shared vitality passes the
 * per-instance threshold (`aThr`), with a gentle wind sway. All growth runs on the GPU, so the
 * recovery stays smooth and costs no CPU per plant.
 */
function growable(base: THREE.Material, sway: number, extra?: (m: THREE.MeshStandardMaterial) => void): THREE.MeshStandardMaterial {
  const mat = base.clone() as THREE.MeshStandardMaterial
  extra?.(mat)
  mat.onBeforeCompile = shader => {
    shader.uniforms.uVit = U.uVit
    shader.uniforms.uTime = U.uTime
    shader.uniforms.uWind = U.uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aThr;\nuniform float uVit; uniform float uTime; uniform vec2 uWind;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
float grow = smoothstep(aThr, aThr + 0.16, uVit);
transformed *= grow;
#ifdef USE_INSTANCING
float sw = sin(uTime * 1.3 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23 + position.y * 1.5);
transformed.xz += uWind * (0.5 + 0.5 * sw) * ${sway.toFixed(3)} * max(position.y, 0.0) * grow;
#endif`,
      )
  }
  mat.customProgramCacheKey = () => `grow-${sway}-${base.uuid}`
  return mat
}

export interface FloraTree {
  pos: THREE.Vector3
  threshold: number
}

type Items = Placement[] & { thr: number[] }

export class Flora {
  readonly group = new THREE.Group()
  /** Tall frond-trees, earliest-growing first (used for scan specimens). */
  readonly trees: FloraTree[] = []

  constructor(hf: HeightField, models: { frond?: Model }, density: number) {
    const rnd = mulberry32(8812)
    const dist = (x: number, z: number) => Math.min(Math.hypot(x - POI.basin.x, z - POI.basin.z) / 125, Math.hypot(x - POI.core.x, z - POI.core.z) / 70)

    const sample = (count: number, opts: { maxSlope: number; maxY: number; thrOffset: number; near?: number }): Items => {
      const out = Object.assign([] as Placement[], { thr: [] as number[] }) as Items
      let tries = 0
      while (out.length < count && tries < count * 40) {
        tries += 1
        // Bias samples toward the basin and core where recovery starts.
        const home = rnd() < 0.78 ? POI.basin : POI.core
        const reach = home === POI.basin ? 150 : 85
        const a = rnd() * Math.PI * 2
        const r = Math.sqrt(rnd()) * reach
        const x = home.x + Math.cos(a) * r
        const z = home.z + Math.sin(a) * r
        if (Math.abs(x) > 205 || Math.abs(z) > 205) continue
        const d = dist(x, z)
        if (d > 0.9) continue
        const y = hf.heightAt(x, z)
        if (y < hf.waterMax + 0.18 || y > opts.maxY) continue
        if (hf.slopeAt(x, z) > opts.maxSlope) continue
        if (Math.hypot(x - POI.crystal.x, z - POI.crystal.z) < 12) continue
        if (Math.hypot(x - POI.core.x, z - POI.core.z) < 12) continue
        if (opts.near !== undefined) {
          const cd = hf.channelDistance(x, z).d
          const lake = Math.hypot(x - POI.basin.x, z - POI.basin.z)
          if (Math.min(cd, Math.abs(lake - 22)) > opts.near) continue
        }
        out.push({ x, y: y - 0.02, z, scale: 1, rotY: rnd() * 6.28 })
        out.thr.push(Math.min(0.97, d * 0.96 + opts.thrOffset + rnd() * 0.08))
      }
      return out
    }

    const attach = (mesh: THREE.InstancedMesh, thr: number[]) => {
      mesh.geometry.setAttribute('aThr', new THREE.InstancedBufferAttribute(new Float32Array(thr), 1))
    }

    // 1. Pioneer moss mats: first colonisers, low and wide.
    {
      const items = sample(Math.round(1300 * density), { maxSlope: 34, maxY: 18, thrOffset: 0.0 })
      const geo = new THREE.IcosahedronGeometry(0.5, 1)
      geo.scale(1, 0.32, 1)
      geo.translate(0, 0.05, 0)
      items.forEach(it => {
        const s = 0.5 + rnd() * 1.4
        it.scale = new THREE.Vector3(s * (0.9 + rnd() * 0.6), s * (0.6 + rnd() * 0.8), s * (0.9 + rnd() * 0.6))
        it.color = new THREE.Color().setHSL(0.36 + rnd() * 0.08, 0.5, 0.1 + rnd() * 0.09)
      })
      const mesh = instanced(geo, growable(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), 0), items, { cast: false })
      attach(mesh, items.thr)
      this.group.add(mesh)
    }

    // 2. Grass / fern blades.
    {
      const items = sample(Math.round(2800 * density), { maxSlope: 26, maxY: 16, thrOffset: 0.1, near: 70 })
      const blades = 7
      const pos: number[] = []
      const col: number[] = []
      const idx: number[] = []
      for (let b = 0; b < blades; b += 1) {
        const a = (b / blades) * Math.PI * 2 + rnd()
        const ox = Math.cos(a) * 0.12
        const oz = Math.sin(a) * 0.12
        const h = 0.55 + rnd() * 0.5
        const lean = 0.18 + rnd() * 0.3
        const w = 0.05
        const px = -Math.sin(a) * w
        const pz = Math.cos(a) * w
        const k = pos.length / 3
        pos.push(
          ox - px, 0, oz - pz,
          ox + px, 0, oz + pz,
          ox - px * 0.5 + Math.cos(a) * lean * 0.5, h * 0.55, oz - pz * 0.5 + Math.sin(a) * lean * 0.5,
          ox + px * 0.5 + Math.cos(a) * lean * 0.5, h * 0.55, oz + pz * 0.5 + Math.sin(a) * lean * 0.5,
          ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean,
        )
        col.push(0.35, 0.4, 0.3, 0.35, 0.4, 0.3, 0.7, 0.8, 0.6, 0.7, 0.8, 0.6, 1, 1.15, 0.9)
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2, k + 2, k + 3, k + 4)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      items.forEach(it => {
        it.scale = 0.7 + rnd() * 1.3
        it.color = new THREE.Color().setHSL(0.27 + rnd() * 0.14, 0.55, 0.22 + rnd() * 0.12)
      })
      const mat = growable(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), 0.35)
      const mesh = instanced(geo, mat, items, { cast: false })
      attach(mesh, items.thr)
      this.group.add(mesh)
    }

    // 3. Glow pods: late bloom of small bioluminescent bulbs among the grass.
    {
      const items = sample(Math.round(260 * density), { maxSlope: 22, maxY: 14, thrOffset: 0.42, near: 55 })
      const geo = new THREE.SphereGeometry(0.11, 8, 6)
      geo.translate(0, 0.35, 0)
      items.forEach(it => {
        it.scale = 0.7 + rnd() * 0.9
        it.color = new THREE.Color().setHSL(rnd() < 0.7 ? 0.47 : 0.99, 0.8, 0.5)
      })
      const mat = growable(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.1, roughness: 0.3 }), 0.1)
      const prev = mat.onBeforeCompile
      mat.onBeforeCompile = (s, r) => {
        prev(s, r)
        s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * 1.3;')
      }
      const mesh = instanced(geo, mat, items, { cast: false })
      attach(mesh, items.thr)
      this.group.add(mesh)
    }

    // 4. Frond-trees (large) and frond undergrowth (small), from the generated model.
    if (models.frond) {
      const frond = models.frond
      const make = (count: number, minS: number, maxS: number, thrOffset: number, near: number): Items => {
        const items = sample(count, { maxSlope: 20, maxY: 14, thrOffset, near })
        items.forEach(it => {
          const s = (minS + rnd() * (maxS - minS)) / frond.height
          it.scale = new THREE.Vector3(s, s * (0.9 + rnd() * 0.25), s)
          it.tiltX = (rnd() - 0.5) * 0.1
          it.tiltZ = (rnd() - 0.5) * 0.1
        })
        const mat = growable(frond.material, 0.25, m => {
          m.roughness = Math.max(0.6, m.roughness)
        })
        const mesh = instanced(frond.geometry.clone(), mat, items)
        attach(mesh, items.thr)
        this.group.add(mesh)
        return items
      }
      const big = make(Math.max(4, Math.round(10 * density)), 3.4, 6.2, 0.3, 40)
      make(Math.round(18 * density), 1.1, 2.2, 0.2, 55)
      big.forEach((it, i) => this.trees.push({ pos: new THREE.Vector3(it.x, it.y, it.z), threshold: big.thr[i] }))
      this.trees.sort((a, b) => a.threshold - b.threshold)
    }
    this.group.name = 'flora'
  }
}
