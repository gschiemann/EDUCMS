"use client";

/**
 * AnimatedWelcomeMiddleWidget — full-screen middle-school welcome scene.
 *
 * ════════════════════════════════════════════════════════════════
 *  Ported from scratch/design/animated-middle-school.html (v2, rope
 *  removed). Same transform:scale pattern as AnimatedWelcomeWidget
 *  (elementary). Shares the `aw-edit-section` / `aw-section-*`
 *  hotspot contract with PropertiesPanel so every shape is clickable
 *  and the editor jumps to the matching section.
 *
 *  Every widget is a real shape, never a rounded rectangle:
 *  - Logo         → shield clip-path + eagle emoji
 *  - Title        → torn-paper pennant banner with thumbtacks
 *  - Clock        → hanging stadium scoreboard with chains
 *  - Weather      → pennant flag on a flagpole
 *  - Announcement → speech bubble + megaphone + sound waves
 *  - Countdown    → stopwatch with crown + tick marks
 *  - Teacher      → varsity letter patch (chenille shield)
 *  - Birthdays    → 3-candle cake with frosting drip
 *  - Ticker       → LED scoreboard scroll
 *
 *  DO NOT regress to rectangles-with-shadows. See CLAUDE.md
 *  "Template Design Workflow" for the gold standard rules.
 * ════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useState } from 'react';

interface Cfg {
  logoUrl?: string;
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;
  weatherLocation?: string;
  weatherUnits?: 'imperial' | 'metric';
  weatherTemp?: string;
  weatherDesc?: string;
  announcementLabel?: string;
  announcementMessage?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;
  teacherGender?: 'female' | 'male';
  teacherEmoji?: string;
  teacherName?: string;
  teacherRole?: string;
  birthdayNames?: string | string[];
  teacherPhotoUrl?: string;
  tickerStamp?: string;
  tickerMessages?: string[] | string;
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Varsity/MS-tone weather phrase — shorter + ALL CAPS to fit the
// pennant flag label. Keyed on WMO code + rough temp bucket.
function msWeatherPhrase(wmo: number, tempF: number): string {
  const bucket = tempF < 35 ? 'COLD' : tempF < 60 ? 'CRISP' : tempF < 80 ? 'CLEAR' : 'HOT';
  switch (wmo) {
    case 0:
    case 1:                         return `SUNNY · ${bucket}`;
    case 2:                         return 'PARTLY CLOUDY';
    case 3:                         return 'CLOUDY';
    case 45: case 48:               return 'FOGGY';
    case 51: case 53: case 55:      return 'DRIZZLE';
    case 61: case 80:               return 'LIGHT RAIN';
    case 63: case 81:               return 'RAINY';
    case 65: case 82:               return 'HEAVY RAIN';
    case 66: case 67:               return 'ICY RAIN';
    case 71: case 73: case 85:      return 'SNOW FLURRIES';
    case 75: case 86:               return 'HEAVY SNOW';
    case 95:                        return 'THUNDER';
    case 96: case 99:               return 'STORM · HAIL';
    default:                        return `${bucket} DAY`;
  }
}

export function AnimatedWelcomeMiddleWidget({ config }: { config: Cfg }) {
  const c = config || {};
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
  const [weather, setWeather] = useState<{ tempF: number; wmoCode: number } | null>(null);

  // Same offsetWidth-based scale pattern as elementary; works inside
  // ScaledTemplateThumbnail's scale(.13) wrapper where
  // getBoundingClientRect would collapse to a dot.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / CANVAS_W, h / CANVAS_H));
    };
    compute();
    const r1 = requestAnimationFrame(compute);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Live weather — same 3-tier resolver as elementary.
  useEffect(() => {
    if (c.weatherTemp) return;
    let cancelled = false;
    const isCelsius = c.weatherUnits === 'metric';
    const resolveCoords = async (): Promise<{ lat: number; lng: number } | null> => {
      const zip = (c.weatherLocation || '').trim();
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
        } catch { /* ip fallback */ }
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
        const unit = isCelsius ? 'celsius' : 'fahrenheit';
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&current=temperature_2m,weather_code&temperature_unit=${unit}`);
        if (!r.ok) return;
        const j = await r.json();
        const t = j?.current?.temperature_2m, k = j?.current?.weather_code;
        if (cancelled || t == null || k == null) return;
        const round = Math.round(t);
        setWeather({ tempF: isCelsius ? Math.round(round * 9/5 + 32) : round, wmoCode: k });
      } catch { /* noop */ }
    };
    fetchWx();
    const id = setInterval(fetchWx, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [c.weatherLocation, c.weatherUnits, c.weatherTemp]);

  // Clock formatting (IANA tz-aware).
  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...(tz ? { timeZone: tz } : {}) });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  const tickerList = Array.isArray(c.tickerMessages)
    ? c.tickerMessages
    : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
  const tickerText = tickerList.length
    ? tickerList.join('  ·  ').toUpperCase()
    : 'VARSITY 28 — CENTRAL 14 · CHEER TRYOUTS MONDAY 3 PM · YEARBOOK ORDERS DUE FRIDAY · STUDENT COUNCIL ELECTIONS NEXT WEEK · GO EAGLES! 🦅';

  const birthdayList: string[] = Array.isArray(c.birthdayNames)
    ? c.birthdayNames.filter(Boolean)
    : (typeof c.birthdayNames === 'string'
        ? c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean)
        : ['Jordan', 'Tyler', 'Alex']);
  const bdInline = birthdayList.join(' · ').toUpperCase();

  // Days-to-target countdown (same logic as elementary).
  const days = (() => {
    if (!c.countdownDate) return c.countdownNumber ?? 12;
    const target = new Date(c.countdownDate + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
  })();
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  // Face emoji when no teacher photo. teacherEmoji is legacy — gender picker wins.
  const teacherFace = c.teacherGender === 'female' ? '👩‍🏫' : (c.teacherEmoji || '👨‍🏫');

  const weatherDesc = c.weatherDesc
    || (weather ? msWeatherPhrase(weather.wmoCode, weather.tempF) : 'SUNNY · CRISP');
  const weatherTemp = c.weatherTemp || (weather ? `${weather.tempF}°` : '68°');

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}
    >
      <style>{CSS_MS}</style>

      <div
        className="ms-stage"
        style={{ width: CANVAS_W, height: CANVAS_H, transform: scale > 0 ? `scale(${scale})` : 'scale(0)', transformOrigin: 'center center', flexShrink: 0 }}
      >
        <div className="ms-stripes" />
        <div className="ms-spotlight ms-left" />
        <div className="ms-spotlight ms-right" />

        {/* Pennant bunting — SVG strip across the top */}
        <div className="ms-bunting">
          <svg viewBox="0 0 1920 100" preserveAspectRatio="none">
            <path d="M0 0 L1920 0 L1920 8 L0 8 Z" fill="#fbbf24" />
            <g>
              {Array.from({ length: 24 }).map((_, i) => {
                const x = i * 80;
                const colors = ['#dc2626', '#fbbf24', '#3b82f6'];
                return (
                  <polygon
                    key={i}
                    className="ms-pennant"
                    points={`${x},8 ${x + 70},8 ${x + 35},75`}
                    fill={colors[i % colors.length]}
                    stroke="#fff"
                    strokeWidth={3}
                  />
                );
              })}
            </g>
          </svg>
        </div>

        <div className="ms-header">
          {/* Logo — shield (customer logo overrides the eagle emoji) */}
          <div className="ms-logo">
            {c.logoUrl
              ? <img src={c.logoUrl} alt="" className="ms-logoImg" />
              : <span className="ms-logoEmoji">{c.logoEmoji || '🦅'}</span>}
          </div>

          {/* Title — torn pennant banner with pins (NO ROPE per 2026-04-19 review) */}
          <div className="ms-titleBanner">
            <div className="ms-pin ms-pin1" />
            <div className="ms-pin ms-pin2" />
            <div className="ms-ribbon">
              <h1>{(c.title || 'GO EAGLES').toUpperCase()}</h1>
              <div className="ms-sub">{c.subtitle || '~ welcome back, Eagles ~'}</div>
            </div>
          </div>

          {/* Clock — stadium scoreboard on chains */}
          <div className="ms-clock">
            <div className="ms-chains">
              <div className="ms-chain" />
              <div className="ms-chain" />
            </div>
            <div className="ms-scoreboard">
              <div className="ms-clockT">{hh}:{mm}</div>
              <div className="ms-clockAp">{ampm}</div>
            </div>
          </div>
        </div>

        <div className="ms-grid">
          {/* Weather — pennant flag on a pole */}
          <div className="ms-weather">
            <div className="ms-pole" />
            <div className="ms-flag">
              <div className="ms-flagIcon">{weatherIcon(weather?.wmoCode)}</div>
              <div className="ms-flagTemp">{weatherTemp}</div>
              <div className="ms-flagDesc">{weatherDesc}</div>
            </div>
          </div>

          {/* Announcement — megaphone + sound waves + bubble */}
          <div className="ms-announce">
            <div className="ms-mega">📣</div>
            <div className="ms-wave ms-wave1" />
            <div className="ms-wave ms-wave2" />
            <div className="ms-wave ms-wave3" />
            <div className="ms-bubble">
              <div className="ms-annLbl">★ {(c.announcementLabel || 'BIG NEWS').toUpperCase()} ★</div>
              <div className="ms-annMsg">{c.announcementMessage || 'Pep Rally Friday at 2:30 — be in the gym, bring your loudest!'}</div>
            </div>
          </div>

          {/* Countdown — stopwatch */}
          <div className="ms-countdown">
            <div className="ms-stopwatch">
              <div className="ms-crown" />
              <div className="ms-ring">
                <div className="ms-cdLbl">{(c.countdownLabel || 'HOMECOMING IN').toUpperCase()}</div>
                <div className="ms-cdNum">{days}</div>
                <div className="ms-cdUnit">{unit}</div>
              </div>
            </div>
          </div>

          {/* Teacher — varsity letter patch */}
          <div className="ms-teacher">
            <div className="ms-patch">
              <div className="ms-patchRole">★ {(c.teacherRole || 'TEACHER OF THE WEEK').toUpperCase()} ★</div>
              <div className="ms-patchFace">
                {c.teacherPhotoUrl
                  ? <img src={c.teacherPhotoUrl} alt="" className="ms-patchPhoto" />
                  : <span>{teacherFace}</span>}
              </div>
              <div className="ms-patchName">{(c.teacherName || 'MR. RIVERA').toUpperCase()}</div>
            </div>
          </div>

          {/* Birthdays — layered cake with candles + flames */}
          <div className="ms-birthdays">
            <div className="ms-cakeWrap">
              <div className="ms-candle ms-c1" />
              <div className="ms-candle ms-c2" />
              <div className="ms-candle ms-c3" />
              <div className="ms-flame ms-f1" />
              <div className="ms-flame ms-f2" />
              <div className="ms-flame ms-f3" />
              <div className="ms-tier1" />
              <div className="ms-tier2" />
            </div>
            <div className="ms-bdLbl">★ BIRTHDAYS TODAY ★</div>
            <div className="ms-bdNames">{bdInline}</div>
          </div>
        </div>

        {/* Ticker — LED scoreboard scroll */}
        <div className="ms-ticker">
          <div className="ms-tickerStamp">{(c.tickerStamp || 'EAGLE NEWS').toUpperCase()}</div>
          <div className="ms-tickerScrollWrap">
            <span className="ms-tickerScrollText">{tickerText}</span>
          </div>
        </div>

        {/* Click hotspots — same aw-edit-section contract as elementary */}
        <Hotspot section="header"       x={36}   y={110} w={200}  h={220} />
        <Hotspot section="header"       x={260}  y={110} w={1400} h={220} />
        <Hotspot section="header"       x={1684} y={110} w={200}  h={220} />
        <Hotspot section="weather"      x={36}   y={360} w={320}  h={295} />
        <Hotspot section="announcement" x={380}  y={360} w={1160} h={590} />
        <Hotspot section="countdown"    x={1564} y={360} w={320}  h={295} />
        <Hotspot section="teacher"      x={36}   y={660} w={320}  h={290} />
        <Hotspot section="birthdays"    x={1564} y={660} w={320}  h={290} />
        <Hotspot section="ticker"       x={0}    y={970} w={1920} h={110} />
      </div>
    </div>
  );
}

function weatherIcon(wmo: number | undefined): string {
  if (wmo == null) return '☀️';
  if ([0, 1].includes(wmo)) return '☀️';
  if (wmo === 2) return '⛅';
  if (wmo === 3) return '☁️';
  if ([45, 48].includes(wmo)) return '🌫️';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(wmo)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(wmo)) return '❄️';
  if ([95, 96, 99].includes(wmo)) return '⛈️';
  return '☀️';
}

function Hotspot({ section, x, y, w, h }: { section: string; x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="aw-hotspot"
      data-section={section}
      role="button"
      tabIndex={0}
      onPointerDown={() => {
        try { window.dispatchEvent(new CustomEvent('aw-edit-section', { detail: { section } })); } catch { /* noop */ }
      }}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h, cursor: 'pointer', zIndex: 50 }}
      aria-label={`Edit ${section}`}
    />
  );
}

// All pixel sizes match scratch/design/animated-middle-school.html.
// Class prefix is `ms-` so it cannot collide with the elementary
// `aw-` widget on the same page.
const CSS_MS = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Bebas+Neue&family=Oswald:wght@500;700&family=Permanent+Marker&display=swap');

.ms-stage {
  position: relative;
  font-family: 'Oswald', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 20%, rgba(59, 130, 246, .25), transparent 60%),
    radial-gradient(ellipse at 20% 110%, rgba(251, 191, 36, .18), transparent 40%),
    radial-gradient(ellipse at 80% 110%, rgba(220, 38, 38, .18), transparent 40%),
    linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f172a 100%);
  overflow: hidden;
}
.ms-stripes {
  position: absolute; inset: -10%; pointer-events: none;
  background: repeating-linear-gradient(135deg,
    transparent 0 80px, rgba(251, 191, 36, .04) 80px 90px,
    transparent 90px 200px, rgba(220, 38, 38, .04) 200px 210px);
  animation: ms-stripeDrift 54s linear infinite;
}
@keyframes ms-stripeDrift { from { transform: translateX(0); } to { transform: translateX(80px); } }

.ms-spotlight {
  position: absolute; pointer-events: none;
  width: 600px; height: 1100px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.08) 50%, transparent 100%);
  transform-origin: 50% 100%;
  animation: ms-sweep 12.6s ease-in-out infinite;
}
.ms-spotlight.ms-left  { left: 8%; bottom: 0; transform: rotate(-15deg); animation-delay: 0s; }
.ms-spotlight.ms-right { right: 8%; bottom: 0; transform: rotate(15deg); animation-delay: -3.5s; }
@keyframes ms-sweep { 0%, 100% { opacity: .25; } 50% { opacity: .55; } }

.ms-bunting { position: absolute; top: 0; left: 0; right: 0; height: 100px; z-index: 2; }
.ms-bunting svg { width: 100%; height: 100%; display: block; }
.ms-pennant { animation: ms-pennantSway 5.4s ease-in-out infinite; transform-origin: 50% 8px; }
@keyframes ms-pennantSway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }

.ms-header {
  position: absolute; top: 110px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 200px 1fr 220px; gap: 36px; z-index: 5; align-items: start;
}

/* LOGO — shield shape */
.ms-logo {
  position: relative; width: 200px; height: 220px;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 60%, #d97706);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 32px rgba(0,0,0,.5);
  animation: ms-shieldPulse 4.3s ease-in-out infinite;
  overflow: hidden;
}
.ms-logo::before {
  content: ''; position: absolute; inset: 14px;
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  box-shadow: inset 0 0 0 4px #92400e;
}
.ms-logoEmoji { font-size: 100px; line-height: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,.5)); transform: translateY(-12px); }
.ms-logoImg { width: 100%; height: 100%; object-fit: cover; }
@keyframes ms-shieldPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

/* TITLE — torn-paper pennant banner. No rope (per 2026-04-19 review). */
.ms-titleBanner { position: relative; padding-top: 20px; }
.ms-ribbon {
  background: #dc2626; padding: 28px 40px 50px; position: relative;
  box-shadow: 0 16px 32px rgba(0,0,0,.4);
  clip-path: polygon(0 0, 100% 0, 100% 70%, 90% 100%, 80% 70%, 70% 100%, 60% 70%, 50% 100%, 40% 70%, 30% 100%, 20% 70%, 10% 100%, 0 70%);
  animation: ms-bannerSway 6.3s ease-in-out infinite;
  transform-origin: 50% 0%;
  border: 4px solid #fff; border-bottom: none;
}
@keyframes ms-bannerSway { 0%, 100% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } }
.ms-ribbon h1 {
  margin: 0; line-height: .92;
  font-family: 'Bungee', cursive; font-size: 88px; color: #fff;
  text-shadow: 4px 4px 0 #000, 8px 8px 0 #fbbf24;
  letter-spacing: .04em; text-align: center;
}
.ms-sub {
  font-family: 'Permanent Marker', cursive; font-size: 32px;
  color: #fbbf24; margin-top: 6px; text-align: center;
  transform: rotate(-2deg);
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}
.ms-pin { position: absolute; top: 12px; width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #d97706 70%, #78350f);
  box-shadow: 0 2px 4px rgba(0,0,0,.5); z-index: 2; }
.ms-pin1 { left: 8%; }
.ms-pin2 { right: 8%; }

/* CLOCK — hanging stadium scoreboard */
.ms-clock { position: relative; padding-top: 28px; display: flex; flex-direction: column; align-items: center; }
.ms-chains { position: absolute; top: 0; left: 30%; right: 30%; height: 32px; display: flex; justify-content: space-between; }
.ms-chain { width: 4px; height: 100%; background: linear-gradient(180deg, transparent, #94a3b8 20%, #64748b 80%, transparent); border-radius: 2px; }
.ms-scoreboard {
  width: 200px; height: 140px;
  background: #000;
  border: 6px solid #fbbf24;
  border-radius: 8px;
  box-shadow: 0 0 40px rgba(251, 191, 36, .5), inset 0 0 30px rgba(251, 191, 36, .15);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: ms-scoreboardSway 7.2s ease-in-out infinite;
  transform-origin: 50% -28px;
}
@keyframes ms-scoreboardSway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
.ms-clockT {
  font-family: 'Bebas Neue', sans-serif; font-size: 78px; color: #fbbf24; line-height: 1;
  text-shadow: 0 0 20px rgba(251, 191, 36, .8); letter-spacing: .04em;
}
.ms-clockAp { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #f59e0b; letter-spacing: .25em; }

/* GRID */
.ms-grid {
  position: absolute; top: 360px; left: 36px; right: 36px; bottom: 130px;
  display: grid; grid-template-columns: 320px 1fr 320px; grid-template-rows: 1fr 1fr; gap: 24px; z-index: 3;
}

/* WEATHER — pennant on pole */
.ms-weather { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
.ms-pole { position: absolute; left: 50%; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #94a3b8, #475569); transform: translateX(-50%); border-radius: 2px; }
.ms-pole::before {
  content: ''; position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
  width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #b45309);
}
.ms-flag {
  background: linear-gradient(135deg, #dc2626, #991b1b);
  border: 4px solid #fff; border-right: none;
  padding: 16px 36px 16px 16px;
  clip-path: polygon(0 0, 100% 0, 80% 50%, 100% 100%, 0 100%);
  width: 230px; text-align: center;
  box-shadow: 0 8px 20px rgba(0,0,0,.5);
  transform-origin: left center;
  animation: ms-flagWave 4.5s ease-in-out infinite;
  position: relative; z-index: 1;
}
@keyframes ms-flagWave { 0%, 100% { transform: rotate(-2deg) skewY(-1deg); } 50% { transform: rotate(2deg) skewY(1deg); } }
.ms-flagIcon { font-size: 56px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
.ms-flagTemp { font-family: 'Bebas Neue', sans-serif; font-size: 62px; line-height: 1; color: #fbbf24; text-shadow: 2px 2px 0 #000; }
.ms-flagDesc { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 16px; color: #fff; letter-spacing: .12em; text-transform: uppercase; text-shadow: 1px 1px 0 #000; }

/* ANNOUNCEMENT — megaphone + sound waves + bubble */
.ms-announce {
  grid-column: 2; grid-row: 1 / span 2;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
  position: relative; padding: 24px;
}
.ms-mega {
  position: absolute; left: 170px; top: 50%;
  transform: translate(0, -50%) scaleX(-1);
  font-size: 160px; line-height: 1; z-index: 4;
  filter: drop-shadow(0 8px 14px rgba(0,0,0,.5));
  animation: ms-megaShake 2.9s ease-in-out infinite;
  transform-origin: 20% 50%;
}
@keyframes ms-megaShake {
  0%, 100% { transform: translate(0, -50%) scaleX(-1) rotate(-12deg); }
  25%, 75% { transform: translate(0, -50%) scaleX(-1) rotate(12deg); }
  50%      { transform: translate(0, -50%) scaleX(-1) rotate(-12deg); }
}
.ms-wave {
  position: absolute; top: 50%; border: 6px solid #fbbf24; border-right: none; border-radius: 100%; z-index: 3;
}
.ms-wave1 { left: 30px;  width: 70px;  height: 70px;  opacity: .8;  animation: ms-soundWave 2.2s ease-out infinite; }
.ms-wave2 { left: 6px;   width: 95px;  height: 95px;  opacity: .55; animation: ms-soundWave 2.2s ease-out infinite .2s; }
.ms-wave3 { left: -22px; width: 120px; height: 120px; opacity: .35; animation: ms-soundWave 2.2s ease-out infinite .4s; }
@keyframes ms-soundWave {
  0%   { transform: translateY(-50%) scale(.5); opacity: .9; }
  100% { transform: translateY(-50%) scale(1.5); opacity: 0; }
}
.ms-bubble {
  position: relative; z-index: 1;
  background: linear-gradient(135deg, #fff, #fef3c7);
  padding: 40px 60px 40px 200px;
  border: 6px solid #000; border-radius: 32px;
  box-shadow: 12px 12px 0 #fbbf24, 16px 16px 0 #000;
  max-width: 800px;
  transform: rotate(-1deg);
  animation: ms-bubbleFloat 5.4s ease-in-out infinite;
}
@keyframes ms-bubbleFloat { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-6px); } }
.ms-annLbl { font-family: 'Bungee', cursive; font-size: 22px; color: #dc2626; letter-spacing: .15em; }
.ms-annMsg { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 64px; color: #000; line-height: 1.05; margin-top: 12px; letter-spacing: .01em; }

/* COUNTDOWN — stopwatch */
.ms-countdown { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; position: relative; }
.ms-stopwatch { width: 240px; height: 280px; position: relative; }
.ms-crown { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 32px; height: 28px;
  background: linear-gradient(135deg, #94a3b8, #475569); border-radius: 4px 4px 2px 2px;
  border: 3px solid #1e293b; z-index: 2;
}
.ms-ring {
  position: absolute; top: 24px; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at 30% 30%, #fff, #cbd5e1 60%, #475569);
  border: 8px solid #1e293b; border-radius: 50%;
  box-shadow: 0 12px 24px rgba(0,0,0,.5), inset 0 0 0 4px #cbd5e1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: ms-stopwatchTick 2.9s ease-in-out infinite;
}
@keyframes ms-stopwatchTick { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.ms-ring::before {
  content: ''; position: absolute; inset: 12px; border-radius: 50%;
  background: conic-gradient(from 0deg,
    transparent 0 8deg, #1e293b 8deg 10deg, transparent 10deg 38deg,
    transparent 38deg 70deg, #1e293b 70deg 72deg, transparent 72deg 100deg,
    transparent 100deg 132deg, #1e293b 132deg 134deg, transparent 134deg 162deg,
    transparent 162deg 194deg, #1e293b 194deg 196deg, transparent 196deg 224deg,
    transparent 224deg 256deg, #1e293b 256deg 258deg, transparent 258deg 286deg,
    transparent 286deg 318deg, #1e293b 318deg 320deg, transparent 320deg 360deg
  );
  -webkit-mask: radial-gradient(circle, transparent 78%, #000 78%, #000 92%, transparent 92%);
          mask: radial-gradient(circle, transparent 78%, #000 78%, #000 92%, transparent 92%);
}
.ms-cdLbl { font-family: 'Bungee', cursive; font-size: 14px; color: #dc2626; letter-spacing: .15em; text-transform: uppercase; z-index: 1; max-width: 170px; text-align: center; line-height: 1.1; }
.ms-cdNum { font-family: 'Bebas Neue', sans-serif; font-size: 110px; line-height: .9; color: #dc2626; text-shadow: 2px 2px 0 rgba(0,0,0,.15); z-index: 1; }
.ms-cdUnit { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #1e293b; letter-spacing: .15em; z-index: 1; }

/* TEACHER — varsity letter patch */
.ms-teacher { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.ms-patch {
  position: relative; width: 240px;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  padding: 28px 28px;
  text-align: center;
  box-shadow: 0 10px 24px rgba(0,0,0,.4);
  animation: ms-patchSwing 7.2s ease-in-out infinite;
  transform-origin: top center;
}
@keyframes ms-patchSwing { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.ms-patch::before {
  content: ''; position: absolute; inset: 12px;
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  box-shadow: inset 0 0 0 4px #dc2626;
}
.ms-patchRole { font-family: 'Bungee', cursive; font-size: 14px; color: #dc2626; letter-spacing: .12em; margin-bottom: 4px; position: relative; z-index: 1; }
.ms-patchFace { font-size: 90px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,.3)); position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; }
.ms-patchPhoto { width: 110px; height: 110px; border-radius: 50%; object-fit: cover; border: 4px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,.3); }
.ms-patchName { font-family: 'Bungee', cursive; font-size: 26px; color: #000; letter-spacing: .04em; text-shadow: 2px 2px 0 rgba(255,255,255,.3); margin-top: 4px; position: relative; z-index: 1; }

/* BIRTHDAYS — layered cake */
.ms-birthdays { grid-column: 3; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.ms-cakeWrap { position: relative; width: 220px; height: 200px; animation: ms-cakeBob 3.2s ease-in-out infinite; }
@keyframes ms-cakeBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-6px) rotate(2deg); } }
.ms-tier1 {
  position: absolute; bottom: 0; left: 30px; right: 30px; height: 80px;
  background: linear-gradient(180deg, #ec4899, #be185d);
  border-radius: 8px 8px 0 0; border: 4px solid #fff;
  box-shadow: 0 8px 16px rgba(0,0,0,.4);
}
.ms-tier1::before {
  content: ''; position: absolute; top: -10px; left: -4px; right: -4px; height: 20px;
  background: #fff;
  clip-path: polygon(
    0 100%, 100% 100%, 100% 30%,
    95% 50%, 90% 30%, 85% 50%, 80% 30%, 75% 50%, 70% 30%, 65% 50%, 60% 30%,
    55% 50%, 50% 30%, 45% 50%, 40% 30%, 35% 50%, 30% 30%, 25% 50%, 20% 30%,
    15% 50%, 10% 30%, 5% 50%, 0 30%
  );
}
.ms-tier2 {
  position: absolute; bottom: 0; left: 0; right: 0; height: 50px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-radius: 0 0 8px 8px;
  border: 4px solid #fff; border-top: none;
  box-shadow: 0 8px 16px rgba(0,0,0,.4);
}
.ms-candle {
  position: absolute; bottom: 80px; width: 8px; height: 36px;
  background: repeating-linear-gradient(180deg, #fff 0 6px, #ec4899 6px 12px);
  border-radius: 2px;
}
.ms-c1 { left: 50px; }
.ms-c2 { left: 50%; transform: translateX(-50%); }
.ms-c3 { right: 50px; }
.ms-flame {
  position: absolute; bottom: 116px; width: 14px; height: 22px;
  background: radial-gradient(circle at 50% 80%, #fbbf24, #ec4899 60%, transparent 80%);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  animation: ms-flameDance 0.7s ease-in-out infinite alternate;
}
.ms-f1 { left: 47px; }
.ms-f2 { left: 50%; transform: translateX(-50%); }
.ms-f3 { right: 47px; animation-delay: .3s; }
@keyframes ms-flameDance {
  from { transform: scaleY(1); }
  to   { transform: scaleY(1.2) rotate(2deg); }
}
.ms-bdLbl { font-family: 'Bungee', cursive; font-size: 18px; color: #fbbf24; letter-spacing: .12em; margin-top: 12px; text-shadow: 2px 2px 0 #000; }
.ms-bdNames {
  font-family: 'Permanent Marker', cursive; font-size: 30px; color: #fff;
  margin-top: 4px; line-height: 1.1; text-align: center;
  text-shadow: 2px 2px 0 #000, 4px 4px 0 #dc2626;
  max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* TICKER — black LED scroll */
.ms-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: #000;
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 6px solid #fbbf24;
  box-shadow: inset 0 0 40px rgba(251, 191, 36, .15);
}
.ms-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: #fff; display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 30px;
  border-right: 4px solid #fbbf24;
  text-shadow: 2px 2px 0 #000;
}
.ms-tickerScrollWrap { flex: 1; overflow: hidden; }
.ms-tickerScrollText {
  font-family: 'Bebas Neue', sans-serif; font-size: 56px; color: #fbbf24;
  letter-spacing: .04em; white-space: nowrap;
  text-shadow: 0 0 20px rgba(251, 191, 36, .6);
  padding-left: 100%;
  display: inline-block;
  animation: ms-tickerScroll 54s linear infinite;
}
@keyframes ms-tickerScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

/* Hotspots — shared aw-hotspot class so the same hover styling from
   globals.css applies (pink ring, soft tint). Same as elementary. */
.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(251, 191, 36, .12); box-shadow: inset 0 0 0 3px rgba(251, 191, 36, .65); }
.aw-hotspot:focus-visible { background-color: rgba(251, 191, 36, .18); box-shadow: inset 0 0 0 3px rgba(251, 191, 36, .9); }
`;
