import * as THREE from 'three'
import { mulberry32, noise2 } from '../engine/noise'
import { POI } from './layout'
import { U } from './uniforms'

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSize, uScale;
uniform vec3 uCenter, uExtent, uVel;
uniform vec2 uWind;
varying float vAlpha;
varying float vTw;
void main(){
  vec3 drift = uVel + vec3(uWind.x, 0.0, uWind.y) * 0.6;
  vec3 p = fract(aSeed.xyz + drift * uTime / uExtent);
  vec3 pos = uCenter + (p - 0.5) * uExtent;
  pos.x += sin(uTime * 0.7 + aSeed.w * 40.0) * 0.6;
  pos.z += cos(uTime * 0.6 + aSeed.w * 31.0) * 0.6;
  pos.y += sin(uTime * 1.1 + aSeed.w * 23.0) * 0.25;
  vec3 e = abs(p - 0.5) * 2.0;
  vAlpha = (1.0 - smoothstep(0.75, 1.0, max(e.x, max(e.y, e.z))));
  vTw = 0.6 + 0.4 * sin(uTime * (2.0 + aSeed.w * 4.0) + aSeed.w * 90.0);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_PointSize = uSize * (0.6 + aSeed.w) * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTwinkle;
varying float vAlpha; varying float vTw;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  float tw = mix(1.0, vTw, uTwinkle);
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity * tw);
}`

interface MoteOpts {
  count: number
  extent: THREE.Vector3
  vel: THREE.Vector3
  color: string
  size: number
  additive: boolean
  twinkle?: number
  follow?: boolean
  center?: THREE.Vector3
}

class Motes {
  readonly points: THREE.Points
  readonly mat: THREE.ShaderMaterial
  constructor(private readonly o: MoteOpts, seed: number) {
    const rnd = mulberry32(seed)
    const arr = new Float32Array(o.count * 4)
    for (let i = 0; i < arr.length; i += 1) arr[i] = rnd()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.count * 3), 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(arr, 4))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime, uWind: U.uWind, uSize: { value: o.size }, uScale: { value: 600 },
        uCenter: { value: (o.center ?? new THREE.Vector3()).clone() }, uExtent: { value: o.extent }, uVel: { value: o.vel },
        uColor: { value: new THREE.Color(o.color) }, uOpacity: { value: 1 }, uTwinkle: { value: o.twinkle ?? 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.points = new THREE.Points(geo, this.mat)
    this.points.frustumCulled = false
  }
  set opacity(v: number) {
    this.mat.uniforms.uOpacity.value = v
    this.points.visible = v > 0.003
  }
  place(c: THREE.Vector3): void {
    this.mat.uniforms.uCenter.value.copy(c)
  }
  get follow(): boolean {
    return !!this.o.follow
  }
}

interface Burst {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  max: number
  r: number
  g: number
  b: number
  grav: number
}

export interface BurstOpts {
  count: number
  color: string
  speed: number
  life: number
  up?: number
  gravity?: number
  spread?: number
}

/** All ambient particles (dust, embers, spores, motes) plus pooled event bursts and flowing energy. */
export class Atmosphere {
  readonly group = new THREE.Group()
  private readonly motes: Record<string, Motes> = {}
  private readonly bursts: Burst[] = []
  private readonly burstGeo: THREE.BufferGeometry
  private readonly burstPoints: THREE.Points
  private readonly maxBursts = 600
  private readonly flow: THREE.Points
  private readonly flowU: Float32Array
  private readonly flowSpeed: Float32Array
  private flowPath: THREE.Vector3[] = []
  private readonly rnd = mulberry32(99)

  constructor(flowPaths: THREE.Vector3[], quality: number) {
    const q = (n: number) => Math.max(40, Math.round(n * quality))
    const add = (key: string, o: MoteOpts, seed: number) => {
      const m = new Motes(o, seed)
      this.motes[key] = m
      this.group.add(m.points)
    }
    add('dust', { count: q(900), extent: new THREE.Vector3(130, 36, 130), vel: new THREE.Vector3(3.2, 0.1, 1.2), color: '#6a3a34', size: 6, additive: false, follow: true }, 1)
    add('spores', { count: q(420), extent: new THREE.Vector3(90, 18, 90), vel: new THREE.Vector3(0.6, 0.35, 0.2), color: '#d8e6a0', size: 1.0, additive: true, twinkle: 0.7, follow: true }, 2)
    add('embers', { count: q(260), extent: new THREE.Vector3(60, 22, 60), vel: new THREE.Vector3(0.2, 3.4, 0.1), color: '#ff6a2a', size: 0.9, additive: true, twinkle: 0.8, center: new THREE.Vector3(POI.core.x, 12, POI.core.z) }, 3)
    add('corelife', { count: q(320), extent: new THREE.Vector3(50, 30, 50), vel: new THREE.Vector3(0, 2.2, 0), color: '#35f2d2', size: 1.0, additive: true, twinkle: 0.5, center: new THREE.Vector3(POI.core.x, 14, POI.core.z) }, 4)
    add('sparkle', { count: q(240), extent: new THREE.Vector3(110, 12, 110), vel: new THREE.Vector3(0.05, 0.25, 0.05), color: '#8ff7e8', size: 1.1, additive: true, twinkle: 1, center: new THREE.Vector3(POI.crystal.x, 6, POI.crystal.z) }, 5)
    add('mist', { count: q(120), extent: new THREE.Vector3(120, 5, 120), vel: new THREE.Vector3(0.8, 0.02, 0.4), color: '#7f9a92', size: 60, additive: false, center: new THREE.Vector3(POI.basin.x, 2, POI.basin.z) }, 6)

    const n = 70
    const pos = new Float32Array(n * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.flow = new THREE.Points(g, new THREE.PointsMaterial({ color: '#4ff7da', size: 0.7, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }))
    this.flow.frustumCulled = false
    this.flowU = new Float32Array(n)
    this.flowSpeed = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      this.flowU[i] = this.rnd()
      this.flowSpeed[i] = 0.6 + this.rnd() * 0.8
    }
    this.flowPath = flowPaths
    this.group.add(this.flow)

    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxBursts * 3), 3))
    bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.maxBursts * 3), 3))
    bg.setDrawRange(0, 0)
    bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.burstGeo = bg
    this.burstPoints = new THREE.Points(bg, new THREE.PointsMaterial({ size: 0.34, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }))
    this.burstPoints.frustumCulled = false
    this.group.add(this.burstPoints)
    this.group.name = 'atmosphere'
  }

  /** Slowly varying wind with gusts; writes the shared uniform. */
  updateWind(time: number, vit: number): number {
    const dir = 0.45 + noise2(time * 0.01, 3) * 1.1
    const gust = 0.55 + 0.9 * Math.pow(noise2(time * 0.07, 9), 2) * 1.6
    const s = gust * (1 - vit * 0.35)
    U.uWind.value.set(Math.cos(dir) * s, Math.sin(dir) * s)
    return s
  }

  burst(pos: THREE.Vector3, o: BurstOpts): void {
    const c = new THREE.Color(o.color)
    for (let i = 0; i < o.count; i += 1) {
      if (this.bursts.length >= this.maxBursts) this.bursts.shift()
      const a = this.rnd() * Math.PI * 2
      const el = (this.rnd() - 0.3) * (o.spread ?? 1.2)
      const sp = o.speed * (0.4 + this.rnd() * 0.8)
      const vel = new THREE.Vector3(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + (o.up ?? 0), Math.sin(a) * Math.cos(el) * sp)
      this.bursts.push({ pos: pos.clone(), vel, life: o.life * (0.6 + this.rnd() * 0.6), max: o.life, r: c.r, g: c.g, b: c.b, grav: o.gravity ?? 0 })
    }
  }

  update(dt: number, time: number, cam: THREE.Vector3, vit: number, act: number, stabilized: boolean, viewportHeight: number): void {
    const wind = this.updateWind(time, vit)
    const scale = viewportHeight * 0.55
    for (const m of Object.values(this.motes)) {
      m.mat.uniforms.uScale.value = scale
      if (m.follow) m.place(cam)
    }
    const m = this.motes
    // Dust thins as the sky clears; wind raises it.
    m.dust.opacity = (0.3 - 0.12 * vit) * Math.min(1.2, 0.6 + wind * 0.5)
    m.dust.mat.uniforms.uColor.value.set(vit > 0.4 ? '#8a7664' : '#6a3a34')
    m.spores.opacity = THREE.MathUtils.smoothstep(vit, 0.2, 0.6) * 0.9
    m.embers.opacity = stabilized ? Math.max(0, 0.15 - vit) : 0.95 - act * 0.55
    m.corelife.opacity = 0.18 + act * 0.8
    m.sparkle.opacity = 0.55 + act * 0.2
    m.mist.opacity = THREE.MathUtils.smoothstep(vit, 0.15, 0.7) * 0.1

    // Energy motes streaming from the core toward the basin along the vein as activation grows.
    const flowMat = this.flow.material as THREE.PointsMaterial
    flowMat.opacity = Math.min(1, act * 1.4)
    this.flow.visible = act > 0.05 && this.flowPath.length > 2
    if (this.flow.visible) {
      const pos = this.flow.geometry.attributes.position as THREE.BufferAttribute
      const len = this.flowPath.length - 1
      for (let i = 0; i < this.flowU.length; i += 1) {
        this.flowU[i] = (this.flowU[i] + (dt * this.flowSpeed[i] * 0.09)) % 1
        const u = this.flowU[i] * act * len
        const k = Math.min(len - 1, Math.floor(u))
        const f = u - k
        const a = this.flowPath[k]
        const b = this.flowPath[k + 1]
        pos.setXYZ(i, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f + 0.4 + Math.sin(time * 3 + i) * 0.15, a.z + (b.z - a.z) * f)
      }
      pos.needsUpdate = true
    }

    // Bursts
    const pos = this.burstGeo.attributes.position as THREE.BufferAttribute
    const col = this.burstGeo.attributes.color as THREE.BufferAttribute
    let n = 0
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i]
      b.life -= dt
      if (b.life <= 0) {
        this.bursts.splice(i, 1)
        continue
      }
      b.vel.y -= b.grav * dt
      b.vel.multiplyScalar(Math.exp(-dt * 0.9))
      b.pos.addScaledVector(b.vel, dt)
    }
    for (const b of this.bursts) {
      if (n >= this.maxBursts) break
      const f = Math.max(0, b.life / b.max)
      pos.setXYZ(n, b.pos.x, b.pos.y, b.pos.z)
      col.setXYZ(n, b.r * f, b.g * f, b.b * f)
      n += 1
    }
    this.burstGeo.setDrawRange(0, n)
    pos.needsUpdate = true
    col.needsUpdate = true
  }
}
