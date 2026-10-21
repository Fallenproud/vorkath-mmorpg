import * as THREE from 'three'

/**
 * Frame-cost probe. Measures what the browser actually lets us measure:
 *  - cpuMs:  time spent inside Renderer.render() on the main thread (draw submission, uniform upload, pass setup)
 *  - gpuMs:  GPU time of the whole frame via EXT_disjoint_timer_query_webgl2, when the browser exposes it
 *  - frameMs: requestAnimationFrame interval (capped by display refresh, so it hides GPU headroom)
 * gpuMs is the number that matters for UHD. It is `null` when the extension is unavailable (software rendering,
 * some privacy modes, Safari), in which case the report says so instead of guessing.
 */
const RING = 600
const pct = (a: number[], p: number): number => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
export interface Series { n: number; avg: number; p50: number; p95: number; p99: number; max: number }
const summarize = (a: number[]): Series => ({
  n: a.length,
  avg: a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0,
  p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? Math.max(...a) : 0,
})
export class PerfProbe {
  readonly gpuSupported: boolean
  private readonly gl2: WebGL2RenderingContext | null
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private pending: WebGLQuery[] = []
  private active: WebGLQuery | null = null
  private t0 = 0
  private lastRaf = 0
  cpu: number[] = []
  gpu: number[] = []
  frame: number[] = []
  constructor(renderer: THREE.WebGLRenderer) {
    const ctx = renderer.getContext()
    this.gl2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? ctx : null
    this.ext = (this.gl2?.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.ext) ?? null
    this.gpuSupported = !!this.ext
  }
  begin(): void {
    const now = performance.now()
    if (this.lastRaf) this.push(this.frame, now - this.lastRaf)
    this.lastRaf = now
    this.t0 = now
    if (this.gl2 && this.ext && !this.active && this.pending.length < 8) {
      const q = this.gl2.createQuery()
      if (q) {
        this.gl2.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
        this.active = q
      }
    }
  }
  end(): void {
    this.push(this.cpu, performance.now() - this.t0)
    if (this.gl2 && this.ext && this.active) {
      this.gl2.endQuery(this.ext.TIME_ELAPSED_EXT)
      this.pending.push(this.active)
      this.active = null
    }
    this.poll()
  }
  private poll(): void {
    const gl = this.gl2
    const ext = this.ext
    if (!gl || !ext) return
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    while (this.pending.length) {
      const q = this.pending[0]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      this.pending.shift()
      if (!disjoint) this.push(this.gpu, Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6)
      gl.deleteQuery(q)
    }
  }
  private push(a: number[], v: number): void {
    a.push(v)
    if (a.length > RING) a.shift()
  }
  reset(): void {
    this.cpu = []
    this.gpu = []
    this.frame = []
    this.lastRaf = 0
  }
  summary(): { cpuMs: Series; gpuMs: Series | null; frameMs: Series } {
    return { cpuMs: summarize(this.cpu), gpuMs: this.gpuSupported && this.gpu.length ? summarize(this.gpu) : null, frameMs: summarize(this.frame) }
  }
}

// ---- memory estimates ---------------------------------------------------------------------------
const MB = 1024 * 1024
function textureBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | undefined
  const mips = (t as THREE.CompressedTexture).mipmaps as { data?: { byteLength: number }; width: number; height: number }[] | undefined
  // Compressed (KTX2/Basis) textures stay compressed on the GPU: sum the real mip payloads.
  if ((t as THREE.CompressedTexture).isCompressedTexture && mips?.length) {
    let b = 0
    for (const m of mips) b += m.data?.byteLength ?? 0
    return b
  }
  const w = img?.width ?? 0
  const h = img?.height ?? 0
  if (!w || !h) return 0
  const bpp = t.type === THREE.HalfFloatType ? 8 : t.type === THREE.FloatType ? 16 : 4
  return w * h * bpp * (t.generateMipmaps || t.minFilter !== THREE.LinearFilter ? 1.333 : 1)
}
export interface MemoryEstimate { texturesMB: number; geometryMB: number; textureCount: number; largest: { name: string; w: number; h: number; mb: number }[] }
/** Walks the scene once and sums unique textures and geometry buffers. An estimate, not a driver readout. */
export function estimateSceneMemory(scene: THREE.Scene): MemoryEstimate {
  const tex = new Set<THREE.Texture>()
  const geo = new Set<THREE.BufferGeometry>()
  scene.traverse(o => {
    const m = o as THREE.Mesh
    if (m.geometry) geo.add(m.geometry)
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) tex.add(v as THREE.Texture)
      const u = (mat as THREE.ShaderMaterial).uniforms
      if (u) for (const k of Object.keys(u)) { const v = u[k].value as THREE.Texture | null; if (v && v.isTexture) tex.add(v) }
    }
  })
  let tb = 0
  const rows: MemoryEstimate['largest'] = []
  for (const t of tex) {
    const b = textureBytes(t)
    tb += b
    const img = t.image as { width?: number; height?: number } | undefined
    rows.push({ name: t.name || t.uuid.slice(0, 6), w: img?.width ?? 0, h: img?.height ?? 0, mb: +(b / MB).toFixed(2) })
  }
  rows.sort((a, b) => b.mb - a.mb)
  let gb = 0
  for (const g of geo) {
    for (const a of Object.values(g.attributes)) gb += (a as THREE.BufferAttribute).array.byteLength
    if (g.index) gb += g.index.array.byteLength
  }
  return { texturesMB: +(tb / MB).toFixed(1), geometryMB: +(gb / MB).toFixed(1), textureCount: tex.size, largest: rows.slice(0, 6) }
}
/** Post-chain render targets: HDR colour (RGBA16F) + depth, multisampled, plus the resolve copy and bloom mips. */
export function estimateTargetsMB(pxW: number, pxH: number, msaa: number, extraFullRes = 0): number {
  const px = pxW * pxH
  const samples = Math.max(1, msaa)
  const scene = px * (8 + 4) * samples
  const resolve = px * 8
  const pingPong = px * 8 * 2 // two EffectComposer buffers
  const bloom = px * 8 * 0.4 // mip chain, roughly
  const extra = px * 4 * extraFullRes
  return +((scene + resolve + pingPong + bloom + extra) / MB).toFixed(0)
}
