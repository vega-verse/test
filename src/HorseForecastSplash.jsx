import { useEffect, useMemo, useRef, useState } from 'react'
import './HorseForecastSplash.css'

/**
 * HorseForecastSplash: a startup animation where a horse sniffs the air,
 * thinks it over, then calls rain or shine.
 *
 * Props
 *   appName     string                 shown under the scene
 *   prediction  "rain" | "sun"         optional; random if omitted
 *   onFinish    (outcome) => void      called when it ends (tap / Esc also skips)
 */
export default function HorseForecastSplash({ appName = 'My App', prediction, onFinish }) {
  const outcome = useMemo(() => prediction ?? (Math.random() < 0.5 ? 'rain' : 'sun'), [prediction])
  const [phase, setPhase] = useState('intro')
  const finished = useRef(false)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  const finish = () => {
    if (finished.current) return
    finished.current = true
    setPhase('exit')
    setTimeout(() => onFinishRef.current?.(outcome), 600)
  }

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const steps = reduced
      ? [['reveal', 0], ['done', 2200]]
      : [['sniff', 1200], ['think', 2800], ['reveal', 4400], ['done', 6900]]
    const timers = steps.map(([p, t]) => setTimeout(() => (p === 'done' ? finish() : setPhase(p)), t))
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const drops = useMemo(
    () =>
      Array.from({ length: 40 }, () => {
        const dur = 0.7 + Math.random() * 0.4
        return {
          x: Math.random() * 430,
          y: -20 + Math.random() * 60,
          len: 9 + Math.random() * 7,
          dur,
          delay: -Math.random() * dur,
        }
      }),
    [],
  )

  const revealed = phase === 'reveal' || phase === 'exit'
  const captions = {
    intro: 'Checking the sky…',
    sniff: 'Sniffing the wind…',
    think: 'Consulting the herd…',
    reveal: outcome === 'rain' ? "Rain's coming. Blankets on!" : 'Clear skies. Good day to ride!',
  }
  const caption = captions[phase] ?? captions.reveal

  return (
    <div
      className={`hfs-root hfs-${phase} ${revealed ? 'hfs-' + outcome : ''}`}
      onClick={finish}
      role="status"
      aria-label={`${appName} is loading. ${caption}`}
    >
      <div className="hfs-layer hfs-layer-rain" />
      <div className="hfs-layer hfs-layer-sun" />

      <svg className="hfs-scene" viewBox="0 0 400 300" aria-hidden="true">
        {/* Sun */}
        <g className="hfs-sunball">
          <g className="hfs-rays" stroke="#ffc533" strokeWidth="3" strokeLinecap="round">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4
              return (
                <line key={i}
                  x1={80 + Math.cos(a) * 25} y1={55 + Math.sin(a) * 25}
                  x2={80 + Math.cos(a) * 33} y2={55 + Math.sin(a) * 33} />
              )
            })}
          </g>
          <circle cx="80" cy="55" r="19" fill="#ffd84a" />
        </g>

        {/* Clouds */}
        <g className="hfs-cloud-move">
          <g className="hfs-cloud-in">
            <g className="hfs-cloud-fill">
              <circle cx="60" cy="66" r="16" /><circle cx="80" cy="58" r="20" />
              <circle cx="101" cy="66" r="15" /><rect x="46" y="62" width="68" height="19" rx="9.5" />
            </g>
          </g>
        </g>
        <g className="hfs-cloud-move m2">
          <g className="hfs-cloud-in d2">
            <g className="hfs-cloud-fill">
              <circle cx="172" cy="42" r="13" /><circle cx="190" cy="34" r="17" />
              <circle cx="208" cy="42" r="12" /><rect x="161" y="39" width="58" height="15" rx="7.5" />
            </g>
          </g>
        </g>
        <g className="hfs-cloud-move m3">
          <g className="hfs-cloud-in d3">
            <g className="hfs-cloud-fill">
              <circle cx="118" cy="104" r="9" /><circle cx="131" cy="98" r="12" />
              <circle cx="143" cy="104" r="8" /><rect x="110" y="101" width="40" height="11" rx="5.5" />
            </g>
          </g>
        </g>

        {/* Hills */}
        <path className="hfs-hill" d="M0,232 Q110,205 220,228 T400,222 L400,300 L0,300 Z" fill="#9ccc74" />
        <path className="hfs-hill" d="M0,250 Q200,236 400,252 L400,300 L0,300 Z" fill="#7fb35a" />

        {/* Rain */}
        <g className="hfs-rainset" stroke="#e3eef6" strokeWidth="2" strokeLinecap="round">
          {drops.map((d, i) => (
            <line key={i} className="hfs-drop"
              x1={d.x} y1={d.y} x2={d.x - 3} y2={d.y + d.len}
              style={{ animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s` }} />
          ))}
        </g>

        {/* Horse */}
        <ellipse cx="186" cy="252" rx="82" ry="6" fill="rgba(0,0,0,.15)" />
        <g className="hfs-horse">
          <g className="hfs-tail">
            <path d="M122,152 Q96,160 98,198 Q100,214 90,226 Q112,216 113,196 Q115,172 128,160 Z" fill="#3b2416" />
          </g>
          {/* far legs */}
          <rect x="236" y="182" width="12" height="64" rx="5" fill="#6f4622" />
          <rect x="142" y="182" width="12" height="64" rx="5" fill="#6f4622" />
          <rect x="235.5" y="242" width="13" height="9" rx="2" fill="#2a2a2a" />
          <rect x="141.5" y="242" width="13" height="9" rx="2" fill="#2a2a2a" />
          {/* body */}
          <path d="M120,150 Q125,128 165,130 L225,132 Q255,135 252,165 Q250,195 215,198 L150,198 Q118,196 117,172 Z" fill="#8b5a2b" />
          {/* near legs */}
          <rect x="220" y="184" width="12" height="62" rx="5" fill="#8b5a2b" />
          <rect x="126" y="184" width="12" height="62" rx="5" fill="#8b5a2b" />
          <rect x="219.5" y="242" width="13" height="9" rx="2" fill="#2a2a2a" />
          <rect x="125.5" y="242" width="13" height="9" rx="2" fill="#2a2a2a" />

          {/* neck + head */}
          <g className="hfs-neck">
            <path className="hfs-ear e2" d="M250,86 L250,67 L258,84 Z" fill="#6f4622" />
            <path d="M214,146 L244,94 Q256,80 270,90 L262,150 Q254,170 230,164 Z" fill="#8b5a2b" />
            <path d="M244,98 Q248,78 268,80 L306,106 Q318,114 312,126 Q306,133 294,129 L262,116 Q246,110 244,98 Z" fill="#8b5a2b" />
            <path d="M262,85 L301,108 L297,113 L259,90 Z" fill="#f3e9dc" />
            <path className="hfs-ear e1" d="M256,84 L258,64 L266,82 Z" fill="#8b5a2b" />
            <path d="M244,92 Q232,118 214,146 L222,150 Q238,122 252,94 Z" fill="#3b2416" />
            <path d="M252,84 Q262,72 267,86 Z" fill="#3b2416" />
            <g className="hfs-eye">
              <ellipse cx="272" cy="95" rx="3" ry="3.4" fill="#1b120c" />
              <circle cx="273" cy="94" r="0.9" fill="#fff" />
            </g>
            <ellipse cx="306" cy="120" rx="2.6" ry="1.8" fill="#3b2416" />
            <path d="M298,128 Q304,130 310,127" stroke="#3b2416" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle className="hfs-puff p1" cx="317" cy="121" r="4" fill="#fff" />
            <circle className="hfs-puff p2" cx="317" cy="121" r="4" fill="#fff" />
            <circle className="hfs-puff p3" cx="317" cy="121" r="4" fill="#fff" />
          </g>
        </g>

        {/* Thought bubble */}
        <g className="hfs-bubble">
          <circle cx="316" cy="76" r="3.5" fill="#fff" />
          <circle cx="326" cy="63" r="5.5" fill="#fff" />
          <ellipse cx="350" cy="38" rx="40" ry="28" fill="#fff" />
          <g className="hfs-ico hfs-ico-sun">
            <circle cx="350" cy="38" r="9" fill="#ffc533" />
            <g stroke="#ffc533" strokeWidth="2.5" strokeLinecap="round">
              {Array.from({ length: 8 }, (_, i) => {
                const a = (i * Math.PI) / 4
                return (
                  <line key={i}
                    x1={350 + Math.cos(a) * 13} y1={38 + Math.sin(a) * 13}
                    x2={350 + Math.cos(a) * 18} y2={38 + Math.sin(a) * 18} />
                )
              })}
            </g>
          </g>
          <g className="hfs-ico hfs-ico-rain">
            <g fill="#7d8b97">
              <circle cx="342" cy="34" r="8" /><circle cx="354" cy="29" r="10" />
              <circle cx="364" cy="35" r="7" /><rect x="335" y="32" width="36" height="10" rx="5" />
            </g>
            <g stroke="#4a90c8" strokeWidth="2.5" strokeLinecap="round">
              <line x1="342" y1="48" x2="340" y2="54" />
              <line x1="352" y1="48" x2="350" y2="54" />
              <line x1="362" y1="48" x2="360" y2="54" />
            </g>
          </g>
        </g>
      </svg>

      <div className="hfs-text">
        <p key={caption} className="hfs-caption">{caption}</p>
        <p className="hfs-name">{appName}</p>
        <div className="hfs-bar"><i /></div>
      </div>
      <span className="hfs-skip">Tap to skip</span>
    </div>
  )
}
