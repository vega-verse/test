import { useEffect, useMemo, useState } from 'react'
import { RADII, pointAgreement } from './iem.js'
import { columnCounts, level, summarize } from './agreement.js'

const RADIUS_LABEL = { point: 'At your location', nearby: 'Nearby' }
const km = (m) => `${m / 1000} km`

/** HRRR run-by-hour grid: does each recent run show precipitation here, hour by hour? */
export default function ModelAgreement({ lat, lon, timeZone }) {
  const [radius, setRadius] = useState('point')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setData(null)
    setError(null)
    setSel(null)
    pointAgreement(lat, lon, { signal: ctrl.signal, onProgress: setData }).catch((e) => {
      if (e.name !== 'AbortError') setError(e.message)
    })
    return () => ctrl.abort()
  }, [lat, lon])

  const fmts = useMemo(
    () => ({
      hour: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }),
      full: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric' }),
      day: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }),
      h23: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }),
    }),
    [timeZone],
  )

  if (error) return <p className="meta">Model agreement unavailable: {error}</p>
  if (!data) return <p className="meta">Loading recent HRRR runs…</p>

  const { hours, runs, cells } = data
  const cols = columnCounts(cells, radius)
  const loading = cols.some((c) => c.pending > 0)
  const hourLabel = (i) => fmts.hour.format(hours[0] + i * 3_600_000)
  const lines = loading ? [] : summarize(cells, radius, hours, hourLabel)
  const selCol = sel != null ? cols[sel] : null

  return (
    <div className="agree viz-card">
      <div className="agree-head">
        <div className="seg" role="radiogroup" aria-label="Area to check">
          {Object.keys(RADII).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={radius === r} className={radius === r ? 'on' : ''} onClick={() => setRadius(r)}>
              {RADIUS_LABEL[r]} <span className="seg-sub">{km(RADII[r])}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="agree-summary" aria-live="polite">
        {loading ? (
          <span className="hint">Reading {cells.length} model runs…</span>
        ) : (
          lines.map((l, i) => (
            <p key={i} className={`tone-${l.tone}`}>
              <span className="tone-tag">{{ high: 'Agree', low: 'Uncertain', note: 'Note' }[l.tone]}</span> {l.text}
            </p>
          ))
        )}
      </div>

      <div className="agree-scroll">
        <div className="agree-grid" style={{ gridTemplateColumns: `4.2rem repeat(${hours.length}, minmax(14px, 1fr))` }}>
          <div className="ag-corner" />
          {hours.map((h, i) => {
            const hr = parseInt(fmts.h23.format(h), 10) % 24
            return (
              <div key={h} className={`ag-hour${hr === 0 ? ' day' : ''}`}>
                {i % 3 === 0 ? (hr === 0 ? fmts.day.format(h) : fmts.hour.format(h).replace(' ', ' ')) : ''}
              </div>
            )
          })}

          {runs.map((r, ri) => (
            <Row key={r} label={`${fmts.hour.format(r)} run`} newest={ri === 0}>
              {cells[ri].map((c, hi) => (
                <button
                  key={hi}
                  type="button"
                  className={`ag-cell${sel === hi ? ' sel' : ''}`}
                  onClick={() => setSel(sel === hi ? null : hi)}
                  aria-label={cellLabel(c, radius, fmts.full.format(hours[hi]), `${fmts.hour.format(r)} run`)}
                >
                  <Mark cell={c} radius={radius} />
                </button>
              ))}
            </Row>
          ))}

          <div className="ag-label ag-total">Total</div>
          {cols.map((c, hi) => (
            <button
              key={hi}
              type="button"
              className={`ag-cell ag-count${sel === hi ? ' sel' : ''}${c.n < 3 ? ' few' : ''}`}
              onClick={() => setSel(sel === hi ? null : hi)}
              aria-label={`${fmts.full.format(hours[hi])}: ${c.k} of ${c.n} runs show precipitation`}
            >
              {c.pending ? '' : c.n ? c.k : '–'}
            </button>
          ))}
        </div>
      </div>

      <div className="agree-foot">
        {selCol ? (
          <span>
            <strong>{fmts.full.format(hours[sel])}:</strong>{' '}
            {selCol.n ? `${selCol.k} of ${selCol.n} runs show precipitation ${radius === 'point' ? 'at your location' : 'within 10 km'}${selCol.moderate ? ` (${selCol.moderate} moderate or heavier)` : ''}.` : 'No runs cover this hour yet.'}
          </span>
        ) : (
          <span className="legend-row">
            <span><i className="mk mk0" /> none</span>
            <span><i className="mk mk1" /> light</span>
            <span><i className="mk mk2" /> moderate+</span>
            <span><i className="mk mkx">–</i> no data</span>
            <span className="hint">Tap a column for details.</span>
          </span>
        )}
      </div>
      <p className="viz-foot">
        NOAA HRRR model, last {runs.length} hourly runs (newest on top), via Iowa Environmental Mesonet. Precipitation = simulated radar ≥ 15 dBZ; moderate+ ≥ 35 dBZ.
      </p>
    </div>
  )
}

function Row({ label, newest, children }) {
  return (
    <>
      <div className="ag-label">
        {label}
        {newest && <span className="ag-new">newest</span>}
      </div>
      {children}
    </>
  )
}

function Mark({ cell, radius }) {
  if (cell.status === 'pending') return <i className="mk mkp" />
  if (cell.status !== 'ok') return <i className="mk mkx">–</i>
  return <i className={`mk mk${level(cell[radius])}`} />
}

function cellLabel(c, radius, when, run) {
  if (c.status === 'pending') return `${run}, ${when}: loading`
  if (c.status === 'not-covered') return `${run}, ${when}: beyond this run`
  if (c.status === 'missing') return `${run}, ${when}: not available`
  return `${run}, ${when}: ${['no precipitation', 'light precipitation', 'moderate or heavier precipitation'][level(c[radius])]}`
}
