/**
 * Synthetic book for Acme Analytics' customer-success team: 40 accounts, 9 closed months of
 * product use, meetings, notes, call mentions, segments and a labelled history for the backtest.
 * Seeded, so every run writes the same rows.
 *
 * The traps live here, by name:
 *  - Harbor & Finch: checklist switched off, variance review not applicable; reconciliations at 92%.
 *  - Saltmarsh Foods: every feature off, snoozed or not applicable. Ironwood Mills: a real zero.
 *  - Bluestem Clinics: one high complaint this week; drops 14 points and stays yellow.
 *  - Expansion-ready segment: membership changes under the saved view; the count barely moves.
 *  - Copperline Freight: a note this week says "no layoffs planned". Its call mentions include
 *    our own CSM and the customer's auditor, neither on the contact roster.
 */
import { pathToFileURL } from 'node:url'
import { AS_OF, addDays, connect, setup, type Db } from '../src/db.ts'

export const SEED = 20260318

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const STAFF: Array<[string, string]> = [
  ['Priya Raman', 'CSM'], ['Tomas Ilic', 'CSM'], ['Jordan Okafor', 'CSM'], ['Mei Lindqvist', 'CSM'], ['Rafael Duarte', 'CSM'],
  ['Hana Kowalski', 'Implementation'], ['Wes Carver', 'Cash specialist'], ['Theo Brandvold', 'Implementation'],
]
const CSMS = STAFF.filter(([, r]) => r === 'CSM').map(([n]) => n)

export const NAMES = [
  'Northwind Ledger', 'Harbor & Finch', 'Bluestem Clinics', 'Copperline Freight', 'Saltmarsh Foods', 'Ironwood Mills',
  'Kestrel Robotics', 'Juniper Outfitters', 'Granite Peak Supply', 'Meridian Bay Health', 'Larkspur Studios',
  'Tidewater Logistics', 'Brightwater Labs', 'Foxglove Brewing', 'Redfern Capital', 'Silverleaf Systems',
  'Oakhaven Partners', 'Pinecrest Analytics', 'Stonebridge Works', 'Willowmere Foods', 'Ashgrove Health', 'Cobalt & Vine',
  'Driftwood Freight', 'Elmstead Supply', 'Fernhill Clinics', 'Goldcrest Labs', 'Hollowbrook Mills', 'Lanternfly Studios',
  'Marlowe & Pike', 'Quarry Street Capital', 'Ravenmoor Systems', 'Sablewood Outfitters', 'Thistle Robotics',
  'Umberfield Logistics', 'Wrenfield Partners', 'Yarrow Health', 'Alder & Moss', 'Birchway Brewing', 'Cinderhill Works',
  'Lindenfield Analytics',
]
const FIRST = ['Dana', 'Sam', 'Lena', 'Owen', 'Iris', 'Marcus', 'Clara', 'Felix', 'Ruth', 'Ines', 'Kofi', 'Yuki', 'Elena', 'Victor', 'Amara', 'Nadia', 'Gabe', 'Lucia', 'Omar', 'Bea', 'Dev', 'Maren', 'Ezra', 'Tessa', 'Ari', 'Sofia', 'June', 'Hugo', 'Kai', 'Noor']
const LAST = ['Whitfield', 'Ortiz', 'Brandt', 'Sato', 'Valdez', 'Achebe', 'Nyberg', 'Arden', 'Calloway', 'Moreau', 'Mensah', 'Tanaka', 'Rossi', 'Lund', 'Osei', 'Petrov', 'Sorensen', 'Ferreira', 'Farouk', 'Hollis', 'Kapoor', 'Holt', 'Quinn', 'Morrow', 'Levin', 'Brennan', 'Albright', 'Strand', 'Mendez', 'Haddad']
const TITLES = ['Controller', 'Accounting Manager', 'Senior Accountant', 'AP Manager', 'Staff Accountant', 'Director of Accounting']
const EXEC_TITLES = ['CFO', 'VP Finance']
const MONTHS = ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']
const NEXT_STEPS = [
  'Book a reconciliation working session with the controller', 'Walk the team through variance review on the next close',
  'Confirm go-live date and cutover checklist', 'Run an admin training for the two new accountants',
  'Review open tickets with support and send a summary', 'Schedule the quarterly review with the CFO',
  'Send the close-calendar template and follow up Friday', 'Pair on the first close in the product',
]
const STATUS = [
  'Close went smoothly; team asked for more reconciliation templates.', 'Waiting on the customer to map their chart of accounts.',
  'Two accountants trained; the controller still runs the checklist in a spreadsheet.', 'Good call; they want to roll out to the second entity.',
  'Slow month on their side, year-end audit is taking the team.', 'Admin changed; new admin has not logged in yet.',
  'Variance review adopted on the last close; positive feedback.', 'Data import errors on two accounts; ticket open with support.',
]

