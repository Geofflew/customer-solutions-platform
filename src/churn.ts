/**
 * Churn risk: sub-signals roll into four cells, and the headline is a sigmoid of five head
 * weights over the cells. Keyword hits in notes carry their evidence, and a keyword family moves
 * the headline only when two independent sources say it.
 */
import { daysBetween } from './db.ts'

export interface ChurnFeatures {
  activation: number | null
  daysSinceMeeting: number | null
  meetings90d: number
  seatsActivePct: number | null
  adminIdleDays: number | null
  complaintsHigh90d: number
  complaints90d: number
}
export interface Note { id: string; author: string; writtenOn: string; body: string }

export interface SubSignal { name: string; risk: number | null; reason: string }
export interface Cell { name: 'adoption' | 'engagement' | 'users' | 'feedback'; risk: number | null; subs: SubSignal[] }
export interface HeadWeights { bias: number; adoption: number; engagement: number; users: number; feedback: number }
export const HEAD_WEIGHTS: HeadWeights = { bias: -2.2, adoption: 2.4, engagement: 1.4, users: 1.8, feedback: 2.0 }

/** Keyword families matched in notes. Plain patterns, so a reader can see exactly what fires. */
export const KEYWORDS: Record<string, { pattern: RegExp; weight: number; label: string }> = {
  competitor: { pattern: /\b(competitor|evaluating (?:other|another) (?:tool|vendor)s?|switch(?:ing)? vendors?)\b/i, weight: 0.5, label: 'Competitor' },
  layoffs: { pattern: /\b(layoffs?|laid off|headcount cuts?)\b/i, weight: 0.6, label: 'Layoffs' },
  rightSizing: { pattern: /\b(right-?siz\w*|fewer seats|cut(?:ting)? seats)\b/i, weight: 0.5, label: 'Right-sizing' },
  championLeft: { pattern: /\b(champion (?:left|leaving)|(?:controller|sponsor) (?:left|resigned|is leaving))\b/i, weight: 0.6, label: 'Champion left' },
  noResponse: { pattern: /\b(no response|not responding|gone dark|ghost\w*)\b/i, weight: 0.4, label: 'No response' },
  discount: { pattern: /\b(discount|price (?:cut|reduction))\b/i, weight: 0.3, label: 'Discount ask' },
}
const NOTE_WINDOW = 60

export interface KeywordHit { family: string; noteId: string; author: string; writtenOn: string; excerpt: string }

/** Every hit, with the sentence it came from. */
export function keywordHits(notes: Note[], asOf: string): KeywordHit[] {
  const hits: KeywordHit[] = []
  for (const n of notes) {
    const age = daysBetween(n.writtenOn, asOf)
    if (age < 0 || age > NOTE_WINDOW) continue
    for (const [family, k] of Object.entries(KEYWORDS)) {
      const m = k.pattern.exec(n.body)
      if (!m) continue
      const sentence = n.body.split(/(?<=[.!?])\s+/).find((s) => k.pattern.test(s)) ?? n.body
      hits.push({ family, noteId: n.id, author: n.author, writtenOn: n.writtenOn, excerpt: sentence })
    }
  }
  return hits
}

/**
 * A family counts when at least two different authors wrote it on two different days. One note
 * is one person's sentence, and keyword matching cannot read it: "no layoffs planned" matches
 * "layoffs". The single hit is still shown, as uncorroborated evidence, with weight 0.
 */
export function corroborated(hits: KeywordHit[]): { counted: string[]; uncorroborated: string[] } {
  const counted: string[] = [], uncorroborated: string[] = []
  for (const family of new Set(hits.map((h) => h.family))) {
    const hs = hits.filter((h) => h.family === family)
    const ok = new Set(hs.map((h) => h.author)).size >= 2 && new Set(hs.map((h) => h.writtenOn)).size >= 2
    ;(ok ? counted : uncorroborated).push(family)
  }
  return { counted: counted.sort(), uncorroborated: uncorroborated.sort() }
}

