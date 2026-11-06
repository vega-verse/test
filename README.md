# 24-Hour Precipitation & Wind Forecast

A small React app (personal use) that shows the next 24 hours of precipitation and wind
for any latitude/longitude in the continental US, using NOAA / National Weather Service data.

## Data sources (all from [api.weather.gov](https://www.weather.gov/documentation/services-web-api))

| Data | Endpoint | Used for |
| --- | --- | --- |
| Gridpoint forecast (NDFD, ~2.5 km grid) | `/gridpoints/{office}/{x},{y}` | Precip amount (QPF), chance of precip, snow, ice, thunder, wind speed/gust/direction |
| Hourly forecast | `/gridpoints/{office}/{x},{y}/forecast/hourly` | Short text conditions per hour |
| Active alerts | `/alerts/active?point=lat,lon` | Watches, warnings, advisories |
| Latest observation | `/stations/{id}/observations/latest` | Current conditions at the nearest station |

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
