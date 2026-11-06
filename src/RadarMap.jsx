import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { HOUR, MIN, PRECIP_INDEX, RUN_COUNT, buildFrames, fetchLatest, fetchTile, hrrrLayer, indexAt, runCovers, tileTemplate } from './iem.js'
import { dbzToIndex, indexColor } from './radarPalette.js'

const CONUS_CENTER = [39.5, -98.35]
const RADAR_OPACITY = 0.8
const PLAY_MS = 650
const PRELOAD_AHEAD = 4

// Agreement layer colors: one blue, three steps; low agreement recedes toward the basemap.
const AGREE_COLORS = {
  dark: ['#184f95', '#3987e5', '#9ec5f4'],
  light: ['#b7d3f6', '#5598e7', '#1c5cab'],
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

const LEGEND_STOPS = [
  { dbz: 15, label: 'Light' },
  { dbz: 35, label: 'Moderate' },
  { dbz: 55, label: 'Heavy / hail' },
]

// Esri "Canvas" gray basemaps: no API key, dark and light variants, labels as a separate layer
// so they can sit above the radar. (CARTO's free tiles now require an API key.)
function basemap(theme) {
  const t = theme === 'light' ? 'Light' : 'Dark'
  const url = (layer) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${t}_Gray_${layer}/MapServer/tile/{z}/{y}/{x}`
  const opts = { maxNativeZoom: 16, maxZoom: 19 }
  return {
    base: L.tileLayer(url('Base'), {
      ...opts,
      attribution: 'Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    }),
    labels: L.tileLayer(url('Reference'), { ...opts, pane: 'labels' }),
  }
}

/** Canvas layer: for each pixel, how many recent HRRR runs show precipitation at `validMs`. */
function agreementLayer(validMs, runs, colors) {
  const rgb = colors.map(hexRgb)
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('canvas')
      tile.width = tile.height = 256
      const ctrl = new AbortController()
      tile._abort = () => ctrl.abort()
      Promise.all(runs.map((r) => fetchTile(hrrrLayer(r, validMs), coords.z, coords.x, coords.y, ctrl.signal).catch(() => null)))
        .then((datas) => {
          const avail = datas.filter(Boolean)
          const n = avail.length
          if (n) {
            const ctx = tile.getContext('2d')
            const img = ctx.createImageData(256, 256)
            for (let i = 0; i < 65536; i++) {
              let k = 0
              for (const d of avail) if (indexAt(d, i) >= PRECIP_INDEX) k++
              if (!k) continue
              const f = k / n
              const c = rgb[f <= 1 / 3 ? 0 : f <= 2 / 3 ? 1 : 2]
              const p = i * 4
              img.data[p] = c[0]
              img.data[p + 1] = c[1]
              img.data[p + 2] = c[2]
              img.data[p + 3] = 200
            }
            ctx.putImageData(img, 0, 0)
          }
          done(null, tile)
        })
        .catch((e) => done(e, tile))
      return tile
    },
  })
  const layer = new Layer({ pane: 'radar', maxNativeZoom: 8, opacity: 0, updateWhenIdle: true, keepBuffer: 0 })
  layer.on('tileunload', (e) => e.tile._abort?.())
  return layer
}

export default function RadarMap({ lat, lon, theme, timeZone }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const layersRef = useRef(new Map()) // frame key -> Leaflet layer
  const loadedRef = useRef(new Set())

  const [latest, setLatest] = useState(null)
  const [error, setError] = useState(null)
  const [mode, setModeState] = useState(() => (new URLSearchParams(window.location.search).get('layer') === 'agreement' ? 'agreement' : 'radar'))
  const setMode = (m) => {
    setModeState(m)
    const url = new URL(window.location.href)
    if (m === 'agreement') url.searchParams.set('layer', 'agreement')
    else url.searchParams.delete('layer')
    window.history.replaceState(null, '', url)
  }
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [, bump] = useState(0) // re-render when a frame finishes loading

  // ---- data: latest radar scan + HRRR run, refreshed every 5 minutes while visible
  const refresh = useCallback(() => {
    fetchLatest()
      .then((l) => {
        setError(null)
        setLatest((prev) => (prev && prev.radarMs === l.radarMs && prev.hrrrInitMs === l.hrrrInitMs ? prev : l))
      })
      .catch((e) => setError(`Could not reach the radar service (${e.message}).`))
  }, [])
  useEffect(() => {
    refresh()
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), 5 * MIN)
    return () => clearInterval(id)
  }, [refresh])

  const frames = useMemo(() => {
    if (!latest) return []
    const all = buildFrames(latest)
    if (mode === 'radar') return all
    // Agreement: hourly forecast times only (HRRR output is compared hour by hour).
    return all.filter((f) => f.kind === 'forecast' && new Date(f.t).getUTCMinutes() === 0)
  }, [latest, mode])
  const runs = useMemo(() => (latest ? Array.from({ length: RUN_COUNT }, (_, k) => latest.hrrrInitMs - k * HOUR) : []), [latest])
  const nowIdx = mode === 'radar' ? frames.findLastIndex((f) => f.kind === 'observed') : 0
  const frameKey = useCallback((f) => (mode === 'agreement' ? `agree:${f.t}` : f.layer), [mode])

  // Jump to "now" whenever the frame list is rebuilt.
  useEffect(() => {
    setIdx(Math.max(0, nowIdx))
    setPlaying(false)
  }, [frames, nowIdx])

  // ---- map setup (once)
  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true, minZoom: 3, maxZoom: 12 })
    map.createPane('radar').style.zIndex = 350
    const labels = map.createPane('labels')
    labels.style.zIndex = 450
    labels.style.pointerEvents = 'none'
    map.attributionControl.setPrefix(false)
    map.attributionControl.addAttribution('Radar &amp; HRRR: NOAA via <a href="https://mesonet.agron.iastate.edu/">IEM</a>')
    map.setView(CONUS_CENTER, 4)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current.clear()
      loadedRef.current.clear()
    }
  }, [])

  // ---- basemap follows the theme
  useEffect(() => {
    const map = mapRef.current
    const { base, labels } = basemap(theme)
    base.addTo(map)
    labels.addTo(map)
    return () => {
      base.remove()
      labels.remove()
    }
  }, [theme])

  // ---- location pin
  useEffect(() => {
    const map = mapRef.current
    markerRef.current?.remove()
    if (lat == null || lon == null) return
    markerRef.current = L.circleMarker([lat, lon], {
      radius: 7,
      weight: 2,
      color: theme === 'light' ? '#fcfcfb' : '#1a1a19',
      fillColor: theme === 'light' ? '#0b0b0b' : '#f0efec',
      fillOpacity: 1,
      pane: 'labels',
      interactive: false,
    }).addTo(map)
    map.setView([lat, lon], Math.max(map.getZoom(), 7))
  }, [lat, lon, theme])

  // ---- drop all frame layers when the frame set, mode or theme changes
  useEffect(() => {
    const layers = layersRef.current
    const loaded = loadedRef.current
    return () => {
      layers.forEach((l) => l.remove())
      layers.clear()
      loaded.clear()
    }
  }, [frames, theme])

  // ---- show the current frame; preload the next few
  useEffect(() => {
    const map = mapRef.current
    if (!map || !frames.length) return
    const layers = layersRef.current
    const at = Math.min(idx, frames.length - 1) // idx may briefly exceed a just-shortened frame list
    const wanted = new Set()
    // Agreement frames cost RUN_COUNT tiles each, so only preload one ahead there.
    const ahead = mode === 'agreement' ? 1 : PRELOAD_AHEAD
    for (let k = 0; k <= ahead; k++) wanted.add((at + k) % frames.length)
    wanted.forEach((i) => {
      const f = frames[i]
      const key = frameKey(f)
      if (layers.has(key)) return
      const layer =
        mode === 'agreement'
          ? agreementLayer(f.t, runs.filter((r) => runCovers(r, f.t)), AGREE_COLORS[theme === 'light' ? 'light' : 'dark'])
          : L.tileLayer(tileTemplate(f.layer), { pane: 'radar', opacity: 0, maxNativeZoom: f.kind === 'forecast' ? 8 : 10, updateWhenIdle: true, keepBuffer: 0 })
      layer.on('load', () => {
        loadedRef.current.add(key)
        bump((n) => n + 1)
      })
      layers.set(key, layer)
      layer.addTo(map)
    })
    const currentKey = frameKey(frames[at])
    layers.forEach((layer, key) => layer.setOpacity(key === currentKey ? (mode === 'agreement' ? 1 : RADAR_OPACITY) : 0))
    // Keep memory bounded: drop layers far from the current frame.
    if (layers.size > 12) {
      const keep = new Set([...wanted].map((i) => frameKey(frames[i])))
      for (const [key, layer] of layers) {
        if (!keep.has(key)) {
          layer.remove()
          layers.delete(key)
          loadedRef.current.delete(key)
        }
      }
    }
  }, [frames, idx, mode, runs, theme, frameKey])

  // ---- playback: advance only once the next frame has loaded; pause when hidden
  useEffect(() => {
    if (!playing || !frames.length) return
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      setIdx((i) => {
        const next = (i + 1) % frames.length
        return loadedRef.current.has(frameKey(frames[next])) ? next : i
      })
    }, PLAY_MS)
    return () => clearInterval(id)
  }, [playing, frames, frameKey])

  const fmt = useMemo(() => {
    const opts = timeZone ? { timeZone } : {}
    return {
      time: new Intl.DateTimeFormat('en-US', { ...opts, weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      hour: new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric' }),
    }
  }, [timeZone])

  const frame = frames[Math.min(idx, frames.length - 1)]
  const loading = frame && !loadedRef.current.has(frameKey(frame))
  const step = (d) => {
    setPlaying(false)
    setIdx((i) => (i + d + frames.length) % frames.length)
  }
  const rel = frame ? relative(frame.t - Date.now()) : ''
  const nowPct = frames.length > 1 && nowIdx >= 0 ? (nowIdx / (frames.length - 1)) * 100 : 0
  const covering = frame && mode === 'agreement' ? runs.filter((r) => runCovers(r, frame.t)).length : 0

  return (
    <div className="radar">
      <div className="radar-bar">
        <div className="seg" role="radiogroup" aria-label="Map layer">
          <button type="button" role="radio" aria-checked={mode === 'radar'} className={mode === 'radar' ? 'on' : ''} onClick={() => setMode('radar')}>
            Radar
          </button>
          <button type="button" role="radio" aria-checked={mode === 'agreement'} className={mode === 'agreement' ? 'on' : ''} onClick={() => setMode('agreement')}>
            Run agreement
          </button>
        </div>
        {latest && (
          <span className="meta">
            Radar {fmt.time.format(latest.radarMs)} · HRRR run {fmt.hour.format(latest.hrrrInitMs)}
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {lat == null && <p className="meta">Enter a location above to center the map on it.</p>}

      <div className="radar-map-wrap">
        <div ref={elRef} className="radar-map" />
        <Legend mode={mode} theme={theme} />
      </div>

      {frame && (
        <div className="timeline">
          <div className="tl-label" aria-live="polite">
            <strong className={frame.kind}>
              {mode === 'agreement' ? 'Run agreement' : frame.kind === 'observed' ? 'Observed radar' : 'HRRR forecast'}
            </strong>
            <span>{fmt.time.format(frame.t)}</span>
            <span className="rel">{rel}</span>
            {mode === 'agreement' && <span className="rel">{covering} runs</span>}
            {loading && <span className="rel">loading…</span>}
          </div>
          <div className="tl-controls">
            <button type="button" className="secondary icon" onClick={() => step(-1)} aria-label="Previous frame">‹</button>
            <button type="button" className="icon play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="secondary icon" onClick={() => step(1)} aria-label="Next frame">›</button>
            <div className="tl-track">
              <input
                type="range"
                min={0}
                max={frames.length - 1}
                value={idx}
                onChange={(e) => {
                  setPlaying(false)
                  setIdx(+e.target.value)
                }}
                aria-label="Time"
                aria-valuetext={`${fmt.time.format(frame.t)}, ${rel}`}
                style={{ '--now': `${nowPct}%` }}
              />
              {mode === 'radar' && <span className="tl-now" style={{ left: `${nowPct}%` }}>Now</span>}
            </div>
          </div>
          <div className="tl-scale">
            <span>{relative(frames[0].t - Date.now(), 60)}</span>
            <span>{relative(frames.at(-1).t - Date.now(), 60)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** "+3 h 15 min" style offset; `roundTo` minutes (e.g. 60 for whole hours on the scale ends). */
function relative(ms, roundTo = 1) {
  const m = Math.round(ms / MIN / roundTo) * roundTo
  if (Math.abs(m) < 5) return 'now'
  const sign = m < 0 ? '−' : '+'
  const a = Math.abs(m)
  const h = Math.floor(a / 60)
  const mm = a % 60
  return `${sign}${h ? `${h} h` : ''}${h && mm ? ' ' : ''}${mm ? `${mm} min` : ''}`
}

// Legend starts collapsed on phones so it doesn't cover the map.
const wide = () => window.matchMedia('(min-width: 601px)').matches

function Legend({ mode, theme }) {
  if (mode === 'agreement') {
    const c = AGREE_COLORS[theme === 'light' ? 'light' : 'dark']
    return (
      <details className="map-legend" open={wide()}>
        <summary>Legend</summary>
        <div className="agree-legend">
          <span><i style={{ background: c[0] }} /> Few runs</span>
          <span><i style={{ background: c[1] }} /> About half</span>
          <span><i style={{ background: c[2] }} /> Most runs</span>
        </div>
        <p>Share of recent HRRR runs showing precipitation (≥ 15 dBZ).</p>
      </details>
    )
  }
  const lo = dbzToIndex(5)
  const hi = dbzToIndex(75)
  const stops = []
  for (let i = lo; i <= hi; i += 4) stops.push(`${indexColor(i)} ${(((i - lo) / (hi - lo)) * 100).toFixed(1)}%`)
  return (
    <details className="map-legend" open={wide()}>
      <summary>Legend</summary>
      <div className="ramp" style={{ background: `linear-gradient(to right, ${stops.join(',')})` }} />
      <div className="ramp-labels">
        {LEGEND_STOPS.map((s) => (
          <span key={s.dbz} style={{ left: `${((dbzToIndex(s.dbz) - lo) / (hi - lo)) * 100}%` }}>{s.label}</span>
        ))}
      </div>
      <p>Same color scale for observed radar and HRRR forecast.</p>
    </details>
  )
}
