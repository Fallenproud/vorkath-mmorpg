import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { mulberry32, fbm, smooth } from '../engine/noise'
import type { HeightField } from './heightfield'
import { POI, SCARS } from './layout'
import { glowSprite, instanced, type Placement } from './gfx'
import { U } from './uniforms'
import { enhanceCrystal } from './crystalfx'

export interface Model {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  height: number
}
export interface ModelSet {
  crystal?: Model
  pylon?: Model
  frond?: Model
  grazer?: Model
  pod?: Model
}

export interface Pickup {
  id: string
  kind: 'shard' | 'ore'
  pos: THREE.Vector3
  collected: boolean
  object: THREE.Object3D
  glow: THREE.Sprite
  base: number
}
export interface Vent {
  index: number
  pos: THREE.Vector3
  hitThisCycle: boolean
  fireAt: number
  ring: THREE.Mesh
  wave: THREE.Mesh
  glow: THREE.Sprite
}
export interface ConduitNode {
  index: number
  pos: THREE.Vector3
  repaired: boolean
  crystal: THREE.Mesh
  glow: THREE.Sprite
  beam: THREE.Mesh
}

const VENT_PERIOD = 5.2
const VENT_CHARGE = 1.3
export const VENT_RADIUS = 5.4

/** Static and animated world objects of the Scarred Frontier. */
export class Props {
  readonly group = new THREE.Group()
  readonly pickups: Pickup[] = []
  readonly vents: Vent[] = []
  readonly nodes: ConduitNode[] = []
  readonly pylonPos = new THREE.Vector3()
  readonly podPos = new THREE.Vector3()
  readonly strataPos = new THREE.Vector3()
  readonly fracturePos = new THREE.Vector3()
  readonly spirePos = new THREE.Vector3()
  readonly geodePos = new THREE.Vector3()
  readonly hardpanPos = new THREE.Vector3()
  readonly channelPos = new THREE.Vector3()
  readonly panoramaPos = new THREE.Vector3()
  readonly mossSpot = new THREE.Vector3()
  readonly poolPos = new THREE.Vector3()
  readonly checkpoints: Record<string, THREE.Vector3> = {}

  private readonly pylonLight = new THREE.PointLight('#22e8c8', 0, 70, 1.5)
  private readonly pylonGlow: THREE.Sprite
  private readonly beamMat: THREE.ShaderMaterial
  private readonly rings: THREE.Mesh[] = []
  private readonly geodeGlow: THREE.Sprite
  private readonly seatFlash: number[] = [0, 0, 0]

