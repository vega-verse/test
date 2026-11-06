// Radar (NEXRAD mosaic) and HRRR simulated-radar tiles from the Iowa Environmental Mesonet (IEM),
// which republishes NOAA data as map tiles. All endpoints send `Access-Control-Allow-Origin: *`.
// Missing data (a run not processed yet, a forecast hour past the run's end) returns HTTP 503.

import { COLOR_TO_INDEX, dbzToIndex } from './radarPalette.js'

const TILE_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0'
const META_BASE = 'https://mesonet.agron.iastate.edu/data/gis/images/4326'

export const MIN = 60_000
export const HOUR = 60 * MIN

/** Reflectivity thresholds for "precipitation" and "moderate or heavier". */
export const PRECIP_DBZ = 15
export const MODERATE_DBZ = 35
export const PRECIP_INDEX = dbzToIndex(PRECIP_DBZ)
export const MODERATE_INDEX = dbzToIndex(MODERATE_DBZ)

/** How many recent HRRR runs to compare. */
export const RUN_COUNT = 6

const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, '') // YYYYMMDDHHMM

export const radarLayer = (validMs) => `ridge::USCOMP-N0Q-${stamp(validMs)}`
export const hrrrLayer = (initMs, validMs) =>
  `hrrr::REFD-F${String(Math.round((validMs - initMs) / MIN)).padStart(4, '0')}-${stamp(initMs)}`
export const tileTemplate = (layer) => `${TILE_BASE}/${layer}/{z}/{x}/{y}.png`
const tileUrl = (layer, z, x, y) => `${TILE_BASE}/${layer}/${z}/${x}/${y}.png`

/** HRRR runs at 00/06/12/18 UTC go out 48 h; the hourly runs in between go 18 h. */
export const runLengthHours = (initMs) => (new Date(initMs).getUTCHours() % 6 === 0 ? 48 : 18)
export const runCovers = (initMs, validMs) => validMs >= initMs && validMs <= initMs + runLengthHours(initMs) * HOUR

/** Latest observed radar time and latest HRRR run, from IEM's metadata files. */
export async function fetchLatest(signal) {
  const get = (path) => fetch(`${META_BASE}/${path}`, { signal, cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`IEM metadata ${r.status}`)
    return r.json()
  })
  const [radar, hrrr] = await Promise.all([get('USCOMP/n0q_0.json'), get('hrrr/refd_0000.json')])
  return { radarMs: Date.parse(radar.meta.valid), hrrrInitMs: Date.parse(hrrr.model_init_utc) }
}

/**
 * Timeline frames: the last 2 h of observed radar every 10 min, then the latest HRRR run every
 * 15 min for the next 3 h and hourly after that, up to the end of the run (max 24 h ahead).
 */
export function buildFrames({ radarMs, hrrrInitMs }, now = Date.now()) {
  const frames = []
  for (let k = 12; k >= 0; k--) {
    const t = radarMs - k * 10 * MIN
    frames.push({ t, kind: 'observed', layer: radarLayer(t) })
  }
  const end = Math.min(hrrrInitMs + runLengthHours(hrrrInitMs) * HOUR, now + 24 * HOUR)
  const fineUntil = now + 3 * HOUR
  let t = Math.floor(radarMs / (15 * MIN)) * 15 * MIN + 15 * MIN
  while (t <= end) {
    frames.push({ t, kind: 'forecast', layer: hrrrLayer(hrrrInitMs, t), initMs: hrrrInitMs })
    // 15-minute steps up to fineUntil, then whole hours.
    const next = t + 15 * MIN
    t = next <= fineUntil ? next : Math.floor(t / HOUR) * HOUR + HOUR
  }
  return frames
}

// ---------- Web-Mercator pixel math ----------

const TILE = 256

export function lonLatToPixel(lat, lon, z) {
  const size = TILE * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  }
}

export const metersPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z

/**
 * Pixels within `radiusM` of a point, grouped by tile. Each pixel is flagged `inner` if it is
 * also within `innerM` (the center pixel always is).
 */
export function pixelsAround(lat, lon, z, radiusM, innerM) {
  const c = lonLatToPixel(lat, lon, z)
  const mpp = metersPerPixel(lat, z)
  const r = radiusM / mpp
  const ri = Math.max(innerM / mpp, Math.SQRT1_2)
  const tiles = new Map()
  for (let py = Math.floor(c.y - r); py <= Math.floor(c.y + r); py++) {
    for (let px = Math.floor(c.x - r); px <= Math.floor(c.x + r); px++) {
      const d = Math.hypot(px + 0.5 - c.x, py + 0.5 - c.y)
      if (d > r) continue
      const tx = Math.floor(px / TILE)
      const ty = Math.floor(py / TILE)
      const key = `${tx}/${ty}`
      if (!tiles.has(key)) tiles.set(key, { tx, ty, pixels: [] })
      tiles.get(key).pixels.push({ i: (py - ty * TILE) * TILE + (px - tx * TILE), inner: d <= ri })
    }
  }
  return [...tiles.values()]
}

