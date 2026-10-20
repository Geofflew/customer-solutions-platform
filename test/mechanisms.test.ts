// One block per mechanism, each written to fail if its guard is removed. Needs DATABASE_URL; it
// regenerates the synthetic data, so point it at a database you created for this repo.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../scripts/generate.ts'
import { scores } from '../scripts/scores.ts'
import { AS_OF, connect, rows } from '../src/db.ts'
import { computeActivation, explainChange, naiveActivation, selectPeriods, zerosWithReasons, type ActivationInput } from '../src/activation.ts'
import { averageTrend, buildReport, flagFor, type AccountWeek } from '../src/status.ts'
import { evaluate, membership, members, reviewDiff } from '../src/segments.ts'
import { corroborated, keywordHits, scoreGuarded, scoreNaive } from '../src/churn.ts'
import { candidates } from '../src/champions.ts'
import { confirm, propose } from '../src/bot.ts'
import { activationStory, segmentStory, statusStory, churnStory, WEEKS } from '../src/story.ts'

let db: pg.Pool
beforeAll(async () => {
  db = connect()
  await generate(db)
  await scores(db)
}, 120_000)
afterAll(async () => { await db.end() })

const base: ActivationInput = {
  usage: ['2025-12', '2026-01', '2026-02'].flatMap((m) => [
    { period: `${m}-01`, feature: 'checklist' as const, completed: 0, total: 40 },
    { period: `${m}-01`, feature: 'reconciliation' as const, completed: 72, total: 80 },
  ]),
  settings: [{ feature: 'checklist', enabled: false, snoozedUntil: null, reason: 'runs its checklist elsewhere' }],
  phase: 'Live', integration: 'import', escalations: 0, complaints: [], kickoffDate: '2025-01-01', asOf: AS_OF,
}

describe('1. activation score', () => {
  it('excludes off and not-applicable features with a reason instead of scoring them 0', () => {
    const b = computeActivation(base)
    expect(b.score).toBe(100)
    expect(naiveActivation(base)).toBeCloseTo(33.3, 1) // the trap is real
    const zeros = zerosWithReasons(b)
    expect(zeros.map((z) => z.reason)).toEqual(['Off: runs its checklist elsewhere', 'Not applicable: needs the ERP integration'])
  })
  it('says "not scored" when every feature is excluded, and keeps a real zero a zero', () => {
    const allOff = computeActivation({ ...base, settings: [...base.settings, { feature: 'reconciliation', enabled: false, snoozedUntil: null, reason: 'outsourced' }] })
    expect(allOff.score).toBeNull()
    const unused = computeActivation({ ...base, settings: [], usage: base.usage.map((u) => ({ ...u, completed: 0 })) })
    expect(unused.score).toBe(0)
    expect(zerosWithReasons(unused).every((z) => z.reason.length > 0)).toBe(true)
  })
  it('counts a feature again once its snooze has passed, and skips the in-flight month for live accounts', () => {
    const snoozed = (until: string) => computeActivation({ ...base, settings: [{ feature: 'checklist', enabled: true, snoozedUntil: until, reason: 'audit' }] }).score
    expect(snoozed('2026-05-01')).toBe(100)
    expect(snoozed('2026-02-28')).toBe(50) // checklist at 0 counts again
    expect(selectPeriods('2026-03-11', 'Live')).toEqual(['2025-11', '2025-12', '2026-01'])
    expect(selectPeriods('2026-03-11', 'Training')).toEqual(['2025-12', '2026-01', '2026-02'])
  })
  it('attributes a week-on-week change in parts that add up to the change', async () => {
    const s = await statusStory(db)
    for (const a of s.book) {
      const [p, c] = [a.weeks.at(-2), a.weeks.at(-1)]
      if (!p || !c || p.score === null || c.score === null) continue
      const sum = explainChange(p.breakdown, c.breakdown).reduce((t, x) => t + x.points, 0)
      expect(sum).toBeCloseTo(c.score - p.score, 9)
    }
  })
  it('demo: Harbor & Finch reads green, Saltmarsh not scored, on the seed', async () => {
    const a = await activationStory(db)
    expect(a.harbor.naive).toBeLessThan(40)
    expect(a.harbor.breakdown.score).toBeGreaterThanOrEqual(70)
    expect(a.saltmarsh.breakdown.score).toBeNull()
  })
})

