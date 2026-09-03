/**
 * OPEN-METEO WEATHER HELPERS — extracted from WidgetRenderer (P1-1, 2026-09-03).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * `getWMO` and `fetchWeather` used to live in `WidgetRenderer.tsx`, and about
 * twenty theme modules plus `use-live-weather.ts` imported them FROM there.
 * That made every theme statically depend on the renderer — a cycle that was
 * invisible while the whole widget catalog compiled into one chunk, and
 * expensive the moment it did not: each lazily-split theme chunk carried an
 * edge back to `WidgetRenderer`, which declares 159 dynamic imports of its
 * own, so the bundler materialised the entire async family set once per
 * importing context instead of once per entry.
 *
 * Nothing about the behaviour changed — the code below is the original block,
 * moved. `WidgetRenderer` re-exports `getWMO` and `fetchWeather` so any
 * existing importer of those names keeps working.
 *
 * ⚠ Do NOT import `WidgetRenderer` from this file, or from a theme. The whole
 * point is that the dependency runs one way: renderer → theme, never back.
 */

import { Cloud, CloudLightning, CloudRain, CloudSnow, Sun, Wind } from 'lucide-react';

/** Weather responses are cached this long before a widget refetches. */
export const WEATHER_CACHE_MS = 15 * 60 * 1000; // 15 minutes

const WMO_MAP: Record<number, { label: string; icon: typeof Sun; gradient: string; iconColor: string; glow: string }> = {
  0:  { label: 'Clear Sky',       icon: Sun,            gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8, #6366f1)', iconColor: '#fbbf24', glow: 'rgba(251,191,36,0.5)' },
  1:  { label: 'Mainly Clear',    icon: Sun,            gradient: 'linear-gradient(135deg, #3b82f6, #2563eb, #6366f1)', iconColor: '#fbbf24', glow: 'rgba(251,191,36,0.4)' },
  2:  { label: 'Partly Cloudy',   icon: Cloud,          gradient: 'linear-gradient(135deg, #6b7280, #4b5563, #6366f1)', iconColor: '#e2e8f0', glow: 'rgba(226,232,240,0.3)' },
  3:  { label: 'Overcast',        icon: Cloud,          gradient: 'linear-gradient(135deg, #64748b, #475569, #334155)', iconColor: '#cbd5e1', glow: 'rgba(203,213,225,0.3)' },
  45: { label: 'Fog',             icon: Wind,           gradient: 'linear-gradient(135deg, #94a3b8, #64748b, #475569)', iconColor: '#e2e8f0', glow: 'rgba(226,232,240,0.3)' },
  48: { label: 'Rime Fog',        icon: Wind,           gradient: 'linear-gradient(135deg, #94a3b8, #64748b, #475569)', iconColor: '#e2e8f0', glow: 'rgba(226,232,240,0.3)' },
  51: { label: 'Light Drizzle',   icon: CloudRain,      gradient: 'linear-gradient(135deg, #475569, #334155, #1e293b)', iconColor: '#93c5fd', glow: 'rgba(147,197,253,0.4)' },
  53: { label: 'Drizzle',         icon: CloudRain,      gradient: 'linear-gradient(135deg, #475569, #334155, #1e293b)', iconColor: '#93c5fd', glow: 'rgba(147,197,253,0.4)' },
  55: { label: 'Dense Drizzle',   icon: CloudRain,      gradient: 'linear-gradient(135deg, #334155, #1e293b, #0f172a)', iconColor: '#60a5fa', glow: 'rgba(96,165,250,0.4)' },
  61: { label: 'Light Rain',      icon: CloudRain,      gradient: 'linear-gradient(135deg, #1e40af, #1e3a8a, #312e81)', iconColor: '#93c5fd', glow: 'rgba(147,197,253,0.4)' },
  63: { label: 'Rain',            icon: CloudRain,      gradient: 'linear-gradient(135deg, #1e3a8a, #312e81, #1e1b4b)', iconColor: '#60a5fa', glow: 'rgba(96,165,250,0.5)' },
  65: { label: 'Heavy Rain',      icon: CloudRain,      gradient: 'linear-gradient(135deg, #0f172a, #1e1b4b, #0c0a09)', iconColor: '#3b82f6', glow: 'rgba(59,130,246,0.5)' },
  71: { label: 'Light Snow',      icon: CloudSnow,      gradient: 'linear-gradient(135deg, #e0e7ff, #c7d2fe, #a5b4fc)', iconColor: '#6366f1', glow: 'rgba(99,102,241,0.3)' },
  73: { label: 'Snow',            icon: CloudSnow,      gradient: 'linear-gradient(135deg, #c7d2fe, #a5b4fc, #818cf8)', iconColor: '#4f46e5', glow: 'rgba(79,70,229,0.4)' },
  75: { label: 'Heavy Snow',      icon: CloudSnow,      gradient: 'linear-gradient(135deg, #a5b4fc, #818cf8, #6366f1)', iconColor: '#312e81', glow: 'rgba(49,46,129,0.4)' },
  80: { label: 'Rain Showers',    icon: CloudRain,      gradient: 'linear-gradient(135deg, #1e40af, #1d4ed8, #2563eb)', iconColor: '#bfdbfe', glow: 'rgba(191,219,254,0.4)' },
  95: { label: 'Thunderstorm',    icon: CloudLightning, gradient: 'linear-gradient(135deg, #1e1b4b, #0f172a, #0c0a09)', iconColor: '#fbbf24', glow: 'rgba(251,191,36,0.6)' },
  96: { label: 'T-Storm + Hail',  icon: CloudLightning, gradient: 'linear-gradient(135deg, #0f172a, #0c0a09, #000000)', iconColor: '#f59e0b', glow: 'rgba(245,158,11,0.6)' },
};

export function getWMO(code: number) {
  // Find the closest known code
  if (WMO_MAP[code]) return WMO_MAP[code];
  const keys = Object.keys(WMO_MAP).map(Number).sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= code) return WMO_MAP[keys[i]];
  }
  return WMO_MAP[0];
}

