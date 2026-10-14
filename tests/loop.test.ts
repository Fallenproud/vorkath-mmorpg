import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameLoop } from '../src/engine/loop'

let frames: Map<number, FrameRequestCallback>
let time: number
let nextId: number
function frame(seconds = 1 / 60) {
  time += seconds * 1000
  const [id, callback] = [...frames][0]!
  frames.delete(id)
  callback(time)
}
beforeEach(() => {
  frames = new Map(); time = 0; nextId = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback); return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('GameLoop scheduling', () => {
  for (const phase of ['step', 'render'] as const) {
    it(`continues after one ${phase} exception without swallowing the error or accumulating failed time`, () => {
      const error = new Error('frame failure')
      const step = vi.fn(); const render = vi.fn()
      const loop = new GameLoop({ step, render })
      ;(phase === 'step' ? step : render).mockImplementationOnce(() => { throw error })
      loop.start()
      expect(() => frame(0.25)).toThrow(error)
      expect(frames.size).toBe(1)
      step.mockClear(); render.mockClear()
      frame(0.02)
      expect(step).toHaveBeenCalledTimes(1)
      expect(render).toHaveBeenCalledTimes(1)
      expect(frames.size).toBe(1)
      loop.stop()
      expect(frames.size).toBe(0)
    })
  }
  it('keeps repeated failures bounded and start idempotent', () => {
    const step = vi.fn((): void => { throw new Error('broken step') })
    const loop = new GameLoop({ step, render: vi.fn() })
    loop.start()
    for (let i = 0; i < 3; i++) {
      expect(() => frame(0.25)).toThrow('broken step')
      loop.start()
      expect(frames.size).toBe(1)
    }
    step.mockImplementation(() => {})
    step.mockClear()
    frame(0.02)
    expect(step).toHaveBeenCalledTimes(1)
  })
  it('honors stop inside render and can restart after a failure', () => {
    const render = vi.fn((): void => { loop.stop(); throw new Error('stopped') })
    const loop = new GameLoop({ step: vi.fn(), render })
    loop.start()
    expect(() => frame()).toThrow('stopped')
    expect(frames.size).toBe(0)
    render.mockImplementation(() => {})
    loop.start(); frame()
    expect(frames.size).toBe(1)
  })
  it('caps background time and keeps rendering while simulation is paused', () => {
    const step = vi.fn(); const render = vi.fn()
    const loop = new GameLoop({ step, render })
    loop.start(); frame(3600)
    expect(step.mock.calls.length).toBeLessThanOrEqual(15)
    expect(render.mock.calls[0]![1]).toBe(0.25)
    loop.paused = true; step.mockClear()
    frame()
    expect(step).not.toHaveBeenCalled()
    expect(render.mock.calls.at(-1)![0]).toBe(1)
    expect(frames.size).toBe(1)
  })
})
