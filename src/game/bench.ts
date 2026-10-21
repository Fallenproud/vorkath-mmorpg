import * as THREE from 'three'
import type { Game } from './game'
import { POI } from './layout'
import { PBR_STATS } from './pbr'
import { estimateSceneMemory } from '../engine/perf'

/**
 * Scripted benchmark: fixed camera positions x feature configurations x drawing-buffer widths.
 * It reports what the browser can measure (CPU submit time, GPU time if timer queries exist, rAF interval,
 * draw calls, triangles) plus memory *estimates*. It never claims a framerate it did not observe.
 */
export interface BenchWaypoint { name: string; x: number; z: number; yaw: number; eco?: 0 | 1 | 2 | 3; cam?: { dist: number; side: number; up: number; look: number; fov?: number } }
export interface BenchConfig { name: string; pbr: boolean; gtao: boolean }
export interface BenchOptions {
  widths: (number | null)[] // drawing-buffer widths in px; null = current
  seconds: number
  warmupMs: number
  configs: BenchConfig[]
  waypoints: BenchWaypoint[]
  /** Headless scripts may jump the ecological state per waypoint; the in-game panel must not touch the save. */
  allowEco: boolean
}
const yawTo = (fx: number, fz: number, tx: number, tz: number): number => Math.atan2(tx - fx, tz - fz)
const HERO = { dist: 9, side: 0, up: 3.4, look: 2.6, fov: 62 }
export const BENCH_WAYPOINTS: BenchWaypoint[] = [
  { name: 'crystal_field_hero', x: -40, z: -44, yaw: 2.3, cam: HERO },
  { name: 'crystal_field_poi', x: POI.crystal.x + 16, z: POI.crystal.z + 16, yaw: yawTo(POI.crystal.x + 16, POI.crystal.z + 16, POI.crystal.x, POI.crystal.z), cam: HERO },
  { name: 'life_core', x: POI.core.x, z: POI.core.z + 18, yaw: yawTo(POI.core.x, POI.core.z + 18, POI.core.x, POI.core.z), cam: HERO },
  { name: 'arrival_site', x: 0, z: 150, yaw: 0, cam: HERO },
  { name: 'basin_recovered', x: 66, z: -52, yaw: -0.66, eco: 3, cam: HERO },
]
export const BENCH_CONFIGS: BenchConfig[] = [
  { name: 'classic (procedural only)', pbr: false, gtao: false },
  { name: '+PBR layers', pbr: true, gtao: false },
  { name: '+GTAO', pbr: false, gtao: true },
  { name: 'pilot (PBR + GTAO)', pbr: true, gtao: true },
]
const nextFrames = (n: number) => new Promise<void>(res => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f) })
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))

export interface BenchRun {
  config: string
  waypoint: string
  requestedWidth: number | null
  buffer: { width: number; height: number; pixelRatio: number; msaa: number; gtao: boolean; targetsMB: number }
  frames: number
  cpuMs: { avg: number; p50: number; p95: number; p99: number; max: number }
  gpuMs: { avg: number; p50: number; p95: number; p99: number; max: number } | null
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number }
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
}
export interface BenchReport {
  when: string
  meta: Record<string, unknown>
  pbr: typeof PBR_STATS
  memory: ReturnType<typeof estimateSceneMemory> & { glTextures: number; glGeometries: number }
  runs: BenchRun[]
}
const round = (s: { avg: number; p50: number; p95: number; p99: number; max: number }) => ({ avg: +s.avg.toFixed(2), p50: +s.p50.toFixed(2), p95: +s.p95.toFixed(2), p99: +s.p99.toFixed(2), max: +s.max.toFixed(2) })

export async function runBenchmark(game: Game, opts: BenchOptions, onProgress?: (done: number, total: number, label: string) => void): Promise<BenchReport> {
  const r = game.renderer
  const gl = r.gl
  const startPos = game.explorer.root.position.clone()
  const startYaw = game.explorer.yaw
  const prevCam = game.debugCam
  const prevPbr = game.pbrOverride
  const total = opts.configs.length * opts.widths.length * opts.waypoints.length
  let done = 0
  const runs: BenchRun[] = []
  for (const width of opts.widths) {
    r.setPixelWidthOverride(width)
    for (const cfg of opts.configs) {
      game.pbrOverride = cfg.pbr
      r.setGtaoOverride(cfg.gtao)
      for (const wp of opts.waypoints) {
        if (wp.eco !== undefined && opts.allowEco) game.debugSetEco(wp.eco, true)
        else if (wp.eco !== undefined && !opts.allowEco) { done += 1; continue }
        game.debugTeleport(wp.x, wp.z, wp.yaw)
        game.debugCam = wp.cam ?? HERO
        onProgress?.(done, total, `${cfg.name} / ${wp.name} / ${width ?? 'native'}px`)
        await sleep(opts.warmupMs)
        await nextFrames(3)
        r.probe.reset()
        gl.info.reset()
        const t0 = performance.now()
        while (performance.now() - t0 < opts.seconds * 1000) await nextFrames(5)
        const sum = r.probe.summary()
        runs.push({
          config: cfg.name, waypoint: wp.name, requestedWidth: width, buffer: r.bufferInfo(), frames: sum.frameMs.n,
          cpuMs: round(sum.cpuMs), gpuMs: sum.gpuMs ? round(sum.gpuMs) : null, frameMs: round(sum.frameMs),
          // info is reset each rendered frame, so these are per-frame totals of the last frame (all passes).
          drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures,
        })
        done += 1
      }
    }
  }
  r.setPixelWidthOverride(null)
  r.setGtaoOverride(null)
  game.pbrOverride = prevPbr
  game.debugCam = prevCam
  game.debugTeleport(startPos.x, startPos.z, startYaw)
  const mem = estimateSceneMemory(game.scene)
  const dbg = gl.getContext().getExtension('WEBGL_debug_renderer_info')
  return {
    when: new Date().toISOString(),
    meta: {
      userAgent: navigator.userAgent,
      gpu: dbg ? gl.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'hidden by browser',
      devicePixelRatio: window.devicePixelRatio, cssViewport: [window.innerWidth, window.innerHeight],
      quality: game.store.data.settings.quality, three: THREE.REVISION, gpuTimerQueries: r.probe.gpuSupported,
      maxTextureUnits: gl.capabilities.maxTextures, maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
      options: { seconds: opts.seconds, warmupMs: opts.warmupMs, widths: opts.widths },
    },
    pbr: { ...PBR_STATS },
    memory: { ...mem, glTextures: gl.info.memory.textures, glGeometries: gl.info.memory.geometries },
    runs,
  }
}
