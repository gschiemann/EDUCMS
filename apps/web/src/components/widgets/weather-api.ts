/**
 * SHARED WEATHER HELPERS — extracted from WidgetRenderer (P1-1, 2026-09-03).
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

import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Sun,
  Wind,
} from "lucide-react";

/** Weather responses are cached this long before a widget refetches. */
export const WEATHER_CACHE_MS = 15 * 60 * 1000; // 15 minutes

const WMO_MAP: Record<
  number,
  {
    label: string;
    icon: typeof Sun;
    gradient: string;
    iconColor: string;
    glow: string;
  }
> = {
  0: {
    label: "Clear Sky",
    icon: Sun,
    gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8, #6366f1)",
    iconColor: "#fbbf24",
    glow: "rgba(251,191,36,0.5)",
  },
  1: {
    label: "Mainly Clear",
    icon: Sun,
    gradient: "linear-gradient(135deg, #3b82f6, #2563eb, #6366f1)",
    iconColor: "#fbbf24",
    glow: "rgba(251,191,36,0.4)",
  },
  2: {
    label: "Partly Cloudy",
    icon: Cloud,
    gradient: "linear-gradient(135deg, #6b7280, #4b5563, #6366f1)",
    iconColor: "#e2e8f0",
    glow: "rgba(226,232,240,0.3)",
  },
  3: {
    label: "Overcast",
    icon: Cloud,
    gradient: "linear-gradient(135deg, #64748b, #475569, #334155)",
    iconColor: "#cbd5e1",
    glow: "rgba(203,213,225,0.3)",
  },
  45: {
    label: "Fog",
    icon: Wind,
    gradient: "linear-gradient(135deg, #94a3b8, #64748b, #475569)",
    iconColor: "#e2e8f0",
    glow: "rgba(226,232,240,0.3)",
  },
  48: {
    label: "Rime Fog",
    icon: Wind,
    gradient: "linear-gradient(135deg, #94a3b8, #64748b, #475569)",
    iconColor: "#e2e8f0",
    glow: "rgba(226,232,240,0.3)",
  },
  51: {
    label: "Light Drizzle",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #475569, #334155, #1e293b)",
    iconColor: "#93c5fd",
    glow: "rgba(147,197,253,0.4)",
  },
  53: {
    label: "Drizzle",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #475569, #334155, #1e293b)",
    iconColor: "#93c5fd",
    glow: "rgba(147,197,253,0.4)",
  },
  55: {
    label: "Dense Drizzle",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #334155, #1e293b, #0f172a)",
    iconColor: "#60a5fa",
    glow: "rgba(96,165,250,0.4)",
  },
  61: {
    label: "Light Rain",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #1e40af, #1e3a8a, #312e81)",
    iconColor: "#93c5fd",
    glow: "rgba(147,197,253,0.4)",
  },
  63: {
    label: "Rain",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #1e3a8a, #312e81, #1e1b4b)",
    iconColor: "#60a5fa",
    glow: "rgba(96,165,250,0.5)",
  },
  65: {
    label: "Heavy Rain",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #0f172a, #1e1b4b, #0c0a09)",
    iconColor: "#3b82f6",
    glow: "rgba(59,130,246,0.5)",
  },
  68: {
    label: "Sleet",
    icon: CloudSnow,
    gradient: "linear-gradient(135deg, #64748b, #475569)",
    iconColor: "#cbd5e1",
    glow: "rgba(203,213,225,0.3)",
  },
  71: {
    label: "Light Snow",
    icon: CloudSnow,
    gradient: "linear-gradient(135deg, #e0e7ff, #c7d2fe, #a5b4fc)",
    iconColor: "#6366f1",
    glow: "rgba(99,102,241,0.3)",
  },
  73: {
    label: "Snow",
    icon: CloudSnow,
    gradient: "linear-gradient(135deg, #c7d2fe, #a5b4fc, #818cf8)",
    iconColor: "#4f46e5",
    glow: "rgba(79,70,229,0.4)",
  },
  75: {
    label: "Heavy Snow",
    icon: CloudSnow,
    gradient: "linear-gradient(135deg, #a5b4fc, #818cf8, #6366f1)",
    iconColor: "#312e81",
    glow: "rgba(49,46,129,0.4)",
  },
  80: {
    label: "Rain Showers",
    icon: CloudRain,
    gradient: "linear-gradient(135deg, #1e40af, #1d4ed8, #2563eb)",
    iconColor: "#bfdbfe",
    glow: "rgba(191,219,254,0.4)",
  },
  95: {
    label: "Thunderstorm",
    icon: CloudLightning,
    gradient: "linear-gradient(135deg, #1e1b4b, #0f172a, #0c0a09)",
    iconColor: "#fbbf24",
    glow: "rgba(251,191,36,0.6)",
  },
  96: {
    label: "T-Storm + Hail",
    icon: CloudLightning,
    gradient: "linear-gradient(135deg, #0f172a, #0c0a09, #000000)",
    iconColor: "#f59e0b",
    glow: "rgba(245,158,11,0.6)",
  },
};

const NoWeatherIcon = (_props: any) => null;
export function getWMO(code: number) {
  if (code < 0) return { ...WMO_MAP[3], label: "", icon: NoWeatherIcon };
  // Find the closest known code
  if (WMO_MAP[code]) return WMO_MAP[code];
  const keys = Object.keys(WMO_MAP)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= code) return WMO_MAP[keys[i]];
  }
  return WMO_MAP[0];
}

// One cache/pending request per place and units in a browser. The API shares
// provider data across displays, honors source expiry and supplies attribution.
const weatherCache = new Map<string, { data: any; ts: number }>();
const pending = new Map<string, Promise<any>>();
const WEATHER_API = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
).replace(/\/$/, "");
export async function fetchWeather(location: string, isCelsius: boolean) {
  const place = location.trim();
  if (!place) return null;
  const key = `${place}|${isCelsius}`;
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.ts < WEATHER_CACHE_MS) return cached.data;
  const running = pending.get(key);
  if (running) return running;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(
        `${WEATHER_API}/feeds/current-weather?location=${encodeURIComponent(place)}&units=${isCelsius ? "metric" : "imperial"}`,
        { signal: controller.signal },
      );
      if (!response.ok) return null;
      const result = await response.json();
      if (
        typeof result?.temp !== "number" ||
        !Number.isFinite(result.temp) ||
        result?.source !== "MET Norway" ||
        !Number.isFinite(Date.parse(result.forecastAt)) ||
        Math.abs(Date.now() - Date.parse(result.forecastAt)) > 2 * 3600000
      )
        return null;
      weatherCache.set(key, { data: result, ts: Date.now() });
      while (weatherCache.size > 80)
        weatherCache.delete(weatherCache.keys().next().value!);
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
