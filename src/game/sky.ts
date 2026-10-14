import * as THREE from 'three'
import { U } from './uniforms'
import { lerp } from '../engine/noise'

const SKY_FRAG = /* glsl */ `
uniform float uTime, uVit, uAct;
uniform vec3 uSunDir, uSunCol, uHorizon, uZenith;
varying vec3 vDir;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm5(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.07 + 11.3; a *= .5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
  // below-horizon fill so the dome never shows a seam
  col = mix(col, uHorizon * 0.5, smoothstep(0.0, -0.3, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 90.0) * 1.1 + pow(sd, 8.0) * 0.22);
  // Drifting cloud deck: dust and ash first, cleaner cloud as the planet recovers.
  vec2 cuv = d.xz / (d.y + 0.22) * 0.9 + uTime * vec2(0.010, 0.004);
  float c = fbm5(cuv * 1.3);
  float cloud = smoothstep(0.46, 0.78, c) * smoothstep(0.0, 0.22, d.y);
  vec3 cloudLit = mix(uHorizon * 0.55, uSunCol * 0.95, pow(sd, 1.5) * 0.7 + 0.15);
  cloudLit = mix(cloudLit, vec3(0.78, 0.76, 0.72), uVit * 0.5);
  col = mix(col, cloudLit, cloud * mix(0.78, 0.55, uVit));
  // Stars show through the thin barren sky.
  vec2 sp = d.xz / (d.y + 1.2) * 260.0;
  float star = step(0.9972, h21(floor(sp))) * smoothstep(0.1, 0.5, h) * (1.0 - cloud) * (1.0 - uVit * 0.8);
  col += vec3(0.9, 0.85, 0.8) * star * 0.9;
  // Faint Life-Core aurora ribbons when the core is awake.
  float au = smoothstep(0.55, 1.0, sin(d.x * 5.0 + fbm5(d.xz * 2.0 + uTime * 0.03) * 5.0) * 0.5 + 0.5) * smoothstep(0.25, 0.7, h) * (1.0 - smoothstep(0.7, 1.0, h));
  col += vec3(0.05, 0.75, 0.62) * au * uAct * 0.28;
  gl_FragColor = vec4(col, 1.0);
}`

export class SkyDome {
  readonly mesh: THREE.Mesh
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uVit: U.uVit, uAct: U.uAct, uSunDir: U.uSunDir, uSunCol: U.uSunCol, uHorizon: U.uHorizon, uZenith: U.uZenith },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -10
    this.mesh.name = 'sky'
  }
}

const C = (hex: string) => new THREE.Color(hex)
const BARREN = { horizon: C('#8a2f1f'), zenith: C('#1a0e12'), sun: C('#ff8a55'), hemiSky: C('#6a3a38'), hemiGround: C('#1a0e0c'), fog: C('#6b261b') }
const RECOVERED = { horizon: C('#d49a6a'), zenith: C('#3d6368'), sun: C('#ffd2a0'), hemiSky: C('#8fb0a8'), hemiGround: C('#2c3a24'), fog: C('#b98a6a') }

/** Sun, hemisphere light and fog that drift with time of day and ecological vitality. */
export class Lighting {
  readonly sun = new THREE.DirectionalLight('#ff9a66', 3.2)
  readonly hemi = new THREE.HemisphereLight('#6a3a38', '#1a0e0c', 0.9)
  readonly fog = new THREE.FogExp2('#6b261b', 0.0032)
  private readonly tmp = new THREE.Color()
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
    scene.add(this.sun, this.sun.target, this.hemi)
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
  update(time: number, vit: number, _act: number, focus: THREE.Vector3): void {
    // Slow time-of-day drift between a low, red sun and a higher, paler one.
    const phase = 0.5 + 0.5 * Math.sin(time * 0.018 + 0.6)
    const elev = lerp(0.2, 0.55, phase)
    const az = -0.75 + Math.sin(time * 0.009) * 0.2
    U.uSunDir.value.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize()
    this.sun.position.copy(focus).addScaledVector(U.uSunDir.value, 160)
    this.sun.target.position.copy(focus)
    this.sun.target.updateMatrixWorld()

    const k = Math.min(1, vit * 1.1)
    U.uHorizon.value.copy(BARREN.horizon).lerp(RECOVERED.horizon, k)
    U.uZenith.value.copy(BARREN.zenith).lerp(RECOVERED.zenith, k)
    U.uSunCol.value.copy(BARREN.sun).lerp(RECOVERED.sun, k)
    // Warmer light near the horizon.
    this.tmp.copy(U.uSunCol.value).multiplyScalar(lerp(0.9, 1.05, phase))
    this.sun.color.copy(this.tmp)
    this.sun.intensity = lerp(2.6, 3.6, phase) * lerp(1, 1.1, k)
    this.hemi.color.copy(BARREN.hemiSky).lerp(RECOVERED.hemiSky, k)
    this.hemi.groundColor.copy(BARREN.hemiGround).lerp(RECOVERED.hemiGround, k)
    this.hemi.intensity = lerp(0.85, 1.15, k)
    this.fog.color.copy(BARREN.fog).lerp(RECOVERED.fog, k)
    this.fog.density = lerp(0.0034, 0.0016, k)
  }
}
