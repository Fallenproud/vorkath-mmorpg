# Canon pack integration report (VORKATH_MANUS_CANONICAL_ASSET_PACK_V1)

Scope: iteration 2 of the VORKATH: VORATH PRIME prototype. The pack's images were used as **visual targets only**. No pack image is
loaded, sampled, cut out or shipped by the game. Everything on screen is generated procedurally in code.

## 1. What was read

- Pack `README.md`, the asset manifest, every file in `docs/` and the audit report in `sources/`.
- Pack rules that this work follows: images are visual targets, not meshes; flora species not confirmed as canon must be labelled
  PROPOSED; stage-to-frame mapping is "needs visual review"; character board metrics (54k tris, 78 blendshapes) are **not authoritative**;
  only 66 of the claimed 113 assets were recovered, so no "113/113" claim is made anywhere in the game or in these docs.

## 2. Original references actually viewed and how they were used

Only images that were opened (full size or montage) are listed. Detail is cited only for those.

| Reference (VP-VIS-) | What it shows | Used for |
|---|---|---|
| 011, 012, 013 | Black cracked basalt, glowing fissure networks, tall dark glass spires, red moon, crimson haze | Ground shader (fissure network that cools as the front passes), obsidian-glass spire system, red moon, sky grade |
| 015, 017, 018, 020 | Crimson crystal canyon, salt/mineral flats with red pools, black cliff coast, obsidian cave arch | Mood and palette only; no dedicated geometry built (see limitations) |
| 026, 027, 028, 029, 030, 031 | Pioneer top-down tile (rust soil, yellow-green lichen), mineral braided river, root/mycelium network, root-lit cliff, red wetland, wet basin | Pioneer film/lichen colour, root network emissive layer, stream/pool look, sedge colouring |
| 032, 033, 034, 035 | Transition scrub, olive-green mossy lowland, scar/living contrast, living tile | Scar to living colour ramp (olive moss over red-brown soil), mist in the basin |
| 005 | Life-spread timeline (energy, water, weathering, pioneers, soil, hydro network, primary vegetation, secondary succession, fauna, maturity) | The ten-step ecological succession in `ecology.ts` |
| 007, 008, 004, 021 | Scar-Frontier-Living board, geology atlas, ecological hierarchy, planetary life atlas | Biome list, material set, species list (names as read from the board; spelling partly uncertain) |
| 040, 042 (and 041, 043, 044 in montage only) | Scar and Frontier tile atlases | Biome names mapped to ground behaviour: crystal storm field, fissure plain, weathered foothills, early soil basin, mineral stream corridor, hybrid scrubland, Life-Core conduit halo, vent plain |
| 060, 061, 058 | Hero character board, package overview, clothing/armor atlas | Character look: palette tokens, swept-back dark hair, short stubble, stand-up collar, teal hex gem, backpack with cyan strips, forearm device, 1.82 m target height |
| 016 (viewed), 014, 019 (contact sheet only) | Fissure/steam scene, other ground renders | 016 informed vent steam; 014/019 are not cited for any detail |

Locked palette taken from VP-VIS-060 and used in code: `#0B0D10 #1A1F26 #2B2F36`, crimson `#3A0D12 #7A1C24`, teal `#18D1C0 #4AF0E2`, white `#E6E6E6`.
No navy or marine blue is used for lighting or materials.

## 3. Classification of game assets

Classes follow the pack: ORIGINAL_RECOVERED, NEW_PROPOSED, APPROVED_DERIVED, IMPLEMENTED_AND_TESTED.
**No ORIGINAL_RECOVERED or APPROVED_DERIVED asset exists in this build**, because the pack contains images only. Everything below is NEW_PROPOSED
(newly produced by this prototype); the tested ones are marked.

