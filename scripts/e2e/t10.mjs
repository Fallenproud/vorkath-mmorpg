import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } })
const page = await ctx.newPage()
const logs = []
page.on('console', m => { if (['error'].includes(m.type())) logs.push(m.text().slice(0, 200)) })
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message))
const wait = ms => page.waitForTimeout(ms)
const st = async () => JSON.parse(await page.evaluate(() => JSON.stringify(window.__vorkath.game.debugState())))
const key = (code, down) => page.evaluate(([c, d]) => window.__vorkath.input.simulateKey(c, d), [code, down])
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.click('[data-act=new]'); await wait(600); await page.click('[data-act=skip]')
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 })
await page.evaluate(() => { const v = window.__vorkath; Object.assign(v.store.data.settings, { quality: 'low' }); v.game.applySettings(v.store.data.settings) })
// recovered world
await page.evaluate(() => { const g = window.__vorkath.game; const p = g.progress; p.stage = 'free'; g.debugSetEco(3, true); p.tutorial = { moved: true, sprinted: true, jumped: true } })
await wait(2500)
const keys = (process.env.KEYS || 'bio-pioneer,bio-reed,bio-shrub,bio-canopy,bio-rubble,bio-outcrop,stagemodel').split(',')
const result = {}
for (const k of keys) {
  const info = await page.evaluate(k => { const g = window.__vorkath.game; const s = g.scannableList.find(s => s.key === k); if (!s) return null; const p = s.pos(); return { x: p.x, y: p.y, z: p.z, r: s.radius, d: s.discovery } }, k)
  if (!info) { result[k] = 'missing'; continue }
  let ok = false
  for (let a = 0; a < 6 && !ok; a += 1) {
    const ang = (a / 6) * Math.PI * 2 + 0.4
    const d = 7 + info.r
    await page.evaluate(([i, ang, d]) => { const g = window.__vorkath.game; g.debugTeleport(i.x + Math.sin(ang) * d, i.z + Math.cos(ang) * d); g.debugAim(new g.camera.position.constructor(i.x, i.y, i.z)) }, [info, ang, d])
    await wait(900)
    await page.evaluate(() => { const g = window.__vorkath.game; if (!g.scanMode) window.__vorkath.input.press('scanner') })
    let s = await st()
    for (let w = 0; w < 30 && s.lock !== k; w += 1) { await wait(300); s = await st() }
    if (s.lock === k) {
      await key('KeyF', true)
      for (let i = 0; i < 120; i += 1) { await wait(250); if ((await st()).discoveries.includes(info.d)) { ok = true; break } }
      await key('KeyF', false)
    }
    await page.evaluate(() => { const g = window.__vorkath.game; if (g.scanMode) window.__vorkath.input.press('scanner') })
    await wait(300)
  }
  result[k] = ok ? 'scanned' : 'FAILED'
  const rd = await page.evaluate(k => { const g = window.__vorkath.game; const sc = g.scannableList.find(s => s.key === k); return sc.readings(g.readCtx(), sc.pos()).map(r => r.join(': ')).join(' | ') }, k)
  console.log('  readings', rd.slice(0, 500))
  console.log(k, result[k])
}
console.log('discoveries', JSON.stringify((await st()).discoveries))
// HUD land line
await page.evaluate(() => window.__vorkath.game.debugTeleport(0, 150, 0)); await wait(1500)
console.log('land', await page.evaluate(() => document.getElementById('landName').textContent))
// persistence
await page.evaluate(() => { const v = window.__vorkath; v.game.saveNow?.() ?? v.store.save?.() })
const before = (await st()).discoveries.length
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.click('[data-act=continue]'); await wait(1500)
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 90000 }).catch(() => {})
const after = await st()
console.log('persist before', before, 'after', after.discoveries.length, after.mode, after.vit, after.stabilized)
console.log('errors', JSON.stringify(logs))
await browser.close()
