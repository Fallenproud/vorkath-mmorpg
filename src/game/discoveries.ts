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
    id: 'gasmat', title: 'Gas Plume Mat', category: 'Hazard', region: 'crystal',
    text: 'A ring of sulphur-yellow crust that has formed around a discharge vent where mineral-rich gas condenses between bursts. The inner edge glows orange and the rim is pale and brittle. It is the only thing growing on the scar, and it is not alive: it is deposited, not grown. The crust marks where the vent has been active longest. (Prototype field note; label taken from the reference ecology board.)',
    hint: 'A yellow crust ring around a vent.',
  },
  {
    id: 'lantern', title: 'Lantern Lichen', category: 'Biology', region: 'basin',
    text: 'Flat amber and green pads that glow faintly, spread over weathered rock behind the recovery front. They are the first thing to colonise cooled fissure crust, and they brighten at night. Where they sit the surface has already stopped being glass. Treat the pad edges as the clearest sign that the front has passed. (Prototype interpretation of a board label; not approved canon.)',
    hint: 'Small glowing pads on cooled rock once recovery begins.',
  },
  {
    id: 'sedge', title: 'Thorn Sedge', category: 'Biology', region: 'basin',
    text: 'A tussock of narrow blades that are olive at the base and crimson at the tip, with stiff points that discourage grazing. It roots in the thin soil formed by lichen and moss and prefers open basin ground and the foothills. The red tips match the bloodstone ore in the soil. (Prototype interpretation; not approved canon.)',
    hint: 'A tussock of red-tipped blades in the new soil.',
  },
  {
    id: 'fern', title: 'Glimmer Fern', category: 'Biology', region: 'basin',
    text: 'A rosette of arching fronds with turquoise-lit leaflet tips. It grows only close to open water, along the stream corridor and the pool rim, and the tips glow brighter nearer the Life-Core. It follows the damp ground as the water table rises. (Prototype interpretation; not approved canon.)',
    hint: 'A glowing fern beside water, once the soil is damp.',
  },
  {
    id: 'mycoid', title: 'Mycoid Spire', category: 'Biology', region: 'basin',
    text: 'A cluster of pale stalks topped by dark crimson caps with a spore-lit rim. It appears after the soil layer and thickens the cover on the foothills and around the crystal field edge. The caps shed fine spores that drift on the wind, which the scanner picks up as faint particles. (Prototype interpretation; not approved canon.)',
    hint: 'Tall pale stalks with red caps, later in the recovery.',
  },
  {
    id: 'lobloom', title: 'Lobloom Tree', category: 'Biology', region: 'basin',
    text: 'A twisted dark trunk carrying five or six rounded canopy lobes. The tops are plum and crimson; the undersides glow coral and teal. It is the last stage of the recovery to appear and only on stable damp soil close to water or the conduit. Its glow is the strongest sign that the ground has become a living system. (Prototype interpretation; not approved canon.)',
    hint: 'A tall tree with glowing underside lobes, at full recovery.',
  },
  {
    id: 'kelp', title: 'Vent Kelp', category: 'Hydrology', region: 'basin',
    text: 'Ribbon-like dark olive fronds that stream upward from the pool bed once the water has risen over them. The tips are rust red. They root in the warm mineral-rich silt near the spring and show that the pool is now a habitat and not just a puddle. (Prototype interpretation; not approved canon.)',
    hint: 'Ribbons under the water of the pool.',
  },
  {
    id: 'panorama', title: 'Observation Panorama', category: 'Survey', region: 'observation',
    text: 'From here the whole route is visible: the black scar of the ridge, the red-lit crystal field, the Life-Core standing calmly in its crater, and the green basin with water running into it. The pulse is steady now. This is the end of the survey slice, and the start of whatever the planet does next.',
    hint: 'The view from the high ground east of the basin.',
  },
]

export const DISCOVERY_BY_ID = new Map(DISCOVERIES.map(d => [d.id, d]))
