# VORKATH Environment Integration V2 - implementation and test report

Scope: execute `specs/MANUS_V2_EXECUTION_HANDOFF.md` (WP-01 to WP-08) on top of the existing playable prototype, without replacing it.
Everything below is either measured in this session or marked as not tested. Evidence files are in `docs/v2/evidence/`; the scripts that produced them are in `scripts/e2e/`.

## 1. What changed in the game (summary)

| Area | Before V2 | After V2 |
|---|---|---|
| Ecology | One vitality value, one stabilize event, one recovery | Four serializable ecological states (Scarred, Pioneer, Growth, Thriving) advanced by three accepted Life-Core surges (`src/game/ecostate.ts`) |
| Per-tile data | none | 26 x 26 `EcoGrid` (16 m tiles) with `lifeSpread`, `waterAvailability`, nutrient, terrain material weights and local lifecycle state; serialized in the save |
| Vegetation | GPU-grown procedural flora (V1 pass) | Added GLB-based species placed by ecology rules and growth thresholds (`src/game/v2flora.ts`), chunked hi/lo LOD instancing |
| Objectives | stabilize, observe basin, go to observation | Added "Channel a second surge (Growth)" and "final surge (Thriving)" objectives that only complete when the real eco state is reached (`state.ts`) |
| Scanner | V1 targets | Six new scannable species/geology targets plus the Succession Model; readings are computed live from the eco grid at the target position |
| Observation Point | panorama only | A Succession Model built from the four `VP_STAGE_*.glb` tiles (`src/game/surveymodel.ts`) |
| Cinematics | opening + teaser | Added **Before / After Film** (52 s, title menu button) that plays inside the live scene |
| HUD | land line | Land line plus four state pips and the current eco state name |
| Tests | terrain/loop unit tests, ad hoc browser scripts | Added `tests/ecology.test.ts` (8 unit tests) and repeatable Playwright scripts in `scripts/e2e/` |

## 2. Work packages

| WP | Result | Evidence |
|---|---|---|
| WP-01 inspect / back up | Done. Git tag `pre-v2-backup` and a tarball snapshot made before any edit. Starter modules touched are listed in section 8. | `git tag`, `/home/ubuntu/backups` (sandbox only) |
| WP-02 import V1 references | Done in the earlier iteration (docs/CANON_PACK_INTEGRATION_REPORT.md). V2 verified that `reference/VORKATH_MANUS_CANONICAL_ASSET_PACK_V1.zip` inside the V2 package is the same archive by sha256. | session log |
| WP-03 import GLBs, single region | Done. 10 GLBs parsed and validated, repaired where needed (section 3). Region is the existing single heightfield (about 400 m across); the heightfield is unchanged, so geography is continuous. | `acceptance_B_D_F_H.json` (`H`) |
| WP-04 vegetation, ecology, state machine, persistence | Done (section 4). | unit tests, e2e |
| WP-05 Life-Core, scanner, objectives, presentation | Done (section 5). | e2e, species scan run |
| WP-06 camera, materials, performance, terrain realism | Partly. Camera unchanged. Materials: PBR-style vertex-colour repaint with roughness, ecology-weighted ground. Performance: LOD and chunk culling added; measured only in software GL. | `acceptance_B_D_F_H.json`, e2e telemetry |
| WP-07 before/after cinematic | Done (section 6). | `vorkath_before_after.mp4`, `film_contact.jpg` |
| WP-08 tests, evidence, handoff | Done (section 7). | this file |

## 3. GLB import outcome (measured by the importer at runtime)

All ten files were found and loaded. None carries normals, UVs or materials (vertex colours only), exactly as the package's own limits document says.

| File | Tris | Size (m) | Problem found | Fix applied | Runtime hi-LOD tris (per instance) |
|---|---|---|---|---|---|
| VP_PROTOTYPE_CRYSTALS | 128 | 1.8 x 4.19 x 1.4 | flat vertex-colour blockout | none needed; repainted and subdivided | 896 |
| VP_PROTOTYPE_PIONEER | 140 | 1.56 x 0.26 x 1.49 | floats 0.13 m | moved down 0.13 m | 560 |
| VP_PROTOTYPE_REED | 210 | 1.19 x 1.87 x 1.07 | floats 0.36 m | moved down 0.36 m | 840 |
| VP_PROTOTYPE_ROCK | 160 | 1.6 x 1.1 x 1.1 | flat vertex-colour blockout | none needed; displaced, subdivided and repainted | 2560 |
| VP_PROTOTYPE_SHRUB | 1034 | 1.39 x 1.36 x 1.4 | floats 0.28 m | moved down 0.28 m | 4136 |
| VP_PROTOTYPE_TREE | 772 | 2.83 x 4.5 x 2.5 | trunk base floats 1.5 m | trunk extended to y = 0 with a 1.7x root flare | 12352 |
| VP_STAGE_01 to 04 | 460 / 440 / 1556 / 2328 | 14 x about 4 x 14 | diorama tiles, no materials | used as-is in the Succession Model | not upgraded |

