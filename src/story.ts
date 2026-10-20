/**
 * The five traps, computed once from the seed. scripts/demo.ts prints these and scripts/render.ts
 * draws them, so the numbers on the screenshots and in the demo output are the same numbers.
 */
import type pg from 'pg'
import { AS_OF, addDays, rows, type Db } from './db.ts'
import { computeActivation, naiveActivation, zerosWithReasons, zoneOf } from './activation.ts'
import { accounts, activationInputs, book, churnInputs, segmentFacts, type Account } from './load.ts'
import { averageTrend, buildReport, snapshotReport, weekDates, zoneCounts } from './status.ts'
import { membership, members, reviewDiff, type Override, type Rule } from './segments.ts'
import { auc, churnZone, scoreGuarded, scoreNaive, type Note } from './churn.ts'
import { candidates, candidatesNaive } from './champions.ts'
import { answer, confirm, confirmNaive, listHash, propose, route, type Change } from './bot.ts'

export const WEEKS = weekDates(AS_OF, 12)
export const REVIEWED_ON = addDays(AS_OF, -28)
const byName = (as: Account[], n: string) => as.find((a) => a.name === n)!

export async function activationStory(db: Db) {
  const as = await accounts(db)
  const inputs = await activationInputs(db, AS_OF)
  const all = as.map((a) => {
    const i = inputs.get(a.account_id)!
    const b = computeActivation(i)
    // The same naive average over only the features that count: isolates what averaging the
    // excluded ones in as 0% does, from the penalties and premium the naive version also lacks.
    const counted = b.features.filter((f) => f.status === 'scored').map((f) => f.feature)
    return { account: a, naive: naiveActivation(i), naiveCounted: counted.length ? naiveActivation(i, counted) : null, breakdown: b, zeros: zerosWithReasons(b) }
  })
  const pick = (n: string) => all.find((x) => x.account.name === n)!
  return {
    all,
    harbor: pick('Harbor & Finch'),
    saltmarsh: pick('Saltmarsh Foods'),
    ironwood: pick('Ironwood Mills'),
    naiveRed: all.filter((x) => zoneOf(x.naive) === 'red').length,
    guardedRed: all.filter((x) => zoneOf(x.breakdown.score) === 'red').length,
    // Accounts the naive average drags into a lower zone only because of excluded features.
    misjudged: all.filter((x) => x.breakdown.features.some((f) => f.status === 'excluded') && zoneOf(x.naive) !== zoneOf(x.naiveCounted)),
    zeroCount: all.reduce((s, x) => s + x.zeros.length, 0),
  }
}

export async function statusStory(db: Db) {
  const b = await book(db, AS_OF)
  const report = buildReport(b, AS_OF)
  const snap = snapshotReport(b)
  const bluestem = b.find((a) => a.name === 'Bluestem Clinics')!
  const lastWeek = bluestem.weeks.at(-2)!.score!
  return {
    book: b, report, snap,
    bluestem, bluestemRow: report.critical.find((r) => r.account.name === 'Bluestem Clinics')!,
    bluestemRank: snap.findIndex((s) => s.name === 'Bluestem Clinics') + 1, lastWeek,
    zonesNow: zoneCounts(b, 0), zonesThen: zoneCounts(b, 1),
    naiveAvg: averageTrend(b, WEEKS, false), pinnedAvg: averageTrend(b, WEEKS, true),
  }
}

export async function segmentStory(db: Db) {
  const facts = await segmentFacts(db)
  const segs = await rows<{ segment_id: string; name: string; rule: Rule }>(db, 'SELECT segment_id, name, rule FROM cs.segments ORDER BY segment_id')
  const log = await rows<{ segment_id: string; account_id: number; action: Override['action']; by_person: string; on_date: string; reason: string }>(db, 'SELECT * FROM cs.segment_overrides ORDER BY id')
  const logFor = (sid: string): Override[] => log.filter((o) => o.segment_id === sid).map((o) => ({ accountId: o.account_id, action: o.action, by: o.by_person, on: o.on_date, reason: o.reason }))
  // The baseline is what membership was when someone last accepted it; store it as the review would have.
  for (const s of segs) {
    const base = members(membership(s.rule, facts, logFor(s.segment_id), REVIEWED_ON))
    await db.query('UPDATE cs.segments SET baseline_members = $2, reviewed_by = $3, reviewed_on = $4 WHERE segment_id = $1', [s.segment_id, base, 'Priya Raman', REVIEWED_ON])
  }
  const stored = await rows<{ segment_id: string; baseline_members: number[]; reviewed_by: string; reviewed_on: string }>(db, 'SELECT segment_id, baseline_members, reviewed_by, reviewed_on FROM cs.segments')
  const out = segs.map((s) => {
    const st = stored.find((x) => x.segment_id === s.segment_id)!
    const now = membership(s.rule, facts, logFor(s.segment_id), AS_OF)
    return {
      ...s, log: logFor(s.segment_id), now,
      diff: reviewDiff(s.rule, facts, logFor(s.segment_id), { members: st.baseline_members, on: st.reviewed_on }, AS_OF),
      noData: [...now.values()].filter((v) => v === 'no-data').length,
      reviewedBy: st.reviewed_by, reviewedOn: st.reviewed_on,
    }
  })
  return { facts, segments: out, expansion: out.find((s) => s.segment_id === 'expansion')!, competitive: out.find((s) => s.segment_id === 'competitive')! }
}

