"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.

/**
 * AnimatedWelcomeHighPortraitWidget — 2160×3840 4K portrait HS welcome.
 *
 * ════════════════════════════════════════════════════════════════
 *  Native 4K portrait companion to AnimatedWelcomeHighWidget. Same
 *  config shape (Cfg) so admins can swap orientations without
 *  reconfiguring. Uses the canonical transform:scale wrapper from
 *  AnimatedWelcomePortraitWidget — outer div measures parent,
 *  inner stage is FIXED 2160×3840, scaled by `transform: scale(N)`.
 *  Every dimension inside is plain pixels (NO vw/vh/%).
 *
 *  Layout (vertical stack on a 2160×3840 portrait stage, after
 *  the sunset-bg + confetti + floating-scrolls layers):
 *    1. Header band ~900px — graduation-cap logo + neon-sign title
 *       + school name underneath.
 *    2. Sunburst clock card ~700px — full-width neon clock face
 *       with conic-gradient rays rotating slowly.
 *    3. Yearbook polaroid + speech-bubble announcement ~700px
 *       — 2-up row, teacher on left, bubble on right.
 *    4. Trophy countdown card ~700px — full-width golden trophy
 *       CSS-art with handles, cup, stem, base.
 *    5. Confetti birthdays strip ~400px — animated confetti
 *       layer behind a row of name pills.
 *    6. Animated LED ticker ~440px — sunset-gradient strip with
 *       dark stamp + scrolling marquee.
 *
 *  All HS shapes ported and scaled 2× from the landscape widget so
 *  visual rhythm is preserved at 4K. Class prefix is `hsp-` so it
 *  cannot collide with `hs-` (landscape) or `awp-` (rainbow
 *  portrait) on the same page.
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

// Native 4K portrait canvas — twice the resolution of the rainbow
// portrait widget. Outer wrapper rescales via transform:scale to
// whatever the parent zone provides (gallery thumb, builder canvas,
// production 2160×3840 panel).
const CANVAS_W = 2160;
const CANVAS_H = 3840;

const BASE_TICKER_SEC = 60;

function tickerDurationSec(speed: Cfg['tickerSpeed'], baseSec: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return baseSec * 1.8;
  if (speed === 'fast') return baseSec * 0.6;
  return baseSec;
}

// Older-voice cursive phrase to match Caveat sub-title — same HS-tone
// mapping the landscape widget uses. Kept duplicated rather than
// shared so this widget is one self-contained file per CLAUDE.md.
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

export function AnimatedWelcomeHighPortraitWidget({
  config,
  live,
}: {
  config?: Cfg;
  live?: boolean;
}) {
  const c: Cfg = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const bdConfettiRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
  const [weather, setWeather] = useState<{ tempF: number; wmoCode: number } | null>(null);

  // Scale 2160×3840 stage to fit container. offsetWidth/Height (not
  // getBoundingClientRect) so parent transforms don't double-apply —
  // ScaledTemplateThumbnail wraps us in another scale too.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
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

  // Live weather — same 3-tier resolver (ZIP → IP → default) as the
  // landscape widget. Hard-skipped in thumbnail mode (when ~60 tiles
  // mount they'd otherwise hammer ipapi.co simultaneously).
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

  // Spawn full-stage confetti (90 pieces, scaled up from landscape's
  // 70 because we have 4× the canvas area). Skip in thumbnail mode.
  useEffect(() => {
    if (!isLive) return;
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899', '#f59e0b', '#06b6d4', '#fbbf24', '#f43f5e', '#8b5cf6', '#10b981'];
    for (let i = 0; i < 90; i++) {
      const el = document.createElement('div');
      el.className = 'hsp-confetti';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 16 + Math.random() * 28;
      const dur = 6 + Math.random() * 8;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = color;
      el.style.borderRadius = isCircle ? '50%' : '6px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [isLive]);

  // Spawn smaller confetti within the birthdays strip — denser but
  // shorter fall, so the strip itself feels animated.
  useEffect(() => {
    if (!isLive) return;
    const layer = bdConfettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899', '#f59e0b', '#06b6d4', '#fbbf24', '#f43f5e', '#8b5cf6'];
    for (let i = 0; i < 36; i++) {
      const el = document.createElement('div');
      el.className = 'hsp-bdConfetti';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 12 + Math.random() * 20;
      const dur = 3 + Math.random() * 4;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = color;
      el.style.borderRadius = isCircle ? '50%' : '4px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [isLive]);

  // ─── Clock formatting ───
  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...(tz ? { timeZone: tz } : {}) });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';
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

  // ─── Ticker / birthdays ───
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

  // ─── Countdown ───
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
      <style>{CSS_HSP}</style>

      <div
        className="hsp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Floating diploma scrolls — corners of the tall canvas */}
        <div className="hsp-scroll hsp-s1">📜</div>
        <div className="hsp-scroll hsp-s2">🎓</div>
        <div className="hsp-scroll hsp-s3">📜</div>
        <div className="hsp-scroll hsp-s4">🎓</div>
        <div className="hsp-scroll hsp-s5">📜</div>
        <div className="hsp-scroll hsp-s6">🎓</div>

        <div className="hsp-confettiLayer" ref={confettiRef} />

        {/* ─── 1. HEADER (~900px): grad-cap logo + neon WELCOME + school name ─── */}
        <div className="hsp-header">
          <div className="hsp-logoWrap">
            <div className="hsp-logo">
              {c.logoUrl ? (
                <img src={c.logoUrl} alt="" className="hsp-logoImg" />
              ) : (
                <>
                  <div className="hsp-mortarboard" />
                  <div className="hsp-capBase" />
                  <div className="hsp-button" />
                  <div className="hsp-tassel" />
                </>
              )}
            </div>
          </div>

          <div className="hsp-titleBanner">
            <div className="hsp-chainsTop" />
            <div className="hsp-neonSign">
              <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'WELCOME'}</h1>
            </div>
          </div>

          <div className="hsp-schoolName" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {c.subtitle || 'Class of 2026 — make it count'}
          </div>
        </div>

        {/* ─── 2. CLOCK CARD (~700px) — full-width sunburst clock ─── */}
        <div className="hsp-clockCard">
          <div className="hsp-clock">
            <div className="hsp-rays" />
            <div className="hsp-face">
              <div className="hsp-clockT">{hh}:{mm}</div>
              <div className="hsp-clockAp">{ampm}</div>
              {tzShort && <div className="hsp-clockTz">{tzShort}</div>}
            </div>
          </div>
          <div className="hsp-weatherInline">
            <div className="hsp-sunMini">
              <div className="hsp-sunMiniFace">{weatherTemp}</div>
            </div>
            <div className="hsp-weatherDesc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{weatherDesc}</div>
          </div>
        </div>

        {/* ─── 3. TEACHER + ANNOUNCEMENT (~700px) — 2-up row ─── */}
        <div className="hsp-row3">
          <div className="hsp-teacher">
            <div className="hsp-yearbook">
              <div className="hsp-photo">
                {c.teacherPhotoUrl
                  ? <img src={c.teacherPhotoUrl} alt="" className="hsp-photoImg" />
                  : <span>{teacherFace}</span>}
              </div>
              <div className="hsp-pageInfo">
                <div className="hsp-name" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' }}>{(c.teacherName || 'MR. PATEL').toUpperCase()}</div>
                <div className="hsp-role" data-field="teacherRole" style={{ whiteSpace: 'pre-wrap' }}>~ {c.teacherRole || 'Teacher of the Week'} ~</div>
              </div>
            </div>
          </div>

          <div className="hsp-announce">
            <div className="hsp-bubble">
              <div className="hsp-stars">
                <span>⭐</span><span>✨</span><span>🌟</span><span>💫</span>
              </div>
              <div className="hsp-annLbl" data-field="announcementLabel" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.announcementLabel || 'Announcement').toUpperCase()} ★</div>
              <div className="hsp-annMsg" data-field="announcementMessage" style={{ whiteSpace: 'pre-wrap' }}>{c.announcementMessage || 'Senior portraits next week — sign up in the office.'}</div>
            </div>
          </div>
        </div>

        {/* ─── 4. TROPHY COUNTDOWN (~700px) — full-width golden trophy ─── */}
        <div className="hsp-countdownCard">
          <div className="hsp-trophy">
            <div className="hsp-handleL" />
            <div className="hsp-handleR" />
            <div className="hsp-cup">
              <div className="hsp-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Big Game in'}</div>
              <div className="hsp-cdNum">{days}</div>
              <div className="hsp-cdUnit">{unit}</div>
            </div>
            <div className="hsp-stem" />
            <div className="hsp-base" />
          </div>
        </div>

        {/* ─── 5. BIRTHDAYS STRIP (~400px) — confetti behind name pills ─── */}
        <div className="hsp-birthdays">
          <div className="hsp-bdConfettiLayer" ref={bdConfettiRef} />
          <div className="hsp-bdContent">
            <div className="hsp-bdLbl">★ Birthdays Today ★</div>
            <div className="hsp-bdPills">
              {birthdayList.map((name, i) => (
                <div key={`${name}-${i}`} className={`hsp-bdPill hsp-bdPill${(i % 4) + 1}`}>
                  <span className="hsp-bdCake">🎂</span>
                  <span className="hsp-bdName">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── 6. TICKER (~440px footer) ─── */}
        <div className="hsp-ticker">
          <div className="hsp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'CAMPUS NEWS').toUpperCase()}</div>
          <div className="hsp-tickerScrollWrap">
            <span
              className="hsp-tickerScrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, BASE_TICKER_SEC)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — builder-only. Coords match the vertical layout
            above; widths span the full 2160px stage minus 40px gutters. */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={40}   y={40}    w={2080} h={900} />
            <Hotspot section="header"       x={40}   y={40}    w={2080} h={520} />
            <Hotspot section="header"       x={40}   y={580}   w={2080} h={360} />
            <Hotspot section="weather"      x={40}   y={960}   w={2080} h={700} />
            <Hotspot section="teacher"      x={40}   y={1680}  w={1020} h={700} />
            <Hotspot section="announcement" x={1100} y={1680}  w={1020} h={700} />
            <Hotspot section="countdown"    x={40}   y={2400}  w={2080} h={700} />
            <Hotspot section="birthdays"    x={40}   y={3120}  w={2080} h={400} />
            <Hotspot section="ticker"       x={0}    y={3540}  w={2160} h={300} />
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

// All pixel sizes are 2× the landscape recipe so the visual rhythm
// scales cleanly to 4K. Class prefix `hsp-` so it cannot collide
// with `hs-` (HS landscape) or `awp-` (rainbow portrait). Font
// imports duplicated across widgets are fine — browser dedupes.
const CSS_HSP = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Inter:wght@600;800&family=Caveat:wght@700&display=swap');

.hsp-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 100%, #fbbf24 0%, transparent 55%),
    radial-gradient(ellipse at 0% 0%, #ec4899 0%, transparent 50%),
    radial-gradient(ellipse at 100% 0%, #06b6d4 0%, transparent 50%),
    linear-gradient(180deg, #fce7f3 0%, #ffe4e6 30%, #fef3c7 70%, #fed7aa 100%);
  overflow: hidden;
}
.hsp-confettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.hsp-confetti {
  position: absolute; top: -60px; width: 28px; height: 44px; border-radius: 6px;
  animation: hsp-confettiFall linear infinite; will-change: transform;
}
@keyframes hsp-confettiFall {
  0% { transform: translateY(-60px) rotate(0deg); opacity: 0; }
  6% { opacity: 1; }
  100% { transform: translateY(3920px) rotate(900deg); opacity: .9; }
}

.hsp-scroll { position: absolute; font-size: 160px; opacity: .18; animation: hsp-scrollFloat 21.6s ease-in-out infinite; z-index: 1; filter: drop-shadow(0 6px 16px rgba(0,0,0,.2)); }
.hsp-s1 { top: 6%;  left: 3%;  animation-delay: 0s; }
.hsp-s2 { top: 32%; left: 5%;  animation-delay: -3s; font-size: 130px; }
.hsp-s3 { top: 60%; right: 3%; animation-delay: -6s; }
.hsp-s4 { top: 78%; left: 4%;  animation-delay: -9s; font-size: 140px; }
.hsp-s5 { top: 22%; right: 5%; animation-delay: -12s; font-size: 120px; }
.hsp-s6 { top: 48%; left: 6%;  animation-delay: -15s; font-size: 150px; }
@keyframes hsp-scrollFloat { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-50px) rotate(8deg); } }

/* ─── 1. HEADER (top 900px) ─── */
.hsp-header {
  position: absolute; top: 40px; left: 40px; right: 40px; height: 900px;
  z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 16px;
}

.hsp-logoWrap { width: 100%; height: 360px; display: flex; align-items: center; justify-content: center; position: relative; }
.hsp-logo {
  position: relative; width: 360px; height: 360px;
  display: flex; align-items: center; justify-content: center;
  animation: hsp-capTilt 5.4s ease-in-out infinite;
}
.hsp-logoImg { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; border: 12px solid #ec4899; box-shadow: 0 16px 48px rgba(236, 72, 153, .4); }
@keyframes hsp-capTilt { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
.hsp-capBase {
  position: absolute; top: 130px; left: 50%; transform: translateX(-50%);
  width: 230px; height: 160px;
  background: radial-gradient(ellipse at 50% 30%, #1f2937, #0a0e27);
  border-radius: 50% 50% 30% 30% / 60% 60% 40% 40%;
  box-shadow: 0 14px 28px rgba(0,0,0,.4);
}
.hsp-mortarboard {
  position: absolute; top: 100px; left: 50%; transform: translateX(-50%) rotate(-8deg);
  width: 320px; height: 320px;
  background: linear-gradient(135deg, #1f2937, #0a0e27);
  box-shadow: 0 20px 40px rgba(0,0,0,.4);
  border-radius: 12px;
}
.hsp-button {
  position: absolute; top: 230px; left: 50%; transform: translateX(-50%);
  width: 32px; height: 32px;
  background: radial-gradient(circle at 30% 30%, #fbbf24, #d97706);
  border-radius: 50%; box-shadow: 0 4px 8px rgba(0,0,0,.5); z-index: 2;
}
.hsp-tassel {
  position: absolute; top: 250px; left: 50%;
  width: 8px; height: 130px;
  background: linear-gradient(180deg, #fbbf24, #f59e0b);
  transform-origin: top center;
  animation: hsp-tasselSwing 3.6s ease-in-out infinite;
  z-index: 2;
}
@keyframes hsp-tasselSwing { 0%, 100% { transform: translateX(-50%) rotate(-15deg); } 50% { transform: translateX(-50%) rotate(15deg); } }
.hsp-tassel::after {
  content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  width: 44px; height: 70px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-radius: 12px;
  background-image: repeating-linear-gradient(180deg, transparent 0 6px, rgba(0,0,0,.15) 6px 8px);
  box-shadow: 0 6px 14px rgba(0,0,0,.3);
}

.hsp-titleBanner { position: relative; padding-top: 36px; width: 100%; max-width: 1900px; }
.hsp-chainsTop {
  position: absolute; top: 0; left: 18%; right: 18%; height: 50px;
  background: linear-gradient(90deg,
    transparent 0% 8%, #94a3b8 8% 9%, transparent 9% 14%, #94a3b8 14% 15%, transparent 15%);
  background-size: 38px 100%; background-repeat: repeat-x;
}
.hsp-neonSign {
  background: linear-gradient(135deg, #fff 0%, #fef3c7 100%);
  border: 12px solid #ec4899;
  border-radius: 44px;
  padding: 36px 56px;
  text-align: center;
  box-shadow:
    0 0 0 8px #fff,
    0 0 0 20px #ec4899,
    0 0 60px rgba(236, 72, 153, .55),
    0 28px 60px rgba(0,0,0,.22);
  animation: hsp-neonBuzz 5.4s ease-in-out infinite;
  position: relative;
}
@keyframes hsp-neonBuzz {
  0%, 95%, 100% { box-shadow: 0 0 0 8px #fff, 0 0 0 20px #ec4899, 0 0 60px rgba(236, 72, 153, .55), 0 28px 60px rgba(0,0,0,.22); }
  97%           { box-shadow: 0 0 0 8px #fff, 0 0 0 20px #ec4899, 0 0 120px rgba(236, 72, 153, .95), 0 28px 60px rgba(0,0,0,.22); }
}
.hsp-neonSign h1 {
  margin: 0; line-height: .9;
  font-family: 'Anton', sans-serif; font-size: 280px;
  background: linear-gradient(135deg, #ec4899 0%, #f59e0b 50%, #06b6d4 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: hsp-titleShift 9s linear infinite;
  letter-spacing: -.01em; text-transform: uppercase;
}
@keyframes hsp-titleShift { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }

.hsp-schoolName {
  font-family: 'Caveat', cursive; font-size: 110px; color: #ec4899;
  text-align: center; line-height: 1.1; margin-top: 8px;
  text-shadow: 0 4px 0 rgba(255,255,255,.6);
  max-width: 1900px;
}

/* ─── 2. CLOCK CARD ─── */
.hsp-clockCard {
  position: absolute; top: 960px; left: 40px; right: 40px; height: 700px;
  z-index: 5; display: flex; align-items: center; justify-content: space-around; padding: 0 60px;
}
.hsp-clock { position: relative; width: 600px; height: 600px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.hsp-rays {
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
  -webkit-mask: radial-gradient(circle, transparent 200px, #000 200px, #000 290px, transparent 290px);
          mask: radial-gradient(circle, transparent 200px, #000 200px, #000 290px, transparent 290px);
  animation: hsp-raysSpin 54s linear infinite;
}
@keyframes hsp-raysSpin { to { transform: rotate(360deg); } }
.hsp-face {
  width: 460px; height: 460px; border-radius: 50%;
  background: linear-gradient(135deg, #fff, #fef3c7);
  border: 14px solid #ec4899;
  box-shadow: 0 20px 60px rgba(236, 72, 153, .4), inset 0 0 80px rgba(251, 191, 36, .3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; z-index: 1;
  animation: hsp-clockBob 3.6s ease-in-out infinite;
}
@keyframes hsp-clockBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
.hsp-clockT {
  font-family: 'Anton', sans-serif; font-size: 170px; line-height: 1;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hsp-clockAp { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 56px; color: #ec4899; letter-spacing: .15em; margin-top: 8px; }
.hsp-clockTz { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 30px; color: #94a3b8; letter-spacing: .18em; margin-top: 6px; }

.hsp-weatherInline { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; }
.hsp-sunMini {
  position: relative; width: 380px; height: 380px;
  display: flex; align-items: center; justify-content: center;
}
.hsp-sunMini::before {
  content: ''; position: absolute; inset: -50px; border-radius: 50%;
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
  -webkit-mask: radial-gradient(circle, transparent 170px, #000 170px, #000 230px, transparent 230px);
          mask: radial-gradient(circle, transparent 170px, #000 170px, #000 230px, transparent 230px);
  animation: hsp-sunSpin 32.4s linear infinite;
}
@keyframes hsp-sunSpin { to { transform: rotate(360deg); } }
.hsp-sunMiniFace {
  width: 320px; height: 320px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 80px rgba(251, 191, 36, .65), inset 0 -16px 28px rgba(180, 83, 9, .25);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Anton', sans-serif; font-weight: 700; font-size: 110px; color: #7c2d12;
  text-shadow: 0 4px 0 rgba(255,255,255,.4);
}
.hsp-weatherDesc {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 70px; color: #b45309;
  text-align: center; max-width: 600px; line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ─── 3. ROW 3 — TEACHER + ANNOUNCEMENT ─── */
.hsp-row3 {
  position: absolute; top: 1700px; left: 40px; right: 40px; height: 660px;
  z-index: 5; display: grid; grid-template-columns: 1fr 1fr; gap: 60px;
}

.hsp-teacher { display: flex; align-items: center; justify-content: center; padding: 20px; }
.hsp-yearbook {
  position: relative; width: 560px; padding: 28px;
  background: #fff; border: 8px solid #ec4899;
  box-shadow: 0 20px 48px rgba(0,0,0,.3);
  transform: rotate(-3deg);
  animation: hsp-yearbookSlide 9s ease-in-out infinite;
}
@keyframes hsp-yearbookSlide { 0%, 100% { transform: rotate(-3deg) translateX(-6px); } 50% { transform: rotate(-3deg) translateX(6px); } }
.hsp-yearbook::before {
  content: ''; position: absolute; bottom: 0; right: 0;
  width: 60px; height: 60px;
  background: linear-gradient(135deg, transparent 50%, #ec4899 50%);
}
.hsp-yearbook::after {
  content: ''; position: absolute; bottom: 10px; right: 10px;
  width: 40px; height: 40px;
  background: linear-gradient(135deg, transparent 50%, rgba(0,0,0,.2) 50%);
}
.hsp-photo {
  width: 100%; aspect-ratio: 1;
  background: linear-gradient(135deg, #06b6d4, #0e7490);
  display: flex; align-items: center; justify-content: center;
  font-size: 280px; overflow: hidden;
}
.hsp-photoImg { width: 100%; height: 100%; object-fit: cover; }
.hsp-pageInfo { margin-top: 24px; text-align: center; }
.hsp-name { font-family: 'Anton', sans-serif; font-size: 60px; color: #1f2937; line-height: 1; letter-spacing: .02em; }
.hsp-role { font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px; color: #ec4899; margin-top: 6px; }

.hsp-announce {
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  padding: 30px;
}
.hsp-bubble {
  position: relative;
  background: linear-gradient(135deg, #fff, #fef3c7);
  padding: 80px 70px;
  border: 12px solid #ec4899; border-radius: 60px;
  box-shadow: 0 28px 70px rgba(236, 72, 153, .3), 24px 24px 0 #fbbf24, 32px 32px 0 #1f2937;
  width: 100%; max-width: 980px;
  animation: hsp-bubbleFloat 6.3s ease-in-out infinite;
  transform: rotate(-1deg);
  text-align: center;
}
@keyframes hsp-bubbleFloat { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-12px); } }
.hsp-bubble::after {
  content: ''; position: absolute; bottom: -52px; right: 140px;
  width: 110px; height: 110px;
  background: linear-gradient(135deg, #fff, #fef3c7);
  clip-path: polygon(0 0, 100% 0, 30% 100%);
  border-right: 12px solid #ec4899; border-bottom: 12px solid #ec4899;
}
.hsp-stars { position: absolute; inset: 0; pointer-events: none; }
.hsp-stars span { position: absolute; font-size: 70px; opacity: .9; animation: hsp-twinkle 2.5s ease-in-out infinite; }
.hsp-stars span:nth-child(1) { top: 4%;  left: 8%; }
.hsp-stars span:nth-child(2) { top: 8%;  right: 12%; animation-delay: .3s; }
.hsp-stars span:nth-child(3) { bottom: 8%; left: 14%; animation-delay: .6s; }
.hsp-stars span:nth-child(4) { bottom: 4%; right: 10%; animation-delay: .9s; }
@keyframes hsp-twinkle {
  0%, 100% { opacity: .25; transform: scale(.8) rotate(0deg); }
  50%      { opacity: 1;   transform: scale(1.2) rotate(20deg); }
}
.hsp-annLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 40px; color: #ec4899; letter-spacing: .25em; text-transform: uppercase; }
.hsp-annMsg { font-family: 'Anton', sans-serif; font-size: 92px; color: #1f2937; line-height: 1.05; margin-top: 22px; letter-spacing: -.01em; }

/* ─── 4. TROPHY COUNTDOWN ─── */
.hsp-countdownCard {
  position: absolute; top: 2400px; left: 40px; right: 40px; height: 700px;
  z-index: 5; display: flex; align-items: center; justify-content: center;
}
.hsp-trophy { position: relative; width: 600px; height: 700px; display: flex; flex-direction: column; align-items: center; animation: hsp-trophyShine 5.4s ease-in-out infinite; }
@keyframes hsp-trophyShine { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-16px) rotate(2deg); } }
.hsp-handleL, .hsp-handleR {
  position: absolute; top: 80px; width: 130px; height: 180px;
  border: 24px solid #fbbf24; border-radius: 50%; z-index: 0;
}
.hsp-handleL { left: 0;  border-right: none; border-radius: 50% 0 0 50%; }
.hsp-handleR { right: 0; border-left: none;  border-radius: 0 50% 50% 0; }
.hsp-cup {
  width: 460px; height: 420px;
  background: linear-gradient(180deg, #fde68a 0%, #fbbf24 50%, #d97706 100%);
  border: 14px solid #92400e;
  border-radius: 24px 24px 50% 50% / 24px 24px 30% 30%;
  box-shadow: 0 28px 60px rgba(0,0,0,.3), inset 0 0 50px rgba(255,255,255,.3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; position: relative; z-index: 1;
  padding: 0 24px;
}
.hsp-cdLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 40px; color: #92400e; letter-spacing: .12em; text-transform: uppercase; line-height: 1.1; }
.hsp-cdNum { font-family: 'Anton', sans-serif; font-size: 220px; line-height: .9; color: #fff; text-shadow: 8px 8px 0 #92400e; margin: 12px 0; }
.hsp-cdUnit { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 42px; color: #92400e; letter-spacing: .15em; }
.hsp-stem {
  width: 100px; height: 70px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-left: 10px solid #92400e; border-right: 10px solid #92400e;
  margin-top: -10px; position: relative; z-index: 1;
}
.hsp-base {
  width: 360px; height: 70px;
  background: linear-gradient(180deg, #fbbf24, #b45309);
  border: 12px solid #92400e; border-radius: 16px;
  box-shadow: 0 14px 28px rgba(0,0,0,.3);
  position: relative; z-index: 1;
}

/* ─── 5. BIRTHDAYS STRIP ─── */
.hsp-birthdays {
  position: absolute; top: 3140px; left: 40px; right: 40px; height: 380px;
  z-index: 5;
  background: linear-gradient(135deg, rgba(255,255,255,.85), rgba(254, 243, 199, .85));
  border: 8px solid #ec4899;
  border-radius: 40px;
  box-shadow: 0 16px 40px rgba(236, 72, 153, .25);
  overflow: hidden;
}
.hsp-bdConfettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; }
.hsp-bdConfetti {
  position: absolute; top: -30px;
  animation: hsp-bdConfettiFall linear infinite; will-change: transform;
}
@keyframes hsp-bdConfettiFall {
  0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
  10% { opacity: 1; }
  100% { transform: translateY(420px) rotate(540deg); opacity: .8; }
}
.hsp-bdContent {
  position: absolute; inset: 0; z-index: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 24px 40px; gap: 18px;
}
.hsp-bdLbl {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 50px;
  color: #ec4899; letter-spacing: .14em; text-transform: uppercase;
  text-shadow: 0 3px 0 rgba(255,255,255,.6);
}
.hsp-bdPills {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: 24px; max-width: 1900px;
}
.hsp-bdPill {
  display: inline-flex; align-items: center; gap: 16px;
  padding: 18px 36px;
  border-radius: 999px;
  background: #fff; border: 6px solid #ec4899;
  box-shadow: 0 8px 20px rgba(236, 72, 153, .25);
  animation: hsp-pillBob 3.2s ease-in-out infinite;
}
.hsp-bdPill1 { border-color: #ec4899; }
.hsp-bdPill2 { border-color: #f59e0b; animation-delay: -.4s; }
.hsp-bdPill3 { border-color: #06b6d4; animation-delay: -.8s; }
.hsp-bdPill4 { border-color: #8b5cf6; animation-delay: -1.2s; }
@keyframes hsp-pillBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
.hsp-bdCake { font-size: 64px; line-height: 1; }
.hsp-bdName { font-family: 'Caveat', cursive; font-weight: 700; font-size: 70px; color: #1f2937; line-height: 1; }

/* ─── 6. TICKER ─── */
.hsp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 220px;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 100%);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 10px solid #fff;
  box-shadow: 0 -16px 48px rgba(236, 72, 153, .3);
}
.hsp-tickerStamp {
  flex: 0 0 auto; padding: 0 64px; height: 100%;
  background: #1f2937; color: #fbbf24;
  display: flex; align-items: center;
  font-family: 'Anton', sans-serif; letter-spacing: .15em; font-size: 70px;
}
.hsp-tickerScrollWrap { flex: 1; overflow: hidden; }
.hsp-tickerScrollText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 80px; color: #fff;
  white-space: nowrap; text-shadow: 4px 4px 0 #1f2937;
  padding-left: 100%;
  display: inline-block;
  animation: hsp-tickerScroll 60s linear infinite;
}
@keyframes hsp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

/* Hotspots — shared class so global aw-section-flash keyframe styling
   still applies. Override hover tint to match HS palette. */
.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
