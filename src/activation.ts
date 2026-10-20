/**
 * Activation score: a 0-100 value score per account from closed monthly periods of product use.
 * Pure functions; scripts/scores.ts loads the inputs from Postgres and stores one breakdown per
 * account per week.
 *
 * The rule this file exists for: a feature that is switched off, snoozed or not applicable is
 * left out of the average with its reason. It is never scored 0. A zero in the output always
 * comes with a sentence saying why it is zero.
 */
import { daysBetween } from './db.ts'

export const FEATURES = ['checklist', 'reconciliation', 'variance'] as const
export type Feature = (typeof FEATURES)[number]
export const FEATURE_LABEL: Record<Feature, string> = {
  checklist: 'Close checklist',
  reconciliation: 'Reconciliations',
  variance: 'Variance review',
}

export interface UsageRow { period: string; feature: Feature; completed: number; total: number }
export interface FeatureSetting { feature: Feature; enabled: boolean; snoozedUntil: string | null; reason: string }

export interface ActivationInput {
  usage: UsageRow[]
  settings: FeatureSetting[]
  phase: string
  integration: 'erp' | 'import'
  escalations: number          // engineering escalations opened in the last 90 days
  complaints: string[]         // severities of complaints opened in the last 90 days
  kickoffDate: string | null
  asOf: string
}

/** Why a feature is in or out of the average. Every variant carries a sentence. */
export type FeatureResult =
  | { feature: Feature; status: 'scored'; score: number; pcts: Array<number | null>; reason: string }
  | { feature: Feature; status: 'excluded'; kind: 'disabled' | 'snoozed' | 'not-applicable'; reason: string }

export interface Breakdown {
  periods: string[]
  features: FeatureResult[]
  utilization: number          // 0-1, mean of scored features
  escalationPenalty: number
  complaintPenalty: number
  penalty: number              // combined, capped
  newness: number              // points
  score: number | null         // null = not scored: every feature excluded
  flags: string[]
}

const TARGET = 0.8             // 80% completion earns the full feature score
const PERIODS = 3
const NEWNESS_MAX = 60
const NEWNESS_DAYS = 45        // time constant of the decay from kickoff
const ESCALATION_DIV = 10, ESCALATION_CAP = 0.1
const COMPLAINT_DIV = 5, COMPLAINT_CAP = 0.2, PENALTY_CAP = 0.3
const SEVERITY: Record<string, number> = { high: 1, medium: 0.5, low: 0.25 }

