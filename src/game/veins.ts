import * as THREE from 'three'
import { CHANNEL_POINTS, POI, type V2 } from './layout'
import type { HeightField } from './heightfield'
import { mulberry32 } from '../engine/noise'
import { U } from './uniforms'

const FRAG = /* glsl */ `
uniform float uTime, uAct, uVit;
varying float vFrac; varying float vS; varying vec2 vUv;
#include <fog_pars_fragment>
void main(){
  float edge = smoothstep(1.0, 0.45, abs(vUv.y * 2.0 - 1.0));
  float reach = uAct * 1.04;
  float lit = smoothstep(reach + 0.02, reach - 0.06, vFrac) * step(0.001, uAct);
  // Dormant: dull red residue that flickers like cooling embers.
  float ember = 0.35 + 0.65 * (0.5 + 0.5 * sin(vS * 0.9 + uTime * 0.7 + sin(vS * 0.17) * 3.0));
  vec3 dead = vec3(0.55, 0.06, 0.04) * ember * 0.55;
  // Live: turquoise with pulses travelling away from the core.
  float pulse = 0.55 + 0.45 * sin(vS * 0.35 - uTime * 3.0);
  vec3 live = vec3(0.04, 0.95, 0.78) * (0.7 + 0.9 * pulse);
  vec3 col = mix(dead, live, lit);
  float a = edge * mix(0.55, 0.95, lit);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`
const VERT = /* glsl */ `
attribute float aFrac; attribute float aS;
varying float vFrac; varying float vS; varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vFrac = aFrac; vS = aS; vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

function ribbon(hf: HeightField, pts: V2[], width: number, lift = 0.14): THREE.BufferGeometry {
  // Densify then offset along the normal; heights follow the ground so the vein hugs terrain.
  const dense: V2[] = []
  for (let i = 0; i < pts.length - 1; i += 1) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)
    const steps = Math.max(1, Math.ceil(len / 1.5))
    for (let k = 0; k < steps; k += 1) {
      const t = k / steps
      dense.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t })
    }
  }
  dense.push(pts[pts.length - 1])
  const m = dense.length
  const pos = new Float32Array(m * 2 * 3)
  const frac = new Float32Array(m * 2)
  const sArr = new Float32Array(m * 2)
  const uv = new Float32Array(m * 2 * 2)
  const idx: number[] = []
  let s = 0
  const lens = [0]
  for (let i = 1; i < m; i += 1) lens.push(lens[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z))
  const total = lens[m - 1] || 1
  for (let i = 0; i < m; i += 1) {
    const a = dense[Math.max(0, i - 1)]
    const b = dense[Math.min(m - 1, i + 1)]
    let tx = b.x - a.x
    let tz = b.z - a.z
    const l = Math.hypot(tx, tz) || 1
    tx /= l
    tz /= l
    s = lens[i]
    for (let side = 0; side < 2; side += 1) {
      const o = side === 0 ? -1 : 1
      const x = dense[i].x + -tz * o * width * 0.5
      const z = dense[i].z + tx * o * width * 0.5
      const k = i * 2 + side
      pos.set([x, hf.heightAt(x, z) + lift, z], k * 3)
      frac[k] = s / total
      sArr[k] = s
      uv.set([s / 4, side], k * 2)
    }
    if (i < m - 1) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aFrac', new THREE.BufferAttribute(frac, 1))
  g.setAttribute('aS', new THREE.BufferAttribute(sArr, 1))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** Conduit veins radiating from the Life-Core: dormant embers until the nodes are repaired. */
export class Veins {
  readonly group = new THREE.Group()
  /** Points along the main vein toward the basin (for flowing energy motes). */
  readonly mainPath: THREE.Vector3[] = []
  readonly crystalPath: THREE.Vector3[] = []
  private readonly mat: THREE.ShaderMaterial

  constructor(hf: HeightField) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: U.uTime, uAct: U.uAct, uVit: U.uVit }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    })
    Object.assign(this.mat.uniforms, { uTime: U.uTime, uAct: U.uAct, uVit: U.uVit })
    const rnd = mulberry32(77)
    const wob = (pts: V2[], amp: number): V2[] => pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: p.x + (rnd() - 0.5) * amp, z: p.z + (rnd() - 0.5) * amp }))

    // Main vein: parallel to the channel bank, 4 m to its north side.
    const main: V2[] = []
    for (let i = 0; i < CHANNEL_POINTS.length; i += 1) {
      const a = CHANNEL_POINTS[Math.max(0, i - 1)]
      const b = CHANNEL_POINTS[Math.min(CHANNEL_POINTS.length - 1, i + 1)]
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
      main.push({ x: CHANNEL_POINTS[i].x + ((a.z - b.z) / l) * 4.2, z: CHANNEL_POINTS[i].z + ((b.x - a.x) / l) * 4.2 })
    }
    main.unshift({ x: POI.core.x + 3, z: POI.core.z + 3 })
    main.push({ x: POI.basin.x - 4, z: POI.basin.z - 3 })
    const toCrystal = wob([{ x: POI.core.x - 2, z: POI.core.z + 4 }, { x: -33, z: -118 }, { x: -41, z: -100 }, { x: -50, z: -86 }, { x: -56, z: -72 }, { x: POI.crystal.x, z: POI.crystal.z }], 5)
    const radials: V2[][] = []
    for (let r = 0; r < 7; r += 1) {
      const ang = (r / 7) * Math.PI * 2 + 0.4
      const len = 14 + rnd() * 10
      radials.push(wob([
        { x: POI.core.x, z: POI.core.z },
        { x: POI.core.x + Math.cos(ang) * len * 0.5, z: POI.core.z + Math.sin(ang) * len * 0.5 },
        { x: POI.core.x + Math.cos(ang + 0.2) * len, z: POI.core.z + Math.sin(ang + 0.2) * len },
      ], 1.5))
    }
    for (const [pts, w] of [[main, 1.1], [toCrystal, 0.9], ...radials.map(r => [r, 0.6] as const)] as const) {
      const mesh = new THREE.Mesh(ribbon(hf, [...pts], w), this.mat)
      mesh.frustumCulled = false
      mesh.renderOrder = 1
      this.group.add(mesh)
    }
    const sample = (pts: V2[], out: THREE.Vector3[]) => {
      for (let i = 0; i < pts.length - 1; i += 1) {
        const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)
        const steps = Math.ceil(len / 3)
        for (let k = 0; k < steps; k += 1) {
          const t = k / steps
          const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t
          const z = pts[i].z + (pts[i + 1].z - pts[i].z) * t
          out.push(new THREE.Vector3(x, hf.heightAt(x, z) + 0.5, z))
        }
      }
    }
    sample(main, this.mainPath)
    sample(toCrystal, this.crystalPath)
  }
}
