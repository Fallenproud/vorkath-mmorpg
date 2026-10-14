import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { RAPIER } from '../engine/physics'

/**
 * Procedural sky-islands level. Everything is built from primitives and a seeded RNG, so the
 * starter ships no model files and the layout is identical on every load.
 *
 * To make a different level, edit ISLANDS / LINKS: stepping stones are generated automatically
 * so every link stays jumpable with the tuning in config.ts.
 */
export type Island = { x: number; z: number; top: number; r: number; cores: number; decor?: boolean }
type Link = { a: number; b: number; kind: 'stones' | 'mover' }

export const ISLANDS: Island[] = [
  { x: 0, z: 0, top: 0, r: 7, cores: 2, decor: true },
  { x: 15, z: 3, top: 1.5, r: 4, cores: 2, decor: true },
  { x: 24, z: -8, top: 3.2, r: 3.5, cores: 2 },
  { x: 14, z: -19, top: 4.8, r: 4.5, cores: 2, decor: true },
  { x: 0, z: -27, top: 6.5, r: 5, cores: 2, decor: true },
  { x: -15, z: -16, top: 4.5, r: 4, cores: 2, decor: true },
  { x: -23, z: 1, top: 2.8, r: 3.5, cores: 2 },
  { x: -11, z: 17, top: 1.2, r: 4.5, cores: 2, decor: true },
  { x: 7, z: 17, top: 2.5, r: 3.5, cores: 2 },
  // Summit: reached by the lift from island 4.
  { x: 0, z: -12, top: 10.5, r: 3, cores: 3 },
]

const LINKS: Link[] = [
  { a: 0, b: 1, kind: 'stones' },
  { a: 1, b: 2, kind: 'stones' },
  { a: 2, b: 3, kind: 'stones' },
  { a: 3, b: 4, kind: 'stones' },
  { a: 4, b: 5, kind: 'stones' },
  { a: 5, b: 6, kind: 'stones' },
  { a: 6, b: 7, kind: 'mover' },
  { a: 7, b: 8, kind: 'stones' },
  { a: 8, b: 0, kind: 'stones' },
  { a: 4, b: 9, kind: 'mover' },
]

const STONE = 1.8
const MAX_GAP = 2.3
const MAX_RISE = 1.05

export const PALETTE = {
  skyTop: new THREE.Color('#2f6fd6'),
  horizon: new THREE.Color('#ffd9b0'),
  grass: new THREE.Color('#79cf6e'),
  grassDark: new THREE.Color('#4fae5e'),
  rock: new THREE.Color('#8b6b58'),
  rockDark: new THREE.Color('#5d4639'),
  stone: new THREE.Color('#e3cfa6'),
  leaf: [new THREE.Color('#3f9a57'), new THREE.Color('#5bb85d'), new THREE.Color('#e0a44a')],
  trunk: new THREE.Color('#7a4f35'),
  crystal: new THREE.Color('#7ee8ff'),
}

/** Mulberry32: tiny deterministic RNG so the level never changes between loads. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Plan stepping stones between two islands so every hop fits the jump: the smallest count whose
 * edge-to-edge gap and per-hop rise are within MAX_GAP / MAX_RISE. Pure; unit tested.
 */
export function planStones(a: Island, b: Island): { x: number; z: number; top: number }[] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const d = Math.hypot(dx, dz)
  const gap = d - a.r - b.r
  const dy = b.top - a.top
  let n = 0
  while ((gap - n * STONE) / (n + 1) > MAX_GAP || Math.abs(dy) / (n + 1) > MAX_RISE) n += 1
  const g = (gap - n * STONE) / (n + 1)
  const out: { x: number; z: number; top: number }[] = []
  for (let i = 1; i <= n; i += 1) {
    const along = a.r + g * i + STONE * (i - 0.5)
    out.push({ x: a.x + (dx / d) * along, z: a.z + (dz / d) * along, top: a.top + (dy * i) / (n + 1) })
  }
  return out
}

export type MovingPlatform = {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
  from: THREE.Vector3
  to: THREE.Vector3
  period: number
  phase: number
  /** Movement applied during the last fixed step; the player adds it while standing on top. */
  delta: THREE.Vector3
  half: THREE.Vector3
}

