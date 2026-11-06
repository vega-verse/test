// Helpers for NWS gridpoint layers: { uom, values: [{ validTime: "<ISO start>/<ISO duration>", value }] }

export const HOUR = 3600_000

export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso)
  if (!m) throw new Error(`Unsupported ISO 8601 duration: ${iso}`)
  const [, d = 0, h = 0, min = 0, s = 0] = m
  return (+d * 86400 + +h * 3600 + +min * 60 + +s) * 1000
}

export function parseValidTime(validTime) {
  const [startStr, dur] = validTime.split('/')
  const start = Date.parse(startStr)
  return { start, end: start + parseDuration(dur) }
}

function intervals(layer) {
  if (!layer?.values) return []
  return layer.values.map((v) => ({ ...parseValidTime(v.validTime), value: v.value }))
}

/** 24 (or n) hourly bucket start times, beginning at the top of the current hour. */
export function hourBuckets(now = Date.now(), n = 24) {
  const first = Math.floor(now / HOUR) * HOUR
  return Array.from({ length: n }, (_, i) => first + i * HOUR)
}

/** For instantaneous quantities (wind, probability): value in effect at each hour's start. */
export function sampleHourly(layer, hours) {
  const iv = intervals(layer)
  return hours.map((t) => {
    const hit = iv.find((i) => t >= i.start && t < i.end)
    return hit ? hit.value : null
  })
}

/**
 * For accumulated quantities (precip, snow, ice): each hour gets the share of every
 * overlapping period's amount, proportional to overlap (i.e. amounts are spread evenly
 * across their period). Returns null for hours with no data coverage.
 */
export function accumulateHourly(layer, hours) {
  const iv = intervals(layer)
  return hours.map((t) => {
    const end = t + HOUR
    let sum = 0
    let covered = false
    for (const i of iv) {
      const overlap = Math.min(end, i.end) - Math.max(t, i.start)
      if (overlap > 0 && i.value != null) {
        sum += (i.value * overlap) / (i.end - i.start)
        covered = true
      }
    }
    return covered ? sum : null
  })
}

/** Native forecast periods clipped to [from, to), with the clipped share of the amount. */
export function periodsInWindow(layer, from, to) {
  return intervals(layer)
    .filter((i) => i.end > from && i.start < to && i.value != null)
    .map((i) => {
      const s = Math.max(i.start, from)
      const e = Math.min(i.end, to)
      return { start: s, end: e, value: (i.value * (e - s)) / (i.end - i.start), partial: s !== i.start || e !== i.end }
    })
}

const CONVERT = {
  'wmoUnit:km_h-1': (v) => v * 0.621371, // -> mph
  'wmoUnit:m_s-1': (v) => v * 2.236936, // -> mph
  'wmoUnit:kn': (v) => v * 1.150779, // -> mph
  'wmoUnit:mm': (v) => v / 25.4, // -> in
  'wmoUnit:m': (v) => v * 39.3701, // -> in
}

/** Convert NWS metric values to mph / inches. Other units pass through unchanged. */
export function toImperial(uom, v) {
  if (v == null) return null
  const f = CONVERT[uom]
  return f ? f(v) : v
}

export const sum = (xs) => xs.reduce((a, x) => a + (x ?? 0), 0)

/** Max of non-null values with its index, or null if none. */
export function maxWithIndex(xs) {
  let best = null
  xs.forEach((x, i) => {
    if (x != null && (best == null || x > best.value)) best = { value: x, index: i }
  })
  return best
}
