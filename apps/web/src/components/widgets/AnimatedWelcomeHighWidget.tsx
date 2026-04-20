"use client";

/**
 * AnimatedWelcomeHighWidget — full-screen high-school welcome scene.
 *
 * ════════════════════════════════════════════════════════════════
 *  Ported from scratch/design/animated-high-school.html (v2, bright
 *  sunset palette). Same transform:scale pattern as the elementary
 *  widget. Shares the `aw-edit-section` / `aw-section-*` hotspot
 *  contract with PropertiesPanel so every shape is clickable.
 *
 *  Real shapes only:
 *  - Logo         → graduation cap (mortarboard + tassel + button)
 *  - Title        → neon-sign hanging banner with chains
 *  - Clock        → sunburst rays + neon clock face
 *  - Weather      → sun with animated rays
 *  - Announcement → real speech bubble with tail
 *  - Countdown    → trophy (handles + cup + stem + base)
 *  - Teacher      → yearbook page with corner curl
 *  - Birthdays    → confetti burst + cake
 *  - Ticker       → bright sunset strip
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
  tickerSpeed?: 'slow' | 'normal' | 'fast' | number;
}

function tickerDurationSec(speed: Cfg['tickerSpeed'], baseSec: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return baseSec * 1.8;
  if (speed === 'fast') return baseSec * 0.6;
  return baseSec;
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// HS tone is older-voice: shorter, no cutesy emoji-in-text. Cursive
// phrase to match the Caveat sub-title.
function hsWeatherPhrase(wmo: number, tempF: number): string {
  const b = tempF < 35 ? 'chilly' : tempF < 60 ? 'crisp' : tempF < 80 ? 'clear' : 'hot';
  switch (wmo) {
    case 0: case 1:                return `~ sunny + ${b} ~`;
    case 2:                        return '~ partly cloudy ~';
    case 3:                        return '~ overcast ~';
    case 45: case 48:              return '~ foggy ~';
    case 51: case 53: case 55:     return '~ light drizzle ~';
    case 61: case 80:              return '~ light rain ~';
    case 63: case 81:              return '~ rainy ~';
    case 65: case 82:              return '~ heavy rain ~';
    case 66: case 67:              return '~ freezing rain ~';
    case 71: case 73: case 85:     return '~ snow flurries ~';
    case 75: case 86:              return '~ heavy snow ~';
    case 95:                       return '~ thunderstorm ~';
    case 96: case 99:              return '~ storm + hail ~';
    default:                       return `~ ${b} day ~`;
  }
}

export function AnimatedWelcomeHighWidget({ config, live }: { config: Cfg; live?: boolean }) {
  const c = config || {};
  // Gallery thumbnails pass live=false. Skip clock tick, weather fetches,
  // AND the 70-element confetti spawn — all invisible at thumb scale and
  // expensive when 60 tiles mount simultaneously.
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
  const [weather, setWeather] = useState<{ tempF: number; wmoCode: number } | null>(null);

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
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isLive]);

  // Live weather — 3-tier resolver (ZIP → IP → default).
  useEffect(() => {
    if (!isLive) return;
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
  }, [isLive, c.weatherLocation, c.weatherUnits, c.weatherTemp]);

  // Spawn confetti once — slightly bigger pieces than elementary.
  // Skip entirely in thumbnail mode (70 pieces × 60 tiles = 4200 absolutely
  // positioned elements with infinite keyframe animations, all repainting
  // on every frame; murders scroll perf on the gallery).
  useEffect(() => {
    if (!isLive) return;
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899', '#f59e0b', '#06b6d4', '#fbbf24', '#f43f5e', '#8b5cf6', '#10b981'];
    for (let i = 0; i < 70; i++) {
      const el = document.createElement('div');
      el.className = 'hs-confetti';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 8 + Math.random() * 14;
      const dur = 6 + Math.random() * 8;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = color;
      el.style.borderRadius = isCircle ? '50%' : '3px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [isLive]);

  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...(tz ? { timeZone: tz } : {}) });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';
  // Short tz label under the clock face (e.g. "Central"). Skip if no
  // timezone configured — avoids showing a meaningless "LOCAL".
  const tzShort = (() => {
    if (!tz) return '';
    const map: Record<string, string> = {
      'America/New_York': 'EASTERN',
      'America/Chicago': 'CENTRAL',
      'America/Denver': 'MOUNTAIN',
      'America/Phoenix': 'ARIZONA',
      'America/Los_Angeles': 'PACIFIC',
      'America/Anchorage': 'ALASKA',
      'Pacific/Honolulu': 'HAWAII',
      'UTC': 'UTC',
    };
    return map[tz] || tz.split('/').pop()?.toUpperCase() || '';
  })();

  const tickerList = Array.isArray(c.tickerMessages)
    ? c.tickerMessages
    : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
  const tickerText = tickerList.length
    ? tickerList.join(' ★ ').toUpperCase()
    : 'FINAL · VARSITY 28, CENTRAL 14 ★ FAFSA WORKSHOP TUESDAY 6PM ★ YEARBOOK ORDERS DUE FRIDAY ★ COLLEGE FAIR THURSDAY ★ SENIOR TRIP SIGN-UPS CLOSE FRIDAY';

  const birthdayList: string[] = Array.isArray(c.birthdayNames)
    ? c.birthdayNames.filter(Boolean)
    : (typeof c.birthdayNames === 'string'
        ? c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean)
        : ['Alex', 'Jordan', 'Sam']);
  const bdInline = birthdayList.join(' · ');

  const days = (() => {
    if (!c.countdownDate) return c.countdownNumber ?? 42;
    const target = new Date(c.countdownDate + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
  })();
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  const teacherFace = c.teacherGender === 'female' ? '👩‍🏫' : (c.teacherEmoji || '👨‍🏫');

  const weatherTemp = c.weatherTemp || (weather ? `${weather.tempF}°` : '68°');
  const weatherDesc = c.weatherDesc || (weather ? hsWeatherPhrase(weather.wmoCode, weather.tempF) : '~ sunny + crisp ~');

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fce7f3' }}
    >
      <style>{CSS_HS}</style>

      <div
        className="hs-stage"
        style={{ width: CANVAS_W, height: CANVAS_H, transform: scale > 0 ? `scale(${scale})` : 'scale(0)', transformOrigin: 'center center', flexShrink: 0 }}
      >
        {/* Floating diploma scrolls */}
        <div className="hs-scroll hs-s1">📜</div>
        <div className="hs-scroll hs-s2">🎓</div>
        <div className="hs-scroll hs-s3">📜</div>
        <div className="hs-scroll hs-s4">🎓</div>

        <div className="hs-confettiLayer" ref={confettiRef} />

        <div className="hs-header">
          {/* Logo — graduation cap composite. Upload overrides with a
              full-circle photo so a school can brand it. */}
          <div className="hs-logo">
            {c.logoUrl ? (
              <img src={c.logoUrl} alt="" className="hs-logoImg" />
            ) : (
              <>
                <div className="hs-mortarboard" />
                <div className="hs-capBase" />
                <div className="hs-button" />
                <div className="hs-tassel" />
              </>
            )}
          </div>

          {/* Title — neon-sign banner */}
          <div className="hs-titleBanner">
            <div className="hs-chainsTop" />
            <div className="hs-neonSign">
              <h1>{c.title || 'Class of 2026'}</h1>
              <div className="hs-sub">{c.subtitle || 'make it count'}</div>
            </div>
          </div>

          {/* Clock — sunburst face */}
          <div className="hs-clock">
            <div className="hs-rays" />
            <div className="hs-face">
              <div className="hs-clockT">{hh}:{mm}</div>
              <div className="hs-clockAp">{ampm}</div>
              {tzShort && <div className="hs-clockTz">{tzShort}</div>}
            </div>
          </div>
        </div>

        <div className="hs-grid">
          {/* Weather — sun disc with rays */}
          <div className="hs-weather">
            <div className="hs-sunDisc">
              <div className="hs-sunFace">{weatherTemp}</div>
            </div>
            <div className="hs-weatherDesc">{weatherDesc}</div>
          </div>

          {/* Announcement — speech bubble with tail */}
          <div className="hs-announce">
            <div className="hs-bubble">
              <div className="hs-stars">
                <span>⭐</span><span>✨</span><span>🌟</span><span>💫</span>
              </div>
              <div className="hs-annLbl">★ {(c.announcementLabel || 'Announcement').toUpperCase()} ★</div>
              <div className="hs-annMsg">{c.announcementMessage || 'Senior portraits next week — sign up in the office.'}</div>
            </div>
          </div>

          {/* Countdown — trophy */}
          <div className="hs-countdown">
            <div className="hs-trophy">
              <div className="hs-handleL" />
              <div className="hs-handleR" />
              <div className="hs-cup">
                <div className="hs-cdLbl">{c.countdownLabel || 'Graduation in'}</div>
                <div className="hs-cdNum">{days}</div>
                <div className="hs-cdUnit">{unit}</div>
              </div>
              <div className="hs-stem" />
              <div className="hs-base" />
            </div>
          </div>

          {/* Teacher — yearbook page */}
          <div className="hs-teacher">
            <div className="hs-yearbook">
              <div className="hs-photo">
                {c.teacherPhotoUrl
                  ? <img src={c.teacherPhotoUrl} alt="" className="hs-photoImg" />
                  : <span>{teacherFace}</span>}
              </div>
              <div className="hs-pageInfo">
                <div className="hs-name">{(c.teacherName || 'MR. PATEL').toUpperCase()}</div>
                <div className="hs-role">~ {c.teacherRole || 'Teacher of the Week'} ~</div>
              </div>
            </div>
          </div>

          {/* Birthdays — confetti burst + cake */}
          <div className="hs-birthdays">
            <div className="hs-burst">
              <div className="hs-cake">🎂</div>
            </div>
            <div className="hs-bdLbl">★ Birthdays Today ★</div>
            <div className="hs-bdNames">{bdInline}</div>
          </div>
        </div>

        {/* Ticker */}
        <div className="hs-ticker">
          <div className="hs-tickerStamp">{(c.tickerStamp || 'CAMPUS NEWS').toUpperCase()}</div>
          <div className="hs-tickerScrollWrap">
            <span
              className="hs-tickerScrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 57.6)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — builder-only, gated on !isLive. */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={36}   y={36}  w={220}  h={220} />
            <Hotspot section="header"       x={284}  y={36}  w={1352} h={220} />
            <Hotspot section="header"       x={1664} y={36}  w={220}  h={220} />
            <Hotspot section="weather"      x={36}   y={290} w={320}  h={320} />
            <Hotspot section="announcement" x={384}  y={290} w={1152} h={650} />
            <Hotspot section="countdown"    x={1564} y={290} w={320}  h={320} />
            <Hotspot section="teacher"      x={36}   y={620} w={320}  h={320} />
            <Hotspot section="birthdays"    x={1564} y={620} w={320}  h={320} />
            <Hotspot section="ticker"       x={0}    y={970} w={1920} h={110} />
          </>
        )}
      </div>
    </div>
  );
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

