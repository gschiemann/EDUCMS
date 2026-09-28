"use client";

/**
 * useLiveWeather — shared hook every weather widget variant should
 * call so it gets live data from the operator's location instead of
 * stale config defaults.
 *
 * 2026-05-04 — operator: "the weather widgets are useless as well,
 * i should be able to type a location or zipcode or it should know
 * where i am automatilcally and set it but iuts a bunch a free text
 * fields i can type". The legacy default WeatherWidget already
 * fetches live data, but most THEMED variants (back-to-school,
 * modern-2026, bus-loop, diner-chalkboard, lobby-welcome,
 * middle-school-hall, rainbow-animated, final-chance, v2 pack)
 * silently skipped the API and just used `config.tempF || 72`. So
 * picking any themed weather variant rendered the operator's manual
 * fake values regardless of the location they typed.
 *
 * This hook centralizes the fetch + fallback logic so each variant
 * is one line:
 *   const live = useLiveWeather(config);
 *   <span>{live.temp}{live.unit}</span>
 *
 * Returned shape:
 *   - temp / high / low: numbers (live first, override fallback,
 *     literal default last)
 *   - condition: string label (e.g. "Sunny", "Partly Cloudy")
 *   - icon: emoji (☀️ / ⛅ / 🌧 / ❄️ / etc.)
 *   - locationName: human label of the resolved location
 *   - unit: "°F" or "°C"
 *   - loading: true on first fetch (variants can show a spinner)
 *   - source: 'live' | 'override' | 'default'
 *
 * The condition string is derived from weather.weatherCode via the
 * WMO bucket helper. Override (config.condition) wins over live if
 * set so demo/drill scenarios still work.
 *
 * ── A REAL SCREEN NEVER SHOWS THE SAMPLE (lane B4, 2026-09-27) ──────
 * With no location, or a location whose fetch failed, every themed variant
 * used to paint "72° Sunny" — on the lobby screen, as the current weather.
 * Now, under `RenderSurfaceProvider surface="player"`, a missing reading is
 * a dash (`temp`/`high`/`low` = '—', `condition`/`icon` = '') and
 * `available` is false so a variant can drop its condition art. The builder
 * keeps the 72° sample so a tile is never blank, and says so: `sample` is
 * true there and the variants stamp it SAMPLE. A refresh that fails keeps
 * the last good reading for up to an hour, then lets it go — a reading from
 * this morning is not the weather now.
 */

import { useEffect, useRef, useState } from 'react';
import { fetchWeather, getWMO } from './weather-api';
import { useRenderSurface } from './render-surface';

/** What a missing number reads as on a real screen. */
export const NO_READING = '—';
/** How long a reading survives failed refreshes before the screen lets it go. */
export const WEATHER_HOLD_MS = 60 * 60 * 1000;

export interface LiveWeatherResult {
  /** A number, or '—' on a real screen with no reading. */
  temp: number | string;
  high: number | string;
  low: number | string;
  condition: string;
  icon: string;
  locationName: string;
  unit: '°F' | '°C';
  loading: boolean;
  source: 'live' | 'override' | 'default';
  /** A reading (live or typed) is on show — false only on a real screen with none. */
  available: boolean;
  /** The builder is showing the 72° sample (no location, or its fetch failed). */
  sample: boolean;
}

/** "72°" for a reading, the bare dash for none — never "—°". */
export function withDegrees(t: number | string): string {
  return typeof t === 'number' ? `${t}°` : t;
}

/** Map a WMO code → emoji for variants that want a quick glyph. */
function emojiForCode(code: number | null | undefined): string {
  if (code == null) return '☀️';
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 49) return '🌫️';
  if (code <= 65) return '🌧';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧';
  if (code <= 86) return '❄️';
  if (code <= 99) return '⛈';
  return '☀️';
}

export function useLiveWeather(config: any): LiveWeatherResult {
  const realScreen = useRenderSurface() === 'player';
  const location = (config?.location || config?.zipCode || '').trim();
  const isCelsius = ['celsius', 'metric', 'c'].includes(String(config?.units || '').toLowerCase());
  const unit: '°F' | '°C' = isCelsius ? '°C' : '°F';
  const [weather, setWeather] = useState<any>(null);
  const [loading, setLoading] = useState(!!location);
  // When the reading on show last arrived — a failed refresh keeps it only
  // while it is younger than WEATHER_HOLD_MS.
  const goodAt = useRef(0);

  useEffect(() => {
    // A new location owes nothing to the old one's reading.
    goodAt.current = 0;
    if (!location) { setLoading(false); setWeather(null); return; }
    let cancelled = false;
    setLoading(true);
    const take = (data: Awaited<ReturnType<typeof fetchWeather>>) => {
      if (cancelled) return;
      if (data) {
        goodAt.current = Date.now();
        setWeather(data);
      } else if (Date.now() - goodAt.current > WEATHER_HOLD_MS) {
        setWeather(null);
      }
    };
    fetchWeather(location, isCelsius).then((data) => {
      if (cancelled) return;
      take(data);
      setLoading(false);
    });
    // Refresh every 15 minutes (matches the legacy widget cadence).
    const t = setInterval(() => {
      fetchWeather(location, isCelsius).then(take);
    }, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [location, isCelsius]);

  // Resolve each field. Operator's explicit override wins over live;
  // live wins over the sample, and the sample never reaches a real screen.
  const given = (v: unknown) => v != null && v !== '';
  const overrideTemp = (config?.tempF ?? config?.staticTemp);
  const liveTemp = weather?.temp;
  const hasOverride = given(overrideTemp);
  const available = hasOverride || liveTemp != null;
  const temp: number | string = hasOverride
    ? Number(overrideTemp)
    : (liveTemp != null ? liveTemp : realScreen ? NO_READING : 72);

  const overrideHigh = config?.high;
  const high: number | string = given(overrideHigh)
    ? Number(overrideHigh)
    : (weather?.high ?? temp);

  const overrideLow = config?.low;
  const low: number | string = given(overrideLow)
    ? Number(overrideLow)
    : (weather?.low ?? temp);

  const overrideCondition = (config?.condition || config?.staticDesc || '').trim();
  const condition = overrideCondition
    || (weather?.weatherCode != null ? getWMO(weather.weatherCode).label : realScreen ? '' : 'Sunny');

  // The icon states a condition, so a real screen draws one only for a real
  // weather code (or an icon someone chose) — never the sample's sun.
  const overrideIcon = (config?.staticIcon || '').trim();
  const icon = overrideIcon
    || (weather?.weatherCode != null || !realScreen ? emojiForCode(weather?.weatherCode) : '');

  const locationName = weather?.locationName || location || '';

  let source: 'live' | 'override' | 'default' = 'default';
  if (hasOverride) source = 'override';
  else if (weather) source = 'live';

  return {
    temp, high, low, condition, icon, locationName, unit, loading, source,
    available: available || !realScreen,
    sample: !realScreen && !available,
  };
}
