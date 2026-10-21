# Ultra pilot: PBR layers + GTAO on the Crystal Formation Field

Status: **opt-in pilot, off by default.** Nothing about the default experience changes unless the player picks
*Settings -> Graphics -> Ultra* or toggles the layers from the F3 panel.

This report separates what was **measured here**, what was **only estimated**, and what **still needs a real GPU**.

---

## 1. What was built

| Piece | File | Notes |
|---|---|---|
| Measurement harness | `src/engine/perf.ts`, `src/game/bench.ts`, `src/ui/perfpanel.ts`, `scripts/bench/*` | F3 panel, per-frame CPU/GPU timing (GPU via `EXT_disjoint_timer_query_webgl2` when present), draw calls, triangles, geometries/textures, render-target and texture memory estimates, 4 A/B configurations x waypoints x resolutions, JSON download. |
| PBR texture set | `scripts/textures/build-textures.sh`, `public/textures/*.ktx2`, `public/basis/` | 3 CC0 Poly Haven materials (dark_rock, dark_rock_02, burned_ground_01) packed as KTX2/Basis array textures (albedo 2K ETC1S, normal 1K UASTC, ARM 1K ETC1S). 6.4 MB total transfer, loaded lazily the first time Ultra/PBR is enabled. Sources and licences: `docs/pbr/SOURCES.md`. |
| Terrain PBR | `src/game/terrain.ts`, `src/game/pbr.ts` | Triplanar array sampling blended with the existing procedural ground, so the scar/fissure/ecology logic is untouched. Distance-faded so far terrain stays procedural. |
| Obsidian spires | `src/game/crystals.ts` | Triplanar micro-normals, pit roughness, crevice AO **and** a perturbed clearcoat normal plus per-facet tilt. The clearcoat part matters: it mirrors the red sky, and without perturbing it the faces stay uniformly pink. |
| Crystal clusters | `src/game/crystalfx.ts` (new), hooked into `v2flora.ts` and `props.ts` | Per-facet hash gives each facet its own tilt/brightness/roughness; weathering micro-normal; Fresnel rim glow in the crystal's own hue. Applies to V2 outcrops, the hero GLB cluster and fill spikes. No new geometry. |
| GTAO | `src/engine/renderer.ts` | three's `GTAOPass`, inserted before bloom/grade. Ultra tier only. |

## 2. Measured here (headless Chromium, SwiftShader software Vulkan, 640x360, quality High)

Raw data: `docs/pbr/evidence/bench_swiftshader_640.json`.

| Config | Draw calls | Triangles | Geometries | Textures |
|---|---:|---:|---:|---:|
| classic (procedural only) | 348 | 2.72 M | 222 | 58 |
| + PBR layers | 348 | 2.72 M | 225 | 61 |
| + GTAO | **644** | **5.43 M** | 225 | 67 |
| pilot (PBR + GTAO) | **644** | **5.43 M** | 225 | 67 |

* **PBR layers cost no extra draw calls or triangles.** They are a shader and texture cost only (+3 textures).
* **GTAO roughly doubles geometry work** (+296 draw calls, +2.7 M triangles per frame), because `GTAOPass` re-renders the
  whole scene with a normal material. This is the single biggest structural cost found, and it grows with scene density.
* PBR transfer: 6,398 KB, loaded in 6.8 s on the sandbox link; transcoded to **BC7** on this machine.
* Lazy loading verified: with PBR off, no texture request is made (`pbr.state: off`, `transferKB: 0`).
* A first-use hitch was visible (~2 s in the software renderer) when the PBR arrays were first sampled. Textures are now
  uploaded with `initTexture` at load time instead. This was not re-measured afterwards.

### Not valid here

All **millisecond** figures in that JSON (CPU, GPU, frame) come from a software renderer, so they say nothing about real
GPU cost. The harness reported GPU timings of 190 ms to 5,000 ms per frame; ignore them. **No GPU frame-time claim is made
in this report.**

## 3. Estimated, not measured

* PBR texture memory on the GPU: albedo 2048x2048x3 layers + normal and ARM 1024x1024x3 layers at 1 byte/pixel (BC7/ASTC/ETC2)
  with mips is about **25 MB**. If a device cannot take a compressed format and falls back to RGBA8 it is about **100 MB**.
* Render targets (MSAA 4x, HDR): the probe estimates **~37 MB at 960x540**, ~40 MB with GTAO. Scaling by pixel count gives
  roughly **590 MB at 3840x2160**. That is the number that decides whether UHD is viable, and it needs checking on real
  hardware. Dropping MSAA at high resolutions (use the resolution scale override instead) is the first mitigation.

## 4. Visual result

`docs/pbr/evidence/`:
* `pilot_ground_ab.jpg`: ground at the Crystal Field, classic vs pilot.
* `pilot_crystals_ab.jpg`: foreground spires and clusters, classic vs pilot. Spire faces are no longer uniform pink; clusters
  show per-facet glints.
* `pilot_debug_views.jpg`: modulation / normal / AO debug views of the PBR layer.

Honest read: the ground gain is clear at close range and fades with distance by design. The crystal change is real but
modest at this camera distance. **The geometry itself is still low-poly**; shading cannot hide silhouettes. Spires remain
30-triangle prisms, which is the main reason the faceted look persists.

## 5. Tested

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Unit tests (`pnpm test`) | 26 / 26 passed |
| Gameplay + persistence e2e (`scripts/e2e/e2e_v2.mjs`) | **29 / 29 passed**, no console errors (run with the pilot code present, Ultra off) |
| F3 panel: open, toggle PBR and GTAO, close with F3 while a panel button has focus | passed after fixing a focus bug found during this test |
| Production build | passes; textures and Basis transcoder emitted to `dist/` |

Not tested: Ultra on a real GPU, mobile devices, Safari/Firefox, and a full playthrough with Ultra enabled.

## 6. Recommended next steps (in order)

1. **Run the harness on real hardware.** Open the game, press F3, *Run benchmark* then *UHD sweep*, download the JSON.
   Compare 1080p / 1440p / 2160p for classic vs pilot. Decide from that, not from this report.
2. **Replace `GTAOPass`** with a depth-only AO (for example N8AO) so the second geometry pass disappears. That is the
   biggest structural saving found (-296 draw calls, -2.7 M triangles per frame).
3. **Upgrade silhouettes before shading.** Replace the 30-triangle spires and the cluster GLBs with authored high-poly
   crystals (sculpted, 2-5k triangles) plus LODs; add a baked normal/AO map per crystal species.
4. **Stream the heavy GLBs.** Convert models to meshopt-compressed GLB + KTX2 textures (gltf-transform), and load per
   region as the player approaches rather than at startup.
5. **Extend PBR beyond the pilot** (ridge rock, basin soil, water foam) only after step 1 shows headroom.

## 7. How to reproduce

```bash
pnpm install && pnpm dev            # open http://localhost:3000, press F3
node scripts/bench/shot.mjs spec.json --w 960 --h 540 --hideui   # A/B screenshots
node scripts/bench/eval.mjs @expr.js                             # run any expression in the booted game
bash scripts/textures/build-textures.sh                          # rebuild KTX2 set (needs toktx)
```