export async function churnStory(db: Db) {
  const as = await accounts(db)
  const cop = byName(as, 'Copperline Freight')
  const lastWeek = addDays(AS_OF, -7)
  const prev = await churnInputs(db, cop.account_id, lastWeek)
  const cur = await churnInputs(db, cop.account_id, AS_OF)
  const hist = await rows<{ features: Parameters<typeof scoreNaive>[0]; notes: Note[]; churned: boolean }>(db, 'SELECT features, notes, churned FROM cs.churn_history ORDER BY snapshot_id')
  const scored = hist.map((h, i) => ({ id: i + 1, churned: h.churned, naive: scoreNaive(h.features, h.notes, AS_OF), guarded: scoreGuarded(h.features, h.notes, AS_OF) }))
  const moved = scored.filter((s) => s.naive.zone !== s.guarded.zone)
  const deciles = Array.from({ length: 5 }, (_, i) => {
    const inBin = (h: number) => h >= i / 5 && (i === 4 ? h <= 1 : h < (i + 1) / 5)
    const rate = (k: 'naive' | 'guarded') => { const xs = scored.filter((s) => inBin(s[k].headline)); return { n: xs.length, churned: xs.filter((s) => s.churned).length } }
    return { lo: i / 5, naive: rate('naive'), guarded: rate('guarded') }
  })
  return {
    account: cop, features: cur.features, notes: cur.notes,
    before: scoreGuarded(prev.features, prev.notes, lastWeek),
    naive: scoreNaive(cur.features, cur.notes, AS_OF),
    guarded: scoreGuarded(cur.features, cur.notes, AS_OF),
    backtest: {
      n: hist.length, churned: hist.filter((h) => h.churned).length,
      aucNaive: auc(scored.map((s) => ({ score: s.naive.headline, churned: s.churned }))),
      aucGuarded: auc(scored.map((s) => ({ score: s.guarded.headline, churned: s.churned }))),
      movedRows: moved,
      moved: moved.length, movedChurned: moved.filter((s) => s.churned).length,
      redNaive: scored.filter((s) => s.naive.zone === 'red'), redGuarded: scored.filter((s) => s.guarded.zone === 'red'),
      deciles,
    },
    zoneOf: churnZone,
  }
}

export async function championStory(db: Db) {
  const as = await accounts(db)
  const cop = byName(as, 'Copperline Freight')
  const roster = (await rows<{ name: string; title: string; tickets_90d: number }>(db, 'SELECT * FROM cs.contacts WHERE account_id = $1 ORDER BY name', [cop.account_id])).map((c) => ({ name: c.name, title: c.title, tickets90d: c.tickets_90d }))
  const meetings = (await rows<{ held_on: string; attendee: string; attendee_title: string }>(db, 'SELECT * FROM cs.meetings WHERE account_id = $1 ORDER BY held_on', [cop.account_id])).map((m) => ({ heldOn: m.held_on, attendee: m.attendee, title: m.attendee_title }))
  const mentions = (await rows<{ call_date: string; name: string }>(db, 'SELECT * FROM cs.call_mentions WHERE account_id = $1 ORDER BY id', [cop.account_id])).map((m) => ({ callDate: m.call_date, name: m.name }))
  const staff = (await rows<{ name: string }>(db, 'SELECT name FROM cs.staff ORDER BY name')).map((s) => s.name)
  return { naive: candidatesNaive(roster, meetings, mentions), guarded: candidates(roster, meetings, mentions, staff), roster, mentions }
}

export type BotEvent =
  | { kind: 'user'; who: string; text: string }
  | { kind: 'bot'; text: string; proposal?: { id: string; account: string; changes: Change[]; hash: string } }
  | { kind: 'relay'; text: string; changes: Change[]; proposalId: string }
  | { kind: 'click'; who: string; proposalId: string; where?: string }
  | { kind: 'result'; ok: boolean; text: string }

