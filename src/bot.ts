/**
 * The chat bot. An app mention is a question (answered read-only) or a command. A command never
 * changes anything: it stores a proposal and shows it. The person confirms, and the server
 * applies the proposal it stored, by id. Whatever list the confirm message carries is compared,
 * never used.
 */
import { createHash } from 'node:crypto'
import type pg from 'pg'
import { addDays, rows, type Db } from './db.ts'

export interface Change { role: 'onboarding' | 'cash' | 'owner'; person: string }

const QUESTION_WORDS = new Set(['what', 'who', 'whos', 'how', 'why', 'when', 'where', 'which', 'is', 'are', 'does', 'do', 'can', 'show', 'list', 'tell'])
const ROLES: Record<string, Change['role']> = { onboarding: 'onboarding', implementation: 'onboarding', cash: 'cash', owner: 'owner', csm: 'owner' }

/** The mention that summoned the bot, in either the raw `<@ID>` or the display `@name` form. */
const stripMention = (text: string) => text.replace(/<@[^>]+>/g, ' ').replace(/^\s*@[\w-]+/, ' ').trim()

export function route(text: string): 'question' | 'command' {
  const t = stripMention(text)
  if (t.endsWith('?')) return 'question'
  const first = t.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
  return QUESTION_WORDS.has(first) ? 'question' : 'command'
}

/** "assign Harbor & Finch, Priya onboarding, Wes cash" -> account query + one change per role. */
export function parseCommand(text: string): { account: string; changes: Array<{ role: Change['role']; name: string }>; errors: string[] } {
  const t = stripMention(text).replace(/^assign\s+/i, '').trim()
  const [account = '', ...rest] = t.split(',').map((s) => s.trim())
  const changes: Array<{ role: Change['role']; name: string }> = [], errors: string[] = []
  for (const part of rest) {
    const words = part.split(/\s+/)
    const role = ROLES[words.at(-1)!.toLowerCase()]
    if (!role || words.length < 2) { errors.push(`could not read "${part}" as "<name> <role>"`); continue }
    changes.push({ role, name: words.slice(0, -1).join(' ') })
  }
  return { account, changes, errors }
}

export const listHash = (cs: Change[]) =>
  createHash('sha256').update(JSON.stringify([...cs].sort((a, b) => a.role.localeCompare(b.role) || a.person.localeCompare(b.person)))).digest('hex').slice(0, 12)

type ProposeResult =
  | { ok: true; proposalId: string; account: string; changes: Change[]; hash: string }
  | { ok: false; reason: string }

/** Resolve the account and every name against the roster, store the proposal, change nothing. */
export async function propose(db: Db, requestedBy: string, threadId: string, text: string, today: string): Promise<ProposeResult> {
  const p = parseCommand(text)
  if (p.errors.length || !p.changes.length) return { ok: false, reason: p.errors.join('; ') || 'no assignments found' }
  const accts = await rows<{ account_id: number; name: string }>(db, `SELECT account_id, name FROM cs.accounts WHERE name ILIKE $1 || '%'`, [p.account])
  if (accts.length !== 1) return { ok: false, reason: accts.length ? `"${p.account}" is ambiguous: ${accts.map((a) => a.name).join(', ')}` : `no account matches "${p.account}"` }
  const staff = (await rows<{ name: string }>(db, 'SELECT name FROM cs.staff')).map((s) => s.name)
  const changes: Change[] = []
  for (const c of p.changes) {
    const hit = staff.filter((s) => s.toLowerCase().startsWith(c.name.toLowerCase()))
    if (hit.length !== 1) return { ok: false, reason: hit.length ? `"${c.name}" is ambiguous: ${hit.join(', ')}` : `no one on the team is called "${c.name}"` }
    if (changes.some((x) => x.role === c.role && x.person === hit[0])) return { ok: false, reason: `${hit[0]} is named twice for ${c.role}` }
    changes.push({ role: c.role, person: hit[0]! })
  }
  const [{ proposal_id: proposalId }] = (await rows<{ proposal_id: string }>(db,
    `INSERT INTO cs.proposals (requested_by, thread_id, account_id, changes, created_on, expires_on) VALUES ($1,$2,$3,$4,$5,$6) RETURNING proposal_id`,
    [requestedBy, threadId, accts[0]!.account_id, JSON.stringify(changes), today, addDays(today, 1)])) as [{ proposal_id: string }]
  return { ok: true, proposalId, account: accts[0]!.name, changes, hash: listHash(changes) }
}

