/**
 * Segmentation: a registry of signals derives tags from facts, a segment is a saved rule over
 * tags, manual overrides are logged, and a review baseline makes membership drift visible.
 */
import { daysBetween } from './db.ts'

/** Everything a signal may read about one account on one date. */
export interface AccountFacts {
  accountId: number
  name: string
  integration: 'erp' | 'import'
  addons: string[]
  renewalDate: string
  activation: Record<string, number | null>   // weekly score by date; null = not scored
  meetings: Array<{ heldOn: string; title: string }>
  recordingsEnabled: boolean
  callTopics: Array<{ date: string; topic: string | null }>
}

export type TagState = 'lit' | 'unlit' | 'no-data'
export interface Signal {
  key: string
  label: string
  source: string
  /** Does the source cover this account? If not the tag is no-data, never unlit. */
  covers: (f: AccountFacts, asOf: string) => boolean
  lit: (f: AccountFacts, asOf: string) => boolean
  /** One line of evidence for a lit tag, shown on hover and in the review banner. */
  evidence: (f: AccountFacts, asOf: string) => string
}

const EXEC = /\b(CFO|Chief|VP|Vice President|Head of Finance)\b/i
const within = (d: string, asOf: string, days: number) => daysBetween(d, asOf) >= 0 && daysBetween(d, asOf) <= days
export function activationAt(f: AccountFacts, asOf: string): number | null {
  const d = Object.keys(f.activation).filter((k) => k <= asOf).sort().at(-1)
  return d === undefined ? null : f.activation[d] ?? null
}
const lastMeeting = (f: AccountFacts, asOf: string) => f.meetings.map((m) => m.heldOn).filter((d) => d <= asOf).sort().at(-1) ?? null

export const SIGNALS: Signal[] = [
  { key: 'erp', label: 'ERP integration', source: 'CRM', covers: () => true,
    lit: (f) => f.integration === 'erp', evidence: () => 'Connected through the ERP integration' },
  { key: 'reporting', label: 'Reporting add-on', source: 'CRM', covers: () => true,
    lit: (f) => f.addons.includes('reporting'), evidence: () => 'Has the reporting add-on' },
  { key: 'renewalSoon', label: 'Renews in 120d', source: 'CRM', covers: () => true,
    lit: (f, asOf) => within(asOf, f.renewalDate, 120), evidence: (f) => `Renews ${f.renewalDate}` },
  { key: 'execEngaged', label: 'Exec engaged', source: 'CRM meetings', covers: () => true,
    lit: (f, asOf) => f.meetings.some((m) => EXEC.test(m.title) && within(m.heldOn, asOf, 90)),
    evidence: (f, asOf) => {
      const m = f.meetings.filter((x) => EXEC.test(x.title) && within(x.heldOn, asOf, 90)).sort((a, b) => b.heldOn.localeCompare(a.heldOn))[0]
      return m ? `Met ${m.title} on ${m.heldOn}` : 'No executive meeting in 90 days'
    } },
  { key: 'goingQuiet', label: 'Going quiet', source: 'CRM meetings', covers: () => true,
    lit: (f, asOf) => { const d = lastMeeting(f, asOf); return !d || daysBetween(d, asOf) > 30 },
    evidence: (f, asOf) => { const d = lastMeeting(f, asOf); return d ? `Last meeting ${d} (${daysBetween(d, asOf)}d ago)` : 'No meeting on record' } },
  { key: 'highActivation', label: 'Activation 70+', source: 'activation score', covers: (f, asOf) => activationAt(f, asOf) !== null,
    lit: (f, asOf) => (activationAt(f, asOf) ?? 0) >= 70, evidence: (f, asOf) => `Activation ${activationAt(f, asOf)}` },
  { key: 'competitorOnCalls', label: 'Competitor on calls', source: 'call recordings', covers: (f) => f.recordingsEnabled,
    lit: (f, asOf) => f.callTopics.some((c) => c.topic === 'competitor' && within(c.date, asOf, 90)),
    evidence: (f, asOf) => { const c = f.callTopics.filter((x) => x.topic === 'competitor' && within(x.date, asOf, 90)).map((x) => x.date).sort().at(-1); return c ? `Competitor named on a call ${c}` : 'No competitor named in 90 days' } },
]

export function deriveTags(f: AccountFacts, asOf: string): Record<string, TagState> {
  return Object.fromEntries(SIGNALS.map((s) => [s.key, !s.covers(f, asOf) ? 'no-data' : s.lit(f, asOf) ? 'lit' : 'unlit']))
}

export type Rule = { sig: string } | { and: Rule[] } | { or: Rule[] } | { not: Rule }

