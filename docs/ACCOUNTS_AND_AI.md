# Accounts, cloud save and the AI Field Analyst

This document describes the player-account and AI features added on top of the playable Vorkath prototype: what they do, how they are built, how to run and host them, what was tested, and what is not covered.

## What players get

| Feature | Behaviour |
| --- | --- |
| Optional sign-in | Playing as a guest still works exactly as before. A small status chip (top right of the main menu) shows `Sign in to sync`, or the player's name with `Synced`, `Syncing`, `Offline, will retry`, `Choose a save` or `Cloud save paused`. |
| Cloud save | Progress (discoveries, objective stage, Life-Core and ecology state, position, play time) and the portable settings (volume, sensitivity, FOV, flags) are saved to the player's account and restored on any device. Graphics quality is deliberately not synced, because it is device specific. |
| Conflict protection | A device can never silently overwrite newer progress. If the account and the device hold different progress, the player sees both side by side and picks **Use account save** or **Keep this device**. Nothing is replaced until they choose. |
| Offline play | Changes made offline or signed out are remembered (`dirty` flag, persisted) and uploaded on the next successful connection. |
| Profile | A display name (letters, digits, spaces and `_ . -`, max 24 characters) shown on the chip and in the Account panel. |
| Run records | Each playthrough has a run id. One record per run is written for **Life-Core stabilized**, **World reached Thriving** and **Survey completed**. The Account panel shows personal bests: completed runs, fastest completion, most journal entries and field reports written. |
| Privacy controls | **Sign out** keeps the local save. **Delete my cloud data** removes the save, run records, field reports and profile for that account and pauses syncing until the player presses **Sync now**. The local save is never touched. The anonymous daily AI-call counter is kept on purpose (it holds no content), so deleting data cannot be used to reset the daily limit. |
| AI Field Analyst | Press **N** (or use Pause > Field Analyst, or the button in the Journal) to ask questions about what the explorer has actually scanned. Answers are labelled `AI-generated` and carry the notice that nothing the Analyst says is official Vorkath canon. |
| AI field report | One button writes a structured report (title, summary, key findings, risks, next step) for the current run and stores it under the account. |

Signing in is required for the AI features. That protects the credit budget; guests see an explanation and a Sign in button instead of a broken panel.

## Architecture

```
Browser (Three.js game)                          Server (Express + tRPC)              Managed services
-----------------------------------------        -------------------------------      ------------------
src/engine/cloud.ts     CloudSync  ------------> /api/trpc/game.*  (routers.mjs)  --> MySQL (vk_* tables)
src/engine/analyst.ts   askAnalyst/requestReport                    ai.mjs         --> built-in LLM gateway
src/ui/accountpanels.ts HTML builders           /api/health          app.mjs
src/ui/ui.ts            modals, chip, analyst   webdev-adapter.mjs   Manus OAuth session cookie
manus-auth.js           login bridge
```

* **Login**: Manus OAuth through the bridge installed by the platform (`manus-auth.js`, `server/webdev-adapter.mjs`). The session is an HTTP-only cookie; the client never sees a token.
* **Transport**: tRPC with superjson. All procedures live under `game.*` and are protected, so an unauthenticated call is rejected with `UNAUTHORIZED` before any work or credit is spent.
* **Client sync engine** (`CloudSync`): reconciles once per page session after sign-in, then debounces pushes after meaningful changes and flushes on pause, quit, completion and when the tab is hidden. Nothing is pushed before the first successful reconcile. After a failure the engine retries every 30 seconds, and the browser `online` event triggers an immediate retry.
* **Local metadata** `vorkath-prime.sync.v1` holds `{ uid, rev, dirty, off }` so the client knows which cloud revision it last saw and whether it has unsynced changes. Switching to a different account resets it, so one player's progress is never offered to another account.

### Database

Created by `server/0001_vorkath_game.sql`, applied idempotently at server start by `server/db.mjs` (no foreign keys, so the schema stays portable; the delete procedure removes rows explicitly).

| Table | Purpose |
| --- | --- |
| `vk_profiles` | Display name per user |
| `vk_saves` | One row per user: revision counter, run id, stage, discoveries, play time, vitality, eco stage, completed flag, full progress JSON, portable settings JSON |
| `vk_records` | Run milestones, unique on (user, run, kind) so repeated saves never duplicate a record |
| `vk_reports` | Stored AI field reports |
| `vk_ai_usage` | Per-user daily call counter (hard daily cap); not removed by cloud-data deletion |

### API (`game.*`)

| Procedure | Type | Notes |
| --- | --- | --- |
| `profile`, `profileSet` | query, mutation | Read and change the display name |
| `saveGet` | query | Returns `{ exists, summary, progress, settings }` |
| `savePut` | mutation | Optimistic concurrency. Takes `baseRevision`; if the cloud revision differs the write is refused with `{ ok: false, conflict: true, cloud }`. `force` is only sent after an explicit player choice. Runs in a transaction and writes run records with `INSERT IGNORE`. Rejects saves over the size limit and malformed or wrong-version progress |
| `recordsList` | query | Records, personal bests and stored reports |
| `cloudDelete` | mutation | Requires the literal confirmation string `DELETE`; removes save, records, reports and profile |
| `analystAsk` | mutation | Q and A grounded on the client-supplied scan log |
| `fieldReport` | mutation | Structured JSON report, stored per run and stage |

