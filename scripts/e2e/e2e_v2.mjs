// V2 end-to-end: real input for the Life-Core holds; debug hooks only to stage prerequisites and speed the ramp.
import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } })
const page = await ctx.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)) })
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message))
const wait = ms => page.waitForTimeout(ms)
const st = async () => JSON.parse(await page.evaluate(() => JSON.stringify(window.__vorkath.game.debugState())))
const key = (code, down) => page.evaluate(([c, d]) => window.__vorkath.input.simulateKey(c, d), [code, down])
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail) }
const waitFor = async (fn, ms, label) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await wait(300) } console.log('  timeout waiting for', label); return false }

await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
check('A1 title screen has Before/After button', await page.evaluate(() => !!document.querySelector('[data-act=transform]')))
await page.click('[data-act=new]'); await wait(600); await page.click('[data-act=skip]')
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 })
await page.evaluate(() => { const v = window.__vorkath; Object.assign(v.store.data.settings, { quality: 'low' }); v.game.applySettings(v.store.data.settings) })
let s = await st()
check('A2 new game starts Scarred, eco stage 0', s.eco.stage === 0 && s.vit === 0, JSON.stringify(s.eco))
const v2 = await page.evaluate(() => window.__vorkath.game.biota.v2.stats)
check('A3 V2 imports instantiated', !!v2 && v2.instances > 300, JSON.stringify({ instances: v2.instances, chunks: v2.chunks }))

// ---- B: first stabilization by real hold of E at the core -------------------------------------------
await page.evaluate(() => {
  const g = window.__vorkath.game; const p = g.progress
  p.stage = 'stabilize'; p.nodes = [true, true, true]; p.tutorial = { moved: true, sprinted: true, jumped: true }
  for (let i = 0; i < 3; i += 1) g.props.setNodeVisual(i, true, false)
  g.debugRecoverySeconds(8)
  const c = g.props.pylonPos; g.debugTeleport(c.x + 5, c.z + 5, 0)
})
await wait(1500)
await key('KeyE', true)
const gotPrompt = await waitFor(() => !!document.querySelector('.prompt') && document.querySelector('.prompt').textContent.includes('stabilize'), 8000, 'stabilize prompt')
check('B1 hold-prompt shown at the core', gotPrompt)
await waitFor(() => window.__vorkath.game.progress.stabilized, 60000, 'stabilized')
await key('KeyE', false)
s = await st()
check('B2 first hold stabilizes and enters Pioneer (state 1)', s.stabilized && s.eco.stage === 1, JSON.stringify(s.eco))
const log1 = await page.evaluate(() => window.__vorkath.game.ecoLog.slice())
check('B3 ecoLog records one accepted event', log1.length === 1 && log1[0].accepted === true, JSON.stringify(log1))
await waitFor(() => window.__vorkath.game.progress.vitality >= 0.299, 90000, 'pioneer vit')
await wait(4000)
s = await st()
check('B4 vitality plateaus at the Pioneer target (0.30), no runaway to 1', s.vit > 0.29 && s.vit < 0.31, 'vit=' + s.vit)

// ---- C: duplicate / early / max-stage rejection -------------------------------------------------
const dup = await page.evaluate(() => window.__vorkath.game.tryEcoAdvance(1))
check('C1 duplicate event id rejected', !dup.accepted && dup.reason === 'duplicate', JSON.stringify(dup))
await page.evaluate(() => { window.__vorkath.game.progress.vitality = 0.12 })
const early = await page.evaluate(() => window.__vorkath.game.tryEcoAdvance(2))
check('C2 event during transition rejected', !early.accepted && early.reason === 'in-transition', JSON.stringify(early))
s = await st()
check('C3 rejected events leave stage unchanged', s.eco.stage === 1)
await waitFor(() => window.__vorkath.game.progress.vitality >= 0.299, 30000, 're-settle')

