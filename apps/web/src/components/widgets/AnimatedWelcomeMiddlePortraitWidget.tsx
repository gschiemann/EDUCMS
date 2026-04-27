"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.

/**
 * AnimatedWelcomeMiddlePortraitWidget — 2160×3840 4K portrait MS welcome.
 *
 * ════════════════════════════════════════════════════════════════
 *  Native 4K portrait companion to AnimatedWelcomeMiddleWidget. Same
 *  config shape (Cfg) so admins can swap orientations without
 *  reconfiguring. Uses the canonical transform:scale wrapper from
 *  AnimatedWelcomeHighPortraitWidget — outer div measures parent,
 *  inner stage is FIXED 2160×3840, scaled by `transform: scale(N)`.
 *  Every dimension inside is plain pixels (NO vw/vh/%).
 *
 *  Layout (vertical stack on a 2160×3840 portrait stage, after
 *  the stadium-sky bg + spotlight + bunting layers):
 *    1. Header band ~700px — pennant bunting strip + shield-clip
 *       logo + giant Black Ops/Bungee school name + WELCOME sub.
 *    2. Stadium scoreboard clock card ~700px — full-width black
 *       LED scoreboard with bulbs, hanging chains, big digit time.
 *    3. Varsity teacher polaroid + Megaphone announcement ~900px
 *       — 2-up row, varsity letter patch on left, megaphone +
 *       sound waves + speech bubble on right.
 *    4. Stopwatch countdown card ~500px — full-width stopwatch
 *       CSS-art with crown + tick marks + "Big Game in N days".
 *    5. Layered birthdays cake card ~400px — 2-tier cake +
 *       candles/flames behind a row of name pills.
 *    6. LED ticker ~440px — full-width animated bulb-lit
 *       scoreboard scroll with red stamp and yellow LED text.
 *
 *  All MS shapes ported and scaled ~2× from the landscape widget so
 *  visual rhythm is preserved at 4K. Class prefix is `msp-` so it
 *  cannot collide with `ms-` (landscape), `hsp-` (HS portrait), or
 *  `awp-` (rainbow portrait) on the same page.
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

// Native 4K portrait canvas. Outer wrapper rescales via
// transform:scale to whatever the parent zone provides (gallery
// thumb, builder canvas, production 2160×3840 panel).
const CANVAS_W = 2160;
const CANVAS_H = 3840;

const BASE_TICKER_SEC = 60;

function tickerDurationSec(speed: Cfg['tickerSpeed'], baseSec: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return baseSec * 1.8;
  if (speed === 'fast') return baseSec * 0.6;
  return baseSec;
}

// Varsity/MS-tone weather phrase — shorter + ALL CAPS to fit the
// pennant flag label. Same WMO + temp-bucket mapping as landscape.
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

export function AnimatedWelcomeMiddlePortraitWidget({
  config,
  live,
}: {
  config?: Cfg;
  live?: boolean;
}) {
  const c: Cfg = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
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
  // landscape widget. Hard-skipped in thumbnail mode.
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

  // ─── Clock formatting ───
  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...(tz ? { timeZone: tz } : {}) });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';
  const dateStr = (() => {
    const dfmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(tz ? { timeZone: tz } : {}) });
    return dfmt.format(now).toUpperCase();
  })();

  // ─── Ticker / birthdays ───
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

  // ─── Countdown ───
  const days = (() => {
    if (!c.countdownDate) return c.countdownNumber ?? 12;
    const target = new Date(c.countdownDate + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
  })();
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  const teacherFace = c.teacherGender === 'female' ? '👩‍🏫' : (c.teacherEmoji || '👨‍🏫');

  const weatherDesc = c.weatherDesc
    || (weather ? msWeatherPhrase(weather.wmoCode, weather.tempF) : 'SUNNY · CRISP');
  const weatherTemp = c.weatherTemp || (weather ? `${weather.tempF}°` : '68°');

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}
    >
      <style>{CSS_MSP}</style>

      <div
        className="msp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="msp-stripes" />
        <div className="msp-spotlight msp-left" />
        <div className="msp-spotlight msp-right" />

        {/* Pennant bunting — SVG strip across the very top */}
        <div className="msp-bunting">
          <svg viewBox="0 0 2160 200" preserveAspectRatio="none">
            <path d="M0 0 L2160 0 L2160 16 L0 16 Z" fill="#fbbf24" />
            <g>
              {Array.from({ length: 24 }).map((_, i) => {
                const x = i * 90;
                const colors = ['#dc2626', '#fbbf24', '#3b82f6'];
                return (
                  <polygon
                    key={i}
                    className="msp-pennant"
                    points={`${x},16 ${x + 80},16 ${x + 40},150`}
                    fill={colors[i % colors.length]}
                    stroke="#fff"
                    strokeWidth={6}
                  />
                );
              })}
            </g>
          </svg>
        </div>

        {/* ─── 1. HEADER (~700px): shield logo + pennant title banner ─── */}
        <div className="msp-header">
          <div className="msp-logoRow">
            <div className="msp-logo">
              {c.logoUrl
                ? <img src={c.logoUrl} alt="" className="msp-logoImg" />
                : <span className="msp-logoEmoji">{c.logoEmoji || '🦅'}</span>}
            </div>
          </div>

          <div className="msp-titleBanner">
            <div className="msp-pin msp-pin1" />
            <div className="msp-pin msp-pin2" />
            <div className="msp-ribbon">
              <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'GO EAGLES').toUpperCase()}</h1>
              <div className="msp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ welcome back, Eagles ~'}</div>
            </div>
          </div>
        </div>

        {/* ─── 2. SCOREBOARD CLOCK CARD (~700px) ─── */}
        <div className="msp-clockCard">
          <div className="msp-chains">
            <div className="msp-chain msp-chain1" />
            <div className="msp-chain msp-chain2" />
          </div>
          <div className="msp-scoreboard">
            <div className="msp-bulbs">
              {Array.from({ length: 36 }).map((_, i) => (
                <div key={i} className={`msp-bulb msp-bulb${i % 4}`} />
              ))}
            </div>
            <div className="msp-clockDate">{dateStr}</div>
            <div className="msp-clockTime">
              <span className="msp-clockT">{hh}:{mm}</span>
              <span className="msp-clockAp">{ampm}</span>
            </div>
            <div className="msp-clockWeather">
              <span className="msp-clockWxIcon">{weatherIcon(weather?.wmoCode)}</span>
              <span className="msp-clockWxTemp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{weatherTemp}</span>
              <span className="msp-clockWxDesc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{weatherDesc}</span>
            </div>
          </div>
        </div>

        {/* ─── 3. TEACHER + ANNOUNCEMENT (~900px) — 2-up row ─── */}
        <div className="msp-row3">
          <div className="msp-teacher">
            <div className="msp-patch">
              <div className="msp-patchJersey">#1</div>
              <div className="msp-patchRole" data-field="teacherRole" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.teacherRole || 'TEACHER OF THE WEEK').toUpperCase()} ★</div>
              <div className="msp-patchFace">
                {c.teacherPhotoUrl
                  ? <img src={c.teacherPhotoUrl} alt="" className="msp-patchPhoto" />
                  : <span>{teacherFace}</span>}
              </div>
              <div className="msp-patchName" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' }}>{(c.teacherName || 'MR. RIVERA').toUpperCase()}</div>
            </div>
          </div>

          <div className="msp-announce">
            <div className="msp-mega">📣</div>
            <div className="msp-wave msp-wave1" />
            <div className="msp-wave msp-wave2" />
            <div className="msp-wave msp-wave3" />
            <div className="msp-bubble">
              <div className="msp-annLbl" data-field="announcementLabel" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.announcementLabel || 'BIG NEWS').toUpperCase()} ★</div>
              <div className="msp-annMsg" data-field="announcementMessage" style={{ whiteSpace: 'pre-wrap' }}>{c.announcementMessage || 'Pep Rally Friday at 2:30 — be in the gym, bring your loudest!'}</div>
            </div>
          </div>
        </div>

        {/* ─── 4. STOPWATCH COUNTDOWN (~500px) — full-width ─── */}
        <div className="msp-countdownCard">
          <div className="msp-stopwatch">
            <div className="msp-crown" />
            <div className="msp-stopwatchSide msp-stopwatchSideL" />
            <div className="msp-stopwatchSide msp-stopwatchSideR" />
            <div className="msp-ring">
              <div className="msp-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.countdownLabel || 'BIG GAME IN').toUpperCase()}</div>
              <div className="msp-cdNum">{days}</div>
              <div className="msp-cdUnit">{unit}</div>
            </div>
          </div>
        </div>

        {/* ─── 5. BIRTHDAYS CAKE STRIP (~400px) ─── */}
        <div className="msp-birthdays">
          <div className="msp-cakeWrap">
            <div className="msp-candle msp-c1" />
            <div className="msp-candle msp-c2" />
            <div className="msp-candle msp-c3" />
            <div className="msp-flame msp-f1" />
            <div className="msp-flame msp-f2" />
            <div className="msp-flame msp-f3" />
            <div className="msp-tier1" />
            <div className="msp-tier2" />
          </div>
          <div className="msp-bdContent">
            <div className="msp-bdLbl">★ BIRTHDAYS TODAY ★</div>
            <div className="msp-bdPills">
              {birthdayList.map((name, i) => (
                <div key={`${name}-${i}`} className={`msp-bdPill msp-bdPill${(i % 3) + 1}`}>
                  <span className="msp-bdCake">🎂</span>
                  <span className="msp-bdName">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── 6. TICKER (~440px footer) ─── */}
        <div className="msp-ticker">
          <div className="msp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'EAGLE NEWS').toUpperCase()}</div>
          <div className="msp-tickerScrollWrap">
            <span
              className="msp-tickerScrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, BASE_TICKER_SEC)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — builder-only. Coords match the vertical layout
            above; widths span the full 2160px stage minus 40px gutters. */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={40}   y={200}   w={2080} h={760} />
            <Hotspot section="weather"      x={40}   y={1000}  w={2080} h={700} />
            <Hotspot section="teacher"      x={40}   y={1740}  w={1020} h={900} />
            <Hotspot section="announcement" x={1100} y={1740}  w={1020} h={900} />
            <Hotspot section="countdown"    x={40}   y={2680}  w={2080} h={520} />
            <Hotspot section="birthdays"    x={40}   y={3220}  w={2080} h={400} />
            <Hotspot section="ticker"       x={0}    y={3640}  w={2160} h={200} />
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

// All pixel sizes are ~2× the landscape recipe so the visual rhythm
// scales cleanly to 4K. Class prefix `msp-` so it cannot collide
// with `ms-` (MS landscape), `hsp-` (HS portrait), or `awp-`
// (rainbow portrait). Font imports duplicated across widgets are
// fine — browser dedupes.
const CSS_MSP = `
@import url('https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Bungee&family=Bebas+Neue&family=Oswald:wght@500;700&family=Permanent+Marker&display=swap');

.msp-stage {
  position: relative;
  font-family: 'Oswald', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 12%, rgba(59, 130, 246, .35), transparent 60%),
    radial-gradient(ellipse at 20% 110%, rgba(251, 191, 36, .22), transparent 40%),
    radial-gradient(ellipse at 80% 110%, rgba(220, 38, 38, .22), transparent 40%),
    linear-gradient(180deg, #0f172a 0%, #1e3a8a 45%, #0f172a 100%);
  overflow: hidden;
}
.msp-stripes {
  position: absolute; inset: -10%; pointer-events: none;
  background: repeating-linear-gradient(135deg,
    transparent 0 140px, rgba(251, 191, 36, .05) 140px 160px,
    transparent 160px 360px, rgba(220, 38, 38, .05) 360px 380px);
  animation: msp-stripeDrift 64s linear infinite;
}
@keyframes msp-stripeDrift { from { transform: translateX(0); } to { transform: translateX(140px); } }

.msp-spotlight {
  position: absolute; pointer-events: none;
  width: 1100px; height: 3500px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.10) 50%, transparent 100%);
  transform-origin: 50% 100%;
  animation: msp-sweep 14.4s ease-in-out infinite;
}
.msp-spotlight.msp-left  { left: 6%;  bottom: 0; transform: rotate(-15deg); animation-delay: 0s; }
.msp-spotlight.msp-right { right: 6%; bottom: 0; transform: rotate(15deg);  animation-delay: -3.5s; }
@keyframes msp-sweep { 0%, 100% { opacity: .25; } 50% { opacity: .55; } }

.msp-bunting { position: absolute; top: 0; left: 0; right: 0; height: 200px; z-index: 2; }
.msp-bunting svg { width: 100%; height: 100%; display: block; }
.msp-pennant { animation: msp-pennantSway 5.4s ease-in-out infinite; transform-origin: 50% 16px; }
@keyframes msp-pennantSway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }

/* ─── 1. HEADER (top ~700px after bunting) ─── */
.msp-header {
  position: absolute; top: 200px; left: 40px; right: 40px; height: 760px;
  z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 28px;
}
.msp-logoRow { width: 100%; display: flex; align-items: center; justify-content: center; }
.msp-logo {
  position: relative; width: 320px; height: 360px;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 60%, #d97706);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 24px 60px rgba(0,0,0,.55);
  animation: msp-shieldPulse 4.3s ease-in-out infinite;
  overflow: hidden;
}
.msp-logo::before {
  content: ''; position: absolute; inset: 22px;
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  box-shadow: inset 0 0 0 8px #92400e;
}
.msp-logoEmoji { font-size: 180px; line-height: 1; filter: drop-shadow(0 6px 14px rgba(0,0,0,.55)); transform: translateY(-20px); }
.msp-logoImg { width: 100%; height: 100%; object-fit: cover; }
@keyframes msp-shieldPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }

.msp-titleBanner { position: relative; padding-top: 32px; width: 100%; max-width: 1900px; margin: 0 auto; }
.msp-ribbon {
  background: #dc2626; padding: 56px 80px 96px; position: relative;
  box-shadow: 0 28px 60px rgba(0,0,0,.5);
  clip-path: polygon(0 0, 100% 0, 100% 70%, 92% 100%, 84% 70%, 76% 100%, 68% 70%, 60% 100%, 52% 70%, 44% 100%, 36% 70%, 28% 100%, 20% 70%, 12% 100%, 4% 70%, 0 90%);
  animation: msp-bannerSway 6.3s ease-in-out infinite;
  transform-origin: 50% 0%;
  border: 8px solid #fff; border-bottom: none;
}
@keyframes msp-bannerSway { 0%, 100% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } }
.msp-ribbon h1 {
  margin: 0; line-height: .92;
  font-family: 'Black Ops One', 'Bungee', cursive;
  font-size: 220px; color: #fff;
  text-shadow: 8px 8px 0 #000, 16px 16px 0 #fbbf24;
  letter-spacing: .04em; text-align: center;
}
.msp-sub {
  font-family: 'Permanent Marker', cursive; font-size: 70px;
  color: #fbbf24; margin-top: 14px; text-align: center;
  transform: rotate(-2deg);
  text-shadow: 4px 4px 0 rgba(0,0,0,.4);
}
.msp-pin { position: absolute; top: 22px; width: 36px; height: 36px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #d97706 70%, #78350f);
  box-shadow: 0 4px 8px rgba(0,0,0,.5); z-index: 2; }
.msp-pin1 { left: 7%; }
.msp-pin2 { right: 7%; }

/* ─── 2. SCOREBOARD CLOCK CARD ─── */
.msp-clockCard {
  position: absolute; top: 1000px; left: 40px; right: 40px; height: 700px;
  z-index: 5; display: flex; flex-direction: column; align-items: center;
}
.msp-chains {
  position: absolute; top: 0; left: 38%; right: 38%; height: 64px;
  display: flex; justify-content: space-between;
}
.msp-chain {
  width: 8px; height: 100%;
  background: linear-gradient(180deg, transparent, #94a3b8 20%, #64748b 80%, transparent);
  border-radius: 4px;
}
.msp-scoreboard {
  position: absolute; top: 60px; left: 0; right: 0; bottom: 0;
  background: #000;
  border: 14px solid #fbbf24;
  border-radius: 24px;
  box-shadow:
    0 0 80px rgba(251, 191, 36, .55),
    inset 0 0 80px rgba(251, 191, 36, .15),
    0 28px 60px rgba(0,0,0,.6);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: msp-scoreboardSway 7.2s ease-in-out infinite;
  transform-origin: 50% -60px;
  padding: 40px 60px;
  overflow: hidden;
}
@keyframes msp-scoreboardSway { 0%, 100% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } }
.msp-bulbs {
  position: absolute; inset: 18px; pointer-events: none;
  border: 4px dashed transparent;
}
.msp-bulb {
  position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 50%, #b45309);
  box-shadow: 0 0 12px rgba(251, 191, 36, .9);
  animation: msp-bulbBlink 1.6s ease-in-out infinite;
}
.msp-bulb0 { animation-delay: 0s; }
.msp-bulb1 { animation-delay: .2s; }
.msp-bulb2 { animation-delay: .4s; }
.msp-bulb3 { animation-delay: .6s; }
${(() => {
  // Position the 36 bulbs around the perimeter (top + bottom rows, sides).
  let css = '';
  // top row: 12 bulbs
  for (let i = 0; i < 12; i++) {
    css += `.msp-bulb:nth-child(${i + 1}) { top: 0; left: ${(i + 1) * (100 / 13)}%; }\n`;
  }
  // bottom row: 12 bulbs
  for (let i = 0; i < 12; i++) {
    css += `.msp-bulb:nth-child(${i + 13}) { bottom: 0; left: ${(i + 1) * (100 / 13)}%; }\n`;
  }
  // left side: 6 bulbs
  for (let i = 0; i < 6; i++) {
    css += `.msp-bulb:nth-child(${i + 25}) { left: 0; top: ${(i + 1) * (100 / 7)}%; }\n`;
  }
  // right side: 6 bulbs
  for (let i = 0; i < 6; i++) {
    css += `.msp-bulb:nth-child(${i + 31}) { right: 0; top: ${(i + 1) * (100 / 7)}%; }\n`;
  }
  return css;
})()}
@keyframes msp-bulbBlink {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .55; transform: scale(.85); }
}

.msp-clockDate {
  font-family: 'Bebas Neue', sans-serif; font-size: 56px; color: #f59e0b;
  letter-spacing: .25em; text-align: center;
  text-shadow: 0 0 20px rgba(245, 158, 11, .6);
  margin-bottom: 12px;
}
.msp-clockTime { display: flex; align-items: baseline; justify-content: center; gap: 24px; }
.msp-clockT {
  font-family: 'Bebas Neue', sans-serif; font-size: 280px; color: #fbbf24; line-height: 1;
  text-shadow: 0 0 40px rgba(251, 191, 36, .85), 0 0 80px rgba(251, 191, 36, .35);
  letter-spacing: .02em;
}
.msp-clockAp { font-family: 'Bebas Neue', sans-serif; font-size: 80px; color: #f59e0b; letter-spacing: .25em; }
.msp-clockWeather {
  display: flex; align-items: center; justify-content: center; gap: 24px;
  margin-top: 18px;
}
.msp-clockWxIcon { font-size: 80px; line-height: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,.5)); }
.msp-clockWxTemp { font-family: 'Bebas Neue', sans-serif; font-size: 84px; color: #fbbf24; text-shadow: 4px 4px 0 #000; line-height: 1; }
.msp-clockWxDesc { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 36px; color: #fff; letter-spacing: .14em; text-transform: uppercase; text-shadow: 2px 2px 0 #000; }

/* ─── 3. ROW 3 — TEACHER PATCH + ANNOUNCEMENT ─── */
.msp-row3 {
  position: absolute; top: 1740px; left: 40px; right: 40px; height: 900px;
  z-index: 5; display: grid; grid-template-columns: 1fr 1fr; gap: 60px;
}

.msp-teacher { display: flex; align-items: center; justify-content: center; padding: 20px; position: relative; }
.msp-patch {
  position: relative; width: 720px; padding: 60px 56px;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  text-align: center;
  box-shadow: 0 24px 50px rgba(0,0,0,.5);
  animation: msp-patchSwing 7.2s ease-in-out infinite;
  transform-origin: top center;
}
@keyframes msp-patchSwing { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.msp-patch::before {
  content: ''; position: absolute; inset: 24px;
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  box-shadow: inset 0 0 0 8px #dc2626;
}
.msp-patchJersey {
  position: absolute; top: 56px; right: 90px;
  font-family: 'Black Ops One', cursive; font-size: 96px; color: #dc2626;
  text-shadow: 4px 4px 0 #000;
  z-index: 2; line-height: 1;
}
.msp-patchRole {
  font-family: 'Bungee', cursive; font-size: 32px; color: #dc2626;
  letter-spacing: .12em; margin-bottom: 20px;
  position: relative; z-index: 1;
}
.msp-patchFace {
  font-size: 220px; line-height: 1;
  filter: drop-shadow(0 6px 14px rgba(0,0,0,.4));
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  margin: 12px 0;
}
.msp-patchPhoto {
  width: 280px; height: 280px; border-radius: 50%; object-fit: cover;
  border: 10px solid #fff; box-shadow: 0 10px 26px rgba(0,0,0,.4);
}
.msp-patchName {
  font-family: 'Bungee', cursive; font-size: 64px; color: #000;
  letter-spacing: .04em; text-shadow: 4px 4px 0 rgba(255,255,255,.3);
  margin-top: 16px; position: relative; z-index: 1;
}

.msp-announce {
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
  position: relative; padding: 32px;
}
.msp-mega {
  position: absolute; left: 50px; top: 50%;
  transform: translate(0, -50%) scaleX(-1);
  font-size: 280px; line-height: 1; z-index: 4;
  filter: drop-shadow(0 12px 24px rgba(0,0,0,.55));
  animation: msp-megaShake 2.9s ease-in-out infinite;
  transform-origin: 20% 50%;
}
@keyframes msp-megaShake {
  0%, 100% { transform: translate(0, -50%) scaleX(-1) rotate(-12deg); }
  25%, 75% { transform: translate(0, -50%) scaleX(-1) rotate(12deg); }
  50%      { transform: translate(0, -50%) scaleX(-1) rotate(-12deg); }
}
.msp-wave {
  position: absolute; top: 50%; border: 12px solid #fbbf24; border-right: none; border-radius: 100%; z-index: 3;
}
.msp-wave1 { left: -10px;  width: 130px; height: 130px; opacity: .8;  animation: msp-soundWave 2.2s ease-out infinite; }
.msp-wave2 { left: -50px;  width: 180px; height: 180px; opacity: .55; animation: msp-soundWave 2.2s ease-out infinite .2s; }
.msp-wave3 { left: -100px; width: 240px; height: 240px; opacity: .35; animation: msp-soundWave 2.2s ease-out infinite .4s; }
@keyframes msp-soundWave {
  0%   { transform: translateY(-50%) scale(.5); opacity: .9; }
  100% { transform: translateY(-50%) scale(1.5); opacity: 0; }
}
.msp-bubble {
  position: relative; z-index: 1;
  background: linear-gradient(135deg, #fff, #fef3c7);
  padding: 70px 80px 70px 280px;
  border: 12px solid #000; border-radius: 60px;
  box-shadow: 24px 24px 0 #fbbf24, 32px 32px 0 #000, 0 28px 60px rgba(0,0,0,.4);
  max-width: 1000px;
  transform: rotate(-1deg);
  animation: msp-bubbleFloat 5.4s ease-in-out infinite;
}
@keyframes msp-bubbleFloat { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-12px); } }
.msp-annLbl { font-family: 'Bungee', cursive; font-size: 44px; color: #dc2626; letter-spacing: .15em; }
.msp-annMsg { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 96px; color: #000; line-height: 1.05; margin-top: 24px; letter-spacing: .01em; }

/* ─── 4. STOPWATCH COUNTDOWN ─── */
.msp-countdownCard {
  position: absolute; top: 2680px; left: 40px; right: 40px; height: 520px;
  z-index: 5; display: flex; align-items: center; justify-content: center;
}
.msp-stopwatch { width: 540px; height: 580px; position: relative; }
.msp-crown {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 80px; height: 70px;
  background: linear-gradient(135deg, #94a3b8, #475569);
  border-radius: 12px 12px 6px 6px;
  border: 8px solid #1e293b; z-index: 2;
}
.msp-stopwatchSide {
  position: absolute; top: 90px; width: 50px; height: 80px;
  background: linear-gradient(135deg, #cbd5e1, #64748b);
  border: 6px solid #1e293b; border-radius: 8px;
  z-index: 1;
}
.msp-stopwatchSideL { left: 60px;  transform: rotate(-30deg); }
.msp-stopwatchSideR { right: 60px; transform: rotate(30deg); }
.msp-ring {
  position: absolute; top: 60px; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at 30% 30%, #fff, #cbd5e1 60%, #475569);
  border: 18px solid #1e293b; border-radius: 50%;
  box-shadow: 0 28px 56px rgba(0,0,0,.55), inset 0 0 0 10px #cbd5e1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: msp-stopwatchTick 2.9s ease-in-out infinite;
}
@keyframes msp-stopwatchTick { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.msp-ring::before {
  content: ''; position: absolute; inset: 28px; border-radius: 50%;
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
.msp-cdLbl {
  font-family: 'Bungee', cursive; font-size: 36px; color: #dc2626;
  letter-spacing: .15em; text-transform: uppercase; z-index: 1;
  max-width: 380px; text-align: center; line-height: 1.1;
}
.msp-cdNum {
  font-family: 'Bebas Neue', sans-serif; font-size: 280px; line-height: .9; color: #dc2626;
  text-shadow: 6px 6px 0 rgba(0,0,0,.18); z-index: 1; margin: 8px 0;
}
.msp-cdUnit {
  font-family: 'Bebas Neue', sans-serif; font-size: 60px; color: #1e293b;
  letter-spacing: .15em; z-index: 1;
}

/* ─── 5. BIRTHDAYS — layered cake + name pills ─── */
.msp-birthdays {
  position: absolute; top: 3220px; left: 40px; right: 40px; height: 380px;
  z-index: 5;
  background: linear-gradient(135deg, rgba(15, 23, 42, .85), rgba(30, 58, 138, .85));
  border: 10px solid #fbbf24;
  border-radius: 32px;
  box-shadow: 0 20px 50px rgba(0,0,0,.55), inset 0 0 60px rgba(251, 191, 36, .15);
  display: flex; align-items: center; padding: 30px 40px; gap: 40px;
  overflow: hidden;
}
.msp-cakeWrap { position: relative; width: 360px; height: 320px; flex-shrink: 0; animation: msp-cakeBob 3.2s ease-in-out infinite; }
@keyframes msp-cakeBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
.msp-tier1 {
  position: absolute; bottom: 0; left: 50px; right: 50px; height: 130px;
  background: linear-gradient(180deg, #ec4899, #be185d);
  border-radius: 12px 12px 0 0; border: 8px solid #fff;
  box-shadow: 0 14px 28px rgba(0,0,0,.55);
}
.msp-tier1::before {
  content: ''; position: absolute; top: -16px; left: -8px; right: -8px; height: 32px;
  background: #fff;
  clip-path: polygon(
    0 100%, 100% 100%, 100% 30%,
    95% 50%, 90% 30%, 85% 50%, 80% 30%, 75% 50%, 70% 30%, 65% 50%, 60% 30%,
    55% 50%, 50% 30%, 45% 50%, 40% 30%, 35% 50%, 30% 30%, 25% 50%, 20% 30%,
    15% 50%, 10% 30%, 5% 50%, 0 30%
  );
}
.msp-tier2 {
  position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-radius: 0 0 12px 12px;
  border: 8px solid #fff; border-top: none;
  box-shadow: 0 14px 28px rgba(0,0,0,.55);
}
.msp-candle {
  position: absolute; bottom: 130px; width: 14px; height: 60px;
  background: repeating-linear-gradient(180deg, #fff 0 10px, #ec4899 10px 20px);
  border-radius: 4px;
}
.msp-c1 { left: 80px; }
.msp-c2 { left: 50%; transform: translateX(-50%); }
.msp-c3 { right: 80px; }
.msp-flame {
  position: absolute; bottom: 190px; width: 24px; height: 38px;
  background: radial-gradient(circle at 50% 80%, #fbbf24, #ec4899 60%, transparent 80%);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  animation: msp-flameDance 0.7s ease-in-out infinite alternate;
}
.msp-f1 { left: 75px; }
.msp-f2 { left: 50%; transform: translateX(-50%); }
.msp-f3 { right: 75px; animation-delay: .3s; }
@keyframes msp-flameDance {
  from { transform: scaleY(1); }
  to   { transform: scaleY(1.2) rotate(2deg); }
}
.msp-bdContent {
  flex: 1; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 14px;
}
.msp-bdLbl {
  font-family: 'Bungee', cursive; font-size: 44px; color: #fbbf24;
  letter-spacing: .14em; text-shadow: 4px 4px 0 #000;
}
.msp-bdPills {
  display: flex; flex-wrap: wrap; align-items: center; gap: 18px;
  max-width: 1500px;
}
.msp-bdPill {
  display: inline-flex; align-items: center; gap: 14px;
  padding: 14px 28px;
  border-radius: 999px;
  background: #fff; border: 6px solid #dc2626;
  box-shadow: 0 6px 16px rgba(0,0,0,.4);
  animation: msp-pillBob 3.2s ease-in-out infinite;
}
.msp-bdPill1 { border-color: #dc2626; }
.msp-bdPill2 { border-color: #fbbf24; animation-delay: -.4s; }
.msp-bdPill3 { border-color: #3b82f6; animation-delay: -.8s; }
@keyframes msp-pillBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
.msp-bdCake { font-size: 48px; line-height: 1; }
.msp-bdName { font-family: 'Permanent Marker', cursive; font-size: 56px; color: #1e293b; line-height: 1; }

/* ─── 6. TICKER (footer ~200px on canvas, sits at bottom) ─── */
.msp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 200px;
  background: #000;
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 12px solid #fbbf24;
  box-shadow: inset 0 0 80px rgba(251, 191, 36, .18);
}
.msp-tickerStamp {
  flex: 0 0 auto; padding: 0 64px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: #fff; display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 60px;
  border-right: 8px solid #fbbf24;
  text-shadow: 4px 4px 0 #000;
}
.msp-tickerScrollWrap { flex: 1; overflow: hidden; }
.msp-tickerScrollText {
  font-family: 'Bebas Neue', sans-serif; font-size: 110px; color: #fbbf24;
  letter-spacing: .04em; white-space: nowrap;
  text-shadow: 0 0 30px rgba(251, 191, 36, .65);
  padding-left: 100%;
  display: inline-block;
  animation: msp-tickerScroll 60s linear infinite;
}
@keyframes msp-tickerScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

/* Hotspots — shared aw-hotspot class so global styling still
   applies. Override hover tint to match MS palette. */
.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(251, 191, 36, .12); box-shadow: inset 0 0 0 4px rgba(251, 191, 36, .65); }
.aw-hotspot:focus-visible { background-color: rgba(251, 191, 36, .18); box-shadow: inset 0 0 0 4px rgba(251, 191, 36, .9); }
`;
