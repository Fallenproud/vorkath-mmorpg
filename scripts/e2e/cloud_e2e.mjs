// Browser end-to-end test: guest play, sign-in, cloud save, a second device, conflicts, offline recovery, records,
// the AI Field Analyst UI (loading, error, retry, typing guard), sign out and cloud deletion.
//
// Only one WebGL page is kept alive at a time (software rendering cannot run two scenes at once). "Another device"
// activity that does not need a screen goes through the real HTTP API with the same session cookie format.
// Needs the dev server (3000, proxying /api) and the API (3001) running. Run: node scripts/e2e/cloud_e2e.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupUsers, makeUsers, otherDeviceSave } from '../../server/test/helpers.mjs'
import { getPool } from '../../server/db.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = await import(path.join(root, 'node_modules/playwright/index.mjs'))
const URL_ = process.env.URL || 'http://127.0.0.1:3000/'
const SHOTS = process.env.SHOTS || '/tmp/shots_cloud'
fs.mkdirSync(SHOTS, { recursive: true })
const db = getPool()
const results = []
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).replace(/\s+/g, ' ').slice(0, 220) : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const W = { polling: 500, timeout: 120000 }

const users = await makeUsers(['a', 'b'])
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const errors = []

async function device(user) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } })
  if (user) await ctx.addCookies([{ name: 'webdev_app_session', value: user.token, url: URL_ }])
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('vorkath-prime.quality-set')) localStorage.setItem('vorkath-prime.quality-set', '1') } catch { /* ignore */ } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error ' + m.text().slice(0, 200)) })
  return { ctx, page }
}
async function open(page) {
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction(() => window.__vorkath?.game.mode === 'title', null, { polling: 500, timeout: 240000 })
  await page.evaluate(() => { const s = { ...window.__vorkath.store.data.settings, quality: 'low' }; window.__vorkath.store.data.settings = s; window.__vorkath.game.applySettings(s) })
}
const park = page => page.goto('about:blank')
const sync = page => page.evaluate(() => { const c = window.__vorkath.cloud; return { state: c.state, user: c.user?.id ?? null, rev: c.revision, dirty: c.dirty, conflict: !!c.conflict, msg: c.message } })
const chip = page => page.locator('#acctChip').innerText()
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 90000 })
const dbSave = async uid => { const [r] = await db.query('SELECT `revision`, `discoveries`, `play_time`, `run_id` FROM `vk_saves` WHERE `user_id`=?', [uid]); return r[0] ?? null }
const waitCloud = (page, expr, arg, timeout = 120000) => page.waitForFunction(`(() => { const c = window.__vorkath.cloud; const a = ${JSON.stringify(arg ?? null)}; return (${expr}) })()`, null, { polling: 500, timeout })
async function seed(page, n, extra = {}) {
  await page.evaluate(([n, extra]) => {
    const ids = ['capsule', 'strata', 'fracture', 'signature', 'geode', 'vent', 'shard', 'ore', 'lifecore', 'conduit']
    const p = structuredClone(window.__vorkath.game.progress)
    p.stage = 'ridgeScan'
    p.discoveries = {}
    ids.slice(0, n).forEach((id, i) => { p.discoveries[id] = { at: i + 1, readings: [['Temperature', `${60 + i} C`], ['Density', '3.1 g/cm3']] } })
    Object.assign(p, extra)
    p.playTime = extra.playTime ?? 100 + n * 10
    window.__vorkath.store.saveProgress(p)
  }, [n, extra])
}
async function startPlaying(page) {
  await page.click('[data-act=continue]')
  await page.waitForFunction(() => ['opening', 'playing'].includes(window.__vorkath.game.mode), null, W)
  if (await page.evaluate(() => window.__vorkath.game.mode) === 'opening') await page.evaluate(() => window.__vorkath.game.skipCinematic())
  await page.waitForFunction(() => window.__vorkath.game.mode === 'playing', null, W)
}
const discoveriesLabel = (page, n) => page.locator('#continueInfo').innerText().then(t => new RegExp(`${n}/\\d+ logged`).test(t))

