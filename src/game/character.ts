import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../engine/noise'

/**
 * Explorer visual model, rebuilt from the character package references VP-VIS-058 / 060 / 061
 * (adult male, 1.82 m, dark swept-back hair, short stubble, strong jaw, black tactical suit with crimson seam
 * traces, high stand-up collar, teal hexagonal Life-Core gem on the upper chest, backpack module with cyan
 * strips, data pad, forearm device). The pack's own metrics (54k triangles, 78 blendshapes) are marked
 * non-authoritative in the pack; this is a NEW procedural runtime mesh built from smooth lathe limbs, bevelled
 * armour plates and a sculpted head, with the same joint hierarchy as before so every animation keeps working.
 * Locked palette (VP-VIS-060): blacks #0B0D10 #1A1F26 #2B2F36, crimson #3A0D12 #7A1C24, teal #18D1C0 #4AF0E2. No navy.
 */
export interface Rig {
  hips: THREE.Group
  spine: THREE.Group
  head: THREE.Group
  thigh: THREE.Group[]
  knee: THREE.Group[]
  arm: THREE.Group[]
  elbow: THREE.Group[]
  visorMat: THREE.MeshStandardMaterial
  chestMat: THREE.MeshStandardMaterial
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat: [number, number], srgb = false): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Collects geometry per (joint, material) and merges, so the whole character is a few dozen draw calls. */
class Bag {
  private readonly map = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>()
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    let g = geo.index ? geo.toNonIndexed() : geo.clone()
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (!g.attributes.normal) g.computeVertexNormals()
    if ((mat as THREE.MeshStandardMaterial).vertexColors && !g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k)
    this.e.set(rx, ry, rz, 'YXZ')
    this.q.setFromEuler(this.e)
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz))
    g.applyMatrix4(this.m)
    let per = this.map.get(parent)
    if (!per) this.map.set(parent, (per = new Map()))
    let list = per.get(mat)
    if (!list) per.set(mat, (list = []))
    list.push(g)
    g.name = ''
  }
  flush(): void {
    for (const [parent, per] of this.map) {
      for (const [mat, list] of per) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false)
        if (!merged) continue
        const mesh = new THREE.Mesh(merged, mat)
        mesh.castShadow = true
        mesh.receiveShadow = true
        parent.add(mesh)
      }
    }
    this.map.clear()
  }
}

/** Bevelled rounded box (armour plate): extruded rounded rectangle, centred. */
function plate(w: number, h: number, d: number, r = 0.012, bevel = 0.006): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 })
  g.translate(0, 0, -(d - bevel * 2) / 2)
  g.computeVertexNormals()
  return g
}

/** Tapered lathe limb, hanging down from y=0 to y=-len. profile = [t(0 top..1 bottom), radius]. */
function limb(len: number, profile: [number, number][], seg = 14): THREE.BufferGeometry {
  const pts = profile
    .slice()
    .reverse()
    .map(([t, r]) => new THREE.Vector2(r, -t * len))
  const g = new THREE.LatheGeometry(pts, seg)
  g.computeVertexNormals()
  return g
}

