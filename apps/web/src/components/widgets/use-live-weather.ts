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
 */

import { useEffect, useState } from 'react';
import { fetchWeather, getWMO } from './WidgetRenderer';

export interface LiveWeatherResult {
  temp: number;
  high: number;
  low: number;
  condition: string;
  icon: string;
  locationName: string;
  unit: '°F' | '°C';
  loading: boolean;
  source: 'live' | 'override' | 'default';
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
  const location = (config?.location || config?.zipCode || '').trim();
  const isCelsius = ['celsius', 'metric', 'c'].includes(String(config?.units || '').toLowerCase());
  const unit: '°F' | '°C' = isCelsius ? '°C' : '°F';
  const [weather, setWeather] = useState<any>(null);
  const [loading, setLoading] = useState(!!location);

  useEffect(() => {
    if (!location) { setLoading(false); setWeather(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchWeather(location, isCelsius).then((data) => {
      if (cancelled) return;
      setWeather(data);
      setLoading(false);
    });
    // Refresh every 15 minutes (matches the legacy widget cadence).
    const t = setInterval(() => {
      fetchWeather(location, isCelsius).then((data) => {
        if (!cancelled) setWeather(data);
      });
    }, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [location, isCelsius]);

  // Resolve each field. Operator's explicit override wins over live;
  // live wins over hard defaults. Source flag tells the variant
  // whether to show a "demo data" indicator if it wants to.
  const overrideTemp = (config?.tempF ?? config?.staticTemp);
  const liveTemp = weather?.temp;
  const temp = overrideTemp != null && overrideTemp !== ''
    ? Number(overrideTemp)
    : (liveTemp != null ? liveTemp : 72);

  const overrideHigh = config?.high;
  const high = overrideHigh != null && overrideHigh !== ''
    ? Number(overrideHigh)
    : (weather?.high ?? temp);

  const overrideLow = config?.low;
  const low = overrideLow != null && overrideLow !== ''
    ? Number(overrideLow)
    : (weather?.low ?? temp);

  const overrideCondition = (config?.condition || config?.staticDesc || '').trim();
  let condition = overrideCondition || (weather?.weatherCode != null ? getWMO(weather.weatherCode).label : 'Sunny');

  const overrideIcon = (config?.staticIcon || '').trim();
  const icon = overrideIcon || emojiForCode(weather?.weatherCode);

  const locationName = weather?.locationName || location || '';

  let source: 'live' | 'override' | 'default' = 'default';
  if (overrideTemp != null && overrideTemp !== '') source = 'override';
  else if (weather) source = 'live';

  return { temp, high, low, condition, icon, locationName, unit, loading, source };
}