**Important honesty note on "higher-quality authored assets".** The upgraded hi-LOD meshes are produced in code (subdivision, noise displacement, recomputed normals, repainting with the Vorkath palette and per-instance tints). They are *newly produced procedural geometry derived from the supplied blockouts*, not hand-modelled production meshes, and they have no UV-mapped textures. The original low-poly meshes are kept as the lo-LOD.

## 4. Ecology, vegetation and persistence

* **State machine** (`ecostate.ts`): `requestEcoAdvance(eco, eventId, vitality)` accepts an event only if its id is new, the current state has settled (vitality has reached the state's target) and the state is below Thriving. State targets: 0, 0.30, 0.64, 1.00.
* **Tile grid**: `EcoGrid.apply(vitality)` recomputes `lifeSpread` from a recovery front radiating from the Life-Core and the Recovery Basin; water availability, nutrient and slope gate it. Serialization is 8-bit per value; `restore()` rejects malformed blobs and the game then recomputes from vitality.
* **Species** (all names are PROPOSED working names, not canon): Pioneer Cushion, Marsh Reed, Ember Shrub, Shelter Tree (the only tree, restricted to wet deep soil), Basalt Rubble, Crystal Outcrop. Placement rules use biome, slope, water availability, nutrient and spacing. Growth is driven by a per-instance threshold taken from the recovery front, so plants appear at the front first and grow with vitality.
* **Visible instance counts per state** (medium quality, from `v2.visibleCount(vitality)`): total 274 / 307 / 835 / 1017 at states 0 to 3. Pioneers 0 / 33 / 193 / 294, reeds 0 / 0 / 336 / 336, shrubs 0 / 0 / 32 / 105, trees 0 / 0 / 0 / 8. Rubble (230) and outcrops (44) are geology and are constant.
* **Mean lifeSpread** over the grid: 0, 0.0043, 0.0528, 0.1338. Share of tiles per local lifecycle state at Thriving: Scarred 70%, Pioneer 13%, Growth 8%, Thriving 9% - most of the map stays scarred by design; life follows water and soil.

## 5. Gameplay changes

1. **Three real surges.** Holding E at the Life-Core stabilizes it (state 1). The objective then asks you to scan the basin, and later return for surge 2 and surge 3. Holding E while the previous state is still settling does nothing.
2. **Scanner.** New targets: Pioneer Cushion, Marsh Reed, Ember Shrub, Shelter Tree, Basalt Rubble, Crystal Outcrop and the Succession Model. Each reading shows form, habitat, biome at the target, ground stage, growth, `lifeSpread`, water availability, soil/nutrient, local lifecycle state and counts, computed from the world at that position.
3. **Journal.** Seven new entries, unlocked by scanning.
4. **Observation Point.** Succession Model with the four supplied stage tiles.
5. **HUD.** Four state pips and the state name; the land line names the local biome and local stage.
6. **Legacy saves.** A pre-V2 save that was already stabilized loads at Thriving; an unstabilized one loads at Scarred.

## 6. Before / After Film

Title menu, "Before / After Film". 52 seconds, played in the live game scene by the same renderer, terrain, flora, water, particles and lighting as gameplay. Timeline:

| Time | Content |
|---|---|
| 0 to 11.5 s | BEFORE: arc over the Recovery Basin in the Scarred state, explorer standing for scale |
| 11.5 to 22 s | Core sequence: three nodes seat, hold, stabilization pulse, vitality starts rising |
| 22 to 50.4 s | AFTER: the **identical camera arc** replays while the real ecology steps through Pioneer, Growth and Thriving, with captions |
| last 1.6 s | fade out |

The film can be paused, restarted, captured as a still or recorded as a WebM from the teaser bar.

`docs/v2/evidence/vorkath_before_after.mp4` was produced by driving the *running game* to each film time (`debugCineSeek`), screenshotting the canvas at 4 frames per second (800 x 450, medium quality, 208 frames), and encoding with ffmpeg at 24 fps with frame blending. Scenery, camera, lighting and ecology are deterministic at each time; particles and flashes run in real time and are not frame-locked. It is a faithful capture of the real scene, but it is not a real-time recording. In the playable build the film runs live at your machine's frame rate.

**Same-camera comparison** (`four_states_same_camera.jpg`, fixed player position and camera, only the eco state changes; terrain height signature and all landmark positions are identical): mean absolute pixel difference between consecutive states 12.1, 16.4, 14.5 (0 to 3: 29.5); green-dominant pixels 0.0%, 0.4%, 9.8%, 42.2%.

## 7. What was actually tested

All browser runs used headless Chromium with software WebGL (SwiftShader). They prove behaviour, not GPU performance.

| Test | Method | Result |
|---|---|---|
| Type check | `tsc --noEmit` | pass |
| Unit tests | `vitest run`: 26 tests in 4 files (terrain routes, loop, preview, new ecology tests) | 26 / 26 pass |
| Ecology unit tests (8) | state machine: one step per event, duplicate / in-transition / max-stage rejection, corrupt save sanitizing; EcoGrid determinism, serialization round-trip, malformed blob rejection, monotonic spread, lifecycle shares sum to 1 | pass |
| Route reachability | A* over the heightfield between consecutive POIs (existing test) | all 5 legs found |
| End-to-end (`scripts/e2e/e2e_v2.mjs`) | real browser: new game, real held-E interaction at the core for surge 1, 2, 3, duplicate/early/past-max event rejection, vitality plateau at 0.30, reload and Continue, corrupt tile blob, legacy save, movement, journal, console errors | **29 / 29 pass** |
| Acceptance B | teleport to each of the six POIs; explorer on the ground (feet a constant 0.92 to 0.96 m above the terrain height at every POI - the controller's ground-contact offset - never below it), camera above ground and at normal follow distance | pass |
| Acceptance D | terrain height signature (1681 samples on a 10 m grid) and positions of spires, pylon, pod, outcrops and rubble compared across the four states | identical |
| Acceptance F | per state: tile hash, mean lifeSpread, lifecycle shares, visible instances, same-camera screenshots | all four states differ (hashes d321e4d6, 3cb71539, 946c2b6e, 40d0da6d) |
| Scanner | real aimed lock and held F for each new target; readings printed | Reed, Shrub, Canopy, Rubble, Outcrop, Succession Model and Pioneer scanned; Pioneer failed the first time (target too small) and passed after the scan radius was enlarged |
| Persistence | save, reload, Continue; compare stage, event id, vitality, grid hash; discoveries | identical (hash 40d0da6d restored from the save) |
| Before/After film | seeked to ten times and viewed; full 208-frame capture | works; one visual bug seen and fixed (pioneers too few in state 1) |
| Console | errors captured in every run | none |

Test hooks used and why: `debugRecoverySeconds(8)` shortens the 90 s recovery so ramp and plateau can be verified quickly; prerequisites (nodes seated, objective stage) were set directly in some steps. The hold-E interaction, eco event, vitality ramp, save and reload were the real code paths.

**Measured performance (software GL only, not representative of a real GPU):** 640 x 360, low quality: 10 to 22 fps, 209 draw calls, about 645k triangles, 700 V2 instances in 46 chunks, p95 frame time 250 ms (the loop's clamp). I did **not** measure on a real GPU, on mobile, or in Firefox or Safari.

## 8. Files

New: `ecostate.ts`, `v2assets.ts`, `v2flora.ts`, `surveymodel.ts`, `tests/ecology.test.ts`, `assets/models/v2/*` (the ten GLBs), `docs/v2/*`, `scripts/e2e/*`.
Modified: `state.ts`, `game.ts`, `biota.ts`, `cinematics.ts`, `scannables.ts`, `discoveries.ts`, `ui/ui.ts`, `main.ts`, `styles/main.css`.
Preserved without change: player controller, input, camera rig, Life-Core hold mechanic, heightfield, save format (extended, backward compatible).

## 9. Limitations and open items

* Vegetation and rocks are procedurally upgraded blockouts, not authored production assets. No texture maps and no skinned or animated plants.
* Only about a third of the map receives living cover at Thriving; most remains scarred by design. The map is not a jungle.
* The four `VP_STAGE` tiles are shown as a table-top Succession Model, not placed as terrain, because their 14 m layouts do not match the game's heightfield.
* Species names and descriptions are proposals, not approved Vorkath canon.
* Film video is a stepped capture at 4 fps blended to 24 fps; the live in-game film is real-time.
* Real-GPU frame rate, memory, mobile, gamepad and audio loudness were not tested.
* The test hook `debugRecoverySeconds` and the other `debug*` methods remain in the build; they are only reachable from the console.
