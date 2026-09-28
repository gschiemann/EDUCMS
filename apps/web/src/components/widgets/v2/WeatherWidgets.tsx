"use client";
/**
 * WEATHER pack — 5 widgets. Live data via Open-Meteo (no API key).
 * WEATHER_NEON_FORECAST, WEATHER_PAPER_BULLETIN, WEATHER_CRAYON_SUN, WEATHER_GLASS_CARD, WEATHER_OPS_TELEMETRY
 */
import { useEffect, useRef, useState } from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { useRenderSurface } from '../render-surface';
import { NO_READING, WEATHER_HOLD_MS } from '../use-live-weather';
import { SampleStamp } from './_shared/live-data-truth';

interface WCfg { style?: WidgetStyle; location?: string; units?: 'imperial' | 'metric'; staticTemp?: number; staticDesc?: string; staticIcon?: string; feedUrl?: string; }
function emojiFor(code: number | null): string { if (code == null) return ''; if (code === 0) return '☀️'; if (code <= 3) return '⛅'; if (code <= 48) return '🌫️'; if (code <= 67) return '🌧️'; if (code <= 77) return '❄️'; if (code <= 82) return '🌦️'; if (code <= 86) return '🌨️'; if (code >= 95) return '⛈️'; return '🌤️'; }
function descFor(code: number | null): string { if (code == null) return ''; if (code === 0) return 'Clear'; if (code <= 3) return 'Partly cloudy'; if (code <= 48) return 'Foggy'; if (code <= 67) return 'Rainy'; if (code <= 77) return 'Snowy'; if (code <= 82) return 'Showers'; if (code >= 95) return 'Storms'; return 'Fair'; }
/** "72°F" for a reading; the bare dash for none. */
function withUnit(v: number | string, u: string): string { return typeof v === 'number' ? `${v}${u}` : v; }

interface WxReading { temp: number; code: number; hi: number | null; lo: number | null }

/** One Open-Meteo reading for a place (lat,lng · US zip · city), or null. */
async function fetchReading(place: string, units: 'imperial' | 'metric'): Promise<WxReading | null> {
  try {
    let lat: number | null = null;
    let lng: number | null = null;
    // lat,lng from the geolocation auto-detect button
    const m = place.match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) { lat = parseFloat(m[1]); lng = parseFloat(m[2]); }
    // 5-digit US zip
    if (lat == null && /^\d{5}$/.test(place)) {
      try {
        const z = await fetch(`https://api.zippopotam.us/us/${place}`).then(r => r.ok ? r.json() : null);
        const p = z?.places?.[0];
        if (p) { lat = parseFloat(p.latitude); lng = parseFloat(p.longitude); }
      } catch { /* ignore */ }
    }
    // City name
    if (lat == null) {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`).then(r => r.json());
      const g = geo?.results?.[0]; if (!g) return null;
      lat = g.latitude; lng = g.longitude;
    }
    if (lat == null || lng == null) return null;
    const u = units === 'imperial' ? '&temperature_unit=fahrenheit' : '';
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto${u}`).then(r => r.json());
    // A reply without a current temperature is no reading — it used to become 70°.
    const t = w?.current_weather?.temperature;
    if (typeof t !== 'number' || !Number.isFinite(t)) return null;
    const hi = w?.daily?.temperature_2m_max?.[0];
    const lo = w?.daily?.temperature_2m_min?.[0];
    return {
      temp: Math.round(t),
      code: typeof w?.current_weather?.weathercode === 'number' ? w.current_weather.weathercode : 1,
      hi: typeof hi === 'number' ? Math.round(hi) : null,
      lo: typeof lo === 'number' ? Math.round(lo) : null,
    };
  } catch { return null; }
}

