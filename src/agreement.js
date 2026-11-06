// Pure helpers that turn HRRR run-by-hour cells (from iem.pointAgreement) into agreement counts
// and a plain-language summary.

import { MODERATE_INDEX, PRECIP_INDEX } from './iem.js'

/** 0 = no precipitation, 1 = light, 2 = moderate or heavier. */
export const level = (idx) => (idx >= MODERATE_INDEX ? 2 : idx >= PRECIP_INDEX ? 1 : 0)

/** Per hour: how many runs show precipitation (k), how many have data (n), and how many are moderate+. */
export function columnCounts(cells, radius) {
  const hours = cells[0]?.length ?? 0
  return Array.from({ length: hours }, (_, h) => {
    let k = 0, n = 0, moderate = 0, pending = 0
    for (const row of cells) {
      const c = row[h]
      if (c.status === 'pending') pending++
      if (c.status !== 'ok') continue
      n++
      const lv = level(c[radius])
      if (lv >= 1) k++
      if (lv === 2) moderate++
    }
    return { k, n, moderate, pending }
  })
}

/** Classify an hour: runs agree on precip, agree on dry, are split, or too few runs to say. */
export function classify({ k, n }) {
  if (n < 3) return 'limited'
  const f = k / n
  if (f >= 0.8) return 'wet'
  if (f <= 0.2) return 'dry'
  return 'split'
}

/** Group consecutive hours with the same class. */
function spans(cols) {
  const out = []
  cols.forEach((c, i) => {
    const cls = classify(c)
    const last = out.at(-1)
    if (last && last.cls === cls) {
      last.to = i
      last.cols.push(c)
    } else out.push({ cls, from: i, to: i, cols: [c] })
  })
  return out
}

const range = (cols) => {
  const ks = cols.map((c) => c.k)
  const ns = cols.map((c) => c.n)
  const lo = Math.min(...ks), hi = Math.max(...ks), n = Math.max(...ns)
  return `${lo === hi ? lo : `${lo}–${hi}`} of ${n} runs`
}

/**
 * Sentences describing agreement. `hourLabel(i)` formats the start of hour i; spans are described
 * as start–end where end is the hour after the last one in the span.
 */
export function summarize(cells, radius, hours, hourLabel) {
  const cols = columnCounts(cells, radius)
  const groups = spans(cols)
  const when = (g) => `${hourLabel(g.from)}–${hourLabel(g.to + 1)}`
  const lines = []

  const wet = groups.filter((g) => g.cls === 'wet')
  const split = groups.filter((g) => g.cls === 'split')
  const limited = groups.filter((g) => g.cls === 'limited')

  if (wet.length) lines.push({ tone: 'high', text: `Runs agree on precipitation ${wet.map((g) => `${when(g)} (${range(g.cols)})`).join(', ')}.` })
  if (split.length) lines.push({ tone: 'low', text: `Runs disagree ${split.map((g) => `${when(g)} (${range(g.cols)})`).join(', ')}.` })
  if (!wet.length && !split.length && groups.some((g) => g.cls === 'dry')) {
    const dry = groups.filter((g) => g.cls === 'dry')
    lines.push({ tone: 'high', text: `Runs agree it stays dry ${when({ from: dry[0].from, to: dry.at(-1).to })}.` })
  }
  if (limited.length && limited.at(-1).to === cols.length - 1 && limited.at(-1).from > 0) {
    lines.push({ tone: 'note', text: `Fewer than 3 runs reach past ${hourLabel(limited.at(-1).from)}, so later hours are not rated.` })
  }

  // Trend: compare the 3 newest runs with the 3 oldest over hours all six cover.
  if (cells.length >= 6) {
    let newer = 0, older = 0, shared = 0
    for (let h = 0; h < hours.length; h++) {
      if (!cells.every((row) => row[h].status === 'ok')) continue
      shared++
      cells.forEach((row, r) => {
        if (level(row[h][radius]) >= 1) r < 3 ? newer++ : older++
      })
    }
    const diff = newer - older
    if (shared >= 3 && Math.abs(diff) >= Math.max(2, shared * 0.5)) {
      lines.push({ tone: 'note', text: `Newer runs are trending ${diff > 0 ? 'wetter' : 'drier'} than older ones.` })
    }
  }
  return lines
}