describe('2. status report', () => {
  const acct = (scoresList: number[], extra: Partial<AccountWeek> = {}): AccountWeek => ({
    accountId: 1, name: 'x', owner: 'o', phase: 'Live', kickoffDate: '2025-01-01', lastMeeting: AS_OF, note: { author: 'o', writtenOn: AS_OF, text: '', nextStep: 'call' },
    weeks: scoresList.map((score, i) => ({ asOf: WEEKS[WEEKS.length - scoresList.length + i]!, score, breakdown: computeActivation(base) })), ...extra,
  })
  it('flags a 10-point drop that stays inside one zone as critical', () => {
    expect(flagFor(acct([69, 69, 55]), AS_OF)?.type).toBe('drop')
    expect(flagFor(acct([69, 69, 62]), AS_OF)?.type).toBe('declining')
  })
  it('puts flagged rows without an owner or next step at the top', () => {
    const r = buildReport([acct([69, 55], { owner: null }), acct([69, 55], { accountId: 2, note: null })], AS_OF)
    expect(r.unowned).toHaveLength(2)
  })
  it('averages a pinned cohort, not whoever has a score that week', async () => {
    const s = await statusStory(db)
    const pinned = averageTrend(s.book, WEEKS, true)
    expect(pinned.cohort).toBeLessThan(s.book.length)
    expect(s.bluestemRow.flag.type).toBe('drop')
    expect(s.report.critical.map((r) => r.account.name)).toContain('Bluestem Clinics')
  })
})

describe('3. segmentation', () => {
  it('lets no-data win over any boolean: OR(lit, no-data) is no-data', () => {
    expect(evaluate({ or: [{ sig: 'a' }, { sig: 'b' }] }, { a: 'lit', b: 'no-data' })).toBe('no-data')
    expect(evaluate({ not: { sig: 'zzz' } }, {})).toBe('no-data')
    expect(evaluate({ and: [{ sig: 'a' }, { not: { sig: 'b' } }] }, { a: 'lit', b: 'unlit' })).toBe('lit')
  })
  it('applies excludes after includes, and the latest log entry wins', async () => {
    const g = await segmentStory(db)
    const id = g.facts.find((f) => f.name === 'Oakhaven Partners')!.accountId
    const log = [
      { accountId: id, action: 'include' as const, by: 'a', on: '2026-01-01', reason: 'r' },
      { accountId: id, action: 'exclude' as const, by: 'b', on: '2026-01-02', reason: 'r' },
    ]
    expect(members(membership({ sig: 'erp' }, g.facts, log, AS_OF))).not.toContain(id)
    // Precedence, not recency: an include written after the exclude still loses.
    const later = [log[1]!, { ...log[0]!, on: '2026-01-05' }]
    expect(membership({ sig: 'erp' }, g.facts, later, AS_OF).get(id)).toBe('excluded')
    expect(members(membership({ sig: 'erp' }, g.facts, [...log, { accountId: id, action: 'clear', by: 'c', on: '2026-01-03', reason: 'r' }], AS_OF))).toContain(id)
  })
  it('names who cleared a manual include after the review, and why', async () => {
    const g = await segmentStory(db)
    const id = g.facts.find((f) => f.name === 'Oakhaven Partners')!.accountId
    const rule = { sig: 'zzz-never' } // nobody matches the rule; only the include kept it in
    const log = [
      { accountId: id, action: 'include' as const, by: 'Jordan Okafor', on: '2026-01-28', reason: 'second entity' },
      { accountId: id, action: 'clear' as const, by: 'Priya Raman', on: '2026-03-09', reason: 'deal moved to next year' },
    ]
    const d = reviewDiff(rule, g.facts, log, { members: [id], on: '2026-02-18' }, AS_OF)
    expect(d.removed).toEqual([{ id, cause: 'manual include cleared by Priya Raman on 2026-03-09: deal moved to next year' }])
  })
  it('reports every entry and exit behind an unchanged count, each with a cause', async () => {
    const e = (await segmentStory(db)).expansion
    expect(e.diff.count.now).toBe(e.diff.count.baseline)
    expect(e.diff.added.length + e.diff.removed.length).toBeGreaterThan(0)
    for (const x of [...e.diff.added, ...e.diff.removed]) expect(x.cause).toMatch(/→|manual/)
  })
})