// All pixel sizes match scratch/design/animated-high-school.html.
// Class prefix is `hs-` so it cannot collide with `aw-` / `ms-` on
// the same page. Font imports duplicated across widgets are fine —
// the browser dedupes the stylesheet fetch.
const CSS_HS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Inter:wght@600;800&family=Caveat:wght@700&display=swap');

.hs-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 100%, #fbbf24 0%, transparent 55%),
    radial-gradient(ellipse at 0% 0%, #ec4899 0%, transparent 50%),
    radial-gradient(ellipse at 100% 0%, #06b6d4 0%, transparent 50%),
    linear-gradient(180deg, #fce7f3 0%, #ffe4e6 30%, #fef3c7 70%, #fed7aa 100%);
  overflow: hidden;
}
.hs-confettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.hs-confetti {
  position: absolute; top: -30px; width: 14px; height: 22px; border-radius: 3px;
  animation: hs-confettiFall linear infinite; will-change: transform;
}
@keyframes hs-confettiFall {
  0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
  8% { opacity: 1; }
  100% { transform: translateY(1110px) rotate(900deg); opacity: .9; }
}

.hs-scroll { position: absolute; font-size: 80px; opacity: .2; animation: hs-scrollFloat 21.6s ease-in-out infinite; z-index: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,.2)); }
.hs-s1 { top: 12%; left: 4%; animation-delay: 0s; }
.hs-s2 { top: 70%; left: 8%; animation-delay: -3s; font-size: 60px; }
.hs-s3 { top: 20%; right: 3%; animation-delay: -6s; }
.hs-s4 { top: 60%; right: 6%; animation-delay: -9s; font-size: 70px; }
@keyframes hs-scrollFloat { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-30px) rotate(8deg); } }

