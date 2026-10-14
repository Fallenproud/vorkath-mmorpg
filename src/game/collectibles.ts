import * as THREE from 'three'

type Core = { mesh: THREE.Group; home: THREE.Vector3; taken: boolean; phase: number }

/**
 * Energy cores: the run's objective. Pickup is a distance check against the player each fixed
 * step (cheaper and simpler than sensor colliders for a few dozen static items).
 */
export class Collectibles {
  readonly group = new THREE.Group()
  private cores: Core[] = []
  private time = 0

  constructor(spots: THREE.Vector3[]) {
    const gem = new THREE.OctahedronGeometry(0.34, 0)
    const gemMat = new THREE.MeshStandardMaterial({ color: '#ffd35c', emissive: '#ffb020', emissiveIntensity: 3, flatShading: true, roughness: 0.25 })
    const ringGeo = new THREE.TorusGeometry(0.55, 0.035, 6, 32)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.8 })
    const halo = haloTexture()
    for (const spot of spots) {
      const mesh = new THREE.Group()
      const g = new THREE.Mesh(gem, gemMat)
      g.castShadow = true
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: '#ffc94a', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }))
      glow.scale.setScalar(2.2)
      mesh.add(glow, g, ring)
      mesh.position.copy(spot)
      this.group.add(mesh)
      this.cores.push({ mesh, home: spot.clone(), taken: false, phase: spot.x * 0.7 + spot.z * 0.3 })
    }
  }

  get total(): number {
    return this.cores.length
  }

  /** Positions of cores still in play (for the HUD compass / hints). */
  remaining(): THREE.Vector3[] {
    return this.cores.filter(c => !c.taken).map(c => c.home)
  }

  /** Returns the positions of cores picked up this step. */
  collect(player: THREE.Vector3, radius: number): THREE.Vector3[] {
    const got: THREE.Vector3[] = []
    for (const c of this.cores) {
      if (c.taken) continue
      if (c.home.distanceToSquared(player) < radius * radius) {
        c.taken = true
        c.mesh.visible = false
        got.push(c.home.clone())
      }
    }
    return got
  }

  reset(): void {
    for (const c of this.cores) {
      c.taken = false
      c.mesh.visible = true
    }
  }

  animate(frameSeconds: number): void {
    this.time += frameSeconds
    for (const c of this.cores) {
      if (c.taken) continue
      c.mesh.position.y = c.home.y + Math.sin(this.time * 2.2 + c.phase) * 0.14
      c.mesh.children[1].rotation.y = this.time * 1.8 + c.phase
      c.mesh.children[2].rotation.z = this.time * 0.9
      const pulse = 1 + Math.sin(this.time * 4 + c.phase) * 0.08
      c.mesh.children[2].scale.setScalar(pulse)
    }
  }
}

/** Soft radial gradient drawn once to a canvas; shared by every glow sprite. */
let haloCache: THREE.Texture | undefined
export function haloTexture(): THREE.Texture {
  if (haloCache) return haloCache
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  haloCache = new THREE.CanvasTexture(canvas)
  haloCache.colorSpace = THREE.SRGBColorSpace
  return haloCache
}
