import { describe, expect, it } from 'vitest'
import { ECO_STAGES, EcoGrid, defaultEco, ecoSettling, parseEco, requestEcoAdvance } from '../src/game/ecostate'
import { getHeightField } from '../src/game/heightfield'

describe('ecological state machine', () => {
  it('advances exactly one state per accepted event', () => {
    const eco = defaultEco()
    const r1 = requestEcoAdvance(eco, 1, 0)
    expect(r1).toMatchObject({ accepted: true, from: 0, to: 1 })
    expect(eco.stage).toBe(1)
  })
  it('rejects duplicates, in-transition requests and events past Thriving', () => {
    const eco = defaultEco()
    requestEcoAdvance(eco, 1, 0)
    expect(requestEcoAdvance(eco, 1, 0.3).reason).toBe('duplicate')
    expect(requestEcoAdvance(eco, 2, 0.1).reason).toBe('in-transition')
    expect(eco.stage).toBe(1)
    expect(requestEcoAdvance(eco, 2, ECO_STAGES[1].vit).accepted).toBe(true)
    expect(requestEcoAdvance(eco, 3, ECO_STAGES[2].vit).accepted).toBe(true)
    expect(eco.stage).toBe(3)
    expect(requestEcoAdvance(eco, 4, 1).reason).toBe('max-stage')
    expect(eco.stage).toBe(3)
  })
  it('settling is true until vitality reaches the stage target', () => {
    const eco = { stage: 2 as const, lastEvent: 2 }
    expect(ecoSettling(eco, 0.4)).toBe(true)
    expect(ecoSettling(eco, ECO_STAGES[2].vit)).toBe(false)
  })
  it('sanitises corrupt saves', () => {
    expect(parseEco({ stage: 9, lastEvent: -4 }, defaultEco())).toEqual(defaultEco())
    expect(parseEco('nope', defaultEco())).toEqual(defaultEco())
  })
})

describe('EcoGrid', () => {
  const hf = getHeightField()
  it('is deterministic and round-trips through serialization', () => {
    const a = new EcoGrid(hf)
    const b = new EcoGrid(hf)
    a.apply(0.64, true)
    b.apply(0.64, true)
    expect(a.hash()).toBe(b.hash())
    const c = new EcoGrid(hf)
    expect(c.restore(a.serialize(), 0.64)).toBe(true)
    expect(c.hash()).toBe(a.hash())
    expect(c.meanLife()).toBeCloseTo(a.meanLife(), 4) // tiles are stored as 8-bit values
  })
  it('rejects malformed tile blobs', () => {
    const g = new EcoGrid(hf)
    expect(g.restore('AAAA', 0.5)).toBe(false)
    expect(g.restore('', 0.5)).toBe(false)
  })
  it('life spread grows monotonically with vitality and is zero when scarred', () => {
    const g = new EcoGrid(hf)
    g.apply(0, true)
    const m0 = g.meanLife()
    g.apply(0.3, true)
    const m1 = g.meanLife()
    g.apply(0.64, true)
    const m2 = g.meanLife()
    g.apply(1, true)
    const m3 = g.meanLife()
    expect(m0).toBe(0)
    expect(m1).toBeGreaterThan(m0)
    expect(m2).toBeGreaterThan(m1)
    expect(m3).toBeGreaterThan(m2)
  })
  it('lifecycle shares sum to one and Thriving needs water and soil', () => {
    const g = new EcoGrid(hf)
    g.apply(1, true)
    const s = g.lifecycleShare()
    expect(s.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 5)
    expect(s[3]).toBeLessThan(0.5)
  })
})
