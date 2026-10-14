import { CONFIG } from './config'

/**
 * Pure run rules: score, combo, lives, clock, win/lose. No three.js, no Rapier, no DOM — the
 * scene reports events and reads the resulting state, and unit tests cover every rule here.
 */
export type RunPhase = 'playing' | 'won' | 'lost'
export type LoseReason = 'time' | 'lives'

export type RunState = {
  unranked: boolean
  phase: RunPhase
  loseReason?: LoseReason
  score: number
  lives: number
  timeLeft: number
  elapsed: number
  collected: number
  total: number
  combo: number
  comboTimer: number
  invulnerable: number
  /** End-of-run bonuses (already included in `score`), kept separate for the results screen. */
  timeBonus: number
  lifeBonus: number
}

export function createRun(totalCores: number, rules = CONFIG): RunState {
  return {
    unranked: false,
    phase: 'playing',
    score: 0,
    lives: rules.run.lives,
    timeLeft: rules.run.seconds,
    elapsed: 0,
    collected: 0,
    total: totalCores,
    combo: 0,
    comboTimer: 0,
    invulnerable: 0,
    timeBonus: 0,
    lifeBonus: 0,
  }
}

export function tick(s: RunState, dt: number): RunState {
  if (s.phase !== 'playing') return s
  const timeLeft = Math.max(0, s.timeLeft - dt)
  const comboTimer = Math.max(0, s.comboTimer - dt)
  const next: RunState = {
    ...s,
    timeLeft,
    elapsed: s.elapsed + dt,
    comboTimer,
    combo: comboTimer > 0 ? s.combo : 0,
    invulnerable: Math.max(0, s.invulnerable - dt),
  }
  if (timeLeft <= 0) return { ...next, phase: 'lost', loseReason: 'time' }
  return next
}

/** A core was picked up. Returns the new state and the points it was worth (for popups). */
export function collect(s: RunState, rules = CONFIG): { state: RunState; points: number } {
  if (s.phase !== 'playing') return { state: s, points: 0 }
  const combo = Math.min(rules.score.comboMax, s.comboTimer > 0 ? s.combo + 1 : 1)
  const points = rules.score.core * combo
  const collected = s.collected + 1
  let next: RunState = { ...s, score: s.score + points, combo, comboTimer: rules.score.comboWindow, collected }
  if (collected >= s.total) {
    const timeBonus = Math.ceil(next.timeLeft) * rules.score.timeBonus
    const lifeBonus = next.lives * rules.score.lifeBonus
    next = { ...next, phase: 'won', timeBonus, lifeBonus, score: next.score + timeBonus + lifeBonus }
  }
  return { state: next, points }
}

/** The player was hit or fell. Ignored while invulnerable unless `fell` (falling always costs a life). */
export function damage(s: RunState, fell = false, rules = CONFIG): { state: RunState; hurt: boolean } {
  if (s.phase !== 'playing') return { state: s, hurt: false }
  if (!fell && s.invulnerable > 0) return { state: s, hurt: false }
  const lives = s.lives - 1
  const next: RunState = { ...s, lives, combo: 0, comboTimer: 0, invulnerable: rules.run.invulnerable }
  if (lives <= 0) return { state: { ...next, lives: 0, phase: 'lost', loseReason: 'lives' }, hurt: true }
  return { state: next, hurt: true }
}

/** Star rating on the results screen: 1 for finishing, +1 at half time left, +1 with no hits. */
export function stars(s: RunState, rules = CONFIG): number {
  if (s.phase !== 'won') return 0
  let n = 1
  if (s.timeLeft >= rules.run.seconds / 2) n += 1
  if (s.lives === rules.run.lives) n += 1
  return n
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
