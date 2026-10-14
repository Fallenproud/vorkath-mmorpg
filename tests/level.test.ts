import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { ISLANDS, planStones, rng } from '../src/game/world'

// Jump reach from config: apex height and flat walking distance.
const apex = CONFIG.player.jumpSpeed ** 2 / (2 * -CONFIG.player.gravity)
const airtime = (2 * CONFIG.player.jumpSpeed) / -CONFIG.player.gravity
const reach = CONFIG.player.walkSpeed * airtime

describe('level', () => {
  it('generates stepping stones that are always jumpable', () => {
    for (let a = 0; a < ISLANDS.length; a += 1) {
      for (let b = 0; b < ISLANDS.length; b += 1) {
        if (a === b) continue
        const stones = planStones(ISLANDS[a], ISLANDS[b])
        const hops = [ISLANDS[a].top, ...stones.map(s => s.top), ISLANDS[b].top]
        for (let i = 1; i < hops.length; i += 1) expect(hops[i] - hops[i - 1]).toBeLessThan(apex * 0.75)
      }
    }
    expect(reach).toBeGreaterThan(2.3 + 1)
  })

  it('rng is deterministic', () => {
    const a = rng(7)
    const b = rng(7)
    for (let i = 0; i < 5; i += 1) expect(a()).toBe(b())
  })
})