// ---- D: second and third surge via real holds --------------------------------------------------------
await page.evaluate(() => { const g = window.__vorkath.game; const p = g.progress; p.stage = 'surgeGrowth'; g.debugTeleport(g.props.pylonPos.x + 5, g.props.pylonPos.z + 5, 0) })
await wait(1500)
await key('KeyE', true)
await waitFor(() => window.__vorkath.game.progress.eco.stage === 2, 60000, 'growth')
await key('KeyE', false)
s = await st()
check('D1 second hold accepted: Growth (state 2)', s.eco.stage === 2, JSON.stringify(s.eco))
// while settling, holding must NOT advance
await wait(300)
await key('KeyE', true); await wait(5000); await key('KeyE', false)
s = await st()
check('D2 holding while Growth is still settling does not skip a state', s.eco.stage === 2 || (s.eco.stage === 3 && s.vit >= 0.63), 'stage=' + s.eco.stage + ' vit=' + s.vit)
await waitFor(() => window.__vorkath.game.progress.vitality >= 0.639, 60000, 'growth vit')
await page.evaluate(() => { const g = window.__vorkath.game; const p = g.progress; if (p.eco.stage < 3) p.stage = 'surgeThriving' })
await wait(800)
let before3 = (await st()).eco.stage
if (before3 < 3) { await key('KeyE', true); await waitFor(() => window.__vorkath.game.progress.eco.stage === 3, 60000, 'thriving'); await key('KeyE', false) }
s = await st()
check('D3 third surge accepted: Thriving (state 3)', s.eco.stage === 3, JSON.stringify(s.eco))
await waitFor(() => window.__vorkath.game.progress.vitality >= 0.999, 90000, 'thriving vit')
s = await st()
check('D4 vitality reaches 1.0', s.vit >= 0.999, 'vit=' + s.vit)
const max = await page.evaluate(() => window.__vorkath.game.tryEcoAdvance(window.__vorkath.game.progress.eco.lastEvent + 1))
check('D5 event past Thriving rejected', !max.accepted && max.reason === 'max-stage', JSON.stringify(max))
const accepted = await page.evaluate(() => window.__vorkath.game.ecoLog.filter(e => e.accepted).map(e => e.to))
check('D6 accepted transitions were exactly 1,2,3 in order', JSON.stringify(accepted) === '[1,2,3]', JSON.stringify(accepted))
await waitFor(() => document.getElementById('statEco')?.textContent === 'Thriving', 20000, 'HUD Thriving')
const hudEco = await page.evaluate(() => document.getElementById('statEco')?.textContent)
check('D7 HUD land state reads Thriving', hudEco === 'Thriving', hudEco)

// ---- E: persistence across reload ---------------------------------------------------------------------------
await page.evaluate(() => window.__vorkath.game.saveNow())
const snap = await page.evaluate(() => { const g = window.__vorkath.game; return { hash: g.eco.hash(), mean: g.eco.meanLife(), stage: g.progress.eco.stage, vit: g.progress.vitality, last: g.progress.eco.lastEvent } })
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.click('[data-act=continue]'); await wait(1500)
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 }).catch(() => {})
await wait(2000)
const after = await page.evaluate(() => { const g = window.__vorkath.game; return { hash: g.eco.hash(), mean: g.eco.meanLife(), stage: g.progress.eco.stage, vit: g.progress.vitality, last: g.progress.eco.lastEvent, restored: g.ecoRestored, hud: document.getElementById('statEco')?.textContent, v2: g.biota.v2.stats.instances } })
check('E1 eco stage, event id and vitality persist across reload', after.stage === snap.stage && after.last === snap.last && Math.abs(after.vit - snap.vit) < 0.002, JSON.stringify({ snap, after }))
check('E2 tile grid restored from save and identical', after.restored === true && after.hash === snap.hash, `hash ${snap.hash} -> ${after.hash} restored=${after.restored}`)
check('E3 HUD shows Thriving after reload', after.hud === 'Thriving')
check('E4 duplicate event still rejected after reload', !(await page.evaluate(() => window.__vorkath.game.tryEcoAdvance(1))).accepted)