### AI design and guardrails

* **Model**: `gpt-5-mini` through the platform LLM gateway, minimal reasoning effort, `max_completion_tokens` 500. Measured about 2.6 s for a short answer; two alternatives were slower or rejected the minimal-effort setting.
* **Server-side only**: the API key never reaches the browser.
* **Grounding**: the client sends the objective, region, ecology stage, recovery percentage and up to 40 logged discoveries (title, category, readings). The system prompt tells the model to answer only from that log, to say so when something has not been scanned, and to stay inside The Scarred Frontier. An off-topic question gets a polite redirect (visible in the test screenshot `07_analyst_answer.png`).
* **Canon safety**: every Analyst panel and report is labelled AI-generated and not canon; the prompt forbids presenting invented lore as established fact.
* **Input limits**: question at most 300 characters, at most 6 turns of history, context sanitised and length-capped, output length-capped before it is shown.
* **Abuse and cost control**: login required; at least 2.5 s between calls per user (per server instance); hard daily cap of 60 calls per user (`VORKATH_AI_DAILY_LIMIT`, resets 00:00 UTC) enforced in the database; 30 s timeout. A call that failed because the model was unreachable gives its reserved allowance back, so an outage never burns a player's quota.
* **Interface behaviour**: a thinking indicator appears immediately; Ask is disabled while pending; on failure the question stays in the box with a friendly message and a Try again button; the conversation resets when a new run starts so old answers cannot describe a new world.

## Running and hosting

### Local development

```bash
pnpm install
npm --prefix server install          # server dependencies (npm, because server/Dockerfile uses npm ci)
PORT=3001 node server/index.mjs      # API   (needs the environment variables below)
PORT=3000 pnpm dev                   # game  (Vite proxies /api to 127.0.0.1:3001; set API_PORT to change it)
```

### Environment variables (provided by the platform when hosted on Manus)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL connection string |
| `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET` | Session signing |
| `MANUS_OAUTH_API_URL`, `MANUS_OAUTH_PORTAL_URL` | Login |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | AI gateway |
| `VORKATH_AI_DAILY_LIMIT` | Optional, default 60 |
| `PORT` | Server port |

The server refuses to start if a required value is missing. No secret is stored in the repository.

### Production

`pnpm build` produces `dist/`. The platform runs `server/Dockerfile`, serves `dist/` for `/*` and the API for `/api/*`, and health-checks `/api/health`. Publishing is a separate action in the Manus project settings.

### Without the server

The game is fully playable with no backend: if the account service cannot be reached the chip reads offline mode, sign-in is unavailable, and everything else (local save, Continue, scanner, teaser, settings) behaves as before. This is what a static host such as GitHub Pages provides.

## What was tested

| Layer | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit -p .` | clean |
| Unit tests | `npx vitest run` | 26 of 26 passed |
| Server API (real server, real database, two throwaway users) | `node server/test/api.test.mjs` | 45 of 45 passed |
| Browser end-to-end (real Chromium, real server and database, live AI model) | `node scripts/e2e/cloud_e2e.mjs` | 41 of 41 passed |

The API test covers the authentication boundary (anonymous and forged-cookie calls rejected), save validation, optimistic concurrency and forced overwrite, record deduplication, two-account isolation, deletion, AI input validation, rate limiting, the daily cap, quota refund on failure and report storage.

The browser test covers: guest play and the unsynced marker; sign-in and first upload; reload without a duplicate push; a second device pulling the save and continuing to play; a stale device being refused mid-game (cloud untouched, toast shown, game keeps running); automatic update of a clean device; both conflict resolutions with the dialog screenshot; offline detection and recovery; records and personal bests; display name change; opening the Analyst with **N**; typing shortcut letters without triggering game shortcuts; the AI error path (question kept, Try again offered) and loading state (indicator shown, Ask disabled); a live model answer; report generation and its appearance under Account; sign out keeping local progress and the session being rejected afterwards; a second account starting empty; deleting cloud data; and **Sync now** re-uploading. Test users are created directly in the database with correctly signed session cookies and removed at the end (the test asserts zero left).

Evidence screenshots from the last run: `docs/accounts/evidence/`.

## Known limits (stated plainly)

* **Interactive Manus login was not exercised.** The OAuth consent screen needs a real person. Tests mint session cookies in the exact format the server verifies, so everything after login is covered, but the first-time login redirect itself should be checked once on the published site with a real account.
* The 2.5 s spacing between AI calls is kept in memory per server instance; the database daily cap is the hard limit and works across instances.
* Progress is not uploaded from `pagehide` (browsers do not allow authenticated requests there reliably). A change made in the last moments before closing the tab is flagged and uploaded on the next visit.
* Cloud saves keep one slot per account (the latest run), plus per-run records and reports. There is no multi-slot save browser.
* The Analyst can only describe what the explorer has scanned and cannot read the world directly. It can still be wrong, which is why it is labelled.
* Conflict handling is whole-save, not field-by-field merging.
* Browser tests ran on software rendering at low quality with one live page at a time, so timing numbers from them say nothing about real-world performance.
