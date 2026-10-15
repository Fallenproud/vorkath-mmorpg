# VORKATH — ENVIRONMENT INTEGRATION V2: MANUS EXECUTION SPEC

Status: execution-ready design specification, not evidence of implemented gameplay.

## Mission
Extend the EXISTING Manus Vorkath prototype without resetting its player, camera, input or Life-Core mechanics. Construct one navigable ground-level region (working label: Scarred Frontier). Use canonical V1 visual archive as reference truth and supplied GLB props as **new low-poly placeholder geometry**. New concept illustration is not canon.

## Source precedence
Original Vorkath atlas + approved character specification > recovered historic production references > this V2 generated concept sheet > procedural GLB placeholders. Maintain asset provenance. Never claim reference art or low-poly prototypes are production mesh implementations.

## World geography
One contiguous region, not four disconnected maps. Include Arrival Site, Fractured Ridge, Crystal Field, Life-Core Exposure, Recovery Basin, Observation Point. These are working design names only. Maintain identifiable geological landmarks, drainage, terrain scale, routes and paths across all succession states. Camera should remain smooth while world transitions.

## Ecological state machine
0 SCARRED: exposed hostile rock, cracks, sparse biota.
1 PIONEER: isolated pioneer colonies where ground conditions permit.
2 GROWTH: patches expand; shrubs, reeds, moisture influence and soil progression.
3 THRIVING: complex vegetative cover, mature trees only where climate/water permits; not unrestricted jungle.
Implement serializable per-tile values `lifeSpread` in [0..1], waterAvailability, terrainMaterialWeights, and local lifecycle state. Trigger a staged transformation through verified Life-Core interaction in existing gameplay. Transitions must be visibly observable, smooth, repeatable and persistent. Scattering probabilities and scale should follow terrain slope, water, nutrient/soil availability and stage; no random unrelated tropical art.

## Playable user journey
Begin at Arrival Site; walk/scan geology; discover crystal mineral outcrop; reach Life-Core Exposure; activate the existing interaction; observe controlled transformation in Recovery Basin; traverse the transformed environment; return to Observation Point; save/reload and verify persistent stage.

## 3D asset instructions
Import six `VP_PROTOTYPE_*.glb` props and four `VP_STAGE_*.glb` layout examples. Use prototypes for blockout only, not final plant assets. Units are nominal, validate scale and coordinate axes after import. Replace with more elaborate authored geometry using original Vorkath references while preserving a stable asset contract and source files. Do not use unrelated sky-city, whale, airship, gold fantasy props from the generated concept board.

## Visual and performance
Keep obsidian/graphite/crimson with Life-Core teal and biome-dependent natural greens/browns. Avoid navy dominance. Use PBR roughness, ground-material transitions, physically situated emissions; environment LOD, instancing, camera culling and frame-time telemetry. Define target performance against Manus's actual runtime, not invented FPS achievements.

## Acceptance tests
A. Existing prototype still launches with unchanged inputs.
B. Player can reach all six locations without passing through terrain or trapping camera.
C. Life-Core interaction advances exactly one valid stage per accepted event, and duplicate events do not accelerate progress.
D. Geological landmark coordinates are unchanged between stages; flora differences are noticeable from the same observation camera.
E. Transformation remains after reload, with deterministic stage restoration.
F. Each stage has distinguishable ground material, vegetation density and environmental response.
G. Scanner and objectives reflect actual state, not fake HUD labels.
H. Verify asset import, materials, collisions and animation frame stability.
I. Produce a before/after comparison video captured inside actual running scene.
J. Record real tests and limitations, and classify each pass/fail/not-tested.

## Execution work packages
WP-01 Backup / inspect the existing Manus project and asset import compatibility.
WP-02 Import V1 references; classify source truth and map per-shots to reference IDs.
WP-03 Import prototype GLBs; establish the single region, POIs, collision, nav.
WP-04 Implement vegetation, ecology weighting, state machine, persistence.
WP-05 Wire Life-Core, scanner, objectives and environmental presentation.
WP-06 Gameplay camera, materials, performance polish and terrain realism.
WP-07 Cinematic transformation shot and deterministic before/after capture.
WP-08 End-to-end smoke tests, evidence, source export, final handoff.

Proceed autonomously with non-destructive changes. Do not replace original project. Any new lore or species is PROPOSED. Return source changes, exact import outcomes, test results and actual playable preview.
