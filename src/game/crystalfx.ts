import * as THREE from 'three'
import { PBR } from './pbr'

/**
 * Ultra-tier crystal look for any instanced MeshStandard/Physical material (V2 outcrops, hero cluster, fill spikes).
 * Everything is gated by the shared PBR mix, so the Ultra A/B toggle shows the old flat-faced look when off.
 *  - per-facet identity (hash of the quantised face normal + instance seed): each facet gets its own tilt,
 *    brightness and roughness, which is what makes cut crystal sparkle instead of reading as flat plastic
 *  - triplanar weathering micro-normal, pit roughness and crevice AO from the dark_rock_02 PBR layer
 *  - Fresnel rim glow in the crystal's own hue (feeds bloom), brighter on rim facets
 * No new geometry or textures: it reuses the already-loaded KTX2 arrays.
 */
const VERT_COMMON = `#include <common>
varying vec3 vCxW;
varying float vCxS;`
const VERT_BEGIN = `#include <begin_vertex>
{
  vec4 cxW4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  cxW4 = instanceMatrix * cxW4;
  vCxS = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
  vCxS = 0.5;
  #endif
  vCxW = (modelMatrix * cxW4).xyz;
}`
const FRAG_COMMON = `#include <common>
varying vec3 vCxW;
varying float vCxS;
uniform float uPbrMix;
uniform highp sampler2DArray tPbrNor;
uniform highp sampler2DArray tPbrArm;`
const FRAG_COLOR = `#include <color_fragment>
float cfx = uPbrMix * (1.0 - smoothstep(30.0, 115.0, length(vViewPosition)));
vec3 cfxN = vec3(0.0, 1.0, 0.0);
float cfxFace = 0.5;
float cfxRg = 0.0;
if (cfx > 0.002) {
  vec3 gn = normalize(cross(dFdx(vCxW), dFdy(vCxW)));
  vec3 q = floor(gn * 40.0 + 0.5) + 31.7 + vCxS * 17.0;
  cfxFace = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 wt = pow(abs(gn), vec3(4.0)); wt /= (wt.x + wt.y + wt.z + 1e-4);
  vec2 uvX = vec2(vCxW.z, -vCxW.y) / 0.9, uvY = vec2(vCxW.x, vCxW.z) / 0.9, uvZ = vec2(vCxW.x, -vCxW.y) / 0.9;
  vec3 tX = texture(tPbrNor, vec3(uvX, 1.0)).rgb * 2.0 - 1.0;
  vec3 tY = texture(tPbrNor, vec3(uvY, 1.0)).rgb * 2.0 - 1.0;
  vec3 tZ = texture(tPbrNor, vec3(uvZ, 1.0)).rgb * 2.0 - 1.0;
  vec3 aX = texture(tPbrArm, vec3(uvX, 1.0)).rgb, aY = texture(tPbrArm, vec3(uvY, 1.0)).rgb, aZ = texture(tPbrArm, vec3(uvZ, 1.0)).rgb;
  vec3 nX = vec3(gn.x, gn.y + tX.y * 0.45, gn.z + tX.x * 0.45);
  vec3 nY = vec3(gn.x + tY.x * 0.45, gn.y, gn.z - tY.y * 0.45);
  vec3 nZ = vec3(gn.x + tZ.x * 0.45, gn.y + tZ.y * 0.45, gn.z);
  vec3 tilt = vec3(fract(cfxFace * 7.31), fract(cfxFace * 13.7), fract(cfxFace * 3.17)) - 0.5;
  cfxN = normalize(nX * wt.x + nY * wt.y + nZ * wt.z + tilt * 0.16);
  vec3 arm = aX * wt.x + aY * wt.y + aZ * wt.z;
  cfxRg = arm.g - 0.82;
  diffuseColor.rgb *= mix(1.0, (0.78 + 0.44 * cfxFace) * mix(1.0, pow(arm.r, 1.6), 0.6), cfx);
}`
const FRAG_ROUGH = `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(roughnessFactor, roughnessFactor * (0.7 + 0.6 * cfxFace) + cfxRg * 0.5, cfx), 0.05, 0.85);`
const FRAG_NORMAL = `#include <normal_fragment_maps>
if (cfx > 0.002) { normal = normalize(mix(normal, normalize((viewMatrix * vec4(cfxN, 0.0)).xyz), cfx * 0.9)); }`
const FRAG_EMIS = `#include <emissivemap_fragment>
if (cfx > 0.002) {
  float cfxNV = abs(dot(normalize(vViewPosition), normal));
  vec3 cfxHue = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.03));
  totalEmissiveRadiance += cfxHue * (pow(1.0 - cfxNV, 2.4) * (0.35 + 0.5 * cfxFace)) * cfx * uCfxGlow;
}`

export function enhanceCrystal(mat: THREE.Material, id: string, glow = 0.7): void {
  const prev = mat.onBeforeCompile
  const prevKey = mat.customProgramCacheKey
  mat.onBeforeCompile = (s, r) => {
    prev?.call(mat, s, r)
    s.uniforms.uPbrMix = PBR.mix
    s.uniforms.tPbrNor = PBR.nor
    s.uniforms.tPbrArm = PBR.arm
    s.vertexShader = s.vertexShader.replace('#include <common>', VERT_COMMON).replace('#include <begin_vertex>', VERT_BEGIN)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', FRAG_COMMON + `\nconst float uCfxGlow = ${glow.toFixed(2)};`)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAG_EMIS)
  }
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}+cfx1-${id}-${glow}`
  mat.needsUpdate = true
}