export type DroneRoute = { center: THREE.Vector3; radius: number; phase: number; dir: 1 | -1 }

export class World {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  readonly spawn = new THREE.Vector3(0, 1.2, 3)
  readonly coreSpots: THREE.Vector3[] = []
  readonly droneRoutes: DroneRoute[] = []
  readonly movers: MovingPlatform[] = []
  private clouds: THREE.Object3D[] = []

  constructor(private readonly physics: Physics, shadowMapSize: number) {
    const random = rng(1337)
    this.scene.background = PALETTE.horizon.clone()
    this.scene.fog = new THREE.Fog(PALETTE.horizon, 45, 150)

    this.scene.add(this.makeSky())
    this.scene.add(new THREE.HemisphereLight('#cfe8ff', '#6b5242', 1.0))
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.1)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -26
    cam.right = cam.top = 26
    cam.near = 1
    cam.far = 90
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun, this.sun.target)

    ISLANDS.forEach((island, i) => this.addIsland(island, i, random))
    for (const link of LINKS) {
      const a = ISLANDS[link.a]
      const b = ISLANDS[link.b]
      if (link.kind === 'stones') this.addStones(a, b, random)
      else this.addMover(a, b, link.a * 7 + link.b)
    }
    this.addClouds(random)
    this.addDistantIslands(random)

    // Patrol drones circle over the larger islands (never the spawn hub); the summit gets a tight guard.
    for (const i of [1, 3, 5, 7]) {
      const isl = ISLANDS[i]
      this.droneRoutes.push({ center: new THREE.Vector3(isl.x, isl.top + 1.1, isl.z), radius: isl.r * 0.62, phase: random() * Math.PI * 2, dir: random() > 0.5 ? 1 : -1 })
    }
    const summit = ISLANDS[9]
    this.droneRoutes.push({ center: new THREE.Vector3(summit.x, summit.top + 1.1, summit.z), radius: 1.9, phase: 0, dir: 1 })
  }

  /** Per-frame ambience (clouds, shadow frustum follows the player). */
  update(dt: number, focus: THREE.Vector3): void {
    for (const c of this.clouds) {
      c.position.x += dt * (c.userData.speed as number)
      if (c.position.x > 120) c.position.x = -120
    }
    this.sun.position.set(focus.x + 18, focus.y + 34, focus.z + 12)
    this.sun.target.position.copy(focus)
  }

  /** Advance moving platforms by one fixed step and record their movement. */
  stepMovers(elapsed: number): void {
    for (const m of this.movers) {
      // Ease in-out ping-pong with a pause at each end so boarding is forgiving.
      const t = ((elapsed + m.phase) % m.period) / m.period
      const tri = t < 0.5 ? t * 2 : 2 - t * 2
      const k = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp((tri - 0.12) / 0.76, 0, 1), 0, 1)
      const target = new THREE.Vector3().lerpVectors(m.from, m.to, k)
      const cur = m.body.translation()
      m.delta.set(target.x - cur.x, target.y - cur.y, target.z - cur.z)
      m.body.setNextKinematicTranslation(target)
    }
  }

  private makeSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: PALETTE.skyTop },
        horizon: { value: PALETTE.horizon },
        sunDir: { value: new THREE.Vector3(18, 34, 12).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
          col = mix(col, horizon * 0.92, smoothstep(0.0, -0.4, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat)
    sky.renderOrder = -1
    return sky
  }

  private addIsland(isl: Island, index: number, random: () => number): void {
    const group = new THREE.Group()
    group.position.set(isl.x, isl.top, isl.z)

    const topGeo = new THREE.CylinderGeometry(isl.r, isl.r * 0.94, 0.8, 22, 1)
    const top = new THREE.Mesh(topGeo, flat(PALETTE.grass))
    top.position.y = -0.4
    top.receiveShadow = true
    top.castShadow = true
    group.add(top)

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(isl.r * 0.94, isl.r * 0.86, 0.6, 22, 1), flat(PALETTE.grassDark))
    rim.position.y = -1.1
    group.add(rim)

    const under = new THREE.ConeGeometry(isl.r * 0.88, isl.r * 1.7 + 1.5, 14, 4)
    jitter(under, random, 0.28 * isl.r * 0.35)
    const rock = new THREE.Mesh(under, flat(PALETTE.rock))
    rock.rotation.x = Math.PI
    rock.position.y = -1.4 - (isl.r * 1.7 + 1.5) / 2
    rock.castShadow = true
    group.add(rock)
    this.scene.add(group)

    this.physics.addStaticCylinder(new THREE.Vector3(isl.x, isl.top - 0.4, isl.z), isl.r, 0.8)

    // Core spots: spread around the island, away from the centre where the player lands.
    for (let c = 0; c < isl.cores; c += 1) {
      const angle = (c / isl.cores) * Math.PI * 2 + index * 1.3
      const dist = isl.cores === 1 ? 0 : isl.r * 0.55
      this.coreSpots.push(new THREE.Vector3(isl.x + Math.cos(angle) * dist, isl.top + 1.1, isl.z + Math.sin(angle) * dist))
    }

    if (isl.decor) {
      const trees = Math.round(isl.r * 0.6)
      for (let t = 0; t < trees; t += 1) {
        const angle = random() * Math.PI * 2
        const dist = isl.r * (0.68 + random() * 0.2)
        this.addTree(isl.x + Math.cos(angle) * dist, isl.top, isl.z + Math.sin(angle) * dist, 0.6 + random() * 0.4, random)
      }
    }
    for (let k = 0; k < 3; k += 1) {
      const angle = random() * Math.PI * 2
      const dist = isl.r * (0.8 + random() * 0.12)
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 + random() * 0.18, 0), glow(PALETTE.crystal, 2.4))
      crystal.scale.y = 2.2
      crystal.position.set(isl.x + Math.cos(angle) * dist, isl.top + 0.3, isl.z + Math.sin(angle) * dist)
      crystal.rotation.set(random() * 0.4, random() * 3, random() * 0.4)
      this.scene.add(crystal)
    }
  }

  private addTree(x: number, y: number, z: number, scale: number, random: () => number): void {
    const tree = new THREE.Group()
    tree.position.set(x, y, z)
    tree.scale.setScalar(scale)
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.1, 6), flat(PALETTE.trunk))
    trunk.position.y = 0.55
    trunk.castShadow = true
    tree.add(trunk)
    const leafColor = PALETTE.leaf[Math.floor(random() * PALETTE.leaf.length)]
    for (let i = 0; i < 2; i += 1) {
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 - i * 0.2, 0), flat(leafColor))
      leaves.position.set((random() - 0.5) * 0.2, 1.35 + i * 0.6, (random() - 0.5) * 0.2)
      leaves.rotation.set(random(), random(), random())
      leaves.castShadow = true
      tree.add(leaves)
    }
    this.scene.add(tree)
    this.physics.addStaticCylinder(new THREE.Vector3(x, y + 1.2 * scale, z), 0.28 * scale, 2.4 * scale)
  }

  private addStones(a: Island, b: Island, random: () => number): void {
    const stones = planStones(a, b)
    stones.forEach((s, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(STONE, 0.55, STONE), flat(PALETTE.stone))
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI)
      mesh.position.set(s.x, s.top - 0.275, s.z)
      mesh.quaternion.copy(rot)
      mesh.castShadow = true
      mesh.receiveShadow = true
      const underside = new THREE.Mesh(new THREE.ConeGeometry(STONE * 0.62, 1.4, 5), flat(PALETTE.rockDark))
      underside.rotation.x = Math.PI
      underside.position.y = -0.95
      mesh.add(underside)
      this.scene.add(mesh)
      this.physics.addStaticBox(mesh.position, new THREE.Vector3(STONE, 0.55, STONE), rot)
      // Every other stone carries a core to pull the player along the route.
      if (i % 2 === 1) this.coreSpots.push(new THREE.Vector3(s.x, s.top + 1.1, s.z))
    })
  }

  private addMover(a: Island, b: Island, seed: number): void {
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()
    const half = new THREE.Vector3(1.3, 0.25, 1.3)
    const from = new THREE.Vector3(a.x, a.top - half.y, a.z).addScaledVector(dir, a.r + half.x + 0.25)
    const to = new THREE.Vector3(b.x, b.top - half.y, b.z).addScaledVector(dir, -(b.r + half.x + 0.25))
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), flat(new THREE.Color('#f2b84b')))
    mesh.castShadow = true
    mesh.receiveShadow = true
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2 + 0.02, 0.1, 0.35), glow(new THREE.Color('#ffefb0'), 3))
    stripe.position.y = half.y - 0.02
    mesh.add(stripe)
    mesh.position.copy(from)
    this.scene.add(mesh)
    const body = this.physics.addKinematic(mesh, RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(1))
    const period = Math.max(6, from.distanceTo(to) * 0.9)
    this.movers.push({ mesh, body, from, to, period, phase: (seed % 5) * 0.7, delta: new THREE.Vector3(), half })
  }

  private addClouds(random: () => number): void {
    // Unlit with baked top-to-bottom shading: soft and bright without tripping the bloom threshold.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true })
    for (let i = 0; i < 26; i += 1) {
      const cloud = new THREE.Group()
      const puffs = 3 + Math.floor(random() * 4)
      for (let p = 0; p < puffs; p += 1) {
        const puff = new THREE.Mesh(shadeCloud(new THREE.IcosahedronGeometry(1.4 + random() * 1.6, 1)), mat)
        puff.position.set(p * 1.6 - puffs * 0.8, random() * 0.8, (random() - 0.5) * 1.6)
        puff.scale.y = 0.62
        cloud.add(puff)
      }
      const low = random() < 0.6
      cloud.position.set((random() - 0.5) * 240, low ? -14 - random() * 12 : 18 + random() * 16, (random() - 0.5) * 200)
      cloud.scale.setScalar(low ? 2.4 + random() * 2 : 1.2 + random())
      cloud.userData.speed = 0.6 + random() * 0.8
      this.clouds.push(cloud)
      this.scene.add(cloud)
    }
  }

  private addDistantIslands(random: () => number): void {
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2 + random() * 0.4
      const dist = 75 + random() * 35
      const r = 5 + random() * 7
      const g = new THREE.Group()
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 1.2, 12), flat(PALETTE.grassDark))
      const under = new THREE.ConeGeometry(r * 0.85, r * 2.2, 9, 2)
      jitter(under, random, r * 0.12)
      const rock = new THREE.Mesh(under, flat(PALETTE.rockDark))
      rock.rotation.x = Math.PI
      rock.position.y = -r * 1.1 - 0.6
      g.add(top, rock)
      g.position.set(Math.cos(angle) * dist, -6 + random() * 22, Math.sin(angle) * dist)
      this.scene.add(g)
    }
  }
}

