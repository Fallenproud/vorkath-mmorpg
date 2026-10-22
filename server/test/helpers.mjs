// Test helpers: create throwaway users directly in the database and mint session cookies that the real server
// verifies (same JWT format as the Manus OAuth callback produces). Test rows are removed by cleanupUsers().
import { SignJWT } from 'jose'
import superjson from 'superjson'
import { getPool, migrate } from '../db.mjs'

export async function makeUsers(names) {
  await migrate()
  const db = getPool()
  const out = {}
  for (const label of names) {
    const openId = `vk-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const [r] = await db.query('INSERT INTO `users` (`openId`, `name`, `loginMethod`) VALUES (?, ?, ?)', [openId, label === 'a' ? 'Ada Tester' : 'Bo Tester', 'test'])
    const token = await new SignJWT({ openId, appId: process.env.MANUS_PROJECT_ID, name: '' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode(process.env.MANUS_JWT_SECRET))
    out[label] = { id: r.insertId, openId, token, cookie: `webdev_app_session=${token}` }
  }
  return out
}

export async function cleanupUsers() {
  const db = getPool()
  const [rows] = await db.query('SELECT `id` FROM `users` WHERE `openId` LIKE ?', ['vk-test-%'])
  for (const { id } of rows) for (const t of ['vk_saves', 'vk_records', 'vk_reports', 'vk_profiles', 'vk_ai_usage']) await db.query(`DELETE FROM \`${t}\` WHERE \`user_id\` = ?`, [id])
  await db.query('DELETE FROM `users` WHERE `openId` LIKE ?', ['vk-test-%'])
  const [left] = await db.query('SELECT COUNT(*) AS n FROM `users` WHERE `openId` LIKE ?', ['vk-test-%'])
  return left[0].n
}

/** Calls a game.* tRPC procedure over real HTTP, like another device would. */
export async function remote(kind, name, input, user, base = process.env.API_URL || 'http://127.0.0.1:3001') {
  const headers = { 'Content-Type': 'application/json', cookie: user.cookie }
  const ser = input === undefined ? undefined : superjson.serialize(input)
  const res = kind === 'query'
    ? await fetch(`${base}/api/trpc/game.${name}${ser ? '?input=' + encodeURIComponent(JSON.stringify(ser)) : ''}`, { headers })
    : await fetch(`${base}/api/trpc/game.${name}`, { method: 'POST', headers, body: JSON.stringify(ser ?? { json: null }) })
  const body = await res.json()
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error).slice(0, 200)}`)
  return superjson.deserialize(body.result.data)
}

/** Simulates another device saving: reads the cloud save, lets `mutate` change the progress, saves on top of it. */
export async function otherDeviceSave(user, mutate) {
  const cur = await remote('query', 'saveGet', undefined, user)
  const progress = structuredClone(cur.progress)
  mutate(progress)
  const r = await remote('mutation', 'savePut', { baseRevision: cur.summary.revision, progress, clientId: 'other-device' }, user)
  if (!r.ok) throw new Error('other device save was refused')
  return r.revision
}
