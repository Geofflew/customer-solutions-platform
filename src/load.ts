/** Reads the seed into the plain inputs the mechanisms take. No logic beyond windows and joins. */
import { addDays, daysBetween, rows, type Db } from './db.ts'
import { computeActivation, type ActivationInput, type Breakdown, type FeatureSetting, type UsageRow } from './activation.ts'
import type { AccountWeek } from './status.ts'
import type { AccountFacts } from './segments.ts'
import type { ChurnFeatures, Note } from './churn.ts'

export interface Account {
  account_id: number; name: string; owner: string | null; phase: string; kickoff_date: string | null
  integration: 'erp' | 'import'; addons: string[]; renewal_date: string; recordings_enabled: boolean
  seats_total: number; seats_active: number; admin_idle_days: number
}
export const accounts = (db: Db) => rows<Account>(db, 'SELECT * FROM cs.accounts ORDER BY account_id')

export async function activationInputs(db: Db, asOf: string): Promise<Map<number, ActivationInput>> {
  const accts = await accounts(db)
  const usage = await rows<UsageRow & { account_id: number }>(db, `SELECT account_id, to_char(period, 'YYYY-MM-DD') AS period, feature, completed, total FROM cs.usage_periods`)
  const settings = await rows<{ account_id: number; feature: string; enabled: boolean; snoozed_until: string | null; reason: string }>(db, 'SELECT * FROM cs.feature_settings')
  const esc = await rows<{ account_id: number; n: number }>(db, `SELECT account_id, count(*)::int n FROM cs.escalations WHERE opened_on > $1::date - 90 AND opened_on <= $1 GROUP BY 1`, [asOf])
  const comp = await rows<{ account_id: number; severity: string }>(db, `SELECT account_id, severity FROM cs.complaints WHERE opened_on > $1::date - 90 AND opened_on <= $1 ORDER BY id`, [asOf])
  return new Map(accts.map((a) => [a.account_id, {
    usage: usage.filter((u) => u.account_id === a.account_id),
    settings: settings.filter((s) => s.account_id === a.account_id).map((s): FeatureSetting => ({ feature: s.feature as FeatureSetting['feature'], enabled: s.enabled, snoozedUntil: s.snoozed_until, reason: s.reason })),
    phase: a.phase,
    integration: a.integration,
    escalations: esc.find((e) => e.account_id === a.account_id)?.n ?? 0,
    complaints: comp.filter((c) => c.account_id === a.account_id).map((c) => c.severity),
    kickoffDate: a.kickoff_date,
    asOf,
  }]))
}

/** Score every account for each week date and store the breakdowns. Accounts are not scored before kickoff. */
export async function writeScores(db: Db, dates: string[]): Promise<void> {
  await db.query('TRUNCATE cs.activation_scores')
  for (const d of dates) {
    for (const [id, input] of await activationInputs(db, d)) {
      if (input.kickoffDate && input.kickoffDate > d) continue
      const b = computeActivation(input)
      await db.query('INSERT INTO cs.activation_scores VALUES ($1,$2,$3,$4)', [id, d, b.score, JSON.stringify(b)])
    }
  }
}

export async function book(db: Db, asOf: string): Promise<AccountWeek[]> {
  const accts = await accounts(db)
  const scores = await rows<{ account_id: number; as_of: string; score: number | null; breakdown: Breakdown }>(db, 'SELECT * FROM cs.activation_scores WHERE as_of <= $1 ORDER BY as_of', [asOf])
  const meet = await rows<{ account_id: number; d: string }>(db, `SELECT account_id, max(held_on)::text d FROM cs.meetings WHERE held_on <= $1 GROUP BY 1`, [asOf])
  const notes = await rows<{ account_id: number; author: string; written_on: string; note: string; next_step: string | null }>(db,
    `SELECT DISTINCT ON (account_id) * FROM cs.status_notes WHERE written_on <= $1 ORDER BY account_id, written_on DESC`, [asOf])
  return accts.map((a) => {
    const n = notes.find((x) => x.account_id === a.account_id)
    return {
      accountId: a.account_id, name: a.name, owner: a.owner, phase: a.phase, kickoffDate: a.kickoff_date,
      lastMeeting: meet.find((m) => m.account_id === a.account_id)?.d ?? null,
      weeks: scores.filter((s) => s.account_id === a.account_id).map((s) => ({ asOf: s.as_of, score: s.score, breakdown: s.breakdown })),
      note: n ? { author: n.author, writtenOn: n.written_on, text: n.note, nextStep: n.next_step } : null,
    }
  })
}

export async function segmentFacts(db: Db): Promise<AccountFacts[]> {
  const accts = await accounts(db)
  const scores = await rows<{ account_id: number; as_of: string; score: number | null }>(db, 'SELECT account_id, as_of, score FROM cs.activation_scores')
  const meet = await rows<{ account_id: number; held_on: string; attendee_title: string }>(db, 'SELECT account_id, held_on, attendee_title FROM cs.meetings ORDER BY id')
  const calls = await rows<{ account_id: number; call_date: string; topic: string | null }>(db, 'SELECT account_id, call_date, topic FROM cs.call_mentions ORDER BY id')
  return accts.map((a) => ({
    accountId: a.account_id, name: a.name, integration: a.integration, addons: a.addons, renewalDate: a.renewal_date,
    activation: Object.fromEntries(scores.filter((s) => s.account_id === a.account_id).map((s) => [s.as_of, s.score])),
    meetings: meet.filter((m) => m.account_id === a.account_id).map((m) => ({ heldOn: m.held_on, title: m.attendee_title })),
    recordingsEnabled: a.recordings_enabled,
    callTopics: calls.filter((c) => c.account_id === a.account_id).map((c) => ({ date: c.call_date, topic: c.topic })),
  }))
}

export async function churnInputs(db: Db, accountId: number, asOf: string): Promise<{ features: ChurnFeatures; notes: Note[] }> {
  const [a] = (await rows<Account>(db, 'SELECT * FROM cs.accounts WHERE account_id = $1', [accountId])) as [Account]
  const [s] = await rows<{ score: number | null }>(db, 'SELECT score FROM cs.activation_scores WHERE account_id = $1 AND as_of <= $2 ORDER BY as_of DESC LIMIT 1', [accountId, asOf])
  const m = await rows<{ held_on: string }>(db, 'SELECT held_on FROM cs.meetings WHERE account_id = $1 AND held_on <= $2 ORDER BY held_on DESC', [accountId, asOf])
  const c = await rows<{ severity: string }>(db, `SELECT severity FROM cs.complaints WHERE account_id = $1 AND opened_on > $2::date - 90 AND opened_on <= $2`, [accountId, asOf])
  const notes = await rows<{ id: number; author: string; written_on: string; body: string }>(db, 'SELECT * FROM cs.notes WHERE account_id = $1 AND written_on <= $2 ORDER BY written_on', [accountId, asOf])
  return {
    features: {
      activation: s?.score ?? null,
      daysSinceMeeting: m[0] ? daysBetween(m[0].held_on, asOf) : null,
      meetings90d: m.filter((x) => x.held_on > addDays(asOf, -90)).length,
      seatsActivePct: Math.round((100 * a.seats_active) / a.seats_total),
      adminIdleDays: a.admin_idle_days,
      complaints90d: c.length,
      complaintsHigh90d: c.filter((x) => x.severity === 'high').length,
    },
    notes: notes.map((n) => ({ id: `n${n.id}`, author: n.author, writtenOn: n.written_on, body: n.body })),
  }
}