export async function generate(db: Db): Promise<void> {
  await setup(db)
  const r = rng(SEED)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const q = (sql: string, p: unknown[]) => db.query(sql, p)

  for (const [n, role] of STAFF) await q('INSERT INTO cs.staff VALUES ($1,$2)', [n, role])

  // Phase mix of a real book: a few just kicked off, most live.
  const phases = [...Array(3).fill('Kickoff'), ...Array(5).fill('Setup'), ...Array(6).fill('Training'), ...Array(6).fill('Pre-live'), ...Array(20).fill('Live')] as string[]
  const kickoffAgo: Record<string, [number, number]> = { Kickoff: [2, 10], Setup: [15, 45], Training: [40, 80], 'Pre-live': [70, 120], Live: [130, 520] }
  // Fixed stories: [name] -> overrides. Everything else is drawn from the seed.
  const fixed: Record<string, Partial<{ phase: string; ago: number | null; integration: 'erp' | 'import'; rate: number; owner: string | null; recordings: boolean; renewalIn: number }>> = {
    'Harbor & Finch': { phase: 'Live', ago: 340, integration: 'import', rate: 0.92, owner: 'Mei Lindqvist' },
    'Saltmarsh Foods': { phase: 'Pre-live', ago: 95, integration: 'import', owner: 'Priya Raman' },
    'Ironwood Mills': { phase: 'Live', ago: 410, integration: 'erp', rate: 0, owner: 'Jordan Okafor' },
    'Kestrel Robotics': { phase: 'Setup', ago: 20, integration: 'erp', owner: 'Tomas Ilic' },
    'Bluestem Clinics': { phase: 'Live', ago: 300, integration: 'erp', rate: 0.545, owner: 'Jordan Okafor' },
    'Copperline Freight': { phase: 'Live', ago: 260, integration: 'erp', rate: 0.44, owner: 'Rafael Duarte', recordings: true, renewalIn: 75 },
    'Umberfield Logistics': { phase: 'Training', ago: 48, owner: null },
    'Thistle Robotics': { phase: 'Kickoff', ago: null },
  }
  const UNUSED = new Set(['Harbor & Finch/checklist', 'Saltmarsh Foods/checklist', 'Saltmarsh Foods/reconciliation', 'Larkspur Studios/variance'])
  const order = [...phases]
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!] }
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i]!
    const f = fixed[name] ?? {}
    const phase = f.phase ?? order[i]!
    const [lo, hi] = kickoffAgo[phase]!
    const ago = f.ago === undefined ? int(lo, hi) : f.ago
    const kickoff = ago === null ? null : addDays(AS_OF, -ago)
    const integration = f.integration ?? (r() < 0.6 ? 'erp' : 'import')
    const owner = f.owner === undefined ? CSMS[i % CSMS.length]! : f.owner
    const seatsTotal = int(6, 40)
    const health = f.rate ?? 0.2 + r() * 0.65
    await q(`INSERT INTO cs.accounts VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      i + 1, name, owner, phase, kickoff, integration, r() < 0.35 ? ['reporting'] : [],
      addDays(AS_OF, f.renewalIn ?? int(10, 360)), f.recordings ?? r() < 0.7, seatsTotal,
      Math.max(1, Math.round(seatsTotal * Math.min(1, health + (r() - 0.5) * 0.3))), Math.round((1 - health) * 50 + r() * 8),
    ])

    // Monthly usage from the month after kickoff. Monthly noise is small so a week-on-week change
    // in the report has a cause a reader can find.
    const start = kickoff ? kickoff.slice(0, 7) : '9999-12'
    const sizes = { checklist: int(20, 60), reconciliation: int(30, 120), variance: int(8, 30) }
    const trend = name === 'Pinecrest Analytics' ? 0.09 : name === 'Tidewater Logistics' ? -0.06 : 0
    for (const [m, month] of MONTHS.entries()) {
      if (month <= start || name === 'Kestrel Robotics') continue
      const monthsIn = MONTHS.filter((x) => x > start && x < month).length
      for (const feat of ['checklist', 'reconciliation', 'variance'] as const) {
        if (feat === 'variance' && integration !== 'erp') continue
        const total = sizes[feat] + int(-3, 3)
        let rate = f.rate !== undefined ? f.rate : Math.min(1, Math.max(0, health + trend * (m - 6) + (r() - 0.5) * 0.08))
        if (f.rate === undefined && health < 0.4 && r() < 0.3) rate = 0 // weak accounts skip a close now and then
        if (f.rate === undefined) rate *= Math.min(1, 0.45 + 0.2 * monthsIn) // adoption ramps over the first closes
        // A feature switched off or paused has a template in the product and nobody using it.
        if (UNUSED.has(`${name}/${feat}`)) rate = 0
        await q('INSERT INTO cs.usage_periods VALUES ($1,$2,$3,$4,$5)', [i + 1, `${month}-01`, feat, Math.round(total * rate), total])
      }
    }
  }

  const id = (n: string) => NAMES.indexOf(n) + 1
  const setting = (n: string, feat: string, enabled: boolean, until: string | null, reason: string) =>
    q('INSERT INTO cs.feature_settings VALUES ($1,$2,$3,$4,$5)', [id(n), feat, enabled, until, reason])
  await setting('Harbor & Finch', 'checklist', false, null, 'runs its close checklist in its own project tool')
  await setting('Saltmarsh Foods', 'checklist', true, '2026-05-01', 'paused during their ERP migration')
  await setting('Saltmarsh Foods', 'reconciliation', false, null, 'reconciliations are done by their outsourced accountant')
  await setting('Foxglove Brewing', 'checklist', true, '2026-02-28', 'paused for year-end audit') // expired: counts again
  await setting('Larkspur Studios', 'variance', false, null, 'reviews variances in the board pack instead')

  // Escalations and complaints, mostly old. Bluestem's high complaint lands this week.
  for (let i = 1; i <= NAMES.length; i++) {
    if (r() < 0.3) await q('INSERT INTO cs.escalations (account_id, opened_on, title) VALUES ($1,$2,$3)', [i, addDays(AS_OF, -int(20, 160)), 'Sync job failing on large ledgers'])
    if (r() < 0.35) await q('INSERT INTO cs.complaints (account_id, opened_on, severity, title) VALUES ($1,$2,$3,$4)', [i, addDays(AS_OF, -int(20, 160)), pick(['low', 'medium', 'high']), 'Report export slow'])
  }
  await q('DELETE FROM cs.complaints WHERE account_id = $1', [id('Bluestem Clinics')])
  await q('DELETE FROM cs.escalations WHERE account_id = $1', [id('Bluestem Clinics')])
  await q('INSERT INTO cs.complaints (account_id, opened_on, severity, title) VALUES ($1,$2,$3,$4)', [id('Bluestem Clinics'), '2026-03-13', 'high', 'Month-end close blocked by failed bank feed'])
  await q('DELETE FROM cs.complaints WHERE account_id = $1', [id('Copperline Freight')])
  await q('INSERT INTO cs.complaints (account_id, opened_on, severity, title) VALUES ($1,$2,$3,$4)', [id('Copperline Freight'), addDays(AS_OF, -40), 'medium', 'Confusing error on reconciliation import'])

  // Contacts, meetings and call mentions.
  for (let i = 1; i <= NAMES.length; i++) {
    const name = NAMES[i - 1]!
    if (name === 'Copperline Freight') continue
    const used = new Set<string>()
    const people: Array<[string, string]> = []
    const n = int(3, 6)
    while (people.length < n) {
      const p = `${pick(FIRST)} ${pick(LAST)}`
      if (used.has(p)) continue
      used.add(p)
      people.push([p, people.length === 0 && r() < 0.6 ? pick(EXEC_TITLES) : pick(TITLES)])
    }
    for (const [p, t] of people) await q('INSERT INTO cs.contacts VALUES ($1,$2,$3,$4)', [i, p, t, int(0, 6)])
    const cadence = int(5, 25)
    const quiet = r() < 0.25 ? int(25, 60) : int(0, 12)
    for (let d = quiet; d < 180; d += cadence + int(-3, 3)) {
      const [p, t] = pick(people)
      await q('INSERT INTO cs.meetings (account_id, held_on, attendee, attendee_title) VALUES ($1,$2,$3,$4)', [i, addDays(AS_OF, -d), p, t])
    }
    for (let k = 0; k < int(0, 6); k++) {
      const [p] = pick(people)
      await q('INSERT INTO cs.call_mentions (account_id, call_date, name, topic) VALUES ($1,$2,$3,$4)', [i, addDays(AS_OF, -int(1, 150)), r() < 0.5 ? p.split(' ')[0] : p, r() < 0.15 ? 'competitor' : null])
    }
  }
  // Umberfield has no owner and has not had a meeting in five weeks.
  await q('DELETE FROM cs.meetings WHERE account_id = $1 AND held_on > $2', [id('Umberfield Logistics'), addDays(AS_OF, -36)])
  const cid = id('Copperline Freight')
  for (const [p, t, tk] of [['Dana Whitfield', 'Controller', 4], ['Sam Ortiz', 'Senior Accountant', 2], ['Sam Patel', 'AP Manager', 3], ['Lena Brandt', 'CFO', 0], ['Owen Sato', 'Accounting Manager', 1]] as const)
    await q('INSERT INTO cs.contacts VALUES ($1,$2,$3,$4)', [cid, p, t, tk])
  for (const [d, p, t] of [[10, 'Dana Whitfield', 'Controller'], [38, 'Lena Brandt', 'CFO'], [66, 'Dana Whitfield', 'Controller'], [80, 'Lena Brandt', 'CFO'], [120, 'Owen Sato', 'Accounting Manager']] as const)
    await q('INSERT INTO cs.meetings (account_id, held_on, attendee, attendee_title) VALUES ($1,$2,$3,$4)', [cid, addDays(AS_OF, -d), p, t])
  const mention = async (p: string, times: number) => {
    for (let k = 0; k < times; k++) await q('INSERT INTO cs.call_mentions (account_id, call_date, name, topic) VALUES ($1,$2,$3,$4)', [cid, addDays(AS_OF, -(5 + k * 11)), p, null])
  }
  await mention('Rafael Duarte', 7)   // our own CSM, on every call
  await mention('Gil Navarro', 6)     // the customer's audit partner, not a contact
  await mention('Sam', 5)             // two Sams on the roster
  await mention('Dana', 4)
  await mention('Lena Brandt', 1)

  // Segment story: exec meetings that age out or arrive between the review and today.
  for (const [n, d] of [['Lanternfly Studios', 5], ['Elmstead Supply', 12], ['Ravenmoor Systems', 20], ['Cobalt & Vine', 8], ['Lindenfield Analytics', 15], ['Silverleaf Systems', 95]] as const) {
    await q('DELETE FROM cs.meetings WHERE account_id = $1 AND attendee_title = ANY($2)', [id(n), EXEC_TITLES])
    await q('INSERT INTO cs.meetings (account_id, held_on, attendee, attendee_title) VALUES ($1,$2,$3,$4)', [id(n), addDays(AS_OF, -d), `${pick(FIRST)} ${pick(LAST)}`, 'CFO'])
  }

  // Notes. Copperline's note this week is the keyword trap.
  for (let i = 1; i <= NAMES.length; i++) {
    for (let k = 0; k < int(1, 3); k++)
      await q('INSERT INTO cs.notes (account_id, author, written_on, body) VALUES ($1,$2,$3,$4)', [i, CSMS[(i + k) % CSMS.length], addDays(AS_OF, -int(3, 90)), pick(STATUS)])
  }
  await q('DELETE FROM cs.notes WHERE account_id = $1', [cid])
  await q('INSERT INTO cs.notes (account_id, author, written_on, body) VALUES ($1,$2,$3,$4)', [cid, 'Rafael Duarte', addDays(AS_OF, -36), 'Quarterly check-in went well. They want a working session on reconciliations.'])
  await q('INSERT INTO cs.notes (account_id, author, written_on, body) VALUES ($1,$2,$3,$4)', [cid, 'Rafael Duarte', addDays(AS_OF, -2), 'Spoke with the controller about next year. She said there are no layoffs planned; the team is hiring two analysts.'])

  // Status notes: the owner's latest line and next step. One flagged account has no next step.
  for (let i = 1; i <= NAMES.length; i++) {
    const name = NAMES[i - 1]!
    const owner = fixed[name]?.owner === undefined ? CSMS[(i - 1) % CSMS.length]! : fixed[name]!.owner ?? 'Priya Raman'
    await q('INSERT INTO cs.status_notes VALUES ($1,$2,$3,$4,$5)', [i, addDays(AS_OF, -int(1, 9)), owner, pick(STATUS), name === 'Kestrel Robotics' ? null : pick(NEXT_STEPS)])
  }

  // Segments. Baselines are accepted four weeks before today; render/demo recompute membership.
  const seg = (sid: string, n: string, rule: unknown) => q('INSERT INTO cs.segments (segment_id, name, rule) VALUES ($1,$2,$3)', [sid, n, JSON.stringify(rule)])
  await seg('expansion', 'Expansion-ready', { and: [{ sig: 'highActivation' }, { sig: 'execEngaged' }, { not: { sig: 'goingQuiet' } }] })
  await seg('competitive', 'Competitive risk', { or: [{ sig: 'competitorOnCalls' }, { sig: 'goingQuiet' }] })
  await seg('renewal', 'Renewal watch', { and: [{ sig: 'renewalSoon' }, { not: { sig: 'highActivation' } }] })
  await seg('erp-reporting', 'ERP, no reporting', { and: [{ sig: 'erp' }, { not: { sig: 'reporting' } }] })
  const ov = (n: string, action: string, by: string, on: string, reason: string) =>
    q('INSERT INTO cs.segment_overrides (segment_id, account_id, action, by_person, on_date, reason) VALUES ($1,$2,$3,$4,$5,$6)', ['expansion', id(n), action, by, on, reason])
  await ov('Oakhaven Partners', 'include', 'Jordan Okafor', '2026-01-28', 'CFO asked about a second entity on the last call')
  await ov('Ravenmoor Systems', 'exclude', 'Mei Lindqvist', '2026-03-02', 'mid-migration; not the moment to talk expansion')

  // Backtest history: 200 past snapshots with what happened next. A latent risk drives the
  // features and the outcome. Real keyword signals come as two notes by two people; benign
  // single mentions ("no layoffs planned") land at random.
  const benign = ['They said there are no layoffs planned this year.', 'Asked whether a discount applies if they add a second entity.', 'Mentioned a competitor reached out; they are not interested.', 'Finance lead said fewer seats is not on the table.']
  const real: Record<string, string> = { layoffs: 'Their finance team is going through layoffs.', championLeft: 'Our sponsor is leaving at the end of the month; the controller left in January.', competitor: 'They are evaluating another tool for close management.', noResponse: 'No response to the last three emails.' }
  for (let s = 1; s <= 200; s++) {
    const risk = r()
    const features = {
      activation: Math.round(Math.max(0, Math.min(100, 88 - 65 * risk + (r() - 0.5) * 30))),
      daysSinceMeeting: Math.round(5 + 70 * risk * r()),
      meetings90d: Math.max(0, Math.round(6 - 5 * risk + (r() - 0.5) * 3)),
      seatsActivePct: Math.round(Math.max(5, Math.min(100, 88 - 55 * risk + (r() - 0.5) * 25))),
      adminIdleDays: Math.round(2 + 50 * risk * r()),
      complaints90d: Math.round(3 * risk * r()),
      complaintsHigh90d: risk > 0.7 && r() < 0.4 ? 1 : 0,
    }
    const churned = r() < 0.05 + 0.75 * risk * risk
    const notes: Array<{ id: string; author: string; writtenOn: string; body: string }> = []
    if (churned && r() < 0.55) {
      const fam = pick(Object.keys(real))
      notes.push({ id: `h${s}a`, author: CSMS[0]!, writtenOn: addDays(AS_OF, -int(20, 50)), body: real[fam]! })
      notes.push({ id: `h${s}b`, author: CSMS[1]!, writtenOn: addDays(AS_OF, -int(1, 19)), body: real[fam]! })
    }
    if (r() < 0.3) notes.push({ id: `h${s}c`, author: pick(CSMS), writtenOn: addDays(AS_OF, -int(1, 50)), body: pick(benign) })
    await q('INSERT INTO cs.churn_history VALUES ($1,$2,$3,$4)', [s, JSON.stringify(features), JSON.stringify(notes), churned])
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const db = connect()
  await generate(db)
  await db.end()
  console.log('generated')
}
