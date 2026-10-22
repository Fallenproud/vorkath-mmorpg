import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from './webdev-adapter.mjs'
import { getPool, migrate } from './db.mjs'
import { AI_MODEL, REPORT_SCHEMA, analystSystem, reportSystem, chat, cleanReply, clip, parseReport, refund, reserve, usageToday } from './ai.mjs'

const MAX_SAVE_BYTES = 120_000
const MAX_REPORTS = 20
let schemaReady = null
const ready = () => (schemaReady ??= migrate().catch(err => { schemaReady = null; throw err }))

const num = (v, a, b, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d)
const iso = d => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null)

/**
 * Light server-side validation of the opaque client save. The server does not trust the blob for anything
 * security-relevant (single-player progress, owned by the caller); it checks shape and size and derives the
 * summary columns that conflict resolution and records are based on.
 */
function summarize(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid save.' })
  if (progress.version !== 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported save version.' })
  if (typeof progress.stage !== 'string' || !/^[A-Za-z]{1,32}$/.test(progress.stage)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid save stage.' })
  const disc = progress.discoveries && typeof progress.discoveries === 'object' && !Array.isArray(progress.discoveries) ? Object.keys(progress.discoveries) : []
  if (disc.length > 200) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid save.' })
  return {
    runId: typeof progress.runId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(progress.runId) ? progress.runId : 'legacy',
    stage: progress.stage,
    discoveries: disc.length,
    playTime: Math.round(num(progress.playTime, 0, 1e8)),
    vitality: num(progress.vitality, 0, 1),
    ecoStage: Math.round(num(progress.eco?.stage, 0, 3)),
    completed: progress.completed === true,
    stabilized: progress.stabilized === true,
  }
}

const SETTING_RANGES = { master: [0, 1], music: [0, 1], sfx: [0, 1], ambience: [0, 1], sensitivity: [0.3, 2.5], fov: [50, 85] }
const SETTING_FLAGS = ['muted', 'invertY', 'reducedMotion', 'hints']
/** Device-specific graphics quality is deliberately not synced. */
function cleanSettings(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const [k, [a, b]] of Object.entries(SETTING_RANGES)) if (typeof raw[k] === 'number') out[k] = num(raw[k], a, b)
  for (const k of SETTING_FLAGS) if (typeof raw[k] === 'boolean') out[k] = raw[k]
  return out
}

const summaryOf = r => ({
  revision: r.revision, runId: r.run_id, stage: r.stage, discoveries: r.discoveries, playTime: r.play_time,
  vitality: r.vitality, ecoStage: r.eco_stage, completed: r.completed === 1, updatedAt: iso(r.updated_at),
})

function defaultName(user) {
  const first = String(user?.name ?? '').split(/\s+/)[0] ?? ''
  const n = first.includes('@') ? '' : first.replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 20)
  return n.length >= 2 ? n : 'Explorer'
}

async function bestsOf(db, userId) {
  const [[b]] = await db.query(
    "SELECT COUNT(*) AS completions, MIN(`play_time`) AS fastest, MAX(`discoveries`) AS most FROM `vk_records` WHERE `user_id` = ? AND `kind` = 'complete'", [userId])
  const [[r]] = await db.query('SELECT COUNT(*) AS n FROM `vk_reports` WHERE `user_id` = ?', [userId])
  return { completions: Number(b.completions), fastestSeconds: b.fastest ?? null, mostDiscoveries: b.most ?? null, reports: Number(r.n) }
}

const aiContext = z.object({
  objective: z.string().max(200),
  region: z.string().max(40).default(''),
  ecoStage: z.number().int().min(0).max(3),
  vitality: z.number().min(0).max(1),
  discoveries: z.array(z.object({
    title: z.string().max(80), category: z.string().max(24), text: z.string().max(400),
    readings: z.array(z.tuple([z.string().max(40), z.string().max(60)])).max(6),
  })).max(40),
})

