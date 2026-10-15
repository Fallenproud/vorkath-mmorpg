import * as THREE from 'three'
import { U } from './uniforms'
import { lerp } from '../engine/noise'

/**
 * Sky dome: crimson horizon, near-black zenith, a large cratered red moon/star disc, smoky storm cloud with
 * occasional lightning, and Life-Core aurora. Visual targets: VP-VIS-011/013/017/018 (red moon over black
 * terrain), VP-VIS-034 (storm cloud with lightning). The moon disc sits on the key-light direction, so the
 * red light that models the terrain visibly comes from it. Palette follows VP-VIS-060 (no navy).
 */
const SKY_FRAG = /* glsl */ `
uniform float uTime, uVit, uAct, uFlash;
uniform vec3 uSunDir, uSunCol, uHorizon, uZenith;
varying vec3 vDir;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm5(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.07 + 11.3; a *= .5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
  col += uHorizon * exp(-pow(d.y * 7.0, 2.0)) * 0.55;
  col = mix(col, uHorizon * 0.28, smoothstep(0.0, -0.25, d.y));

  // Red moon: cratered disc, limb darkening, halo.
  float md = dot(d, uSunDir);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uSunDir));
  vec3 upv = cross(uSunDir, right);
  float R = 0.085;
  vec2 q = vec2(dot(d, right), dot(d, upv)) / R;
  float rr = length(q);
  if (md > 0.0) {
    float disc = 1.0 - smoothstep(0.97, 1.0, rr);
    float surf = fbm5(q * 2.3 + 3.0);
    float crater = smoothstep(0.64, 0.72, vn(q * 5.5 + 1.0)) * (0.5 + 0.5 * vn(q * 11.0));
    vec3 moon = mix(vec3(0.22, 0.020, 0.018), vec3(0.95, 0.20, 0.10), surf);
    moon *= 1.0 - 0.5 * crater;
    moon *= 0.5 + 0.7 * sqrt(max(1.0 - rr * rr, 0.0));
    col = mix(col, moon * 1.55, disc);
    col += vec3(0.85, 0.10, 0.06) * (exp(-pow(max(rr - 1.0, 0.0) * 1.4, 2.0)) * 0.42 + pow(md, 8.0) * 0.16) * (1.0 - disc * 0.7);
  }

  // Smoky cloud deck, lit red from below-left by the moon; pale grey-green as the planet recovers.
  vec2 cuv = d.xz / (d.y + 0.2) * 0.85 + uTime * vec2(0.010, 0.004);
  float c = fbm5(cuv * 1.25);
  float cloud = smoothstep(0.44, 0.78, c) * smoothstep(0.0, 0.2, d.y);
  float lit = pow(max(md, 0.0), 2.0) * 0.8 + 0.12;
  vec3 cloudLit = mix(uHorizon * 0.32, uSunCol * 0.9, lit);
  cloudLit = mix(cloudLit, vec3(0.50, 0.50, 0.46), uVit * 0.5);
  cloudLit += vec3(0.95, 0.80, 0.90) * uFlash * (0.4 + 0.6 * vn(cuv * 3.0));
  col = mix(col, cloudLit, cloud * mix(0.84, 0.6, uVit));
  col += vec3(0.8, 0.62, 0.72) * uFlash * 0.18 * smoothstep(0.0, 0.3, d.y);

  // Stars through the thin barren sky.
  vec2 sp = d.xz / (d.y + 1.2) * 260.0;
  float star = step(0.9972, h21(floor(sp))) * smoothstep(0.1, 0.5, h) * (1.0 - cloud) * (1.0 - uVit * 0.75);
  col += vec3(0.9, 0.85, 0.8) * star * 0.9;

  // Faint Life-Core aurora ribbons when the core is awake.
  float au = smoothstep(0.55, 1.0, sin(d.x * 5.0 + fbm5(d.xz * 2.0 + uTime * 0.03) * 5.0) * 0.5 + 0.5) * smoothstep(0.25, 0.7, h) * (1.0 - smoothstep(0.7, 1.0, h));
  col += vec3(0.05, 0.75, 0.62) * au * uAct * 0.28;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export class SkyDome {
  readonly mesh: THREE.Mesh
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uVit: U.uVit, uAct: U.uAct, uFlash: U.uFlash, uSunDir: U.uSunDir, uSunCol: U.uSunCol, uHorizon: U.uHorizon, uZenith: U.uZenith },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 24), mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -10
    this.mesh.name = 'sky'
  }
}

const C = (hex: string) => new THREE.Color(hex)
// Barren palette: locked identity palette crimson (#7A1C24) on near-black; recovered: dusty rose-amber and dark teal-grey.
const BARREN = { horizon: C('#6c1418'), zenith: C('#0b0a0e'), sun: C('#e07a5c'), hemiSky: C('#3c2427'), hemiGround: C('#0e0909'), fog: C('#2c0d0e') }
const RECOVERED = { horizon: C('#b0705a'), zenith: C('#23302f'), sun: C('#ffc89a'), hemiSky: C('#718a82'), hemiGround: C('#1d2a1b'), fog: C('#3e3a34') }

/** Sun/moon key light, hemisphere light and fog that drift with time of day and ecological vitality. */
export class Lighting {
  readonly sun = new THREE.DirectionalLight('#ff7a4a', 3.4)
  readonly hemi = new THREE.HemisphereLight('#3c2427', '#0e0909', 0.9)
  /** Counter-light from the opposite horizon (teal-tinted once the Life-Core is awake) so shaded faces keep form. */
  readonly rim = new THREE.DirectionalLight('#7a2a30', 0.6)
  readonly fog = new THREE.FogExp2('#2c0d0e', 0.0042)
  private readonly tmp = new THREE.Color()
  private flashT = 0
  private nextFlash = 14
  constructor(scene: THREE.Scene, shadowSize: number, shadows: boolean) {
    this.sun.castShadow = shadows
    this.sun.shadow.mapSize.set(shadowSize, shadowSize)
    const cam = this.sun.shadow.camera
    cam.near = 1
    cam.far = 320
    cam.left = cam.bottom = -70
    cam.right = cam.top = 70
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.6
    scene.add(this.sun, this.sun.target, this.hemi, this.rim, this.rim.target)
    scene.fog = this.fog
  }
  setShadows(on: boolean, size: number): void {
    this.sun.castShadow = on
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
      this.sun.shadow.mapSize.set(size, size)
    }
  }
  /** `focus` keeps the shadow frustum centred on the area being looked at. */
  update(time: number, vit: number, act: number, focus: THREE.Vector3, dt = 1 / 60): void {
    // Slow time-of-day drift between a low red moon and a higher, paler one.
    const phase = 0.5 + 0.5 * Math.sin(time * 0.018 + 0.6)
    const elev = lerp(0.1, 0.3, phase)
    const az = -0.75 + Math.sin(time * 0.009) * 0.2
    U.uSunDir.value.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize()
    this.sun.position.copy(focus).addScaledVector(U.uSunDir.value, 160)
    this.sun.target.position.copy(focus)
    this.sun.target.updateMatrixWorld()
    this.rim.position.copy(focus).addScaledVector(U.uSunDir.value, -120).add(new THREE.Vector3(0, 70, 0))
    this.rim.target.position.copy(focus)
    this.rim.target.updateMatrixWorld()

    const k = Math.min(1, vit * 1.1)
    U.uHorizon.value.copy(BARREN.horizon).lerp(RECOVERED.horizon, k)
    U.uZenith.value.copy(BARREN.zenith).lerp(RECOVERED.zenith, k)
    U.uSunCol.value.copy(BARREN.sun).lerp(RECOVERED.sun, k)
    this.tmp.copy(U.uSunCol.value).multiplyScalar(lerp(0.9, 1.05, phase))
    this.sun.color.copy(this.tmp)
    this.sun.intensity = lerp(2.1, 2.7, phase) * lerp(1, 1.2, k)
    this.hemi.color.copy(BARREN.hemiSky).lerp(RECOVERED.hemiSky, k)
    this.hemi.groundColor.copy(BARREN.hemiGround).lerp(RECOVERED.hemiGround, k)
    this.hemi.intensity = lerp(1.0, 1.2, k)
    this.rim.color.set('#7a2a30').lerp(this.tmp.set('#2a8a80'), Math.min(1, act * 0.6 + k * 0.4))
    this.rim.intensity = lerp(0.55, 0.45, k)
    this.fog.color.copy(BARREN.fog).lerp(RECOVERED.fog, k)
    this.fog.density = lerp(0.0042, 0.0016, k)

    // Distant storm: rare lightning in the barren sky, fading out as the planet recovers.
    this.nextFlash -= dt
    if (this.nextFlash <= 0) {
      this.flashT = 0.45
      this.nextFlash = 9 + Math.random() * 16
    }
    this.flashT = Math.max(0, this.flashT - dt)
    const f = this.flashT > 0 ? (Math.sin(this.flashT * 40) * 0.5 + 0.5) * Math.min(1, this.flashT * 5) : 0
    U.uFlash.value = f * (1 - k * 0.8)
  }
}

/** Image-based lighting: a small procedural dusk (crimson horizon, dark zenith, red moon) baked once through PMREM. */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { moon: { value: new THREE.Vector3(0.62, 0.3, -0.72).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; uniform vec3 moon;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 col = mix(vec3(0.34, 0.05, 0.055), vec3(0.015, 0.014, 0.02), pow(max(h, 0.0), 0.5));
        col = mix(col, vec3(0.025, 0.012, 0.012), smoothstep(0.0, -0.4, h));
        float m = max(dot(d, moon), 0.0);
        col += vec3(1.0, 0.25, 0.12) * (pow(m, 90.0) * 6.0 + pow(m, 10.0) * 0.5);
        col += vec3(0.02, 0.28, 0.25) * smoothstep(-0.2, -0.9, h) * 0.4;
        gl_FragColor = vec4(col, 1.0); }`,
  })
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat))
  const pm = new THREE.PMREMGenerator(renderer)
  const tex = pm.fromScene(scene, 0.03).texture
  pm.dispose()
  mat.dispose()
  return tex
}
