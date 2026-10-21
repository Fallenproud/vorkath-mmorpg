import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/**
 * Ultra-tier PBR texture arrays (Poly Haven CC0 sources, built by scripts/textures/build-textures.sh).
 * Layer 0 dark_rock (fissured plateau), 1 dark_rock_02 (stratified face), 2 burned_ground_01 (ash soil).
 * They are fetched lazily, only when the Ultra tier is active, and stay GPU-compressed (Basis Universal / KTX2).
 * Until they are ready the shared uniforms point at 1x1 dummy arrays and `mix` stays 0, so the terrain
 * shader takes its original procedural path.
 */
function dummyArray(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255]), 1, 1, 3)
  t.needsUpdate = true
  return t
}
export const PBR = {
  mix: { value: 0 },
  /** Debug view: 0 off, 1 albedo modulation, 2 world normal, 3 ambient occlusion, 4 roughness ratio. */
  dbg: { value: 0 },
  diff: { value: dummyArray() as THREE.Texture },
  nor: { value: dummyArray() as THREE.Texture },
  arm: { value: dummyArray() as THREE.Texture },
}
/** Mean linear albedo of each layer (measured from the 2K sources); the shader uses it to keep the palette. */
export const PBR_MEAN = [
  [0.0155, 0.0119, 0.0089],
  [0.0433, 0.0343, 0.0255],
  [0.1369, 0.1012, 0.0723],
] as const
export const PBR_MEAN_ROUGH = [0.8, 0.82, 0.52] as const

export interface PbrStats {
  state: 'off' | 'loading' | 'ready' | 'failed'
  loadMs: number
  transferKB: number
  gpuFormat: string
  error?: string
}
export const PBR_STATS: PbrStats = { state: 'off', loadMs: 0, transferKB: 0, gpuFormat: '-' }
const FORMAT_NAMES: Record<number, string> = {
  [THREE.RGBAFormat]: 'RGBA8 (uncompressed fallback)',
  [THREE.RGBA_BPTC_Format]: 'BC7',
  [THREE.RGBA_ASTC_4x4_Format]: 'ASTC 4x4',
  [THREE.RGBA_S3TC_DXT5_Format]: 'BC3/DXT5',
  [THREE.RGBA_ETC2_EAC_Format]: 'ETC2',
}
let loading: Promise<void> | null = null

export function ensurePbrLoaded(gl: THREE.WebGLRenderer): Promise<void> {
  if (loading) return loading
  PBR_STATS.state = 'loading'
  const t0 = performance.now()
  const loader = new KTX2Loader().setTranscoderPath('basis/').detectSupport(gl)
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
  const load = async (name: string): Promise<THREE.Texture> => {
    const tex = await loader.loadAsync(`textures/${name}.ktx2`)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = aniso
    return tex
  }
  loading = (async () => {
    try {
      const [diff, nor, arm] = await Promise.all([load('vk_pbr_diff'), load('vk_pbr_nor'), load('vk_pbr_arm')])
      // Upload now (while the title / loading state is still up) instead of stalling the first frame that samples them.
      for (const t of [diff, nor, arm]) gl.initTexture(t)
      PBR.diff.value = diff
      PBR.nor.value = nor
      PBR.arm.value = arm
      PBR_STATS.state = 'ready'
      PBR_STATS.loadMs = Math.round(performance.now() - t0)
      PBR_STATS.gpuFormat = FORMAT_NAMES[diff.format] ?? `format ${diff.format}`
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      PBR_STATS.transferKB = Math.round(res.filter(r => r.name.includes('vk_pbr_')).reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0) / 1024)
    } catch (e) {
      PBR_STATS.state = 'failed'
      PBR_STATS.error = String((e as Error)?.message ?? e)
      loading = null
      console.warn('[pbr] texture load failed; staying on the procedural look', e)
    } finally {
      loader.dispose()
    }
  })()
  return loading
}
