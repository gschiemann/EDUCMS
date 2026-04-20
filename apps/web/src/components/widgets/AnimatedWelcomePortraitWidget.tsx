"use client";

/**
 * AnimatedWelcomePortraitWidget — 1080×1920 portrait Rainbow welcome.
 *
 * ════════════════════════════════════════════════════════════════
 *  APPROVED-PENDING 2026-04-20 — direct port of AnimatedWelcomeWidget
 *  (landscape gold-standard). Every shape from landscape is present:
 *   • Layered rainbow stripe (repeating-linear-gradient @ -3deg)
 *   • Confetti layer (80 animated pieces, same spawner)
 *   • Background balloons rising from bottom (4 staggered)
 *   • Logo: circle w/ yellow ring, bouncing animation
 *   • Title box: dashed pink border, breathing, gradient-shifting text
 *   • Clock: circle w/ yellow border, wiggle animation
 *   • Weather: sun disc w/ conic-gradient rays + radial sun face
 *   • Countdown: starburst (clip-path polygon), bouncy
 *   • Announcement: cloud puff (many box-shadows) w/ stars + megaphone
 *   • Teacher: polaroid w/ washi-tape caption banner, rotated
 *   • Birthdays: balloon cluster w/ cake + bob animation
 *   • Ticker: wavy ribbon (clip-path zigzag)
 *
 *  Same Cfg shape as landscape so an admin can swap between the
 *  two orientations without reconfiguring. Layout rearranged for a
 *  1080×1920 portrait canvas — header strip, weather+countdown row,
 *  big cloud announcement, teacher+birthdays row, wavy ticker.
 *
 *  DO NOT regress to flat rectangles — see CLAUDE.md Template Design
 *  Workflow "One template at a time, with a real iteration loop".
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
  teacherPhotoUrl?: string;
  birthdayLabel?: string;
  birthdayNames?: string | string[];
  tickerStamp?: string;
  tickerMessages?: string[] | string;
  tickerSpeed?: 'slow' | 'normal' | 'fast' | number;
}

// Canonical portrait canvas. Scales to any target size (2160×3840 on
// the Nova 4K portrait wall, 1080×1920 in a browser preview tile).
const CANVAS_W = 1080;
const CANVAS_H = 1920;

const BASE_TICKER_SEC = 30;

// Matches landscape semantics exactly so admins get a consistent
// control across every animated template.
function tickerDurationSec(speed: Cfg['tickerSpeed'], base: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return base * 1.8;
  if (speed === 'fast') return base * 0.6;
  return base;
}

// Same WMO-code → cute phrase map as landscape. Kept duplicated rather
// than shared because the widget is one self-contained file per
// CLAUDE.md design workflow.
function cuteWeatherPhrase(wmoCode: number, tempF: number): string {
  const cold = tempF < 35;
  const cool = tempF >= 35 && tempF < 60;
  const warm = tempF >= 60 && tempF < 80;
  const tempWord = cold ? 'chilly' : cool ? 'crisp' : warm ? 'warm' : 'sizzling';
  switch (wmoCode) {
    case 0:                    return `~ sunny + ${tempWord} ~`;
    case 1:                    return `~ mostly sunny + ${tempWord} ~`;
    case 2:                    return `~ partly cloudy ~`;
    case 3:                    return `~ cloudy day ~`;
    case 45: case 48:          return `~ foggy + cozy ~`;
    case 51: case 53: case 55: return `~ sprinkly day ~`;
    case 56: case 57:          return `~ icy drizzle, bundle up! ~`;
    case 61: case 80:          return `~ light rain, grab a hood ~`;
    case 63: case 81:          return `~ rainy day, splash safely ~`;
    case 65: case 82:          return `~ heavy rain, stay dry! ~`;
    case 66: case 67:          return `~ icy rain, careful out there ~`;
    case 71: case 85:          return `~ sprinkles of snow! ❄️ ~`;
    case 73:                   return `~ snowy day, build a fort! ⛄ ~`;
    case 75: case 86:          return `~ big snow day! ❄️❄️❄️ ~`;
    case 77:                   return `~ snowflakes falling ~`;
    case 95:                   return `~ thunder rumbles ⚡ ~`;
    case 96: case 99:          return `~ stormy + hail, stay inside! ~`;
    default:                   return `~ ${tempWord} and bright ~`;
  }
}

export function AnimatedWelcomePortraitWidget({
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
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
  const [weather, setWeather] = useState<{ tempF: number; wmoCode: number } | null>(null);

  // Scale 1080×1920 canvas to fit container. offsetWidth/Height (not
  // getBoundingClientRect) so parent transforms don't break us —
  // ScaledTemplateThumbnail wraps us in another scale transform.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      const sx = w / CANVAS_W;
      const sy = h / CANVAS_H;
      setScale(Math.min(sx, sy));
    };
    compute();
    const raf1 = requestAnimationFrame(compute);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isLive]);

  // Live weather — same 3-tier resolution as landscape.
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
            const lat = parseFloat(p?.latitude);
            const lng = parseFloat(p?.longitude);
            if (isFinite(lat) && isFinite(lng)) return { lat, lng };
          }
        } catch { /* fall through */ }
      }
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (r.ok) {
          const j = await r.json();
          const lat = parseFloat(j?.latitude);
          const lng = parseFloat(j?.longitude);
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
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}` +
          `&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`
        );
        if (!r.ok) return;
        const wx = await r.json();
        const t = wx?.current?.temperature_2m;
        const code = wx?.current?.weather_code;
        if (cancelled || t == null || code == null) return;
        const tempRound = Math.round(t);
        const tempF = isCelsius ? Math.round(tempRound * 9 / 5 + 32) : tempRound;
        setWeather({ tempF, wmoCode: code });
      } catch { /* noop */ }
    };
    fetchWx();
    const id = setInterval(fetchWx, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isLive, c.weatherLocation, c.weatherUnits, c.weatherTemp]);

  // Spawn confetti pieces — same pattern as landscape. Skipped in
  // thumbnail mode because 80 continuously-animated elements × N
  // gallery tiles is a compositor-pegging disaster.
  useEffect(() => {
    if (!isLive) return;
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899','#f59e0b','#10b981','#6366f1','#f43f5e','#06b6d4','#fbbf24','#a78bfa'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'awp-confetti';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 8 + Math.random() * 14;
      const dur = 6 + Math.random() * 8;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = color;
      el.style.borderRadius = isCircle ? '50%' : '2px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [isLive]);

  // ─── Ticker ───
  const tickerList = Array.isArray(c.tickerMessages)
    ? c.tickerMessages
    : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
  const tickerText = tickerList.length
    ? tickerList.join('  ·  ')
    : 'Welcome back, Stars!  ·  Picture day is Friday  ·  Reading Challenge: 20 minutes a day';

  // ─── Birthdays ───
  const birthdayList: string[] = Array.isArray(c.birthdayNames)
    ? c.birthdayNames.filter(Boolean)
    : (typeof c.birthdayNames === 'string'
        ? c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean)
        : ['Maya', 'Eli', 'Sofia']);
  const bdInline = birthdayList.join('  ·  ');
  // Mirror landscape — 4+ names get a seamless marquee, 1-3 stay static.
  const bdShouldScroll = birthdayList.length >= 4;
  const bdSlotRef = useRef<HTMLDivElement>(null);
  const bdTextRef = useRef<HTMLSpanElement>(null);
  const [bdScrollDuration, setBdScrollDuration] = useState(20);
  useEffect(() => {
    if (!bdShouldScroll) return;
    const measure = () => {
      const txt = bdTextRef.current;
      if (!txt) return;
      const halfWidth = txt.scrollWidth / 2;
      setBdScrollDuration(Math.max(15, halfWidth / 80));
    };
    measure();
    const r1 = requestAnimationFrame(measure);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(measure);
    if (bdSlotRef.current) ro.observe(bdSlotRef.current);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, [bdInline, bdShouldScroll]);

  // ─── Clock ───
  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#BFE8FF',
      }}
    >
      <style>{CSS}</style>
      <div
        className="awp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Decorative background layers — MATCH LANDSCAPE */}
        <div className="awp-rainbow" />
        <div className="awp-confettiLayer" ref={confettiRef} />

        <div className="awp-bgBalloon" style={{ left: 80,  background: '#f87171', animationDuration: '16s', animationDelay: '0s' }} />
        <div className="awp-bgBalloon" style={{ left: 260, background: '#fbbf24', animationDuration: '20s', animationDelay: '-7s' }} />
        <div className="awp-bgBalloon" style={{ left: 740, background: '#60a5fa', animationDuration: '18s', animationDelay: '-4s' }} />
        <div className="awp-bgBalloon" style={{ left: 940, background: '#a78bfa', animationDuration: '22s', animationDelay: '-11s' }} />

        {/* Header: logo | title box | clock (same shape as landscape) */}
        <div className="awp-header">
          <div className="awp-logo">
            {c.logoUrl
              ? <img src={c.logoUrl} alt="" className="awp-logoImg" />
              : <span>{c.logoEmoji || '🍎'}</span>}
          </div>
          <div className="awp-titleBox">
            <h1>{c.title || 'Welcome, Friends!'}</h1>
            <div className="awp-sub">{c.subtitle || 'today is going to be amazing ✨'}</div>
          </div>
          <div className="awp-clock">
            <div className="awp-clockT">{hh}:{mm}</div>
            <div className="awp-clockAp">{ampm}</div>
          </div>
        </div>

        {/* Row 2: Weather (sun w/ rays) + Countdown (starburst) */}
        <div className="awp-weather">
          <div className="awp-sunDisc">
            <div className="awp-sunFace">
              {c.weatherTemp || (weather ? `${weather.tempF}°` : '68°')}
            </div>
          </div>
          <div className="awp-weatherDesc">
            {c.weatherDesc || (weather ? cuteWeatherPhrase(weather.wmoCode, weather.tempF) : '~ sunny + crisp ~')}
          </div>
        </div>

        <div className="awp-countdown">
          <div className="awp-badge">
            <div className="awp-cdLbl">{c.countdownLabel || 'Field Trip in'}</div>
            {(() => {
              if (c.countdownDate) {
                const target = new Date(c.countdownDate + 'T00:00:00');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const days = Math.max(0, Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
                return (
                  <>
                    <div className="awp-cdNum">{days}</div>
                    <div className="awp-cdUnit">{days === 1 ? 'day' : (c.countdownUnit || 'days')}</div>
                  </>
                );
              }
              return (
                <>
                  <div className="awp-cdNum">{c.countdownNumber ?? 3}</div>
                  <div className="awp-cdUnit">{c.countdownUnit || 'days'}</div>
                </>
              );
            })()}
          </div>
        </div>

        {/* Row 3: Announcement — cloud puff w/ stars + megaphone */}
        <div className="awp-announce">
          <div className="awp-stars">
            <span>⭐</span><span>✨</span><span>🌟</span><span>💫</span>
          </div>
          <div className="awp-megaphone">📣</div>
          <div className="awp-annLbl">{c.announcementLabel || 'Big News'}</div>
          <div className="awp-annMsg">{c.announcementMessage || 'Book Fair starts Monday! 📚 Come find your new favorite story.'}</div>
        </div>

        {/* Row 4: Teacher (polaroid) + Birthdays (balloon cluster) */}
        <div className="awp-teacher">
          <div className="awp-polaroid">
            <div className="awp-tWashi">{c.teacherRole || 'Teacher of the Week'}</div>
            <div className="awp-tName">{c.teacherName || 'Mrs. Johnson'}</div>
            <div className="awp-tFace">
              {c.teacherPhotoUrl
                ? <img src={c.teacherPhotoUrl} alt="" className="awp-tPhoto" />
                : <span>{c.teacherGender === 'male' ? '👨‍🏫' : (c.teacherEmoji || '👩‍🏫')}</span>}
            </div>
          </div>
        </div>

        <div className="awp-birthdays">
          <div className="awp-cluster">
            <div className="awp-bal awp-bal1" />
            <div className="awp-bal awp-bal2" />
            <div className="awp-bal awp-bal3" />
            <div className="awp-cake">🎂</div>
          </div>
          <div className="awp-bdLbl">{c.birthdayLabel || "Today's Birthdays"}</div>
          <div
            className="awp-bdNamesSlot"
            ref={bdSlotRef}
            style={{
              justifyContent: bdShouldScroll ? 'flex-start' : 'center',
            }}
          >
            {bdShouldScroll ? (
              <span
                ref={bdTextRef}
                className="awp-bdNames awp-bdNamesLoop"
                style={{ animation: `awp-bdLoop ${bdScrollDuration}s linear infinite` }}
              >
                <span>{bdInline}</span>
                <span aria-hidden="true">&nbsp;&nbsp;·&nbsp;&nbsp;{bdInline}</span>
              </span>
            ) : (
              <span ref={bdTextRef} className="awp-bdNames">{bdInline}</span>
            )}
          </div>
        </div>

        {/* Ticker — wavy ribbon at bottom */}
        <div className="awp-ticker">
          <div className="awp-tickerStamp">{c.tickerStamp || 'SCHOOL NEWS'}</div>
          <div className="awp-tickerScrollWrap">
            <span
              className="awp-tickerScrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, BASE_TICKER_SEC)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Builder-only click hotspots — never shown on live player. */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={40}  y={40}    w={180}  h={180} />
            <Hotspot section="header"       x={240} y={40}    w={600}  h={180} />
            <Hotspot section="header"       x={860} y={40}    w={180}  h={180} />
            <Hotspot section="weather"      x={40}  y={500}   w={500}  h={360} />
            <Hotspot section="countdown"    x={540} y={500}   w={500}  h={360} />
            <Hotspot section="announcement" x={40}  y={880}   w={1000} h={360} />
            <Hotspot section="teacher"      x={40}  y={1260}  w={500}  h={500} />
            <Hotspot section="birthdays"    x={540} y={1260}  w={500}  h={500} />
            <Hotspot section="ticker"       x={0}   y={1790}  w={1080} h={130} />
          </>
        )}
      </div>
    </div>
  );
}

function Hotspot({ section, x, y, w, h }: { section: string; x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="awp-hotspot"
      data-section={section}
      role="button"
      tabIndex={0}
      onPointerDown={() => {
        try { window.dispatchEvent(new CustomEvent('aw-edit-section', { detail: { section } })); } catch {}
      }}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h, cursor: 'pointer', zIndex: 50 }}
      aria-label={`Edit ${section}`}
    />
  );
}

// CSS — mirror landscape shape-for-shape. Every keyframe animation,
// every clip-path, every layered box-shadow has a 1:1 equivalent.
// Positioning is absolute so the vertical stack fits the portrait
// canvas without grid reflow at different scales.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Patrick+Hand&display=swap');

.awp-stage {
  position: relative;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  color: #2d1b4d;
  background:
    radial-gradient(ellipse at 50% 110%, #fef3c7 0%, transparent 50%),
    linear-gradient(180deg, #BFE8FF 0%, #FFE0EC 55%, #FFD8A8 100%);
  overflow: hidden;
}
.awp-stage::before, .awp-stage::after {
  content: ''; position: absolute; pointer-events: none;
  width: 200%; height: 100%;
  background-image:
    radial-gradient(ellipse 80px 30px at 10% 20%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 120px 40px at 30% 35%, rgba(255,255,255,.6), transparent 60%),
    radial-gradient(ellipse 90px 32px at 55% 18%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 110px 38px at 78% 28%, rgba(255,255,255,.6), transparent 60%);
  animation: awp-cloudDrift 90s linear infinite;
  top: 0; left: -100%;
}
.awp-stage::after { animation-duration: 130s; animation-delay: -40s; opacity: .65; }
@keyframes awp-cloudDrift { from { transform: translateX(0); } to { transform: translateX(50%); } }

.awp-confettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.awp-confetti {
  position: absolute; top: -20px; width: 12px; height: 18px; border-radius: 2px;
  animation: awp-confettiFall linear infinite; will-change: transform;
}
@keyframes awp-confettiFall {
  0%   { transform: translateY(-30px) rotate(0deg); opacity: 0; }
  8%   { opacity: 1; }
  100% { transform: translateY(2000px) rotate(720deg); opacity: .8; }
}

/* Rainbow stripe — same pattern as landscape, positioned lower so
   the header sits above it cleanly. */
.awp-rainbow {
  position: absolute; left: -200px; right: -200px; top: 260px; height: 90px; z-index: 1;
  background: repeating-linear-gradient(135deg,
    #ff5e7e 0 30px, #ffb950 30px 60px, #ffe66d 60px 90px,
    #6cd97e 90px 120px, #5cc5ff 120px 150px, #b48cff 150px 180px);
  background-size: 360px 100%;
  animation: awp-rainbowSlide 8s linear infinite;
  transform: rotate(-3deg);
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
}
@keyframes awp-rainbowSlide { from { background-position: 0 0; } to { background-position: 360px 0; } }

/* HEADER — logo | title box | clock, same row as landscape. */
.awp-header {
  position: absolute; top: 40px; left: 40px; right: 40px;
  display: grid; grid-template-columns: 180px 1fr 180px;
  gap: 20px; z-index: 5; align-items: center;
  height: 220px;
}
.awp-logo {
  width: 180px; height: 180px; background: #fff; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 96px;
  box-shadow: 0 6px 16px rgba(0,0,0,.18), inset 0 0 0 6px #fcd34d;
  animation: awp-bounceLogo 2.4s ease-in-out infinite;
  overflow: hidden;
}
.awp-logoImg { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
@keyframes awp-bounceLogo {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50%      { transform: translateY(-12px) rotate(4deg); }
}
.awp-titleBox {
  background: rgba(255,255,255,.85); backdrop-filter: blur(4px);
  border-radius: 28px; padding: 22px 28px; text-align: center;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  border: 5px dashed #ec4899;
  animation: awp-breathe 3.5s ease-in-out infinite;
}
@keyframes awp-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
.awp-titleBox h1 {
  margin: 0; line-height: .95;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 82px;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 33%, #10b981 66%, #6366f1 100%);
  background-size: 300% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: awp-gradientShift 6s linear infinite;
}
@keyframes awp-gradientShift { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }
.awp-sub { font-family: 'Caveat', cursive; font-size: 42px; color: #92400e; margin-top: 6px; }

.awp-clock {
  width: 180px; height: 180px;
  background: #fff; border-radius: 50%; border: 10px solid #fcd34d;
  box-shadow: 0 6px 16px rgba(0,0,0,.2);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  animation: awp-wiggle 4s ease-in-out infinite;
}
@keyframes awp-wiggle {
  0%, 7%, 100% { transform: rotate(0deg); }
  1%, 5%       { transform: rotate(-12deg); }
  3%           { transform: rotate(12deg); }
}
.awp-clockT { font-size: 52px; color: #be185d; line-height: 1; }
.awp-clockAp { font-size: 26px; color: #92400e; }

/* WEATHER — sun disc with conic-gradient rays. Identical to landscape
   .aw-sunDisc / .aw-sunFace, just in a positioned cell instead of a grid. */
.awp-weather {
  position: absolute; top: 500px; left: 40px; width: 500px; height: 360px; z-index: 8;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 12px;
}
.awp-sunDisc {
  position: relative; width: 240px; height: 240px;
  display: flex; align-items: center; justify-content: center;
}
.awp-sunDisc::before {
  content: ''; position: absolute; inset: -50px; border-radius: 50%;
  background:
    conic-gradient(from 0deg,
      transparent 0 18deg, #fcd34d 18deg 24deg,
      transparent 24deg 48deg, #fcd34d 48deg 54deg,
      transparent 54deg 78deg, #fcd34d 78deg 84deg,
      transparent 84deg 108deg, #fcd34d 108deg 114deg,
      transparent 114deg 138deg, #fcd34d 138deg 144deg,
      transparent 144deg 168deg, #fcd34d 168deg 174deg,
      transparent 174deg 198deg, #fcd34d 198deg 204deg,
      transparent 204deg 228deg, #fcd34d 228deg 234deg,
      transparent 234deg 258deg, #fcd34d 258deg 264deg,
      transparent 264deg 288deg, #fcd34d 288deg 294deg,
      transparent 294deg 318deg, #fcd34d 318deg 324deg,
      transparent 324deg 348deg, #fcd34d 348deg 354deg,
      transparent 354deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 120px, #000 120px, #000 155px, transparent 155px);
          mask: radial-gradient(circle, transparent 120px, #000 120px, #000 155px, transparent 155px);
  animation: awp-spin 18s linear infinite; opacity: .85;
}
@keyframes awp-spin { to { transform: rotate(360deg); } }
.awp-sunFace {
  width: 210px; height: 210px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 60px rgba(251, 191, 36, .65), inset 0 -12px 20px rgba(180, 83, 9, .25);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 72px; color: #7c2d12;
  text-shadow: 0 2px 0 rgba(255,255,255,.4);
}
.awp-weatherDesc {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 44px;
  color: #78350f; margin-top: 14px; text-align: center;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%; height: 48px; line-height: 48px;
}

/* COUNTDOWN — starburst (clip-path polygon). Identical shape to landscape. */
.awp-countdown {
  position: absolute; top: 500px; left: 540px; width: 500px; height: 360px; z-index: 8;
  display: flex; align-items: center; justify-content: center;
}
.awp-badge {
  width: 280px; height: 280px;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 75%, #d97706);
  clip-path: polygon(
    50% 0%, 60% 12%, 75% 8%, 73% 23%, 88% 25%, 80% 38%,
    96% 45%, 84% 55%, 96% 65%, 80% 70%, 88% 82%, 73% 80%,
    75% 96%, 60% 88%, 50% 100%, 40% 88%, 25% 96%, 27% 80%,
    12% 82%, 20% 70%, 4% 65%, 16% 55%, 4% 45%, 20% 38%,
    12% 25%, 27% 23%, 25% 8%, 40% 12%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  box-shadow: 0 12px 28px rgba(0,0,0,.18);
  animation: awp-bounceNum 1.6s ease-in-out infinite;
}
@keyframes awp-bounceNum {
  0%, 100% { transform: scale(1) rotate(-3deg); }
  50%      { transform: scale(1.06) rotate(3deg); }
}
.awp-cdLbl { font-family: 'Fredoka'; font-weight: 700; font-size: 18px; letter-spacing: .08em; color: #7c2d12; text-transform: uppercase; max-width: 150px; line-height: 1.1; }
.awp-cdNum { font-family: 'Fredoka'; font-weight: 700; font-size: 88px; line-height: .9; color: #7c2d12; text-shadow: 0 3px 0 rgba(255,255,255,.5); margin: 6px 0; }
.awp-cdUnit { font-family: 'Caveat'; font-size: 32px; color: #7c2d12; }

/* ANNOUNCEMENT — cloud puff built from box-shadows. Same recipe as
   landscape (.aw-announce::before) but sized to the portrait cell. */
.awp-announce {
  position: absolute; top: 880px; left: 40px; right: 40px; height: 360px; z-index: 8;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
  padding: 40px 80px;
  animation: awp-floatUp 4s ease-in-out infinite;
}
@keyframes awp-floatUp {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50%      { transform: translateY(-10px) rotate(1deg); }
}
.awp-announce::before {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 320px; height: 220px; transform: translate(-50%, -50%);
  background: #fff; border-radius: 50%;
  box-shadow:
    -220px 30px 0 -10px #fff, -150px -55px 0 -8px #fff, -60px -100px 0 -2px #fff,
    70px -100px 0 -4px #fff, 170px -55px 0 -8px #fff, 230px 30px 0 -10px #fff,
    140px 75px 0 -6px #fff, 0 100px 0 -2px #fff, -140px 75px 0 -6px #fff,
    0 0 0 4px #fcd34d,
    -220px 30px 0 -6px #fcd34d, -150px -55px 0 -4px #fcd34d, -60px -100px 0 2px #fcd34d,
    70px -100px 0 0 #fcd34d, 170px -55px 0 -4px #fcd34d, 230px 30px 0 -6px #fcd34d,
    140px 75px 0 -2px #fcd34d, 0 100px 0 2px #fcd34d, -140px 75px 0 -2px #fcd34d,
    0 16px 32px rgba(0,0,0,.18);
  z-index: -1;
}
.awp-stars { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.awp-stars span { position: absolute; font-size: 42px; opacity: .9; animation: awp-twinkle 1.4s ease-in-out infinite; }
.awp-stars span:nth-child(1) { top: 46px;  left: 120px; }
.awp-stars span:nth-child(2) { top: 70px;  right: 130px; animation-delay: .3s; }
.awp-stars span:nth-child(3) { bottom: 70px; left: 150px; animation-delay: .6s; }
.awp-stars span:nth-child(4) { bottom: 52px; right: 160px; animation-delay: .9s; }
@keyframes awp-twinkle {
  0%, 100% { opacity: .25; transform: scale(.8) rotate(0deg); }
  50%      { opacity: 1;   transform: scale(1.2) rotate(20deg); }
}
.awp-megaphone { font-size: 88px; line-height: 1; animation: awp-shake 1.6s ease-in-out infinite; transform-origin: 80% 80%; position: relative; z-index: 2; }
@keyframes awp-shake {
  0%, 100%  { transform: rotate(-8deg); }
  20%, 60%  { transform: rotate(10deg); }
  40%, 80%  { transform: rotate(-10deg); }
}
.awp-annLbl { font-family: 'Fredoka'; font-weight: 700; font-size: 26px; letter-spacing: .25em; color: #b45309; text-transform: uppercase; margin-top: 12px; position: relative; z-index: 2; }
.awp-annMsg { font-family: 'Caveat', cursive; font-weight: 700; font-size: 72px; color: #be185d; line-height: 1.05; margin-top: 16px; text-shadow: 2px 2px 0 #fff; max-width: 820px; position: relative; z-index: 2; }

/* TEACHER — polaroid with washi-tape caption. Identical to landscape,
   proportionally sized for the 500×500 cell. */
.awp-teacher {
  position: absolute; top: 1260px; left: 40px; width: 500px; height: 500px; z-index: 8;
  display: flex; flex-direction: column; align-items: center;
  justify-content: flex-start;
  padding-top: 36px;
}
.awp-polaroid {
  background: #fff; padding: 44px 22px 22px; width: 380px;
  box-shadow: 0 12px 24px rgba(0,0,0,.22);
  transform: rotate(-3deg); position: relative;
  animation: awp-slideX 5s ease-in-out infinite;
  display: flex; flex-direction: column; align-items: center;
}
@keyframes awp-slideX {
  0%, 100% { transform: rotate(-3deg) translateX(-4px); }
  50%      { transform: rotate(-3deg) translateX(4px); }
}
.awp-tWashi {
  position: absolute; top: -22px; left: 50%;
  transform: translateX(-50%) rotate(-3deg);
  min-width: 90%;
  padding: 9px 18px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #f9a8d4;
  box-shadow: 0 2px 6px rgba(0,0,0,.22);
  font-family: 'Fredoka'; font-weight: 700; font-size: 20px;
  letter-spacing: .14em; text-transform: uppercase; color: #831843;
  text-align: center;
  text-shadow: 0 1px 0 rgba(255,255,255,.4);
  white-space: nowrap; z-index: 2;
}
.awp-tName {
  font-family: 'Caveat'; font-weight: 700; font-size: 44px; color: #6d28d9;
  line-height: 1; text-align: center;
  margin-bottom: 12px;
}
.awp-tFace {
  width: 100%; aspect-ratio: 1;
  background: linear-gradient(135deg, #fce7f3, #ddd6fe);
  display: flex; align-items: center; justify-content: center; font-size: 160px;
  overflow: hidden;
}
.awp-tPhoto { width: 100%; height: 100%; object-fit: cover; }

/* BIRTHDAYS — balloon cluster + cake + label + inline names. */
.awp-birthdays {
  position: absolute; top: 1260px; left: 540px; width: 500px; height: 500px; z-index: 8;
  display: flex; flex-direction: column; align-items: center;
  justify-content: flex-start;
  padding: 30px 12px 12px;
}
.awp-cluster {
  position: relative; width: 240px; height: 200px;
  animation: awp-bob 1.4s ease-in-out infinite;
}
@keyframes awp-bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50%      { transform: translateY(-12px) rotate(3deg); }
}
.awp-bal {
  position: absolute; width: 88px; height: 110px; border-radius: 50% 50% 48% 48%;
  box-shadow: inset -8px -10px 12px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.18);
}
.awp-bal::after {
  content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 60px;
  background: rgba(0,0,0,.4); transform: translateX(-50%);
}
.awp-bal1 { left: 10px;  top: 0;   background: #f87171; }
.awp-bal2 { left: 78px;  top: 14px; background: #fbbf24; transform: rotate(-6deg); width: 80px; height: 100px; }
.awp-bal3 { left: 150px; top: 0;   background: #ec4899; }
.awp-cake { position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); font-size: 60px; line-height: 1; }

.awp-bdLbl {
  font-family: 'Fredoka'; font-weight: 700; font-size: 26px;
  letter-spacing: .14em; color: #be185d; text-transform: uppercase;
  margin-top: 30px; text-shadow: 0 2px 0 rgba(255,255,255,.7);
}
.awp-bdNamesSlot {
  width: 460px; max-width: 460px; height: 110px;
  margin-top: 12px;
  display: flex; align-items: center;
  overflow: hidden; pointer-events: none;
}
.awp-bdNames {
  font-family: 'Caveat'; font-weight: 700;
  font-size: 60px; line-height: 1; color: #831843;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
  white-space: nowrap; display: inline-block;
}
@keyframes awp-bdLoop {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.awp-bdNamesLoop {
  display: inline-flex; align-items: center; white-space: nowrap; will-change: transform;
}

/* TICKER — wavy ribbon with zigzag clip-path. Same as landscape. */
.awp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 130px;
  background: linear-gradient(90deg, #fcd34d, #fbbf24);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 5px solid #ec4899;
  box-shadow: 0 -4px 12px rgba(0,0,0,.12);
  clip-path: polygon(
    0% 16%, 5% 0%, 10% 16%, 15% 0%, 20% 16%, 25% 0%, 30% 16%, 35% 0%, 40% 16%,
    45% 0%, 50% 16%, 55% 0%, 60% 16%, 65% 0%, 70% 16%, 75% 0%, 80% 16%, 85% 0%,
    90% 16%, 95% 0%, 100% 16%, 100% 100%, 0% 100%);
}
.awp-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: #ec4899; color: #fff; display: flex; align-items: center;
  font-family: 'Fredoka'; font-weight: 700; letter-spacing: .15em; font-size: 24px;
  margin-top: 20px;
  position: relative; z-index: 2;
}
.awp-tickerScrollWrap {
  flex: 1; height: 100%; overflow: hidden;
  display: flex; align-items: center; margin-top: 20px;
  position: relative;
}
.awp-tickerScrollText {
  display: inline-block;
  font-family: 'Fredoka'; font-weight: 700; font-size: 40px; color: #831843;
  white-space: nowrap; padding-left: 60px;
  animation: awp-scrollText 30s linear infinite;
  will-change: transform;
}
@keyframes awp-scrollText {
  from { transform: translateX(100%); }
  to   { transform: translateX(-100%); }
}

/* Background balloons rising from bottom — same as landscape .aw-bgBalloon. */
.awp-bgBalloon {
  position: absolute; bottom: -120px; width: 60px; height: 76px;
  border-radius: 50% 50% 48% 48%;
  z-index: 2; animation: awp-balloonRise linear infinite; will-change: transform;
}
.awp-bgBalloon::after {
  content: ''; position: absolute; left: 50%; top: 100%;
  width: 1px; height: 240px; background: rgba(0,0,0,.3); transform: translateX(-50%);
}
@keyframes awp-balloonRise {
  0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
  10%  { opacity: 1; }
  50%  { transform: translateY(-960px) translateX(24px) rotate(8deg); }
  100% { transform: translateY(-2080px) translateX(-24px) rotate(-8deg); opacity: .9; }
}

/* Builder-only hotspots. */
.awp-hotspot {
  outline: none;
  transition: box-shadow .15s ease, background-color .15s ease;
  border-radius: 12px;
}
.awp-hotspot:hover {
  background-color: rgba(236, 72, 153, .08);
  box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55);
}
.awp-hotspot:focus-visible {
  background-color: rgba(236, 72, 153, .12);
  box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85);
}
`;
