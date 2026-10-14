import * as THREE from 'three'

let glow: THREE.Texture | undefined
export function glowTexture(): THREE.Texture {
  if (glow) return glow
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.2, 'rgba(255,255,255,0.55)')
  grd.addColorStop(0.55, 'rgba(255,255,255,0.12)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  glow = new THREE.CanvasTexture(c)
  glow.colorSpace = THREE.SRGBColorSpace
  return glow
}

export function glowSprite(color: string | number, size: number, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity, fog: true })
  const s = new THREE.Sprite(mat)
  s.scale.setScalar(size)
  return s
}

export interface Placement {
  x: number
  y: number
  z: number
  scale: number | THREE.Vector3
  rotY?: number
  tiltX?: number
  tiltZ?: number
  color?: THREE.Color
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placement[], opts: { cast?: boolean; receive?: boolean } = {}): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length))
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  items.forEach((it, i) => {
    e.set(it.tiltX ?? 0, it.rotY ?? 0, it.tiltZ ?? 0, 'YXZ')
    q.setFromEuler(e)
    const s = typeof it.scale === 'number' ? new THREE.Vector3(it.scale, it.scale, it.scale) : it.scale
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, s)
    mesh.setMatrixAt(i, m)
    if (it.color) mesh.setColorAt(i, it.color)
  })
  mesh.count = items.length
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = opts.cast ?? true
  mesh.receiveShadow = opts.receive ?? true
  mesh.computeBoundingSphere()
  return mesh
}

/** Pull the first mesh out of a glTF scene as a geometry (rebased so its bottom sits at y=0) and material. */
export function extractModel(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material; height: number } | null {
  let found: THREE.Mesh | null = null
  root.traverse(o => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
  })
  const mesh = found as THREE.Mesh | null
  if (!mesh) return null
  root.updateMatrixWorld(true)
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingBox()
  const b = geometry.boundingBox!
  geometry.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
  geometry.computeBoundingSphere()
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone()
  return { geometry, material, height: b.max.y - b.min.y }
}