// 2026-05-04 — operator: weather widgets show static placeholder
// values in editor because the v2 hook gated fetches behind a `live`
// prop that's only true on the player. Now fetches in BOTH editor
// and player so the operator sees the real weather they'll get.
// Also handles 5-digit US zip codes via Zippopotam.us (mirrors the
// legacy fetchWeather change).
//
// Lane B4 (2026-09-27) — this hook STARTED at 72° / partly cloudy / 78 / 60
// and stayed there whenever no location was set or the fetch failed; it also
// fetched once and never again, so a screen that ran for a week showed the
// temperature from the morning it booted. Now it refreshes every 15 minutes,
// keeps a reading through failed refreshes for at most an hour, and a REAL
// screen with no reading shows a dash. The builder keeps the 72° sample so a
// tile is never blank — stamped SAMPLE.
function useWeather(loc: string | undefined, units: 'imperial' | 'metric' = 'imperial', _live?: boolean) {
  const realScreen = useRenderSurface() === 'player';
  const place = (loc || '').trim();
  // A reading remembers the place (and units) it is for, so a changed or
  // cleared location never shows the old place's weather.
  const [held, setHeld] = useState<{ key: string; r: WxReading | null } | null>(null);
  const goodAt = useRef(0);
  useEffect(() => {
    goodAt.current = 0;
    if (!place) return;
    const key = `${place}|${units}`;
    let cancel = false;
    const load = () => {
      fetchReading(place, units).then((r) => {
        if (cancel) return;
        if (r) { goodAt.current = Date.now(); setHeld({ key, r }); }
        else if (Date.now() - goodAt.current > WEATHER_HOLD_MS) setHeld({ key, r: null });
      });
    };
    load();
    const t = setInterval(load, 15 * 60 * 1000);
    return () => { cancel = true; clearInterval(t); };
  }, [place, units]);
  const reading = place && held && held.key === `${place}|${units}` ? held.r : null;
  if (reading) {
    return {
      temp: reading.temp as number | string, code: reading.code as number | null,
      hi: (reading.hi ?? NO_READING) as number | string, lo: (reading.lo ?? NO_READING) as number | string,
      loaded: true, sample: false,
    };
  }
  if (realScreen) {
    return { temp: NO_READING as number | string, code: null as number | null, hi: NO_READING as number | string, lo: NO_READING as number | string, loaded: false, sample: false };
  }
  return { temp: (units === 'imperial' ? 72 : 22) as number | string, code: 1 as number | null, hi: 78 as number | string, lo: 60 as number | string, loaded: false, sample: true };
}

// 1. NEON
export function WeatherNeonForecastWidget({ config, live }: WidgetProps<WCfg>) {
  const c = config || {}; const w = useWeather(c.location, c.units || 'imperial', live);
  const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 24, textColor: '#fff', bgColor: '#0a0014', bgGradient: 'radial-gradient(ellipse at top, #1a0033, #0a0014)', padding: 28, borderRadius: 16, accentColor: '#00f0ff', accentColor2: '#ff2bd6', ...(c.style || {}) });
  const temp = c.staticTemp ?? w.temp; const u = c.units === 'metric' ? '°C' : '°F';
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: r.accent.primary, fontSize: '0.85em', letterSpacing: '0.3em', textShadow: `0 0 8px ${r.accent.primary}` }}>● {(c.location || 'CAMPUS').toUpperCase()}</span><span style={{ color: r.accent.secondary, fontSize: '0.75em', letterSpacing: '0.2em' }}>{descFor(w.code).toUpperCase()}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1 }}>
          <div style={{ fontSize: 80 }}><span data-field="staticIcon">{c.staticIcon || emojiFor(w.code)}</span></div>
          <div><div style={{ fontSize: 100, color: r.accent.primary, lineHeight: 1, textShadow: `0 0 24px ${r.accent.primary}`, fontWeight: 700 }}>{temp}{typeof temp === 'number' && <span style={{ fontSize: '0.4em', color: r.accent.secondary }}>{u}</span>}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: '0.85em', color: r.accent.secondary }}><span>HI {withUnit(w.hi, u)}</span><span>LO {withUnit(w.lo, u)}</span></div>
      </div>
      {w.sample && <SampleStamp />}
    </div>
  );
}

