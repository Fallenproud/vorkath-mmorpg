import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { PerfProbe, estimateTargetsMB } from './perf'
import type { Quality } from './save'

type Preset = { pixelRatio: number; shadows: boolean; shadowMap: number; bloom: boolean; antialias: boolean; post: boolean; bloomStrength: number; msaa: number; gtao: boolean; pbr: boolean }
export const QUALITY_PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, bloom: false, antialias: false, post: false, bloomStrength: 0, msaa: 0, gtao: false, pbr: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, bloom: true, antialias: true, post: true, bloomStrength: 0.32, msaa: 0, gtao: false, pbr: false },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, bloom: true, antialias: true, post: true, bloomStrength: 0.5, msaa: 4, gtao: false, pbr: false },
  /** Pilot tier: High plus PBR texture layers and half-resolution GTAO. */
  ultra: { pixelRatio: 2, shadows: true, shadowMap: 2048, bloom: true, antialias: true, post: true, bloomStrength: 0.5, msaa: 4, gtao: true, pbr: true },
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
 * GTAO at reduced resolution. Objects that do not write depth (sky dome, additive glows, sprites, ribbons) are hidden
 * from the normal/depth pre-pass so they cannot occlude or halo the ground.
 */
class AoPass extends GTAOPass {
  aoScale = 0.5
  setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width * this.aoScale)), Math.max(1, Math.round(height * this.aoScale)))
  }
  _overrideVisibility(): void {
    const self = this as unknown as { _visibilityCache: THREE.Object3D[]; scene: THREE.Scene; _overrideVisibility: () => void }
    ;(GTAOPass.prototype as unknown as { _overrideVisibility: () => void })._overrideVisibility.call(this)
    this.scene.traverse(o => {
      if (!o.visible) return
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      const mat = Array.isArray(m) ? m[0] : m
      const sprite = (o as THREE.Sprite).isSprite === true
      if (sprite || (mat && (mat.depthWrite === false || (mat.transparent && mat.blending === THREE.AdditiveBlending)))) {
        o.visible = false
        self._visibilityCache.push(o)
      }
    })
  }
}
/**
 * Owns the WebGL renderer, the optional post-processing chain and resize handling.
 * Scenes call `render(scene, camera)`; they never touch the composer directly.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  private composer?: EffectComposer
  private bloom?: UnrealBloomPass
  private ao?: AoPass
  /** Frame cost probe: CPU submit time, GPU time (when supported) and rAF interval. */
  readonly probe: PerfProbe
  /** Runtime A/B overrides for the Ultra features (null = follow the quality preset). */
  private override: { gtao: boolean | null; pixelWidth: number | null } = { gtao: null, pixelWidth: null }
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
    this.gl.info.autoReset = false // frame totals across every pass (scene, AO, bloom, output)
    this.probe = new PerfProbe(this.gl)
    this.applyQuality(quality)
    window.addEventListener('resize', () => this.resize())
  }

  get shadowMapSize(): number {
    return this.preset.shadowMap
  }

  get pbrEnabled(): boolean {
    return this.preset.pbr
  }
  get gtaoEnabled(): boolean {
    return this.override.gtao ?? this.preset.gtao
  }
  /** Debug / benchmark: force GTAO on or off (null = preset) without changing the quality tier. */
  setGtaoOverride(v: boolean | null): void {
    this.override.gtao = v
    this.rebuildPost()
  }
  /** Benchmark: render at a fixed drawing-buffer width (height follows the window aspect). null = normal. */
  setPixelWidthOverride(px: number | null): void {
    this.override.pixelWidth = px
    this.rebuildPost()
  }
  private targetPixelRatio(): number {
    const cssW = this.canvas.clientWidth || window.innerWidth
    if (this.override.pixelWidth) return this.override.pixelWidth / Math.max(1, cssW)
    return Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio)
  }
  private rebuildPost(): void {
    this.gl.setPixelRatio(this.targetPixelRatio())
    this.bloom?.dispose()
    this.ao?.dispose()
    this.composer?.dispose()
    this.composer = undefined
    this.bloom = undefined
    this.ao = undefined
    this.resize()
  }
  /** Drawing-buffer size and an estimate of post-chain render-target memory, for the perf report. */
  bufferInfo(): { width: number; height: number; pixelRatio: number; msaa: number; gtao: boolean; targetsMB: number } {
    const v = this.gl.getDrawingBufferSize(new THREE.Vector2())
    return { width: v.x, height: v.y, pixelRatio: +this.gl.getPixelRatio().toFixed(3), msaa: this.preset.post ? this.preset.msaa : 0, gtao: this.preset.post && this.gtaoEnabled,
      targetsMB: this.preset.post ? estimateTargetsMB(v.x, v.y, this.preset.msaa, this.gtaoEnabled ? 1.2 : 0) : 0 }
  }
  applyQuality(quality: Quality): void {
    this.preset = QUALITY_PRESETS[quality]
    this.gl.shadowMap.enabled = this.preset.shadows
    this.gl.setPixelRatio(this.targetPixelRatio())
    this.bloom?.dispose()
    this.ao?.dispose()
    this.ao = undefined
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
    const rt = new THREE.WebGLRenderTarget(Math.round(size.x * pr), Math.round(size.y * pr), { type: THREE.HalfFloatType, samples: this.preset.msaa })
    this.composer = new EffectComposer(this.gl, rt)
    this.composer.setPixelRatio(pr)
    this.composer.addPass(new RenderPass(scene, camera))
    if (this.gtaoEnabled) {
      const ao = new AoPass(scene, camera, size.x * pr, size.y * pr)
      ao.aoScale = 0.5
      ao.output = GTAOPass.OUTPUT.Default
      ao.blendIntensity = 1
      // 1 uu = 1 m. A ~1.4 m radius reads as crevice and contact darkening on rocks and spire roots.
      ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.6, thickness: 1.6, scale: 1.35, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 })
      this.ao = ao
      this.composer.addPass(ao)
    }
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
    this.gl.info.reset()
    this.probe.begin()
    try {
      if (composer) composer.render()
      else this.gl.render(scene, camera)
    } finally {
      this.probe.end()
    }
  }
}
