# Canon reference notes (working file, observations from VORKATH_MANUS_CANONICAL_ASSET_PACK_V1)

Pack extracted at /home/ubuntu/pack/VORKATH_MANUS_CANONICAL_ASSET_PACK_V1 ; downscaled JPG copies at /tmp/ref/VP-VIS-0NN.jpg (may be lost; regenerate from pack).
Pack README/docs rules: images = visual targets only (no meshes/cutouts/engine binaries); flora species unknown must be labelled PROPOSED;
registry classes: ORIGINAL_RECOVERED / NEW_PROPOSED / APPROVED_DERIVED / IMPLEMENTED_AND_TESTED; stage-to-frame mapping "NEEDS VISUAL REVIEW";
character board metrics (54k tris, 78 blendshapes...) are NON-AUTHORITATIVE; actual runtime proxy was 136 verts/204 tris/23 bones/1 walk anim.
Do not claim 113/113 assets (only 66 recovered, 47 unresolved). Never merge demo into canonical assets without reconciliation.

## Images actually viewed (full or montage) and what they show
- VP-VIS-011 (ground A): black cracked basalt plain, glowing red-orange fissure networks, clusters of tall dark translucent glass/crystal spires with red inner glow, big red moon disc top-left, crimson cloudy sky.
- VP-VIS-012: fissure plains with glowing orange crack lines, crystal clusters at the sides, hazy red horizon.
- VP-VIS-013: dark ash dune/rolling plain, lone large crystal spire cluster, red moon + red storm cloud on horizon, Milky-way streak.
- VP-VIS-015: canyon/ridge of crimson-pink glowing crystal veined rock walls, dark rubble floor, magenta glow in the gap.
- VP-VIS-017: salt/mineral flats: red shallow pools, white crystalline evaporite crust rims, distant spires, red moon.
- VP-VIS-018: black cliff coast above blood-red sea with white foam, crystal spires on cliffs, red moon.
- VP-VIS-020: cave arch in layered obsidian with crimson crystals inside, glowing red interior.
- VP-VIS-016 and VP-VIS-014/019: viewed in contact sheet only partly (016 viewed: fissure/steam scene); do not cite details for 014/019.
- VP-VIS-026 (pioneer top-down tile): rust/iron-oxide dark red-brown soil, yellow-green lichen patches, purple small plants, grey braided streams, crystal clusters.
- VP-VIS-027: grey-teal/white mineral river braiding through black rock, red mineral staining, crystal clusters.
- VP-VIS-028: dark ground webbed with red-orange root/mycelium network, small crystals.
- VP-VIS-029: crimson-lit root network spreading over cliff face + waterfall, grey stream, red scrub.
- VP-VIS-030: shallow red-lit wetland with sparse red/orange grass tufts, fog, sun glow.
- VP-VIS-031: wet basin, red shallow pools, mossy dark ground, crystals at rim.
- VP-VIS-032: transition scrub: red/orange/purple glowing shrubs between crystal spires, grey stream with mist.
- VP-VIS-033: transition tile, olive-green + dark moss, braided silver-teal streams, crimson crystals.
- VP-VIS-034: oblique landscape: black spires left/red scar, olive-green mossy lowland right, storm clouds + lightning.
- VP-VIS-035: living tile, greener, dense moss, teal streams.
- VP-VIS-005 life-spread timeline phases: energy access, hydrological capture, chemical weathering, pioneer colonization (microbial mats, lichens), soil formation, hydro network, primary vegetation (moss/grass/pioneer flora), secondary succession (shrubs, canopy), faunal expansion, biome maturity.
- VP-VIS-007 Scar -> Frontier -> Living board; VP-VIS-008 geology & materials atlas; VP-VIS-004 ecological hierarchy (flora list read from board, spelling partly uncertain): Lobloom Tree, Glimmer Fern, Mycoid Spire, Vent Kelp, Crystal Moss, Lantern Lichen, Thorn Sedge, Gas Plume Mats.
- VP-VIS-021 planetary life atlas viewed (contents: biome/life panels).
- VP-VIS-040 Scar Tile Atlas I tiles: 01 Crystal Scar Mountains, 02 Serrated Ridgelines, 03 Obsidian Escarpments, 04 Ash Deserts, 05 Fissure Plains, 06 Lava Shelves, 07 Crystal Storm Fields, 08 Basalt Plateaus (transition), 09 Cratered Flats, 10 Ember-lit Ravines, 11 Subsurface Vents, 12 Transitional Wetlands. Materials: obsidian, crystal spires, scar iron, volcanic glass, basalt, ash, scoria, sulfur crust, mineral crust, lichen.
- VP-VIS-041 Scar Tile Atlas II (viewed in montage only): crystal canyons, toxic mineral pools, sulfur flats, volcanic domes, obsidian coastlines, lava delta, shattered crystal badlands, caldera rims, geothermal vent plains, scar cave entrances, living-code thresholds.
- VP-VIS-042 Frontier Tile Atlas I: 01 Root-fractured crystal fields (scar), 02 Pioneer fungal plains (living: fungal caps, spore mat, humic soil, bio-lume thread), 03 Weathered scar foothills, 04 Early soil basins (soil crust, detritus layer, pioneer moss, microbial film), 05 Rehydrated valleys, 06 Seep-fed slopes, 07 Mineral stream corridors, 08 Hybrid crystal scrublands, 09 Storm-edge terraces, 10 Frontier escarpments, 11 Life-core conduit nodes (conduit vein, life-core crystal, bioelectric field, organic mesh), 12 Subsurface vent plains.
- VP-VIS-043/044 (montage only): Frontier Tile Atlas II, Living Tile Atlas I.
- VP-VIS-060 hero board: LOCKED PALETTE #0B0D10 #1A1F26 #2B2F36 (blacks), #3A0D12 #7A1C24 (crimson), #18D1C0 #4AF0E2 (teal), #E6E6E6; "NAVY / NEAR-NAVY FORBIDDEN". Hero: adult male, dark swept-back hair, short stubble, strong jaw, black tactical suit with crimson seam traces, high stand-up collar, teal hexagonal Life-Core gem at upper chest, backpack module with cyan strips, data pad, forearm device, 1.82 m, shoulder width 0.52 m, head height 0.23 m, arm span 1.86 m, 23 bones. Clothing sets: base suit, tactical armor, explorer coat, environment suit. Animations listed: idle walk run jump land crouch aim.
- VP-VIS-061, VP-VIS-058 viewed (character package overview; clothing/armor attachment atlas).

## Palette tokens used in code (from VP-VIS-060)
black0 #0B0D10, black1 #1A1F26, black2 #2B2F36, crimsonDark #3A0D12, crimson #7A1C24, teal #18D1C0, tealBright #4AF0E2, white #E6E6E6.