// 2. PAPER BULLETIN
export function WeatherPaperBulletinWidget({ config, live }: WidgetProps<WCfg>) {
  const c = config || {}; const w = useWeather(c.location, c.units || 'imperial', live);
  const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, textColor: '#0a0a0a', bgColor: '#f5f1e8', padding: 32, accentColor: '#7c1d1d', ...(c.style || {}) });
  const temp = c.staticTemp ?? w.temp; const u = c.units === 'metric' ? '°C' : '°F';
  return (
    <div style={frameStyle(r)}>
      <div style={{ borderBottom: '4px double #0a0a0a', paddingBottom: 8, fontSize: '0.85em', letterSpacing: '0.3em', color: r.accent.primary, fontWeight: 700, textTransform: 'uppercase' }}>The Daily Forecast</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 16 }}>
        <div style={{ fontSize: 80, filter: 'sepia(0.3)' }}><span data-field="staticIcon">{c.staticIcon || emojiFor(w.code)}</span></div>
        <div><div style={{ fontSize: 84, fontWeight: 900, lineHeight: 1, fontFamily: 'monospace' }}>{withUnit(temp, u)}</div><div style={{ fontStyle: 'italic', fontSize: '1.4em', color: r.accent.primary }}><span data-field="staticDesc">{c.staticDesc || descFor(w.code)}</span></div></div>
      </div>
      <div style={{ marginTop: 14, borderTop: '1px dashed #94a3b8', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: '0.95em', fontStyle: 'italic' }}><span>High: {withUnit(w.hi, u)}</span><span>Low: {withUnit(w.lo, u)}</span><span data-field="location">{c.location || 'Local'}</span></div>
      {w.sample && <SampleStamp />}
    </div>
  );
}

// 3. CRAYON SUN — elementary
export function WeatherCrayonSunWidget({ config, live }: WidgetProps<WCfg>) {
  const c = config || {}; const w = useWeather(c.location, c.units || 'imperial', live);
  const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 24, textColor: '#1c1917', bgColor: '#fff8e7', padding: 24, borderRadius: 32, accentColor: '#ffd93d', accentColor2: '#ff6b9d', highlightColor: '#4ecdc4', ...(c.style || {}) });
  const temp = c.staticTemp ?? w.temp; const u = c.units === 'metric' ? '°C' : '°F';
  const desc = c.staticDesc || descFor(w.code);
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
        <div style={{ fontSize: '0.9em', fontWeight: 800, color: r.accent.secondary, background: '#fff', padding: '6px 18px', borderRadius: 999, transform: 'rotate(-3deg)', boxShadow: '0 4px 0 rgba(0,0,0,0.1)' }}>📍 <span data-field="location">{c.location || 'Our School'}</span></div>
        <div style={{ width: 130, height: 130, background: r.accent.primary, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 70, boxShadow: '0 8px 0 rgba(0,0,0,0.12)' }}><span data-field="staticIcon">{c.staticIcon || emojiFor(w.code)}</span></div>
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1, color: r.accent.secondary, textShadow: '4px 4px 0 #fff' }}>{withUnit(temp, u)}</div>
        {desc && <div style={{ background: r.accent.highlight, color: '#fff', padding: '6px 18px', borderRadius: 999, fontWeight: 800, fontSize: '0.95em' }}><span data-field="staticDesc">{desc}</span>!</div>}
      </div>
      {w.sample && <SampleStamp />}
    </div>
  );
}

