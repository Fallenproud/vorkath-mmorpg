import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import type { Quality } from './save'

type Preset = { pixelRatio: number; shadows: boolean; shadowMap: number; bloom: boolean; antialias: boolean; post: boolean; bloomStrength: number; msaa: number }
export const QUALITY_PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, bloom: false, antialias: false, post: false, bloomStrength: 0, msaa: 0 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, bloom: true, antialias: true, post: true, bloomStrength: 0.32, msaa: 0 },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, bloom: true, antialias: true, post: true, bloomStrength: 0.5, msaa: 4 },
}

/** Pick a starting quality from device hints; the player can override it in Settings. */
export function suggestQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  if (coarse || cores <= 4) return 'medium'
  return 'high'
}

/** Final colour grade (runs in display space after tone mapping): vignette, charcoal black lift, gentle saturation, fine grain. */
const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uAmount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uAmount; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.92, 0.18, length(q * vec2(1.0, 0.86)));
      c *= mix(1.0 - 0.5 * uAmount, 1.0, v);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.1);
      c = max(c, vec3(0.012, 0.012, 0.014));
      c += (h(vUv * 1000.0 + fract(uTime)) - 0.5) * 0.016 * uAmount;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

/**
 * Owns the WebGL renderer, the optional post-processing chain and resize handling.
 * Scenes call `render(scene, camera)`; they never touch the composer directly.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  private composer?: EffectComposer
  private bloom?: UnrealBloomPass
  private grade?: ShaderPass
  /** 0..1 post vignette / grain amount; cinematics may raise it. */
  gradeAmount = 1
  private preset: Preset
  private scene?: THREE.Scene
  private camera?: THREE.PerspectiveCamera

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.preset = QUALITY_PRESETS[quality]
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: this.preset.antialias, powerPreference: 'high-performance' })
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.toneMapping = THREE.ACESFilmicToneMapping
    this.gl.toneMappingExposure = 1.3
    this.gl.shadowMap.type = THREE.PCFShadowMap
    this.applyQuality(quality)
    window.addEventListener('resize', () => this.resize())
  }

  get shadowMapSize(): number {
    return this.preset.shadowMap
  }

  applyQuality(quality: Quality): void {
    this.preset = QUALITY_PRESETS[quality]
    this.gl.shadowMap.enabled = this.preset.shadows
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio))
    this.bloom?.dispose()
    this.composer?.dispose()
    this.composer = undefined
    this.bloom = undefined
    this.resize()
  }

  private ensureComposer(scene: THREE.Scene, camera: THREE.PerspectiveCamera): EffectComposer | undefined {
    if (!this.preset.post) return undefined
    if (this.composer && this.scene === scene && this.camera === camera) return this.composer
    this.composer?.dispose()
    this.scene = scene
    this.camera = camera
    const size = this.gl.getSize(new THREE.Vector2())
    const pr = this.gl.getPixelRatio()
    // Multisampled HDR target so edges stay clean through the post chain.
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: this.preset.msaa })
    this.composer = new EffectComposer(this.gl, rt)
    this.composer.setPixelRatio(pr)
    this.composer.addPass(new RenderPass(scene, camera))
    if (this.preset.bloom) {
      this.bloom = new UnrealBloomPass(size, this.preset.bloomStrength, 0.4, 1.35)
      this.composer.addPass(this.bloom)
    }
    this.composer.addPass(new OutputPass())
    this.grade = new ShaderPass(GRADE)
    this.composer.addPass(this.grade)
    this.composer.setSize(size.x, size.y)
    return this.composer
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.gl.setSize(w, h, false)
    this.composer?.setSize(w, h)
    if (this.camera) {
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (Math.abs(camera.aspect - w / h) > 1e-3) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const composer = this.ensureComposer(scene, camera)
    if (this.grade) {
      this.grade.uniforms.uTime.value = performance.now() / 1000
      this.grade.uniforms.uAmount.value = this.gradeAmount
    }
    if (composer) composer.render()
    else this.gl.render(scene, camera)
  }
}