describe('4. churn and champions', () => {
  const note = (id: string, author: string, writtenOn: string, body: string) => ({ id, author, writtenOn, body })
  it('counts a keyword family only from two authors on two days', () => {
    const one = keywordHits([note('1', 'A', '2026-03-10', 'No layoffs planned.')], AS_OF)
    expect(corroborated(one)).toEqual({ counted: [], uncorroborated: ['layoffs'] })
    const sameDay = keywordHits([note('1', 'A', '2026-03-10', 'Layoffs.'), note('2', 'B', '2026-03-10', 'Layoffs.')], AS_OF)
    expect(corroborated(sameDay).counted).toEqual([])
    const sameAuthor = keywordHits([note('1', 'A', '2026-03-01', 'Layoffs coming.'), note('2', 'A', '2026-03-10', 'Talked about layoffs.')], AS_OF)
    expect(corroborated(sameAuthor).counted).toEqual([])
    const two = keywordHits([note('1', 'A', '2026-03-01', 'Layoffs coming.'), note('2', 'B', '2026-03-10', 'Talked about layoffs.')], AS_OF)
    expect(corroborated(two).counted).toEqual(['layoffs'])
  })
  it('keeps the headline zone when one note is the only thing that changed', async () => {
    const c = await churnStory(db)
    expect(c.naive.zone).not.toBe(c.before.zone) // the trap is real
    expect(c.guarded.zone).toBe(c.before.zone)
    const f = c.features
    expect(scoreGuarded(f, [], AS_OF).headline).toBeCloseTo(c.guarded.headline, 9)
    expect(scoreNaive(f, [], AS_OF).headline).toBeCloseTo(c.guarded.headline, 9)
  })
  it('drops call names that are our staff, off the roster, or ambiguous', () => {
    const roster = [{ name: 'Dana Whitfield', title: 'Controller', tickets90d: 1 }, { name: 'Sam Ortiz', title: 'Accountant', tickets90d: 0 }, { name: 'Sam Patel', title: 'AP Manager', tickets90d: 0 }]
    const mentions = ['Dana', 'Sam', 'Gil Navarro', 'Duarte, Rafael (CSM)'].map((name) => ({ callDate: AS_OF, name }))
    const r = candidates(roster, [], mentions, ['Rafael Duarte'])
    expect(r.kept.map((k) => k.name)).toEqual(['Dana Whitfield', 'Sam Patel', 'Sam Ortiz'])
    expect(r.kept[0]!.sources).toEqual(['roster', 'calls'])
    expect(Object.fromEntries(r.dropped.map((d) => [d.name, d.why.split(':')[0]]))).toEqual({
      Sam: 'ambiguous', 'Gil Navarro': 'not on the verified contact roster', 'Duarte, Rafael (CSM)': 'one of our own staff',
    })
  })
})

