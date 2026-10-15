import { DISCOVERIES } from './discoveries'
import { defaultEco, parseEco, type EcoSave } from './ecostate'
import type { RegionId } from './layout'

export const STAGES = [
  'arrival', 'scannerIntro', 'toRidge', 'ridgeScan', 'toCrystal', 'crystal', 'toCore', 'coreScan',
  'repair', 'stabilize', 'transform', 'basinObserve', 'surgeGrowth', 'surgeThriving', 'toObservation', 'observationScan', 'free',
] as const
export type Stage = (typeof STAGES)[number]

export interface Progress {
  version: 2
  stage: Stage
  /** Discovery id -> play seconds at which it was logged, plus the readings captured at that moment. */
  discoveries: Record<string, { at: number; readings: [string, string][] }>
  shardsFound: string[]
  /** Resonance shards currently carried (found minus seated). */
  shards: number
  nodes: [boolean, boolean, boolean]
  oreFound: string[]
  stabilized: boolean
  vitality: number
  /** V2 ecological state machine (0 Scarred .. 3 Thriving) and the last accepted Life-Core event id. */
  eco: EcoSave
  /** Quantised per-tile ecology snapshot (EcoGrid.serialize) written at save time; empty if none. */
  ecoTiles: string
  tutorial: { moved: boolean; sprinted: boolean; jumped: boolean }
  /** Last safe position (x, y, z) and yaw. */
  pos: [number, number, number] | null
  yaw: number
  playTime: number
  completed: boolean
}

export const defaultProgress = (): Progress => ({
  version: 2, stage: 'arrival', discoveries: {}, shardsFound: [], shards: 0, nodes: [false, false, false], oreFound: [],
  stabilized: false, vitality: 0, eco: defaultEco(), ecoTiles: '', tutorial: { moved: false, sprinted: false, jumped: false }, pos: null, yaw: 0, playTime: 0, completed: false,
})

const num = (v: unknown, a: number, b: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d)
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 64) : [])

export function parseProgress(raw: unknown): Progress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.version !== 2) return null
  const d = defaultProgress()
  const stage = STAGES.includes(r.stage as Stage) ? (r.stage as Stage) : null
  if (!stage) return null
  const disc: Progress['discoveries'] = {}
  if (r.discoveries && typeof r.discoveries === 'object') {
    for (const [id, v] of Object.entries(r.discoveries as Record<string, unknown>)) {
      if (!DISCOVERIES.some(x => x.id === id) || !v || typeof v !== 'object') continue
      const entry = v as { at?: unknown; readings?: unknown }
      const readings = Array.isArray(entry.readings)
        ? entry.readings.filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string').slice(0, 10)
        : []
      disc[id] = { at: num(entry.at, 0, 1e7, 0), readings }
    }
  }
  const nodesRaw = Array.isArray(r.nodes) ? r.nodes : []
  const nodes: Progress['nodes'] = [nodesRaw[0] === true, nodesRaw[1] === true, nodesRaw[2] === true]
  const posRaw = r.pos
  const pos = Array.isArray(posRaw) && posRaw.length === 3 && posRaw.every(n => typeof n === 'number' && Number.isFinite(n)) ? (posRaw as [number, number, number]) : null
  const t = (r.tutorial ?? {}) as Record<string, unknown>
  const stabilized = r.stabilized === true
  // Saves from before V2 had no eco block: a stabilized world already recovered fully, so keep it at Thriving.
  const eco = parseEco(r.eco, stabilized ? { stage: 3, lastEvent: 1 } : defaultEco())
  if (!stabilized) eco.stage = 0
  const out: Progress = {
    ...d, stage, discoveries: disc, shardsFound: ids(r.shardsFound), nodes, oreFound: ids(r.oreFound), stabilized,
    vitality: stabilized ? num(r.vitality, 0, 1, 0) : 0, eco,
    ecoTiles: typeof r.ecoTiles === 'string' && r.ecoTiles.length < 16000 && /^[A-Za-z0-9+/=]*$/.test(r.ecoTiles) ? r.ecoTiles : '',
    tutorial: { moved: t.moved === true, sprinted: t.sprinted === true, jumped: t.jumped === true },
    pos, yaw: num(r.yaw, -10, 10, 0), playTime: num(r.playTime, 0, 1e8, 0), completed: r.completed === true,
  }
  const seated = nodes.filter(Boolean).length
  out.shards = Math.min(out.shardsFound.length - seated, Math.max(0, num(r.shards, 0, 8, 0)))
  if (out.shards < 0) out.shards = 0
  return out
}

export const has = (p: Progress, id: string) => id in p.discoveries
export const nodeCount = (p: Progress) => p.nodes.filter(Boolean).length
export const recoveryScans = (p: Progress) => ['moss', 'pool', 'frondtree', 'mossgrazer'].filter(id => has(p, id)).length

export interface Objective {
  title: string
  detail: string
  /** Where the waypoint marker points (a region), if anywhere. */
  target: RegionId | null
  progress?: string
}