const monthKey = (d: string) => d.slice(0, 7)
function monthsBack(asOf: string, n: number): string {
  const [y, m] = asOf.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * The months that count. The current month never does. For a live customer in the first two
 * weeks of a month the previous month does not either: its close is still running, and a
 * half-finished close would read as low use. A month with no rows stays missing; nothing older
 * is pulled in to fill the slot.
 */
export function selectPeriods(asOf: string, phase: string): string[] {
  const day = Number(asOf.slice(8, 10))
  const skip = phase === 'Live' && day <= 14 ? 2 : 1
  return Array.from({ length: PERIODS }, (_, i) => monthsBack(asOf, skip + PERIODS - 1 - i))
}

/** Is this feature out of the average, and why? null means it counts. */
export function exclusion(feature: Feature, settings: FeatureSetting[], integration: string, asOf: string):
  { kind: 'disabled' | 'snoozed' | 'not-applicable'; reason: string } | null {
  const s = settings.find((x) => x.feature === feature)
  if (s && !s.enabled) return { kind: 'disabled', reason: `Off: ${s.reason}` }
  if (s?.snoozedUntil && s.snoozedUntil > asOf) return { kind: 'snoozed', reason: `Snoozed until ${s.snoozedUntil}: ${s.reason}` }
  if (feature === 'variance' && integration !== 'erp') return { kind: 'not-applicable', reason: 'Not applicable: needs the ERP integration' }
  return null
}

export function computeActivation(input: ActivationInput): Breakdown {
  const periods = selectPeriods(input.asOf, input.phase)
  const flags: string[] = []
  const features: FeatureResult[] = FEATURES.map((feature) => {
    const ex = exclusion(feature, input.settings, input.integration, input.asOf)
    if (ex) return { feature, status: 'excluded', ...ex }
    const pcts = periods.map((p) => {
      const r = input.usage.find((u) => u.feature === feature && monthKey(u.period) === p)
      return r && r.total > 0 ? r.completed / r.total : null
    })
    const seen = pcts.filter((x): x is number => x !== null)
    // Switched on with no rows at all is not an opt-out. It is no use, and it scores 0, so the
    // account still surfaces in triage; the reason says there was nothing to measure.
    if (seen.length === 0) {
      if (!flags.includes('no-usage-rows')) flags.push('no-usage-rows')
      return { feature, status: 'scored', score: 0, pcts, reason: 'On, but no usage recorded in the last 3 closed months' }
    }
    if (seen.length < 2 && !flags.includes('fewer-than-2-periods')) flags.push('fewer-than-2-periods')
    const zeros = seen.filter((x) => x === 0).length
    const score = Math.min(Math.max(...seen) / TARGET, 1) * (1 - zeros / PERIODS)
    const totals = input.usage.filter((u) => u.feature === feature && periods.includes(monthKey(u.period)))
    const done = totals.reduce((s, u) => s + u.completed, 0), all = totals.reduce((s, u) => s + u.total, 0)
    const reason = score === 0
      ? `On and used 0 of ${all} in ${seen.length} closed month${seen.length > 1 ? 's' : ''}`
      : `${done} of ${all} completed, best month ${Math.round(Math.max(...seen) * 100)}%` + (zeros ? `, ${zeros} month${zeros > 1 ? 's' : ''} at zero` : '')
    return { feature, status: 'scored', score, pcts, reason }
  })

  const scored = features.filter((f): f is Extract<FeatureResult, { status: 'scored' }> => f.status === 'scored')
  const utilization = scored.length ? scored.reduce((s, f) => s + f.score, 0) / scored.length : 0
  // Penalties shrink use; with no use there is nothing to shrink, and a penalty on 0 would hide
  // the more important fact that the account does not use the product.
  let escalationPenalty = 0, complaintPenalty = 0
  if (utilization > 0) {
    escalationPenalty = Math.min(input.escalations / ESCALATION_DIV, ESCALATION_CAP)
    complaintPenalty = Math.min(input.complaints.reduce((s, c) => s + (SEVERITY[c] ?? 0), 0) / COMPLAINT_DIV, COMPLAINT_CAP)
  }
  const penalty = Math.min(escalationPenalty + complaintPenalty, PENALTY_CAP)

  let newness = 0
  if (!input.kickoffDate) flags.push('no-kickoff-date')
  else {
    const days = daysBetween(input.kickoffDate, input.asOf)
    if (days < 0) flags.push('kickoff-in-future')
    else newness = NEWNESS_MAX * Math.exp(-days / NEWNESS_DAYS)
  }

  let score: number | null = null
  if (scored.length === 0) flags.push('all-features-excluded')
  else score = Math.round(Math.min(Math.max(utilization * 100 * (1 - penalty) + newness, 0), 100) * 10) / 10
  return { periods, features, utilization, escalationPenalty, complaintPenalty, penalty, newness, score, flags }
}

/**
 * The broken version, the one most dashboards ship: average the three completion rates, a
 * feature with nothing to show counted as 0%. Kept so the demo can print what it says.
 */
export function naiveActivation(input: ActivationInput, only: readonly Feature[] = FEATURES): number {
  const periods = selectPeriods(input.asOf, input.phase)
  const rate = (f: Feature) => {
    const rs = input.usage.filter((u) => u.feature === f && periods.includes(monthKey(u.period)))
    const best = Math.max(0, ...rs.map((r) => (r.total ? r.completed / r.total : 0)))
    return Math.min(best / TARGET, 1)
  }
  return only.length ? Math.round((only.reduce((s, f) => s + rate(f), 0) / only.length) * 1000) / 10 : 0
}

/** Every zero the page will show, each with its reason. A zero with no reason is a bug. */
export function zerosWithReasons(b: Breakdown): Array<{ what: string; reason: string }> {
  const out: Array<{ what: string; reason: string }> = []
  for (const f of b.features) {
    if (f.status === 'excluded') out.push({ what: FEATURE_LABEL[f.feature], reason: f.reason })
    else if (f.score === 0) out.push({ what: FEATURE_LABEL[f.feature], reason: f.reason })
  }
  if (b.score === null) out.push({ what: 'Score', reason: 'Not scored: every feature is off, snoozed or not applicable' })
  else if (b.score === 0) out.push({ what: 'Score', reason: 'No use of any feature that is switched on' })
  for (const o of out) if (!o.reason) throw new Error(`zero without a reason: ${o.what}`)
  return out
}

export type Zone = 'red' | 'yellow' | 'green' | 'none'
export const zoneOf = (s: number | null): Zone => (s === null ? 'none' : s < 40 ? 'red' : s < 70 ? 'yellow' : 'green')

/**
 * Week-on-week change, attributed to its parts. The parts add up to the change exactly, so a
 * status report can say "-14: one high complaint (-14), newness decay (-0.3)" and be right.
 */
export function explainChange(prev: Breakdown, cur: Breakdown): Array<{ part: string; points: number }> {
  if (prev.score === null || cur.score === null) return []
  const raw = (u: number, p: number, n: number) => u * 100 * (1 - p) + n
  const parts: Array<{ part: string; points: number }> = []
  const a = raw(prev.utilization, prev.penalty, prev.newness)
  const b = raw(cur.utilization, prev.penalty, prev.newness)
  const c = raw(cur.utilization, cur.penalty, prev.newness)
  const d = raw(cur.utilization, cur.penalty, cur.newness)
  const periodsMoved = prev.periods.join() !== cur.periods.join()
  const mon = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  parts.push({ part: periodsMoved ? `product use (window moved to ${mon(cur.periods[0]!)}–${mon(cur.periods.at(-1)!)})` : 'product use', points: b - a })
  parts.push({ part: penaltyLabel(prev, cur), points: c - b })
  parts.push({ part: 'newness premium decay', points: d - c })
  const total = cur.score - prev.score
  const sum = parts.reduce((s, p) => s + p.points, 0)
  // Clamping at 0 or 100 and rounding to one decimal are the only other movers; name them.
  if (Math.abs(total - sum) > 1e-9) parts.push({ part: 'cap at 0 or 100, and rounding', points: total - sum })
  return parts
}
function penaltyLabel(prev: Breakdown, cur: Breakdown): string {
  const bits: string[] = []
  if (cur.escalationPenalty !== prev.escalationPenalty) bits.push('escalations')
  if (cur.complaintPenalty !== prev.complaintPenalty) bits.push('complaints')
  return bits.length ? `${bits.join(' and ')} penalty` : 'penalties'
}
