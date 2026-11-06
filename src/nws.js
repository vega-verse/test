// Client for the NOAA / National Weather Service API (https://www.weather.gov/documentation/services-web-api).
// The API sends CORS headers, so it can be called straight from the browser.

const BASE = 'https://api.weather.gov'

// Rough bounding box for the contiguous United States.
export const CONUS = { minLat: 24.3, maxLat: 49.5, minLon: -125.0, maxLon: -66.8 }

export function validateConus(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Latitude and longitude must be numbers.'
  if (lat < CONUS.minLat || lat > CONUS.maxLat || lon < CONUS.minLon || lon > CONUS.maxLon) {
    return `That point is outside the continental US (lat ${CONUS.minLat}–${CONUS.maxLat}, lon ${CONUS.minLon}–${CONUS.maxLon}). Western-hemisphere longitudes are negative.`
  }
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The NWS API intermittently returns 5xx; retry those a couple of times.
async function getJson(url, { retries = 2, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/geo+json' }, signal })
    if (res.ok) return res.json()
    if (res.status >= 500 && attempt < retries) {
      await sleep(800 * (attempt + 1))
      continue
    }
    let detail = ''
    try {
      detail = (await res.json()).detail ?? ''
    } catch { /* non-JSON error body */ }
    const err = new Error(`NWS API ${res.status}${detail ? `: ${detail}` : ''}`)
    err.status = res.status
    throw err
  }
}

async function latestObservation(stationsUrl, signal) {
  const stations = await getJson(`${stationsUrl}?limit=1`, { signal })
  const station = stations.features?.[0]
  if (!station) return null
  const id = station.properties.stationIdentifier
  const obs = await getJson(`${BASE}/stations/${id}/observations/latest`, { signal })
  // obs.properties has its own `station` (a URL), so spread it first.
  return { ...obs.properties, station: { id, name: station.properties.name } }
}

/**
 * Fetch everything needed for the forecast. Gridpoint data is required; the hourly
 * text forecast, alerts and latest observation are best-effort extras.
 */
export async function fetchForecast(lat, lon, { signal } = {}) {
  const coord = `${lat.toFixed(4)},${lon.toFixed(4)}`
  let point
  try {
    point = await getJson(`${BASE}/points/${coord}`, { signal })
  } catch (e) {
    if (e.status === 404) throw new Error('NWS has no forecast for that point (it may be over water or outside the US).')
    throw e
  }
  const p = point.properties

  const [grid, hourly, alerts, observation] = await Promise.allSettled([
    getJson(p.forecastGridData, { signal }),
    getJson(p.forecastHourly, { signal }),
    getJson(`${BASE}/alerts/active?point=${coord}`, { signal }),
    latestObservation(p.observationStations, signal),
  ])
  if (grid.status === 'rejected') throw grid.reason

  const rel = p.relativeLocation?.properties
  return {
    place: rel ? `${rel.city}, ${rel.state}` : coord,
    office: p.gridId,
    grid: grid.value.properties,
    gridGeometry: grid.value.geometry,
    timeZone: p.timeZone,
    hourly: hourly.status === 'fulfilled' ? hourly.value.properties.periods : [],
    alerts: alerts.status === 'fulfilled' ? alerts.value.features.map((f) => f.properties) : [],
    observation: observation.status === 'fulfilled' ? observation.value : null,
  }
}
