import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { collect, createRun, damage, formatClock, stars, tick } from '../src/game/rules'

describe('run rules', () => {
  it('scores cores with a combo multiplier that resets after the window', () => {
    let s = createRun(10)
    let r = collect(s)
    expect(r.points).toBe(CONFIG.score.core)
    s = collect(r.state).state
    expect(s.combo).toBe(2)
    expect(s.score).toBe(CONFIG.score.core * 3)
    s = tick(s, CONFIG.score.comboWindow + 0.01)
    expect(s.combo).toBe(0)
    r = collect(s)
    expect(r.points).toBe(CONFIG.score.core)
  })

  it('caps the combo', () => {
    let s = createRun(20)
    for (let i = 0; i < 10; i += 1) s = collect(s).state
    expect(s.combo).toBe(CONFIG.score.comboMax)
  })

  it('wins on the last core and adds time and life bonuses', () => {
    let s = createRun(1)
    s = tick(s, 10)
    s = collect(s).state
    expect(s.phase).toBe('won')
    expect(s.timeBonus).toBe(Math.ceil(CONFIG.run.seconds - 10) * CONFIG.score.timeBonus)
    expect(s.lifeBonus).toBe(CONFIG.run.lives * CONFIG.score.lifeBonus)
    expect(s.score).toBe(CONFIG.score.core + s.timeBonus + s.lifeBonus)
  })

  it('ignores hits while invulnerable but not falls', () => {
    let s = createRun(5)
    s = damage(s).state
    expect(s.lives).toBe(CONFIG.run.lives - 1)
    expect(damage(s).hurt).toBe(false)
    s = damage(s, true).state
    expect(s.lives).toBe(CONFIG.run.lives - 2)
  })

  it('loses on zero lives or when time runs out', () => {
    let s = createRun(5)
    for (let i = 0; i < CONFIG.run.lives; i += 1) s = damage(s, true).state
    expect(s.phase).toBe('lost')
    expect(s.loseReason).toBe('lives')
    const t = tick(createRun(5), CONFIG.run.seconds)
    expect(t.phase).toBe('lost')
    expect(t.loseReason).toBe('time')
  })

  it('freezes state after the run ends', () => {
    const lost = tick(createRun(5), CONFIG.run.seconds)
    expect(tick(lost, 1)).toBe(lost)
    expect(collect(lost).points).toBe(0)
  })

  it('rates stars', () => {
    let s = collect(createRun(1)).state
    expect(stars(s)).toBe(3)
    s = collect(damage(tick(createRun(1), CONFIG.run.seconds * 0.6)).state).state
    expect(stars(s)).toBe(1)
    expect(stars(createRun(1))).toBe(0)
  })

  it('formats the clock', () => {
    expect(formatClock(150)).toBe('2:30')
    expect(formatClock(59.2)).toBe('1:00')
    expect(formatClock(0)).toBe('0:00')
  })
})
