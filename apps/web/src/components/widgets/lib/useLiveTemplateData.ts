"use client";

/**
 * useLiveTemplateData — shared hook for templates that show live
 * date/time/weather instead of teacher-typed strings.
 *
 * Modeled on `AnimatedWelcomeWidget.tsx` (the canonical implementation).
 * Extracted so every MS-pack template (Arcade, Atlas, Fieldnotes,
 * Greenhouse, Homeroom, Paper, Playlist, Studio × landscape+portrait)
 * can drop in a live clock + weather without re-implementing the
 * shared, cached MET Norway current-hour forecast.
 *
 * Returns:
 *   - `now: Date` — refreshes every 30s while `live` is true
 *   - `weather: { tempF, wmoCode } | null` — null until first
 *     successful fetch; updates every 15 minutes; returns null when the source is unavailable
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

import { useEffect, useState } from "react";
import { fetchWeather, getWMO } from "../weather-api";

export interface LiveWeather {
  /** Fahrenheit retained for weather phrase thresholds in older designs. */
  tempF: number;
  temperature: number;
  high: number | null;
  low: number | null;
  condition: string;
  wmoCode: number;
}
export interface UseLiveTemplateDataOpts {
  live?: boolean;
  clock?: boolean;
  weatherLocation?: string;
  weatherUnits?: string;
  /** Explicit entered temperature always wins; no network is needed. */
  weatherOverride?: string;
}
export function useLiveTemplateData(opts: UseLiveTemplateDataOpts) {
  const {
    live,
    clock = true,
    weatherLocation,
    weatherUnits,
    weatherOverride,
  } = opts;
  const [now, setNow] = useState(() => new Date());
  const [held, setHeld] = useState<{ key: string; data: LiveWeather } | null>(
    null,
  );
  const place = String(weatherLocation || "").trim();
  const metric = weatherUnits === "metric";
  const key = `${place}|${metric}`;
  useEffect(() => {
    if (!live || !clock) return;
    const timer = setInterval(() => {
      if (!document.hidden) setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, [live, clock]);
  useEffect(() => {
    setHeld(null);
    if (!live || !place || weatherOverride) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let goodAt = 0;
    const refresh = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(refresh, 60000);
        return;
      }
      const data = await fetchWeather(place, metric);
      if (cancelled) return;
      if (data) {
        goodAt = Date.now();
        setHeld({
          key,
          data: {
            temperature: data.temp,
            tempF: metric ? Math.round((data.temp * 9) / 5 + 32) : data.temp,
            high: data.high,
            low: data.low,
            wmoCode: data.weatherCode,
            condition: getWMO(data.weatherCode).label,
          },
        });
      } else if (Date.now() - goodAt > 3600000) setHeld(null);
      timer = setTimeout(refresh, data ? 900000 : 60000);
    };
    timer = setTimeout(refresh, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [live, place, metric, key, weatherOverride]);
  return {
    now,
    weather: live && !weatherOverride && held?.key === key ? held.data : null,
  };
}

/**
 * Convenience formatters — every MS widget needs the same handful.
 * Centralizing here so we don't have 16 copies of `new Intl.DateTimeFormat(...)`.
 */
export const fmt = {
  /** "TUE APR 21" — short weekday + month + day, ALL-CAPS for displays. */
  shortDateUpper: (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
      .format(d)
      .toUpperCase(),
  /** "Tuesday" */
  weekdayLong: (d: Date) =>
    new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d),
  /** "TUESDAY" */
  weekdayLongUpper: (d: Date) =>
    new Intl.DateTimeFormat("en-US", { weekday: "long" })
      .format(d)
      .toUpperCase(),
  /** "April 21" */
  monthDay: (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(
      d,
    ),
  /** "Apr 21, 2026" */
  shortDate: (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d),
  /** "7:53 AM" — 12-hour with AM/PM. */
  time12: (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  /** "7:53" — 12-hour without AM/PM, for displays that show AM/PM separately. */
  time12NoSuffix: (d: Date) => {
    const s = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return s.replace(/\s?(AM|PM)$/i, "");
  },
  /** "AM" / "PM" */
  amPm: (d: Date) => (d.getHours() >= 12 ? "PM" : "AM"),
  /** "07:53" — 24-hour. */
  time24: (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
};