/** The bot conversation, run against the real handlers. Resets proposals and assignments first. */
export async function botStory(pool: pg.Pool) {
  const reset = () => pool.query('TRUNCATE cs.proposals, cs.assignments RESTART IDENTITY')
  const T = 'cs-assignments/1742', OTHER = 'cs-leads/0917'
  const count = async () => (await rows<{ n: number }>(pool, 'SELECT count(*)::int n FROM cs.assignments'))[0]!.n
  const asked = '@acme-bot assign Harbor & Finch, Hana onboarding'
  const relayed: Change[] = [{ role: 'onboarding', person: 'Hana Kowalski' }, { role: 'cash', person: 'Wes Carver' }, { role: 'owner', person: 'Rafael Duarte' }]

  await reset()
  const p0 = await propose(pool, 'Mei Lindqvist', T, asked, AS_OF)
  if (!p0.ok) throw new Error(p0.reason)
  const naive = await confirmNaive(pool, { proposalId: p0.proposalId, confirmedBy: 'Mei Lindqvist', threadId: T, changes: relayed })
  const naiveCount = await count()

  await reset()
  const events: BotEvent[] = []
  const q = 'who owns Harbor & Finch?'
  events.push({ kind: 'user', who: 'Mei Lindqvist', text: `@acme-bot ${q}` })
  events.push({ kind: 'bot', text: `(${route(q)}) ${await answer(pool, q)}` })
  events.push({ kind: 'user', who: 'Mei Lindqvist', text: asked })
  const p1 = await propose(pool, 'Mei Lindqvist', T, asked, AS_OF)
  if (!p1.ok) throw new Error(p1.reason)
  events.push({ kind: 'bot', text: `(${route(asked)}) Proposal ${p1.proposalId}. Nothing has changed yet.`, proposal: { id: p1.proposalId, account: p1.account, changes: p1.changes, hash: p1.hash } })
  events.push({ kind: 'relay', text: `Confirm ${p1.proposalId}, forwarded from the request form`, changes: relayed, proposalId: p1.proposalId })
  const r1 = await confirm(pool, { proposalId: p1.proposalId, confirmedBy: 'Mei Lindqvist', threadId: T, changes: relayed }, AS_OF)
  events.push({ kind: 'result', ok: r1.ok, text: r1.ok ? 'applied' : r1.reason })
  events.push({ kind: 'user', who: 'Mei Lindqvist', text: asked })
  const p2 = await propose(pool, 'Mei Lindqvist', T, asked, AS_OF)
  if (!p2.ok) throw new Error(p2.reason)
  events.push({ kind: 'bot', text: `Proposal ${p2.proposalId}. Nothing has changed yet.`, proposal: { id: p2.proposalId, account: p2.account, changes: p2.changes, hash: p2.hash } })
  events.push({ kind: 'click', who: 'Jordan Okafor', proposalId: p2.proposalId })
  const r2 = await confirm(pool, { proposalId: p2.proposalId, confirmedBy: 'Jordan Okafor', threadId: T, hash: p2.hash }, AS_OF)
  events.push({ kind: 'result', ok: r2.ok, text: r2.ok ? 'applied' : r2.reason })
  events.push({ kind: 'click', who: 'Mei Lindqvist', proposalId: p2.proposalId, where: '#cs-leads' })
  const r2b = await confirm(pool, { proposalId: p2.proposalId, confirmedBy: 'Mei Lindqvist', threadId: OTHER, hash: p2.hash }, AS_OF)
  events.push({ kind: 'result', ok: r2b.ok, text: r2b.ok ? 'applied' : r2b.reason })
  events.push({ kind: 'click', who: 'Mei Lindqvist', proposalId: p2.proposalId })
  const r3 = await confirm(pool, { proposalId: p2.proposalId, confirmedBy: 'Mei Lindqvist', threadId: T, hash: listHash(p2.changes) }, AS_OF)
  events.push({ kind: 'result', ok: r3.ok, text: r3.ok ? `Applied ${p2.proposalId}: ${r3.applied.map((c) => `${c.role} = ${c.person}`).join(', ')}` : r3.reason })
  const r4 = await confirm(pool, { proposalId: p2.proposalId, confirmedBy: 'Mei Lindqvist', threadId: T, hash: listHash(p2.changes) }, AS_OF)
  events.push({ kind: 'click', who: 'Mei Lindqvist', proposalId: p2.proposalId })
  events.push({ kind: 'result', ok: r4.ok, text: r4.ok ? 'applied again' : r4.reason })
  const guardedCount = await count()
  const assignments = await rows<{ account: string; role: string; person: string; proposal_id: string }>(pool, 'SELECT a.name AS account, s.role, s.person, s.proposal_id FROM cs.assignments s JOIN cs.accounts a USING (account_id) ORDER BY s.role, s.person')
  const proposals = await rows<{ proposal_id: string; status: string; changes: Change[] }>(pool, 'SELECT proposal_id, status, changes FROM cs.proposals ORDER BY proposal_id')
  return { asked, relayed, naive: naive.applied, naiveCount, events, guardedCount, proposals, assignments, refusals: [r1, r2, r2b, r4] }
}
