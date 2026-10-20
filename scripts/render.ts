/**
 * Writes out/*.html from the seed: one static page per screen, styled by src/ui/tokens.css,
 * charts drawn here as inline SVG. Run after `pnpm generate && pnpm scores`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import type pg from 'pg'
import { pathToFileURL } from 'node:url'
import { AS_OF, addDays, connect, type Db } from '../src/db.ts'
import { FEATURE_LABEL, FEATURES, zoneOf, type FeatureResult } from '../src/activation.ts'
import { SIGNALS, deriveTags, members, membership } from '../src/segments.ts'
import { KEYWORDS } from '../src/churn.ts'
import { activationStory, botStory, championStory, churnStory, segmentStory, statusStory, WEEKS } from '../src/story.ts'
import type { ReportRow } from '../src/status.ts'
import { avatar, badge, bars, delta, esc, fmtDate, fmtMonth, lines, shell, sparkline, who } from '../src/ui/html.ts'

const OUT = new URL('../out/', import.meta.url)
const asOfLabel = new Date(`${AS_OF}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const pct = (v: number) => `${Math.round(v * 100)}`
const heat = (v: number | null) => (v === null ? 'var(--chip)' : `color-mix(in srgb, var(--olive) ${Math.round(18 + 82 * Math.min(1, v / 0.8))}%, var(--sage))`)
const ZONE_COLOR = { red: 'var(--orange-mark)', yellow: 'var(--citron)', green: 'var(--olive)', none: 'var(--faint)' }

function featureCell(f: FeatureResult): string {
  if (f.status === 'excluded') {
    const chip = f.kind === 'disabled' ? 'Off' : f.kind === 'snoozed' ? 'Snoozed' : 'N/A'
    const why = f.reason.replace(/^(Off|Not applicable|Snoozed until [\d-]+): /, '')
    return `<div class="off"><span><span class="chip grey">${chip}</span></span><span class="why" title="${esc(f.reason)}">${esc(why)}</span></div>`
  }
  const sq = f.pcts.map((p) => `<span class="sq" style="background:${heat(p)}" title="${p === null ? 'no rows' : pct(p) + '%'}"></span>`).join('')
  return `<div class="feat">${sq}<span class="v" style="${f.score === 0 ? 'color:var(--orange-text)' : ''}">${pct(f.score)}</span></div>`
}

async function activationPage(db: Db): Promise<string> {
  const a = await activationStory(db)
  const s = await statusStory(db)
  const weeksOf = (id: number) => s.book.find((b) => b.accountId === id)!.weeks
  const scores = a.all.map((x) => x.breakdown.score).filter((v): v is number => v !== null).sort((p, q) => p - q)
  const median = scores[Math.floor(scores.length / 2)]!
  const medianTrend = WEEKS.map((d) => {
    const v = s.book.map((b) => b.weeks.find((w) => w.asOf === d)?.score).filter((x): x is number => x != null).sort((p, q) => p - q)
    return v[Math.floor(v.length / 2)] ?? null
  })
  const zoneTrend = (z: string) => WEEKS.map((d) => s.book.filter((b) => { const w = b.weeks.find((x) => x.asOf === d); return w && zoneOf(w.score) === z }).length)
  const kpi = (label: string, value: string, d: string, spark: string, foot: string) =>
    `<div class="card kpi"><div class="label">${label}</div><div class="row"><div><div class="value">${value}</div></div>${spark}</div><div class="foot">${d} ${foot}</div></div>`
  const bins = Array.from({ length: 10 }, (_, i) => i)
  const binOf = (v: number) => Math.min(9, Math.floor(v / 10))
  const thisW = bins.map((i) => s.book.filter((b) => { const v = b.weeks.at(-1)?.score; return v != null && binOf(v) === i }).length)
  const lastW = bins.map((i) => s.book.filter((b) => { const v = b.weeks.at(-2)?.score; return v != null && binOf(v) === i }).length)
  const h = a.harbor
  const featLine = (f: FeatureResult) => `<li><span style="width:118px;flex:none;font-weight:600">${FEATURE_LABEL[f.feature]}</span>${f.status === 'scored'
    ? `<span class="chip green">scored ${pct(f.score)}</span><span class="muted">${esc(f.reason)}</span>`
    : `<span class="chip grey">${f.kind === 'disabled' ? 'off' : f.kind === 'snoozed' ? 'snoozed' : 'n/a'}</span><span class="muted">${esc(f.reason.replace(/^(Off|Not applicable): /, ''))}</span>`}</li>`
  const sorted = [...a.all].sort((p, q) => (q.breakdown.score ?? -1) - (p.breakdown.score ?? -1))
  const rowsHtml = sorted.map((x) => {
    const b = x.breakdown
    const hl = x.account.name === 'Harbor & Finch' || x.account.name === 'Saltmarsh Foods' || x.account.name === 'Ironwood Mills'
    const short: Record<string, string> = { 'fewer-than-2-periods': '1 month', 'no-usage-rows': 'no rows', 'no-kickoff-date': 'no kickoff', 'kickoff-in-future': 'future kickoff', 'all-features-excluded': 'all excluded' }
    const flags = [...(b.penalty ? [`<span class="chip amber" title="escalations and complaints">−${Math.round(b.penalty * 100)}%</span>`] : []), ...b.flags.map((f) => `<span class="chip outline" title="${esc(f)}">${esc(short[f] ?? f)}</span>`)].join(' ')
    return `<tr${hl ? ' class="hl"' : ''}><td><div class="name">${esc(x.account.name)}</div><div class="meta">${x.account.phase} · ${x.account.integration === 'erp' ? 'ERP integration' : 'file import'}</div></td>
<td>${x.account.owner ? `<span class="who">${avatar(x.account.owner)}${esc(x.account.owner.split(' ')[0])}</span>` : '<span class="chip red">No owner</span>'}</td><td class="r">${badge(b.score, zoneOf(b.score))}</td>
<td>${sparkline(weeksOf(x.account.account_id).map((w) => w.score), { w: 88, h: 22 })}</td>
${b.features.map((f) => `<td>${featureCell(f)}</td>`).join('')}
<td class="r">${b.score === null ? '<span class="muted">—</span>' : b.newness >= 0.05 ? `+${b.newness.toFixed(1)}` : '<span class="muted">0</span>'}</td><td style="white-space:nowrap">${flags}</td></tr>`
  }).join('')
  const body = `
<div class="grid g4">
${kpi('Median score', median.toFixed(1), delta(median - (medianTrend.at(-2) ?? median)), sparkline(medianTrend, { w: 110, h: 34 }), 'vs last week')}
${kpi('Green · 70 and up', String(a.all.filter((x) => zoneOf(x.breakdown.score) === 'green').length), delta(zoneTrend('green').at(-1)! - zoneTrend('green').at(-2)!, 0), sparkline(zoneTrend('green'), { w: 110, h: 34, color: 'var(--olive)' }), 'accounts vs last week')}
${kpi('Red · below 40', String(a.guardedRed), delta(zoneTrend('red').at(-1)! - zoneTrend('red').at(-2)!, 0), sparkline(zoneTrend('red'), { w: 110, h: 34, color: 'var(--orange-mark)' }), `accounts · naive average says ${a.naiveRed}`)}
${kpi('Not scored', String(a.all.filter((x) => x.breakdown.score === null).length), '<span class="delta flat">±0</span>', sparkline(zoneTrend('none'), { w: 110, h: 34, color: 'var(--faint)' }), 'every feature off, snoozed or N/A')}
</div>
<div class="grid g21">
<div class="card"><div class="row"><h2>Score distribution</h2><span class="spacer"></span><span class="chip grey">dashed: last week</span></div><div class="sub">Accounts per 10-point band, this week against last week. Not-scored accounts are left out, not put at 0.</div>
${bars({ labels: bins.map((i) => `${i * 10}–${i * 10 + 9}`), values: thisW, ghost: lastW, colors: bins.map((i) => (i < 4 ? ZONE_COLOR.red : i < 7 ? ZONE_COLOR.yellow : ZONE_COLOR.green)), w: 700, h: 380 })}</div>
<div class="card"><h2>A zero that means off, not unused</h2><div class="sub">${esc(h.account.name)}, ${h.account.phase.toLowerCase()} since ${fmtDate(h.account.kickoff_date!)}, 2025</div>
<div class="grid g2" style="margin-bottom:12px"><div class="callout trap"><div class="k">Average of three rates</div><div class="big">${h.naive.toFixed(0)}</div><div class="muted" style="font-size:12px">two features counted as 0%</div></div>
<div class="callout guard"><div class="k">Activation score</div><div class="big">${h.breakdown.score!.toFixed(0)}</div><div class="muted" style="font-size:12px">two features excluded, with reasons</div></div></div>
<ul class="list">${h.breakdown.features.map(featLine).join('')}</ul>
<div class="muted" style="font-size:12px;margin-top:8px">${esc(a.saltmarsh.account.name)}: every feature excluded, so <b>not scored</b> instead of 0. ${esc(a.ironwood.account.name)}: a real 0, “${esc(a.ironwood.breakdown.features[0]!.status === 'scored' ? a.ironwood.breakdown.features[0]!.reason : '')}”.</div></div>
</div>
<div class="card flush"><div class="card-h"><h2>Book</h2><span class="muted">${a.all.length} accounts · months ${a.harbor.breakdown.periods.map(fmtMonth).join(', ')} · squares are the three closed months</span><span class="right row"><span class="chip grey">Off / N/A / Snoozed: excluded with reason</span></span></div>
<table class="dense"><thead><tr><th>Account</th><th>Owner</th><th class="r">Score</th><th>12 weeks</th>${FEATURES.map((f) => `<th>${FEATURE_LABEL[f]}</th>`).join('')}<th class="r">Newness</th><th>Penalty, flags</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`
  return shell({ title: 'Activation score', active: 'Activation', heading: 'Activation score', sub: `Value realised from closed months of product use · as of ${asOfLabel}`,
    actions: '<span class="btn">All owners ▾</span><span class="seg"><span class="on">Weekly</span><span>Monthly</span></span><span class="btn">Export</span>', body })
}

function reportRows(rs: ReportRow[], book: Awaited<ReturnType<typeof statusStory>>['book']): string {
  if (!rs.length) return '<div class="muted" style="padding:12px 20px">Nothing flagged.</div>'
  return `<table style="table-layout:fixed"><colgroup><col style="width:160px"><col style="width:156px"><col style="width:60px"><col style="width:60px"><col style="width:92px"><col style="width:190px"><col style="width:140px"><col></colgroup><thead><tr><th>Account</th><th>Flag</th><th class="r">Score</th><th class="r">Week</th><th>12 weeks</th><th>What changed</th><th>Owner</th><th>Next step and latest note</th></tr></thead><tbody>${rs.map((r) => {
    const a = book.find((b) => b.accountId === r.account.accountId)!
    const tone = r.flag.type === 'drop' ? 'red' : r.flag.type === 'silent' ? 'grey' : 'amber'
    return `<tr${r.account.name === 'Bluestem Clinics' ? ' class="hl"' : ''}><td><div class="name">${esc(r.account.name)}</div><div class="meta">${r.account.phase}</div></td>
<td><span class="chip ${tone}">${esc(r.flag.label)}</span></td><td class="r">${badge(r.score, r.zone)}</td><td class="r">${r.score === null ? '<span class="muted">—</span>' : delta(r.delta)}</td>
<td>${sparkline(a.weeks.map((w) => w.score), { w: 84, h: 22 })}</td>
<td><div class="two" style="font-size:12px" title="${esc(r.changed)}">${esc(r.changed)}</div></td><td>${who(r.owner)}</td>
<td>${r.nextStep ? `<div class="clip" style="font-size:12px;font-weight:600" title="${esc(r.nextStep)}">${esc(r.nextStep)}</div>` : '<span class="chip red">No next step</span>'}
${a.note ? `<div class="two" style="font-size:12px" title="${esc(a.note.text)}"><span class="quote">“${esc(a.note.text)}”</span> <span class="meta">${esc(a.note.author)} · ${fmtDate(a.note.writtenOn)}</span></div>` : ''}</td></tr>`
  }).join('')}</tbody></table>`
}

async function statusPage(db: Db): Promise<string> {
  const s = await statusStory(db)
  const { report: r } = s
  const sec = (title: string, tone: string, rs: ReportRow[], sub: string) =>
    `<div class="card flush" style="margin-bottom:16px"><div class="card-h"><span class="dot" style="background:var(--${tone})"></span><h2>${title}</h2><span class="chip ${tone === 'grey' ? 'grey' : tone}">${rs.length}</span><span class="muted">${sub}</span></div>${reportRows(rs, s.book)}</div>`
  const zoneTile = (z: 'red' | 'yellow' | 'green', label: string) => {
    const now = s.zonesNow[z], then = s.zonesThen[z]
    const ids = (k: number) => new Set(s.book.filter((b) => { const w = b.weeks.at(-1 - k); return w && zoneOf(w.score) === z }).map((b) => b.accountId))
    const n = ids(0), t = ids(1)
    const inn = [...n].filter((x) => !t.has(x)).length, out = [...t].filter((x) => !n.has(x)).length
    return `<div class="card kpi"><div class="label"><span class="dot" style="background:var(--${z === 'yellow' ? 'amber' : z})"></span> ${label}</div><div class="row"><div class="value">${now}</div><div class="foot" style="text-align:right">last week ${then}<br><b style="color:var(--fg)">${inn} in · ${out} out</b></div></div></div>`
  }
  const lbl = WEEKS.map(fmtDate)
  const wins = r.wins.map((a) => { const sc = a.weeks.filter((w) => w.score !== null); return `<li><span class="name" style="flex:1">${esc(a.name)}</span>${sparkline(a.weeks.map((w) => w.score), { w: 70, h: 20, min: 0, max: 100, color: 'var(--olive)' })}<span class="delta up">+${(sc.at(-1)!.score! - sc[0]!.score!).toFixed(0)}</span>${badge(sc.at(-1)!.score, zoneOf(sc.at(-1)!.score))}</li>` }).join('')
  const fresh = r.newToScope.map((a) => `<li><span class="name" style="flex:1">${esc(a.name)}</span><span class="muted">kicked off ${fmtDate(a.kickoffDate!)}</span>${who(a.owner)}${badge(a.weeks.at(-1)?.score ?? null, zoneOf(a.weeks.at(-1)?.score ?? null))}</li>`).join('')
  const body = `
<div class="grid" style="grid-template-columns:1.6fr 1fr 1fr 1fr">
<div class="card kpi"><div class="label">Average · pinned cohort</div>
<div class="row"><div><div class="value">${s.pinnedAvg.points.at(-1)}</div><div class="foot">${s.pinnedAvg.cohort} accounts scored all 12 weeks: ${delta(s.pinnedAvg.points.at(-1)! - s.pinnedAvg.points[0]!)}<br>all accounts ${s.naiveAvg.points.at(-1)} ${delta(s.naiveAvg.points.at(-1)! - s.naiveAvg.points[0]!)}</div></div>
${lines({ labels: lbl.map((l, i) => (i === 0 || i === lbl.length - 1 ? l : '')), series: [{ name: 'all', values: s.naiveAvg.points, color: 'var(--faint)', dash: true }, { name: 'pinned', values: s.pinnedAvg.points, color: 'var(--olive)' }], w: 250, h: 84, min: 40, max: 60 })}</div></div>
${zoneTile('red', 'Red · below 40')}${zoneTile('yellow', 'Yellow · 40 to 69')}${zoneTile('green', 'Green · 70 and up')}
</div>
${r.unowned.length ? `<div class="callout guard" style="margin-bottom:16px"><div class="row"><span class="k">Needs an owner</span><span>${r.unowned.length} flagged accounts have no owner or no next step. They stay at the top until someone takes them:</span>${r.unowned.map((u) => `<span><b class="ul">${esc(u.account.name)}</b> <span class="muted">${!u.owner ? 'no owner' : 'no next step'}</span></span>`).join('')}</div></div>` : ''}
${sec('Critical', 'red', r.critical, 'dropped 10 or more points this week')}
${sec('Warning', 'amber', r.warning, 'heading below a line in two weeks, or down over four weeks')}
${sec('Watch', 'grey', r.watch, 'no meeting in 21 days, past kickoff and not yet live')}
<div class="grid g2"><div class="card"><h2>Wins</h2><div class="sub">Up 5 or more over 12 weeks and at 60 or above</div><ul class="list">${wins}</ul></div>
<div class="card"><h2>New to scope</h2><div class="sub">Kicked off in the last three weeks; scores carry the newness premium</div><ul class="list">${fresh}</ul></div></div>`
  return shell({ title: 'Status report', active: 'Status report', heading: 'Status report', sub: `Week of ${fmtDate(addDays(AS_OF, -2))}, 2026 · what changed since ${fmtDate(addDays(AS_OF, -7))} · ${s.book.length} accounts, 5 owners`,
    actions: '<span class="btn">All owners ▾</span><span class="btn">Copy to channel</span><span class="btn primary">Send weekly digest</span>', body })
}

const SHORT: Record<string, string> = { erp: 'ERP', reporting: 'Reporting', renewalSoon: 'Renews 120d', execEngaged: 'Exec', goingQuiet: 'Quiet', highActivation: 'Activation 70+', competitorOnCalls: 'Competitor' }
async function segmentsPage(db: Db): Promise<string> {
  const g = await segmentStory(db)
  const e = g.expansion
  const nm = (id: number) => esc(g.facts.find((f) => f.accountId === id)!.name)
  const bar = g.segments.map((s) => `<div class="s${s.segment_id === 'expansion' ? ' on' : ''}">${esc(s.name)} <span class="n">${s.diff.count.now}</span>${s.noData ? `<span class="chip grey">${s.noData} can't tell</span>` : ''}${s.segment_id === 'expansion' && s.diff.added.length + s.diff.removed.length ? `<span class="chip red">${s.diff.added.length + s.diff.removed.length} changed</span>` : ''}</div>`).join('')
  const ruleHtml = `<div class="rule"><span class="chip">Activation 70+</span><span class="op">AND</span><span class="chip">Exec engaged</span><span class="op">AND NOT</span><span class="chip">Going quiet</span><span class="muted" style="margin-left:8px">plus manual includes, minus manual excludes (excludes win)</span></div>`
  const order: Record<string, number> = { member: 0, included: 1, excluded: 2, 'no-data': 3, out: 4 }
  const added = new Set(e.diff.added.map((x) => x.id)), removed = new Set(e.diff.removed.map((x) => x.id))
  const rank = (id: number) => (added.has(id) || removed.has(id) ? -1 : order[e.now.get(id)!]!)
  const SHOWN = 20
  const sortedFacts = [...g.facts].sort((x, y) => rank(x.accountId) - rank(y.accountId) || x.name.localeCompare(y.name))
  const rowsHtml = sortedFacts.slice(0, SHOWN).map((f) => {
    const tags = deriveTags(f, AS_OF)
    const m = e.now.get(f.accountId)!
    const pill = { member: '<span class="chip">Member</span>', included: '<span class="chip">Included manually</span>', excluded: '<span class="chip red">Excluded manually</span>', 'no-data': '<span class="chip grey">Can’t tell</span>', out: '<span class="muted">—</span>' }[m]
    const change = added.has(f.accountId) ? '<span class="chip green">entered</span>' : removed.has(f.accountId) ? '<span class="chip red">left</span>' : ''
    const ev = SIGNALS.filter((s) => ['highActivation', 'execEngaged', 'goingQuiet'].includes(s.key) && tags[s.key] === 'lit').map((s) => s.evidence(f, AS_OF)).join(' · ')
    return `<tr${added.has(f.accountId) || removed.has(f.accountId) ? ' class="hl"' : ''}><td><div class="name">${esc(f.name)}</div></td>${SIGNALS.map((s) => `<td style="text-align:center"><span class="sig ${tags[s.key] === 'no-data' ? 'nodata' : tags[s.key]}" title="${esc(s.label)}"></span></td>`).join('')}<td style="white-space:nowrap">${pill} ${change}</td><td><div class="two muted" style="max-width:300px;font-size:12px" title="${esc(ev)}">${esc(ev)}</div></td></tr>`
  }).join('') + `<tr class="more"><td colspan="${SIGNALS.length + 3}">Show all ${g.facts.length} accounts · ${g.facts.length - SHOWN} more, none of them changed ▾</td></tr>`
  const banner = `<div class="callout guard" style="margin-bottom:16px"><div class="row"><div><div class="k">Membership changed since the last review</div><div class="muted" style="margin-top:2px">${esc(e.reviewedBy)} accepted ${e.diff.count.baseline} members on ${fmtDate(e.reviewedOn)} · ${e.diff.count.now} today · the count moved by ${Math.abs(e.diff.count.now - e.diff.count.baseline)}, the list by ${e.diff.added.length + e.diff.removed.length}</div></div><span class="spacer"></span><span class="btn sm">Review later</span><span class="btn sm primary">Accept changes</span></div>
<div class="grid g2" style="margin:12px 0 0"><div><b style="color:var(--gain)">${e.diff.added.length} entered</b><ul class="list">${e.diff.added.map((x) => `<li><span class="name" style="width:150px;flex:none">${nm(x.id)}</span><span class="muted" style="font-size:12px">${esc(x.cause)}</span></li>`).join('')}</ul></div>
<div><b style="color:var(--orange-text)">${e.diff.removed.length} left</b><ul class="list">${e.diff.removed.map((x) => `<li><span class="name" style="width:150px;flex:none">${nm(x.id)}</span><span class="muted" style="font-size:12px">${esc(x.cause)}</span></li>`).join('')}</ul></div></div></div>`
  const cover = SIGNALS.map((s) => {
    const n = g.facts.filter((f) => s.covers(f, AS_OF)).length, lit = g.facts.filter((f) => deriveTags(f, AS_OF)[s.key] === 'lit').length
    return `<li><div style="flex:1"><div class="name">${esc(s.label)}</div><div class="meta">${esc(s.source)}</div></div><span class="num" style="width:48px;text-align:right">${lit}</span><span class="num ${n < g.facts.length ? '' : 'muted'}" style="width:64px;text-align:right;${n < g.facts.length ? 'font-weight:600' : ''}">${n}/${g.facts.length}</span></li>`
  }).join('')
  const logHtml = e.log.map((o) => `<li>${avatar(o.by)}<div><div><b>${esc(o.by)}</b> ${o.action === 'include' ? 'included' : o.action === 'exclude' ? 'excluded' : 'cleared'} <b>${nm(o.accountId)}</b> <span class="muted">· ${fmtDate(o.on)}</span></div><div class="quote" style="font-size:12px">“${esc(o.reason)}”</div></div></li>`).join('')
  const body = `<div class="segbar">${bar}</div>${banner}
<div class="grid" style="grid-template-columns:1.25fr 1fr 1fr"><div class="card"><div class="row"><h2>Expansion-ready</h2><span class="spacer"></span><span class="btn sm">Edit rule</span><span class="btn sm">Push to CRM list</span></div><div class="sub">A saved rule over signal states. A signal whose source does not cover an account is no-data, and a rule that touches it says “can’t tell”.</div>${ruleHtml}
<div style="margin-top:16px"><div class="row"><b>Members by week</b><span class="muted" style="font-size:12px">same count at review and today</span></div>
${bars({ labels: WEEKS.map((d, i) => (d === e.reviewedOn ? 'review' : i === 0 || i === WEEKS.length - 1 ? fmtDate(d) : '')), values: WEEKS.map((d) => members(membership(e.rule, g.facts, e.log, d)).length), colors: WEEKS.map((d) => (d === e.reviewedOn ? 'var(--ink)' : 'var(--citron)')), w: 380, h: 150 })}</div></div>
<div class="card"><h2>Override log</h2><div class="sub">Append-only. An exclude wins over an include; a clear removes both.</div><ul class="list">${logHtml}</ul></div>
<div class="card"><h2>Signal registry</h2><div class="sub">Each signal names its source. Columns: accounts lit, accounts the source covers.</div><ul class="list">${cover}</ul></div></div>
<div class="card flush"><div class="card-h"><h2>Accounts and signals</h2><span class="muted">${g.facts.length} accounts · <span class="sig lit"></span> lit &nbsp;<span class="sig unlit"></span> unlit &nbsp;<span class="sig nodata"></span> no-data</span></div>
<table class="dense"><thead><tr><th>Account</th>${SIGNALS.map((s) => `<th style="text-align:center">${esc(SHORT[s.key] ?? s.label)}</th>`).join('')}<th>Expansion-ready</th><th>Evidence for the rule</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`
  return shell({ title: 'Segments', active: 'Segments', heading: 'Segments', sub: `Saved rules over signals derived from facts · as of ${asOfLabel}`, actions: '<span class="btn">Export CSV</span><span class="btn primary">New segment</span>', body })
}

async function accountPage(db: Db): Promise<string> {
  const c = await churnStory(db)
  const ch = await championStory(db)
  const acct = c.account
  const zc = (z: string) => (z === 'yellow' ? 'amber' : z)
  const gauge = (h: number, w = 360) => {
    const x = (v: number) => (v * w).toFixed(1)
    return `<svg width="${w}" height="34" viewBox="0 0 ${w} 34"><rect x="0" y="10" width="${x(0.3)}" height="10" rx="5" fill="var(--sage)"/><rect x="${x(0.3)}" y="10" width="${(0.3 * w).toFixed(1)}" height="10" fill="var(--chip)"/><rect x="${x(0.6)}" y="10" width="${(0.4 * w).toFixed(1)}" height="10" rx="5" fill="var(--orange-tint)"/>
<circle cx="${x(h)}" cy="15" r="7" fill="var(--fg)" stroke="#fff" stroke-width="2"/><text x="${x(0.3)}" y="32" font-size="10" text-anchor="middle" fill="var(--muted-fg)">0.30</text><text x="${x(0.6)}" y="32" font-size="10" text-anchor="middle" fill="var(--muted-fg)">0.60</text></svg>`
  }
  const cells = c.guarded.cells.map((cl) => `<li style="align-items:center"><span class="name" style="width:96px;flex:none;text-transform:capitalize">${cl.name}</span><div class="bar" style="width:140px;flex:none"><i style="width:${Math.round((cl.risk ?? 0) * 100)}%;background:${(cl.risk ?? 0) >= 0.5 ? 'var(--orange-mark)' : (cl.risk ?? 0) >= 0.25 ? 'var(--citron)' : 'var(--olive)'}"></i></div><span class="num" style="width:36px">${(cl.risk ?? 0).toFixed(2)}</span><span class="muted" style="font-size:12px">${cl.subs.map((s) => esc(s.reason)).join(' · ')}</span></li>`).join('')
  const hits = c.guarded.hits.map((h) => {
    const counted = c.guarded.counted.includes(h.family)
    return `<div class="callout ${counted ? 'trap' : 'info'}" style="margin-top:8px"><div class="row"><span class="chip ${counted ? 'red' : ''}">${esc(KEYWORDS[h.family]!.label)}</span><span class="k">${counted ? 'corroborated · counted' : 'uncorroborated · weight 0'}</span><span class="spacer"></span><span class="muted" style="font-size:12px">${esc(h.author)} · ${fmtDate(h.writtenOn)}</span></div><div class="quote" style="margin-top:6px">“${esc(h.excerpt)}”</div></div>`
  }).join('')
  const champs = ch.guarded.kept.map((k) => `<tr><td><div>${who(k.name)}</div><div class="meta" style="padding-left:28px">${esc(k.title)}</div></td><td><div class="row"><div class="bar" style="width:70px"><i style="width:${k.score}%"></i></div><span class="num">${k.score}</span></div></td><td style="white-space:nowrap">${k.sources.map((s) => `<span class="chip ${s === 'roster' ? 'grey' : ''}">${s}</span>`).join(' ')}</td><td style="font-size:12px" class="muted"><div class="two" title="${esc(k.evidence.join(' · '))}">${esc(k.evidence.slice(1).join(' · ') || 'roster only')}</div></td></tr>`).join('')
  const dropped = ch.guarded.dropped.map((d) => `<li><span class="name" style="width:120px;flex:none">${esc(d.name)}</span><span class="num muted" style="width:96px;flex:none">${d.mentions} mentions</span><span class="bad-text">${esc(d.why)}</span></li>`).join('')
  const naive = ch.naive.slice(0, 4).map((n, i) => `<li><span class="num muted" style="width:16px">${i + 1}</span><span class="name" style="flex:1">${esc(n.name)}</span><span class="num muted">${n.mentions} mentions</span></li>`).join('')
  const body = `
<div class="row" style="margin:-8px 0 16px;gap:4px"><span class="seg"><span>Overview</span><span>Activation</span><span class="on">Risk and champions</span><span>Meetings</span><span>Notes</span></span></div>
<div class="grid g2">
<div class="card"><div class="row"><h2>Churn risk</h2><span class="spacer"></span><span class="chip ${zc(c.guarded.zone)}">${c.guarded.zone}</span></div><div class="sub">Sigmoid of five head weights over four cells. Keyword families count only when two people wrote them on two days.</div>
<div class="row" style="align-items:flex-end;gap:24px"><div><div class="big">${c.guarded.headline.toFixed(2)}</div><div class="muted" style="font-size:12px">last week ${c.before.headline.toFixed(2)} ${delta(Number(c.guarded.headline.toFixed(2)) - Number(c.before.headline.toFixed(2)), 2)}</div></div>${gauge(c.guarded.headline)}</div>
<ul class="list" style="margin-top:12px">${cells}</ul></div>
<div class="card"><h2>What moved the keyword-only headline</h2><div class="sub">The same model counting every keyword hit, on the same day</div>
<div class="grid g2" style="margin-bottom:4px"><div class="callout trap"><div class="k">Every hit counts</div><div class="big">${c.naive.headline.toFixed(2)}</div><div class="muted" style="font-size:12px">${c.before.headline.toFixed(2)} → ${c.naive.headline.toFixed(2)}, ${c.before.zone} → ${c.naive.zone}, on one note</div></div>
<div class="callout guard"><div class="k">Corroborated only</div><div class="big">${c.guarded.headline.toFixed(2)}</div><div class="muted" style="font-size:12px">hit shown as evidence, weight 0</div></div></div>
${hits}
<div class="muted" style="font-size:12px;margin-top:10px">Backtest on ${c.backtest.n} labelled snapshots: AUC ${c.backtest.aucNaive.toFixed(3)} counting every hit, ${c.backtest.aucGuarded.toFixed(3)} corroborated only.</div></div>
</div>
<div class="grid g21"><div class="card flush"><div class="card-h"><h2>Champions</h2><span class="muted">verified contacts, ranked; each row shows what nominated it</span></div>
<table><thead><tr><th>Contact</th><th>Score</th><th>Sources</th><th>Evidence</th></tr></thead><tbody>${champs}</tbody></table>
<div style="padding:12px 20px;border-top:1px solid var(--border)"><b>Dropped from call mentions</b><ul class="list" style="margin-top:4px">${dropped}</ul></div></div>
<div class="card" style="align-self:start"><h2>Names mentioned most on calls</h2><div class="sub">The old champion list: call mentions, unfiltered</div><ul class="list">${naive}</ul>
<div class="callout trap" style="margin-top:12px;font-size:12px">Our own CSM, the customer’s audit partner and a first name that fits two contacts.</div></div></div>`
  return shell({ title: acct.name, active: 'Accounts', heading: acct.name, sub: `${acct.phase} · ERP integration · owner ${esc(acct.owner)} · renews ${fmtDate(acct.renewal_date)}, 2026 · ${acct.seats_active} of ${acct.seats_total} seats active`,
    actions: '<span class="btn">Open in CRM</span><span class="btn">Log a note</span><span class="btn primary">Plan next step</span>', body })
}

async function backtestPage(db: Db): Promise<string> {
  const c = await churnStory(db)
  const bt = c.backtest
  const labels = bt.deciles.map((d) => `${d.lo.toFixed(1)}–${(d.lo + 0.2).toFixed(1)}`)
  const rate = (x: { n: number; churned: number }) => (x.n ? Math.round((100 * x.churned) / x.n) : 0)
  const tbl = bt.deciles.map((d, i) => `<tr><td>${labels[i]}</td><td class="r">${d.naive.n}</td><td class="r">${rate(d.naive)}%</td><td class="r">${d.guarded.n}</td><td class="r">${rate(d.guarded)}%</td></tr>`).join('')
  const body = `<div class="grid g4">
<div class="card kpi"><div class="label">Labelled snapshots</div><div class="value">${bt.n}</div><div class="foot">${bt.churned} churned within a year</div></div>
<div class="card kpi"><div class="label">AUC · every keyword hit</div><div class="value">${bt.aucNaive.toFixed(3)}</div><div class="foot">chance a churned snapshot outscores a renewed one</div></div>
<div class="card kpi"><div class="label">AUC · corroborated hits only</div><div class="value">${bt.aucGuarded.toFixed(3)}</div><div class="foot">${delta(bt.aucGuarded - bt.aucNaive, 3)} against every hit</div></div>
<div class="card kpi"><div class="label">Zone moved by a single note</div><div class="value">${bt.moved}</div><div class="foot">snapshots; ${bt.movedChurned} of them churned</div></div></div>
<div class="grid g2"><div class="card"><h2>Churn rate by headline band</h2><div class="sub">Share of snapshots in each band that churned. Left bars: every hit counts. Right bars: corroborated only.</div>
${bars({ labels: labels.flatMap((l) => [l, '']), values: bt.deciles.flatMap((d) => [rate(d.naive), rate(d.guarded)]), colors: bt.deciles.flatMap(() => ['var(--citron)', 'var(--olive)']), w: 510, h: 230, max: 100, suffix: '%' })}</div>
<div class="card flush"><div class="card-h"><h2>Bands</h2><span class="muted">head weights: bias −2.2, adoption 2.4, engagement 1.4, users 1.8, feedback 2.0</span></div>
<table><thead><tr><th>Headline</th><th class="r">Every hit · n</th><th class="r">churned</th><th class="r">Corroborated · n</th><th class="r">churned</th></tr></thead><tbody>${tbl}</tbody></table></div></div>
<div class="card flush"><div class="card-h"><h2>Snapshots whose zone one note decided</h2><span class="muted">every hit counted against corroborated hits only</span></div>
<table><thead><tr><th>Snapshot</th><th>Every hit</th><th>Corroborated</th><th>The note</th><th>Outcome</th></tr></thead><tbody>${bt.movedRows.map((m) => {
    const h = m.naive.hits.find((x) => m.guarded.uncorroborated.includes(x.family))
    const z = (r: { headline: number; zone: string }) => `<span class="chip ${r.zone === 'yellow' ? 'amber' : r.zone}">${r.headline.toFixed(2)} ${r.zone}</span>`
    return `<tr><td class="mono">#${String(m.id).padStart(3, '0')}</td><td>${z(m.naive)}</td><td>${z(m.guarded)}</td><td class="quote" style="font-size:12px">${h ? `“${esc(h.excerpt)}”` : ''}</td><td>${m.churned ? '<span class="chip red">churned</span>' : '<span class="chip green">renewed</span>'}</td></tr>`
  }).join('')}</tbody></table></div>`
  return shell({ title: 'Churn backtest', active: 'Backtests', heading: 'Churn model backtest', sub: 'Scored against past snapshots with known outcomes · synthetic history', actions: '<span class="btn">Weights</span><span class="btn primary">Run backtest</span>', body })
}

async function botPage(db: Db): Promise<string> {
  const b = await botStory(db as pg.Pool)
  let t = 0
  const time = () => { const m = 9 * 60 + 12 + t++ * 2; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} AM` }
  const msg = (name: string, isApp: boolean, inner: string) => `<div class="msg">${isApp ? '<span class="av bot">A</span>' : avatar(name, 'av')}<div class="body"><div class="meta"><b>${esc(name)}</b>${isApp ? '<span class="app-tag">APP</span>' : ''}<span class="t">${time()}</span></div>${inner}</div></div>`
  const ch = (cs: Array<{ role: string; person: string }>) => `<ul>${cs.map((c) => `<li><b>${c.role}</b> → ${esc(c.person)}</li>`).join('')}</ul>`
  const html = b.events.map((e) => {
    if (e.kind === 'user') return msg(e.who, false, `<div>${esc(e.text).replace('@acme-bot', '<span class="mention">@acme-bot</span>')}</div>`)
    if (e.kind === 'bot') return msg('acme-bot', true, e.proposal
      ? `<div>Here is what I will change. <b>Nothing has changed yet.</b></div><div class="attach"><div><b>${e.proposal.id}</b> · ${esc(e.proposal.account)}</div>${ch(e.proposal.changes)}<div class="muted mono">list ${e.proposal.hash} · expires tomorrow · only the requester can confirm</div><div class="btns"><span class="btn sm primary">Confirm</span><span class="btn sm">Cancel</span></div></div>`
      : `<div>${esc(e.text.replace(/^\(question\) /, ''))}</div><div class="muted" style="font-size:11px">routed as a question · read-only</div>`)
    if (e.kind === 'relay') return msg('Request form relay', true, `<div>${esc(e.text)}</div><div class="attach grey">${ch(e.changes)}</div>`)
    if (e.kind === 'click') return `<div class="day">${esc(e.who)} pressed Confirm on ${e.proposalId}${e.where ? ` from a copy pasted into ${esc(e.where)}` : ''}</div>`
    return msg('acme-bot', true, `<div class="attach ${e.ok ? 'green' : 'red'}"><b>${e.ok ? 'Done' : 'Not applied'}</b> · ${esc(e.text)}</div>`)
  }).join('')
  const ledger = b.proposals.map((p) => `<tr><td class="mono">${p.proposal_id}</td><td>${p.changes.length}</td><td><span class="chip ${p.status === 'applied' ? 'green' : p.status === 'refused' ? 'red' : 'grey'}">${p.status}</span></td></tr>`).join('')
  const body = `<div class="grid g21"><div class="chat"><div class="chat-h"># cs-assignments <span class="muted" style="font-weight:400">· 14 members</span></div><div class="day">Today</div>${html}<div style="height:12px"></div></div>
<div class="stack"><div class="card"><h2>What the confirm handler applies</h2><div class="sub">Same request, same relayed confirm, two handlers</div>
<div class="grid g2" style="margin:0"><div class="callout trap"><div class="k">Applies the message's list</div><div class="big">${b.naiveCount}</div><div class="muted" style="font-size:12px">assignments written for a 1-change request</div></div>
<div class="callout guard"><div class="k">Applies the stored proposal</div><div class="big">${b.guardedCount}</div><div class="muted" style="font-size:12px">the change that was shown and confirmed</div></div></div></div>
<div class="card flush"><div class="card-h"><h2>Proposal ledger</h2></div><table><thead><tr><th>Proposal</th><th>Changes</th><th>Status</th></tr></thead><tbody>${ledger}</tbody></table></div>
<div class="card flush"><div class="card-h"><h2>Assignments now</h2><span class="muted">${esc(b.assignments[0]?.account ?? '')}</span></div><table><thead><tr><th>Role</th><th>Person</th><th>From</th></tr></thead><tbody>${b.assignments.map((a) => `<tr><td>${a.role}</td><td>${who(a.person)}</td><td class="mono">${a.proposal_id}</td></tr>`).join('')}</tbody></table></div>
<div class="card"><h2>Routing</h2><div class="sub">A question is answered read-only; anything else is parsed as a command and only proposed.</div><ul class="list"><li><span class="chip grey">question</span><span>ends in “?”, or starts with who, what, how, show…</span></li><li><span class="chip">command</span><span>“assign &lt;account&gt;, &lt;name&gt; &lt;role&gt;, …”</span></li><li><span class="chip red">refused</span><span>unknown or ambiguous account or name, or a person named twice for one role</span></li></ul></div>
<div class="card"><h2>Rules the server checks</h2><ul class="list"><li>Confirm names a proposal id; the list comes from the server's row.</li><li>A confirm carrying a different list is refused and closes the proposal.</li><li>Pending, unexpired, confirmed by the person who asked, in the thread it was proposed in.</li><li>The reply lists the rows written, and any change that was already true.</li><li>Applied once: the row is locked, then marked applied.</li></ul></div></div></div>`
  return shell({ title: 'Bot activity', active: 'Bot activity', heading: 'Bot activity', sub: 'Assignments asked for in chat · rendered from the bot’s own handlers', actions: '<span class="btn">Audit log</span>', body })
}

export async function render(db: Db): Promise<string[]> {
  mkdirSync(OUT, { recursive: true })
  const pages: Array<[string, (db: Db) => Promise<string>]> = [
    ['activation.html', activationPage], ['status-report.html', statusPage], ['segments.html', segmentsPage],
    ['account.html', accountPage], ['backtest.html', backtestPage], ['bot.html', botPage],
  ]
  for (const [f, fn] of pages) writeFileSync(new URL(f, OUT), await fn(db))
  return pages.map(([f]) => f)
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const db = connect()
  console.log((await render(db)).join('\n'))
  await db.end()
}
