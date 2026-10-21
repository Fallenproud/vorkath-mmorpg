import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { mulberry32 } from '../engine/noise'
import type { HeightField } from './heightfield'
import { POI, SCARS } from './layout'
import { U } from './uniforms'
import { PBR } from './pbr'

/**
 * Obsidian-glass crystal spires: NEW procedural asset (no mesh existed in the reference pack).
 * Visual targets: VP-VIS-011 / 012 / 013 / 015 (tall dark translucent spires in clusters, red inner glow
 * strongest at the base), Scar Tile Atlas I 01 Crystal Scar Mountains and 07 Crystal Storm Fields.
 * Each spire is a six-sided faceted prism with a skewed, tapered tip. A clear-coat dark glass material gets an
 * injected glow: warm crimson from the root, fresnel rim light, slow per-spire pulse.
 */
function spireGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed)
  const sides = 6
  const rings: { y: number; r: number; ox: number; oz: number }[] = [
    { y: 0, r: 1, ox: 0, oz: 0 },
    { y: 0.5, r: 0.82 + rnd() * 0.1, ox: (rnd() - 0.5) * 0.14, oz: (rnd() - 0.5) * 0.14 },
    { y: 0.86, r: 0.4 + rnd() * 0.12, ox: (rnd() - 0.5) * 0.3, oz: (rnd() - 0.5) * 0.3 },
  ]
  const apex = new THREE.Vector3((rnd() - 0.5) * 0.28, 1, (rnd() - 0.5) * 0.28)
  const ang0 = rnd() * Math.PI
  const pos: number[] = []
  const hgt: number[] = []
  const ringPt = (ri: number, s: number) => {
    const a = ang0 + (s / sides) * Math.PI * 2
    const rr = rings[ri].r * (0.85 + 0.3 * ((Math.sin(s * 12.9 + seed) + 1) * 0.5))
    return new THREE.Vector3(Math.cos(a) * 0.1 * rr + rings[ri].ox, rings[ri].y, Math.sin(a) * 0.1 * rr + rings[ri].oz)
  }
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z)
      hgt.push(p.y)
    }
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = ringPt(r, s)
      const b = ringPt(r, (s + 1) % sides)
      const c = ringPt(r + 1, (s + 1) % sides)
      const d = ringPt(r + 1, s)
      tri(a, c, b)
      tri(a, d, c)
    }
  }
  for (let s = 0; s < sides; s += 1) tri(ringPt(rings.length - 1, s), apex, ringPt(rings.length - 1, (s + 1) % sides))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** Triplanar PBR micro-structure (dark_rock_02 layer): weathering normals, pit roughness and crevice AO on the obsidian. */
const SPIRE_COLOR = /* glsl */ `#include <color_fragment>
float spF = uPbrMix * (1.0 - smoothstep(22.0, 85.0, length(vViewPosition)));
vec3 spNw = vec3(0.0, 1.0, 0.0);
float spAO = 1.0;
float spRg = 0.0;
if (spF > 0.002) {
  vec3 gn = normalize(cross(dFdx(vSpW), dFdy(vSpW)));
  vec3 wt = pow(abs(gn), vec3(4.0)); wt /= (wt.x + wt.y + wt.z + 1e-4);
  vec2 uvX = vec2(vSpW.z, -vSpW.y) / 1.7, uvY = vec2(vSpW.x, vSpW.z) / 1.7, uvZ = vec2(vSpW.x, -vSpW.y) / 1.7;
  vec3 tX = texture(tPbrNor, vec3(uvX, 1.0)).rgb * 2.0 - 1.0;
  vec3 tY = texture(tPbrNor, vec3(uvY, 1.0)).rgb * 2.0 - 1.0;
  vec3 tZ = texture(tPbrNor, vec3(uvZ, 1.0)).rgb * 2.0 - 1.0;
  vec3 aX = texture(tPbrArm, vec3(uvX, 1.0)).rgb, aY = texture(tPbrArm, vec3(uvY, 1.0)).rgb, aZ = texture(tPbrArm, vec3(uvZ, 1.0)).rgb;
  vec3 nX = vec3(gn.x, gn.y + tX.y * 0.8, gn.z + tX.x * 0.8);
  vec3 nY = vec3(gn.x + tY.x * 0.8, gn.y, gn.z - tY.y * 0.8);
  vec3 nZ = vec3(gn.x + tZ.x * 0.8, gn.y + tZ.y * 0.8, gn.z);
  vec3 fq = floor(gn * 40.0 + 0.5) + 31.7 + vSeed * 17.0;
  float ff = fract(sin(dot(fq, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 ftilt = vec3(fract(ff * 7.31), fract(ff * 13.7), fract(ff * 3.17)) - 0.5;
  spNw = normalize(nX * wt.x + nY * wt.y + nZ * wt.z + ftilt * 0.2);
  vec3 arm = aX * wt.x + aY * wt.y + aZ * wt.z;
  spAO = pow(arm.r, 2.0);
  spRg = arm.g - 0.82;
}
diffuseColor.rgb *= mix(1.0, spAO, spF);`

function spireMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#0b0709', roughness: 0.14, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9, flatShading: true,
  })
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = U.uTime
    shader.uniforms.uAct = U.uAct
    shader.uniforms.uPbrMix = PBR.mix
    shader.uniforms.tPbrNor = PBR.nor
    shader.uniforms.tPbrArm = PBR.arm
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vH;\nvarying float vSeed;\nvarying vec3 vSpW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 spW4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nspW4 = instanceMatrix * spW4;\n#endif\nvSpW = (modelMatrix * spW4).xyz;\nvH = aH;\n#ifdef USE_INSTANCING\nvSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);\n#else\nvSeed = 0.5;\n#endif')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAct;\nvarying float vH;\nvarying float vSeed;\nvarying vec3 vSpW;\nuniform float uPbrMix;\nuniform highp sampler2DArray tPbrNor;\nuniform highp sampler2DArray tPbrArm;')
      .replace('#include <color_fragment>', SPIRE_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + spRg * 1.1 * spF, 0.07, 0.7);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 nvS = normalize((viewMatrix * vec4(spNw, 0.0)).xyz);\nif (spF > 0.002) { normal = normalize(mix(normal, nvS, spF * 0.8)); }')
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nif (spF > 0.002) { clearcoatNormal = normalize(mix(clearcoatNormal, nvS, spF * 0.85)); }\n#endif')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.4);
  float root = pow(1.0 - clamp(vH, 0.0, 1.0), 2.2);
  float pulse = 0.72 + 0.28 * sin(uTime * (0.8 + vSeed) + vSeed * 40.0);
  vec3 hot = mix(vec3(0.9, 0.07, 0.04), vec3(0.6, 0.05, 0.12), vSeed * 0.6);
  totalEmissiveRadiance += hot * (root * 0.8 + fres * 0.32) * pulse * (0.7 + 0.3 * vSeed);
  totalEmissiveRadiance += vec3(0.05, 0.55, 0.5) * fres * 0.18 * uAct;
}`,
      )
  }
  m.customProgramCacheKey = () => 'vorkath-spire-v3'
  return m
}

export interface SpireCluster {
  x: number
  z: number
  height: number
}

export class Spires {
  readonly group = new THREE.Group()
  readonly clusters: SpireCluster[] = []
  shardCount = 0

  constructor(hf: HeightField, physics: Physics, density: number) {
    const rnd = mulberry32(777)
    const variants = [spireGeometry(11), spireGeometry(23), spireGeometry(37), spireGeometry(59)]
    const mat = spireMaterial()
    const perVariant: THREE.Matrix4[][] = variants.map(() => [])
    const colors: THREE.Color[][] = variants.map(() => [])
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()

    const free = (x: number, z: number, minClear = 0) => {
      if (Math.abs(x) > 212 || Math.abs(z) > 212) return false
      if (hf.heightAt(x, z) < hf.waterMax + 0.6) return false
      if (hf.channelDistance(x, z).d < 4) return false
      if (Math.hypot(x - POI.core.x, z - POI.core.z) < 14) return false
      if (Math.hypot(x - POI.arrival.x, z - POI.arrival.z) < 16) return false
      if (Math.hypot(x - POI.basin.x, z - POI.basin.z) < 60) return false
      for (const c of this.clusters) if (Math.hypot(c.x - x, c.z - z) < minClear + c.height * 0.14) return false
      return true
    }

    const addShard = (x: number, y: number, z: number, h: number, w: number, tiltX: number, tiltZ: number, rot: number, shade: number) => {
      const v = Math.floor(rnd() * variants.length)
      e.set(tiltX, rot, tiltZ, 'YXZ')
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w * h * 1.1 + 0.2, h, w * h * 1.1 + 0.2))
      perVariant[v].push(m4.clone())
      colors[v].push(new THREE.Color().setHSL(0.0, 0.0, 0.55 + shade * 0.45))
      this.shardCount += 1
    }

    const cluster = (cx: number, cz: number, h: number, count: number, collide: boolean) => {
      const y = hf.heightAt(cx, cz) - 0.25
      this.clusters.push({ x: cx, z: cz, height: h })
      addShard(cx, y, cz, h, 0.55 + rnd() * 0.25, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1, rnd() * 6.28, rnd())
      for (let i = 0; i < count - 1; i += 1) {
        const a = (i / (count - 1)) * Math.PI * 2 + rnd()
        const r = 0.5 + rnd() * h * 0.12
        const sx = cx + Math.cos(a) * r
        const sz = cz + Math.sin(a) * r
        const lean = 0.2 + rnd() * 0.5
        const sh = h * (0.25 + rnd() * 0.5)
        addShard(sx, hf.heightAt(sx, sz) - 0.2, sz, sh, 0.5 + rnd() * 0.3, Math.sin(a) * lean, -Math.cos(a) * lean, rnd() * 6.28, rnd())
      }
      if (collide && h > 3) physics.addStaticCylinder(new THREE.Vector3(cx, y + h * 0.4, cz), Math.max(0.6, h * 0.075), h * 0.8)
    }

    const sampleAround = (centre: { x: number; z: number }, rMin: number, rMax: number, count: number, hMin: number, hMax: number, shards: [number, number], collide: boolean, minClear: number) => {
      let placed = 0
      let tries = 0
      while (placed < count && tries < count * 40) {
        tries += 1
        const a = rnd() * Math.PI * 2
        const r = rMin + Math.sqrt(rnd()) * (rMax - rMin)
        const x = centre.x + Math.cos(a) * r
        const z = centre.z + Math.sin(a) * r
        if (!free(x, z, minClear)) continue
        const h = hMin + Math.pow(rnd(), 1.6) * (hMax - hMin)
        cluster(x, z, h, Math.round(shards[0] + rnd() * (shards[1] - shards[0])), collide)
        placed += 1
      }
    }

    const d = density
    // Crystal storm field: dense forest of spires of mixed height, a few towering ones (Scar Tile Atlas I 07).
    sampleAround(POI.crystal, 6, 56, Math.round(58 * d), 2.2, 8.5, [4, 8], true, 3.5)
    sampleAround(POI.crystal, 14, 60, Math.round(5 * d), 10, 15, [6, 9], true, 8)
    // Fractured Ridge: spires crowning the gorge walls (Serrated Ridgelines 02).
    for (const s of SCARS.slice(0, 2)) {
      const n = Math.round(18 * d)
      for (let i = 0; i < n; i += 1) {
        const t = rnd()
        const side = rnd() < 0.5 ? -1 : 1
        const dx = s.b.x - s.a.x
        const dz = s.b.z - s.a.z
        const l = Math.hypot(dx, dz)
        const off = s.sigma * (2.6 + rnd() * 5)
        const x = s.a.x + dx * t + (-dz / l) * off * side
        const z = s.a.z + dz * t + (dx / l) * off * side
        if (!free(x, z, 3)) continue
        cluster(x, z, 2.5 + rnd() * 6, 3 + Math.round(rnd() * 4), true)
      }
    }
    // Other scars carry smaller outcrops.
    for (const s of SCARS.slice(2)) {
      const n = Math.round(8 * d)
      for (let i = 0; i < n; i += 1) {
        const t = rnd()
        const dx = s.b.x - s.a.x
        const dz = s.b.z - s.a.z
        const l = Math.hypot(dx, dz)
        const off = s.sigma * (1.5 + rnd() * 4) * (rnd() < 0.5 ? -1 : 1)
        const x = s.a.x + dx * t + (-dz / l) * off
        const z = s.a.z + dz * t + (dx / l) * off
        if (!free(x, z, 3)) continue
        cluster(x, z, 1.6 + rnd() * 3.2, 3 + Math.round(rnd() * 3), true)
      }
    }
    // Plains: lone spire groups on the open scar, like the lone spire of VP-VIS-013.
    sampleAround({ x: 0, z: 0 }, 40, 190, Math.round(26 * d), 2.5, 9, [3, 7], true, 12)
    // Horizon crystals: giant clusters at the world rim read as Crystal Scar Mountains from far away.
    const rim = Math.round(24 * d)
    for (let i = 0; i < rim; i += 1) {
      const a = (i / rim) * Math.PI * 2 + rnd() * 0.2
      const r = 200 + rnd() * 12
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (Math.abs(x) > 214 || Math.abs(z) > 214) continue
      cluster(x, z, 16 + rnd() * 22, 6 + Math.round(rnd() * 4), false)
    }
    // Loose glass shards lying on the ground.
    const debris = Math.round(260 * d)
    for (let i = 0; i < debris; i += 1) {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * 70
      const x = POI.crystal.x + Math.cos(a) * r
      const z = POI.crystal.z + Math.sin(a) * r
      if (!free(x, z, 0)) continue
      const h = 0.25 + rnd() * 0.7
      addShard(x, hf.heightAt(x, z) + 0.02, z, h, 0.5, (rnd() - 0.5) * 2.6, (rnd() - 0.5) * 2.6, rnd() * 6.28, rnd())
    }

    variants.forEach((geo, i) => {
      if (!perVariant[i].length) return
      const mesh = new THREE.InstancedMesh(geo, mat, perVariant[i].length)
      perVariant[i].forEach((mm, k) => {
        mesh.setMatrixAt(k, mm)
        mesh.setColorAt(k, colors[i][k])
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      this.group.add(mesh)
    })
    this.group.name = 'spires'
  }
}