/* HEADER */
.hs-header {
  position: absolute; top: 36px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 220px 1fr 220px; gap: 36px; z-index: 5; align-items: start;
}

/* LOGO — graduation cap */
.hs-logo { position: relative; width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; animation: hs-capTilt 5.4s ease-in-out infinite; }
.hs-logoImg { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; border: 6px solid #ec4899; box-shadow: 0 8px 24px rgba(236, 72, 153, .4); }
@keyframes hs-capTilt { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
.hs-capBase {
  position: absolute; top: 80px; left: 50%; transform: translateX(-50%);
  width: 130px; height: 90px;
  background: radial-gradient(ellipse at 50% 30%, #1f2937, #0a0e27);
  border-radius: 50% 50% 30% 30% / 60% 60% 40% 40%;
  box-shadow: 0 8px 16px rgba(0,0,0,.4);
}
.hs-mortarboard {
  position: absolute; top: 60px; left: 50%; transform: translateX(-50%) rotate(-8deg);
  width: 180px; height: 180px;
  background: linear-gradient(135deg, #1f2937, #0a0e27);
  box-shadow: 0 12px 24px rgba(0,0,0,.4);
  border-radius: 6px;
}
.hs-button {
  position: absolute; top: 132px; left: 50%; transform: translateX(-50%);
  width: 18px; height: 18px;
  background: radial-gradient(circle at 30% 30%, #fbbf24, #d97706);
  border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,.5); z-index: 2;
}
.hs-tassel {
  position: absolute; top: 145px; left: 50%;
  width: 4px; height: 70px;
  background: linear-gradient(180deg, #fbbf24, #f59e0b);
  transform-origin: top center;
  animation: hs-tasselSwing 3.6s ease-in-out infinite;
  z-index: 2;
}
@keyframes hs-tasselSwing { 0%, 100% { transform: translateX(-50%) rotate(-15deg); } 50% { transform: translateX(-50%) rotate(15deg); } }
.hs-tassel::after {
  content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  width: 24px; height: 36px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-radius: 6px;
  background-image: repeating-linear-gradient(180deg, transparent 0 4px, rgba(0,0,0,.15) 4px 5px);
  box-shadow: 0 4px 8px rgba(0,0,0,.3);
}

/* TITLE — neon sign banner */
.hs-titleBanner { position: relative; padding-top: 20px; }
.hs-chainsTop {
  position: absolute; top: 0; left: 15%; right: 15%; height: 30px;
  background: linear-gradient(90deg,
    transparent 0% 8%, #94a3b8 8% 9%, transparent 9% 14%, #94a3b8 14% 15%, transparent 15%);
  background-size: 22px 100%; background-repeat: repeat-x;
}
.hs-neonSign {
  background: linear-gradient(135deg, #fff 0%, #fef3c7 100%);
  border: 6px solid #ec4899;
  border-radius: 24px;
  padding: 24px 40px;
  text-align: center;
  box-shadow:
    0 0 0 4px #fff,
    0 0 0 10px #ec4899,
    0 0 30px rgba(236, 72, 153, .5),
    0 16px 32px rgba(0,0,0,.2);
  animation: hs-neonBuzz 5.4s ease-in-out infinite;
  position: relative;
}
@keyframes hs-neonBuzz {
  0%, 95%, 100% { box-shadow: 0 0 0 4px #fff, 0 0 0 10px #ec4899, 0 0 30px rgba(236, 72, 153, .5), 0 16px 32px rgba(0,0,0,.2); }
  97%           { box-shadow: 0 0 0 4px #fff, 0 0 0 10px #ec4899, 0 0 60px rgba(236, 72, 153, .9), 0 16px 32px rgba(0,0,0,.2); }
}
.hs-neonSign h1 {
  margin: 0; line-height: .9;
  font-family: 'Anton', sans-serif; font-size: 96px;
  background: linear-gradient(135deg, #ec4899 0%, #f59e0b 50%, #06b6d4 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: hs-titleShift 9s linear infinite;
  letter-spacing: -.01em; text-transform: uppercase;
}
@keyframes hs-titleShift { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
.hs-sub { font-family: 'Caveat', cursive; font-size: 36px; color: #ec4899; margin-top: 4px; }

/* CLOCK — sunburst */
.hs-clock { position: relative; width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; }
.hs-rays {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg,
    #fbbf24 0 20deg, transparent 20deg 40deg,
    #ec4899 40deg 60deg, transparent 60deg 80deg,
    #06b6d4 80deg 100deg, transparent 100deg 120deg,
    #fbbf24 120deg 140deg, transparent 140deg 160deg,
    #ec4899 160deg 180deg, transparent 180deg 200deg,
    #06b6d4 200deg 220deg, transparent 220deg 240deg,
    #fbbf24 240deg 260deg, transparent 260deg 280deg,
    #ec4899 280deg 300deg, transparent 300deg 320deg,
    #06b6d4 320deg 340deg, transparent 340deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 70px, #000 70px, #000 100px, transparent 100px);
          mask: radial-gradient(circle, transparent 70px, #000 70px, #000 100px, transparent 100px);
  animation: hs-raysSpin 54s linear infinite;
}
@keyframes hs-raysSpin { to { transform: rotate(360deg); } }
.hs-face {
  width: 160px; height: 160px; border-radius: 50%;
  background: linear-gradient(135deg, #fff, #fef3c7);
  border: 6px solid #ec4899;
  box-shadow: 0 8px 24px rgba(236, 72, 153, .4), inset 0 0 30px rgba(251, 191, 36, .3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; z-index: 1;
  animation: hs-clockBob 3.6s ease-in-out infinite;
}
@keyframes hs-clockBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.hs-clockT {
  font-family: 'Anton', sans-serif; font-size: 52px; line-height: 1;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hs-clockAp { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 20px; color: #ec4899; letter-spacing: .15em; }
.hs-clockTz { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 10px; color: #94a3b8; letter-spacing: .15em; margin-top: 2px; }

/* GRID */
.hs-grid {
  position: absolute; top: 290px; left: 36px; right: 36px; bottom: 130px;
  display: grid; grid-template-columns: 320px 1fr 320px; grid-template-rows: 1fr 1fr; gap: 28px; z-index: 3;
}

/* WEATHER — sun with rays */
.hs-weather { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
.hs-sunDisc { position: relative; width: 240px; height: 240px; display: flex; align-items: center; justify-content: center; }
.hs-sunDisc::before {
  content: ''; position: absolute; inset: -40px; border-radius: 50%;
  background: conic-gradient(from 0deg,
    transparent 0 18deg, #fbbf24 18deg 24deg,
    transparent 24deg 48deg, #f59e0b 48deg 54deg,
    transparent 54deg 78deg, #fbbf24 78deg 84deg,
    transparent 84deg 108deg, #f59e0b 108deg 114deg,
    transparent 114deg 138deg, #fbbf24 138deg 144deg,
    transparent 144deg 168deg, #f59e0b 168deg 174deg,
    transparent 174deg 198deg, #fbbf24 198deg 204deg,
    transparent 204deg 228deg, #f59e0b 228deg 234deg,
    transparent 234deg 258deg, #fbbf24 258deg 264deg,
    transparent 264deg 288deg, #f59e0b 288deg 294deg,
    transparent 294deg 318deg, #fbbf24 318deg 324deg,
    transparent 324deg 348deg, #f59e0b 348deg 354deg,
    transparent 354deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 110px, #000 110px, #000 145px, transparent 145px);
          mask: radial-gradient(circle, transparent 110px, #000 110px, #000 145px, transparent 145px);
  animation: hs-sunSpin 32.4s linear infinite;
}
@keyframes hs-sunSpin { to { transform: rotate(360deg); } }
.hs-sunFace {
  width: 200px; height: 200px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 60px rgba(251, 191, 36, .65), inset 0 -12px 20px rgba(180, 83, 9, .25);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Anton', sans-serif; font-weight: 700; font-size: 64px; color: #7c2d12;
  text-shadow: 0 2px 0 rgba(255,255,255,.4);
}
.hs-weatherDesc {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px; color: #b45309;
  margin-top: 16px; text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}

/* ANNOUNCEMENT — speech bubble with tail */
.hs-announce {
  grid-column: 2; grid-row: 1 / span 2;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
  position: relative; padding: 24px;
}
.hs-bubble {
  position: relative;
  background: linear-gradient(135deg, #fff, #fef3c7);
  padding: 60px 56px;
  border: 6px solid #ec4899; border-radius: 32px;
  box-shadow: 0 16px 40px rgba(236, 72, 153, .3), 12px 12px 0 #fbbf24, 16px 16px 0 #1f2937;
  max-width: 800px;
  animation: hs-bubbleFloat 6.3s ease-in-out infinite;
  transform: rotate(-1deg);
}
@keyframes hs-bubbleFloat { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-8px); } }
.hs-bubble::after {
  content: ''; position: absolute; bottom: -28px; right: 80px;
  width: 60px; height: 60px;
  background: linear-gradient(135deg, #fff, #fef3c7);
  clip-path: polygon(0 0, 100% 0, 30% 100%);
  border-right: 6px solid #ec4899; border-bottom: 6px solid #ec4899;
}
.hs-stars { position: absolute; inset: 0; pointer-events: none; }
.hs-stars span { position: absolute; font-size: 40px; opacity: .9; animation: hs-twinkle 2.5s ease-in-out infinite; }
.hs-stars span:nth-child(1) { top: 4%;  left: 8%; }
.hs-stars span:nth-child(2) { top: 8%;  right: 12%; animation-delay: .3s; }
.hs-stars span:nth-child(3) { bottom: 8%; left: 14%; animation-delay: .6s; }
.hs-stars span:nth-child(4) { bottom: 4%; right: 10%; animation-delay: .9s; }
@keyframes hs-twinkle {
  0%, 100% { opacity: .25; transform: scale(.8) rotate(0deg); }
  50%      { opacity: 1;   transform: scale(1.2) rotate(20deg); }
}
.hs-annLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 22px; color: #ec4899; letter-spacing: .25em; text-transform: uppercase; }
.hs-annMsg { font-family: 'Anton', sans-serif; font-size: 76px; color: #1f2937; line-height: 1.05; margin-top: 12px; letter-spacing: -.01em; }

/* COUNTDOWN — trophy */
.hs-countdown { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; position: relative; }
.hs-trophy { position: relative; width: 240px; height: 280px; display: flex; flex-direction: column; align-items: center; animation: hs-trophyShine 5.4s ease-in-out infinite; }
@keyframes hs-trophyShine { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
.hs-handleL, .hs-handleR {
  position: absolute; top: 30px; width: 50px; height: 70px;
  border: 10px solid #fbbf24; border-radius: 50%; z-index: 0;
}
.hs-handleL { left: 0; border-right: none; border-radius: 50% 0 0 50%; }
.hs-handleR { right: 0; border-left: none; border-radius: 0 50% 50% 0; }
.hs-cup {
  width: 180px; height: 160px;
  background: linear-gradient(180deg, #fde68a 0%, #fbbf24 50%, #d97706 100%);
  border: 6px solid #92400e;
  border-radius: 12px 12px 50% 50% / 12px 12px 30% 30%;
  box-shadow: 0 12px 24px rgba(0,0,0,.3), inset 0 0 20px rgba(255,255,255,.3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; position: relative; z-index: 1;
}
.hs-cdLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 14px; color: #92400e; letter-spacing: .12em; text-transform: uppercase; text-align: center; padding: 0 4px; line-height: 1.1; }
.hs-cdNum { font-family: 'Anton', sans-serif; font-size: 80px; line-height: .9; color: #fff; text-shadow: 3px 3px 0 #92400e; }
.hs-cdUnit { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 14px; color: #92400e; letter-spacing: .15em; }
.hs-stem {
  width: 40px; height: 30px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-left: 4px solid #92400e; border-right: 4px solid #92400e;
  margin-top: -4px; position: relative; z-index: 1;
}
.hs-base {
  width: 140px; height: 30px;
  background: linear-gradient(180deg, #fbbf24, #b45309);
  border: 5px solid #92400e; border-radius: 8px;
  box-shadow: 0 6px 12px rgba(0,0,0,.3);
  position: relative; z-index: 1;
}

/* TEACHER — yearbook page */
.hs-teacher { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.hs-yearbook {
  position: relative; width: 240px; padding: 14px;
  background: #fff; border: 4px solid #ec4899;
  box-shadow: 0 10px 24px rgba(0,0,0,.3);
  transform: rotate(-3deg);
  animation: hs-yearbookSlide 9s ease-in-out infinite;
}
@keyframes hs-yearbookSlide { 0%, 100% { transform: rotate(-3deg) translateX(-3px); } 50% { transform: rotate(-3deg) translateX(3px); } }
.hs-yearbook::before {
  content: ''; position: absolute; bottom: 0; right: 0;
  width: 30px; height: 30px;
  background: linear-gradient(135deg, transparent 50%, #ec4899 50%);
}
.hs-yearbook::after {
  content: ''; position: absolute; bottom: 5px; right: 5px;
  width: 20px; height: 20px;
  background: linear-gradient(135deg, transparent 50%, rgba(0,0,0,.2) 50%);
}
.hs-photo {
  width: 100%; aspect-ratio: 1;
  background: linear-gradient(135deg, #06b6d4, #0e7490);
  display: flex; align-items: center; justify-content: center;
  font-size: 110px; overflow: hidden;
}
.hs-photoImg { width: 100%; height: 100%; object-fit: cover; }
.hs-pageInfo { margin-top: 12px; text-align: center; }
.hs-name { font-family: 'Anton', sans-serif; font-size: 24px; color: #1f2937; line-height: 1; letter-spacing: .02em; }
.hs-role { font-family: 'Caveat', cursive; font-weight: 700; font-size: 22px; color: #ec4899; margin-top: 2px; }

/* BIRTHDAYS — confetti burst + cake */
.hs-birthdays { grid-column: 3; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.hs-burst { position: relative; width: 200px; height: 160px; animation: hs-burstSpin 10.8s linear infinite; }
@keyframes hs-burstSpin { from { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } to { transform: rotate(-5deg); } }
.hs-burst::before {
  content: ''; position: absolute; inset: -30px;
  background: conic-gradient(from 0deg,
    #fbbf24 0 12deg, transparent 12deg 30deg,
    #ec4899 30deg 42deg, transparent 42deg 60deg,
    #06b6d4 60deg 72deg, transparent 72deg 90deg,
    #fbbf24 90deg 102deg, transparent 102deg 120deg,
    #ec4899 120deg 132deg, transparent 132deg 150deg,
    #06b6d4 150deg 162deg, transparent 162deg 180deg,
    #fbbf24 180deg 192deg, transparent 192deg 210deg,
    #ec4899 210deg 222deg, transparent 222deg 240deg,
    #06b6d4 240deg 252deg, transparent 252deg 270deg,
    #fbbf24 270deg 282deg, transparent 282deg 300deg,
    #ec4899 300deg 312deg, transparent 312deg 330deg,
    #06b6d4 330deg 342deg, transparent 342deg 360deg);
  border-radius: 50%;
  -webkit-mask: radial-gradient(circle, #000 60px, transparent 95px);
          mask: radial-gradient(circle, #000 60px, transparent 95px);
  opacity: .4;
}
.hs-cake { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 100px; line-height: 1; filter: drop-shadow(0 6px 12px rgba(0,0,0,.4)); }
.hs-bdLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 18px; color: #ec4899; letter-spacing: .12em; text-transform: uppercase; margin-top: 14px; }
.hs-bdNames {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px;
  color: #1f2937; line-height: 1.05; text-align: center; margin-top: 4px;
  max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* TICKER */
.hs-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 100%);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 5px solid #fff;
  box-shadow: 0 -8px 24px rgba(236, 72, 153, .3);
}
.hs-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: #1f2937; color: #fbbf24;
  display: flex; align-items: center;
  font-family: 'Anton', sans-serif; letter-spacing: .15em; font-size: 32px;
}
.hs-tickerScrollWrap { flex: 1; overflow: hidden; }
.hs-tickerScrollText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 38px; color: #fff;
  white-space: nowrap; text-shadow: 2px 2px 0 #1f2937;
  padding-left: 100%;
  display: inline-block;
  animation: hs-tickerScroll 57.6s linear infinite;
}
@keyframes hs-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

/* Hotspots — shared class so global aw-section-flash keyframe styling
   still applies. Override hover tint to match HS palette. */
.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