  constructor(private readonly hf: HeightField, private readonly physics: Physics, models: ModelSet) {
    const rnd = mulberry32(2026)
    const ground = (x: number, z: number) => hf.heightAt(x, z)

    this.buildRocks(rnd)
    this.buildCrystalField(rnd, models)

    // --- Life-Core Exposure -------------------------------------------------------------
    const cx = POI.core.x
    const cz = POI.core.z
    const cy = ground(cx, cz)
    this.pylonPos.set(cx, cy, cz)
    const pylonH = 9
    if (models.pylon) {
      const mesh = new THREE.Mesh(models.pylon.geometry, models.pylon.material)
      const s = pylonH / models.pylon.height
      mesh.scale.setScalar(s)
      mesh.position.set(cx, cy - 0.3, cz)
      mesh.castShadow = true
      this.group.add(mesh)
    } else {
      const g = new THREE.Group()
      const m = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.35, metalness: 0.6 })
      const a = new THREE.Mesh(new THREE.BoxGeometry(2.2, pylonH, 2.2), m)
      a.position.set(-0.9, pylonH / 2, 0)
      a.rotation.z = 0.06
      const b = a.clone()
      b.position.set(1.1, pylonH / 2 - 0.5, 0.3)
      b.rotation.z = -0.08
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: '#0a3a34', emissive: '#18e8c8', emissiveIntensity: 2.4 }))
      core.position.set(0.1, pylonH * 0.45, 0)
      g.add(a, b, core)
      g.position.set(cx, cy, cz)
      this.group.add(g)
    }
    physics.addStaticCylinder(new THREE.Vector3(cx, cy + pylonH / 2, cz), 2.1, pylonH)
    this.pylonGlow = glowSprite('#22e8c8', 16, 0.5)
    this.pylonGlow.position.set(cx, cy + pylonH * 0.5, cz)
    this.pylonLight.position.set(cx, cy + 5, cz)
    this.group.add(this.pylonGlow, this.pylonLight)

    // Light column visible from the Fractured Ridge.
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uPow: { value: 0.3 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime, uPow; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.3);
          float fade = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.04, vUv.y);
          float pulse = 0.6 + 0.4 * sin(uTime * 1.6 - vUv.y * 11.0);
          gl_FragColor = vec4(vec3(0.05, 0.95, 0.8) * (0.8 + 0.6 * f), (f * 0.9 + 0.1) * fade * pulse * uPow); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.4, 130, 20, 1, true), this.beamMat)
    beam.position.set(cx, cy + 62, cz)
    beam.frustumCulled = false
    this.group.add(beam)

    // Ground pulse rings radiating from the core.
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 64),
        new THREE.MeshBasicMaterial({ color: '#2ef0d0', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(cx, cy + 0.6, cz)
      this.rings.push(ring)
      this.group.add(ring)
    }

    // Three conduit nodes around the core.
    const nodeStone = new THREE.MeshStandardMaterial({ color: '#1d1c20', roughness: 0.8, metalness: 0.2 })
    for (let i = 0; i < 3; i += 1) {
      const ang = -Math.PI / 2 + (i / 3) * Math.PI * 2 + 0.35
      const x = cx + Math.cos(ang) * 11
      const z = cz + Math.sin(ang) * 11
      const y = ground(x, z)
      const node = new THREE.Group()
      node.position.set(x, y, z)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.9, 7), nodeStone)
      base.position.y = 0.4
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 1.5, 6), nodeStone)
      col.position.y = 1.5
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 6, 16), new THREE.MeshStandardMaterial({ color: '#8a1a1c', roughness: 0.4, metalness: 0.4 }))
      rim.rotation.x = Math.PI / 2
      rim.position.y = 2.28
      const crystalMat = new THREE.MeshStandardMaterial({ color: '#2a0806', emissive: '#d02a18', emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.3 })
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), crystalMat)
      crystal.scale.set(0.8, 1.5, 0.8)
      crystal.position.y = 2.85
      const glow = glowSprite('#d02a18', 3.2, 0.7)
      glow.position.y = 2.85
      // Thin link from the node to the core, hidden until repaired.
      const len = Math.hypot(cx - x, cz - z)
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 6), new THREE.MeshBasicMaterial({ color: '#2ef0d0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }))
      link.position.set((cx + x) / 2, (cy + y) / 2 + 1.1, (cz + z) / 2)
      link.lookAt(cx, cy + 1.1, cz)
      link.rotateX(Math.PI / 2)
      link.visible = false
      node.add(base, col, rim, crystal, glow)
      node.traverse(o => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
      })
      this.group.add(node, link)
      physics.addStaticCylinder(new THREE.Vector3(x, y + 1.2, z), 1.5, 2.4)
      this.nodes.push({ index: i, pos: new THREE.Vector3(x, y, z), repaired: false, crystal, glow, beam: link })
    }

    // --- Survey capsule at the Arrival Site -------------------------------------------------
    const px = POI.arrival.x + 9
    const pz = POI.arrival.z - 7
    const py = ground(px, pz)
    this.podPos.set(px, py, pz)
    this.group.add(this.buildCapsule(models.pod, px, py, pz))
    physics.addStaticCylinder(new THREE.Vector3(px, py + 1.5, pz), 1.7, 3)

    // --- Ridge strata outcrop and fracture marker ---------------------------------------------
    const sx = POI.ridge.x - 7
    const sz = POI.ridge.z - 6
    this.strataPos.set(sx, ground(sx, sz) + 1.4, sz)
    this.group.add(this.buildStrata(sx, ground(sx, sz), sz))
    physics.addStaticBox(new THREE.Vector3(sx, ground(sx, sz) + 1.4, sz), new THREE.Vector3(3.2, 2.8, 2.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0)))
    const fx = -100
    const fz = 22
    this.fracturePos.set(fx, ground(fx, fz) + 2, fz)

    // --- Misc scan anchors ---------------------------------------------------------------------
    const ch = hf.channel[Math.floor(hf.channel.length * 0.12)]
    this.channelPos.set(ch.x, ch.bed + 1.2, ch.z)
    const hx = POI.basin.x - 14
    const hz = POI.basin.z + 12
    this.hardpanPos.set(hx, ground(hx, hz) + 1.2, hz)
    this.poolPos.set(POI.basin.x + 2, hf.waterMax + 0.2, POI.basin.z + 2)
    this.panoramaPos.set(POI.observation.x - 11, ground(POI.observation.x - 11, POI.observation.z - 9) + 1.6, POI.observation.z - 9)
    // Pioneer mat specimen: a shore spot just above the final water level near the channel mouth.
    let best = 1e9
    for (let k = 0; k < 400; k += 1) {
      const a = rnd() * Math.PI * 2
      const r = 14 + rnd() * 22
      const x = POI.basin.x + Math.cos(a) * r - 8
      const z = POI.basin.z + Math.sin(a) * r
      const h = ground(x, z)
      const dh = Math.abs(h - (hf.waterMax + 0.7))
      if (hf.slopeAt(x, z) < 14 && dh < best && h > hf.waterMax + 0.3) {
        best = dh
        this.mossSpot.set(x, h, z)
      }
    }

    this.geodeGlow = glowSprite('#22e8c8', 5, 0.7)
    this.geodeGlow.position.copy(this.geodePos).add(new THREE.Vector3(0, 1.4, 0))
    this.group.add(this.geodeGlow)

    // Checkpoints used for safe respawn.
    for (const k of Object.keys(POI) as (keyof typeof POI)[]) {
      const p = POI[k]
      this.checkpoints[k] = new THREE.Vector3(p.x, ground(p.x, p.z), p.z)
    }
    this.checkpoints.crystal.set(POI.crystal.x + 18, ground(POI.crystal.x + 18, POI.crystal.z + 18), POI.crystal.z + 18)
    this.checkpoints.core.set(POI.core.x + 3, ground(POI.core.x + 3, POI.core.z + 18), POI.core.z + 18)
    this.group.name = 'props'
  }

  // ------------------------------------------------------------------------------------------
  private buildRocks(rnd: () => number): void {
    const { hf } = this
    const make = (seed: number) => {
      const g = new THREE.IcosahedronGeometry(1, 1)
      const p = g.attributes.position
      for (let i = 0; i < p.count; i += 1) {
        const x = p.getX(i)
        const y = p.getY(i)
        const z = p.getZ(i)
        const k = 0.75 + 0.5 * fbm(x * 1.7 + seed, z * 1.7 + y, 2, seed)
        p.setXYZ(i, x * k, y * k * 0.78, z * k)
      }
      g.computeVertexNormals()
      return g
    }
    const dark: Placement[] = []
    const red: Placement[] = []
    const colliders: { x: number; y: number; z: number; r: number }[] = []
    const nearScar = (x: number, z: number) => SCARS.some(s => {
      const abx = s.b.x - s.a.x
      const abz = s.b.z - s.a.z
      const t = Math.min(1, Math.max(0, ((x - s.a.x) * abx + (z - s.a.z) * abz) / (abx * abx + abz * abz)))
      return Math.hypot(x - (s.a.x + abx * t), z - (s.a.z + abz * t)) < 14
    })
    let tries = 0
    while (dark.length + red.length < 520 && tries < 9000) {
      tries += 1
      const x = (rnd() - 0.5) * 400
      const z = (rnd() - 0.5) * 400
      const rArr = Math.hypot(x - POI.arrival.x, z - POI.arrival.z)
      if (rArr < 14) continue
      if (Math.hypot(x - POI.core.x, z - POI.core.z) < 15) continue
      if (Math.hypot(x - POI.basin.x, z - POI.basin.z) < 22) continue
      if (hf.channelDistance(x, z).d < 6) continue
      if (Math.hypot(x - POI.ridge.x, z - POI.ridge.z) < 9) continue
      // Rocks cluster near scars and on slopes; sparse on open plains.
      const clustered = nearScar(x, z) ? 1 : 0.28 + hf.slopeAt(x, z) / 40
      if (rnd() > clustered) continue
      const size = 0.35 + Math.pow(rnd(), 2.2) * 2.6
      const y = hf.heightAt(x, z) + size * 0.18
      const item: Placement = {
        x, y, z, scale: new THREE.Vector3(size * (0.8 + rnd() * 0.5), size * (0.7 + rnd() * 0.5), size * (0.8 + rnd() * 0.5)),
        rotY: rnd() * 6.28, tiltX: (rnd() - 0.5) * 0.4, tiltZ: (rnd() - 0.5) * 0.4,
      }
      if (rnd() < 0.3) {
        item.color = new THREE.Color().setHSL(0.01, 0.55, 0.12 + rnd() * 0.08)
        red.push(item)
      } else {
        item.color = new THREE.Color().setHSL(0.02 + rnd() * 0.05, 0.08, 0.05 + rnd() * 0.07)
        dark.push(item)
      }
      if (size > 1.15) colliders.push({ x, y: y + size * 0.3, z, r: size * 0.8 })
    }
    const matRock = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0.12, flatShading: true })
    this.group.add(instanced(make(3), matRock, dark), instanced(make(9), matRock, red))
    for (const c of colliders.slice(0, 160)) this.physics.addStaticCylinder(new THREE.Vector3(c.x, c.y, c.z), c.r, c.r * 1.5)

    // Broken slabs along the fractures.
    const slabs: Placement[] = []
    for (const s of SCARS) {
      for (let i = 0; i < 28; i += 1) {
        const t = 0.15 + rnd() * 0.7
        const side = (rnd() - 0.5) * 2
        const dx = s.b.x - s.a.x
        const dz = s.b.z - s.a.z
        const l = Math.hypot(dx, dz)
        const x = s.a.x + dx * t + (-dz / l) * side * (s.sigma * 2.5 + rnd() * 3)
        const z = s.a.z + dz * t + (dx / l) * side * (s.sigma * 2.5 + rnd() * 3)
        const w = 1.2 + rnd() * 2.4
        slabs.push({ x, y: hf.heightAt(x, z) + 0.2, z, scale: new THREE.Vector3(w, 0.3 + rnd() * 0.5, w * (0.6 + rnd() * 0.6)), rotY: rnd() * 6.28, tiltX: (rnd() - 0.5) * 0.6, tiltZ: (rnd() - 0.5) * 0.6, color: new THREE.Color().setHSL(0.02, 0.12, 0.06 + rnd() * 0.08) })
      }
    }
    this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1), matRock, slabs))
  }

  private buildCrystalField(rnd: () => number, models: ModelSet): void {
    const { hf } = this
    const C = POI.crystal
    const polar = (ang: number, r: number) => ({ x: C.x + Math.cos(ang) * r, z: C.z + Math.sin(ang) * r })
    const deg = Math.PI / 180

    // Hero spire (scannable) and ordinary clusters.
    const items: { x: number; z: number; s: number; rot: number }[] = []
    const spire = polar(-35 * deg, 7)
    this.spirePos.set(spire.x, hf.heightAt(spire.x, spire.z) + 3.4, spire.z)
    items.push({ x: spire.x, z: spire.z, s: 8, rot: 0.4 })
    const ventDefs: [number, number][] = [[20, 22], [100, 24], [200, 21], [290, 25]]
    ventDefs.forEach(([a, r], i) => {
      const p = polar(a * deg, r)
      items.push({ x: p.x, z: p.z, s: 3.6, rot: i })
      const y = hf.heightAt(p.x, p.z)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(VENT_RADIUS - 0.35, VENT_RADIUS, 48),
        new THREE.MeshBasicMaterial({ color: '#d02a18', transparent: true, opacity: 0.2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(p.x, y + 0.45, p.z)
      const wave = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 48),
        new THREE.MeshBasicMaterial({ color: '#ffd8c8', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }),
      )
      wave.rotation.x = -Math.PI / 2
      wave.position.set(p.x, y + 0.6, p.z)
      const glow = glowSprite('#ff4a30', 7, 0.4)
      glow.position.set(p.x, y + 2.4, p.z)
      this.group.add(ring, wave, glow)
      this.vents.push({ index: i, pos: new THREE.Vector3(p.x, y, p.z), hitThisCycle: false, fireAt: -1, ring, wave, glow })
    })
    // Geode
    const g = polar(-130 * deg, 11)
    this.geodePos.set(g.x, hf.heightAt(g.x, g.z), g.z)
    this.group.add(this.buildGeode(g.x, hf.heightAt(g.x, g.z), g.z))
    this.physics.addStaticCylinder(new THREE.Vector3(g.x, this.geodePos.y + 0.8, g.z), 1.6, 1.8)

    let guard = 0
    while (items.length < 20 && guard < 400) {
      guard += 1
      const a = rnd() * Math.PI * 2
      const r = 8 + Math.sqrt(rnd()) * 34
      const p = polar(a, r)
      const s = 1.8 + rnd() * 3.2
      if (items.some(o => Math.hypot(o.x - p.x, o.z - p.z) < 5.5 + (o.s + s) * 0.18)) continue
      if (hf.channelDistance(p.x, p.z).d < 3) continue
      items.push({ x: p.x, z: p.z, s, rot: rnd() * 6.28 })
    }
    const placements: Placement[] = items.map(it => ({ x: it.x, y: hf.heightAt(it.x, it.z) - 0.15, z: it.z, scale: it.s, rotY: it.rot, tiltX: (rnd() - 0.5) * 0.12, tiltZ: (rnd() - 0.5) * 0.12 }))
    if (models.crystal) {
      enhanceCrystal(models.crystal.material, 'hero', 0.8)
      const mesh = instanced(models.crystal.geometry, models.crystal.material, placements.map(p => ({ ...p, scale: (p.scale as number) / models.crystal!.height })))
      this.group.add(mesh)
    } else {
      const fallback = new THREE.OctahedronGeometry(0.5, 0)
      fallback.scale(0.7, 2, 0.7)
      fallback.translate(0, 1, 0)
      this.group.add(instanced(fallback, new THREE.MeshStandardMaterial({ color: '#3a0e10', roughness: 0.2, metalness: 0.6, emissive: '#240606' }), placements))
    }
    for (const it of items) {
      const y = hf.heightAt(it.x, it.z)
      this.physics.addStaticCylinder(new THREE.Vector3(it.x, y + it.s * 0.45, it.z), Math.max(0.5, it.s * 0.2), it.s * 0.9)
    }

    // Fill spikes (procedural) around the field.
    const spike = new THREE.OctahedronGeometry(1, 0)
    spike.scale(0.28, 1.4, 0.28)
    spike.translate(0, 1.2, 0)
    const spikes: Placement[] = []
    for (let i = 0; i < 90; i += 1) {
      const a = rnd() * Math.PI * 2
      const r = 4 + Math.sqrt(rnd()) * 44
      const p = polar(a, r)
      if (hf.channelDistance(p.x, p.z).d < 3) continue
      const s = 0.4 + rnd() * 1.2
      spikes.push({ x: p.x, y: hf.heightAt(p.x, p.z) - 0.1, z: p.z, scale: s, rotY: rnd() * 6, tiltX: (rnd() - 0.5) * 0.7, tiltZ: (rnd() - 0.5) * 0.7, color: new THREE.Color().setHSL(0.005 + rnd() * 0.02, 0.6, 0.1 + rnd() * 0.1) })
    }
    const spikeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.22, metalness: 0.55, emissive: '#180404' })
    enhanceCrystal(spikeMat, 'spike', 0.6)
    this.group.add(instanced(spike, spikeMat, spikes))

    // Resonance shards: three safe, two just inside a vent's danger ring.
    const shardDefs: [number, number][] = [[24, 15.5], [105, 19.5], [195, 12], [288, 21], [150, 7]]
    shardDefs.forEach(([a, r], i) => {
      const p = polar(a * deg, r)
      this.addPickup(`shard${i}`, 'shard', p.x, p.z)
    })
    // Bloodstone ore samples.
    const oreDefs: [number, number][] = [[60, 31], [160, 26], [235, 33], [330, 20], [10, 40]]
    oreDefs.forEach(([a, r], i) => {
      const p = polar(a * deg, r)
      this.addPickup(`ore${i}`, 'ore', p.x, p.z)
    })
  }

  private addPickup(id: string, kind: 'shard' | 'ore', x: number, z: number): void {
    const y = this.hf.heightAt(x, z)
    const group = new THREE.Group()
    if (kind === 'shard') {
      const mat = new THREE.MeshStandardMaterial({ color: '#0b3a34', emissive: '#20e8c8', emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 })
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat)
      m.scale.set(0.7, 1.8, 0.7)
      group.add(m)
      const m2 = m.clone()
      m2.scale.set(0.45, 1.1, 0.45)
      m2.position.set(0.18, -0.12, 0.05)
      m2.rotation.z = -0.5
      group.add(m2)
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: '#4a1210', roughness: 0.4, metalness: 0.75, flatShading: true })
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), mat)
      m.scale.set(1.2, 0.8, 1)
      group.add(m)
    }
    const baseY = y + (kind === 'shard' ? 0.95 : 0.3)
    group.position.set(x, baseY, z)
    group.traverse(o => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
    })
    const glow = glowSprite(kind === 'shard' ? '#22e8c8' : '#d03a22', kind === 'shard' ? 3.4 : 1.4, kind === 'shard' ? 0.8 : 0.35)
    glow.position.set(x, baseY, z)
    this.group.add(group, glow)
    this.pickups.push({ id, kind, pos: new THREE.Vector3(x, baseY, z), collected: false, object: group, glow, base: baseY })
  }

  private buildGeode(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group()
    const rockGeo = new THREE.IcosahedronGeometry(1.5, 1)
    const p = rockGeo.attributes.position
    for (let i = 0; i < p.count; i += 1) {
      const k = 0.8 + 0.4 * fbm(p.getX(i) * 2 + 4, p.getZ(i) * 2, 2, 5)
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k)
    }
    rockGeo.computeVertexNormals()
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: '#1c1b20', roughness: 0.7, metalness: 0.25, flatShading: true }))
    rock.position.y = 0.4
    g.add(rock)
    const mat = new THREE.MeshStandardMaterial({ color: '#0c4a42', emissive: '#18e0c0', emissiveIntensity: 1.8, roughness: 0.12, metalness: 0.15 })
    const rnd = mulberry32(5)
    for (let i = 0; i < 9; i += 1) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat)
      const h = 1.3 + rnd() * 1.3
      c.scale.set(0.8, h, 0.8)
      c.position.set((rnd() - 0.5) * 1.3, 1.15 + (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 1.3)
      c.rotation.set((rnd() - 0.5) * 0.9, rnd() * 3, (rnd() - 0.5) * 0.9)
      c.castShadow = true
      g.add(c)
    }
    g.position.set(x, y - 0.1, z)
    return g
  }

  private buildCapsule(model: Model | undefined, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group()
    if (model) {
      const mesh = new THREE.Mesh(model.geometry, model.material)
      mesh.scale.setScalar(4.4 / model.height)
      mesh.castShadow = true
      mesh.rotation.y = 0.5
      g.add(mesh)
    } else {
      // Procedural fallback: scorched conical descent capsule with an open hatch.
      const hull = new THREE.MeshStandardMaterial({ color: '#2b2a2f', roughness: 0.55, metalness: 0.75 })
      const burnt = new THREE.MeshStandardMaterial({ color: '#0d0c0e', roughness: 0.9, metalness: 0.3 })
      const crimson = new THREE.MeshStandardMaterial({ color: '#8f1b1d', roughness: 0.45, metalness: 0.4 })
      const profile = [[0, 0], [1.9, 0.1], [2.1, 0.6], [1.85, 1.8], [1.35, 3.0], [0.7, 3.8], [0.0, 4.1]].map(([r, h]) => new THREE.Vector2(r, h))
      const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), hull)
      body.castShadow = true
      g.add(body)
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.15, 0.8, 24), burnt)
      skirt.position.y = 0.4
      g.add(skirt)
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.88, 1.9, 0.18, 24), crimson)
      stripe.position.y = 1.65
      g.add(stripe)
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 0.15), new THREE.MeshStandardMaterial({ color: '#050506', roughness: 1 }))
      hatch.position.set(0, 1.9, -1.78)
      hatch.rotation.x = -0.18
      g.add(hatch)
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 0.1), hull)
      door.position.set(1.1, 1.8, -2.35)
      door.rotation.set(0, 1.25, 0)
      g.add(door)
      const lightMat = new THREE.MeshStandardMaterial({ color: '#0b3a34', emissive: '#20e8c8', emissiveIntensity: 2.4 })
      for (let i = 0; i < 3; i += 1) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), lightMat)
        const a = -0.6 + i * 0.6
        l.position.set(Math.sin(a) * 1.8, 2.6, -Math.cos(a) * 1.5)
        g.add(l)
      }
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), hull)
      ant.position.set(0.5, 4.5, 0)
      g.add(ant)
    }
    g.position.set(x, y - 0.3, z)
    g.rotation.set(0.1, 0.4, -0.12)
    const glow = glowSprite('#22e8c8', 2.4, 0.6)
    glow.position.set(0, 2.9, -1.4)
    g.add(glow)
    return g
  }

  private buildStrata(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group()
    const cols = ['#0b0b0e', '#3a3232', '#6a1c14', '#1a1a1e', '#8a2a1c', '#2a2626']
    const rnd = mulberry32(31)
    let h = 0
    cols.forEach((c, i) => {
      const th = 0.35 + rnd() * 0.35
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(3.0 - i * 0.1 + rnd() * 0.3, th, 2.2 + rnd() * 0.3),
        new THREE.MeshStandardMaterial({ color: c, roughness: i % 2 ? 0.9 : 0.25, metalness: i % 2 ? 0.1 : 0.5 }),
      )
      m.position.set((rnd() - 0.5) * 0.25, h + th / 2, (rnd() - 0.5) * 0.2)
      m.rotation.y = (rnd() - 0.5) * 0.12
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
      h += th
    })
    // Teal mineral glint trapped between two layers.
    const seam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#0b3a34', emissive: '#20e8c8', emissiveIntensity: 1.6 }))
    seam.position.set(0, 1.45, -1.12)
    g.add(seam)
    g.position.set(x, y - 0.1, z)
    g.rotation.y = 0.4
    return g
  }

  // ------------------------------------------------------------------------------------------
  /** Show node `i` as linked (teal, link beam) or dark (red residue). Flashes when newly linked. */
  setNodeVisual(i: number, repaired: boolean, flash = false): void {
    const n = this.nodes[i]
    if (!n || n.repaired === repaired) return
    n.repaired = repaired
    if (repaired && flash) this.seatFlash[i] = 1
    const m = n.crystal.material as THREE.MeshStandardMaterial
    m.color.set(repaired ? '#0c4a42' : '#2a0806')
    m.emissive.set(repaired ? '#20e8c8' : '#d02a18')
    ;(n.glow.material as THREE.SpriteMaterial).color.set(repaired ? '#20e8c8' : '#d02a18')
    n.beam.visible = repaired
  }

  /** Where a vent is within its cycle: 0..1 charge fraction, and whether it just fired. */
  ventPhase(v: Vent, t: number): { charge: number; firing: number } {
    const ph = (t + v.index * 1.37) % VENT_PERIOD
    const charge = ph > VENT_PERIOD - VENT_CHARGE ? (ph - (VENT_PERIOD - VENT_CHARGE)) / VENT_CHARGE : 0
    const firing = ph < 0.4 ? 1 - ph / 0.4 : 0
    return { charge, firing }
  }

  /** Returns true if the player was hit by a discharge this frame. */
  update(dt: number, time: number, act: number, hold: number, player: THREE.Vector3, camPos: THREE.Vector3): { hit: boolean; fired: boolean; nearVent: boolean } {
    let hit = false
    let fired = false
    let nearVent = false
    const stabilized = act >= 0.999
    const flick = stabilized ? 1 : 0.65 + 0.35 * Math.sin(time * 13.1) * Math.sin(time * 7.3 + 1) + 0.12 * Math.sin(time * 31)
    this.beamMat.uniforms.uPow.value = (0.22 + 0.78 * act + hold * 0.4) * (stabilized ? 1 : 0.7 + 0.3 * flick)
    this.pylonLight.intensity = (3 + 22 * act + hold * 20) * flick
    ;(this.pylonGlow.material as THREE.SpriteMaterial).opacity = (0.3 + 0.55 * act + hold * 0.3) * (0.8 + 0.2 * flick)
    this.pylonGlow.scale.setScalar(14 + 8 * act + hold * 8)
    // Pulse rings
    this.rings.forEach((r, i) => {
      const period = stabilized ? 4.5 : 7
      const t = ((time + i * (period / 3)) % period) / period
      const radius = 2 + t * (stabilized ? 55 : 26)
      r.scale.set(radius, radius, 1)
      ;(r.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (0.15 + 0.5 * act) * (1 - Math.exp(-t * 14))
    })
    // Nodes: shimmering link + flash on seating
    this.nodes.forEach((n, i) => {
      this.seatFlash[i] = Math.max(0, this.seatFlash[i] - dt * 1.3)
      const m = n.crystal.material as THREE.MeshStandardMaterial
      const base = n.repaired ? 2.2 : 0.7 + 0.5 * Math.sin(time * 2.4 + i)
      m.emissiveIntensity = base + this.seatFlash[i] * 6
      n.crystal.rotation.y += dt * (n.repaired ? 1.2 : 0.2)
      ;(n.glow.material as THREE.SpriteMaterial).opacity = (n.repaired ? 0.85 : 0.5) + this.seatFlash[i]
      if (n.repaired) (n.beam.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(time * 6 + i * 2)
    })
    ;(this.geodeGlow.material as THREE.SpriteMaterial).opacity = 0.45 + 0.3 * Math.sin(time * 2) + act * 0.2
    // Pickups bob and spin
    for (const p of this.pickups) {
      p.object.visible = !p.collected
      p.glow.visible = !p.collected
      if (p.collected) continue
      p.object.rotation.y += dt * 1.4
      p.object.position.y = p.base + Math.sin(time * 2 + p.pos.x) * 0.1
      p.glow.position.y = p.object.position.y
      ;(p.glow.material as THREE.SpriteMaterial).opacity = (p.kind === 'shard' ? 0.65 : 0.3) + 0.2 * Math.sin(time * 3 + p.pos.z)
    }
    // Vents: telegraph, discharge, damage
    for (const v of this.vents) {
      const { charge, firing } = this.ventPhase(v, time)
      const ringMat = v.ring.material as THREE.MeshBasicMaterial
      ringMat.opacity = 0.14 + charge * 0.7
      ringMat.color.set(charge > 0 ? '#ff7a40' : '#c02a18')
      ;(v.glow.material as THREE.SpriteMaterial).opacity = 0.35 + charge * 0.9 + firing * 0.8
      v.glow.scale.setScalar(6 + charge * 6 + firing * 5)
      const wr = 0.8 + (1 - firing) * VENT_RADIUS * 1.05
      v.wave.scale.set(wr, wr, 1)
      ;(v.wave.material as THREE.MeshBasicMaterial).opacity = firing * 0.9
      if (firing > 0.01 && !v.hitThisCycle) {
        v.hitThisCycle = true
        fired = fired || v.pos.distanceTo(camPos) < 70
        const d = Math.hypot(player.x - v.pos.x, player.z - v.pos.z)
        if (d < VENT_RADIUS && player.y - v.pos.y < 3.2) hit = true
      }
      if (firing === 0) v.hitThisCycle = false
      const dd = Math.hypot(player.x - v.pos.x, player.z - v.pos.z)
      if (dd < VENT_RADIUS + 3) nearVent = true
    }
    return { hit, fired, nearVent }
  }

  /** Smooth 0..1 weight for ambient Life-Core hum by distance. */
  coreProximity(p: THREE.Vector3): number {
    return 1 - smooth(10, 120, Math.hypot(p.x - this.pylonPos.x, p.z - this.pylonPos.z))
  }
}