export function buildExplorerModel(rig: Rig): THREE.Mesh {
  const rnd = mulberry32(2024)
  const weave = canvasTex(64, (g, s) => {
    g.fillStyle = '#808080'
    g.fillRect(0, 0, s, s)
    for (let i = -s; i < s * 2; i += 4) {
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.lineWidth = 1.4
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + s, s)
      g.stroke()
      g.strokeStyle = 'rgba(0,0,0,0.35)'
      g.beginPath()
      g.moveTo(i + 2, s)
      g.lineTo(i + s + 2, 0)
      g.stroke()
    }
  }, [10, 8])
  const hex = canvasTex(128, (g, s) => {
    g.fillStyle = '#9a9a9a'
    g.fillRect(0, 0, s, s)
    g.strokeStyle = '#303030'
    g.lineWidth = 2
    const r = 14
    for (let y = -r; y < s + r; y += r * 1.5) {
      for (let x = -r; x < s + r; x += r * 1.732) {
        const ox = (Math.round(y / (r * 1.5)) % 2) * r * 0.866
        g.beginPath()
        for (let k = 0; k < 6; k += 1) {
          const a = (Math.PI / 3) * k + Math.PI / 6
          g.lineTo(x + ox + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92)
        }
        g.closePath()
        g.stroke()
      }
    }
  }, [3, 3])
  const speckle = canvasTex(128, (g, s) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 2600; i += 1) {
      g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`
      g.fillRect(rnd() * s, rnd() * s, 1.3, 1.3)
    }
  }, [26, 18])

  const M = (color: string, rough: number, metal: number, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, ...extra })
  const suit = M('#1d2128', 0.74, 0.05, { bumpMap: weave, bumpScale: 0.6, sheen: 0.5, sheenColor: new THREE.Color('#3a2024'), sheenRoughness: 0.5 })
  const suitDark = M('#14171c', 0.8, 0.05, { bumpMap: weave, bumpScale: 0.5 })
  const armor = M('#181b21', 0.28, 0.6, { clearcoat: 0.55, clearcoatRoughness: 0.28, bumpMap: hex, bumpScale: 0.25 })
  const armorB = M('#2b2f36', 0.36, 0.5, { clearcoat: 0.35, clearcoatRoughness: 0.4 })
  const trim = M('#8a1f27', 0.42, 0.3, { emissive: '#3a0d12', emissiveIntensity: 0.25 })
  const trimDark = M('#3a0d12', 0.55, 0.2)
  const strap = M('#2b2f36', 0.7, 0.15)
  const glove = M('#0e1013', 0.62, 0.1)
  const rubber = M('#0b0d10', 0.95, 0)
  const skin = M('#c28f6c', 0.6, 0, { vertexColors: true, sheen: 0.4, sheenColor: new THREE.Color('#ff9f84'), sheenRoughness: 0.45 })
  const hair = M('#18110d', 0.5, 0, { vertexColors: true, sheen: 0.6, sheenColor: new THREE.Color('#5a4030'), sheenRoughness: 0.35 })
  const stubble = new THREE.MeshStandardMaterial({ color: '#241812', roughness: 0.9, transparent: true, alphaMap: speckle, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
  const eyeWhite = M('#e8e4de', 0.25, 0)
  const iris = M('#4a3220', 0.3, 0, { clearcoat: 1, clearcoatRoughness: 0.05 })
  const pupil = M('#050505', 0.2, 0)
  const spec = M('#ffffff', 0.1, 0, { emissive: '#ffffff', emissiveIntensity: 0.8 })
  const lip = M('#8c4640', 0.5, 0, { sheen: 0.5, sheenColor: new THREE.Color('#d98a80') })
  const mouthLine = M('#3a1b18', 0.6, 0)
  const padScreen = new THREE.MeshStandardMaterial({ color: '#0a2a28', emissive: '#18d1c0', emissiveIntensity: 1.1, roughness: 0.2 })
  const cyanStrip = M('#4af0e2', 0.3, 0, { emissive: '#18d1c0', emissiveIntensity: 1.8 })
  const bag = new Bag()
  const { hips, spine, head } = rig

  // ------------------------------------------------------------------ hips and belt
  bag.add(hips, limb(0.2, [[0, 0.135], [0.45, 0.15], [1, 0.12]], 18), suit, 0, 0.09, 0, 0, 0, 0, 1.15, 1, 0.82)
  bag.add(hips, limb(0.07, [[0, 0.142], [1, 0.142]], 18), strap, 0, 0.07, 0, 0, 0, 0, 1.16, 1, 0.84) // belt
  bag.add(hips, plate(0.07, 0.055, 0.03, 0.008, 0.004), armor, 0, 0.04, -0.142) // buckle housing
  bag.add(hips, plate(0.04, 0.025, 0.02, 0.005, 0.003), rig.chestMat, 0, 0.04, -0.158)
  for (const s of [-1, 1]) bag.add(hips, plate(0.07, 0.085, 0.045, 0.01, 0.005), armorB, s * 0.19, 0.0, 0.01, 0, 0, s * 0.12) // hip pouch
  bag.add(hips, plate(0.075, 0.12, 0.014, 0.008, 0.004), armor, -0.205, -0.07, 0.0, 0, 0, 0.1) // holstered data pad
  bag.add(hips, plate(0.05, 0.085, 0.008, 0.005, 0.002), padScreen, -0.208, -0.07, -0.008, 0, 0, 0.1)
  bag.add(hips, plate(0.12, 0.07, 0.05, 0.012, 0.006), armorB, 0, 0.03, 0.15) // rear pouch

  // ------------------------------------------------------------------ legs
  for (const side of [-1, 1]) {
    const idx = side < 0 ? 0 : 1
    const th = rig.thigh[idx]
    const kn = rig.knee[idx]
    bag.add(th, limb(0.46, [[0, 0.092], [0.25, 0.088], [0.7, 0.07], [1, 0.062]], 16), suit)
    bag.add(th, plate(0.115, 0.27, 0.05, 0.02, 0.012), armor, 0, -0.2, -0.062, 0.04) // thigh guard
    bag.add(th, plate(0.1, 0.014, 0.052, 0.005, 0.004), trim, 0, -0.07, -0.065, 0.04)
    bag.add(th, plate(0.08, 0.1, 0.045, 0.012, 0.006), armorB, side * 0.07, -0.19, 0.0) // side thigh panel
    // knee
    bag.add(kn, new THREE.SphereGeometry(0.062, 14, 10), suitDark, 0, 0, 0)
    bag.add(kn, plate(0.1, 0.085, 0.045, 0.02, 0.012), armor, 0, 0.0, -0.062, 0.1)
    bag.add(kn, plate(0.07, 0.02, 0.047, 0.006, 0.004), trim, 0, -0.04, -0.064, 0.1)
    // shin
    bag.add(kn, limb(0.43, [[0, 0.06], [0.2, 0.058], [0.55, 0.046], [1, 0.04]], 16), suit)
    bag.add(kn, plate(0.098, 0.3, 0.04, 0.02, 0.01), armor, 0, -0.2, -0.047, -0.02) // shin guard
    bag.add(kn, plate(0.098, 0.016, 0.043, 0.006, 0.004), trimDark, 0, -0.36, -0.05, -0.02)
    // boot: ankle cuff, foot shell, toe cap, sole, heel
    bag.add(kn, limb(0.1, [[0, 0.05], [1, 0.054]], 14), armorB, 0, -0.34, 0)
    const foot = new THREE.SphereGeometry(0.06, 14, 10)
    bag.add(kn, foot, armorB, 0, -0.42, -0.07, 0, 0, 0, 0.92, 0.62, 2.05)
    bag.add(kn, new THREE.SphereGeometry(0.04, 12, 8), armor, 0, -0.425, -0.17, 0, 0, 0, 1.15, 0.7, 1.0)
    bag.add(kn, plate(0.13, 0.03, 0.31, 0.012, 0.006), rubber, 0, -0.455, -0.07)
    bag.add(kn, plate(0.12, 0.06, 0.07, 0.01, 0.005), armorB, 0, -0.41, 0.045)
    bag.add(kn, plate(0.126, 0.012, 0.32, 0.005, 0.003), strap, 0, -0.438, -0.07)
    bag.add(kn, plate(0.04, 0.02, 0.012, 0.004, 0.003), trim, 0, -0.38, -0.065, 0.6)
  }

  // ------------------------------------------------------------------ torso
  bag.add(spine, limb(0.2, [[0, 0.158], [0.5, 0.15], [1, 0.162]], 18), suit, 0, 0.16, 0, 0, 0, 0, 1.22, 1, 0.84)
  bag.add(spine, limb(0.32, [[0, 0.17], [0.2, 0.2], [0.7, 0.18], [1, 0.162]], 20), suit, 0, 0.5, 0, 0, 0, 0, 1.28, 1, 0.84) // chest
  // chest armour: central plate, flank plates, crimson seam traces
  bag.add(spine, plate(0.33, 0.27, 0.07, 0.04, 0.02), armor, 0, 0.37, -0.168, 0.05)
  bag.add(spine, plate(0.3, 0.07, 0.06, 0.02, 0.012), armorB, 0, 0.2, -0.158, -0.04) // abdomen plate
  bag.add(spine, plate(0.26, 0.05, 0.06, 0.016, 0.01), armorB, 0, 0.12, -0.15, -0.02)
  for (const s of [-1, 1]) {
    bag.add(spine, plate(0.07, 0.24, 0.05, 0.02, 0.012), armorB, s * 0.2, 0.34, -0.1, 0, s * 0.5)
    bag.add(spine, plate(0.006, 0.2, 0.074, 0.002, 0.0015), trim, s * 0.13, 0.38, -0.172, 0.05, 0, s * 0.12) // vertical seam traces
    bag.add(spine, plate(0.14, 0.006, 0.073, 0.002, 0.0015), trim, s * 0.075, 0.27, -0.172, 0.05, 0, s * -0.3) // diagonal trace
  }
  bag.add(spine, plate(0.008, 0.26, 0.074, 0.003, 0.002), trimDark, 0, 0.36, -0.172, 0.05)
  // Life-Core gem: hex bezel + emissive hex crystal on the upper chest
  bag.add(spine, new THREE.CylinderGeometry(0.052, 0.056, 0.016, 6), armor, 0, 0.46, -0.205, Math.PI / 2 + 0.05, 0, 0)
  bag.add(spine, new THREE.CylinderGeometry(0.037, 0.04, 0.02, 6), rig.chestMat, 0, 0.46, -0.213, Math.PI / 2 + 0.05, 0, 0)
  // high stand-up collar
  const collar = limb(0.1, [[0, 0.088], [0.5, 0.082], [1, 0.108]], 18)
  bag.add(spine, collar, suitDark, 0, 0.5, 0, 0, 0, 0, 1.15, 1, 1.0)
  bag.add(spine, limb(0.02, [[0, 0.093], [1, 0.093]], 18), trim, 0, 0.505, 0, 0, 0, 0, 1.15, 1, 1.0)
  for (const s of [-1, 1]) bag.add(spine, plate(0.03, 0.09, 0.03, 0.01, 0.006), armor, s * 0.098, 0.465, 0.0, 0, 0, s * -0.18) // collar blades
  // backpack module with cyan strips and an antenna
  bag.add(spine, plate(0.32, 0.4, 0.15, 0.04, 0.02), armorB, 0, 0.33, 0.235)
  bag.add(spine, plate(0.26, 0.05, 0.155, 0.014, 0.008), trim, 0, 0.5, 0.236)
  bag.add(spine, plate(0.2, 0.14, 0.06, 0.02, 0.01), armor, 0, 0.3, 0.33)
  for (const s of [-1, 1]) {
    bag.add(spine, plate(0.016, 0.28, 0.01, 0.004, 0.003), cyanStrip, s * 0.115, 0.32, 0.31)
    bag.add(spine, plate(0.05, 0.26, 0.05, 0.015, 0.008), armor, s * 0.19, 0.32, 0.17, 0, 0.3 * s)
  }
  bag.add(spine, new THREE.CylinderGeometry(0.007, 0.01, 0.42, 6), armor, -0.12, 0.73, 0.24, 0, 0, 0.12)
  bag.add(spine, new THREE.SphereGeometry(0.014, 8, 8), rig.chestMat, -0.146, 0.94, 0.24)
  // shoulder straps
  for (const s of [-1, 1]) bag.add(spine, plate(0.035, 0.34, 0.016, 0.006, 0.004), strap, s * 0.095, 0.4, -0.175, 0.08, 0, 0)

  // ------------------------------------------------------------------ arms
  for (const side of [-1, 1]) {
    const idx = side < 0 ? 0 : 1
    const sh = rig.arm[idx]
    const el = rig.elbow[idx]
    // pauldron: domed shell with crimson lip
    bag.add(sh, new THREE.SphereGeometry(0.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), armor, side * 0.025, 0.035, 0, 0, 0, 0, 1.12, 0.62, 1.05)
    bag.add(sh, new THREE.TorusGeometry(0.1, 0.006, 6, 22), trim, side * 0.025, 0.034, 0, Math.PI / 2, 0, 0, 1.12, 1.05, 1.0)
    bag.add(sh, new THREE.SphereGeometry(0.062, 12, 10), suit, 0, -0.01, 0)
    bag.add(sh, limb(0.29, [[0, 0.06], [0.2, 0.056], [0.7, 0.045], [1, 0.042]], 14), suit)
    bag.add(sh, plate(0.034, 0.17, 0.09, 0.012, 0.008), armorB, side * 0.052, -0.14, 0)
    bag.add(sh, plate(0.012, 0.15, 0.092, 0.004, 0.003), trim, side * 0.07, -0.14, 0)
    // forearm
    bag.add(el, new THREE.SphereGeometry(0.043, 12, 10), suitDark, 0, 0, 0)
    bag.add(el, limb(0.27, [[0, 0.045], [0.3, 0.042], [1, 0.032]], 14), suit)
    bag.add(el, limb(0.17, [[0, 0.052], [0.4, 0.05], [1, 0.043]], 14), armor, 0, -0.045, 0)
    bag.add(el, plate(0.012, 0.15, 0.1, 0.004, 0.003), trim, side * 0.04, -0.12, 0, 0, 0, 0)
    bag.add(el, limb(0.03, [[0, 0.04], [1, 0.04]], 12), strap, 0, -0.245, 0)
    // glove: palm, curled fingers, thumb
    bag.add(el, plate(0.074, 0.08, 0.036, 0.014, 0.008), glove, 0, -0.31, 0)
    for (let f = 0; f < 4; f += 1) {
      const fx = -0.027 + f * 0.018
      bag.add(el, plate(0.016, 0.052, 0.022, 0.007, 0.005), glove, fx, -0.375, -0.012, -0.32)
      bag.add(el, plate(0.015, 0.03, 0.02, 0.006, 0.004), glove, fx, -0.395, -0.034, -1.0)
    }
    bag.add(el, plate(0.02, 0.05, 0.022, 0.008, 0.005), glove, side * -0.042, -0.325, -0.018, -0.5, 0, side * 0.4)
    bag.add(el, plate(0.07, 0.016, 0.04, 0.006, 0.004), armor, 0, -0.272, 0) // wrist cuff
    if (side > 0) {
      // forearm device with scanner screen
      bag.add(el, plate(0.085, 0.16, 0.05, 0.016, 0.01), armor, 0, -0.14, -0.055)
      bag.add(el, plate(0.062, 0.1, 0.012, 0.008, 0.005), padScreen, 0, -0.14, -0.086)
      bag.add(el, plate(0.07, 0.014, 0.05, 0.005, 0.004), trim, 0, -0.2, -0.056)
    } else {
      bag.add(el, plate(0.07, 0.07, 0.04, 0.012, 0.006), armorB, 0, -0.13, -0.052)
      bag.add(el, plate(0.03, 0.03, 0.01, 0.006, 0.004), rig.chestMat, 0, -0.13, -0.075)
    }
  }

  // ------------------------------------------------------------------ neck + head
  bag.add(head, limb(0.12, [[0, 0.052], [1, 0.06]], 14), skin, 0, -0.02, 0)
  buildHead(bag, head, { skin, hair, stubble, eyeWhite, iris, pupil, spec, lip, mouthLine, suitDark, armor, rig, rnd })

  bag.flush()
  // The scanner screen must stay a distinct mesh so the animation can drive its emissive intensity.
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.012, 0.09), rig.visorMat.clone())
  screen.material = new THREE.MeshStandardMaterial({ color: '#0a2a28', emissive: '#18d1c0', emissiveIntensity: 1.5, roughness: 0.2 })
  screen.position.set(0, -0.14, -0.092)
  screen.rotation.x = Math.PI / 2
  screen.scale.set(0.9, 1, 1.3)
  rig.elbow[1].add(screen)
  return screen
}

interface HeadMats {
  skin: THREE.Material
  hair: THREE.Material
  stubble: THREE.Material
  eyeWhite: THREE.Material
  iris: THREE.Material
  pupil: THREE.Material
  spec: THREE.Material
  lip: THREE.Material
  mouthLine: THREE.Material
  suitDark: THREE.Material
  armor: THREE.Material
  rig: Rig
  rnd: () => number
}

/** Sculpted head: shaped sphere (jaw, brow, cheeks, sockets), nose, lips, eyes, ears, stubble shell, swept-back hair. */
function buildHead(bag: Bag, head: THREE.Group, m: HeadMats): void {
  const SX = 0.079
  const SY = 0.115
  const SZ = 0.099
  const CY = 0.075
  const seg = 56
  const base = new THREE.SphereGeometry(1, seg, 42)
  const p = base.attributes.position
  const n = p.count
  const col = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const U: [number, number, number][] = []
  for (let i = 0; i < n; i += 1) {
    const ux = p.getX(i)
    const uy = p.getY(i)
    const uz = p.getZ(i)
    U.push([ux, uy, uz])
    const front = Math.max(0, -uz)
    const ty = smooth(0, 1, -uy)
    let x = ux * SX * (1 - 0.3 * Math.pow(ty, 1.15))
    let y = uy * SY
    let z = uz * SZ
    if (uz < 0) z *= 1 - 0.09 * ty
    z -= smooth(0.5, 0.95, -uy) * front * 0.014 // chin forward
    z -= gauss(uy, 0.26, 0.1) * front * 0.007 // brow ridge
    const sockets = gauss(uy, 0.12, 0.09) * gauss(Math.abs(ux), 0.42, 0.15) * front
    z += sockets * 0.0065
    const cheek = gauss(uy, -0.18, 0.2) * gauss(Math.abs(ux), 0.55, 0.2) * front
    z -= cheek * 0.004
    x *= 1 + cheek * 0.03
    // squarer jaw angle at the back-lower corner
    const jaw = gauss(uy, -0.45, 0.14) * smooth(0.55, 0.95, Math.abs(ux)) * (uz > -0.2 ? 1 : 0)
    x *= 1 + jaw * 0.07
    y += 0 // keep
    if (uz > 0) z *= 1.04
    p.setXYZ(i, x, y + CY, z)
    const dark = 1 - 0.2 * sockets - 0.1 * smooth(0.55, 1, -uy) * (uz > 0 ? 1 : 0.4)
    col[i * 3] = dark
    col[i * 3 + 1] = dark * (1 - 0.05 * cheek)
    col[i * 3 + 2] = dark * (1 - 0.07 * cheek)
    uv[i * 2] = Math.atan2(ux, uz) * 6
    uv[i * 2 + 1] = uy * 6
  }
  base.setAttribute('color', new THREE.BufferAttribute(col, 3))
  base.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  base.computeVertexNormals()
  bag.add(head, base, m.skin)

  // Region shells (stubble, hair) built from triangles whose vertices all satisfy a predicate.
  const shell = (pred: (ux: number, uy: number, uz: number) => boolean, inflate: number, lift: (ux: number, uy: number, uz: number) => [number, number, number]): THREE.BufferGeometry => {
    const g = base.toNonIndexed()
    const gp = g.attributes.position
    const keep: number[] = []
    const verts = g.attributes.position.count
    // Unit-sphere coordinates for the non-indexed copy come from the original index buffer ordering.
    const idx = base.index!.array
    for (let t = 0; t < verts; t += 3) {
      const a = U[idx[t]]
      const b = U[idx[t + 1]]
      const c = U[idx[t + 2]]
      if (pred(...a) && pred(...b) && pred(...c)) keep.push(t, t + 1, t + 2)
    }
    const out = new Float32Array(keep.length * 3)
    const outUv = new Float32Array(keep.length * 2)
    const uvAttr = g.attributes.uv
    keep.forEach((src, i) => {
      const u = U[idx[src]]
      const nx = u[0]
      const ny = u[1]
      const nz = u[2]
      const [dx, dy, dz] = lift(nx, ny, nz)
      out[i * 3] = gp.getX(src) + nx * inflate + dx
      out[i * 3 + 1] = gp.getY(src) + ny * inflate + dy
      out[i * 3 + 2] = gp.getZ(src) + nz * inflate + dz
      outUv[i * 2] = uvAttr.getX(src)
      outUv[i * 2 + 1] = uvAttr.getY(src)
    })
    const o = new THREE.BufferGeometry()
    o.setAttribute('position', new THREE.BufferAttribute(out, 3))
    o.setAttribute('uv', new THREE.BufferAttribute(outUv, 2))
    o.computeVertexNormals()
    return o
  }

  // Short stubble on the jaw, chin, upper lip and sideburns.
  const stub = shell(
    (ux, uy, uz) => (uy < -0.1 && uy > -0.97 && uz < 0.45) || (Math.abs(ux) > 0.78 && uy < 0.28 && uy > -0.3 && uz > -0.25 && uz < 0.5),
    0.0016,
    () => [0, 0, 0],
  )
  bag.add(head, stub, m.stubble)

  // Hair: swept-back shell with a raised front, plus individual locks for silhouette.
  const hairline = (ux: number, uz: number) => {
    const ax = Math.abs(ux)
    let h = 0.5 + 0.34 * smooth(0.3, 0.85, ax) - 0.07 * (1 - smooth(0, 0.3, ax)) + 0.025 * Math.sin(ux * 38)
    h = h - 0.3 * smooth(-0.6, 0.1, uz) * (1 - smooth(0.5, 0.9, ax) * 0.6)
    if (ax > 0.62 && uz < 0.1) h = Math.max(h, 0.3 + 0.1 * (ax - 0.62))
    h -= 0.62 * smooth(0.1, 0.62, uz)
    return h
  }
  const hairShell = shell((ux, uy, uz) => uy > hairline(ux, uz), 0.0062, (_ux, uy, uz) => {
    const up = smooth(0.5, 1, uy)
    const fr = smooth(0, 1, -uz) * up
    return [0, 0.009 * up + 0.006 * fr, 0.007 * up + 0.009 * fr]
  })
  // Per-vertex tonal variation for the hair shell
  {
    const hp = hairShell.attributes.position
    const c = new Float32Array(hp.count * 3)
    for (let i = 0; i < hp.count; i += 1) {
      const v = 0.8 + 0.35 * Math.sin(hp.getX(i) * 210 + Math.sin(hp.getZ(i) * 90) * 2.5) * 0.5 + 0.18 * (hp.getY(i) - CY) * 4
      c[i * 3] = v
      c[i * 3 + 1] = v * 0.97
      c[i * 3 + 2] = v * 0.95
    }
    hairShell.setAttribute('color', new THREE.BufferAttribute(c, 3))
  }
  bag.add(head, hairShell, m.hair)
  const locks = 26
  for (let i = 0; i < locks; i += 1) {
    const a = (i / (locks - 1) - 0.5) * 2 * 1.12 + (m.rnd() - 0.5) * 0.05
    const pts: THREE.Vector3[] = []
    const rows = 8
    for (let k = 0; k <= rows; k += 1) {
      const s = k / rows
      const th = 0.6 + s * 2.2
      const dx = Math.sin(a)
      const dy = Math.sin(th) * Math.cos(a)
      const dz = -Math.cos(th) * Math.cos(a)
      const len = Math.hypot(dx, dy, dz)
      // crown volume and a lifted front quiff
      const vol = 1.045 + 0.03 * Math.sin(s * Math.PI) + (s < 0.35 ? 0.05 * (0.35 - s) / 0.35 : 0)
      pts.push(new THREE.Vector3((dx / len) * SX * vol, CY + (dy / len) * SY * vol, (dz / len) * SZ * vol))
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.0072 + m.rnd() * 0.004, 5, false)
    const tc = new Float32Array(tube.attributes.position.count * 3)
    const tone = 0.8 + m.rnd() * 0.4
    for (let k = 0; k < tube.attributes.position.count; k += 1) {
      tc[k * 3] = tone
      tc[k * 3 + 1] = tone * 0.95
      tc[k * 3 + 2] = tone * 0.9
    }
    tube.setAttribute('color', new THREE.BufferAttribute(tc, 3))
    bag.add(head, tube, m.hair)
  }

  // Ears
  for (const s of [-1, 1]) {
    bag.add(head, new THREE.SphereGeometry(1, 10, 8), m.skin, s * SX * 1.0, CY - 0.008, 0.012, 0, 0, s * 0.12, 0.011, 0.028, 0.018)
  }
  // Nose: bridge, tip, wings
  bag.add(head, new THREE.CapsuleGeometry(0.0072, 0.03, 4, 8), m.skin, 0, CY - 0.009, -0.0955, 0.2, 0, 0, 1, 1, 1)
  bag.add(head, new THREE.SphereGeometry(0.0118, 10, 8), m.skin, 0, CY - 0.031, -0.1, 0, 0, 0, 1, 0.85, 1.05)
  for (const s of [-1, 1]) bag.add(head, new THREE.SphereGeometry(0.0085, 8, 6), m.skin, s * 0.0125, CY - 0.034, -0.095, 0, 0, 0, 1, 0.9, 0.9)
  // Lips and mouth line
  const lipCurve = (y: number, w: number, bow: number, z: number) =>
    new THREE.CatmullRomCurve3([new THREE.Vector3(-w, y + 0.002, z + 0.004), new THREE.Vector3(-w * 0.45, y - bow, z), new THREE.Vector3(0, y + bow * 0.4, z - 0.001), new THREE.Vector3(w * 0.45, y - bow, z), new THREE.Vector3(w, y + 0.002, z + 0.004)])
  const mz = -0.0775
  bag.add(head, new THREE.TubeGeometry(lipCurve(CY - 0.0595, 0.019, 0.0016, mz), 16, 0.0036, 6, false), m.lip)
  bag.add(head, new THREE.TubeGeometry(lipCurve(CY - 0.0755, 0.016, -0.0012, mz + 0.0005), 16, 0.0048, 6, false), m.lip)
  bag.add(head, new THREE.TubeGeometry(lipCurve(CY - 0.0672, 0.0215, 0.0003, mz + 0.0022), 16, 0.0011, 5, false), m.mouthLine)
  // Eyes: eyeball, iris, pupil, highlight, upper lid, brow
  for (const s of [-1, 1]) {
    const ex = s * 0.0315
    const ey = CY + 0.008
    const ez = -0.0775
    bag.add(head, new THREE.SphereGeometry(0.0132, 14, 10), m.eyeWhite, ex, ey, ez)
    bag.add(head, new THREE.SphereGeometry(0.0135, 14, 8, 0, Math.PI * 2, 0, 0.55), m.iris, ex, ey, ez, -Math.PI / 2)
    bag.add(head, new THREE.SphereGeometry(0.0137, 10, 6, 0, Math.PI * 2, 0, 0.26), m.pupil, ex, ey, ez, -Math.PI / 2)
    bag.add(head, new THREE.SphereGeometry(0.0015, 6, 6), m.spec, ex + 0.003, ey + 0.003, ez - 0.0132)
    bag.add(head, new THREE.SphereGeometry(0.0142, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.44), m.skin, ex, ey + 0.0006, ez - 0.0006, 0.28)
    bag.add(head, new THREE.SphereGeometry(0.0139, 12, 6, 0, Math.PI * 2, Math.PI * 0.8, Math.PI * 0.2), m.skin, ex, ey - 0.0004, ez - 0.0004)
    // brow: thick, slightly angled
    const brow = new THREE.CapsuleGeometry(0.0034, 0.03, 3, 6)
    bag.add(head, brow, m.hair, s * 0.033, CY + 0.034, -0.0885, 0, 0, Math.PI / 2 + s * 0.14)
  }
  // Optical visor on the right eye side (teal), temple arm
  bag.add(head, new THREE.BoxGeometry(0.004, 0.016, 0.03), m.rig.visorMat, SX * 0.985, CY + 0.012, -0.045, 0, 0, 0)
  bag.add(head, new THREE.BoxGeometry(0.005, 0.007, 0.1), m.armor, SX * 1.0, CY + 0.012, -0.04)
  bag.add(head, new THREE.BoxGeometry(0.012, 0.028, 0.02), m.armor, SX * 1.03, CY - 0.01, 0.02)
}
