import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchForecast, validateConus } from './nws.js'
import ForecastCharts from './Charts.jsx'
import ModelAgreement from './ModelAgreement.jsx'

// Leaflet is only downloaded when the map tab is opened.
const RadarMap = lazy(() => import('./RadarMap.jsx'))
import { compass, fmt, fmtIn } from './format.js'
import { HOUR, accumulateHourly, hourBuckets, maxWithIndex, periodsInWindow, sampleHourly, sum, toImperial } from './timeseries.js'

const VIEWS = { forecast: 'Forecast', map: 'Radar map' }
const initialView = () => (new URLSearchParams(window.location.search).get('view') === 'map' ? 'map' : 'forecast')

function initialCoords() {
  const q = new URLSearchParams(window.location.search)
  return { lat: q.get('lat') ?? '', lon: q.get('lon') ?? '' }
}

/** Turn raw gridpoint layers into 24 hourly rows plus window totals, in mph / inches. */
function buildForecast(data) {
  const { grid } = data
  const hours = hourBuckets()
  const from = hours[0]
  const to = from + 24 * HOUR
  const imp = (key, series) => series.map((v) => toImperial(grid[key]?.uom, v))

  const qpf = imp('quantitativePrecipitation', accumulateHourly(grid.quantitativePrecipitation, hours))
  const snow = imp('snowfallAmount', accumulateHourly(grid.snowfallAmount, hours))
  const ice = imp('iceAccumulation', accumulateHourly(grid.iceAccumulation, hours))
  const pop = sampleHourly(grid.probabilityOfPrecipitation, hours)
  const thunder = sampleHourly(grid.probabilityOfThunder, hours)
  const wind = imp('windSpeed', sampleHourly(grid.windSpeed, hours))
  const gust = imp('windGust', sampleHourly(grid.windGust, hours))
  const dir = sampleHourly(grid.windDirection, hours)

  const textByHour = new Map(data.hourly.map((p) => [Date.parse(p.startTime), p.shortForecast]))

  const rows = hours.map((t, i) => ({
    t,
    text: textByHour.get(t) ?? '',
    pop: pop[i],
    qpf: qpf[i],
    snow: snow[i],
    ice: ice[i],
    thunder: thunder[i],
    wind: wind[i],
    gust: gust[i],
    dir: dir[i],
  }))

  const qpfPeriods = periodsInWindow(grid.quantitativePrecipitation, from, to).map((p) => ({
    ...p,
    value: toImperial(grid.quantitativePrecipitation.uom, p.value),
  }))

  return {
    rows,
    qpfPeriods,
    totals: {
      qpf: sum(qpf),
      snow: sum(snow),
      ice: sum(ice),
      pop: maxWithIndex(pop),
      thunder: maxWithIndex(thunder),
      wind: maxWithIndex(wind),
      gust: maxWithIndex(gust),
    },
  }
}

