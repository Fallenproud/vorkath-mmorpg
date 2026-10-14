import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CELL, WORLD_HALF } from './layout'
import { GRID, type HeightField } from './heightfield'
import { U } from './uniforms'

const NOISE = /* glsl */ `
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm4(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s / .9375; }
`

/**
 * Visible terrain + exact trimesh collider built from the same vertices, so what you see is
 * what you stand on. A single material renders the whole ecological state in the fragment
 * shader: bare obsidian/bloodstone scars give way to pioneer mats, soil and plant cover as the
 * shared vitality uniform rises, spreading outward from the Recovery Basin and Life-Core.
 */
export function createTerrain(hf: HeightField, physics: Physics): THREE.Mesh {
  const n = GRID
  const positions = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = (j * n + i) * 3
      positions[k] = -WORLD_HALF + i * CELL
      positions[k + 1] = hf.data[j * n + i]
      positions[k + 2] = -WORLD_HALF + j * CELL
    }
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6)
  let w = 0
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      // Alternate the diagonal to avoid a visible directional bias.
      if ((i + j) % 2 === 0) indices.set([a, c, b, b, c, d], w)
      else indices.set([a, c, d, a, d, b], w)
      w += 6
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()

  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 })
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uTime: U.uTime, uVit: U.uVit, uAct: U.uAct, uPulse: U.uPulse, uWaterY: U.uWaterY, uWaterMin: U.uWaterMin, uBasin: U.uBasin, uCore: U.uCore,
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime, uVit, uAct, uPulse, uWaterY, uWaterMin;
uniform vec2 uBasin, uCore;
varying vec3 vWPos; varying vec3 vWNrm;
float tRough; vec3 tEmis; float tBump;
${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 N = normalize(vWNrm);
  float slope = 1.0 - N.y;
  vec2 P = vWPos.xz;
  float nLarge = fbm4(P * 0.03);
  float nMid = fbm4(P * 0.12 + 5.0);
  float nFine = fbm4(P * 0.9);
  float strata = sin(vWPos.y * 2.3 + nLarge * 7.0) * 0.5 + 0.5;

  // Rock language: obsidian, charcoal and graphite bands.
  vec3 rock = mix(vec3(0.022, 0.021, 0.025), vec3(0.092, 0.084, 0.088), smoothstep(0.25, 0.75, nMid));
  rock = mix(rock, vec3(0.19, 0.17, 0.165), strata * smoothstep(0.2, 0.7, slope) * 0.75);
  rock = mix(rock, vec3(0.20, 0.045, 0.035), smoothstep(0.78, 0.9, nLarge + strata * 0.1) * smoothstep(0.3, 0.6, slope) * 0.9);
  rock *= 0.72 + 0.55 * nFine;

  // Bloodstone dust settles on flatter ground.
  vec3 blood = vec3(0.30, 0.052, 0.038) * (0.55 + 0.85 * nMid);
  float dust = smoothstep(0.32, 0.72, nLarge + (1.0 - slope) * 0.3) * smoothstep(0.55, 0.06, slope);
  vec3 col = mix(rock, blood, dust * 0.82);

  // Fractured crust.
  float cr = smoothstep(0.0, 0.1, abs(vn(P * 0.33) - 0.5) * 2.0);
  col *= mix(0.4, 1.0, cr);

  // Basin hardpan: pale cracked mud that darkens as groundwater returns.
  float rb = distance(P, uBasin);
  float basinMask = (1.0 - smoothstep(uWaterMin + 0.4, uWaterMin + 6.5, vWPos.y)) * (1.0 - smoothstep(34.0, 58.0, rb));
  float poly = smoothstep(0.0, 0.07, abs(vn(P * 0.55) - 0.5) * 2.0) * smoothstep(0.0, 0.07, abs(vn(P * 1.3 + 9.0) - 0.5) * 2.0);
  vec3 hardpan = mix(vec3(0.34, 0.27, 0.22), vec3(0.50, 0.40, 0.31), nMid) * mix(0.35, 1.0, poly);
  col = mix(col, hardpan, basinMask * 0.9);
  float wet = smoothstep(0.08, 0.5, uVit) * (1.0 - smoothstep(uWaterY, uWaterY + 3.2, vWPos.y)) * (1.0 - smoothstep(30.0, 58.0, rb));
  col *= 1.0 - 0.62 * wet;

  // Ecological succession front: spreads from the basin and the Life-Core as vitality rises.
  float rc = distance(P, uCore);
  float f1 = uVit * 125.0 - rb;
  float f2 = uVit * 70.0 - rc;
  float front = max(smoothstep(0.0, 34.0, f1), smoothstep(0.0, 26.0, f2));
  float flatOk = smoothstep(0.55, 0.12, slope);
  float altOk = 1.0 - smoothstep(18.0, 34.0, vWPos.y) * 0.85;
  float patchN = fbm4(P * 0.07 + 31.0) * 0.7 + fbm4(P * 0.35) * 0.3;
  float cov = front * flatOk * altOk;
  cov = smoothstep(0.22, 0.58, cov * 1.25 + (patchN - 0.5) * 0.9 - 0.1 * (1.0 - uVit));
  vec3 moss = mix(vec3(0.04, 0.15, 0.11), vec3(0.09, 0.28, 0.20), nFine);
  vec3 lush = mix(vec3(0.06, 0.20, 0.11), vec3(0.15, 0.31, 0.14), nMid);
  vec3 soil = vec3(0.065, 0.042, 0.034);
  vec3 green = mix(moss, lush, smoothstep(0.35, 0.85, uVit));
  vec3 grown = mix(soil, green, smoothstep(0.1, 0.5, cov));
  col = mix(col, col * vec3(0.7, 0.62, 0.6), smoothstep(0.0, 0.4, front) * 0.5 * (1.0 - cov));
  col = mix(col, grown, cov);

  // Emissive: the stabilization shockwave and faint Life-Core mineral glints in bare rock.
  float ring = exp(-pow((rc - uPulse) / 5.0, 2.0)) * step(0.5, uPulse) * (1.0 - smoothstep(180.0, 320.0, uPulse));
  float glint = smoothstep(0.84, 0.92, vn(P * 0.8)) * (1.0 - cov) * (0.12 + uAct) * smoothstep(170.0, 15.0, rc) * 0.55;
  tEmis = vec3(0.08, 0.95, 0.80) * ring * 0.9 + vec3(0.04, 0.72, 0.62) * glint;
  tRough = mix(0.96, 0.42, wet * (1.0 - cov)) * mix(1.0, 0.97, cov);
  tBump = vn(P * 2.6) * 0.6 + vn(P * 7.3) * 0.3 + (1.0 - cr) * -0.5;
  diffuseColor.rgb = col;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
  float hx = dFdx(tBump); float hy = dFdy(tBump);
  vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  normal = normalize(abs(det) * normal - 0.35 * grad);
}`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmis;')
  }
  mat.customProgramCacheKey = () => 'vorkath-terrain-v1'

  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  mesh.name = 'terrain'

  const desc = RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.9)
  physics.world.createCollider(desc)

  // Invisible perimeter so nothing can leave the region if a wall is ever scaled.
  const wall = WORLD_HALF + 4
  for (const [x, z, sx, sz] of [[wall, 0, 2, wall], [-wall, 0, 2, wall], [0, wall, wall, 2], [0, -wall, wall, 2]] as const) {
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx, 200, sz).setTranslation(x, 0, z))
  }
  return mesh
}