describe('5. bot', () => {
  const count = async () => (await rows<{ n: number }>(db, 'SELECT count(*)::int n FROM cs.assignments'))[0]!.n
  it('applies the stored proposal, refuses a longer relayed list, a stranger and a replay', async () => {
    await db.query('TRUNCATE cs.proposals, cs.assignments RESTART IDENTITY')
    const p = await propose(db, 'Mei Lindqvist', 't1', '@acme-bot assign Harbor & Finch, Hana onboarding', AS_OF)
    if (!p.ok) throw new Error(p.reason)
    const longer = [...p.changes, { role: 'cash' as const, person: 'Wes Carver' }]
    expect((await confirm(db, { proposalId: p.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1', changes: longer }, AS_OF)).ok).toBe(false)
    expect(await count()).toBe(0)
    // Refusing closed the proposal: the stored list cannot be slipped through afterwards.
    expect((await confirm(db, { proposalId: p.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, AS_OF)).ok).toBe(false)

    const q = await propose(db, 'Mei Lindqvist', 't1', '@acme-bot assign Harbor & Finch, Hana onboarding', AS_OF)
    if (!q.ok) throw new Error(q.reason)
    expect((await confirm(db, { proposalId: q.proposalId, confirmedBy: 'Jordan Okafor', threadId: 't1' }, AS_OF)).ok).toBe(false)
    const ok = await confirm(db, { proposalId: q.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1', hash: q.hash }, AS_OF)
    expect(ok).toEqual({ ok: true, applied: [{ role: 'onboarding', person: 'Hana Kowalski' }], unchanged: [] })
    expect(await count()).toBe(1)
    expect((await confirm(db, { proposalId: q.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, AS_OF)).ok).toBe(false)
    expect((await confirm(db, { proposalId: q.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, '2026-03-30')).ok).toBe(false)
  })
  it('writes both holders of one role and reports exactly the rows it wrote', async () => {
    await db.query('TRUNCATE cs.proposals, cs.assignments RESTART IDENTITY')
    const p = await propose(db, 'Mei Lindqvist', 't1', 'assign Harbor & Finch, Hana onboarding, Wes onboarding', AS_OF)
    if (!p.ok) throw new Error(p.reason)
    const r = await confirm(db, { proposalId: p.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, AS_OF)
    const written = await rows<{ role: string; person: string }>(db, 'SELECT role, person FROM cs.assignments ORDER BY person')
    expect(r.ok && r.applied).toEqual(written)
    expect(written).toHaveLength(2)
    // Asking again for someone who already holds the role writes nothing, and says so.
    const q = await propose(db, 'Mei Lindqvist', 't1', 'assign Harbor & Finch, Hana onboarding', AS_OF)
    if (!q.ok) throw new Error(q.reason)
    expect(await confirm(db, { proposalId: q.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, AS_OF))
      .toEqual({ ok: true, applied: [], unchanged: [{ role: 'onboarding', person: 'Hana Kowalski' }] })
  })
  it('refuses a confirm from another thread, and two racing confirms apply once', async () => {
    await db.query('TRUNCATE cs.proposals, cs.assignments RESTART IDENTITY')
    const [a, b] = await Promise.all([1, 2].map(() => propose(db, 'Mei Lindqvist', 't1', 'assign Harbor & Finch, Hana onboarding', AS_OF)))
    if (!a!.ok || !b!.ok) throw new Error('propose failed')
    expect(a!.proposalId).not.toBe(b!.proposalId) // ids from a sequence, not count + 1
    expect(await confirm(db, { proposalId: a!.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 'elsewhere' }, AS_OF)).toMatchObject({ ok: false, reason: expect.stringMatching(/another thread/) })
    const both = await Promise.all([1, 2].map(() => confirm(db, { proposalId: a!.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, AS_OF)))
    expect(both.filter((r) => r.ok)).toHaveLength(1)
    expect(both.find((r) => !r.ok)).toMatchObject({ reason: expect.stringMatching(/already applied/) })
    expect(await count()).toBe(1)
  })
  it('refuses an expired proposal and an ambiguous name', async () => {
    const p = await propose(db, 'Mei Lindqvist', 't1', 'assign Copperline, Wes cash', AS_OF)
    if (!p.ok) throw new Error(p.reason)
    const r = await confirm(db, { proposalId: p.proposalId, confirmedBy: 'Mei Lindqvist', threadId: 't1' }, '2026-03-25')
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) })
    expect(await propose(db, 'Mei Lindqvist', 't1', 'assign Copperline, T onboarding', AS_OF)).toMatchObject({ ok: false, reason: expect.stringMatching(/ambiguous/) })
  })
})
