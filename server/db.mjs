import mysql from 'mysql2/promise'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pool = null

/** Shared MySQL pool. DATABASE_URL is a server secret injected by the platform. */
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
    pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 8, waitForConnections: true, dateStrings: false })
  }
  return pool
}

/**
 * Applies unfinished `NNNN_*.sql` files in order and records each one only after it succeeds.
 * Development and the published container share one database, so this is idempotent by design.
 */
let migrating = null
export function migrate() {
  migrating ??= (async () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const db = getPool()
    await db.query('CREATE TABLE IF NOT EXISTS `vk_migrations` (`name` varchar(120) NOT NULL PRIMARY KEY, `applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)')
    const [rows] = await db.query('SELECT `name` FROM `vk_migrations`')
    const done = new Set(rows.map(r => r.name))
    const files = (await readdir(dir)).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()
    const applied = []
    for (const f of files) {
      if (done.has(f)) continue
      const sql = await readFile(join(dir, f), 'utf8')
      const statements = sql.replace(/^\s*--.*$/gm, '').split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean)
      for (const s of statements) await db.query(s)
      await db.query('INSERT INTO `vk_migrations` (`name`) VALUES (?)', [f])
      applied.push(f)
    }
    return applied
  })().catch(err => { migrating = null; throw err })
  return migrating
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(a => { console.log('applied:', a.length ? a.join(', ') : '(nothing to do)'); return getPool().end() }).catch(e => { console.error(e); process.exit(1) })
}
