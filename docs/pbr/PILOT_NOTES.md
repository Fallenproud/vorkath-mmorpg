# Crystal Formation Field pilot - working notes

Goal: measure first, then pilot PBR textures + GTAO on the Crystal Formation Field only (Ultra tier, opt-in).

Environment constraint: the build sandbox has no GPU (SwiftShader software rendering). Frame times measured here are
NOT representative of real hardware. GPU timings must come from the in-game F3 panel / benchmark JSON on the user's machine.

## Built so far
- src/engine/perf.ts: PerfProbe (CPU submit ms, GPU ms via EXT_disjoint_timer_query_webgl2, rAF interval), memory estimates
- src/engine/renderer.ts: 'ultra' tier, half-res GTAO (AoPass hides depthWrite=false objects), pixel-width override, info.autoReset=false
- src/game/pbr.ts: lazy KTX2 texture-array loader (BC7/ASTC/ETC2 chosen by browser), dummy arrays until ready
- src/game/terrain.ts: planar (rock, ash) + biplanar (cliff) PBR detail over the procedural palette; distance fade 55-185 m
- src/game/bench.ts + src/ui/perfpanel.ts (F3) + scripts/bench/shot.mjs
- scripts/textures/build-textures.sh, docs/pbr/SOURCES.md

## Verified
- Textures load as BC7 in headless Chromium/SwiftShader: 6398 KB transferred, ~1.0-1.6 s.
- Debug views (modulation/normal/AO) show correct orientation of cracks and relief.
