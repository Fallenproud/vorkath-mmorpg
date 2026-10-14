import * as THREE from 'three'
import { POI } from './layout'
import type { HeightField } from './heightfield'
import { U } from './uniforms'

const NOISE = /* glsl */ `
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float ripple(vec2 p, float t){ return vn(p * 1.1 + t * vec2(0.22, 0.12)) + 0.5 * vn(p * 2.9 - t * vec2(0.31, 0.1)) + 0.25 * vn(p * 7.0 + t * vec2(0.1, -0.4)); }
`

const WATER_FRAG = /* glsl */ `
uniform float uTime, uVit;
uniform vec3 uSunDir, uSunCol, uHorizon, uZenith;
uniform float uMode; // 0 lake, 1 channel
varying vec3 vW; varying float vTerr; varying float vWaterY; varying vec2 vUv; varying float vFrac;
uniform float uFill;
#include <fog_pars_fragment>
${NOISE}
void main(){
  float depth = vWaterY - vTerr;
  if (depth < 0.0) discard;
  float e = 0.35;
  float h0 = ripple(vW.xz, uTime);
  vec2 flow = vec2(0.0);
  if (uMode > 0.5) { flow = vec2(0.0); }
  float hx = ripple(vW.xz + vec2(e, 0.0), uTime) - h0;
  float hz = ripple(vW.xz + vec2(0.0, e), uTime) - h0;
  vec3 n = normalize(vec3(-hx * 0.55, 1.0, -hz * 0.55));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uZenith, pow(max(R.y, 0.0), 0.5)) * 0.9;
  vec3 deep = vec3(0.012, 0.075, 0.07);
  vec3 shallow = vec3(0.10, 0.42, 0.38);
  float dMix = smoothstep(0.0, 1.5, depth);
  vec3 body = mix(shallow, deep, dMix);
  vec3 col = mix(body, sky, clamp(fres * 0.85 + 0.12, 0.0, 1.0));
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(n, H), 0.0), 220.0) * 1.8;
  // Foam along the shoreline and on channel rapids.
  float foamN = vn(vW.xz * 2.4 + uTime * 0.35);
  float foam = smoothstep(0.32, 0.0, depth) * smoothstep(0.35, 0.8, foamN);
  if (uMode > 0.5) foam = max(foam, smoothstep(0.62, 0.9, vn(vec2(vFrac * 160.0 - uTime * 2.2, vUv.y * 5.0))) * 0.5);
  col = mix(col, vec3(0.78, 0.92, 0.9), foam * 0.7);
  // Faint Life-Core turquoise glow in the water.
  col += vec3(0.0, 0.18, 0.15) * smoothstep(0.0, 1.0, uVit) * 0.5 * (1.0 - fres);
  float alpha = smoothstep(0.0, 0.28, depth) * mix(0.82, 0.96, dMix);
  if (uMode > 0.5) alpha *= smoothstep(1.0, 0.8, abs(vUv.y * 2.0 - 1.0)) ;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`

