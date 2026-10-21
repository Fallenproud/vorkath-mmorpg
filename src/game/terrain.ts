import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CELL, WORLD_HALF } from './layout'
import { GRID, type HeightField } from './heightfield'
import { U } from './uniforms'
import { REACH } from './ecology'
import { PBR, PBR_MEAN, PBR_MEAN_ROUGH } from './pbr'

const NOISE = /* glsl */ `
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm4(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s / .9375; }
`

const VORONOI = /* glsl */ `
vec3 vor(vec2 p){ vec2 ip = floor(p), fp = fract(p); float d1 = 8., d2 = 8., id = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 g = vec2(float(i), float(j)); vec2 o = vec2(h21(ip + g), h21(ip + g + 71.3)); vec2 r = g + o - fp; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = h21(ip + g + 13.7); } else if (d < d2){ d2 = d; } }
  return vec3(sqrt(d1), sqrt(d2), id); }
`


/** Per-layer mean albedo / roughness of the source textures, emitted as GLSL constants. */
const PBR_CONSTS = PBR_MEAN.map((m, i) => `const vec3 PBR_M${i} = vec3(${m[0]}, ${m[1]}, ${m[2]}); const float PBR_R${i} = ${PBR_MEAN_ROUGH[i]};`).join('\n')
const PBR_GLSL = /* glsl */ `
uniform float uPbrMix, uPbrDbg;
${PBR_CONSTS}
uniform highp sampler2DArray tPbrDiff;
uniform highp sampler2DArray tPbrNor;
uniform highp sampler2DArray tPbrArm;
struct PbrS { vec3 rel; float ao; float rough; vec3 n; };
// Planar (top-down) sample. Albedo is returned relative to the layer mean so the Vorkath palette stays in charge
// and the texture only contributes structure; a second rotated, larger-scale albedo fetch breaks up tiling.
PbrS pbrTop(float L, vec2 P, vec3 N, vec3 M, float R, float tile, float nStr){
  vec2 uv = P / tile;
  vec2 uv2 = vec2(uv.x * 0.8 - uv.y * 0.6, uv.x * 0.6 + uv.y * 0.8) * 0.27 + 0.37;
  vec3 a1 = texture(tPbrDiff, vec3(uv, L)).rgb;
  vec3 a2 = texture(tPbrDiff, vec3(uv2, L)).rgb;
  vec3 arm = texture(tPbrArm, vec3(uv, L)).rgb;
  vec3 t = texture(tPbrNor, vec3(uv, L)).rgb * 2.0 - 1.0;
  PbrS s;
  s.rel = clamp(a1 / M, 0.15, 3.0) * mix(vec3(1.0), clamp(a2 / M, 0.4, 2.0), 0.5);
  s.ao = arm.r;
  s.rough = arm.g / R;
  s.n = normalize(vec3(N.x + t.x * nStr, N.y, N.z - t.y * nStr)); // image up = -z, image right = +x
  return s;
}
// Biplanar (X and Z projections) for cliff faces; image up = world up.
PbrS pbrWall(float L, vec3 wp, vec3 N, vec3 M, float R, float tile, float nStr){
  vec2 uvX = vec2(wp.z, -wp.y) / tile;
  vec2 uvZ = vec2(wp.x, -wp.y) / tile;
  float wx = pow(abs(N.x), 4.0), wz = pow(abs(N.z), 4.0);
  float ws = wx + wz + 1e-4; wx /= ws; wz /= ws;
  vec3 aX = texture(tPbrDiff, vec3(uvX, L)).rgb, aZ = texture(tPbrDiff, vec3(uvZ, L)).rgb;
  vec3 mX = texture(tPbrArm, vec3(uvX, L)).rgb, mZ = texture(tPbrArm, vec3(uvZ, L)).rgb;
  vec3 tX = texture(tPbrNor, vec3(uvX, L)).rgb * 2.0 - 1.0, tZ = texture(tPbrNor, vec3(uvZ, L)).rgb * 2.0 - 1.0;
  PbrS s;
  s.rel = clamp(mix(aZ, aX, wx) / M, 0.15, 3.0);
  vec3 arm = mix(mZ, mX, wx);
  s.ao = arm.r;
  s.rough = arm.g / R;
  vec3 nX = vec3(N.x, N.y + tX.y * nStr, N.z + tX.x * nStr);
  vec3 nZ = vec3(N.x + tZ.x * nStr, N.y + tZ.y * nStr, N.z);
  s.n = normalize(mix(nZ, nX, wx));
  return s;
}
`

