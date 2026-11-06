const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16])
export const fmt = (v, digits = 0) => (v == null ? '—' : v.toFixed(digits))
export const fmtIn = (v) => (v == null ? '—' : v < 0.005 && v > 0 ? '<0.01' : v.toFixed(2))
/** Axis tick: 0.10 -> "0.1", 20 -> "20". */
export const fmtTick = (v) => String(+v.toFixed(2))
