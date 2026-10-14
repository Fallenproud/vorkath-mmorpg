import * as THREE from 'three'
import { mulberry32 } from '../engine/noise'

const NOISE3 = /* glsl */ `
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 6; i++){ s += a * vn3(p); p = p * 2.03 + 1.7; a *= .5; } return s; }
`

const PLANET_FRAG = /* glsl */ `
uniform vec3 uSun; uniform float uTime; uniform vec3 uMark; uniform float uHeal;
varying vec3 vN; varying vec3 vP; varying vec3 vWN;
${NOISE3}
void main(){
  vec3 p = normalize(vP);
  float h = fbm3(p * 3.0);
  vec3 base = mix(vec3(0.030, 0.027, 0.032), vec3(0.17, 0.075, 0.062), smoothstep(0.38, 0.72, h));
  float r = 1.0 - abs(fbm3(p * 7.0 + 3.0) * 2.0 - 1.0);
  float scar = smoothstep(0.935, 0.985, r);
  base += vec3(0.95, 0.13, 0.05) * scar * 0.95;
  float lc = smoothstep(0.80, 0.92, vn3(p * 15.0 + 9.0)) * smoothstep(0.5, 0.68, fbm3(p * 2.0 + 5.0));
  base += vec3(0.08, 0.95, 0.78) * lc * 0.9 * (0.65 + 0.35 * sin(uTime * 2.0 + p.x * 30.0));
  float md = distance(p, normalize(uMark));
  base += vec3(0.2, 1.0, 0.85) * smoothstep(0.075, 0.0, md) * (0.75 + 0.25 * sin(uTime * 3.0)) * 1.4;
  base += vec3(0.1, 0.5, 0.3) * smoothstep(0.2, 0.02, md) * uHeal * 0.4;
  float nd = dot(normalize(vWN), normalize(uSun));
  float diff = smoothstep(-0.12, 0.65, nd);
  vec3 col = base * (0.12 + diff * 1.45);
  float cl = smoothstep(0.54, 0.78, fbm3(p * vec3(2.2, 4.2, 2.2) + vec3(uTime * 0.012, 0.0, uTime * 0.006)));
  vec3 cloudCol = mix(vec3(0.20, 0.09, 0.08), vec3(0.88, 0.58, 0.46), diff);
  col = mix(col, cloudCol * (0.18 + diff * 0.95), cl * 0.55);
  col += vec3(0.9, 0.25, 0.1) * pow(1.0 - abs(nd), 8.0) * diff * 0.12;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
varying vec3 vN; varying vec3 vV; varying vec3 vWN;
void main(){
  float g = pow(max(0.0, 1.0 + dot(normalize(vN), normalize(vV))), 3.2);
  float lit = smoothstep(-0.35, 0.5, dot(normalize(vWN), normalize(uSun)));
  vec3 c = mix(vec3(0.95, 0.28, 0.12), vec3(0.15, 0.85, 0.75), pow(g, 3.0) * 0.45);
  gl_FragColor = vec4(c * g * (0.15 + lit), g * (0.2 + lit * 0.9));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vV; varying vec3 vWN;
void main(){ vP = position; vN = normalize(normalMatrix * normal); vWN = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`

/**
 * Planetary-scale scene used by the opening and the teaser: Vorath Prime as a charcoal world
 * threaded with glowing red fractures and faint turquoise Life-Core sites, with a marker over the
 * Scarred Frontier.
 */
export class OrbitScene {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200)
  private readonly planet: THREE.Mesh
  private readonly uniforms: { uSun: { value: THREE.Vector3 }; uTime: { value: number }; uMark: { value: THREE.Vector3 }; uHeal: { value: number } }
  /** Surface point (unit sphere) of the Scarred Frontier. */
  readonly mark = new THREE.Vector3(0.35, 0.28, 0.9).normalize()

  constructor() {
    this.scene.background = new THREE.Color('#020103')
    this.uniforms = { uSun: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() }, uTime: { value: 0 }, uMark: { value: this.mark.clone() }, uHeal: { value: 0 } }
    this.planet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: PLANET_FRAG }),
    )
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.07, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uSun: this.uniforms.uSun }, vertexShader: VERT, fragmentShader: ATMO_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      }),
    )
    this.scene.add(this.planet, atmo)

    const rnd = mulberry32(7)
    const n = 2600
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i += 1) {
      const u = rnd() * 2 - 1
      const a = rnd() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const R = 90
      pos.set([s * Math.cos(a) * R, u * R, s * Math.sin(a) * R], i * 3)
      const w = 0.4 + rnd() * 0.6
      col.set([w, w * (0.85 + rnd() * 0.2), w * (0.8 + rnd() * 0.2)], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false })))

    // Debris/ring arc: a thin band of dark rock fragments in low orbit.
    const dn = 700
    const dp = new Float32Array(dn * 3)
    for (let i = 0; i < dn; i += 1) {
      const a = rnd() * Math.PI * 2
      const r = 1.55 + rnd() * 0.22
      dp.set([Math.cos(a) * r, (rnd() - 0.5) * 0.015 + Math.sin(a * 3) * 0.01, Math.sin(a) * r], i * 3)
    }
    const dg = new THREE.BufferGeometry()
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
    const debris = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#8a5a48', size: 0.012, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false }))
    debris.rotation.set(0.35, 0, 0.18)
    this.scene.add(debris)
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  setHeal(v: number): void {
    this.uniforms.uHeal.value = v
  }

  /** Frame the planet from `distance` radii away, looking at the Frontier marker region. */
  pose(time: number, distance: number, swing: number, lift: number, aimAtMark: number): void {
    this.uniforms.uTime.value = time
    const m = this.mark
    // Orbit around the marker's longitude so the Frontier slowly rotates into view.
    const az = Math.atan2(m.x, m.z) + swing
    const el = Math.asin(m.y) * 0.6 + lift
    this.camera.position.set(Math.sin(az) * Math.cos(el) * distance, Math.sin(el) * distance, Math.cos(az) * Math.cos(el) * distance)
    const aim = new THREE.Vector3().copy(m).multiplyScalar(aimAtMark)
    this.camera.lookAt(aim)
  }
}