/** risk 0 at `healthy`, 0.5 at `concern`, 0.85 at `risky` and beyond; linear between. */
function band(v: number, healthy: number, concern: number, risky: number): number {
  const up = healthy > risky // higher is healthier
  const x = up ? -v : v, h = up ? -healthy : healthy, c = up ? -concern : concern, r = up ? -risky : risky
  if (x <= h) return 0
  if (x <= c) return (0.5 * (x - h)) / (c - h)
  if (x <= r) return 0.5 + (0.35 * (x - c)) / (r - c)
  return 0.85
}
const sub = (name: string, v: number | null, f: (v: number) => number, why: (v: number) => string): SubSignal =>
  v === null ? { name, risk: null, reason: 'no data' } : { name, risk: f(v), reason: why(v) }

/** Worst sub-signal anchors the cell; noisy-OR lets several moderate ones add up. Nulls are skipped, not zeroed. */
function rollup(subs: SubSignal[]): number | null {
  const v = subs.map((s) => s.risk).filter((x): x is number => x !== null).map((x) => Math.min(x, 0.85))
  if (!v.length) return null
  return Math.min(1, Math.max(0.7 * Math.max(...v), 1 - v.reduce((p, x) => p * (1 - x), 1)))
}

export function cells(f: ChurnFeatures, families: string[]): Cell[] {
  const adoption = [sub('activation', f.activation, (v) => band(v, 60, 40, 20), (v) => `activation ${v}`)]
  const engagement = [
    sub('meeting recency', f.daysSinceMeeting, (v) => band(v, 21, 45, 90), (v) => `${v}d since last meeting`),
    sub('meeting cadence', f.meetings90d, (v) => band(v, 4, 2, 0), (v) => `${v} meetings in 90d`),
  ]
  const users = [
    sub('active seats', f.seatsActivePct, (v) => band(v, 70, 45, 20), (v) => `${v}% of seats active`),
    sub('admin activity', f.adminIdleDays, (v) => band(v, 7, 30, 60), (v) => `admin idle ${v}d`),
  ]
  const kw = families.reduce((s, k) => s + (KEYWORDS[k]?.weight ?? 0), 0)
  const feedback = [
    sub('complaints', f.complaints90d, (v) => Math.min(0.85, 0.15 * v + 0.25 * f.complaintsHigh90d), (v) => `${v} complaint${v === 1 ? '' : 's'} in 90d (${f.complaintsHigh90d} high)`),
    { name: 'note keywords', risk: Math.min(kw, 0.85), reason: families.length ? families.map((k) => KEYWORDS[k]!.label).join(', ') : 'none counted' },
  ]
  return [
    { name: 'adoption', risk: rollup(adoption), subs: adoption },
    { name: 'engagement', risk: rollup(engagement), subs: engagement },
    { name: 'users', risk: rollup(users), subs: users },
    { name: 'feedback', risk: rollup(feedback), subs: feedback },
  ]
}

export function headline(cs: Cell[], w: HeadWeights = HEAD_WEIGHTS): number {
  const r = (n: Cell['name']) => cs.find((c) => c.name === n)?.risk ?? 0
  const z = w.bias + w.adoption * r('adoption') + w.engagement * r('engagement') + w.users * r('users') + w.feedback * r('feedback')
  return 1 / (1 + Math.exp(-z))
}
export const churnZone = (h: number) => (h >= 0.6 ? 'red' : h >= 0.3 ? 'yellow' : 'green')

export interface ChurnResult { headline: number; zone: string; cells: Cell[]; hits: KeywordHit[]; counted: string[]; uncorroborated: string[] }

/** The broken version: every family with any hit counts. */
export function scoreNaive(f: ChurnFeatures, notes: Note[], asOf: string): ChurnResult {
  const hits = keywordHits(notes, asOf)
  const fam = [...new Set(hits.map((h) => h.family))].sort()
  const cs = cells(f, fam)
  const h = headline(cs)
  return { headline: h, zone: churnZone(h), cells: cs, hits, counted: fam, uncorroborated: [] }
}
export function scoreGuarded(f: ChurnFeatures, notes: Note[], asOf: string): ChurnResult {
  const hits = keywordHits(notes, asOf)
  const { counted, uncorroborated } = corroborated(hits)
  const cs = cells(f, counted)
  const h = headline(cs)
  return { headline: h, zone: churnZone(h), cells: cs, hits, counted, uncorroborated }
}

/** Area under the ROC curve: the chance a churned snapshot outscores a renewed one. Ties count half. */
export function auc(scored: Array<{ score: number; churned: boolean }>): number {
  const pos = scored.filter((s) => s.churned), neg = scored.filter((s) => !s.churned)
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  return wins / (pos.length * neg.length)
}
