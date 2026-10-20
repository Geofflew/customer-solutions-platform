/**
 * The whole story: seed, weekly scores, the HTML pages, then each mechanism's trap and guard.
 * Each section prints BROKEN (what the obvious version says), GUARDED (what this repo says) and
 * DIFF (the difference and why). Same seed, same output.
 */
import { AS_OF, connect } from '../src/db.ts'
import { FEATURE_LABEL, zoneOf } from '../src/activation.ts'
import { activationStory, botStory, championStory, churnStory, segmentStory, statusStory, WEEKS } from '../src/story.ts'
import { generate } from './generate.ts'
import { scores } from './scores.ts'
import { render } from './render.ts'

const out = (s = '') => console.log(s)
const section = (n: number, title: string) => out(`\n${'='.repeat(78)}\n${n}. ${title}\n${'='.repeat(78)}`)
const label = (tag: 'BROKEN' | 'GUARDED' | 'DIFF', text: string) => out(`${tag.padEnd(8)} ${text.split('\n').join('\n         ')}`)
const sc = (s: number | null) => (s === null ? 'not scored' : s.toFixed(1))

const db = connect()
try {
  await generate(db)
  await scores(db)
  const files = await render(db)
  out(`Acme Analytics customer-success platform, as of ${AS_OF}: 40 accounts, 12 weekly scores each, ${files.length} pages rendered to out/.`)

  section(1, 'Activation score: a zero that means disabled, not unused')
  const a = await activationStory(db)
  const why = (x: typeof a.harbor) => x.breakdown.features.map((f) => `  ${FEATURE_LABEL[f.feature]}: ${f.status === 'scored' ? `scored ${(f.score * 100).toFixed(0)} (${f.reason})` : f.reason}`).join('\n')
  label('BROKEN', `average of three completion rates, a feature with nothing to show counted as 0%:\n` +
    `Harbor & Finch ${sc(a.harbor.naive)} (${zoneOf(a.harbor.naive)}). Saltmarsh Foods ${sc(a.saltmarsh.naive)} (${zoneOf(a.saltmarsh.naive)}). Ironwood Mills ${sc(a.ironwood.naive)}.`)
  label('GUARDED', `Harbor & Finch ${sc(a.harbor.breakdown.score)} (${zoneOf(a.harbor.breakdown.score)}):\n${why(a.harbor)}\n` +
    `Saltmarsh Foods ${sc(a.saltmarsh.breakdown.score)}:\n${why(a.saltmarsh)}\n` +
    `Ironwood Mills ${sc(a.ironwood.breakdown.score)}, a real zero:\n${why(a.ironwood)}`)
  label('DIFF', `the naive average puts ${a.naiveRed} accounts in red, the activation score ${a.guardedRed}. ${a.misjudged.length} accounts land in a different zone\n` +
    `when their switched-off, snoozed or not-applicable features are averaged in as 0% than when they are left out:\n` +
    `${a.misjudged.map((x) => x.account.name).join(', ')}.\n` +
    `The book page shows ${a.zeroCount} zeros or exclusions; every one carries a reason (zerosWithReasons throws on one that does not).`)

  section(2, 'Status report: lead with what changed')
  const s = await statusStory(db)
  const r = s.bluestemRow
  label('BROKEN', `the snapshot report, every account sorted by score: Bluestem Clinics ${sc(r.score)} at row ${s.bluestemRank} of 40,\n` +
    `yellow last week (${s.lastWeek.toFixed(1)}) and yellow this week. Zone counts red/yellow/green: ${s.zonesThen.red}/${s.zonesThen.yellow}/${s.zonesThen.green} -> ${s.zonesNow.red}/${s.zonesNow.yellow}/${s.zonesNow.green}.`)
  label('GUARDED', `critical: Bluestem Clinics, ${r.flag.label}: ${r.changed}.\n` +
    `  owner ${r.owner}; next step "${r.nextStep}".\n` +
    `flagged ${s.report.critical.length} critical, ${s.report.warning.length} warning, ${s.report.watch.length} watch; top of the page, flagged with no owner or no next step:\n` +
    s.report.unowned.map((u) => `  ${u.account.name}: ${!u.owner ? 'no owner' : 'no next step'} (${u.flag.label})`).join('\n'))
  label('DIFF', `a 14-point drop inside one zone is invisible in a snapshot and first on the page here.\n` +
    `Average score, ${WEEKS[0]} to ${WEEKS.at(-1)}: everyone with a score ${s.naiveAvg.points[0]} -> ${s.naiveAvg.points.at(-1)}; the pinned cohort of ${s.pinnedAvg.cohort}\n` +
    `scored every week ${s.pinnedAvg.points[0]} -> ${s.pinnedAvg.points.at(-1)}. New accounts entering at the right-hand end move the first line, not the book.`)

  section(3, 'Segmentation: membership that changes under a saved view')
  const g = await segmentStory(db)
  const nm = (id: number) => g.facts.find((f) => f.accountId === id)!.name
  const e = g.expansion
  label('BROKEN', `saved view "${e.name}": ${e.diff.count.baseline} members at review on ${e.reviewedOn}, ${e.diff.count.now} today. Looks unchanged.`)
  label('GUARDED', `review banner: ${e.diff.added.length} entered, ${e.diff.removed.length} left since ${e.reviewedBy} accepted it on ${e.reviewedOn}.\n` +
    e.diff.added.map((x) => `  + ${nm(x.id)}: ${x.cause}`).join('\n') + '\n' +
    e.diff.removed.map((x) => `  - ${nm(x.id)}: ${x.cause}`).join('\n') + '\n' +
    e.log.map((o) => `  manual ${o.action}: ${nm(o.accountId)} by ${o.by} on ${o.on} (${o.reason})`).join('\n'))
  label('DIFF', `${e.diff.added.length + e.diff.removed.length} membership changes behind a count that moved by ${Math.abs(e.diff.count.now - e.diff.count.baseline)}.\n` +
    `"${g.competitive.name}" reads ${g.competitive.noData} accounts as no-data (no call recordings), shown as "can't tell", never as "no".`)

  section(4, 'Churn and champions: a headline that moves on one keyword hit')
  const c = await churnStory(db)
  const hit = c.guarded.hits.find((h) => c.guarded.uncorroborated.includes(h.family))!
  label('BROKEN', `Copperline Freight churn headline ${c.before.headline.toFixed(2)} (${c.before.zone}) last week -> ${c.naive.headline.toFixed(2)} (${c.naive.zone}) this week.\n` +
    `What moved it: note keyword "${hit.family}" in one note.`)
  label('GUARDED', `${c.guarded.headline.toFixed(2)} (${c.guarded.zone}). The hit is shown as evidence with weight 0 until a second author writes it on another day:\n` +
    `  "${hit.excerpt}" (${hit.author}, ${hit.writtenOn})`)
  label('DIFF', `backtest on ${c.backtest.n} labelled snapshots (${c.backtest.churned} churned): AUC ${c.backtest.aucNaive.toFixed(3)} counting every hit, ${c.backtest.aucGuarded.toFixed(3)} counting corroborated ones.\n` +
    `Single notes changed the zone of ${c.backtest.moved} snapshots; ${c.backtest.movedChurned} of those accounts churned. Red: ${c.backtest.redNaive.length} -> ${c.backtest.redGuarded.length} snapshots,\n` +
    `churn rate in red ${pct(c.backtest.redNaive)} -> ${pct(c.backtest.redGuarded)}.`)
  const ch = await championStory(db)
  label('BROKEN', `champions as the names mentioned most on calls: ${ch.naive.slice(0, 4).map((x) => `${x.name} (${x.mentions})`).join(', ')}.`)
  label('GUARDED', ch.guarded.kept.slice(0, 3).map((x) => `${x.name} ${x.score} [${x.sources.join(', ')}]: ${x.evidence.join('; ')}`).join('\n') + '\n' +
    ch.guarded.dropped.map((d) => `  dropped ${d.name} (${d.mentions} mentions): ${d.why}`).join('\n'))
  label('DIFF', `the top three call names were our own CSM, the customer's auditor and a first name that fits two contacts.`)

  section(5, 'Bot: propose, confirm, apply the stored proposal')
  const b = await botStory(db)
  label('BROKEN', `"${b.asked}" proposed 1 change. A relayed confirm carried ${b.relayed.length};\n` +
    `the handler that applies the message's list wrote ${b.naiveCount} assignments: ${b.naive.map((x) => `${x.role} = ${x.person}`).join(', ')}.`)
  label('GUARDED', b.events.filter((x) => x.kind !== 'user').map((x) =>
    x.kind === 'bot' ? `bot: ${x.text}${x.proposal ? ` [${x.proposal.changes.map((c) => `${c.role} = ${c.person}`).join(', ')}]` : ''}` :
    x.kind === 'relay' ? `relay: ${x.text} [${x.changes.length} changes]` :
    x.kind === 'click' ? `click: ${x.who} presses Confirm on ${x.proposalId}${x.where ? ` (pasted into ${x.where})` : ''}` :
    x.kind === 'result' ? `  -> ${x.ok ? 'ok' : 'refused'}: ${x.text}` : '').join('\n'))
  label('DIFF', `${b.naiveCount} assignments written by the naive handler, ${b.guardedCount} by the guarded one. Proposals: ${b.proposals.map((p) => `${p.proposal_id} ${p.status}`).join(', ')}.`)
} finally {
  await db.end()
}

function pct(xs: Array<{ churned: boolean }>) {
  return xs.length ? `${Math.round((100 * xs.filter((x) => x.churned).length) / xs.length)}%` : 'n/a'
}
