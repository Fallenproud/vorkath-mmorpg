import { describe, expect, it } from 'vitest'
import { getHeightField } from '../src/game/heightfield'
import { CELL, POI, WORLD_HALF } from '../src/game/layout'

const hf = getHeightField()
type P = { x: number; z: number }

/** A* over the grid; cells steeper than maxSlope or under deep water are blocked. */
function route(a: P, b: P, maxSlope: number): { found: boolean; length: number } {
  const key = (i: number, j: number) => j * 1000 + i
  const toI = (v: number) => Math.round((v + WORLD_HALF) / CELL)
  const start = [toI(a.x), toI(a.z)]
  const goal = [toI(b.x), toI(b.z)]
  const open = new Map<number, { i: number; j: number; g: number; f: number }>()
  const best = new Map<number, number>()
  const h = (i: number, j: number) => Math.hypot(i - goal[0], j - goal[1]) * CELL
  open.set(key(start[0], start[1]), { i: start[0], j: start[1], g: 0, f: h(start[0], start[1]) })
  best.set(key(start[0], start[1]), 0)
  const n = (WORLD_HALF * 2) / CELL
  while (open.size) {
    let cur: { i: number; j: number; g: number; f: number } | undefined
    for (const v of open.values()) if (!cur || v.f < cur.f) cur = v
    if (!cur) break
    open.delete(key(cur.i, cur.j))
    if (Math.hypot(cur.i - goal[0], cur.j - goal[1]) < 2) return { found: true, length: cur.g }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const i = cur.i + di
      const j = cur.j + dj
      if (i < 0 || j < 0 || i > n || j > n) continue
      const x = -WORLD_HALF + i * CELL
      const z = -WORLD_HALF + j * CELL
      if (hf.slopeAt(x, z) > maxSlope) continue
      const step = Math.hypot(di, dj) * CELL
      const g = cur.g + step
      const k = key(i, j)
      if (g >= (best.get(k) ?? Infinity)) continue
      best.set(k, g)
      open.set(k, { i, j, g, f: g + h(i, j) })
    }
  }
  return { found: false, length: 0 }
}

describe('Scarred Frontier terrain', () => {
  it('has the landmark elevations the design needs', () => {
    const ridge = hf.heightAt(POI.ridge.x, POI.ridge.z)
    const arrival = hf.heightAt(POI.arrival.x, POI.arrival.z)
    const obs = hf.heightAt(POI.observation.x, POI.observation.z)
    const basin = hf.heightAt(POI.basin.x, POI.basin.z)
    const core = hf.heightAt(POI.core.x, POI.core.z)
    console.log({ ridge, arrival, obs, basin, core, waterMin: hf.waterMin, waterMax: hf.waterMax })
    expect(ridge).toBeGreaterThan(arrival + 18)
    expect(obs).toBeGreaterThan(arrival + 12)
    expect(basin).toBeLessThan(arrival - 6)
    expect(core).toBeGreaterThan(basin + 12)
  })

  it('channel bed descends monotonically from the Life-Core to the basin', () => {
    for (let i = 1; i < hf.channel.length; i += 1) expect(hf.channel[i].bed).toBeLessThan(hf.channel[i - 1].bed)
  })

  it('every consecutive point of interest is reachable on foot', () => {
    const order: (keyof typeof POI)[] = ['arrival', 'ridge', 'crystal', 'core', 'basin', 'observation']
    for (let k = 0; k < order.length - 1; k += 1) {
      const r = route(POI[order[k]], POI[order[k + 1]], 38)
      console.log(order[k], '->', order[k + 1], r)
      expect(r.found).toBe(true)
      expect(r.length).toBeLessThan(Math.hypot(POI[order[k]].x - POI[order[k + 1]].x, POI[order[k]].z - POI[order[k + 1]].z) * 2.4)
    }
  })

  it('region walls cannot be climbed', () => {
    expect(route(POI.arrival, { x: 214, z: 214 }, 38).found).toBe(false)
  })
})
