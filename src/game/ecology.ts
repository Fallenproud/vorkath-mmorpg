import { POI } from './layout'
import type { HeightField } from './heightfield'

/**
 * Ecological succession model shared by the terrain shader, flora placement, scanner readings and HUD.
 *
 * Source reference: VP-VIS-005 (life-spread timeline), VP-VIS-007 (Scar -> Frontier -> Living) and the
 * Frontier / Living tile atlases (VP-VIS-042..044). The pack does NOT assert exact stage-to-frame
 * mapping (docs/GROUND_STAGE_ATLAS.md: "NEEDS VISUAL REVIEW"), so the stage thresholds below are a
 * NEW_PROPOSED gameplay interpretation, not canon.
 */

/** Distance (metres) the succession front travels per unit of vitality from each source. */
export const REACH = { basin: 125, core: 90 } as const

/** Vitality at which the front reaches (x, z); the front starts at the basin and at the Life-Core. */
export function passage(x: number, z: number): number {
  return Math.min(Math.hypot(x - POI.basin.x, z - POI.basin.z) / REACH.basin, Math.hypot(x - POI.core.x, z - POI.core.z) / REACH.core)
}

/** Time since the front passed, in vitality units. Negative = not yet reached (still scar). */
export function ecoAge(x: number, z: number, vit: number): number {
  return vit - passage(x, z)
}

export type StageId = 'scar' | 'weathering' | 'pioneer' | 'soil' | 'shrub' | 'mature'
export interface Stage {
  id: StageId
  index: number
  name: string
  /** Minimum ecological age (vitality units) for this stage. */
  from: number
  summary: string
}

export const STAGES: Stage[] = [
  { id: 'scar', index: 0, name: 'Scar', from: -Infinity, summary: 'Bare black basalt and glass, crimson fissures still hot.' },
  { id: 'weathering', index: 1, name: 'Weathering front', from: 0, summary: 'Fissures cool, ash and silica crust form, teal mineral films appear.' },
  { id: 'pioneer', index: 2, name: 'Pioneer film', from: 0.07, summary: 'Microbial film and lichen colonise rust-red soil.' },
  { id: 'soil', index: 3, name: 'Soil and low cover', from: 0.17, summary: 'Humic soil, moss mats, sedge tufts and ferns along damp ground.' },
  { id: 'shrub', index: 4, name: 'Shrub layer', from: 0.34, summary: 'Mycoid spires and scrub thicken the cover.' },
  { id: 'mature', index: 5, name: 'Mature flora', from: 0.55, summary: 'Frond-trees and a closed understory.' },
]

export function stageForAge(age: number): Stage {
  let s = STAGES[0]
  for (const st of STAGES) if (age >= st.from) s = st
  return s
}

export function stageAt(x: number, z: number, vit: number): Stage {
  return stageForAge(ecoAge(x, z, vit))
}

/** Land-cover biomes used to choose which species may grow where (derived from the level layout). */
export type Biome = 'highlandRidge' | 'scarFoothill' | 'crystalField' | 'conduitHalo' | 'basinSoil' | 'wetCorridor'
export const BIOMES: Biome[] = ['highlandRidge', 'scarFoothill', 'crystalField', 'conduitHalo', 'basinSoil', 'wetCorridor']
export const BIOME_NAMES: Record<Biome, string> = {
  highlandRidge: 'Weathered ridge rock',
  scarFoothill: 'Scar foothills',
  crystalField: 'Crystal storm field',
  conduitHalo: 'Life-Core conduit halo',
  basinSoil: 'Early soil basin',
  wetCorridor: 'Mineral stream corridor',
}

export function biomeAt(hf: HeightField, x: number, z: number): Biome {
  const y = hf.heightAt(x, z)
  const slope = hf.slopeAt(x, z)
  const dCore = Math.hypot(x - POI.core.x, z - POI.core.z)
  const dCrystal = Math.hypot(x - POI.crystal.x, z - POI.crystal.z)
  const dBasin = Math.hypot(x - POI.basin.x, z - POI.basin.z)
  const dChan = hf.channelDistance(x, z).d
  if (y < hf.waterMax + 1.0 || dChan < 6 || (Math.abs(dBasin - 22) < 9 && y < hf.waterMax + 2.2)) return 'wetCorridor'
  if (dCore < 40) return 'conduitHalo'
  if (dCrystal < 54) return 'crystalField'
  if (dBasin < 68 && slope < 22) return 'basinSoil'
  if (slope > 20 || Math.hypot(x - POI.ridge.x, z - POI.ridge.z) < 50) return 'highlandRidge'
  return 'scarFoothill'
}
