/** Small HTML building blocks: the app shell, badges, sparklines and charts as inline SVG. */
import { readFileSync } from 'node:fs'
import type { Zone } from '../activation.ts'

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

const ICONS: Record<string, string> = {
  book: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/>',
  report: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
  segments: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="M14 6h6M4 18h2"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 13h.01M15 13h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
}
const NAV: Array<[string, string, string, string?]> = [
  ['book', 'My book', 'activation.html', '40'],
  ['report', 'Status report', 'status-report.html'],
  ['gauge', 'Activation', 'activation.html'],
  ['segments', 'Segments', 'segments.html'],
  ['account', 'Accounts', 'account.html'],
  ['chart', 'Backtests', 'backtest.html'],
  ['bot', 'Bot activity', 'bot.html'],
]

export function avatar(name: string | null, cls = 'av'): string {
  if (!name) return `<span class="${cls}">?</span>`
  const ini = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('')
  return `<span class="${cls}">${esc(ini)}</span>`
}
export const who = (name: string | null) => (name ? `<span class="who">${avatar(name)}${esc(name)}</span>` : `<span class="chip red">No owner</span>`)

export function shell(o: { title: string; active: string; heading: string; sub: string; actions?: string; body: string }): string {
  const nav = NAV.map(([icon, label, href, count]) =>
    `<div class="nav${label === o.active ? ' on' : ''}"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg>${esc(label)}${count ? `<span class="count">${count}</span>` : ''}</div>`)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"><title>${esc(o.title)} · Acme Solutions</title><style>${CSS}</style></head><body>
<div class="app"><aside class="side">
<div class="brand"><div class="mark"></div><div><b>Acme Solutions</b><span>Customer success</span></div></div>
<div class="nav-h">Workspace</div>${nav.slice(0, 2).join('')}
<div class="nav-h">Insights</div>${nav.slice(2).join('')}
<div class="nav-h">Admin</div><div class="nav"><svg viewBox="0 0 24 24">${ICONS.settings}</svg>Settings</div>
<div class="me">${avatar('Priya Raman')}<div><b style="font-size:12px">Priya Raman</b><div class="muted" style="font-size:11px">CS lead</div></div></div>
</aside><main class="main">
<div class="head"><div><h1>${esc(o.heading)}</h1><p>${o.sub}</p></div><div class="actions">${o.actions ?? ''}</div></div>
${o.body}
</main></div></body></html>`
}

export const zoneClass = (z: Zone | string) => `z-${z}`
export const badge = (score: number | null, zone: Zone) => `<span class="badge ${zoneClass(zone)}">${score === null ? 'N/A' : Math.round(score)}</span>`

export function delta(d: number | null, digits = 1): string {
  if (d === null) return '<span class="delta flat">new</span>'
  const cls = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat'
  return `<span class="delta ${cls}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(digits)}</span>`
}

/** A small line chart. Nulls break the line; the last point gets a dot. */
export function sparkline(values: Array<number | null>, o: { w?: number; h?: number; min?: number; max?: number; color?: string; band?: boolean } = {}): string {
  const w = o.w ?? 96, h = o.h ?? 24, pad = 3
  const nums = values.filter((v): v is number => v !== null)
  if (!nums.length) return `<svg width="${w}" height="${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="var(--border-strong)" stroke-dasharray="3 3"/></svg>`
  // Scaled to the row, but never to less than a 10-point range, so a flat line stays flat and a
  // 14-point drop is plain to see.
  let min = o.min ?? Math.min(...nums), max = o.max ?? Math.max(...nums)
  if (max - min < 10) { const mid = (max + min) / 2; min = mid - 5; max = mid + 5 }
  const span = max - min
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1)
  const y = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / span
  let d = '', open = false
  values.forEach((v, i) => { if (v === null) { open = false; return } d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; open = true })
  const li = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).at(-1)!
  const color = o.color ?? 'var(--olive)'
  const band = o.band ? `<rect x="0" y="${y(70).toFixed(1)}" width="${w}" height="${(y(40) - y(70)).toFixed(1)}" fill="var(--sage)"/>` : ''
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${band}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(li).toFixed(1)}" cy="${y(values[li]!).toFixed(1)}" r="2.4" fill="${color}"/></svg>`
}

/** Vertical bar chart with an optional ghost series (last week) behind each bar. */
export function bars(o: { labels: string[]; values: number[]; ghost?: number[]; colors: string[]; w: number; h: number; max?: number; suffix?: string }): string {
  const { labels, values, w, h } = o
  const top = 16, bottom = 22, left = o.suffix ? 36 : 28
  const max = o.max ?? Math.max(1, ...values, ...(o.ghost ?? []))
  const sfx = o.suffix ?? ''
  const step = (w - left) / labels.length
  const bw = step * 0.56
  const y = (v: number) => top + (h - top - bottom) * (1 - v / max)
  const ticks = [0, Math.ceil(max / 2), max]
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="inherit">`
  for (const t of ticks) s += `<line x1="${left}" x2="${w}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text x="${left - 6}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="var(--muted-fg)">${t}${sfx}</text>`
  labels.forEach((l, i) => {
    const x = left + i * step + (step - bw) / 2
    if (o.ghost) s += `<rect x="${x - 3}" y="${y(o.ghost[i]!)}" width="${bw + 6}" height="${y(0) - y(o.ghost[i]!)}" rx="3" fill="none" stroke="var(--border-strong)" stroke-dasharray="3 2"/>`
    s += `<rect x="${x}" y="${y(values[i]!)}" width="${bw}" height="${y(0) - y(values[i]!)}" rx="3" fill="${o.colors[i]}"/>`
    if (values[i]) s += `<text x="${x + bw / 2}" y="${y(values[i]!) - 4}" font-size="10" font-weight="600" text-anchor="middle" fill="var(--fg-2)">${values[i]}${sfx}</text>`
    s += `<text x="${x + bw / 2}" y="${h - 6}" font-size="10" text-anchor="middle" fill="var(--muted-fg)">${esc(l)}</text>`
  })
  return s + '</svg>'
}

/** Line chart for a few series over the same x labels. */
export function lines(o: { labels: string[]; series: Array<{ values: number[]; color: string; dash?: boolean; name: string }>; w: number; h: number; min: number; max: number }): string {
  const { w, h, labels } = o
  const top = 12, bottom = 22, left = 30, right = 8
  const x = (i: number) => left + (i * (w - left - right)) / (labels.length - 1)
  const y = (v: number) => top + (h - top - bottom) * (1 - (v - o.min) / (o.max - o.min))
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  for (let t = o.min; t <= o.max; t += (o.max - o.min) / 4) s += `<line x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text x="${left - 6}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="var(--muted-fg)">${Math.round(t)}</text>`
  labels.forEach((l, i) => { if (l) s += `<text x="${x(i)}" y="${h - 6}" font-size="10" text-anchor="middle" fill="var(--muted-fg)">${esc(l)}</text>` })
  for (const se of o.series) {
    s += `<path d="${se.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`
    s += `<circle cx="${x(se.values.length - 1)}" cy="${y(se.values.at(-1)!)}" r="3" fill="${se.color}"/>`
  }
  return s + '</svg>'
}

export const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const fmtMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
