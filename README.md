# 24-Hour Precipitation & Wind Forecast

A small React app (personal use) that shows the next 24 hours of precipitation and wind
for any latitude/longitude in the continental US, using NOAA / National Weather Service data.

- **Forecast tab:** 24-hour totals, hourly charts (precip chance, amount, wind and gusts),
  alerts, latest observation, an hourly table, and **model agreement**: whether the last six
  HRRR runs show precipitation at your location (1.5 km) or nearby (10 km), hour by hour.
- **Radar map tab:** one timeline from 2 h of observed radar through the latest HRRR forecast
  (out to ~16 h), plus a **run agreement** layer showing where recent HRRR runs agree.

## Data sources (all from [api.weather.gov](https://www.weather.gov/documentation/services-web-api))

| Data | Endpoint | Used for |
| --- | --- | --- |
| Gridpoint forecast (NDFD, ~2.5 km grid) | `/gridpoints/{office}/{x},{y}` | Precip amount (QPF), chance of precip, snow, ice, thunder, wind speed/gust/direction |
| Hourly forecast | `/gridpoints/{office}/{x},{y}/forecast/hourly` | Short text conditions per hour |
| Active alerts | `/alerts/active?point=lat,lon` | Watches, warnings, advisories |
| Latest observation | `/stations/{id}/observations/latest` | Current conditions at the nearest station |

### Radar and model tiles ([Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/), republishing NOAA data)

| Data | Layer | Used for |
| --- | --- | --- |
| NEXRAD composite reflectivity (N0Q), 5-min archive | `ridge::USCOMP-N0Q-YYYYMMDDHHMM` | Observed radar on the map |
| HRRR simulated reflectivity, 15-min steps | `hrrr::REFD-Fmmmm-YYYYMMDDHHMM` | Forecast radar, run agreement |
| Latest scan / latest run metadata | `data/gis/images/4326/{USCOMP/n0q_0,hrrr/refd_0000}.json` | Timeline anchors |

NOAA does not publish HRRR output as map tiles, so IEM's tiles are the browser-friendly route.
Both layers use the same 256-color table (`src/radarPalette.js`, index *i* = *i*×0.5−32 dBZ); every
color is distinct and tiles are not blended, so the app decodes pixels back to exact dBZ to count
which runs show precipitation (≥ 15 dBZ; moderate+ ≥ 35 dBZ). Missing runs/hours return HTTP 503
and are shown as "no data", never as dry.

Basemap: Esri Canvas dark/light gray (no API key).

The gridpoint forecast is the official NWS forecast: forecasters at the local office start from
the National Blend of Models and high-resolution guidance (HRRR, NAM, etc.) and adjust it. It is
the most accurate NOAA forecast that can be fetched directly by a browser; raw model output
(GRIB2 files on NOMADS) would need a server to decode.

**Precipitation amounts** are issued in blocks (usually 6 hours). The hourly table spreads each
block evenly; the "by forecast period" list shows the amounts as issued.

## Use

Enter a latitude and longitude (longitude is negative in the US), or click *Use my location*.
The URL updates to `?lat=..&lon=..`, so you can bookmark a location.

## Develop

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests for the time-series math
npm run build   # production build in dist/
```

## Deploy

`.github/workflows/deploy.yml` builds, tests and publishes to GitHub Pages on every push to `master`.
In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
