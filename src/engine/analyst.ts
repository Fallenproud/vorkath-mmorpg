import { ManusAuth } from '../../manus-auth.js'
import { DISCOVERIES } from '../game/discoveries'
import { objectiveFor, type Progress } from '../game/state'
import { errorText, type ReportBody } from './cloud'

/** What the server is allowed to know: only what the player has actually scanned, trimmed for size. */
export interface AiContext {
  objective: string
  region: string
  ecoStage: number
  vitality: number
  discoveries: { title: string; category: string; text: string; readings: [string, string][] }[]
}
export interface ChatTurn { role: 'user' | 'analyst'; text: string }

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

export function buildAiContext(p: Progress, region: string | null): AiContext {
  const o = objectiveFor(p)
  const found = Object.entries(p.discoveries)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([id, rec]) => ({ d: DISCOVERIES.find(x => x.id === id), rec }))
    .filter((x): x is { d: (typeof DISCOVERIES)[number]; rec: Progress['discoveries'][string] } => !!x.d)
    .slice(-40)
  return {
    objective: clip(`${o.title}. ${o.detail}`, 200),
    region: region ?? '',
    ecoStage: p.eco.stage,
    vitality: p.vitality,
    discoveries: found.map(({ d, rec }) => ({
      title: clip(d.title, 80),
      category: clip(d.category, 24),
      text: clip(d.text, 400),
      readings: rec.readings.slice(0, 6).map(([k, v]) => [clip(k, 40), clip(v, 60)] as [string, string]),
    })),
  }
}

export interface AskResult { reply: string; ai: { used: number; limit: number } }
export interface ReportResult { id: number; report: ReportBody; ai: { used: number; limit: number } }

export async function askAnalyst(question: string, history: ChatTurn[], context: AiContext): Promise<AskResult> {
  try {
    return await ManusAuth.mutate<AskResult>('analystAsk', { question: clip(question, 300), history: history.slice(-6).map(h => ({ role: h.role, text: clip(h.text, 600) })), context })
  } catch (e) {
    throw new Error(errorText(e))
  }
}

export async function requestReport(runId: string, stage: string, context: AiContext): Promise<ReportResult> {
  try {
    return await ManusAuth.mutate<ReportResult>('fieldReport', { runId, stage, context })
  } catch (e) {
    throw new Error(errorText(e))
  }
}
