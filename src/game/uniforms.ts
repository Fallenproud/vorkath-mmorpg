import * as THREE from 'three'
import { POI } from './layout'

/**
 * World-state uniforms shared by terrain, sky, water, flora and energy channels. Gameplay writes
 * them once per frame, so every material reads the same ecological state.
 */
export const U = {
  uTime: { value: 0 },
  /** Ecological vitality 0..1 (0 = barren scar, 1 = recovered). */
  uVit: { value: 0 },
  /** Life-Core activation 0..1 (conduit nodes repaired / site stabilized). */
  uAct: { value: 0 },
  /** Radius of the expanding stabilization shockwave (metres from the Life-Core), 0 = none. */
  uPulse: { value: 0 },
  uWaterY: { value: -9 },
  uWaterMin: { value: -8 },
  uBasin: { value: new THREE.Vector2(POI.basin.x, POI.basin.z) },
  uCore: { value: new THREE.Vector2(POI.core.x, POI.core.z) },
  uSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.4).normalize() },
  uSunCol: { value: new THREE.Color('#ff9a66') },
  uHorizon: { value: new THREE.Color('#7a2a1c') },
  uZenith: { value: new THREE.Color('#150d12') },
  uWind: { value: new THREE.Vector2(1, 0.3) },
}
