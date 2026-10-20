/**
 * Status report: one weekly page for a whole book. The report leads with what changed since last
 * week, not with where each account stands, and every flagged row names an owner and a next step.
 */
import { addDays, daysBetween } from './db.ts'
import { explainChange, zoneOf, type Breakdown, type Zone } from './activation.ts'

export interface WeekScore { asOf: string; score: number | null; breakdown: Breakdown }
export interface AccountWeek {
  accountId: number
  name: string
  owner: string | null
  phase: string
  kickoffDate: string | null
  lastMeeting: string | null
  weeks: WeekScore[]           // oldest first; weeks before kickoff are absent
  note: { author: string; writtenOn: string; text: string; nextStep: string | null } | null
}

export type FlagType = 'drop' | 'approaching-red' | 'approaching-yellow' | 'declining' | 'silent'
export interface Flag { type: FlagType; label: string; severity: number }
export type Bucket = 'critical' | 'warning' | 'watch'

const DROP = 10, FLAT = 3, TREND_WEEKS = 4, PROJECT_WEEKS = 2, SILENT_DAYS = 21
const gain = (a: AccountWeek) => { const s = scored(a.weeks); return s.length ? s.at(-1)!.score - s[0]!.score : 0 }
const scored = (w: WeekScore[]) => w.filter((x): x is WeekScore & { score: number } => x.score !== null)

/** One flag per account, the most severe one. */
export function flagFor(a: AccountWeek, asOf: string): Flag | null {
  const s = scored(a.weeks)
  // A drop is this week's: both of the last two calendar weeks must be scored.
  const last = a.weeks.at(-1), prev = a.weeks.at(-2)
  if (last?.asOf === asOf && prev?.asOf === addDays(asOf, -7) && last.score !== null && prev.score !== null && last.score - prev.score <= -DROP)
    return { type: 'drop', label: `Drop ${Math.round(last.score - prev.score)}`, severity: 4 }
  if (s.length >= 3) {
    // Straight line through the last three weeks, two weeks forward.
    const [a0, , a2] = s.slice(-3).map((x) => x.score) as [number, number, number]
    const slope = (a2 - a0) / 2
    const ahead = a2 + slope * PROJECT_WEEKS
    if (a2 >= 40 && ahead < 40) return { type: 'approaching-red', label: `Heading below 40`, severity: 3 }
    if (a2 >= 70 && ahead < 70) return { type: 'approaching-yellow', label: `Heading below 70`, severity: 3 }
  }
  const recent = s.slice(-TREND_WEEKS)
  if (recent.length >= 2 && recent.at(-1)!.score - recent[0]!.score < -FLAT)
    return { type: 'declining', label: `Down ${Math.round(recent[0]!.score - recent.at(-1)!.score)} in ${recent.length - 1} wk${recent.length > 2 ? 's' : ''}`, severity: 2 }
  if (a.phase !== 'Kickoff' && a.phase !== 'Live') {
    const quiet = a.lastMeeting ? daysBetween(a.lastMeeting, asOf) : null
    if (quiet === null || quiet >= SILENT_DAYS) return { type: 'silent', label: quiet === null ? 'Silent' : `Silent ${quiet}d`, severity: 1 }
  }
  return null
}

export const bucketOf = (f: Flag | null): Bucket | null => (!f ? null : f.severity >= 4 ? 'critical' : f.severity >= 2 ? 'warning' : 'watch')

export interface ReportRow {
  account: AccountWeek
  flag: Flag
  bucket: Bucket
  score: number | null
  delta: number | null
  zone: Zone
  changed: string                 // the sentence the reader came for
  owner: string | null
  nextStep: string | null
}

export function changeSentence(a: AccountWeek): { delta: number | null; text: string } {
  const s = a.weeks
  const cur = s.at(-1), prev = s.at(-2)
  if (cur && cur.score === null) return { delta: null, text: 'Not scored: every feature is off, snoozed or not applicable' }
  if (!cur || !prev || cur.score === null || prev.score === null) return { delta: null, text: 'First week with a score' }
  const delta = Math.round((cur.score - prev.score) * 10) / 10
  const parts = explainChange(prev.breakdown, cur.breakdown)
    .filter((p) => Math.abs(p.points) >= 0.5)
    .sort((x, y) => Math.abs(y.points) - Math.abs(x.points))
    .map((p) => `${p.part} ${p.points > 0 ? '+' : ''}${p.points.toFixed(1)}`)
  return { delta, text: parts.length ? parts.join('; ') : 'No material change' }
}

/** The weekly report: flagged accounts by bucket, plus every flagged row missing an owner or a next step. */
export function buildReport(book: AccountWeek[], asOf: string) {
  const rows: ReportRow[] = []
  for (const a of book) {
    const flag = flagFor(a, asOf)
    const bucket = bucketOf(flag)
    if (!flag || !bucket) continue
    const cur = a.weeks.at(-1)?.score ?? null
    const { delta, text } = changeSentence(a)
    rows.push({ account: a, flag, bucket, score: cur, delta, zone: zoneOf(cur), changed: text, owner: a.owner, nextStep: a.note?.nextStep ?? null })
  }
  const by = (b: Bucket) => rows.filter((r) => r.bucket === b).sort((x, y) => (x.score ?? -1) - (y.score ?? -1))
  return {
    critical: by('critical'),
    warning: by('warning'),
    watch: by('watch'),
    // A flag nobody will act on is the report failing quietly. These go to the top of the page.
    unowned: rows.filter((r) => !r.owner || !r.nextStep),
    wins: book.filter((a) => {
      const s = scored(a.weeks)
      return s.length >= 2 && s.at(-1)!.score - s[0]!.score >= 5 && s.at(-1)!.score >= 60
    }).sort((x, y) => gain(y) - gain(x)).slice(0, 5),
    newToScope: book.filter((a) => a.kickoffDate && daysBetween(a.kickoffDate, asOf) >= 0 && daysBetween(a.kickoffDate, asOf) < 21),
  }
}

/** The report people stopped reading: where everyone stands, sorted by score, nothing about change. */
export function snapshotReport(book: AccountWeek[]) {
  return book
    .map((a) => ({ name: a.name, score: a.weeks.at(-1)?.score ?? null }))
    .sort((x, y) => (x.score ?? -1) - (y.score ?? -1))
}

export function zoneCounts(book: AccountWeek[], weeksAgo: number): Record<Zone, number> {
  const c: Record<Zone, number> = { red: 0, yellow: 0, green: 0, none: 0 }
  for (const a of book) {
    const w = a.weeks.at(-1 - weeksAgo)
    if (w) c[zoneOf(w.score)]++
  }
  return c
}

/**
 * Average score per week. The naive line averages whoever has a score at each position, so
 * accounts that just kicked off (high newness premium, short history) enter at the right-hand
 * end and lift it. The pinned line averages one fixed cohort: accounts scored in every week.
 */
export function averageTrend(book: AccountWeek[], weekDates: string[], pinned: boolean): { cohort: number; points: number[] } {
  const scoreAt = (a: AccountWeek, d: string) => a.weeks.find((w) => w.asOf === d)?.score ?? null
  const cohort = pinned ? book.filter((a) => weekDates.every((d) => scoreAt(a, d) !== null)) : book
  const points = weekDates.map((d) => {
    const v = cohort.map((a) => scoreAt(a, d)).filter((x): x is number => x !== null)
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : 0
  })
  return { cohort: cohort.length, points }
}

export function weekDates(asOf: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(asOf, -7 * (n - 1 - i)))
}
