# V2 working notes (saved for context continuity)

Package: /home/ubuntu/v2/VORKATH_ENVIRONMENT_V2_MANUS (unzipped from VORKATH_ENVIRONMENT_INTEGRATION_V2_MANUS.zip).
Contents: README.md, specs/MANUS_V2_EXECUTION_HANDOFF.md (copied to docs/v2/), specs/ENGINE_IMPORT_AND_MODEL_LIMITS.md (copied),
3d/props/VP_PROTOTYPE_{CRYSTALS,PIONEER,REED,ROCK,SHRUB,TREE}.glb, 3d/stages/VP_STAGE_0{1..4}.glb,
reference/V2_GENERATED_CONCEPT_EXPLORATION_NOT_CANON.png (concept board, NOT canon: sky islands, waterfalls, airships must not be used),
reference/VORKATH_MANUS_CANONICAL_ASSET_PACK_V1.zip (sha256 275ee257...f9c4 == the V1 pack already integrated; same 66 images).

GLB facts (measured): Z-up (trimesh), NO materials, only COLOR_0 vertex colours, no normals, no uv, no LOD/rig/collision.
 CRYSTALS 128 tris, 1.8x1.4x4.2 (z -0.14..4.05) | PIONEER 140 tris flat pads z 0.13..0.39 | REED 210 tris z 0.36..2.23
 ROCK 160 tris z -0.13..0.97 | SHRUB 1034 tris z 0.28..1.64 | TREE 772 tris z 1.5..4.5 (trunk base at z=1.5? check) 
 STAGE_01..04: 14x14 m diorama tiles (x,y -7..7), 460/440/1556/2328 tris, nodes named geometry_N under 'world'.
Handoff WPs: WP-01 backup/inspect, WP-02 import V1 refs + shot->reference map, WP-03 import GLBs/region/POIs/collision,
 WP-04 vegetation/ecology/state machine/persistence (lifeSpread, waterAvailability, terrainMaterialWeights, lifecycle per tile),
 WP-05 Life-Core, scanner, objectives, WP-06 camera/materials/perf/terrain realism, WP-07 cinematic before/after + deterministic capture,
 WP-08 e2e tests, evidence, source export, handoff.
Acceptance A-J: A launches unchanged inputs; B reach 6 POIs w/o clipping; C Life-Core advances exactly one stage per accepted event, duplicates ignored;
 D landmark coords unchanged between stages, flora differs from same camera; E persistence deterministic; F stages distinguishable ground/veg/env response;
 G scanner/objectives reflect real state; H verify import/materials/collisions/anim stability; I before/after video from running scene; J record pass/fail/not-tested.
Rules: stage 3 not unrestricted jungle; new species PROPOSED; prototypes = blockout, never claimed as production meshes; classify provenance.
Backup: git tag pre-v2-backup, /home/ubuntu/backups/vorkathprime_pre_v2.tgz.
Preview URL template: https://3000-ifxs1x5emlkh5fim75ers-8f59d15d.us1.manus.computer (dev server on :3000).

## Implementation status log (agent's own plan, kept for continuity)
DONE: backup tag pre-v2-backup + /home/ubuntu/backups/vorkathprime_pre_v2.tgz; 10 GLBs copied to assets/models/v2/{props,stages} (sha256 all match manifest);
 src/game/ecostate.ts (EcoGrid 26x26 tiles of 16 m + requestEcoAdvance machine + ECO_STAGES vit targets 0/.3/.64/1);
 state.ts (Progress.eco, Progress.ecoTiles, new objective stages surgeGrowth/surgeThriving, old saves -> eco stage 3 if stabilized);
 src/game/v2assets.ts (loadV2 importer Z-up->Y-up, reports; upgradeProp recipes), src/game/v2flora.ts (V2Flora: ecology-weighted placement, chunked hi/lo LOD,
 species pioneer/reed/shrub/canopy/rubble/outcrop; colliders for big rubble/outcrop when physics passed on first build), biota.ts (SpeciesId union extended, Biota ctor (hf,vents,density,eco?,v2?,level,physics?), Biota.update).
 Findings: TREE glb trunk floats 1.5 m above origin (fixed by extending to ground); pioneer/reed/shrub bases 0.13-0.36 m above origin (translated down); no normals/materials.
TODO (in order): wire game.ts (load V2, EcoGrid, Biota args, vitality ramp to stage target, surge interaction at pylon w/ requestEcoAdvance + duplicate guard,
 HUD eco state row in ui.ts, scannables for V2 species + stage-model scan, saveNow ecoTiles + restore, debug hooks: debugSurge/debugSetEco/stepFixed/telemetry/lab),
 Observation Point survey-model with 4 VP_STAGE GLBs (hologram look), core pylon glow per stage, telemetry overlay (F3), before/after cinematic mode + deterministic capture + video via ffmpeg,
 vitest tests (ecostate machine, serialization determinism), browser tests A-J, docs/v2/V2_TEST_REPORT.md + REFERENCE_SHOT_MAP.md + IMPORT_REPORT, README update, checkpoint push, preview URL.
Test harness scripts live in /tmp (shot.mjs, t4/t6/t10/t11 .mjs) - may be lost; re-create from tests described in docs/CANON_PACK_INTEGRATION_REPORT.md.

## Status log 2 (after game.ts wiring)
DONE+verified visually (4-state comparison s_all.png etc. in /tmp/shots, medium quality, swiftshader): game.ts wired (V2 load, EcoGrid, tryEcoAdvance with ecoLog, surge hold at core, ramp to stage targets),
 HUD "Land state" row + pips, discoveries pioneer/reed/shrub/canopy/rubble/outcrop/stagemodel (journal now 32), scannables for V2 species (+tile readings lifeSpread/water/nutrient/lifecycle),
 SurveyModel (src/game/surveymodel.ts, four VP_STAGE tiles on plinth at observation+(-3,+9), scannable 'stagemodel'), telemetry() + debugSetEco/debugEcoSnapshot hooks in game.ts, shot.mjs supports "eco":0..3.
 V2 counts: pioneer 420, reed 480, shrub 150, canopy 9, rubble 230, outcrop 44; hi/lo tris pioneer 2240/140, reed 3360/210, shrub 4136/1034, canopy 12352/772, rubble 2560/160, outcrop 1152/128.
TODO: before/after transformation cinematic + deterministic capture (cinematics.ts, menu button), vitest tests, e2e tests A-J, perf numbers, reports (docs/v2/*), README, checkpoint+push, preview URL.

## Status log 3
Done: transformation film (cinematics.ts transformation(), TRANSFORM_SECONDS=52, title button "Before / After Film", game.startTeaser('transform'), debugCineSeek stepping), unit tests tests/ecology.test.ts (26 total pass),
 e2e /tmp/e2e_v2.mjs 28/29 (G2 journal key artefact), acceptance /tmp/accept.mjs (B POIs, D terrain+landmarks identical, F per-stage visible counts: v2 total 274/282/767/1017 before pioneer offset change), t10 species scans (reed,shrub,canopy,rubble,outcrop,stagemodel scanned; pioneer radius widened to 4.5).
 pioneer threshold offset lowered to -0.15 => 0/61/286/420 pioneers visible at states 0..3.
Pending: film mp4 (deterministic stepping capture, ~8 s per frame in swiftshader), final e2e rerun, reports (docs/v2/V2_TEST_REPORT.md, V2_IMPORT_REPORT.md), README update, build, favicon exists, checkpoint+push, preview URL.
