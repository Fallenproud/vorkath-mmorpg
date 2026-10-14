import type { RegionId } from './layout'

export type Category = 'Geology' | 'Life-Core' | 'Hazard' | 'Biology' | 'Technology' | 'Hydrology' | 'Survey'

export interface Discovery {
  id: string
  title: string
  category: Category
  region: RegionId
  /** Journal text. All lore here is a prototype interpretation, not approved canon. */
  text: string
  /** Shown while still undiscovered. */
  hint: string
}

/**
 * Journal entries. Readings (numbers) are attached when an entry is scanned and come from
 * the live world state; the prose below is a field-note interpretation by the explorer.
 */
export const DISCOVERIES: Discovery[] = [
  {
    id: 'capsule', title: 'Survey Drop Capsule', category: 'Technology', region: 'arrival',
    text: 'Your descent capsule, scorched on the underside from atmospheric entry. The hull still logs the landing: one hard bounce, no breach. It carries a long-range survey kit, a spare scanner cell and little else. Field note: everything you need has to be found out here.',
    hint: 'Your own equipment. The scanner can read it.',
  },
  {
    id: 'strata', title: 'Exposed Strata', category: 'Geology', region: 'ridge',
    text: 'A cut through the ridge shows alternating bands of black glass, charcoal ash and bloodstone-red oxide. Each band is a different eruption or deposit; the red bands are rich in iron. Where the bands are cracked, a faint teal mineral glints between them. Something once pushed energy through this rock.',
    hint: 'Layered rock on the ridge ledge.',
  },
  {
    id: 'fracture', title: 'Ridge Fracture', category: 'Geology', region: 'ridge',
    text: 'The ridge is split by a gorge nearly ten metres deep. The walls are sharp and the two sides do not quite match, which suggests the ground moved sideways as it tore. The break lines up with the crystal field to the north.',
    hint: 'A deep tear in the ridge, north of the viewpoint.',
  },
  {
    id: 'signature', title: 'Anomalous Pulse Signature', category: 'Life-Core', region: 'ridge',
    text: 'A slow rhythmic pulse reaches the scanner from the north, rising out of the plateau as a column of faint light. It repeats on a fixed period and is strongest along the dry channel that leads away from it. The scanner labels the source tentatively: an exposed Life-Core.',
    hint: 'A faint beacon of light far to the north.',
  },
  {
    id: 'crystalSpire', title: 'Bloodstone Spire', category: 'Geology', region: 'crystal',
    text: 'A tall crystal spire, dark red to black, that has grown from fractured basalt. Its facets are slightly rounded where dust storms have worn them. Crystals this size need water and stable heat, neither of which exists here now, so the spires must be old.',
    hint: 'A large dark crystal formation.',
  },
  {
    id: 'geode', title: 'Resonant Geode', category: 'Life-Core', region: 'crystal',
    text: 'A split stone whose hollow is lined with turquoise crystals. They ring faintly when the scanner passes over them and glow brighter the closer you stand to the Life-Core. These are the only crystals in the field that still carry charge: the resonance shards you can collect are fragments of this material.',
    hint: 'A cracked stone with a teal glow inside.',
  },
  {
    id: 'vent', title: 'Unstable Discharge Vent', category: 'Hazard', region: 'crystal',
    text: 'Some crystals have charged beyond what the rock can hold and release the energy in a short pulse. The vent glows brighter for about a second, then discharges in a ring of force. Stay outside the ring or step clear when it brightens: the suit survives a few hits, then shuts down.',
    hint: 'A crystal that flickers on a timer.',
  },
  {
    id: 'shard', title: 'Resonance Shard', category: 'Technology', region: 'crystal',
    text: 'A palm-sized fragment of charged turquoise crystal. It keeps its charge when handled and hums softly in the scanner. Three conduit nodes at the Life-Core appear to accept exactly this shape.',
    hint: 'Collect a glowing fragment in the crystal field.',
  },
  {
    id: 'ore', title: 'Bloodstone Ore', category: 'Geology', region: 'crystal',
    text: 'Dense dark red ore with a metallic sheen. Heavy in iron and rare earths; it carries no charge of its own, but it is what the crystal field grows on. A useful sample for later analysis.',
    hint: 'Collect three samples of dark red ore.',
  },
  {
    id: 'lifecore', title: 'Life-Core Exposure', category: 'Life-Core', region: 'core',
    text: 'The ground has been split open and a column of turquoise mineral energy stands exposed in the crater. Its output is erratic and its three conduit nodes are dark. The channel that once carried the energy downhill is dry. If the core can be re-seated and stabilized, the stored energy has somewhere to go.',
    hint: 'The source of the pulse, at the north crater.',
  },
  {
    id: 'conduit', title: 'Dormant Conduit Node', category: 'Technology', region: 'core',
    text: 'A ring of stone around a socket that fits a resonance shard. When the socket is empty, a dull red residue glows inside. Seating a shard completes a link back to the core and turns the residue turquoise.',
    hint: 'Sockets around the Life-Core.',
  },
  {
    id: 'channel', title: 'Dry Conduit Channel', category: 'Geology', region: 'core',
    text: 'A deliberate cut in the rock, running from the core crater towards the basin. The bed falls continuously, so whatever flowed here always flowed downhill. The edges are fused glass, as if heated, not eroded.',
    hint: 'A cut in the rock leading downhill from the core.',
  },
  {
    id: 'hardpan', title: 'Basin Hardpan', category: 'Geology', region: 'basin',
    text: 'Fine silt dried into pale polygonal plates. The cracks are deep enough to take a boot. There is no sign of life, but also no sign of salt, so this basin held fresh water for a long time before it dried out.',
    hint: 'The cracked floor of the basin.',
  },
  {
    id: 'moss', title: 'Pioneer Mat', category: 'Biology', region: 'basin',
    text: 'A dense low mat of dark green, moss-like organisms that appear as soon as the ground is damp. They hold soil in place and slowly prepare it for larger plants. Proposed prototype classification, not an approved species.',
    hint: 'Something starts to grow where the water returns.',
  },
  {
    id: 'pool', title: 'Spring-fed Pool', category: 'Hydrology', region: 'basin',
    text: 'The channel now carries water into the basin, and the lowest part of the floor has become a shallow pool with a faint turquoise cast. The water is fed from deep below the core, which keeps it clear and slightly warm.',
    hint: 'The low part of the basin, once the channel runs.',
  },
  {
    id: 'frondtree', title: 'Frond-Tree', category: 'Biology', region: 'basin',
    text: 'A tall fibrous plant with broad arching fronds, rooted in the damp ground next to the pool. The fronds are pale along the edges and faintly luminous. Proposed prototype classification, not an approved species.',
    hint: 'A tall plant that grows only once the soil has formed.',
  },
  {
    id: 'mossgrazer', title: 'Mossgrazer', category: 'Biology', region: 'basin',
    text: 'A small six-legged animal with a graphite shell and a soft green underside. It feeds on the pioneer mat, freezes when you move and bolts when you come close. Its arrival means the mat is thick enough to sustain grazing. Proposed prototype classification, not an approved species.',
    hint: 'Movement among the new plants.',
  },
  {
    id: 'panorama', title: 'Observation Panorama', category: 'Survey', region: 'observation',
    text: 'From here the whole route is visible: the black scar of the ridge, the red-lit crystal field, the Life-Core standing calmly in its crater, and the green basin with water running into it. The pulse is steady now. This is the end of the survey slice, and the start of whatever the planet does next.',
    hint: 'The view from the high ground east of the basin.',
  },
]

export const DISCOVERY_BY_ID = new Map(DISCOVERIES.map(d => [d.id, d]))
