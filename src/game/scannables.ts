import * as THREE from 'three'
import type { HeightField } from './heightfield'
import { POI, SCARS } from './layout'
import type { Props } from './props'
import { VENT_RADIUS } from './props'
import type { Flora } from './flora'
import type { Creatures } from './creatures'
import type { Biota, SpeciesId } from './biota'
import { SPECIES } from './biota'
import { BIOME_NAMES, biomeAt, stageAt } from './ecology'
import { growthFront, nodeCount, type Progress } from './state'
import { U } from './uniforms'
import { ECO_STAGES, type EcoGrid } from './ecostate'
import type { SurveyModel } from './surveymodel'

export interface ReadCtx {
  player: THREE.Vector3
  vit: number
  act: number
  progress: Progress
  props: Props
  hf: HeightField
  flora: Flora
  creatures: Creatures
  eco: EcoGrid
  time: number
}

export interface Scannable {
  key: string
  discovery: string
  name: string
  pos: () => THREE.Vector3
  /** Aim tolerance in metres. */
  radius: number
  range: number
  enabled: (c: ReadCtx) => boolean
  readings: (c: ReadCtx, self: THREE.Vector3) => [string, string][]
  /** Seconds the scan must be held. */
  seconds?: number
}

const f1 = (n: number) => n.toFixed(1)
const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`
const bearing = (from: THREE.Vector3, to: THREE.Vector3) => {
  const deg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI
  const b = (deg + 360) % 360
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return `${names[Math.round(b / 45) % 8]} (${Math.round(b)} deg)`
}
const dist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

export function buildScannables(env: { props: Props; hf: HeightField; flora: Flora; creatures: Creatures; biota: Biota; eco: EcoGrid; survey: SurveyModel | null; player: () => THREE.Vector3 }): Scannable[] {
  const { props, hf, flora, creatures, biota } = env
  const always = () => true
  const out: Scannable[] = []
  const add = (s: Scannable) => out.push(s)

  const podTop = props.podPos.clone().add(new THREE.Vector3(0, 1.6, 0))
  add({
    key: 'capsule', discovery: 'capsule', name: 'Survey drop capsule', pos: () => podTop, radius: 3, range: 40, enabled: always,
    readings: () => [
      ['Hull', 'Intact, one hard landing'],
      ['Underside', 'Scorched, cooling'],
      ['Onboard kit', 'Scanner cell, field journal'],
      ['Location', 'Arrival Site, Scarred Frontier'],
    ],
  })
  add({
    key: 'strata', discovery: 'strata', name: 'Exposed strata', pos: () => props.strataPos, radius: 2.6, range: 36, enabled: always,
    readings: () => [
      ['Distinct layers', '6'],
      ['Iron-oxide bands', '2 of 6 (bloodstone red)'],
      ['Trapped mineral', 'Turquoise seam, decayed'],
      ['Age estimate', 'Layered, not a single event'],
    ],
  })
  add({
    key: 'fracture', discovery: 'fracture', name: 'Ridge fracture', pos: () => props.fracturePos, radius: 7, range: 70, enabled: always,
    readings: (c, self) => {
      const s = SCARS[0]
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z)
      return [
        ['Depth', `about ${s.depth} m`],
        ['Length', `about ${Math.round(len)} m`],
        ['Aligned toward', `Crystal field, ${bearing(self, new THREE.Vector3(POI.crystal.x, 0, POI.crystal.z))}`],
        ['Distance from you', `${Math.round(dist(c.player, self))} m`],
      ]
    },
  })
  const beacon = props.pylonPos.clone().add(new THREE.Vector3(0, 35, 0))
  add({
    key: 'signature', discovery: 'signature', name: 'Anomalous pulse signature', pos: () => beacon, radius: 22, range: 330, enabled: always, seconds: 1.4,
    readings: (c, self) => [
      ['Bearing', bearing(c.player, self)],
      ['Distance to source', `${Math.round(dist(c.player, props.pylonPos))} m`],
      ['Pulse', c.act >= 0.99 ? 'Steady' : 'Erratic, unstable'],
      ['Likely source', 'Exposed Life-Core'],
    ],
  })
  add({
    key: 'spire', discovery: 'crystalSpire', name: 'Bloodstone spire', pos: () => props.spirePos, radius: 4, range: 48, enabled: always,
    readings: () => [
      ['Height', 'about 8 m'],
      ['Composition', 'Silicate, iron oxide'],
      ['Charge', 'Inert (old growth)'],
      ['Surface', 'Dust-worn facets'],
    ],
  })
  const geodeTop = props.geodePos.clone().add(new THREE.Vector3(0, 1.3, 0))
  add({
    key: 'geode', discovery: 'geode', name: 'Resonant geode', pos: () => geodeTop, radius: 2.4, range: 40, enabled: always,
    readings: (c) => [
      ['Charge', `Resonant, ${pct(0.32 + c.act * 0.55)}`],
      ['Distance to core', `${Math.round(dist(props.geodePos, props.pylonPos))} m`],
      ['Crystal type', 'Turquoise, same as shards'],
    ],
  })
  for (const v of props.vents) {
    add({
      key: `vent${v.index}`, discovery: 'vent', name: 'Unstable discharge vent', pos: () => v.pos.clone().add(new THREE.Vector3(0, 2, 0)), radius: 3.4, range: 46, enabled: always,
      readings: (c) => [
        ['Discharge cycle', '5.2 s'],
        ['Warning', 'Glow rises for 1.3 s'],
        ['Danger radius', `${VENT_RADIUS} m`],
        ['Your distance', `${f1(dist(c.player, v.pos))} m`],
      ],
    })
  }
  for (const p of props.pickups) {
    add({
      key: p.id, discovery: p.kind === 'shard' ? 'shard' : 'ore', name: p.kind === 'shard' ? 'Resonance shard' : 'Bloodstone ore',
      pos: () => p.pos, radius: p.kind === 'shard' ? 1.8 : 1.4, range: 40, enabled: () => !p.collected,
      readings: (c, self) => p.kind === 'shard'
        ? [
          ['Charge', '92%'],
          ['Matching sockets', `3 at the Life-Core, ${bearing(self, props.pylonPos)}`],
          ['Distance to sockets', `${Math.round(dist(self, props.pylonPos))} m`],
        ]
        : [
          ['Iron content', 'about 61%'],
          ['Charge', 'None'],
          ['Samples seen', `${c.progress.oreFound.length} of 5 collected`],
        ],
    })
  }
  add({
    key: 'lifecore', discovery: 'lifecore', name: 'Life-Core Exposure', pos: () => props.pylonPos.clone().add(new THREE.Vector3(0, 4.5, 0)), radius: 6, range: 60, enabled: always, seconds: 1.4,
    readings: (c) => [
      ['Conduit nodes', `${nodeCount(c.progress)} of 3 linked`],
      ['Output', c.progress.stabilized ? 'Steady' : 'Erratic'],
      ['Stability', pct(c.progress.stabilized ? 1 : 0.12 + nodeCount(c.progress) * 0.22)],
      ['Resonance shards carried', String(c.progress.shards)],
    ],
  })
  for (const n of props.nodes) {
    add({
      key: `node${n.index}`, discovery: 'conduit', name: 'Conduit node', pos: () => n.pos.clone().add(new THREE.Vector3(0, 2.6, 0)), radius: 1.8, range: 36, enabled: always,
      readings: (c) => [
        ['Socket', n.repaired ? 'Linked, carrying current' : 'Empty, red residue'],
        ['Accepts', 'Resonance shard'],
        ['Shards carried', String(c.progress.shards)],
      ],
    })
  }
  const chPos = props.channelPos
  add({
    key: 'channel', discovery: 'channel', name: 'Dry conduit channel', pos: () => chPos, radius: 4, range: 50, enabled: always,
    readings: (c) => {
      const first = hf.channel[0]
      const last = hf.channel[hf.channel.length - 1]
      return [
        ['Length', `about ${Math.round(last.s)} m`],
        ['Fall to basin', `${f1(first.bed - last.bed)} m`],
        ['Flow', c.vit > 0.04 ? 'Water running' : 'Dry'],
        ['Edges', 'Fused glass'],
      ]
    },
  })
  add({
    key: 'hardpan', discovery: 'hardpan', name: 'Basin hardpan', pos: () => props.hardpanPos, radius: 4.5, range: 46, enabled: always,
    readings: (c) => [
      ['Surface', 'Polygonal silt plates'],
      ['Moisture', pct(Math.min(1, c.vit * 1.4))],
      ['Salt', 'None detected'],
    ],
  })
  add({
    key: 'moss', discovery: 'moss', name: 'Pioneer mat', pos: () => props.mossSpot.clone().add(new THREE.Vector3(0, 0.4, 0)), radius: 3.4, range: 40,
    enabled: (c) => c.vit > 0.12,
    readings: (c) => [
      ['Ground cover here', pct(growthFront(props.mossSpot.x, props.mossSpot.z, c.vit, POI.basin, POI.core))],
      ['Role', 'Holds soil, prepares it for plants'],
      ['Status', 'Colonising'],
    ],
  })
  add({
    key: 'pool', discovery: 'pool', name: 'Spring-fed pool', pos: () => props.poolPos, radius: 8, range: 60,
    enabled: (c) => c.vit > 0.14,
    readings: () => [
      ['Depth at centre', `${f1(Math.max(0, U.uWaterY.value - hf.waterMin + 0.6))} m`],
      ['Temperature', '24 C, slightly warm'],
      ['Source', 'Deep spring under the core'],
      ['Tint', 'Faint turquoise'],
    ],
  })
  const tree = flora.trees[0]
  if (tree) {
    add({
      key: 'frond', discovery: 'frondtree', name: 'Frond-tree', pos: () => tree.pos.clone().add(new THREE.Vector3(0, 3, 0)), radius: 3.6, range: 55,
      enabled: (c) => c.vit > tree.threshold + 0.1,
      readings: (c) => [
        ['Growth stage', pct((c.vit - tree.threshold) / 0.3)],
        ['Height', 'about 4 to 6 m when grown'],
        ['Rooting', 'Damp soil beside water'],
      ],
    })
  }
  add({
    key: 'grazer', discovery: 'mossgrazer', name: 'Mossgrazer', pos: () => (creatures.nearest(env.props.pylonPos) ?? creatures.list[0])?.pos.clone().add(new THREE.Vector3(0, 0.5, 0)) ?? env.props.mossSpot, radius: 1.6, range: 50,
    enabled: (c) => c.vit > 0.44,
    readings: () => {
      const active = creatures.list.filter(x => x.scale > 0.6)
      return [
        ['Seen nearby', String(active.length)],
        ['Diet', 'Pioneer mat'],
        ['Behaviour', 'Freezes, then bolts'],
      ]
    },
  })
  add({
    key: 'panorama', discovery: 'panorama', name: 'Observation panorama', pos: () => props.panoramaPos, radius: 28, range: 140,
    enabled: (c) => c.progress.stabilized && dist(c.player, new THREE.Vector3(POI.observation.x, 0, POI.observation.z)) < 40, seconds: 1.6,
    readings: (c) => [
      ['Recovery', pct(c.vit)],
      ['Life-Core', 'Steady'],
      ['Route', 'Ridge, crystal field, core, basin'],
    ],
  })
  // ---- Biome-dependent species (scan the nearest grown individual) --------------------------------
  const GROW = 0.1
  const bioDefs: { id: SpeciesId; discovery: string; radius: number; lift: number; note: string; habitat: string }[] = [
    { id: 'gasmat', discovery: 'gasmat', radius: 1.9, lift: 0.1, note: 'Condensed sulphur crust', habitat: 'Active discharge vents' },
    { id: 'lichen', discovery: 'lantern', radius: 1.6, lift: 0.1, note: 'Glowing pioneer pads', habitat: 'Cooled rock behind the front' },
    { id: 'sedge', discovery: 'sedge', radius: 1.8, lift: 0.7, note: 'Red-tipped blade tussock', habitat: 'Basin soil and foothills' },
    { id: 'fern', discovery: 'fern', radius: 1.8, lift: 0.7, note: 'Teal-tipped arching fronds', habitat: 'Stream corridor, pool rim' },
    { id: 'mycoid', discovery: 'mycoid', radius: 1.8, lift: 0.9, note: 'Stalked crimson caps', habitat: 'Foothills and crystal-field edge' },
    { id: 'lobloom', discovery: 'lobloom', radius: 4.2, lift: 3.4, note: 'Glowing-lobe canopy tree', habitat: 'Damp stable soil near water' },
    { id: 'kelp', discovery: 'kelp', radius: 2.4, lift: 1.2, note: 'Pool-bed ribbon fronds', habitat: 'Warm silt under open water' },
    { id: 'pioneer', discovery: 'pioneer', radius: 4.5, lift: 0.3, note: 'Low cushion colonies, rust rim', habitat: 'Cooled rock with a little soil and moisture' },
    { id: 'reed', discovery: 'reed', radius: 1.9, lift: 1.0, note: 'Curved olive blade clumps', habitat: 'Level ground at the pool rim and channel' },
    { id: 'shrub', discovery: 'shrub', radius: 2.0, lift: 0.8, note: 'Branching shrub, red/violet dry, olive damp', habitat: 'Gentle soil slopes, foothills and basin' },
    { id: 'canopy', discovery: 'canopy', radius: 4.6, lift: 3.6, note: 'Broad-crowned tree, flared trunk', habitat: 'Deep damp soil beside water, Thriving only' },
    { id: 'rubble', discovery: 'rubble', radius: 2.4, lift: 0.8, note: 'Fractured basalt, moss on upper faces', habitat: 'Ridge and crystal-field slopes' },
    { id: 'outcrop', discovery: 'outcrop', radius: 3.0, lift: 2.2, note: 'Crystal cluster on a basalt base', habitat: 'Crystal field (red) and Life-Core halo (turquoise)' },
  ]
  for (const b of bioDefs) {
    const def = SPECIES.find(x => x.id === b.id)!
    const list = biota.specimens[b.id]
    if (!list.length) continue
    const fixed = b.id === 'gasmat' || b.id === 'rubble' || b.id === 'outcrop'
    const grown = (vit: number, t: number) => fixed || vit > t + GROW
    const nearest = (vit: number) => {
      const me = env.player()
      let best = list[0]
      let bd = Infinity
      for (const sp of list) {
        if (!grown(vit, sp.threshold)) continue
        const dd = Math.hypot(sp.pos.x - me.x, sp.pos.z - me.z)
        if (dd < bd) {
          bd = dd
          best = sp
        }
      }
      return best
    }
    let cachedVit = 0
    add({
      key: `bio-${b.id}`, discovery: b.discovery, name: def.name, pos: () => {
        const sp = nearest(cachedVit)
        const p = sp.pos.clone().add(new THREE.Vector3(0, b.lift, 0))
        if (b.id === 'gasmat') {
          // Aim at the crust rim, to the side of the line to the explorer, so it is distinct from the vent mouth itself.
          const me = env.player()
          const dx = me.x - sp.pos.x
          const dz = me.z - sp.pos.z
          const l = Math.hypot(dx, dz) || 1
          p.x += (-dz / l) * 4.6
          p.z += (dx / l) * 4.6
          p.y = hf.heightAt(p.x, p.z) + 0.1
        }
        return p
      }, radius: b.radius, range: 42,
      enabled: (c) => {
        cachedVit = c.vit
        return list.some(sp => grown(c.vit, sp.threshold))
      },
      readings: (c, self) => {
        const sp = nearest(c.vit)
        const age = c.vit - sp.threshold
        const stage = stageAt(sp.pos.x, sp.pos.z, c.vit)
        const tile = c.eco.sample(sp.pos.x, sp.pos.z)
        return [
          ['Form', b.note],
          ['Habitat', b.habitat],
          ['Biome here', BIOME_NAMES[biomeAt(hf, sp.pos.x, sp.pos.z)]],
          ['Ground stage', stage.name],
          ['Growth', fixed ? (b.id === 'rubble' ? `Moss cover ${pct((c.vit - sp.threshold) / 0.3)}` : 'Fixed landmark') : pct(age / 0.3)],
          ['lifeSpread here', pct(tile.life)],
          ['Water availability', pct(tile.water)],
          ['Soil / nutrient', pct(tile.nutrient)],
          ['Local lifecycle', ECO_STAGES[tile.lifecycle].name],
          ['Colony size', `${biota.counts[b.id]} placed in this slice`],
          ['Distance', `${Math.round(dist(c.player, self))} m`],
        ]
      },
    })
  }
  // ---- Succession model at the Observation Point ---------------------------------------------------
  if (env.survey) {
    const sv = env.survey
    add({
      key: 'stagemodel', discovery: 'stagemodel', name: 'Succession model', pos: () => sv.centre.clone().add(new THREE.Vector3(0, 0.8, 0)), radius: 3.2, range: 45,
      enabled: always, seconds: 1.4,
      readings: (c) => {
        const share = c.eco.lifecycleShare()
        const st = c.progress.eco.stage
        return [
          ['Current state', `${ECO_STAGES[st].name} (${st + 1}/4)`],
          ['State summary', ECO_STAGES[st].summary],
          ['Mean lifeSpread', pct(c.eco.meanLife())],
          ['Tiles by local state', `S ${pct(share[0])} / P ${pct(share[1])} / G ${pct(share[2])} / T ${pct(share[3])}`],
          ['Next surge', st >= 3 ? 'None - fully recovered' : `Core surge to ${ECO_STAGES[st + 1].name}`],
          ['Model tiles', 'VP_STAGE_01-04 prototypes'],
        ]
      },
    })
  }
  return out
}

/**
 * Given the camera ray, return the scannable that the reticle is closest to (or null).
 * Aim tolerance grows slightly with distance so far targets remain practical to hit.
 */
export function pickTarget(list: Scannable[], origin: THREE.Vector3, dir: THREE.Vector3, ctx: ReadCtx): { s: Scannable; pos: THREE.Vector3; dist: number; score: number } | null {
  let best: { s: Scannable; pos: THREE.Vector3; dist: number; score: number } | null = null
  const v = new THREE.Vector3()
  for (const s of list) {
    if (!s.enabled(ctx)) continue
    const p = s.pos()
    v.copy(p).sub(origin)
    const t = v.dot(dir)
    if (t < 1) continue
    const d = ctx.player.distanceTo(p)
    if (d > s.range) continue
    const perp = Math.sqrt(Math.max(0, v.lengthSq() - t * t))
    const tol = s.radius + t * 0.05
    if (perp > tol) continue
    const score = perp / tol
    if (!best || score < best.score) best = { s, pos: p, dist: d, score }
  }
  return best
}
