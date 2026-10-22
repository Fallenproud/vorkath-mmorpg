import { createGameApp } from './app.mjs'
import { gameRouter } from './routers.mjs'
import { migrate } from './db.mjs'

for (const name of ['MANUS_PROJECT_ID', 'MANUS_JWT_SECRET', 'MANUS_OAUTH_API_URL', 'MANUS_OAUTH_PORTAL_URL', 'DATABASE_URL']) {
  if (!process.env[name]) throw new Error(`Required Webdev runtime value is missing: ${name}`)
}
// Idempotent: applies only unfinished migrations. A failure is logged and retried lazily by the first request.
migrate().then(a => { if (a.length) console.log('[db] applied', a.join(', ')) }).catch(e => console.error('[db] migration failed', e))
const app = createGameApp(gameRouter)
const port = Number(process.env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
app.listen(port, '0.0.0.0')