export const gameRouter = router({
  /** Account summary used by the Account panel: profile, cloud-save summary, personal bests, AI allowance. */
  profile: protectedProcedure.query(async ({ ctx }) => {
    await ready()
    const db = getPool(), uid = ctx.user.id
    await db.query('INSERT IGNORE INTO `vk_profiles` (`user_id`, `display_name`) VALUES (?, ?)', [uid, defaultName(ctx.user)])
    const [[p]] = await db.query('SELECT `display_name`, `created_at` FROM `vk_profiles` WHERE `user_id` = ?', [uid])
    const [[s]] = await db.query('SELECT `revision`, `run_id`, `stage`, `discoveries`, `play_time`, `vitality`, `eco_stage`, `completed`, `updated_at` FROM `vk_saves` WHERE `user_id` = ?', [uid])
    return { id: uid, displayName: p.display_name, memberSince: iso(p.created_at), save: s ? summaryOf(s) : null, bests: await bestsOf(db, uid), ai: await usageToday(uid) }
  }),

  profileSet: protectedProcedure.input(z.object({ displayName: z.string().max(40) })).mutation(async ({ ctx, input }) => {
    await ready()
    const name = input.displayName.replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24)
    if (name.length < 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use 2 to 24 letters, numbers, spaces, dots, dashes or underscores.' })
    await getPool().query('INSERT INTO `vk_profiles` (`user_id`, `display_name`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `display_name` = VALUES(`display_name`)', [ctx.user.id, name])
    return { displayName: name }
  }),

  saveGet: protectedProcedure.query(async ({ ctx }) => {
    await ready()
    const [[r]] = await getPool().query('SELECT * FROM `vk_saves` WHERE `user_id` = ?', [ctx.user.id])
    if (!r) return { exists: false }
    let progress = null, settings = null
    try { progress = JSON.parse(r.progress) } catch { /* corrupt row: report as empty progress */ }
    try { settings = r.settings ? JSON.parse(r.settings) : null } catch { /* ignore */ }
    return { exists: true, summary: summaryOf(r), progress, settings }
  }),

  /**
   * Optimistic-concurrency save. `baseRevision` is the cloud revision this device last saw. If the cloud moved on
   * (another device saved), the write is refused with the cloud summary unless `force` is set by an explicit player choice.
   */
  savePut: protectedProcedure.input(z.object({
    baseRevision: z.number().int().min(0),
    force: z.boolean().default(false),
    clientId: z.string().max(40).default(''),
    progress: z.unknown(),
    settings: z.unknown().optional(),
  })).mutation(async ({ ctx, input }) => {
    await ready()
    const text = JSON.stringify(input.progress ?? null)
    if (text.length > MAX_SAVE_BYTES) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Save is too large.' })
    const s = summarize(input.progress)
    const settings = cleanSettings(input.settings)
    const conn = await getPool().getConnection()
    try {
      await conn.beginTransaction()
      const [[cur]] = await conn.query('SELECT `revision`, `run_id`, `stage`, `discoveries`, `play_time`, `vitality`, `eco_stage`, `completed`, `updated_at` FROM `vk_saves` WHERE `user_id` = ? FOR UPDATE', [ctx.user.id])
      if (!input.force && (cur ? cur.revision !== input.baseRevision : input.baseRevision !== 0)) {
        await conn.rollback()
        return { ok: false, conflict: true, cloud: cur ? summaryOf(cur) : null }
      }
      const revision = cur ? cur.revision + 1 : 1
      const vals = [revision, s.runId, s.stage, s.discoveries, s.playTime, s.vitality, s.ecoStage, s.completed ? 1 : 0, input.clientId, text, settings ? JSON.stringify(settings) : null]
      if (cur) {
        // A save without settings keeps the stored settings instead of wiping them.
        await conn.query('UPDATE `vk_saves` SET `revision`=?, `run_id`=?, `stage`=?, `discoveries`=?, `play_time`=?, `vitality`=?, `eco_stage`=?, `completed`=?, `client_id`=?, `progress`=?, `settings`=COALESCE(?, `settings`) WHERE `user_id`=?', [...vals, ctx.user.id])
      } else {
        await conn.query('INSERT INTO `vk_saves` (`revision`, `run_id`, `stage`, `discoveries`, `play_time`, `vitality`, `eco_stage`, `completed`, `client_id`, `progress`, `settings`, `user_id`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [...vals, ctx.user.id])
      }
      // Run records: each milestone is written once per run (unique key), so repeated saves never duplicate them.
      const kinds = [s.stabilized && 'stabilized', s.ecoStage >= 3 && 'thriving', s.completed && 'complete'].filter(Boolean)
      for (const kind of kinds) {
        await conn.query('INSERT IGNORE INTO `vk_records` (`user_id`, `run_id`, `kind`, `play_time`, `discoveries`, `vitality`) VALUES (?,?,?,?,?,?)', [ctx.user.id, s.runId, kind, s.playTime, s.discoveries, s.vitality])
      }
      await conn.commit()
      return { ok: true, conflict: false, revision }
    } catch (err) {
      await conn.rollback().catch(() => {})
      throw err
    } finally {
      conn.release()
    }
  }),

  recordsList: protectedProcedure.query(async ({ ctx }) => {
    await ready()
    const db = getPool(), uid = ctx.user.id
    const [records] = await db.query('SELECT `run_id`, `kind`, `play_time`, `discoveries`, `vitality`, `created_at` FROM `vk_records` WHERE `user_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT 30', [uid])
    const [reports] = await db.query('SELECT `id`, `run_id`, `title`, `body`, `stage`, `discoveries`, `created_at` FROM `vk_reports` WHERE `user_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT 10', [uid])
    return {
      bests: await bestsOf(db, uid),
      records: records.map(r => ({ runId: r.run_id, kind: r.kind, playTime: r.play_time, discoveries: r.discoveries, vitality: r.vitality, at: iso(r.created_at) })),
      reports: reports.map(r => { let body = null; try { body = JSON.parse(r.body) } catch { /* ignore */ } return { id: r.id, runId: r.run_id, title: r.title, body, stage: r.stage, discoveries: r.discoveries, at: iso(r.created_at) } }),
    }
  }),

  /** Deletes the caller's cloud profile, save, records and reports. Local progress on devices is untouched. */
  cloudDelete: protectedProcedure.input(z.object({ confirm: z.literal('DELETE') })).mutation(async ({ ctx }) => {
    await ready()
    const db = getPool(), uid = ctx.user.id
    for (const t of ['vk_saves', 'vk_records', 'vk_reports', 'vk_profiles']) await db.query(`DELETE FROM \`${t}\` WHERE \`user_id\` = ?`, [uid])
    return { ok: true }
  }),

  // ------------------------------------------------------------------------------------------------ AI

  analystAsk: protectedProcedure.input(z.object({
    question: z.string().min(2).max(300),
    history: z.array(z.object({ role: z.enum(['user', 'analyst']), text: z.string().max(600) })).max(6).default([]),
    context: aiContext,
  })).mutation(async ({ ctx, input }) => {
    await ready()
    const release = await reserve(ctx.user.id)
    try {
      const messages = [
        { role: 'system', content: analystSystem(input.context) },
        ...input.history.map(h => ({ role: h.role === 'analyst' ? 'assistant' : 'user', content: clip(h.text, 600) })),
        { role: 'user', content: clip(input.question, 300) },
      ]
      let reply
      try { reply = cleanReply(await chat({ messages, max_completion_tokens: 350 }), 700) } catch (err) { await refund(ctx.user.id); throw err }
      return { reply, model: AI_MODEL, ai: await usageToday(ctx.user.id) }
    } finally { release() }
  }),

  /** Generates and stores a structured field report from the player's logged findings. */
  fieldReport: protectedProcedure.input(z.object({
    runId: z.string().max(40).default('legacy'),
    stage: z.string().max(32).default(''),
    context: aiContext,
  })).mutation(async ({ ctx, input }) => {
    await ready()
    if (input.context.discoveries.length < 3) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Log at least 3 discoveries before requesting a field report.' })
    const release = await reserve(ctx.user.id)
    try {
      const messages = [
        { role: 'system', content: reportSystem(input.context) },
        { role: 'user', content: 'Write the field report now: a title, one summary paragraph, exactly three key findings and one recommended next step.' },
      ]
      let report
      try {
        let text
        try {
          text = await chat({ messages, max_completion_tokens: 700, response_format: { type: 'json_schema', json_schema: { name: 'field_report', strict: true, schema: REPORT_SCHEMA } } })
        } catch {
          // Documented recovery: retry once without response_format and parse the text.
          text = await chat({ messages: [...messages, { role: 'user', content: 'Reply with JSON only: {"title","summary","findings":[3 strings],"next"}.' }], max_completion_tokens: 700 })
        }
        try { report = parseReport(text) } catch { throw new TRPCError({ code: 'BAD_GATEWAY', message: 'The report could not be formatted. Try again.' }) }
      } catch (err) { await refund(ctx.user.id); throw err }
      const db = getPool()
      const [ins] = await db.query('INSERT INTO `vk_reports` (`user_id`, `run_id`, `title`, `body`, `stage`, `discoveries`) VALUES (?,?,?,?,?,?)',
        [ctx.user.id, input.runId, report.title, JSON.stringify(report), input.stage, input.context.discoveries.length])
      await db.query('DELETE FROM `vk_reports` WHERE `user_id` = ? AND `id` NOT IN (SELECT `id` FROM (SELECT `id` FROM `vk_reports` WHERE `user_id` = ? ORDER BY `id` DESC LIMIT ?) t)', [ctx.user.id, ctx.user.id, MAX_REPORTS])
      return { id: ins.insertId, report, model: AI_MODEL, ai: await usageToday(ctx.user.id) }
    } finally { release() }
  }),
})