/** What a confirm button or a relayed confirm message delivers. Only proposalId is trusted. */
export interface ConfirmPayload { proposalId: string; confirmedBy: string; threadId: string; changes?: Change[]; hash?: string }

/** The broken handler: applies the list the confirm message carries. */
export async function confirmNaive(db: Db, c: ConfirmPayload): Promise<{ applied: Change[] }> {
  const [p] = await rows<{ account_id: number; changes: Change[] }>(db, 'SELECT account_id, changes FROM cs.proposals WHERE proposal_id = $1', [c.proposalId])
  const list = c.changes ?? p!.changes
  for (const ch of list) await addAssignment(db, p!.account_id, ch, c.proposalId)
  return { applied: list }
}

/** applied: rows this confirm wrote. unchanged: changes that were already true, written by nobody. */
type ConfirmResult = { ok: true; applied: Change[]; unchanged: Change[] } | { ok: false; reason: string }

/**
 * The guarded handler. One transaction: lock the proposal row, check it is pending, unexpired and
 * confirmed by the person who asked, refuse if the message carries a different list, then apply
 * exactly the stored list and mark it applied so a replay finds nothing to do.
 */
export async function confirm(pool: pg.Pool, c: ConfirmPayload, today: string): Promise<ConfirmResult> {
  const db = await pool.connect()
  await db.query('BEGIN')
  try {
    const [p] = await rows<{ account_id: number; changes: Change[]; status: string; requested_by: string; thread_id: string; expires_on: string }>(db,
      'SELECT account_id, changes, status, requested_by, thread_id, expires_on FROM cs.proposals WHERE proposal_id = $1 FOR UPDATE', [c.proposalId])
    const refuse = async (reason: string, status?: string) => {
      if (status) await db.query('UPDATE cs.proposals SET status = $2 WHERE proposal_id = $1', [c.proposalId, status])
      await db.query(status ? 'COMMIT' : 'ROLLBACK')
      return { ok: false as const, reason }
    }
    if (!p) return await refuse(`no proposal ${c.proposalId}`)
    if (p.status !== 'pending') return await refuse(`${c.proposalId} is already ${p.status}`)
    if (p.expires_on < today) return await refuse(`${c.proposalId} expired on ${p.expires_on}`, 'expired')
    if (c.confirmedBy !== p.requested_by) return await refuse(`only ${p.requested_by}, who asked, can confirm ${c.proposalId}`)
    // A confirm counts only where the person saw the proposal; an id pasted into another thread does not.
    if (c.threadId !== p.thread_id) return await refuse(`${c.proposalId} was proposed in another thread; confirm it there`)
    const sent = c.changes ? listHash(c.changes) : c.hash
    // A confirm that names a different list is not a confirm of this proposal. Refuse it and
    // close the proposal, so the stored list cannot be applied by a later, quieter retry either.
    if (sent !== undefined && sent !== listHash(p.changes))
      return await refuse(`the confirm carried ${c.changes ? c.changes.length : 'a different list of'} change${c.changes?.length === 1 ? '' : 's'}; ${c.proposalId} proposed ${p.changes.length}. Nothing applied; ask again.`, 'refused')
    const applied: Change[] = [], unchanged: Change[] = []
    for (const ch of p.changes) ((await addAssignment(db, p.account_id, ch, c.proposalId)) ? applied : unchanged).push(ch)
    await db.query(`UPDATE cs.proposals SET status = 'applied' WHERE proposal_id = $1`, [c.proposalId])
    await db.query('COMMIT')
    return { ok: true, applied, unchanged }
  } catch (e) {
    await db.query('ROLLBACK')
    throw e
  } finally {
    db.release()
  }
}

/** Adds one person to one role. Returns whether a row was written (false: they already held it). */
async function addAssignment(db: Db, accountId: number, ch: Change, proposalId: string): Promise<boolean> {
  const r = await db.query(`INSERT INTO cs.assignments (account_id, role, person, proposal_id) VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING RETURNING 1`, [accountId, ch.role, ch.person, proposalId])
  return (r.rowCount ?? 0) > 0
}

/** Questions are read-only. This one knows owners and phases; anything else gets a pointer. */
export async function answer(db: Db, text: string): Promise<string> {
  const accts = await rows<{ name: string; owner: string | null; phase: string }>(db, 'SELECT name, owner, phase FROM cs.accounts ORDER BY length(name) DESC')
  const a = accts.find((x) => text.toLowerCase().includes(x.name.toLowerCase()))
  if (!a) return 'I can answer who owns an account and what phase it is in. Name the account.'
  return `${a.name} is in ${a.phase}; owner ${a.owner ?? 'nobody (unassigned)'}.`
}