const WATER_VERT = /* glsl */ `
uniform float uTime, uWaterY, uMode, uFill;
attribute float aTerr; attribute float aFrac; attribute float aBed;
varying vec3 vW; varying float vTerr; varying float vWaterY; varying vec2 vUv; varying float vFrac;
#include <fog_pars_vertex>
void main(){
  vec3 p = position;
  float lvl = uWaterY;
  if (uMode > 0.5) { lvl = aBed + 0.42 * smoothstep(0.0, 0.2, uFill * 1.15 - aFrac); }
  p.y = lvl + sin(p.x * 0.9 + uTime * 1.3) * 0.015 + sin(p.z * 1.1 - uTime) * 0.012;
  vW = p; vTerr = aTerr; vWaterY = lvl; vUv = uv; vFrac = aFrac;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

function makeMaterial(mode: 0 | 1): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: U.uTime, uVit: U.uVit, uWaterY: U.uWaterY, uSunDir: U.uSunDir, uSunCol: U.uSunCol, uHorizon: U.uHorizon, uZenith: U.uZenith,
      uMode: { value: mode }, uFill: { value: 0 },
    }]),
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false, fog: true,
  })
  // merge() clones values; rebind the shared world uniforms.
  Object.assign(mat.uniforms, { uTime: U.uTime, uVit: U.uVit, uWaterY: U.uWaterY, uSunDir: U.uSunDir, uSunCol: U.uSunCol, uHorizon: U.uHorizon, uZenith: U.uZenith })
  return mat
}

/** Spring-fed lake in the Recovery Basin plus the water that fills the dry conduit channel. */
export class Water {
  readonly group = new THREE.Group()
  private readonly channelMat: THREE.ShaderMaterial
  private readonly lakeMat: THREE.ShaderMaterial

  constructor(hf: HeightField) {
    // --- Lake: a square grid whose vertices remember the terrain height beneath them.
    const half = 46
    const cell = 1.5
    const n = Math.round((half * 2) / cell) + 1
    const pos = new Float32Array(n * n * 3)
    const terr = new Float32Array(n * n)
    const idx: number[] = []
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = POI.basin.x - half + i * cell
        const z = POI.basin.z - half + j * cell
        const k = j * n + i
        pos.set([x, 0, z], k * 3)
        terr[k] = hf.heightAt(x, z)
        if (i < n - 1 && j < n - 1) idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aTerr', new THREE.BufferAttribute(terr, 1))
    geo.setAttribute('aFrac', new THREE.BufferAttribute(new Float32Array(n * n), 1))
    geo.setAttribute('aBed', new THREE.BufferAttribute(new Float32Array(n * n), 1))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * n * 2), 2))
    geo.setIndex(idx)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(POI.basin.x, hf.waterMin, POI.basin.z), half * 1.5)
    this.lakeMat = makeMaterial(0)
    const lake = new THREE.Mesh(geo, this.lakeMat)
    lake.frustumCulled = false
    lake.renderOrder = 2
    this.group.add(lake)

    // --- Channel: a ribbon along the carved bed; it fills from the source downstream.
    const ch = hf.channel
    const m = ch.length
    const cpos = new Float32Array(m * 2 * 3)
    const cterr = new Float32Array(m * 2)
    const cfrac = new Float32Array(m * 2)
    const cbed = new Float32Array(m * 2)
    const cuv = new Float32Array(m * 2 * 2)
    const total = ch[m - 1].s || 1
    const cidx: number[] = []
    for (let i = 0; i < m; i += 1) {
      const a = ch[Math.max(0, i - 1)]
      const b = ch[Math.min(m - 1, i + 1)]
      let tx = b.x - a.x
      let tz = b.z - a.z
      const len = Math.hypot(tx, tz) || 1
      tx /= len
      tz /= len
      const nx = -tz
      const nz = tx
      for (let side = 0; side < 2; side += 1) {
        const o = side === 0 ? -1 : 1
        const w = 2.6
        const x = ch[i].x + nx * o * w
        const z = ch[i].z + nz * o * w
        const k = i * 2 + side
        cpos.set([x, 0, z], k * 3)
        cterr[k] = hf.heightAt(x, z)
        cbed[k] = ch[i].bed + 0.05
        cfrac[k] = ch[i].s / total
        cuv.set([ch[i].s / 6, side], k * 2)
      }
      if (i < m - 1) {
        const k = i * 2
        cidx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
      }
    }
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.BufferAttribute(cpos, 3))
    cg.setAttribute('aTerr', new THREE.BufferAttribute(cterr, 1))
    cg.setAttribute('aFrac', new THREE.BufferAttribute(cfrac, 1))
    cg.setAttribute('aBed', new THREE.BufferAttribute(cbed, 1))
    cg.setAttribute('uv', new THREE.BufferAttribute(cuv, 2))
    cg.setIndex(cidx)
    cg.computeBoundingSphere()
    this.channelMat = makeMaterial(1)
    const chMesh = new THREE.Mesh(cg, this.channelMat)
    chMesh.frustumCulled = false
    chMesh.renderOrder = 2
    this.group.add(chMesh)
    this.group.visible = false
  }

  update(vit: number, hf: HeightField): void {
    // Water returns before the plants: the channel runs from vitality ~0.04, the lake rises from ~0.08.
    const fill = Math.min(1, Math.max(0, (vit - 0.03) / 0.22))
    const lakeT = Math.min(1, Math.max(0, (vit - 0.1) / 0.55))
    const eased = lakeT * lakeT * (3 - 2 * lakeT)
    U.uWaterY.value = hf.waterMin - 0.5 + (hf.waterMax - hf.waterMin + 0.5) * eased
    this.channelMat.uniforms.uFill.value = fill
    this.group.visible = vit > 0.02
  }
}
