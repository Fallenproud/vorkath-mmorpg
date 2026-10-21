// Boot the game headless (new game, skip intro) and evaluate a JS expression in the page.
//   node scripts/bench/eval.mjs "window.__vorkath.game.telemetry()" [--url http://127.0.0.1:3000/] [--w 640 --h 360]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = await import(path.join(root, 'node_modules/playwright/index.mjs'))
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: +flag('w', 640), height: +flag('h', 360) } })).newPage()
await page.goto(flag('url', 'http://127.0.0.1:3000/'), { waitUntil: 'load' })
await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { timeout: 180000 })
await page.click('[data-act=new]'); await page.waitForTimeout(600); await page.click('[data-act=skip]')
await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, { timeout: 120000 })
import('node:fs').then(() => {})
const fsm = await import('node:fs')
const expr = args[0].startsWith('@') ? fsm.readFileSync(args[0].slice(1), 'utf8') : args[0]
const res = await page.evaluate(expr)
console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1))
await browser.close()
