/**
 * Champion candidates from three sources: the verified contact roster (the support tool), executive
 * meetings (the CRM), and names mentioned on recorded calls. Each candidate carries the evidence
 * that nominated it. A name mentioned on a call is only a candidate if it is a verified contact.
 */
export interface Contact { name: string; title: string; tickets90d: number }
export interface Meeting { heldOn: string; attendee: string; title: string }
export interface Mention { callDate: string; name: string }

export interface Candidate {
  name: string
  title: string | null
  score: number
  evidence: string[]
  sources: Array<'roster' | 'meetings' | 'calls'>
}
export interface Dropped { name: string; mentions: number; why: string }

const SENIORITY: Array<[RegExp, number]> = [[/\b(CFO|Chief|VP)\b/i, 3], [/\b(Controller|Director|Head)\b/i, 2], [/\bManager\b/i, 1]]
const seniority = (t: string | null) => (t ? SENIORITY.find(([re]) => re.test(t))?.[1] ?? 0.5 : 0.5)

/** "Whitfield, Dana (Controller)" and "Dana Whitfield - Finance" both become "dana whitfield". */
export function nameKey(raw: string): string {
  let n = raw.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+-\s+.*$/, '').trim()
  if (n.includes(',')) { const [last, first] = n.split(',').map((s) => s.trim()); n = `${first} ${last}` }
  return n.toLowerCase().replace(/\s+/g, ' ').trim()
}
/** Same person when equal, or when one is a whole-word prefix of the other ("dana" ~ "dana whitfield"). */
export const sameName = (a: string, b: string) => a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ')

function score(title: string | null, mentions: number, meetings: number, tickets: number): number {
  const raw = 3 * seniority(title) + 2 * Math.log(1 + mentions) + 2.5 * Math.log(1 + meetings) + Math.log(1 + tickets)
  return Math.min(100, Math.round(raw * 7))
}

/** The broken version: the names mentioned most on calls, whoever they are. */
export function candidatesNaive(roster: Contact[], meetings: Meeting[], mentions: Mention[]): Array<Candidate & { mentions: number }> {
  const names = new Map<string, string>()
  for (const n of [...roster.map((c) => c.name), ...meetings.map((m) => m.attendee), ...mentions.map((m) => m.name)])
    if (![...names.keys()].some((k) => k === nameKey(n))) names.set(nameKey(n), n)
  return [...names].map(([k, display]) => {
    const c = roster.find((r) => nameKey(r.name) === k)
    const ms = mentions.filter((m) => nameKey(m.name) === k).length
    const mt = meetings.filter((m) => nameKey(m.attendee) === k).length
    return { name: display, title: c?.title ?? null, score: score(c?.title ?? null, ms, mt, c?.tickets90d ?? 0), evidence: [], sources: [] as Candidate['sources'] }
  }).map((c) => ({ ...c, mentions: mentions.filter((m) => nameKey(m.name) === nameKey(c.name)).length }))
    .sort((a, b) => b.mentions - a.mentions || b.score - a.score || a.name.localeCompare(b.name))
}

export function candidates(roster: Contact[], meetings: Meeting[], mentions: Mention[], staff: string[]): { kept: Candidate[]; dropped: Dropped[] } {
  const rosterKeys = roster.map((c) => ({ c, k: nameKey(c.name) }))
  const staffKeys = staff.map(nameKey)
  const dropped: Dropped[] = []
  // Resolve every call mention to exactly one roster contact, or drop it with the reason.
  const resolved = new Map<string, number>() // roster name -> mentions
  const unresolved = new Map<string, { mentions: number; why: string }>()
  for (const m of mentions) {
    const k = nameKey(m.name)
    const why = staffKeys.some((s) => sameName(s, k))
      ? 'one of our own staff'
      : (() => {
          const hits = rosterKeys.filter((r) => sameName(r.k, k))
          if (hits.length === 1) { resolved.set(hits[0]!.c.name, (resolved.get(hits[0]!.c.name) ?? 0) + 1); return null }
          // "Sam" with two Sams on the roster: picking one would credit a guess.
          return hits.length > 1 ? `ambiguous: matches ${hits.map((h) => h.c.name).join(' and ')}` : 'not on the verified contact roster'
        })()
    if (why) { const u = unresolved.get(m.name) ?? { mentions: 0, why }; u.mentions++; unresolved.set(m.name, u) }
  }
  for (const [name, u] of unresolved) dropped.push({ name, mentions: u.mentions, why: u.why })
  for (const a of new Set(meetings.map((m) => m.attendee)))
    if (!rosterKeys.some((r) => sameName(r.k, nameKey(a)))) dropped.push({ name: a, mentions: 0, why: 'in a meeting, but not on the verified contact roster' })

  const kept: Candidate[] = roster.map((c) => {
    const k = nameKey(c.name)
    const mt = meetings.filter((m) => sameName(nameKey(m.attendee), k))
    const ms = resolved.get(c.name) ?? 0
    const evidence = [`On the roster as ${c.title}`]
    const sources: Candidate['sources'] = ['roster']
    if (mt.length) { sources.push('meetings'); evidence.push(`in ${mt.length} meeting${mt.length > 1 ? 's' : ''}, last ${mt.map((m) => m.heldOn).sort().at(-1)}`) }
    if (ms) { sources.push('calls'); evidence.push(`named on ${ms} call${ms > 1 ? 's' : ''}`) }
    if (c.tickets90d) evidence.push(`${c.tickets90d} support ticket${c.tickets90d > 1 ? 's' : ''} in 90d`)
    return { name: c.name, title: c.title, score: score(c.title, ms, mt.length, c.tickets90d), evidence, sources }
  })
  return { kept: kept.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)), dropped: dropped.sort((a, b) => b.mentions - a.mentions) }
}
