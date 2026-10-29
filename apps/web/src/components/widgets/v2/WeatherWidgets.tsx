"use client";
/**
 * WEATHER pack — 5 widgets. Current-hour forecast via the shared free MET Norway source (no API key).
 * WEATHER_NEON_FORECAST, WEATHER_PAPER_BULLETIN, WEATHER_CRAYON_SUN, WEATHER_GLASS_CARD, WEATHER_OPS_TELEMETRY
 */
import { useEffect, useRef, useState } from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { useRenderSurface } from '../render-surface';
import { NO_READING, WEATHER_HOLD_MS } from '../use-live-weather';
import { SampleStamp } from './_shared/live-data-truth';
import { fetchWeather, getWMO } from '../weather-api';

interface WCfg { style?: WidgetStyle; location?: string; units?: 'imperial' | 'metric'; staticTemp?: number; staticDesc?: string; staticIcon?: string; feedUrl?: string; }
function emojiFor(code: number | null): string {
  if (code == null || code < 0) return '';
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '';
}
function descFor(code: number | null): string {
  return code == null ? '' : getWMO(code).label;
}
/** "72°F" for a reading; the bare dash for none. */
function withUnit(v: number | string, u: string): string { return typeof v === 'number' ? `${v}${u}` : v; }

interface WxReading { temp: number; code: number; hi: number | null; lo: number | null }

/** One shared current-hour forecast for a place (lat,lng · US zip · city), or null. */
async function fetchReading(place: string, units: 'imperial' | 'metric'): Promise<WxReading | null> {
  const reading = await fetchWeather(place, units === 'metric');
  return reading ? {temp:reading.temp,code:reading.weatherCode,hi:reading.high,lo:reading.low} : null;
}

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
  const feed = w.loaded ? 'forecast_feed_ok' : w.sample ? 'sample_data' : 'no_data';
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