const materialCache = new Map<string, THREE.Material>()
function flat(color: THREE.Color): THREE.MeshStandardMaterial {
  const key = `flat:${color.getHexString()}`
  let m = materialCache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0 })
    materialCache.set(key, m)
  }
  return m
}

export function glow(color: THREE.Color, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, flatShading: true, roughness: 0.3 })
}

function shadeCloud(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position
  geo.computeBoundingBox()
  const { min, max } = geo.boundingBox!
  const colors = new Float32Array(pos.count * 3)
  const top = new THREE.Color('#ffffff')
  const bottom = new THREE.Color('#c9cfe6')
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i += 1) {
    c.lerpColors(bottom, top, (pos.getY(i) - min.y) / (max.y - min.y))
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/** Displace vertices so primitives read as hand-carved rock, keeping shared seams closed. */
function jitter(geo: THREE.BufferGeometry, random: () => number, amount: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const offsets = new Map<string, THREE.Vector3>()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i)
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    let o = offsets.get(key)
    if (!o) {
      o = new THREE.Vector3((random() - 0.5) * amount, (random() - 0.5) * amount, (random() - 0.5) * amount)
      offsets.set(key, o)
    }
    pos.setXYZ(i, v.x + o.x, v.y + o.y, v.z + o.z)
  }
  geo.computeVertexNormals()
}
