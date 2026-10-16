# VORKATH: VORATH PRIME - The Scarred Frontier (vertical slice)


_Vorkath Living World Sandbox RPG_



A playable browser 3D science-fantasy exploration slice built with Three.js, Rapier and TypeScript (Vite).
You play a human survey explorer in graphite/obsidian armor with crimson accents and teal details,
crossing one continuous alien region, scanning its features, stabilizing an exposed Life-Core and
watching the Recovery Basin come back to life.

```bash
pnpm install
pnpm dev      # dev server
pnpm build    # typecheck + production build + JS/font budgets
pnpm test     # unit tests (terrain reachability, loop, preview)
```

## Gameplay loop (implemented and exercised end to end in headless Chromium)

1. **Arrival Site** - learn movement (WASD, Shift sprint, Space jump), raise the scanner (Q) and scan the survey capsule.
2. **Fractured Ridge** - scan the exposed strata and the distant pulse signature rising from the north.
3. **Crystal Formation Field** - scan the bloodstone spire and resonant geode, collect three resonance shards (bloodstone ore is optional), avoid unstable discharge vents.
4. **Life-Core Exposure** - scan the Life-Core, seat a shard in each of three conduit nodes (E), then hold E to stabilize.
5. **Recovery Basin** - a shockwave runs through the conduit channel; vitality rises over about 90 seconds, the terrain greens in a patchy front from the basin and core, a pool fills, flora grows (GPU-instanced) and mossgrazers appear. Scan two of the recovering features.
6. **Observation Point** - climb up and scan the panorama. The slice then continues in free exploration.

Objectives, a compass, waypoints, proximity prompts, a field journal (25 entries) and toasts guide the player.
Scan readings are computed from live world state (distance, bearing, vitality, pulse stability, and so on).

## Iteration 2: canon-pack visual pass

Details, reference list, asset classes and test results: [`docs/CANON_PACK_INTEGRATION_REPORT.md`](docs/CANON_PACK_INTEGRATION_REPORT.md).

- Biome-aware ground (`ecology.ts`, `terrain.ts`): fissure plains and crystal storm field cool into pioneer film, moss and soil as the recovery front passes.
- Seven proposed species (`biota.ts`) grow by biome and vitality; each is scannable and logs a journal entry.
- Rebuilt explorer (`character.ts`) with a face, swept hair, stubble, stand-up collar and the Life-Core gem; obsidian-glass spires, red moon, new sky and post chain.
- HUD shows the biome and stage under the explorer.
- Pack images are visual targets only; nothing from the pack is shipped. Species names are PROPOSED, not approved canon.

## Iteration 3: Environment Integration V2

Four ecological states (Scarred, Pioneer, Growth, Thriving) reached by three Life-Core surges, ten supplied GLB prototypes imported and upgraded, biome-dependent vegetation, new scanner targets, an Observation Point Succession Model and an in-game **Before / After Film** (title menu).
Full implementation and test report: [docs/v2/V2_REPORT.md](docs/v2/V2_REPORT.md). Evidence (video, comparison images, run logs): `docs/v2/evidence/`. Repeatable browser tests: `scripts/e2e/`.
Latest run: 26 / 26 unit tests, 29 / 29 browser end-to-end checks (software-rendered Chromium; real-GPU performance not measured).

## Presentation

- Main menu: Continue (shows stage and progress), New Game, Watch the Teaser, How to Play, Settings, About and Limitations.
- Pause menu (Esc): Resume, Journal, Controls, Settings, Return to last safe position, Save and exit.
- Settings: master/music/effects volume, mute, mouse sensitivity, invert Y, field of view, quality tier, reduced motion, key hints; persisted locally.
- Skippable opening (planet-scale orbit descending to the surface), then control is handed over.
- Replayable ~66 s teaser on the live scene: scripted camera, stabilization, ecological transformation; pause, restart, capture still, record clip, exit.
- Fully procedural audio (no audio files).
- Progress is saved to `localStorage`; Continue after a reload restores stage, discoveries, nodes, vitality and position (tested).

## Assets

- 5 generated GLB models (iteration 1) (crystal cluster, Life-Core pylon, mossgrazer, landing pod, frond-tree), simplified for instancing. Terrain, sky, explorer, rocks, water, conduit veins, particles, UI and audio are procedural/original.
- Fonts: bundled ManusCC0 (CC0). No third-party game IP is used. In-game lore is a working draft, not approved canon.

## Known limitations

- One compact region (about 400 m across), not an open world. The explorer is a simple articulated character, not a skinned model.
- Recovery is one scripted ecological state driven by a single vitality value; the creature only wanders, grazes and flees.
- Mouse look uses Pointer Lock; embedded frames may block it (right-drag look is the fallback). No touch controls.
- Verified in software-rendered headless Chromium only: real-GPU performance and gamepad behavior were not measured. Quality tiers scale shadows, particles and flora.
- Only a favicon was prepared for sharing; no OG cover.
- Rapier's WASM bundle dominates download size (about 1.7 MB gzip).

## Credits

Fonts: ManusCC0 - CC0 1.0 (`public/fonts/ManusCC0-LICENSE.txt`). Libraries: three.js (MIT), Rapier (Apache-2.0).
`src/game/tuning.ts` is the preview Tweak parameter catalog (movement and camera); keep it in sync with `config.ts`.
