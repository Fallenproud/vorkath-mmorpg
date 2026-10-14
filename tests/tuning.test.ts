import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'
import { initPhysics, Physics } from '../src/engine/physics'
import { Player, type PlayerIntent } from '../src/game/player'
import { FollowCamera } from '../src/game/camera'
import { createRun } from '../src/game/rules'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
afterEach(() => {
  tuning.apply(defaults)
  for (const boundary of ['jump', 'dash', 'run'] as const) tuning.activate(boundary)
})

describe('Three.js tuning', () => {
  it('validates the entire patch before committing and preserves source defaults', () => {
    const before = tuning.read()
    for (const patch of [{ 'player.walkSpeed': 8, 'camera.fov': 999 }, { 'player.walkSpeed': 12 },
      { 'player.walkSpeed': 7.1 }, { 'player.walkSpeed': '8' }, { 'camera.fov': Infinity }, { unknown: 4 }]) {
      expect(() => tuning.apply(patch)).toThrow()
      expect(tuning.read()).toEqual(before)
    }
    tuning.apply({ 'player.walkSpeed': 12, 'player.sprintSpeed': 14 })
    expect(CONFIG.player.walkSpeed).toBe(12)
    expect(CONFIG.player.sprintSpeed).toBe(14)
    expect(DEFAULT_CONFIG.player.walkSpeed).toBe(7)
    const applied = tuning.read(); tuning.apply({ 'player.walkSpeed': 12 }); expect(tuning.read()).toEqual(applied)
  })

  it('keeps next-action and next-run values pending until their own boundary', () => {
    tuning.apply({ 'player.jumpSpeed': 14, 'player.dashSpeed': 28, 'run.lives': 5 })
    expect(CONFIG.player.jumpSpeed).toBe(DEFAULT_CONFIG.player.jumpSpeed)
    expect(createRun(1).lives).toBe(3)
    tuning.activate('jump')
    expect(CONFIG.player.jumpSpeed).toBe(14)
    expect(CONFIG.player.dashSpeed).toBe(DEFAULT_CONFIG.player.dashSpeed)
    expect(tuning.read().requested['run.lives']).toBe(5)
    tuning.activate('run'); expect(createRun(1).lives).toBe(5)
    expect(CONFIG.player.dashSpeed).toBe(DEFAULT_CONFIG.player.dashSpeed)
  })

  it('changes real player movement, the next jump and next dash without replacing physics', async () => {
    await initPhysics()
    const physics = new Physics()
    const player = new Player(physics, new THREE.Vector3(0, 5, 0), [])
    const intent: PlayerIntent = { moveX: 1, moveY: 0, sprint: false, jumpPressed: false, jumpHeld: true, dashPressed: false }
    try {
      player.grounded = true; player.step(1 / 60, intent, 0, [])
      const oldSpeed = player.velocity.x
      player.teleport(new THREE.Vector3(0, 5, 0)); player.grounded = true
      tuning.apply({ 'player.walkSpeed': 10 })
      player.step(1 / 60, intent, 0, [])
      expect(player.velocity.x).toBeGreaterThan(oldSpeed)
      player.grounded = true
      tuning.apply({ 'player.jumpSpeed': 14 })
      player.step(1 / 60, { ...intent, moveX: 0, jumpPressed: true }, 0, [])
      expect(player.velocity.y).toBeCloseTo(14 + CONFIG.player.gravity / 60)
      tuning.apply({ 'player.jumpSpeed': 16 })
      player.step(1 / 60, { ...intent, moveX: 0 }, 0, [])
      expect(tuning.read().active['player.jumpSpeed']).toBe(14)
      expect(player.velocity.y).toBeLessThan(14)
      tuning.apply({ 'player.dashSpeed': 28, 'player.dashTime': 0.2 })
      player.step(1 / 60, { ...intent, dashPressed: true }, 0, [])
      expect(player.velocity.x).toBeCloseTo(28)
      tuning.apply({ 'player.dashSpeed': 30 })
      player.step(1 / 60, intent, 0, [])
      expect(player.velocity.x).toBeCloseTo(28)
      expect(tuning.read().active['player.dashSpeed']).toBe(28)
    } finally { physics.dispose() }
  })

  it('updates the actual camera projection without replacing the camera', async () => {
    await initPhysics()
    const physics = new Physics()
    const player = new Player(physics, new THREE.Vector3(0, 5, 0), [])
    const camera = new FollowCamera(physics, player.collider)
    try {
      const before = camera.camera.projectionMatrix.clone()
      tuning.apply({ 'camera.fov': 90, 'camera.distance': 9 })
      camera.update(new THREE.Vector3(0, 5, 0), { x: 0, y: 0 }, 1, true)
      expect(camera.camera.fov).toBe(90)
      expect(camera.camera.projectionMatrix.equals(before)).toBe(false)
      expect(camera.camera.position.distanceTo(new THREE.Vector3(0, 5 + CONFIG.camera.height * 0.45, 0))).toBeCloseTo(9)
    } finally { physics.dispose() }
  })
})


describe('ranked eligibility', () => {
  it('ignores cosmetics and unapplied next-run values, latches live gameplay until a clean new run', () => {
    tuning.activate('run')
    tuning.apply({ 'camera.fov': 90, 'run.lives': 5 })
    expect(tuning.unranked).toBe(false)
    tuning.apply({ 'player.walkSpeed': 8 })
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
  })

  it('marks next-action gameplay only when activated and cannot erase an affected run with Reset', () => {
    tuning.activate('run')
    tuning.apply({ 'player.jumpSpeed': 14 })
    expect(tuning.unranked).toBe(false)
    tuning.activate('jump')
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    tuning.activate('jump')
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
    tuning.apply({ 'run.lives': 5 })
    tuning.activate('run')
    expect(tuning.unranked).toBe(true)
  })
})
