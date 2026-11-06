import { describe, expect, it } from 'vitest'
import { HOUR, accumulateHourly, hourBuckets, parseDuration, periodsInWindow, sampleHourly, toImperial } from './timeseries.js'

const T0 = Date.parse('2026-11-06T12:00:00Z')

describe('parseDuration', () => {
  it('handles hours, days and mixed', () => {
    expect(parseDuration('PT1H')).toBe(HOUR)
    expect(parseDuration('PT6H')).toBe(6 * HOUR)
    expect(parseDuration('P1D')).toBe(24 * HOUR)
    expect(parseDuration('P7DT18H')).toBe((7 * 24 + 18) * HOUR)
    expect(parseDuration('PT30M')).toBe(HOUR / 2)
  })
  it('rejects garbage', () => {
    expect(() => parseDuration('6 hours')).toThrow()
  })
})

describe('hourBuckets', () => {
  it('starts at the top of the current hour', () => {
    const hrs = hourBuckets(T0 + 25 * 60_000)
    expect(hrs).toHaveLength(24)
    expect(hrs[0]).toBe(T0)
    expect(hrs[23]).toBe(T0 + 23 * HOUR)
  })
})

describe('sampleHourly', () => {
  it('carries a value across every hour of its period', () => {
    const layer = { values: [
      { validTime: '2026-11-06T12:00:00+00:00/PT2H', value: 10 },
      { validTime: '2026-11-06T14:00:00+00:00/PT1H', value: 20 },
    ] }
    expect(sampleHourly(layer, hourBuckets(T0, 4))).toEqual([10, 10, 20, null])
  })
})

describe('accumulateHourly', () => {
  it('spreads a 6-hour amount evenly and preserves the total', () => {
    const layer = { values: [{ validTime: '2026-11-06T12:00:00+00:00/PT6H', value: 6 }] }
    const out = accumulateHourly(layer, hourBuckets(T0, 8))
    expect(out.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1])
    expect(out.slice(6)).toEqual([null, null])
  })
  it('splits periods that straddle the window start', () => {
    const layer = { values: [{ validTime: '2026-11-06T10:00:00+00:00/PT4H', value: 8 }] }
    expect(accumulateHourly(layer, hourBuckets(T0, 2))).toEqual([2, 2])
  })
})

describe('periodsInWindow', () => {
  it('clips periods and prorates the amount', () => {
    const layer = { values: [{ validTime: '2026-11-06T09:00:00+00:00/PT6H', value: 6 }] }
    expect(periodsInWindow(layer, T0, T0 + 24 * HOUR)).toEqual([{ start: T0, end: T0 + 3 * HOUR, value: 3, partial: true }])
  })
})

describe('toImperial', () => {
  it('converts NWS units', () => {
    expect(toImperial('wmoUnit:mm', 25.4)).toBeCloseTo(1)
    expect(toImperial('wmoUnit:km_h-1', 100)).toBeCloseTo(62.1371)
    expect(toImperial('wmoUnit:percent', 40)).toBe(40)
    expect(toImperial('wmoUnit:mm', null)).toBeNull()
  })
})