try {
  // ------------------------------------------------------------------ 1. Guest
  const G = await device(null)
  await open(G.page)
  check('guest: account chip invites sign-in', /Sign in to sync/.test(await chip(G.page)), await chip(G.page))
  await G.page.click('#acctChip')
  check('guest: account panel shows the benefits and a Sign in button', await G.page.locator('[data-act=signin]').count() === 1 && /play anywhere/i.test(await G.page.locator('#modalBody').innerText()))
  await shot(G.page, '01_guest_account')
  await G.page.keyboard.press('Escape')
  await seed(G.page, 2)
  await sleep(1200)
  check('guest: local save works with no server involvement', await G.page.evaluate(() => window.__vorkath.store.hasProgress()))
  const meta = await G.page.evaluate(() => JSON.parse(localStorage.getItem('vorkath-prime.sync.v1')))
  check('guest: change is remembered as unsynced', meta?.dirty === true, JSON.stringify(meta))
  await G.ctx.close()

  // ------------------------------------------------------------------ 2. Sign in, first upload (device 1)
  const D1 = await device(users.a)
  await open(D1.page)
  await waitCloud(D1.page, "c.state === 'synced'")
  check('signed in: chip shows the name and Synced', /Ada/.test(await chip(D1.page)) && /Synced/.test(await chip(D1.page)), await chip(D1.page))
  await seed(D1.page, 3)
  await waitCloud(D1.page, 'c.revision >= 1 && !c.dirty')
  let row = await dbSave(users.a.id)
  check('first local save uploads automatically (revision 1, 3 discoveries)', row?.revision === 1 && row.discoveries === 3, JSON.stringify(row))
  await open(D1.page)
  await waitCloud(D1.page, "c.state === 'synced'")
  row = await dbSave(users.a.id)
  check('reload with identical data does not push again', row.revision === 1 && (await sync(D1.page)).rev === 1)
  check('continue button shows the saved progress after reload', await discoveriesLabel(D1.page, 3))
  await park(D1.page)

  // ------------------------------------------------------------------ 3. Second device pulls, plays, pushes
  const D2 = await device(users.a)
  await open(D2.page)
  await waitCloud(D2.page, "c.state === 'synced' && c.revision === 1")
  check('second device: cloud save is loaded onto an empty device', await D2.page.evaluate(() => window.__vorkath.store.hasProgress()) && await discoveriesLabel(D2.page, 3))
  check('second device: player is told, and tracking revision 1', (await sync(D2.page)).rev === 1 && /cloud save was loaded/.test(await D2.page.locator('#titleNote').innerText()))
  await shot(D2.page, '02_second_device_title')
  await startPlaying(D2.page)
  check('second device: can continue playing the pulled save', true)
  await D2.page.evaluate(() => { const g = window.__vorkath.game; g.progress.discoveries.vent = { at: 9, readings: [['Heat', '80 C']] }; g.saveNow() })
  await waitCloud(D2.page, 'c.revision === 2 && !c.dirty')
  row = await dbSave(users.a.id)
  check('second device: progress made while playing syncs (revision 2)', row.revision === 2 && row.discoveries === 4, JSON.stringify(row))

  // ------------------------------------------------------------------ 4. Stale device mid-game cannot overwrite
  const rev3 = await otherDeviceSave(users.a, p => { p.discoveries.conduit = { at: 30, readings: [] } })
  await D2.page.evaluate(() => { const g = window.__vorkath.game; g.progress.discoveries.ore = { at: 31, readings: [] }; g.saveNow() })
  await waitCloud(D2.page, "c.state === 'conflict'")
  row = await dbSave(users.a.id)
  check('stale device mid-game: push is refused, cloud untouched, conflict raised', rev3 === 3 && row.revision === 3 && row.discoveries === 5 && (await sync(D2.page)).conflict, JSON.stringify(row))
  check('stale device mid-game: player gets a toast and the game keeps running', await D2.page.evaluate(() => window.__vorkath.game.mode === 'playing') && /different progress/.test(await D2.page.locator('#toasts').innerText()))
  await D2.ctx.close()

  // ------------------------------------------------------------------ 5. Device 1 auto-updates (no local edits)
  await open(D1.page)
  await waitCloud(D1.page, "c.state === 'synced' && c.revision === 3")
  check('first device: newer cloud progress is taken automatically when nothing local changed', await discoveriesLabel(D1.page, 5))

  // ------------------------------------------------------------------ 6. Conflict -> use account save
  await D1.ctx.route('**/api/**', r => r.abort())
  await seed(D1.page, 7, { playTime: 222 })
  await sleep(500)
  const rev4 = await otherDeviceSave(users.a, p => { p.discoveries.geode = { at: 40, readings: [] }; p.playTime = 300 })
  await D1.ctx.unroute('**/api/**')
  await open(D1.page)
  await D1.page.waitForSelector('text=Choose which progress to keep', { timeout: 90000 })
  const cardText = await D1.page.locator('#modalBody').innerText()
  check('conflict: both versions are shown side by side and nothing is overwritten', /account \(cloud\)/i.test(cardText) && /this device/i.test(cardText) && rev4 === 4 && (await dbSave(users.a.id)).revision === 4)
  await shot(D1.page, '03_conflict')
  check('conflict: sync stays paused while undecided', (await sync(D1.page)).state === 'conflict')
  await D1.page.click('[data-act=resolveCloud]')
  await waitCloud(D1.page, "!c.conflict && c.state === 'synced'")
  check('conflict: "Use account save" replaces the device save and leaves the cloud as is', await discoveriesLabel(D1.page, 6) && (await dbSave(users.a.id)).revision === 4)

  // ------------------------------------------------------------------ 7. Conflict -> keep this device
  await D1.ctx.route('**/api/**', r => r.abort())
  await seed(D1.page, 8, { playTime: 400 })
  await sleep(500)
  await otherDeviceSave(users.a, p => { p.discoveries.lifecore = { at: 50, readings: [] } })
  await D1.ctx.unroute('**/api/**')
  await open(D1.page)
  await D1.page.waitForSelector('text=Choose which progress to keep', { timeout: 90000 })
  await D1.page.click('[data-act=resolveDevice]')
  await waitCloud(D1.page, "!c.conflict && c.state === 'synced' && !c.dirty")
  row = await dbSave(users.a.id)
  check('conflict: "Keep this device" overwrites the cloud (8 discoveries, revision 6)', row.revision === 6 && row.discoveries === 8, JSON.stringify(row))

  // ------------------------------------------------------------------ 8. Offline play recovers
  await D1.ctx.route('**/api/**', r => r.abort())
  await seed(D1.page, 9, { playTime: 420 })
  await D1.page.evaluate(() => { window.__vorkath.cloud.syncNow() })
  await waitCloud(D1.page, "c.state === 'error'")
  check('offline: shows a friendly retrying state and keeps the data', /offline/i.test(await chip(D1.page)) && await D1.page.evaluate(() => window.__vorkath.store.hasProgress()), await chip(D1.page))
  await D1.ctx.unroute('**/api/**')
  await D1.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await waitCloud(D1.page, "c.state === 'synced' && !c.dirty")
  row = await dbSave(users.a.id)
  check('offline: reconnecting uploads the pending changes', row.discoveries === 9 && row.revision === 7, JSON.stringify(row))

  // ------------------------------------------------------------------ 9. Records and profile
  await D1.page.evaluate(() => { const st = window.__vorkath.store; const p = structuredClone(st.progress); p.stabilized = true; p.vitality = 1; p.eco.stage = 3; p.completed = true; p.playTime = 1234; st.saveProgress(p) })
  await waitCloud(D1.page, 'c.revision === 8 && !c.dirty')
  await D1.page.click('[data-act=account]')
  await D1.page.waitForSelector('.recs li', { timeout: 60000 })
  const acct = await D1.page.locator('#modalBody').innerText()
  check('account panel lists run records and personal bests', /Life-Core stabilized/.test(acct) && /Survey completed/.test(acct) && /World reached Thriving/.test(acct) && /completed runs/i.test(acct))
  await shot(D1.page, '04_account_signed_in')
  await D1.page.fill('#nameInput', 'Vorkath Scout')
  await D1.page.click('[data-act=savename]')
  await D1.page.waitForSelector('text=Saved as "Vorkath Scout"', { timeout: 30000 })
  check('display name can be changed and shows in the chip', /Vorkath Scout/.test(await chip(D1.page)))
  await D1.page.keyboard.press('Escape')

  // ------------------------------------------------------------------ 10. AI Field Analyst
  await startPlaying(D1.page)
  await D1.page.keyboard.press('KeyN')
  await D1.page.waitForSelector('#aInput', { timeout: 30000 })
  check('N pauses the game and opens the Field Analyst', await D1.page.evaluate(() => window.__vorkath.game.mode) === 'paused')
  const panelText = await D1.page.locator('#modalBody').innerText()
  check('analyst panel carries the AI-generated label and the non-canon notice', /ai-generated/i.test(panelText) && /official vorkath canon/i.test(panelText))
  await D1.page.click('#aInput')
  await D1.page.keyboard.type('hpjn what is this ridge made of', { delay: 15 })
  const typed = await D1.page.inputValue('#aInput')
  check('typing shortcut letters and spaces goes into the box (no help/pause/journal side effects)', typed === 'hpjn what is this ridge made of' && await D1.page.evaluate(() => window.__vorkath.ui.modal) === 'analyst', typed)
  await D1.ctx.route('**/api/trpc/game.analystAsk**', r => r.abort())
  await D1.page.keyboard.press('Enter')
  await D1.page.waitForSelector('.err', { timeout: 90000 })
  check('analyst error: friendly message, question kept in the box, retry offered', /offline|could not|try again/i.test(await D1.page.locator('.err').innerText()) && (await D1.page.inputValue('#aInput')).startsWith('hpjn what') && await D1.page.locator('[data-act=aretry]').count() === 1, await D1.page.locator('.err').innerText())
  await D1.ctx.unroute('**/api/trpc/game.analystAsk**')
  await shot(D1.page, '05_analyst_error')
  await D1.page.click('[data-act=aretry]')
  const pendingSeen = await D1.page.waitForSelector('.bubble.thinking', { timeout: 8000 }).then(() => true, () => false)
  const btnDisabled = pendingSeen ? await D1.page.locator('[data-act=asend]').isDisabled() : false
  await shot(D1.page, '06_analyst_thinking')
  await D1.page.waitForFunction(() => !document.querySelector('.bubble.thinking'), null, { polling: 500, timeout: 90000 })
  check('analyst loading: shows "analysing" immediately and disables Ask while pending', pendingSeen && btnDisabled)
  const bubbles = await D1.page.locator('.bubble').allInnerTexts()
  check('analyst answers after retry (live model)', bubbles.length >= 2 && bubbles.at(-1).length > 30, bubbles.at(-1))
  check('analyst: input cleared after a successful question', (await D1.page.inputValue('#aInput')) === '')
  await shot(D1.page, '07_analyst_answer')
  await sleep(3000)
  await D1.page.click('[data-act=areport]')
  await D1.page.waitForSelector('.areport h3', { timeout: 120000 })
  const rep = await D1.page.locator('.areport').innerText()
  check('field report is generated and displayed', /field report - ai-generated/i.test(rep) && /next:/i.test(rep), rep.slice(0, 120))
  await shot(D1.page, '08_field_report')
  await D1.page.keyboard.press('Escape')
  check('Escape closes the analyst and returns to the pause menu', await D1.page.evaluate(() => window.__vorkath.game.mode) === 'paused' && await D1.page.evaluate(() => window.__vorkath.ui.modal) === null)
  await D1.page.click('#layerPause [data-act=account]')
  await D1.page.waitForSelector('details.rep', { timeout: 60000 })
  check('saved field report appears under Account', (await D1.page.locator('details.rep').count()) === 1)
  await D1.page.keyboard.press('Escape')

  // ------------------------------------------------------------------ 11. Sign out keeps local progress
  await D1.page.click('#layerPause [data-act=quit]')
  await D1.page.waitForFunction(() => window.__vorkath.game.mode === 'title', null, W)
  await D1.page.click('[data-act=account]')
  await D1.page.waitForSelector('[data-act=signout]')
  await D1.page.click('[data-act=signout]')
  await D1.page.click('[data-act=yes]')
  await waitCloud(D1.page, "c.state === 'signedOut'")
  await D1.page.waitForSelector('[data-act=signin]', { timeout: 30000 })
  check('sign out: back to guest, local progress kept', /Guest|Sign in/.test(await chip(D1.page)) && await D1.page.evaluate(() => window.__vorkath.store.hasProgress()))
  await shot(D1.page, '09_signed_out')
  await D1.page.keyboard.press('Escape')
  check('sign out: server rejects further cloud access (session cleared)', await D1.page.evaluate(async () => { try { await window.ManusAuth.query('profile'); return false } catch (e) { return e?.data?.code === 'UNAUTHORIZED' || /unauth/i.test(String(e?.message)) } }))
  await D1.ctx.close()

  // ------------------------------------------------------------------ 12. Isolation + deletion (account B)
  const B1 = await device(users.b)
  await open(B1.page)
  await waitCloud(B1.page, "c.state === 'synced'")
  check('account B starts empty and does not receive account A progress', !(await B1.page.evaluate(() => window.__vorkath.store.hasProgress())) && !(await dbSave(users.b.id)))
  await seed(B1.page, 4)
  await waitCloud(B1.page, 'c.revision === 1 && !c.dirty')
  await B1.page.click('[data-act=account]')
  await B1.page.waitForSelector('[data-act=deletecloud]')
  await B1.page.click('[data-act=deletecloud]')
  await B1.page.click('[data-act=yes]')
  await B1.page.waitForSelector('text=Syncing is paused', { timeout: 60000 })
  check('delete my cloud data: removed from the server', !(await dbSave(users.b.id)))
  check('delete: local progress stays and syncing is paused', await B1.page.evaluate(() => window.__vorkath.store.hasProgress()))
  await B1.page.keyboard.press('Escape')
  await seed(B1.page, 5)
  await sleep(5000)
  check('delete: further play does not re-upload while paused', !(await dbSave(users.b.id)))
  await B1.page.click('[data-act=account]')
  await B1.page.waitForSelector('[data-act=syncnow]')
  await B1.page.click('[data-act=syncnow]')
  await B1.page.waitForFunction(() => !window.__vorkath.cloud.paused && !window.__vorkath.cloud.dirty && window.__vorkath.cloud.state === 'synced', null, W)
  let back = null
  for (let i = 0; i < 40 && !back; i++) { back = await dbSave(users.b.id); if (!back) await sleep(1000) }
  check('Sync now re-enables cloud save and uploads again', back?.discoveries === 5 && back.revision === 1, JSON.stringify(back))
  await B1.ctx.close()
} catch (e) {
  console.log('TEST ERROR', e.stack || e)
  results.push(['test run completed without exceptions', false])
} finally {
  await browser.close()
  const left = await cleanupUsers()
  console.log(`cleanup: test users remaining = ${left}`)
  await db.end()
}
check('no uncaught page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 1))
process.exit(failed.length ? 1 : 0)
