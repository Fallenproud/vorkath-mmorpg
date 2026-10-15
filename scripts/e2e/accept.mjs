// Acceptance B (reach all six locations), D (landmarks unchanged, flora differs), F (stage metrics), H (import report)
import { chromium } from '/home/ubuntu/vorkathprime/node_modules/playwright/index.mjs'
import fs from 'fs'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)) })
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message))
const wait = ms => page.waitForTimeout(ms)
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.click('[data-act=new]'); await wait(600); await page.click('[data-act=skip]')
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 })
await page.evaluate(() => { const v = window.__vorkath; Object.assign(v.store.data.settings, { quality: 'medium' }); v.game.applySettings(v.store.data.settings); document.querySelectorAll('.toast').forEach(e => e.remove()) })
await page.addStyleTag({ content: '.toast,.objective,#layerHud{display:none!important}' })
const out = { B: [], D: {}, F: [], H: {} }

// ---- B: all six locations, physical ground contact and camera not trapped
for (const k of ['arrival', 'ridge', 'crystal', 'core', 'basin', 'observation']) {
  const r = await page.evaluate(async k => {
    const g = window.__vorkath.game
    const POI = { arrival: [0, 150], ridge: [-98, 52], crystal: [-58, -62], core: [-30, -135], basin: [95, -85], observation: [140, 15] }[k]
    g.debugTeleport(POI[0], POI[1], 0)
    for (let i = 0; i < 80; i += 1) { await new Promise(r => setTimeout(r, 400)); if (g.debugState().region === k && g.camera.position.distanceTo(g.explorerPos) < 8) break }
    await new Promise(r => setTimeout(r, 800))
    const p = g.explorerPos, c = g.camera.position
    const ground = g.hf.heightAt(p.x, p.z), cg = g.hf.heightAt(c.x, c.z)
    return { poi: k, footY: +p.y.toFixed(2), ground: +ground.toFixed(2), dyGround: +(p.y - ground).toFixed(2), camAboveGround: +(c.y - cg).toFixed(2), camDist: +c.distanceTo(p).toFixed(2), region: g.debugState().region }
  }, k)
  out.B.push(r); console.log('B', JSON.stringify(r))
}

// ---- D: geology constant across stages + same-camera screenshots
const heightSig = () => page.evaluate(() => { const g = window.__vorkath.game; let h = 0; for (let x = -200; x <= 200; x += 10) for (let z = -200; z <= 200; z += 10) h = (h * 31 + Math.round(g.hf.heightAt(x, z) * 100)) | 0; const pr = g.props; return { h, spire: pr.spirePos.toArray().map(n => +n.toFixed(2)), pylon: pr.pylonPos.toArray().map(n => +n.toFixed(2)), pod: pr.podPos.toArray().map(n => +n.toFixed(2)), outcrops: g.biota.v2.specimens.outcrop.slice(0, 5).map(s => [+s.pos.x.toFixed(1), +s.pos.z.toFixed(1)]), rubble: g.biota.v2.specimens.rubble.slice(0, 5).map(s => [+s.pos.x.toFixed(1), +s.pos.z.toFixed(1)]) } })
const sigs = []
for (let st = 0; st < 4; st += 1) {
  await page.evaluate(st => { const g = window.__vorkath.game; g.debugSetEco(st, true); g.debugTeleport(40, -30, -1.2) }, st)
  await wait(6000)
  sigs.push(await heightSig())
  await page.screenshot({ path: `/tmp/shots/acc_s${st}.png` })
  const m = await page.evaluate(st => {
    const g = window.__vorkath.game, vit = g.progress.vitality, v2 = g.biota.v2
    const visible = v2.visibleCount(vit); const total = Object.values(visible).reduce((x, y) => x + y, 0)
    return { stage: st, vit, ecoStage: g.progress.eco.stage, meanLife: +g.eco.meanLife().toFixed(4), share: g.eco.lifecycleShare().map(x => +x.toFixed(3)), v2Visible: visible, v2VisibleTotal: total, hash: g.eco.hash(), tel: g.telemetry() }
  }, st)
  out.F.push(m); console.log('F', JSON.stringify({ ...m, tel: undefined }))
}
out.D.sigs = sigs
out.D.terrainIdentical = sigs.every(s => s.h === sigs[0].h)
out.D.landmarksIdentical = sigs.every(s => JSON.stringify([s.spire, s.pylon, s.pod, s.outcrops, s.rubble]) === JSON.stringify([sigs[0].spire, sigs[0].pylon, sigs[0].pod, sigs[0].outcrops, sigs[0].rubble]))
console.log('D terrainIdentical', out.D.terrainIdentical, 'landmarksIdentical', out.D.landmarksIdentical)

// ---- H: import report
out.H = await page.evaluate(() => { const g = window.__vorkath.game, v = g.v2; return { props: Object.fromEntries(Object.entries(v.props).map(([k, p]) => [k, p.report])), stages: v.stages.map(s => s.report) } })
out.errors = logs
fs.writeFileSync('/tmp/accept.json', JSON.stringify(out, null, 1))
console.log('errors', JSON.stringify(logs))
await browser.close()
