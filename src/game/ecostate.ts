import { biomeAt, ecoAge, type Biome } from './ecology'
import type { HeightField } from './heightfield'
import { POI } from './layout'
/**
 * V2 ecological state machine (WP-04). Four discrete states, advanced one at a time by accepted Life-Core
 * events, plus a serialisable per-tile grid (lifeSpread, waterAvailability, terrainMaterialWeights, local
 * lifecycle). The continuous vitality value that already drives the terrain shader, flora and water is the
 * single clock; each state owns a vitality target and the world eases toward it, so transitions are smooth.
 *
 * State names follow the V2 handoff (Scarred, Pioneer, Growth, Thriving). Vitality targets and the tile
 * formulas are NEW_PROPOSED gameplay interpretations, not canon.
 */
export type EcoStageIndex = 0 | 1 | 2 | 3
export interface EcoStageDef {
  index: EcoStageIndex
  key: 'scarred' | 'pioneer' | 'growth' | 'thriving'
  name: string
  /** Vitality the world eases toward once this state has been entered. */
  vit: number
  summary: string
}
export const ECO_STAGES: readonly EcoStageDef[] = [
  { index: 0, key: 'scarred', name: 'Scarred', vit: 0, summary: 'Exposed hostile rock, hot fissures, almost no life.' },
  { index: 1, key: 'pioneer', name: 'Pioneer', vit: 0.3, summary: 'Isolated pioneer colonies where ground and water allow.' },
  { index: 2, key: 'growth', name: 'Growth', vit: 0.64, summary: 'Patches expand: shrubs, reeds, moisture and soil progression.' },
  { index: 3, key: 'thriving', name: 'Thriving', vit: 1, summary: 'Dense cover and mature trees only where water and soil permit.' },
]
export interface EcoSave {
  stage: EcoStageIndex
  /** Id of the last accepted Life-Core event; events with an id at or below it are duplicates. */
  lastEvent: number
}
export type EcoReject = 'duplicate' | 'in-transition' | 'max-stage'
export interface EcoResult {
  accepted: boolean
  reason: 'ok' | EcoReject
  from: EcoStageIndex
  to: EcoStageIndex
}
export const defaultEco = (): EcoSave => ({ stage: 0, lastEvent: 0 })
export function parseEco(raw: unknown, fallback: EcoSave): EcoSave {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Record<string, unknown>
  const s = typeof r.stage === 'number' && Number.isInteger(r.stage) && r.stage >= 0 && r.stage <= 3 ? (r.stage as EcoStageIndex) : null
  if (s === null) return fallback
  const e = typeof r.lastEvent === 'number' && Number.isFinite(r.lastEvent) ? Math.max(0, Math.floor(r.lastEvent)) : 0
  return { stage: s, lastEvent: e }
}
/** True while the world is still easing toward the current state's vitality target. */
export const ecoSettling = (eco: EcoSave, vit: number): boolean => vit < ECO_STAGES[eco.stage].vit - 0.004
/**
 * Offer one Life-Core event to the machine. Exactly one state is gained per accepted event; duplicates
 * (same or older event id), events during a transition and events past the last state are rejected
 * without changing anything.
 */