// ---- F: corrupt tile blob + legacy save (modified while on the title screen so the unload auto-save cannot overwrite it) ------
const toTitle = async () => { await page.evaluate(() => window.__vorkath.game.toTitle?.()); await wait(2500) }
await page.evaluate(() => window.__vorkath.game.saveNow())
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
const corrupt = await page.evaluate(() => {
  const k = 'vorkath-prime.save.v2'
  const j = JSON.parse(localStorage.getItem(k)); if (j?.progress?.ecoTiles === undefined) return null
  j.progress.ecoTiles = 'AAAA'; localStorage.setItem(k, JSON.stringify(j)); return k
})
check('F0 located save and wrote corrupt tile blob', !!corrupt)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vorkath-prime.save.v2')).progress.ecoTiles)
check('F0b corrupt blob still in storage before Continue', stored === 'AAAA', stored)
await page.click('[data-act=continue]'); await wait(1500)
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 }).catch(() => {})
await wait(1500)
const c2 = await page.evaluate(() => { const g = window.__vorkath.game; return { stage: g.progress.eco.stage, restored: g.ecoRestored, hash: g.eco.hash(), mode: g.mode } })
check('F1 corrupt tile blob is rejected and recomputed from vitality', c2.mode === 'playing' && !c2.restored && c2.stage === 3 && c2.hash === snap.hash, JSON.stringify(c2))
await page.evaluate(() => window.__vorkath.game.saveNow())
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.evaluate(() => { const k = 'vorkath-prime.save.v2'; const j = JSON.parse(localStorage.getItem(k)); delete j.progress.eco; delete j.progress.ecoTiles; j.progress.stabilized = true; j.progress.vitality = 1; localStorage.setItem(k, JSON.stringify(j)) })
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
const legacy = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('vorkath-prime.save.v2')); return { hasEco: 'eco' in j.progress, stab: j.progress.stabilized } })
check('F2a legacy fixture has no eco block', !legacy.hasEco && legacy.stab, JSON.stringify(legacy))
await page.click('[data-act=continue]'); await wait(1500)
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 }).catch(() => {})
const c3 = await page.evaluate(() => { const g = window.__vorkath.game; return { stage: g.progress.eco.stage, vit: g.progress.vitality } })
check('F2 pre-V2 save (no eco block, stabilized) loads at Thriving', c3.stage === 3 && c3.vit >= 0.99, JSON.stringify(c3))

// ---- G: previous functionality still works --------------------------------------------------------------------
await page.evaluate(() => { window.__vorkath.game.debugTeleport(0, 150, 0) }); await wait(800)
const y0 = (await st()).pos
await key('KeyW', true); await wait(2500); await key('KeyW', false)
const y1 = (await st()).pos
check('G1 W key still moves the explorer', Math.hypot(y1[0] - y0[0], y1[2] - y0[2]) > 2, JSON.stringify([y0, y1].map(p => p.map(n => +n.toFixed(1)))))
await key('KeyJ', true); await wait(250); await key('KeyJ', false); await wait(1500)
check('G2 journal opens with J', await page.evaluate(() => window.__vorkath.game.journalOpen === true))
await key('KeyJ', true); await wait(250); await key('KeyJ', false); await wait(500)
const tel = await page.evaluate(() => window.__vorkath.game.telemetry())
console.log('telemetry (swiftshader software GL, low quality, 640x360):', JSON.stringify(tel))
check('H1 no console errors during run', logs.length === 0, JSON.stringify(logs))
const fails = results.filter(r => !r.ok)
console.log(`\n${results.length - fails.length}/${results.length} checks passed`)
await browser.close()
process.exit(fails.length ? 1 : 0)