// 4. GLASS CARD
export function WeatherGlassCardWidget({ config, live }: WidgetProps<WCfg>) {
  const c = config || {}; const w = useWeather(c.location, c.units || 'imperial', live);
  const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 22, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(56,189,248,0.12), rgba(99,102,241,0.12))', padding: 28, borderRadius: 24, accentColor: '#0ea5e9', ...(c.style || {}) });
  const temp = c.staticTemp ?? w.temp; const u = c.units === 'metric' ? '°C' : '°F';
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
        <div style={{ fontSize: '0.85em', fontWeight: 600, letterSpacing: '0.2em', color: r.accent.primary, textTransform: 'uppercase' }} data-field="location">{c.location || 'Local Weather'}</div>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 16 }}>
          <div style={{ fontSize: 88 }}><span data-field="staticIcon">{c.staticIcon || emojiFor(w.code)}</span></div>
          <div><div style={{ fontSize: 90, fontWeight: 200, letterSpacing: '-0.04em', lineHeight: 1 }}>{temp}{typeof temp === 'number' && <span style={{ fontSize: '0.4em', color: '#64748b' }}>{u}</span>}</div><div style={{ fontSize: '1em', color: '#64748b', fontWeight: 500 }}><span data-field="staticDesc">{c.staticDesc || descFor(w.code)}</span></div></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ background: 'rgba(14,165,233,0.1)', padding: '6px 14px', borderRadius: 999, fontSize: '0.8em', fontWeight: 600, color: r.accent.primary }}>↑ {withUnit(w.hi, u)}</div>
          <div style={{ background: 'rgba(99,102,241,0.1)', padding: '6px 14px', borderRadius: 999, fontSize: '0.8em', fontWeight: 600, color: '#6366f1' }}>↓ {withUnit(w.lo, u)}</div>
        </div>
      </div>
      {w.sample && <SampleStamp />}
    </div>
  );
}

// 5. OPS TELEMETRY
export function WeatherOpsTelemetryWidget({ config, live }: WidgetProps<WCfg>) {
  const c = config || {}; const w = useWeather(c.location, c.units || 'imperial', live);
  const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, textColor: '#fafafa', bgColor: '#0a0e14', padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24', ...(c.style || {}) });
  const temp = c.staticTemp ?? w.temp; const u = c.units === 'metric' ? '°C' : '°F';
  // The footer used to read "cached_data" whenever no reading had arrived —
  // there was no cache, only the 72° sample. It now says what is on show.
  const feed = w.loaded ? 'live_feed_ok' : w.sample ? 'sample_data' : 'no_data';
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 6, fontSize: '0.85em' }}><b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● METEOR.SVC</b><span style={{ color: r.accent.secondary }}>{(c.location || 'LOCAL').toUpperCase()}</span></div>
        <div style={{ flex: 1, fontSize: r.font.size, lineHeight: 1.7, color: r.accent.secondary }}>
          <div><b style={{ color: r.font.color }}>TEMP&nbsp;:</b> <span style={{ color: r.accent.primary, textShadow: `0 0 8px ${r.accent.primary}` }}>{withUnit(temp, u)}</span></div>
          <div><b style={{ color: r.font.color }}>COND&nbsp;:</b> {(c.staticDesc || descFor(w.code) || NO_READING).toUpperCase()}</div>
          <div><b style={{ color: r.font.color }}>HI/LO:</b> {typeof w.hi === 'number' && typeof w.lo === 'number' ? `${w.hi}/${w.lo}${u}` : `${w.hi}/${w.lo}`}</div>
          <div><b style={{ color: r.font.color }}>ICON&nbsp;:</b> <span data-field="staticIcon">{c.staticIcon || emojiFor(w.code)}</span> {w.code != null && <span style={{ color: r.accent.primary }}>WMO_{w.code}</span>}</div>
        </div>
        <div style={{ borderTop: `1px dashed ${r.accent.primary}55`, paddingTop: 6, fontSize: '0.85em', color: r.accent.primary }}>$ {feed}_</div>
      </div>
      {w.sample && <SampleStamp />}
    </div>
  );
}
