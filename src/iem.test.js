import { describe, expect, it } from 'vitest'
import { HOUR, MIN, PRECIP_INDEX, MODERATE_INDEX, buildFrames, hrrrLayer, lonLatToPixel, metersPerPixel, pixelsAround, radarLayer, runCovers, runLengthHours } from './iem.js'
import { classify, columnCounts, level, summarize } from './agreement.js'
import { COLOR_TO_INDEX, dbzToIndex, indexToDbz } from './radarPalette.js'

const T = (s) => Date.parse(s)

describe('layer names', () => {
  it('formats radar and HRRR layer ids like IEM expects', () => {
    expect(radarLayer(T('2026-11-06T18:10:00Z'))).toBe('ridge::USCOMP-N0Q-202611061810')
    expect(hrrrLayer(T('2026-11-06T16:00:00Z'), T('2026-11-06T22:00:00Z'))).toBe('hrrr::REFD-F0360-202611061600')
    expect(hrrrLayer(T('2026-11-06T12:00:00Z'), T('2026-11-08T12:00:00Z'))).toBe('hrrr::REFD-F2880-202611061200')
  })
  it('knows 48 h synoptic runs from 18 h hourly runs', () => {
    expect(runLengthHours(T('2026-11-06T12:00:00Z'))).toBe(48)
    expect(runLengthHours(T('2026-11-06T13:00:00Z'))).toBe(18)
    expect(runCovers(T('2026-11-06T13:00:00Z'), T('2026-11-07T07:00:00Z'))).toBe(true)
    expect(runCovers(T('2026-11-06T13:00:00Z'), T('2026-11-07T08:00:00Z'))).toBe(false)
  })
})

describe('buildFrames', () => {
  const now = T('2026-11-06T18:20:00Z')
  const frames = buildFrames({ radarMs: T('2026-11-06T18:15:00Z'), hrrrInitMs: T('2026-11-06T16:00:00Z') }, now)
  const obs = frames.filter((f) => f.kind === 'observed')
  const fc = frames.filter((f) => f.kind === 'forecast')
  it('has 2 h of observed radar every 10 min ending at the latest scan', () => {
    expect(obs).toHaveLength(13)
    expect(obs[0].t).toBe(T('2026-11-06T16:15:00Z'))
    expect(obs.at(-1).t).toBe(T('2026-11-06T18:15:00Z'))
  })
  it('then forecasts every 15 min for 3 h, hourly after, to the end of the run', () => {
    expect(fc[0].t).toBe(T('2026-11-06T18:30:00Z'))
    expect(fc[1].t - fc[0].t).toBe(15 * MIN)
    const hourly = fc.filter((f) => f.t > now + 3 * HOUR)
    expect(hourly.every((f) => new Date(f.t).getUTCMinutes() === 0)).toBe(true)
    expect(fc.at(-1).t).toBe(T('2026-11-07T10:00:00Z')) // 16Z + 18 h
    expect(new Set(frames.map((f) => f.t)).size).toBe(frames.length)
    expect(frames.every((f, i) => i === 0 || f.t > frames[i - 1].t)).toBe(true)
  })
})

describe('pixel math', () => {
  it('matches standard slippy-map tile numbers', () => {
    const p = lonLatToPixel(47.6062, -122.3321, 5)
    expect([Math.floor(p.x / 256), Math.floor(p.y / 256)]).toEqual([5, 11])
  })
  it('selects a ~1.5 km inner disc inside a 10 km disc', () => {
    const tiles = pixelsAround(39.7456, -97.0892, 7, 10000, 1500)
    const px = tiles.flatMap((t) => t.pixels)
    const mpp = metersPerPixel(39.7456, 7)
    expect(px.length).toBeGreaterThan(Math.PI * (10000 / mpp) ** 2 * 0.85)
    expect(px.length).toBeLessThan(Math.PI * (10000 / mpp) ** 2 * 1.15)
    const inner = px.filter((p) => p.inner).length
    expect(inner).toBeGreaterThanOrEqual(1)
    expect(inner).toBeLessThan(40)
  })
})

describe('palette', () => {
  it('has 256 distinct colors and round-trips dBZ', () => {
    expect(COLOR_TO_INDEX.size).toBe(256)
    expect(COLOR_TO_INDEX.get(0xff0000)).toBe(164)
    expect(indexToDbz(164)).toBe(50)
    expect(dbzToIndex(15)).toBe(PRECIP_INDEX)
    expect(level(PRECIP_INDEX - 1)).toBe(0)
    expect(level(PRECIP_INDEX)).toBe(1)
    expect(level(MODERATE_INDEX)).toBe(2)
  })
})

describe('agreement', () => {
  const ok = (idx) => ({ status: 'ok', point: idx, nearby: idx })
  const W = MODERATE_INDEX, L = PRECIP_INDEX, D = 0
  // 6 runs x 4 hours
  const cells = [
    [ok(D), ok(W), ok(W), ok(D)],
    [ok(D), ok(W), ok(L), ok(D)],
    [ok(D), ok(L), ok(W), ok(D)],
    [ok(D), ok(W), ok(D), ok(D)],
    [ok(D), ok(W), ok(D), { status: 'not-covered' }],
    [ok(D), ok(L), ok(D), { status: 'missing' }],
  ]
  it('counts runs with precipitation per hour, ignoring runs without data', () => {
    const c = columnCounts(cells, 'point')
    expect(c.map((x) => `${x.k}/${x.n}`)).toEqual(['0/6', '6/6', '3/6', '0/4'])
    expect(c[1].moderate).toBe(4)
    expect(c.map(classify)).toEqual(['dry', 'wet', 'split', 'dry'])
    expect(classify({ k: 1, n: 2 })).toBe('limited')
  })
  it('summarizes in plain language', () => {
    const lines = summarize(cells, 'point', [0, 1, 2, 3], (i) => `H${i}`)
    expect(lines.map((l) => l.text)).toEqual([
      'Runs agree on precipitation H1–H2 (6 of 6 runs).',
      'Runs disagree H2–H3 (3 of 6 runs).',
      'Newer runs are trending wetter than older ones.',
    ])
  })
})
