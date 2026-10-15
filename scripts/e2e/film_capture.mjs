// Deterministic capture of the in-game Before/After film: seek the real running scene to t = i/FPS and screenshot it.
import { chromium } from '/home/ubuntu/vorkathprime/node_modules/playwright/index.mjs'
import fs from 'fs'
const FPS = +(process.env.FPS || 12), DUR = 52
const from = +(process.argv[2] || 0), to = +(process.argv[3] || Math.floor(FPS * DUR))
fs.mkdirSync('/tmp/film', { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)) })
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message))
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 120000 })
await page.evaluate(() => { const g = window.__vorkath.game; const s = { ...g.store.data.settings, quality: 'medium' }; g.store.data.settings = s; g.applySettings(s) })
await page.addStyleTag({ content: '#teaserBar{display:none!important}' })
await page.evaluate(() => window.__vorkath.game.startTeaser('transform'))
await page.waitForTimeout(2500)
const t0 = Date.now()
for (let i = from; i < to; i += 1) {
  const fp = `/tmp/film/f_${String(i).padStart(4, '0')}.jpg`
  if (i % 2 === 1 || fs.existsSync(fp)) continue
  const t = i / FPS
  await page.evaluate(async t => {
    const g = window.__vorkath.game
    g.debugCineSeek(t)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  }, t)
  await page.screenshot({ path: fp, type: 'jpeg', quality: 90, timeout: 240000 })
  if (i % 24 === 0) console.log('frame', i, 'elapsed', Math.round((Date.now() - t0) / 1000), 's')
}
console.log('done', from, to, logs.join(' | ') || 'no logs')
await browser.close()