export function requestEcoAdvance(eco: EcoSave, eventId: number, vit: number): EcoResult {
  const from = eco.stage
  if (eventId <= eco.lastEvent) return { accepted: false, reason: 'duplicate', from, to: from }
  if (eco.stage >= 3) return { accepted: false, reason: 'max-stage', from, to: from }
  if (ecoSettling(eco, vit)) return { accepted: false, reason: 'in-transition', from, to: from }
  eco.stage = (from + 1) as EcoStageIndex
  eco.lastEvent = eventId
  return { accepted: true, reason: 'ok', from, to: eco.stage }
}
// ----------------------------------------------------------------------------------------------
// Per-tile grid
// ----------------------------------------------------------------------------------------------
export const TILE = 16
export const EXTENT = 208
export const GRID_N = (EXTENT * 2) / TILE
const sm = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** Soil/nutrient availability by land-cover biome (static; 0 = bare rock, 1 = deep humic soil). */
const BIOME_NUTRIENT: Record<Biome, number> = { highlandRidge: 0.14, scarFoothill: 0.4, crystalField: 0.24, conduitHalo: 0.62, basinSoil: 0.92, wetCorridor: 0.84 }
export interface TileSample {
  tile: number
  biome: Biome
  slope: number
  nutrient: number
  waterBase: number
  /** lifeSpread in [0..1]. */
  life: number
  /** waterAvailability in [0..1]. */
  water: number
  /** terrainMaterialWeights: bare scar, pioneer film, moss, soil. They sum to 1. */
  mat: [number, number, number, number]
  /** Local lifecycle state 0..3 (same scale as the global states). */
  lifecycle: EcoStageIndex
}
export class EcoGrid {
  readonly n = GRID_N
  private readonly biome: Biome[] = []
  private readonly slope = new Float32Array(GRID_N * GRID_N)
  private readonly nutrient = new Float32Array(GRID_N * GRID_N)
  private readonly waterBase = new Float32Array(GRID_N * GRID_N)
  readonly life = new Float32Array(GRID_N * GRID_N)
  readonly water = new Float32Array(GRID_N * GRID_N)
  readonly mat = new Float32Array(GRID_N * GRID_N * 4)
  readonly lifecycle = new Uint8Array(GRID_N * GRID_N)
  private vitApplied = -1
  constructor(hf: HeightField) {
    for (let j = 0; j < GRID_N; j += 1) {
      for (let i = 0; i < GRID_N; i += 1) {
        const x = -EXTENT + (i + 0.5) * TILE
        const z = -EXTENT + (j + 0.5) * TILE
        const k = j * GRID_N + i
        const b = biomeAt(hf, x, z)
        this.biome.push(b)
        const sl = hf.slopeAt(x, z)
        this.slope[k] = sl
        // Soil needs gentle ground: steep slopes shed regolith.
        this.nutrient[k] = BIOME_NUTRIENT[b] * (1 - sm(14, 38, sl) * 0.85)
        const cd = hf.channelDistance(x, z).d
        const lakeD = Math.max(0, Math.hypot(x - POI.basin.x, z - POI.basin.z) - 22)
        this.waterBase[k] = Math.max(Math.exp(-cd / 20), Math.exp(-lakeD / 30))
      }
    }
    this.apply(0, true)
  }
  index(x: number, z: number): number {
    const i = Math.min(GRID_N - 1, Math.max(0, Math.floor((x + EXTENT) / TILE)))
    const j = Math.min(GRID_N - 1, Math.max(0, Math.floor((z + EXTENT) / TILE)))
    return j * GRID_N + i
  }
  /** Recompute every dynamic tile value for a vitality. Cheap (676 tiles); safe to call a few times a second. */
  apply(vit: number, force = false): void {
    if (!force && Math.abs(vit - this.vitApplied) < 0.0015) return
    this.vitApplied = vit
    for (let j = 0; j < GRID_N; j += 1) {
      for (let i = 0; i < GRID_N; i += 1) {
        const k = j * GRID_N + i
        const x = -EXTENT + (i + 0.5) * TILE
        const z = -EXTENT + (j + 0.5) * TILE
        const age = ecoAge(x, z, vit)
        const w = this.waterBase[k] * (0.35 + 0.65 * sm(0, 0.6, vit))
        // Where the succession front has passed, how much ground is actually colonised depends on soil and water.
        const suit = 0.18 + 0.82 * Math.max(this.nutrient[k], w * 0.9)
        const life = sm(0, 0.5, age) * suit
        this.life[k] = life
        this.water[k] = w
        const scar = 1 - sm(0.02, 0.26, life)
        const film = sm(0.02, 0.26, life) * (1 - sm(0.18, 0.55, life))
        const moss = sm(0.18, 0.55, life) * (1 - sm(0.5, 0.88, life)) * (0.4 + 0.6 * w)
        const soil = Math.max(0, 1 - scar - film - moss)
        this.mat[k * 4] = scar
        this.mat[k * 4 + 1] = film
        this.mat[k * 4 + 2] = moss
        this.mat[k * 4 + 3] = soil
        this.lifecycle[k] = life < 0.05 ? 0 : life < 0.3 ? 1 : life < 0.62 ? 2 : 3
      }
    }
  }
  sample(x: number, z: number): TileSample {
    const k = this.index(x, z)
    return {
      tile: k, biome: this.biome[k], slope: this.slope[k], nutrient: this.nutrient[k], waterBase: this.waterBase[k],
      life: this.life[k], water: this.water[k], mat: [this.mat[k * 4], this.mat[k * 4 + 1], this.mat[k * 4 + 2], this.mat[k * 4 + 3]],
      lifecycle: this.lifecycle[k] as EcoStageIndex,
    }
  }
  /** Static suitability used for placement: soil and water availability at full recovery. */
  staticWater(x: number, z: number): number {
    return this.waterBase[this.index(x, z)]
  }
  staticNutrient(x: number, z: number): number {
    return this.nutrient[this.index(x, z)]
  }
  /** Mean lifeSpread over the whole region (region-wide scanner reading). */
  meanLife(): number {
    let s = 0
    for (let k = 0; k < this.life.length; k += 1) s += this.life[k]
    return s / this.life.length
  }
  /** Share of tiles per local lifecycle state. */
  lifecycleShare(): [number, number, number, number] {
    const c: [number, number, number, number] = [0, 0, 0, 0]
    for (let k = 0; k < this.lifecycle.length; k += 1) c[this.lifecycle[k]] += 1
    return c.map(v => v / this.lifecycle.length) as [number, number, number, number]
  }
  // ---- serialisation ------------------------------------------------------------------------
  /** Quantised dynamic tile state (7 bytes per tile) as base64. */
  serialize(): string {
    const nT = GRID_N * GRID_N
    const buf = new Uint8Array(nT * 7)
    for (let k = 0; k < nT; k += 1) {
      buf[k * 7] = Math.round(this.life[k] * 255)
      buf[k * 7 + 1] = Math.round(this.water[k] * 255)
      for (let m = 0; m < 4; m += 1) buf[k * 7 + 2 + m] = Math.round(this.mat[k * 4 + m] * 255)
      buf[k * 7 + 6] = this.lifecycle[k]
    }
    let s = ''
    for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i])
    return btoa(s)
  }
  /** Restore tile state from `serialize()` output. Returns false (and changes nothing) if it does not fit. */
  restore(b64: string, vit: number): boolean {
    const nT = GRID_N * GRID_N
    try {
      const s = atob(b64)
      if (s.length !== nT * 7) return false
      for (let k = 0; k < nT; k += 1) {
        this.life[k] = s.charCodeAt(k * 7) / 255
        this.water[k] = s.charCodeAt(k * 7 + 1) / 255
        for (let m = 0; m < 4; m += 1) this.mat[k * 4 + m] = s.charCodeAt(k * 7 + 2 + m) / 255
        this.lifecycle[k] = Math.min(3, s.charCodeAt(k * 7 + 6))
      }
      this.vitApplied = vit
      return true
    } catch {
      return false
    }
  }
  /** Stable 32-bit hash of the serialised dynamic state (for determinism checks). */
  hash(): string {
    const s = this.serialize()
    let h = 2166136261
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
}