const GROUND_FRAG = /* glsl */ `
{
  vec3 N = normalize(vWNrm);
  float slope = 1.0 - N.y;
  vec2 P = vWPos.xz;
  float camD = length(vViewPosition);
  float fine = 1.0 - smoothstep(8.0, 46.0, camD);
  float mid = 1.0 - smoothstep(30.0, 130.0, camD);
  float steep = smoothstep(0.2, 0.55, slope);
  vec2 Pc = P + vWPos.y * vec2(1.7, 0.9) * steep;
  float nLarge = fbm4(P * 0.03);
  float nMid = fbm4(P * 0.12 + 5.0);
  float nFine = mix(0.5, fbm4(Pc * 0.9), mid);
  float strata = sin(vWPos.y * 0.9 + nLarge * 9.0 + nMid * 3.0) * 0.5 + 0.5;

  // Ecological age of this exact point: 0 when the succession front arrives, negative while still scar.
  float rb = distance(P, uBasin);
  float rc = distance(P, uCore);
  float pass = min(rb / ${REACH.basin.toFixed(1)}, rc / ${REACH.core.toFixed(1)});
  float age = uVit - pass + (nMid - 0.5) * 0.11;

  // --- Scar rock: cracked plates with fissures (VP-VIS-011/012, Scar Tile Atlas I 05 Fissure Plains) ---
  vec2 warp = vec2(fbm4(Pc * 0.11), fbm4(Pc * 0.11 + 7.3)) - 0.5;
  vec2 warp2 = (vec2(vn(Pc * 0.9), vn(Pc * 0.9 + 3.1)) - 0.5) * fine;
  vec2 Pw = Pc + warp * 8.0 + warp2 * 0.9;
  vec3 vA = vor(Pw * 0.30);
  float edgeA = vA.y - vA.x;
  vec3 vB = vor(Pw * 1.35 + 3.0);
  float edgeB = mix(1.0, vB.y - vB.x, fine);
  float zoneF = smoothstep(0.30, 0.72, fbm4(P * 0.022 + 9.0));
  float rcr = distance(P, uCrystal);
  float rr = distance(P, uRidge);
  zoneF = clamp(zoneF + smoothstep(60.0, 8.0, rcr) * 0.3 + smoothstep(50.0, 6.0, rr) * 0.3, 0.0, 1.0);
  float gateA = smoothstep(0.47, 0.63, fbm4(P * 0.07 + 3.0));
  float gateB = smoothstep(0.50, 0.70, fbm4(P * 0.2 + 1.0));
  float aaA = fwidth(edgeA) * 1.4;
  float aaB = fwidth(edgeB) * 1.4;
  float crackA = (1.0 - smoothstep(0.0, max(0.045 + 0.05 * nMid, aaA), edgeA)) * zoneF * gateA;
  float crackB = (1.0 - smoothstep(0.0, max(0.07, aaB), edgeB)) * zoneF * gateB * 0.7 * fine;
  float crack = max(crackA, crackB) * (1.0 - 0.85 * steep);
  float crackCore = (1.0 - smoothstep(0.0, 0.016, min(edgeA, mix(1.0, edgeB, step(0.01, crackB)))));
  vec3 plateTint = mix(vec3(0.028, 0.029, 0.034), vec3(0.105, 0.108, 0.118), vA.z);
  vec3 rock = plateTint * (0.75 + 0.55 * nFine);
  rock = mix(rock, vec3(0.20, 0.17, 0.16), strata * smoothstep(0.25, 0.65, slope) * 0.55);
  rock = mix(rock, vec3(0.13, 0.022, 0.02), smoothstep(0.80, 0.94, nLarge + strata * 0.08) * (0.25 + 0.75 * steep));
  float ash = smoothstep(0.45, 0.75, fbm4(P * 0.045 + 21.0)) * smoothstep(0.5, 0.08, slope);
  rock = mix(rock, vec3(0.105, 0.098, 0.100) * (0.7 + 0.6 * nMid), ash * 0.75);

  // --- PBR detail layers (Ultra): real fissure / strata / ash structure over the procedural palette ---
  vec3 pbrMod = vec3(1.0); float pbrAO = 1.0; float pbrRoughRel = 1.0; float pf = 0.0;
  tPbrW = 0.0; tPbrN = N;
  if (uPbrMix > 0.001) {
    pf = uPbrMix * (1.0 - smoothstep(55.0, 185.0, camD));
    float bm = (1.0 - smoothstep(uWaterMin + 0.4, uWaterMin + 6.5, vWPos.y)) * (1.0 - smoothstep(34.0, 58.0, rb));
    float steepW = smoothstep(0.30, 0.62, slope);
    float ashW = clamp(max(ash, bm), 0.0, 1.0);
    float q1 = steepW, q0 = (1.0 - steepW) * (1.0 - ashW), q2 = (1.0 - steepW) * ashW;
    PbrS a = pbrTop(0.0, P, N, PBR_M0, PBR_R0, 3.2, 1.7);
    PbrS b = pbrTop(2.0, P, N, PBR_M2, PBR_R2, 2.8, 1.3);
    PbrS c = pbrWall(1.0, vWPos, N, PBR_M1, PBR_R1, 3.8, 1.7);
    vec3 rel = a.rel * q0 + b.rel * q2 + c.rel * q1;
    pbrMod = mix(vec3(1.0), pow(rel, vec3(1.4)), 0.95 * pf);
    pbrAO = mix(1.0, pow(a.ao * q0 + b.ao * q2 + c.ao * q1, 2.2), pf);
    pbrRoughRel = a.rough * q0 + b.rough * q2 + c.rough * q1;
    tPbrN = normalize(a.n * q0 + b.n * q2 + c.n * q1);
  }
  vec3 col = rock * mix(0.35, 1.0, 1.0 - crack);

  // --- Basin hardpan: dark cracked mud with pale mineral crust on the polygon rims (VP-VIS-017/031) ---
  float basinMask = (1.0 - smoothstep(uWaterMin + 0.4, uWaterMin + 6.5, vWPos.y)) * (1.0 - smoothstep(34.0, 58.0, rb));
  float rim = 1.0 - smoothstep(0.0, 0.11, edgeA);
  vec3 hardpan = mix(vec3(0.20, 0.13, 0.115), vec3(0.34, 0.25, 0.22), nMid) * mix(0.55, 1.0, smoothstep(0.0, 0.2, edgeA));
  hardpan = mix(hardpan, vec3(0.62, 0.56, 0.52), rim * 0.65 * smoothstep(0.35, 0.65, nLarge));
  col = mix(col, hardpan, basinMask * 0.9);
  crack *= 1.0 - basinMask;
  float wet = smoothstep(0.08, 0.5, uVit) * (1.0 - smoothstep(uWaterY, uWaterY + 3.2, vWPos.y)) * (1.0 - smoothstep(30.0, 58.0, rb));
  col *= 1.0 - 0.6 * wet;
  col *= pbrMod * pbrAO;

  // --- Succession (Frontier / Living tile atlases VP-VIS-042..044, life-spread timeline VP-VIS-005) ---
  float flatOk = smoothstep(0.62, 0.14, slope);
  float altOk = 1.0 - smoothstep(20.0, 36.0, vWPos.y) * 0.85;
  float ok = flatOk * altOk;
  // 1 weathering: ash and silica crust lift the blacks
  float w1 = smoothstep(-0.005, 0.03, age);
  col = mix(col, col * vec3(1.1, 1.02, 1.0) + vec3(0.035, 0.034, 0.034), w1 * 0.55);
  // 2 pioneer: rust-red soil, lichen / microbial film
  float pS = smoothstep(0.04, 0.13, age) * mix(0.45, 1.0, ok);
  vec3 rust = mix(vec3(0.085, 0.040, 0.030), vec3(0.150, 0.065, 0.040), nMid) * (0.8 + 0.5 * nFine);
  col = mix(col, rust, pS * smoothstep(0.1, 0.5, ok + 0.25));
  float filmN = fbm4(P * 0.55 + 2.0) + (age - 0.1) * 1.2;
  float film = smoothstep(0.48, 0.68, filmN) * smoothstep(0.05, 0.14, age) * (0.5 + 0.5 * ok);
  vec3 lichenCol = mix(vec3(0.17, 0.19, 0.045), vec3(0.09, 0.13, 0.05), nFine);
  lichenCol = mix(lichenCol, vec3(0.095, 0.05, 0.12), step(0.8, vn(P * 0.21 + 4.0)) * 0.7);
  col = mix(col, lichenCol, film * 0.9);
  // 3 soil and moss mats
  float soilW = smoothstep(0.14, 0.28, age) * ok;
  vec3 humus = mix(vec3(0.042, 0.030, 0.026), vec3(0.070, 0.048, 0.034), nMid);
  col = mix(col, humus, soilW * 0.85);
  float mossN = fbm4(P * 0.34 + 7.0) + (age - 0.22) * 1.5;
  float moss = smoothstep(0.42, 0.62, mossN) * smoothstep(0.15, 0.3, age) * (0.4 + 0.6 * ok);
  vec3 mossCol = mix(vec3(0.030, 0.085, 0.045), vec3(0.075, 0.150, 0.060), nFine);
  mossCol = mix(mossCol, vec3(0.20, 0.052, 0.030), step(0.86, vn(P * 0.4 + 11.0)) * smoothstep(0.3, 0.5, age));
  col = mix(col, mossCol, moss);
  // 4-5 shrub layer and mature closed cover
  float matW = smoothstep(0.34, 0.62, age) * ok;
  vec3 canopyFloor = mix(vec3(0.040, 0.095, 0.045), vec3(0.085, 0.150, 0.065), nMid);
  col = mix(col, canopyFloor, matW * 0.8);

  // --- Emissive: hot fissures cool as the front passes; teal mineral films; root network; stabilisation ring ---
  float cool = 1.0 - smoothstep(0.0, 0.07, age);
  float flicker = 0.75 + 0.25 * sin(uTime * 0.9 + vA.z * 6.283 + nLarge * 18.0);
  vec3 magma = mix(vec3(0.60, 0.040, 0.020), vec3(1.0, 0.36, 0.07), smoothstep(0.35, 0.95, nMid + crackB * 0.4));
  tEmis = mix(magma, vec3(1.0, 0.62, 0.25), crackCore * crack) * crack * cool * flicker * 1.5;
  float ring = exp(-pow((rc - uPulse) / 5.0, 2.0)) * step(0.5, uPulse) * (1.0 - smoothstep(180.0, 320.0, uPulse));
  float glintBand = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.08, 0.2, age));
  float glint = smoothstep(0.9, 0.97, vn(Pc * 2.1)) * fine * (glintBand * 0.8 + (1.0 - smoothstep(-0.02, 0.0, age)) * (0.08 + uAct) * smoothstep(170.0, 15.0, rc)) * 0.3;
  tEmis += vec3(0.08, 0.95, 0.80) * ring * 0.9 + vec3(0.04, 0.72, 0.62) * glint;
  float net = (1.0 - smoothstep(0.0, max(0.02, aaA), edgeA)) * mid * smoothstep(0.06, 0.16, age) * (1.0 - smoothstep(0.3, 0.55, age));
  vec3 netCol = mix(vec3(0.85, 0.20, 0.06), vec3(0.05, 0.78, 0.68), smoothstep(90.0, 25.0, rc));
  tEmis += netCol * net * 0.3 * (0.6 + 0.4 * sin(uTime * 1.3 + vA.z * 9.0));

  float cover = max(max(film, moss), soilW);
  float glass = smoothstep(0.55, 0.8, vA.z) * (1.0 - ash) * (1.0 - w1);
  tRough = mix(0.88, 0.46, glass);
  tRough = mix(tRough, 0.96, cover);
  tRough = mix(tRough, 0.4, wet * (1.0 - moss));
  tRough = mix(tRough, clamp(tRough * pbrRoughRel, 0.2, 1.0), pf * (1.0 - cover));
  tPbrW = pf * (1.0 - 0.65 * cover);
  tBump = smoothstep(0.0, 0.22, edgeA) * 0.9 + vn(Pc * 1.7) * 0.35 * mid + vn(Pc * 5.3) * 0.2 * fine - (1.0 - smoothstep(0.0, 0.07, edgeB)) * 0.3 * fine;
  tBump *= mix(1.0, 0.45, max(soilW, moss));
  tBump *= mix(1.0, 0.5, pf);
  if (uPbrDbg > 0.5) {
    tEmis = vec3(0.0);
    if (uPbrDbg < 1.5) col = 0.35 * pbrMod;
    else if (uPbrDbg < 2.5) col = tPbrN * 0.5 + 0.5;
    else if (uPbrDbg < 3.5) col = vec3(0.6 * pbrAO);
    else col = vec3(0.4 * pbrRoughRel);
  }
  diffuseColor.rgb = col;
}
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

  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, envMapIntensity: 0.3 })
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uTime: U.uTime, uVit: U.uVit, uAct: U.uAct, uPulse: U.uPulse, uWaterY: U.uWaterY, uWaterMin: U.uWaterMin, uBasin: U.uBasin, uCore: U.uCore,
      uCrystal: U.uCrystal, uRidge: U.uRidge,
      uPbrMix: PBR.mix, uPbrDbg: PBR.dbg, tPbrDiff: PBR.diff, tPbrNor: PBR.nor, tPbrArm: PBR.arm,
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime, uVit, uAct, uPulse, uWaterY, uWaterMin;
uniform vec2 uBasin, uCore, uCrystal, uRidge;
varying vec3 vWPos; varying vec3 vWNrm;
float tRough; vec3 tEmis; float tBump; vec3 tPbrN; float tPbrW;
${NOISE}
${VORONOI}
${PBR_GLSL}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_FRAG}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (tPbrW > 0.001) {
  vec3 nvPbr = normalize((viewMatrix * vec4(tPbrN, 0.0)).xyz);
  normal = normalize(mix(normal, nvPbr, tPbrW));
}
{
  vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
  float hx = dFdx(tBump); float hy = dFdy(tBump);
  vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  normal = normalize(abs(det) * normal - 0.35 * grad * (1.0 - smoothstep(14.0, 70.0, length(vViewPosition))));
}`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmis;')
  }
  mat.customProgramCacheKey = () => 'vorkath-terrain-v3'

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
