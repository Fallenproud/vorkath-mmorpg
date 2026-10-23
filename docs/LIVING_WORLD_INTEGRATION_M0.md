# Living World M0 integration contract

## Verified host architecture (main)
The existing Vorkath 3D game is a Vite/TypeScript project powered by Three.js and Rapier. It already owns the player controller, scanning, fixed game loop, SaveStore (`vorkath-prime.save.v2`), 4 Life-Core ecological stages, EcoGrid and GLB imports. **Do not replace these systems with the standalone M1 demo.**

## What this branch does
Provides `src/game/living-world/skills.ts`: a pure deterministic skill-state domain with 15 XP tracks, node depletion, gather, Cooking, Herblore and regeneration. It has no DOM, no THREE, no storage writes and no runtime services. It is intentionally **not yet wired into player interactions**.

## Integration order
1. Introduce a versioned optional `livingWorld` save payload with migration tests; never overwrite the existing version-2 save or Life-Core `ecoTiles`.
2. Add proximity-verified world resource nodes and map real interactions to `gather` actions; hunting and fishing require actual interactions rather than instant remote clicks.
3. Route gameplay actions through a single integration facade, pass resulting state to inventory / XP HUD, then save atomically.
4. Couple resource regeneration to per-biome EcoGrid conditions using deliberate rules; **do not equate** the skill-domain node stock with Life-Core stage.
5. Introduce Cooking/Herblore stations and recipe UI; restrict ingredient creation to granted gameplay interactions.
6. Add E2E tests for actual browser flows, regression for the existing 3D vertical slice, and real-GPU performance testing.

## Project split
- `vorkath-mmorpg`: canonical 3D gameplay host and world authority.
- `vorkath-living-world`: standalone mechanics prototype / reference, not a second competing game engine.

## Acceptance evidence
Static code added and tests authored. CI/runtime verification must still be recorded. No claim that skills are present in the player HUD or that MMORPG multiplayer has been implemented.