// ---------- Tile decoding ----------

let scratch
const nearestCache = new Map()

/** Exact palette lookup, with a nearest-color fallback in case the browser perturbs pixels. */
function colorToIndex(rgb) {
  const hit = COLOR_TO_INDEX.get(rgb)
  if (hit !== undefined) return hit
  if (nearestCache.has(rgb)) return nearestCache.get(rgb)
  const r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255
  let best = 0, bestD = Infinity
  for (const [c, i] of COLOR_TO_INDEX) {
    const d = (r - (c >> 16)) ** 2 + (g - ((c >> 8) & 255)) ** 2 + (b - (c & 255)) ** 2
    if (d < bestD) { bestD = d; best = i }
  }
  nearestCache.set(rgb, best)
  return best
}

/** Draw a tile image into a 256x256 RGBA buffer. */
async function tilePixels(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) return null // 503 = not available
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  scratch ??= Object.assign(document.createElement('canvas'), { width: TILE, height: TILE })
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, TILE, TILE)
  ctx.drawImage(bmp, 0, 0)
  bmp.close?.()
  return ctx.getImageData(0, 0, TILE, TILE).data
}

/** Palette index (0 = no echo) at pixel offset i of an RGBA buffer. */
export function indexAt(data, i) {
  const p = i * 4
  if (data[p + 3] === 0) return 0
  return colorToIndex((data[p] << 16) | (data[p + 1] << 8) | data[p + 2])
}

// Be polite to IEM: at most 6 tile requests in flight.
function limiter(n) {
  let active = 0
  const queue = []
  const pump = () => {
    if (active >= n || !queue.length) return
    active++
    const { fn, resolve, reject } = queue.shift()
    fn().then(resolve, reject).finally(() => { active--; pump() })
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump() })
}
const limit = limiter(6)

/** RGBA buffers for one layer's tile; null if the layer isn't available. */
export const fetchTile = (layer, z, x, y, signal) => limit(() => tilePixels(tileUrl(layer, z, x, y), signal))

// ---------- Run agreement at a point ----------

export const RADII = { point: 1500, nearby: 10000 }
// z7 pixels are ~0.7-1 km across the US: finer than HRRR's 3 km grid, so no model detail is lost.
const POINT_ZOOM = 7

/**
 * For the next `hourCount` hours and the last RUN_COUNT HRRR runs, the strongest reflectivity
 * (palette index) each run forecasts within each radius of the point. Calls onProgress with a
 * fresh snapshot as cells fill in.
 *
 * cell = { status: 'pending' | 'ok' | 'missing' | 'not-covered', point, nearby }
 */
export async function pointAgreement(lat, lon, { signal, onProgress, hourCount = 18, now = Date.now() } = {}) {
  const { hrrrInitMs } = await fetchLatest(signal)
  const firstHour = Math.ceil(now / HOUR) * HOUR
  const hours = Array.from({ length: hourCount }, (_, k) => firstHour + k * HOUR)
  const runs = Array.from({ length: RUN_COUNT }, (_, k) => hrrrInitMs - k * HOUR)
  const tiles = pixelsAround(lat, lon, POINT_ZOOM, RADII.nearby, RADII.point)

  const cells = runs.map((r) => hours.map((h) => ({ status: runCovers(r, h) ? 'pending' : 'not-covered' })))
  const snapshot = () => ({ hours, runs, cells: cells.map((row) => row.map((c) => ({ ...c }))) })
  onProgress?.(snapshot())

  const jobs = []
  runs.forEach((r, ri) => hours.forEach((h, hi) => {
    if (cells[ri][hi].status !== 'pending') return
    jobs.push((async () => {
      const layer = hrrrLayer(r, h)
      let point = 0, nearby = 0
      for (const t of tiles) {
        const data = await fetchTile(layer, POINT_ZOOM, t.tx, t.ty, signal)
        if (!data) {
          cells[ri][hi] = { status: 'missing' }
          onProgress?.(snapshot())
          return
        }
        for (const px of t.pixels) {
          const idx = indexAt(data, px.i)
          if (idx > nearby) nearby = idx
          if (px.inner && idx > point) point = idx
        }
      }
      cells[ri][hi] = { status: 'ok', point, nearby }
      onProgress?.(snapshot())
    })())
  }))
  await Promise.all(jobs)
  return snapshot()
}
