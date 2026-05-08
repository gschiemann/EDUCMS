"use client";

/**
 * useHsLiveWeather — shared live-weather hook for the 16 HS template
 * pack widgets (8 landscape + 8 portrait).
 *
 * Wraps the canonical `useLiveTemplateData` hook so the HS pack gets
 * the same Open-Meteo three-tier fetch chain (ZIP → IP geolocate →
 * fallback) the AnimatedWelcome + MS pack already use. No new fetch
 * code, no new rate-limit risk — single source of truth lives at
 * components/widgets/lib/useLiveTemplateData.ts.
 *
 * Why a thin wrapper instead of calling useLiveTemplateData directly:
 *   1. HS templates resolve weather text via two fields (`weatherTemp`
 *      and `weatherCondition`) where the operator can override either
 *      independently. Wrapper centralizes the placeholder-detection +
 *      string-formatting logic so each widget's render stays a
 *      one-liner: `{weather.tempLabel}` / `{weather.conditionLabel}`.
 *   2. Each HS template formats temp + condition differently —
 *      "46°F · clear", "46°", "Clear, 46°", etc. Per-widget formatters
 *      live next to the widget's CSS rather than buried in a generic
 *      hook.
 *
 * Operator override wins. Empty config / matches-DEFAULT placeholder
 * → live data wins. Same pattern as resolveHsClock / resolveHsDate.
 *
 * Usage in a widget:
 *   const w = useHsLiveWeather({
 *     live,
 *     location: c.weatherLocation,
 *     unitsCelsius: false,
 *     tempOverride: c.weatherTemp,
 *     conditionOverride: c.weatherCondition,
 *     defaultTemp: DEFAULTS.weatherTemp,
 *     defaultCondition: DEFAULTS.weatherCondition,
 *     formatTemp: (f) => `${f}°F`,
 *     formatCondition: (wmo) => describeWmo(wmo),
 *   });
 *   <div>{w.tempLabel}</div>
 *   <div>{w.conditionLabel}</div>
 */

import { useLiveTemplateData } from '../lib/useLiveTemplateData';

export interface UseHsLiveWeatherOpts {
  /** From parent widget — false in gallery thumbs, true in player + preview. */
  live?: boolean;
  /** Optional ZIP / city. Empty → IP geolocation via ipapi.co. */
  location?: string;
  /** True → render °C; false → render °F. */
  unitsCelsius?: boolean;
  /** Operator override for the temp label. */
  tempOverride?: string;
  /** Operator override for the condition label. */
  conditionOverride?: string;
  /** Widget's DEFAULT.weatherTemp (used to detect placeholder vs override). */
  defaultTemp: string;
  /** Widget's DEFAULT.weatherCondition (used to detect placeholder vs override). */
  defaultCondition: string;
  /** (tempInChosenUnit, wmoCode) => label — widget-specific format. */
  formatTemp: (tempUnitVal: number) => string;
  /** (wmoCode, tempInChosenUnit) => label — widget-specific format. */
  formatCondition: (wmoCode: number, tempUnitVal: number) => string;
}

export interface UseHsLiveWeatherResult {
  tempLabel: string;
  conditionLabel: string;
  /** True when the displayed values came from the live API (not an override / fallback default). */
  isLive: boolean;
}

function isPlaceholder(value: string | undefined, defaultValue: string): boolean {
  if (!value) return true;
  return value.trim() === defaultValue.trim();
}

export function useHsLiveWeather(opts: UseHsLiveWeatherOpts): UseHsLiveWeatherResult {
  const {
    live, location, unitsCelsius,
    tempOverride, conditionOverride,
    defaultTemp, defaultCondition,
    formatTemp, formatCondition,
  } = opts;

  // useLiveTemplateData returns weather in °F always. Convert if °C requested.
  const { weather } = useLiveTemplateData({
    live,
    weatherLocation: location,
    weatherUnits: unitsCelsius ? 'metric' : 'imperial',
  });

  const tempIsPlaceholder = isPlaceholder(tempOverride, defaultTemp);
  const condIsPlaceholder = isPlaceholder(conditionOverride, defaultCondition);

  // Bail to defaults / overrides when the live fetch hasn't returned yet.
  if (!weather) {
    return {
      tempLabel: tempIsPlaceholder ? defaultTemp : (tempOverride || defaultTemp),
      conditionLabel: condIsPlaceholder ? defaultCondition : (conditionOverride || defaultCondition),
      isLive: false,
    };
  }

  const tempVal = unitsCelsius ? Math.round((weather.tempF - 32) * 5 / 9) : weather.tempF;
  const liveTemp = formatTemp(tempVal);
  const liveCondition = formatCondition(weather.wmoCode, tempVal);

  return {
    tempLabel: tempIsPlaceholder ? liveTemp : (tempOverride || liveTemp),
    conditionLabel: condIsPlaceholder ? liveCondition : (conditionOverride || liveCondition),
    isLive: tempIsPlaceholder && condIsPlaceholder,
  };
}

/**
 * Map an Open-Meteo WMO weather code to a short human label.
 * https://open-meteo.com/en/docs — bottom of page lists the full set.
 *
 * HS widgets each format these slightly differently; this is a sane
 * default that any widget can override by passing its own
 * formatCondition. Examples:
 *   - "Clear" / "Mostly cloudy" / "Light rain" / "Snow"
 */
export function describeWmo(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61) return 'Light rain';
  if (code === 63) return 'Rain';
  if (code === 65) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71) return 'Light snow';
  if (code === 73) return 'Snow';
  if (code === 75) return 'Heavy snow';
  if (code === 77) return 'Snow grains';
  if (code === 80 || code === 81 || code === 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm w/ hail';
  return 'Clear';
}