| Asset | File | Class | Notes |
|---|---|---|---|
| Biome-aware ground material (fissures, strata, ash, pioneer film, moss, soil, root network) | `src/game/terrain.ts` | NEW_PROPOSED, tested visually | Procedural shader, driven by vitality and distance from the Life-Core |
| Ecology and succession model (8 biomes, 10 stages) | `src/game/ecology.ts` | NEW_PROPOSED, tested (HUD readout, scans) | Stage mapping is a prototype interpretation of VP-VIS-005, not approved canon |
| Obsidian-glass crystal spires | `src/game/crystals.ts` | NEW_PROPOSED, tested visually | Procedural, instanced |
| Sky, red moon, lighting, environment map, post chain | `src/game/sky.ts`, `src/engine/renderer.ts` | NEW_PROPOSED, tested visually | MSAA composer, bloom, grade pass |
| Explorer model (head with eyes, brows, nose, lips, ears, stubble, swept hair; suit, armor plates, collar, Life-Core gem, backpack, forearm device, boots) | `src/game/character.ts` | NEW_PROPOSED, tested visually | Procedural meshes on the existing 23-part rig; not a skinned mesh |
| Seven biome-dependent species: Gas Plume Mat, Lantern Lichen, Thorn Sedge, Glimmer Fern, Mycoid Spire, Lobloom Tree, Vent Kelp | `src/game/biota.ts` | NEW_PROPOSED (species names PROPOSED, not approved canon) | Procedural instanced geometry, grows with vitality, biome and distance rules |
| Seven new scan targets and journal entries for those species | `scannables.ts`, `discoveries.ts` | NEW_PROPOSED, **tested** | Each scanned in a real browser run |
| HUD biome and ecological stage line | `game.ts`, `ui.ts` | NEW_PROPOSED, tested | Updates four times a second |
| Five generated GLB models (crystal cluster, pylon, mossgrazer, landing pod, frond-tree) | `assets/models/` | Generated in iteration 1, unchanged | Kept; flora instance counts reduced |

## 4. Gameplay functionality that improved

- Ground now changes by biome and by position relative to the recovery front. The player sees scar, pioneer film, moss, soil and cover as they walk.
- Recovery grows seven species in a fixed order (mats on vents first, trees last). Species appear only in their own biomes.
- Seven new scan targets with live readings (biome, ground stage, growth, colony size, distance). Journal grows from 18 to 25 entries.
- Scan priority fix: the Gas Plume Mat target sits on the crust rim to the side, so it does not collide with the vent target behind it.
- HUD shows the biome and stage under the explorer.
- Character reads as a human with a face and hair instead of a block figure. Head height, collar and pauldrons were corrected.
- Performance: frond-tree and moss instance counts were reduced after profiling (flora triangles about 586k down to about 321k; total about 0.6M triangles and 200 draw calls at low quality). Software-rendered fps readings were too noisy to quote as a before/after.

## 5. What was actually tested

All tests ran in software-rendered headless Chromium (SwiftShader) against the Vite dev server. Frame rates there say nothing about real GPUs.

| Test | Result |
|---|---|
| `tsc --noEmit` and `pnpm build` | Pass |
| `pnpm test` (terrain reachability, loop, preview) | 18 of 18 pass |
| Stabilize the Life-Core, 90 s recovery, reach the basin, save, quit to title, Continue | Pass: stage, vitality, nodes and position restored (`t6`, up to the Continue check) |
| Scan all seven new species with real input (scanner key, hold F), at 100% recovery | Pass 7 of 7. The first run failed on Gas Plume Mat, which was fixed and re-run |
| Journal entries persisted across a page reload and Continue | Pass (discoveries before and after reload equal) |
| HUD biome and stage line | Pass ("Mineral stream corridor - Mature flora") |
| Opening cinematic, Skip, pause, quit to title, teaser mode | Pass, no console errors |
| Console and page errors during the scan and cinematic tests | None |

Not re-run end to end this iteration: the first-time progression through the ridge scan to the final Observation Point as one scripted run.
The older script timed out on the slow software renderer (scan hold took longer than its fixed wait). Stage logic was not changed in this iteration, and the
stabilize-to-basin segment was re-run and passed. A full first-to-last scripted run on a real GPU is still to do.
The pause-menu settings, controls and resume buttons were last exercised in iteration 1; the iteration-2 test only checked pause and quit.

## 6. Not done and limitations

- The pack's ground renders (cliff coast, caves, salt flats, canyon) are not reconstructed as dedicated locations; only the ground look, spires, sky and basin transition are.
- Species are PROPOSED. Their names come from a board whose spelling was partly uncertain. They are not approved canon.
- The explorer is built from procedural meshes (detailed head and hair, no skinning, no clothing variants such as the explorer coat). Face detail is only visible in close camera views.
- The frond-tree model could not be reduced by mesh simplification (the tool produced no change), so its cost was cut by using fewer instances.
- Real GPU performance, gamepad and touch input were not measured.
