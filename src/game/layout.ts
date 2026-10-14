/**
 * Fixed design layout of The Scarred Frontier (prototype region of Vorath Prime).
 * Coordinates are world metres: +x east, -z north. Every system (terrain, props, objectives,
 * scanner, cinematics) reads from here so the level stays one coherent, intentional design.
 */
export type V2 = { x: number; z: number }

export const WORLD_HALF = 220
export const CELL = 2

export const POI = {
  arrival: { x: 0, z: 150 },
  ridge: { x: -98, z: 52 },
  crystal: { x: -58, z: -62 },
  core: { x: -30, z: -135 },
  basin: { x: 95, z: -85 },
  observation: { x: 140, z: 15 },
} as const

export const POI_NAMES: Record<keyof typeof POI, string> = {
  arrival: 'Arrival Site',
  ridge: 'Fractured Ridge',
  crystal: 'Crystal Formation Field',
  core: 'Life-Core Exposure',
  basin: 'Recovery Basin',
  observation: 'Observation Point',
}

/** Dormant conduit path from the Life-Core spring down to the Recovery Basin (dry channel scar). */
export const CHANNEL_POINTS: V2[] = [
  { x: -20, z: -128 },
  { x: 8, z: -124 },
  { x: 34, z: -114 },
  { x: 58, z: -103 },
  { x: 78, z: -94 },
  { x: 91, z: -86 },
]

/** Fractures: straight segments with a depth and a half-width (sigma). */
export const SCARS = [
  { a: { x: -146, z: 8 }, b: { x: -78, z: 24 }, depth: 9, sigma: 3.4 }, // Fractured Ridge gorge
  { a: { x: -128, z: -112 }, b: { x: -74, z: -78 }, depth: 3.4, sigma: 3.4 },
  { a: { x: 30, z: -30 }, b: { x: 104, z: 8 }, depth: 3.2, sigma: 3.2 },
  { a: { x: -10, z: 60 }, b: { x: 52, z: 90 }, depth: 2.8, sigma: 3 },
] as const

export const REGION_RADIUS = {
  arrival: 28,
  ridge: 22,
  crystal: 48,
  core: 36,
  basin: 55,
  observation: 26,
}

export type RegionId = keyof typeof POI

export function regionAt(x: number, z: number): RegionId | null {
  let best: RegionId | null = null
  let bestD = Infinity
  for (const k of Object.keys(POI) as RegionId[]) {
    const d = Math.hypot(x - POI[k].x, z - POI[k].z)
    if (d < REGION_RADIUS[k] && d < bestD) {
      best = k
      bestD = d
    }
  }
  return best
}
