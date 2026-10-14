/**
 * All gameplay tuning in one place. Change numbers here before touching game code.
 */
export const DEFAULT_CONFIG = {
  player: {
    radius: 0.36,
    halfHeight: 0.55,
    walkSpeed: 3.4,
    runSpeed: 6.6,
    sprintSpeed: 10.2,
    acceleration: 52,
    airControl: 0.4,
    jumpSpeed: 8.4,
    gravity: -26,
    /** Extra gravity when the jump button is released early, for variable jump height. */
    lowJumpGravity: -46,
    maxFall: -38,
    coyoteTime: 0.12,
    jumpBuffer: 0.14,
    turnSpeed: 12,
  },
  camera: {
    distance: 5.4,
    height: 1.75,
    minPitch: -0.25,
    maxPitch: 1.2,
    follow: 9,
    fov: 60,
  },
  world: {
    /** Seconds of play that the full ecological recovery takes (accelerated prototype time). */
    recoverySeconds: 90,
    scanRange: 42,
    scanSeconds: 1.1,
    interactRange: 3.4,
  },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
