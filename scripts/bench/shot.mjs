// A/B screenshot tool. Usage:
//   node scripts/bench/shot.mjs views.json [--w 1280 --h 720 --quality ultra --out /tmp/shots --url http://127.0.0.1:3000/ --hideui]
// views.json: [{ "name": "a", "x": -40, "z": -44, "yaw": 2.3, "eco": 0, "pbr": true, "gtao": true, "cam": {"dist":9,"side":0,"up":3.4,"look":2.6,"fov":62}, "wait": 3000 }]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = await import(path.join(root, 'node_modules/playwright/index.mjs'))
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const views = JSON.parse(fs.readFileSync(args[0], 'utf8'))
const W = +flag('w', 1280), H = +flag('h', 720)
const quality = flag('quality', 'ultra')
const out = flag('out', '/tmp/shots')
const url = flag('url', 'http://127.0.0.1:3000/')
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage()
const logs = []
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 500)) })
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 180000 })
await page.click('[data-act=new]'); await page.waitForTimeout(600); await page.click('[data-act=skip]')
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 120000 })
await page.evaluate(q => { const g = window.__vorkath.game; const s = { ...g.store.data.settings, quality: q }; g.store.data.settings = s; g.applySettings(s) }, quality)
if (args.includes('--hideui')) await page.addStyleTag({ content: '#layerHud,.caption,.toast,.lockhint,.objective{visibility:hidden !important}' })
const report = []
for (const v of views) {
  await page.evaluate(([x, z, yaw, eco, pbr, gtao, cam, dbgv]) => {
    const g = window.__vorkath.game
    g.pbrOverride = pbr ?? null; g.debugPbrView(dbgv ?? 0)
    g.renderer.setGtaoOverride(gtao ?? null)
    if (eco !== undefined && eco !== null) g.debugSetEco(eco, true)
    g.debugTeleport(x, z, yaw)
    g.debugCam = cam ?? { dist: 9, side: 0, up: 3.4, look: 2.6, fov: 62 }
  }, [v.x, v.z, v.yaw ?? 0, v.eco ?? null, v.pbr ?? null, v.gtao ?? null, v.cam ?? null, v.dbg ?? 0])
  if (v.pbr !== false) await page.waitForFunction(() => ['ready', 'failed'].includes(window.__vorkath.game.telemetry().pbr.state) || !window.__vorkath.game.renderer.pbrEnabled, null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(v.wait ?? 3500)
  await page.screenshot({ path: path.join(out, v.name + '.png'), timeout: 240000 })
  const t = await page.evaluate(() => { const t = window.__vorkath.game.telemetry(); return { pbr: t.pbr, gtao: t.gtao, calls: t.drawCalls, tris: t.triangles, buffer: t.buffer, cpuMs: t.probe.cpuMs.avg, frameMs: t.probe.frameMs.avg } })
  report.push({ name: v.name, ...t })
}
console.log(JSON.stringify(report))
console.log(logs.join('\n') || 'no console warnings')
await browser.close()