// Simple in-memory cache so we don't spam the API
const weatherCache: Record<string, { data: any; ts: number }> = {};


export async function fetchWeather(location: string, isCelsius: boolean) {
  const cacheKey = `${location}|${isCelsius}`;
  const cached = weatherCache[cacheKey];
  if (cached && Date.now() - cached.ts < WEATHER_CACHE_MS) return cached.data;

  try {
    // 2026-05-04 — operator: "i should be able to type a location or
    // zipcode". Pre-fix the geocoder only accepted city names — a US
    // zip code like "44024" returned no results, widget fell back to
    // operator-supplied free-text overrides which is what they were
    // complaining about.
    //
    // Now we detect the location TYPE first:
    //   - "lat,lng" pair (e.g. "41.5868,-81.4146" — what the
    //     geolocation auto-detect button writes) → skip geocoding
    //   - 5-digit US zip → Zippopotam.us (free, no auth)
    //   - "City, ST" or other text → Open-Meteo geocoder (city name)
    let latitude: number | null = null;
    let longitude: number | null = null;
    let name = '';
    let admin1 = '';
    const trimmed = location.trim();

    // Lat/lng pair — auto-detect button format. Two numbers separated
    // by comma, optional whitespace.
    const latLngMatch = trimmed.match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (latLngMatch) {
      latitude = parseFloat(latLngMatch[1]);
      longitude = parseFloat(latLngMatch[2]);
      name = 'Current location';
    }

    // 5-digit US zip
    if (latitude == null && /^\d{5}$/.test(trimmed)) {
      try {
        const zipRes = await fetch(`https://api.zippopotam.us/us/${trimmed}`);
        if (zipRes.ok) {
          const zipData = await zipRes.json();
          const place = zipData?.places?.[0];
          if (place) {
            latitude = parseFloat(place.latitude);
            longitude = parseFloat(place.longitude);
            name = place['place name'] || trimmed;
            admin1 = place['state abbreviation'] || '';
          }
        }
      } catch { /* fall through to geocoder */ }
    }

    // Fallback: Open-Meteo city-name geocoder
    if (latitude == null) {
      const cityName = trimmed.replace(/,\s*\w{2,}$/i, '').trim();
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en`);
      const geoData = await geoRes.json();
      if (!geoData.results?.length) return null;
      const r = geoData.results[0];
      latitude = r.latitude;
      longitude = r.longitude;
      name = r.name;
      admin1 = r.admin1 || '';
    }
    if (latitude == null || longitude == null) return null;

    // Step 2: Fetch current weather + daily high/low
    const tempUnit = isCelsius ? 'celsius' : 'fahrenheit';
    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&wind_speed_unit=mph&forecast_days=1`
    );
    const wxData = await wxRes.json();
    // Open-Meteo sometimes returns 200 with an error body or partial shape — guard.
    if (!wxData?.current || !wxData?.daily) return null;

    const result = {
      temp: Math.round(wxData.current.temperature_2m),
      feelsLike: Math.round(wxData.current.apparent_temperature),
      humidity: wxData.current.relative_humidity_2m,
      wind: Math.round(wxData.current.wind_speed_10m ?? 0),
      weatherCode: wxData.current.weather_code,
      high: Math.round(wxData.daily.temperature_2m_max?.[0] ?? wxData.current.temperature_2m),
      low:  Math.round(wxData.daily.temperature_2m_min?.[0] ?? wxData.current.temperature_2m),
      locationName: admin1 ? `${name}, ${admin1}` : name,
    };
    weatherCache[cacheKey] = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    // Silently fall back to config-provided defaults — no console spam in dev
    return null;
  }
}
