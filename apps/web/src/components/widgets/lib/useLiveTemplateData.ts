"use client";

/**
 * useLiveTemplateData — shared hook for templates that show live
 * date/time/weather instead of teacher-typed strings.
 *
 * Modeled on `AnimatedWelcomeWidget.tsx` (the canonical implementation).
 * Extracted so every MS-pack template (Arcade, Atlas, Fieldnotes,
 * Greenhouse, Homeroom, Paper, Playlist, Studio × landscape+portrait)
 * can drop in a live clock + weather without re-implementing the
 * three-tier ZIP→IP→fallback fetch chain.
 *
 * Returns:
 *   - `now: Date` — refreshes every 30s while `live` is true
 *   - `weather: { tempF, wmoCode } | null` — null until first
 *     successful fetch; updates every 15 minutes; falls back to the
 *     `weatherOverride` config if any tier fails
 *
 * Usage in a widget:
 *   const { now, weather } = useLiveTemplateData({
 *     live, weatherLocation: cfg.weatherLocation,
 *     weatherUnits: cfg.weatherUnits, weatherOverride: cfg.weatherTemp,
 *   });
 *   const tempLabel = weather ? `${weather.tempF}°` : (cfg.weatherTemp ?? '—');
 *   const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(now);
 *   const time12 = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
 *
 * Why a hook (not direct useEffect inline):
 *   - Eliminates 16 copies of the same fetch chain (one per MS widget).
 *   - One place to fix when the upstream API rate-limits or changes.
 *   - Thumbnail-mode short-circuit (`if (!live) return null`) is centralized.
 */

import { useEffect, useState } from 'react';

export interface LiveWeather {
  /** Rounded temp in °F (we always normalize to °F for display, regardless of weatherUnits). */
  tempF: number;
  /** Open-Meteo WMO code, see https://open-meteo.com/en/docs */
  wmoCode: number;
}

export interface UseLiveTemplateDataOpts {
  /** Pass `live` from the parent widget — false in gallery thumbs, true in player + preview. */
  live?: boolean;
  /** Optional ZIP / "country zip" string. Empty → IP geolocation. */
  weatherLocation?: string;
  /** "metric" → °C, otherwise °F. */
  weatherUnits?: string;
  /** If set, skip weather fetch entirely. Caller will render this string instead. */
  weatherOverride?: string;
}

export interface UseLiveTemplateDataResult {
  now: Date;
  weather: LiveWeather | null;
}

export function useLiveTemplateData(opts: UseLiveTemplateDataOpts): UseLiveTemplateDataResult {
  const { live, weatherLocation, weatherUnits, weatherOverride } = opts;
  const isLive = !!live;
  const [now, setNow] = useState<Date>(() => new Date());
  const [weather, setWeather] = useState<LiveWeather | null>(null);

  // Live clock — re-render every 30s. Skipped in thumbnail mode so the
  // 60-tile /templates gallery doesn't burn 60 setIntervals.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isLive]);

  // Live weather — three-tier resolution:
  //   1. weatherLocation set → ZIP-code lookup via zippopotam.us
  //   2. weatherLocation empty → IP geolocation via ipapi.co
  //   3. Both fail → null (caller falls back to `weatherOverride` or default)
  useEffect(() => {
    if (!isLive) return;
    if (weatherOverride) return; // Caller is providing a fixed temp.
    let cancelled = false;
    const isCelsius = weatherUnits === 'metric';

    const resolveCoords = async (): Promise<{ lat: number; lng: number } | null> => {
      const zip = (weatherLocation || '').trim();
      if (zip) {
        try {
          const m = zip.match(/^([a-z]{2})\s+(\S+)/i);
          const country = m ? m[1].toLowerCase() : 'us';
          const code = m ? m[2] : zip;
          const r = await fetch(`https://api.zippopotam.us/${country}/${encodeURIComponent(code)}`);
          if (r.ok) {
            const j = await r.json();
            const p = j?.places?.[0];
            const lat = parseFloat(p?.latitude); const lng = parseFloat(p?.longitude);
            if (isFinite(lat) && isFinite(lng)) return { lat, lng };
          }
        } catch { /* fall through */ }
      }
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (r.ok) {
          const j = await r.json();
          const lat = parseFloat(j?.latitude); const lng = parseFloat(j?.longitude);
          if (isFinite(lat) && isFinite(lng)) return { lat, lng };
        }
      } catch { /* noop */ }
      return null;
    };

    const fetchWx = async () => {
      const coords = await resolveCoords();
      if (cancelled || !coords) return;
      try {
        const tempUnit = isCelsius ? 'celsius' : 'fahrenheit';
        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}` +
          `&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`
        );
        if (!wxRes.ok) return;
        const wx = await wxRes.json();
        const tempVal = wx?.current?.temperature_2m;
        const code = wx?.current?.weather_code;
        if (cancelled || tempVal == null || code == null) return;
        const tempRound = Math.round(tempVal);
        const tempF = isCelsius ? Math.round(tempRound * 9/5 + 32) : tempRound;
        setWeather({ tempF, wmoCode: code });
      } catch { /* falls back to override / default */ }
    };
    fetchWx();
    const id = setInterval(fetchWx, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isLive, weatherLocation, weatherUnits, weatherOverride]);

  return { now, weather };
}

/**
 * Convenience formatters — every MS widget needs the same handful.
 * Centralizing here so we don't have 16 copies of `new Intl.DateTimeFormat(...)`.
 */
export const fmt = {
  /** "TUE APR 21" — short weekday + month + day, ALL-CAPS for displays. */
  shortDateUpper: (d: Date) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      .format(d).toUpperCase(),
  /** "Tuesday" */
  weekdayLong: (d: Date) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d),
  /** "TUESDAY" */
  weekdayLongUpper: (d: Date) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d).toUpperCase(),
  /** "April 21" */
  monthDay: (d: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(d),
  /** "Apr 21, 2026" */
  shortDate: (d: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d),
  /** "7:53 AM" — 12-hour with AM/PM. */
  time12: (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
  /** "7:53" — 12-hour without AM/PM, for displays that show AM/PM separately. */
  time12NoSuffix: (d: Date) => {
    const s = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return s.replace(/\s?(AM|PM)$/i, '');
  },
  /** "AM" / "PM" */
  amPm: (d: Date) => (d.getHours() >= 12 ? 'PM' : 'AM'),
  /** "07:53" — 24-hour. */
  time24: (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
};
