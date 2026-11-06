import { useEffect, useMemo, useRef, useState } from 'react'
import { compass, fmt, fmtIn, fmtTick } from './format.js'
import { maxWithIndex } from './timeseries.js'

// Layout (px). One SVG, three stacked panels sharing an x-axis and a crosshair.
const PAD_L = 40
const PAD_R = 14
const L = {
  pop: { title: 14, top: 26, bot: 86 },
  qpf: { title: 116, top: 128, bot: 196 },
  wind: { title: 226, top: 238, bot: 338 },
  arrows: 356,
  xLabels: 384,
  height: 396,
}

/** Round up to 1/2/2.5/5 x 10^k. */
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v - 1e-9)
}

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Contiguous non-null runs, so a missing hour breaks the line instead of bridging it. */
function runs(vals) {
  const out = []
  let cur = null
  vals.forEach((v, i) => {
    if (v == null) return (cur = null)
    if (!cur) out.push((cur = []))
    cur.push(i)
  })
  return out
}

const linePath = (vals, x, y) =>
  runs(vals).map((r) => r.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join('')).join('')

const areaPath = (vals, x, y, base) =>
  runs(vals)
    .map((r) => `M${x(r[0]).toFixed(1)},${base}` + r.map((i) => `L${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join('') + `L${x(r.at(-1)).toFixed(1)},${base}Z`)
    .join('')

/** Column with a 4px rounded top and a square base. */
function columnPath(x0, w, yTop, base) {
  const r = Math.min(4, w / 2, base - yTop)
  const x1 = x0 + w
  return `M${x0},${base}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x1 - r}Q${x1},${yTop} ${x1},${yTop + r}V${base}Z`
}

export default function ForecastCharts({ rows, timeZone }) {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const width = useWidth(wrapRef)
  const [idx, setIdx] = useState(null)

  const fmts = useMemo(
    () => ({
      hour: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }),
      day: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }),
      full: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric' }),
      h23: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }),
    }),
    [timeZone],
  )

  const n = rows.length
  const bw = Math.max(0, width - PAD_L - PAD_R) / n
  const xc = (i) => PAD_L + (i + 0.5) * bw
  const scale = ({ top, bot }, max) => (v) => bot - (v / max) * (bot - top)

  const pop = rows.map((r) => r.pop)
  const qpf = rows.map((r) => r.qpf)
  const wind = rows.map((r) => r.wind)
  const gust = rows.map((r) => r.gust)

  const popPeak = maxWithIndex(pop)
  const qpfTotal = qpf.reduce((a, v) => a + (v ?? 0), 0)
  const qpfMax = niceCeil(Math.max(0.1, ...qpf.map((v) => v ?? 0)))
  const gustPeak = maxWithIndex(gust)
  // 15% headroom so the peak-gust label sits inside the plot; whole tens keep the mid tick an integer.
  const windMax = Math.ceil((Math.max(10, ...wind.map((v) => v ?? 0), ...gust.map((v) => v ?? 0)) * 1.15) / 10) * 10

  const yPop = scale(L.pop, 100)
  const yQpf = scale(L.qpf, qpfMax)
  const yWind = scale(L.wind, windMax)

  const localHour = rows.map((r) => parseInt(fmts.h23.format(r.t), 10) % 24)
  const labelEvery = bw * 3 >= 44 ? 3 : 6
  const arrowEvery = bw >= 20 ? 1 : bw >= 11 ? 2 : 3
  const colW = Math.max(1, Math.min(24, bw - 2))

  const pick = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect()
    const i = Math.floor((clientX - rect.left - PAD_L) / bw)
    setIdx(Math.min(n - 1, Math.max(0, i)))
  }
  const onKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (step) setIdx((i) => Math.min(n - 1, Math.max(0, (i ?? -1) + step)))
    else if (e.key === 'Home') setIdx(0)
    else if (e.key === 'End') setIdx(n - 1)
    else if (e.key === 'Escape') setIdx(null)
    else return
    e.preventDefault()
  }

  const yTicks = (panel, max, y, label) =>
    [0, max / 2, max].map((v, k) => (
      <g key={k}>
        <line x1={PAD_L} x2={width - PAD_R} y1={y(v)} y2={y(v)} className={k ? 'grid' : 'axis'} />
        <text x={PAD_L - 6} y={y(v)} className="tick" textAnchor="end" dominantBaseline="middle">
          {label(v)}
        </text>
      </g>
    ))

  const hover = idx != null ? rows[idx] : null

  return (
    <div className="viz-root viz-card" ref={wrapRef}>
      <div className="viz-readout" aria-live="polite">
        {hover ? (
          <>
            <strong>{fmts.full.format(hover.t)}</strong>
            <span><b>{fmt(hover.pop)}%</b> chance</span>
            <span><b>{fmtIn(hover.qpf)} in</b> precip</span>
            <span><b>{fmt(hover.wind)} mph</b> {compass(hover.dir)} wind</span>
            <span><b>{fmt(hover.gust)} mph</b> gusts</span>
          </>
        ) : (
          <span className="hint">Tap or drag across the charts for hourly details.</span>
        )}
      </div>

      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={L.height}
          className="viz-svg"
          tabIndex={0}
          role="group"
          aria-label="Hourly precipitation and wind charts. Use left and right arrow keys to step through hours. The same values are in the hourly table below."
          onPointerDown={(e) => pick(e.clientX)}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setIdx(null)}
          onKeyDown={onKey}
          onBlur={() => setIdx(null)}
        >
          {/* Panel titles; peak/total annotations right-aligned so they never collide with marks. */}
          <text x={0} y={L.pop.title} className="ptitle">Chance of precipitation</text>
          {popPeak && (
            <text x={width - PAD_R} y={L.pop.title} className="pnote" textAnchor="end">
              peak {fmt(popPeak.value)}% · {fmts.full.format(rows[popPeak.index].t)}
            </text>
          )}
          <text x={0} y={L.qpf.title} className="ptitle">Precipitation (in)</text>
          <text x={width - PAD_R} y={L.qpf.title} className="pnote" textAnchor="end">
            total {fmtIn(qpfTotal)} in
          </text>
          <text x={0} y={L.wind.title} className="ptitle">Wind (mph)</text>
          <g transform={`translate(${width - PAD_R - 138},${L.wind.title - 4})`} className="legend">
            <line x1={0} x2={14} className="s1-line" />
            <text x={19} y={4}>Sustained</text>
            <line x1={84} x2={98} className="s2-line" />
            <text x={103} y={4}>Gust</text>
          </g>

          {/* Day boundaries */}
          {localHour.map((h, i) => h === 0 && i > 0 && (
            <line key={`d${i}`} x1={PAD_L + i * bw} x2={PAD_L + i * bw} y1={L.pop.top} y2={L.wind.bot} className="grid" />
          ))}

          {/* Chance of precipitation: line + 10% wash */}
          {yTicks(L.pop, 100, yPop, (v) => `${v}%`)}
          <path d={areaPath(pop, xc, yPop, L.pop.bot)} className="s1-area" />
          <path d={linePath(pop, xc, yPop)} className="s1-line" />

          {/* Precipitation amount: columns */}
          {yTicks(L.qpf, qpfMax, yQpf, fmtTick)}
          {qpfTotal > 0 ? (
            qpf.map((v, i) => v > 0 && (
              <path
                key={i}
                d={columnPath(xc(i) - colW / 2, colW, Math.min(yQpf(v), L.qpf.bot - 2), L.qpf.bot)}
                className={`s1-fill${idx != null && idx !== i ? ' dim' : ''}`}
              />
            ))
          ) : (
            <text x={PAD_L + (width - PAD_L - PAD_R) / 2} y={(L.qpf.top + L.qpf.bot) / 2} className="pnote" textAnchor="middle">
              No measurable precipitation forecast
            </text>
          )}

          {/* Wind: sustained + gust lines */}
          {yTicks(L.wind, windMax, yWind, fmtTick)}
          <path d={linePath(gust, xc, yWind)} className="s2-line" />
          <path d={linePath(wind, xc, yWind)} className="s1-line" />
          {gustPeak && idx == null && (
            <>
              <circle cx={xc(gustPeak.index)} cy={yWind(gustPeak.value)} r={4} className="s2-dot" />
              <text
                x={Math.min(width - PAD_R - 10, Math.max(PAD_L + 10, xc(gustPeak.index)))}
                y={yWind(gustPeak.value) - 9}
                className="dlabel"
                textAnchor="middle"
              >
                {fmt(gustPeak.value)}
              </text>
            </>
          )}

          {/* Wind direction: arrows point where the wind is blowing toward */}
          {rows.map((r, i) => r.dir != null && i % arrowEvery === 0 && (
            <g key={`a${i}`} transform={`translate(${xc(i).toFixed(1)},${L.arrows}) rotate(${r.dir})`} className="arrow">
              <path d="M0,-6L0,6M-3.5,2.5L0,6L3.5,2.5" />
            </g>
          ))}

          {/* X-axis: hours, with the weekday at local midnight */}
          {localHour.map((h, i) => h % labelEvery === 0 && (
            <text key={`x${i}`} x={xc(i)} y={L.xLabels} className={`tick${h === 0 ? ' strong' : ''}`} textAnchor="middle">
              {h === 0 ? fmts.day.format(rows[i].t) : fmts.hour.format(rows[i].t).replace(' ', ' ')}
            </text>
          ))}

          {/* Crosshair + hover dots */}
          {hover && (
            <g pointerEvents="none">
              <line x1={xc(idx)} x2={xc(idx)} y1={L.pop.top} y2={L.wind.bot} className="crosshair" />
              {hover.pop != null && <circle cx={xc(idx)} cy={yPop(hover.pop)} r={4} className="s1-dot" />}
              {hover.gust != null && <circle cx={xc(idx)} cy={yWind(hover.gust)} r={4} className="s2-dot" />}
              {hover.wind != null && <circle cx={xc(idx)} cy={yWind(hover.wind)} r={4} className="s1-dot" />}
            </g>
          )}
        </svg>
      )}
      <p className="viz-foot">Hourly precipitation spreads each NWS forecast block evenly across its hours.</p>
    </div>
  )
}