function touched(r: Rule): string[] {
  if ('sig' in r) return [r.sig]
  if ('not' in r) return touched(r.not)
  return ('and' in r ? r.and : r.or).flatMap(touched)
}

/**
 * Evaluate a rule. If any signal the rule touches is no-data, the answer is no-data, checked
 * over the whole tree before any boolean logic runs, so OR(lit, no-data) is no-data and an
 * uncovered branch can never be outvoted. An unknown signal key is no-data, not an error.
 */
export function evaluate(r: Rule, tags: Record<string, TagState>): TagState {
  if (touched(r).some((k) => (tags[k] ?? 'no-data') === 'no-data')) return 'no-data'
  const go = (x: Rule): boolean =>
    'sig' in x ? tags[x.sig] === 'lit' : 'not' in x ? !go(x.not) : 'and' in x ? x.and.every(go) : x.or.some(go)
  return go(r) ? 'lit' : 'unlit'
}

export interface Override { accountId: number; action: 'include' | 'exclude' | 'clear'; by: string; on: string; reason: string }

/**
 * Manual decisions per account, as of a date. An include and an exclude are kept separately, so
 * both can stand at once and the exclude wins (see membership). 'clear' removes both and is kept,
 * so a review can say who cleared a decision and why.
 */
export interface ManualState { include?: Override; exclude?: Override; cleared?: Override }
export function activeOverrides(log: Override[], asOf: string): Map<number, ManualState> {
  const m = new Map<number, ManualState>()
  for (const o of [...log].filter((x) => x.on <= asOf).sort((a, b) => a.on.localeCompare(b.on))) {
    const st = m.get(o.accountId) ?? {}
    if (o.action === 'clear') m.set(o.accountId, { cleared: o })
    else m.set(o.accountId, { ...st, [o.action]: o })
  }
  return m
}

export type Membership = 'member' | 'included' | 'excluded' | 'no-data' | 'out'
/** (rule matches ∪ manual includes) minus manual excludes. An exclude wins over an include and over the rule. */
export function membership(rule: Rule, facts: AccountFacts[], log: Override[], asOf: string): Map<number, Membership> {
  const ov = activeOverrides(log, asOf)
  const out = new Map<number, Membership>()
  for (const f of facts) {
    const o = ov.get(f.accountId)
    const r = evaluate(rule, deriveTags(f, asOf))
    out.set(f.accountId, o?.exclude ? 'excluded' : o?.include ? 'included' : r === 'lit' ? 'member' : r === 'unlit' ? 'out' : 'no-data')
  }
  return out
}
export const members = (m: Map<number, Membership>) => [...m].filter(([, v]) => v === 'member' || v === 'included').map(([k]) => k).sort((a, b) => a - b)

/** Who entered and who left since the baseline someone accepted, each with the cause. */
export function reviewDiff(rule: Rule, facts: AccountFacts[], log: Override[], baseline: { members: number[]; on: string }, asOf: string) {
  const now = membership(rule, facts, log, asOf)
  const then = membership(rule, facts, log, baseline.on)
  const cur = new Set(members(now)), base = new Set(baseline.members)
  const cause = (id: number) => {
    const f = facts.find((x) => x.accountId === id)!
    const o = activeOverrides(log, asOf).get(id) ?? {}, o0 = activeOverrides(log, baseline.on).get(id) ?? {}
    const changed = (['exclude', 'include'] as const).find((k) => o[k] && o[k] !== o0[k])
    if (changed) return `manual ${changed} by ${o[changed]!.by} on ${o[changed]!.on}: ${o[changed]!.reason}`
    const gone = (['exclude', 'include'] as const).find((k) => o0[k] && !o[k])
    if (gone && o.cleared) return `manual ${gone} cleared by ${o.cleared.by} on ${o.cleared.on}: ${o.cleared.reason}`
    const t0 = deriveTags(f, baseline.on), t1 = deriveTags(f, asOf)
    const flipped = touched(rule).filter((k, i, a) => a.indexOf(k) === i && t0[k] !== t1[k])
    if (!flipped.length && then.get(id) !== now.get(id)) return `now ${now.get(id)}`
    return flipped.map((k) => {
      const s = SIGNALS.find((x) => x.key === k)!
      return `${s.label}: ${t0[k]} → ${t1[k]} (${s.evidence(f, asOf)})`
    }).join('; ')
  }
  return {
    added: [...cur].filter((id) => !base.has(id)).map((id) => ({ id, cause: cause(id) })),
    removed: [...base].filter((id) => !cur.has(id)).map((id) => ({ id, cause: cause(id) })),
    count: { baseline: base.size, now: cur.size },
  }
}