export function objectiveFor(p: Progress): Objective {
  switch (p.stage) {
    case 'arrival': {
      const done = [p.tutorial.moved, p.tutorial.sprinted, p.tutorial.jumped].filter(Boolean).length
      return { title: 'Get your bearings', detail: 'Walk with WASD, sprint with Shift and jump with Space.', target: null, progress: `${done}/3` }
    }
    case 'scannerIntro':
      return { title: 'Test your scanner', detail: 'Press Q to raise the scanner, aim at the survey capsule and hold F or the left mouse button.', target: 'arrival' }
    case 'toRidge':
      return { title: 'Climb the Fractured Ridge', detail: 'Follow the marker to the high viewpoint to the north-west and survey the region.', target: 'ridge' }
    case 'ridgeScan': {
      const n = ['strata', 'signature'].filter(id => has(p, id)).length
      return { title: 'Scan the ridge and the pulse', detail: 'Scan the exposed strata beside you and the distant light to the north.', target: null, progress: `${n}/2` }
    }
    case 'toCrystal':
      return { title: 'Investigate the Crystal Formation Field', detail: 'The pulse source lies beyond the crystal field. Head north along the ridge.', target: 'crystal' }
    case 'crystal': {
      const n = ['crystalSpire', 'geode'].filter(id => has(p, id)).length
      return { title: 'Study the crystals, recover three shards', detail: 'Scan two formations and collect glowing resonance shards. Step clear of flickering vents.', target: null, progress: `scans ${n}/2 - shards ${p.shardsFound.length}/3` }
    }
    case 'toCore':
      return { title: 'Reach the Life-Core Exposure', detail: 'Carry the shards north to the crater with the turquoise light.', target: 'core' }
    case 'coreScan':
      return { title: 'Scan the Life-Core', detail: 'Raise the scanner (Q) and scan the exposed structure in the crater.', target: null }
    case 'repair':
      return { title: 'Seat the resonance shards', detail: 'Press E at each dark conduit node around the core to seat a shard.', target: null, progress: `${nodeCount(p)}/3` }
    case 'stabilize':
      return { title: 'Stabilize the Life-Core', detail: 'Hold E at the core until the energy settles.', target: null }
    case 'transform':
      return { title: 'Follow the new channel', detail: 'Watch the land respond, then follow the channel east to the Recovery Basin.', target: 'basin' }
    case 'basinObserve':
      return { title: 'Observe the recovery', detail: 'Scan two new things in the basin: the pool, the pioneer mat, a frond-tree or a mossgrazer.', target: null, progress: `${Math.min(2, recoveryScans(p))}/2` }
    case 'surgeGrowth':
      return { title: 'Return to the Life-Core', detail: 'The basin has only begun to recover. Hold E at the core to channel a second surge (Growth).', target: 'core', progress: 'state 2/4' }
    case 'surgeThriving':
      return { title: 'Channel the final surge', detail: 'Let the Growth state settle, then hold E at the core once more (Thriving). Watch the basin respond.', target: 'core', progress: 'state 3/4' }
    case 'toObservation':
      return { title: 'Climb to the Observation Point', detail: 'Follow the marker to the high ground east of the basin.', target: 'observation' }
    case 'observationScan':
      return { title: 'Scan the panorama', detail: 'Raise the scanner and scan the view to log the survey.', target: null }
    default:
      return { title: 'Free exploration', detail: 'The survey slice is complete. Keep exploring and fill the journal.', target: null, progress: `${Object.keys(p.discoveries).length}/${DISCOVERIES.length}` }
  }
}

export interface StageContext {
  inRegion: Partial<Record<RegionId, boolean>>
}

/** Advance as far as the conditions allow. Returns the new stage if it changed. */
export function advance(p: Progress, ctx: StageContext): Stage | null {
  const start = p.stage
  for (let guard = 0; guard < 8; guard += 1) {
    const next = nextStage(p, ctx)
    if (!next) break
    p.stage = next
  }
  if (p.stage === 'free') p.completed = true
  return p.stage !== start ? p.stage : null
}

function nextStage(p: Progress, ctx: StageContext): Stage | null {
  switch (p.stage) {
    case 'arrival': return p.tutorial.moved && p.tutorial.sprinted && p.tutorial.jumped ? 'scannerIntro' : null
    case 'scannerIntro': return has(p, 'capsule') ? 'toRidge' : null
    case 'toRidge': return ctx.inRegion.ridge ? 'ridgeScan' : null
    case 'ridgeScan': return has(p, 'strata') && has(p, 'signature') ? 'toCrystal' : null
    case 'toCrystal': return ctx.inRegion.crystal ? 'crystal' : null
    case 'crystal': return has(p, 'crystalSpire') && has(p, 'geode') && p.shardsFound.length >= 3 ? 'toCore' : null
    case 'toCore': return ctx.inRegion.core ? 'coreScan' : null
    case 'coreScan': return has(p, 'lifecore') ? 'repair' : null
    case 'repair': return nodeCount(p) >= 3 ? 'stabilize' : null
    case 'stabilize': return p.stabilized ? 'transform' : null
    case 'transform': return ctx.inRegion.basin ? 'basinObserve' : null
    case 'basinObserve': return recoveryScans(p) >= 2 ? 'surgeGrowth' : null
    case 'surgeGrowth': return p.eco.stage >= 2 ? 'surgeThriving' : null
    case 'surgeThriving': return p.eco.stage >= 3 ? 'toObservation' : null
    case 'toObservation': return ctx.inRegion.observation ? 'observationScan' : null
    case 'observationScan': return has(p, 'panorama') ? 'free' : null
    default: return null
  }
}

/** Ecology: fraction (0..1) of ground cover at a point given vitality; mirrors the terrain shader's front. */
export function growthFront(x: number, z: number, vit: number, basin: { x: number; z: number }, core: { x: number; z: number }): number {
  const sm = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const f1 = vit * 190 - Math.hypot(x - basin.x, z - basin.z)
  const f2 = vit * 105 - Math.hypot(x - core.x, z - core.z)
  return Math.max(sm(0, 34, f1), sm(0, 26, f2))
}