function useTheme() {
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'))
  useEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem('theme', theme)
    } catch { /* storage blocked (e.g. private mode): theme just won't persist */ }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [view, setView] = useState(initialView)

  const changeView = (v) => {
    setView(v)
    const url = new URL(window.location.href)
    if (v === 'map') url.searchParams.set('view', 'map')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }
  const [input, setInput] = useState(initialCoords)
  const [state, setState] = useState({ status: 'idle' })
  const abortRef = useRef(null)

  const load = useCallback(async (latStr, lonStr) => {
    const lat = parseFloat(latStr)
    const lon = parseFloat(lonStr)
    const invalid = validateConus(lat, lon)
    if (invalid) return setState({ status: 'error', error: invalid })

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setState({ status: 'loading' })
    const url = new URL(window.location.href)
    url.searchParams.set('lat', lat.toFixed(4))
    url.searchParams.set('lon', lon.toFixed(4))
    window.history.replaceState(null, '', url)

    try {
      const data = await fetchForecast(lat, lon, { signal: ctrl.signal })
      setState({ status: 'ready', data, lat, lon, fetchedAt: Date.now() })
    } catch (e) {
      if (e.name !== 'AbortError') setState({ status: 'error', error: e.message })
    }
  }, [])

  // Load immediately when opened with ?lat=..&lon=.. (bookmarkable links).
  useEffect(() => {
    const { lat, lon } = initialCoords()
    if (lat && lon) load(lat, lon)
  }, [load])

  const useMyLocation = () => {
    if (!navigator.geolocation) return setState({ status: 'error', error: 'Geolocation is not available in this browser.' })
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude.toFixed(4), lon: coords.longitude.toFixed(4) }
        setInput(next)
        load(next.lat, next.lon)
      },
      (err) => setState({ status: 'error', error: `Could not get your location: ${err.message}` }),
    )
  }

  return (
    <main>
      <header>
        <div>
          <h1>24-Hour Precipitation &amp; Wind Forecast</h1>
          <p className="sub">NOAA / National Weather Service gridded forecast for any point in the continental US</p>
        </div>
        <button type="button" className="secondary theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
      </header>

      <form
        className="coords"
        onSubmit={(e) => {
          e.preventDefault()
          load(input.lat, input.lon)
        }}
      >
        <label>
          Latitude
          <input inputMode="decimal" placeholder="39.7456" value={input.lat} onChange={(e) => setInput({ ...input, lat: e.target.value })} />
        </label>
        <label>
          Longitude
          <input inputMode="decimal" placeholder="-97.0892" value={input.lon} onChange={(e) => setInput({ ...input, lon: e.target.value })} />
        </label>
        <button type="submit" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading…' : 'Get forecast'}
        </button>
        <button type="button" className="secondary" onClick={useMyLocation}>
          Use my location
        </button>
      </form>

      <nav className="tabs" role="tablist" aria-label="View">
        {Object.entries(VIEWS).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => changeView(v)}>
            {label}
          </button>
        ))}
      </nav>

      {state.status === 'error' && <p className="error">{state.error}</p>}
      {view === 'forecast' && state.status === 'ready' && <Forecast {...state} onRefresh={() => load(String(state.lat), String(state.lon))} />}
      {view === 'map' && (
        <Suspense fallback={<p className="meta">Loading map…</p>}>
          <RadarMap
            lat={state.status === 'ready' ? state.lat : null}
            lon={state.status === 'ready' ? state.lon : null}
            timeZone={state.status === 'ready' ? state.data.timeZone : undefined}
            theme={theme}
          />
        </Suspense>
      )}

      <footer>
        Data: <a href="https://www.weather.gov/documentation/services-web-api">api.weather.gov</a> (NWS National Digital
        Forecast Database); radar and HRRR model tiles from NOAA via the{' '}
        <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>. Personal-use tool, not an official forecast product.
      </footer>
    </main>
  )
}

export function Forecast({ data, lat, lon, fetchedAt, onRefresh }) {
  const fc = useMemo(() => buildForecast(data), [data])
  const tz = data.timeZone
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric' })
  const fullFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  const at = (best) => (best ? hourFmt.format(fc.rows[best.index].t) : '')

  const updated = Date.parse(data.grid.updateTime)
  const staleHours = (fetchedAt - updated) / HOUR
  const { totals } = fc

  return (
    <section>
      <div className="place">
        <h2>{data.place}</h2>
        <span>
          {lat.toFixed(4)}, {lon.toFixed(4)} · NWS office {data.office} · times in {tz}
        </span>
        <button className="secondary small" onClick={onRefresh}>Refresh</button>
      </div>

      <p className="meta">
        Forecast issued {fullFmt.format(updated)}
        {staleHours > 12 && <strong className="warn"> — over {Math.floor(staleHours)} h old; NWS data may be delayed</strong>}
      </p>

      {data.alerts.length > 0 && (
        <div className="alerts">
          {data.alerts.map((a) => (
            <details key={a.id} className={`alert sev-${(a.severity || '').toLowerCase()}`}>
              <summary>
                <strong>{a.event}</strong> — {a.headline}
              </summary>
              <p>{a.description}</p>
              {a.instruction && <p><em>{a.instruction}</em></p>}
            </details>
          ))}
        </div>
      )}

      <div className="cards">
        <Card label="Total precipitation" value={`${fmtIn(totals.qpf)} in`} />
        <Card label="Peak chance of precip" value={`${fmt(totals.pop?.value)}%`} note={at(totals.pop)} />
        <Card label="Max sustained wind" value={`${fmt(totals.wind?.value)} mph`} note={at(totals.wind)} />
        <Card label="Max gust" value={`${fmt(totals.gust?.value)} mph`} note={at(totals.gust)} />
        {totals.snow > 0 && <Card label="Snowfall" value={`${fmtIn(totals.snow)} in`} />}
        {totals.ice > 0 && <Card label="Ice accumulation" value={`${fmtIn(totals.ice)} in`} />}
        {totals.thunder?.value > 0 && <Card label="Peak chance of thunder" value={`${fmt(totals.thunder.value)}%`} note={at(totals.thunder)} />}
      </div>

      {data.observation && <Observation obs={data.observation} fmt={fullFmt} />}

      <h3>Next 24 hours</h3>
      <ForecastCharts rows={fc.rows} timeZone={tz} />

      <h3>Model agreement</h3>
      <p className="meta">Do the last six runs of NOAA's HRRR model agree on precipitation here? Columns where every run matches mean higher confidence.</p>
      <ModelAgreement lat={lat} lon={lon} timeZone={tz} />

      <h3>Hourly table</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Conditions</th>
              <th>Precip chance</th>
              <th>Precip (in)*</th>
              <th>Wind (mph)</th>
              <th>Gust (mph)</th>
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {fc.rows.map((r) => (
              <tr key={r.t} className={(r.pop ?? 0) >= 50 || (r.gust ?? 0) >= 30 ? 'hi' : ''}>
                <td>{hourFmt.format(r.t)}</td>
                <td className="text">{r.text}</td>
                <td>
                  <div className="pop">
                    <span style={{ width: `${r.pop ?? 0}%` }} />
                    <em>{fmt(r.pop)}%</em>
                  </div>
                </td>
                <td>{fmtIn(r.qpf)}</td>
                <td>{fmt(r.wind)}</td>
                <td>{fmt(r.gust)}</td>
                <td>
                  {r.dir != null && (
                    <>
                      <span className="arrow" style={{ transform: `rotate(${r.dir}deg)` }} title={`From ${r.dir}°`}>↓</span> {compass(r.dir)}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Precipitation by NWS forecast period</h3>
      <p className="meta">
        * NWS issues precipitation amounts in blocks (usually 6 hours). The hourly column spreads each block evenly; these are
        the amounts as issued{fc.qpfPeriods.some((p) => p.partial) ? ', prorated where a block runs past this 24-hour window' : ''}.
      </p>
      <ul className="periods">
        {fc.qpfPeriods.map((p) => (
          <li key={p.start}>
            {hourFmt.format(p.start)} – {hourFmt.format(p.end)}: <strong>{fmtIn(p.value)} in</strong>
            {p.partial && <span className="meta"> (partial)</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Card({ label, value, note }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  )
}

function Observation({ obs, fmt: dateFmt }) {
  const v = (q) => toImperial(q?.unitCode, q?.value)
  const wind = v(obs.windSpeed)
  const gust = v(obs.windGust)
  const precip = v(obs.precipitationLastHour)
  return (
    <p className="obs">
      <strong>Latest observation</strong> at {obs.station.name} ({obs.station.id}), {dateFmt.format(Date.parse(obs.timestamp))}:{' '}
      {obs.textDescription || 'n/a'} · wind {wind == null ? '—' : `${compass(obs.windDirection?.value)} ${wind.toFixed(0)} mph`}
      {gust != null && `, gusting ${gust.toFixed(0)}`} · precip last hour {precip == null ? '—' : `${precip.toFixed(2)} in`}
    </p>
  )
}
