"use client";

/**
 * AnimatedWelcomePortraitWidget — 1080×1920 portrait variant of the
 * Rainbow welcome scene.
 *
 * Uses the same Cfg shape as AnimatedWelcomeWidget (title, subtitle,
 * announcement, countdown, teacher, birthdays, ticker) so swapping
 * between landscape and portrait doesn't require reconfiguring the
 * template. Layout is vertical — header strip, weather+countdown row,
 * big announcement, teacher polaroid, birthdays, scrolling ticker.
 *
 * Pattern match to the landscape version:
 *  - Fixed 1080×1920 canvas + transform:scale via ResizeObserver
 *  - Hotspots gated on !isLive so published signage shows no affordances
 *  - tickerDurationSec helper for the toolbar speed setting
 *  - Live weather + live clock gated on isLive (no API spam in preview)
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
  teacherName?: string;
  teacherRole?: string;
  teacherPhotoUrl?: string;
  teacherEmoji?: string;
  teacherCaption?: string;
  birthdayLabel?: string;
  birthdayNames?: string | string[];
  tickerStamp?: string;
  tickerMessages?: string[];
  tickerSpeed?: 'slow' | 'normal' | 'fast' | number;
}

const BASE_TICKER_SEC = 32;

function tickerDurationSec(speed: Cfg['tickerSpeed'], base: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return base * 1.8;
  if (speed === 'fast') return base * 0.6;
  return base;
}

export function AnimatedWelcomePortraitWidget({
  config,
  live,
  width,
  height,
}: {
  config?: Cfg;
  live?: boolean;
  width?: number;
  height?: number;
}) {
  const c: Cfg = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  // ResizeObserver — scale 1080-wide scene to whatever the container gives us.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Fit-inside: pick the smaller ratio so neither axis overflows.
      const sW = w / 1080;
      const sH = h / 1920;
      setScale(Math.min(sW, sH));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // ─── Live clock ───
  const tz = (c.clockTimeZone || '').trim();
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [isLive]);
  const clockTime = (() => {
    try {
      return now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: tz || undefined,
      });
    } catch { return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  })();

  // ─── Live weather (optional) ───
  const [weather, setWeather] = useState<{ temp: string; desc: string } | null>(null);
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const loc = (c.weatherLocation || '').trim();
        if (!loc) return;
        const unit = c.weatherUnits === 'metric' ? 'celsius' : 'fahrenheit';
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1`).then((r) => r.json()).catch(() => null);
        const lat = geo?.results?.[0]?.latitude;
        const lon = geo?.results?.[0]?.longitude;
        if (!lat || !lon || cancelled) return;
        const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${unit}`).then((r) => r.json()).catch(() => null);
        if (!wx?.current_weather || cancelled) return;
        const t = Math.round(wx.current_weather.temperature);
        setWeather({ temp: `${t}°`, desc: wx.current_weather.is_day ? 'Sunny' : 'Clear night' });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [isLive, c.weatherLocation, c.weatherUnits]);

  const temp = c.weatherTemp || weather?.temp || '72°';
  const desc = c.weatherDesc || weather?.desc || 'Sunny';

  // ─── Countdown ───
  let cdNum: string | number = c.countdownNumber ?? '';
  if (c.countdownDate) {
    try {
      const target = new Date(c.countdownDate);
      const days = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
      cdNum = days;
    } catch { /* ignore */ }
  }
  if (cdNum === '' || cdNum === undefined) cdNum = 42;
  const cdUnit = c.countdownUnit || 'days';

  // ─── Birthdays ───
  const birthdays = Array.isArray(c.birthdayNames)
    ? c.birthdayNames
    : (c.birthdayNames || 'Alex · Jordan · Sam').split('·').map((s) => s.trim()).filter(Boolean);
  const birthdayFont = birthdays.length >= 4 ? 28 : birthdays.length === 3 ? 34 : 40;

  const tickerText = (c.tickerMessages || [
    '🌈 Welcome back, Stars! ⭐',
    '📖 Reading Challenge — 20 minutes a day',
    '🎉 Field trip Friday — permission slips due!',
    '📚 Library is open until 4 PM',
  ]).join('   ·   ');

  const tickerSeconds = tickerDurationSec(c.tickerSpeed, BASE_TICKER_SEC);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', background: '#BFE8FF' }}>
      <style>{CSS}</style>
      <div
        className="awp-stage"
        style={{
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'top left',
          width: 1080,
          height: 1920,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {/* Sky gradient + confetti drift bg */}
        <div className="awp-bg" />
        <div className="awp-confetti">
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="awp-conf" style={{ '--i': i } as any} />
          ))}
        </div>

        {/* Clouds */}
        <div className="awp-cloud awp-cloud-1" />
        <div className="awp-cloud awp-cloud-2" />

        {/* Sun */}
        <div className="awp-sun" />

        {/* Header: logo + title + clock stacked */}
        <div className="awp-header">
          <div className="awp-logo">
            {c.logoUrl
              ? <img src={c.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span>{c.logoEmoji || '🍎'}</span>}
          </div>
          <h1 className="awp-title">{c.title || 'Welcome, Friends!'}</h1>
          <p className="awp-subtitle">{c.subtitle || 'Today is going to be amazing ✨'}</p>
          <div className="awp-clock">{clockTime}</div>
        </div>

        {/* Weather + Countdown row */}
        <div className="awp-row awp-row-2">
          <div className="awp-card awp-weather">
            <div className="awp-weather-ball">☀️</div>
            <div className="awp-weather-temp">{temp}</div>
            <div className="awp-weather-desc">{desc}</div>
          </div>
          <div className="awp-card awp-countdown">
            <div className="awp-cd-label">{c.countdownLabel || 'Field Trip in'}</div>
            <div className="awp-cd-num">{cdNum}</div>
            <div className="awp-cd-unit">{cdUnit}</div>
          </div>
        </div>

        {/* Announcement (big) */}
        <div className="awp-announcement">
          <div className="awp-ann-label">{c.announcementLabel || 'Big News'}</div>
          <div className="awp-ann-msg">{c.announcementMessage || 'Book Fair starts Monday! Come find your new favorite story 📚'}</div>
          <span className="awp-ann-deco awp-ann-deco-1">⭐</span>
          <span className="awp-ann-deco awp-ann-deco-2">🎈</span>
        </div>

        {/* Teacher polaroid */}
        <div className="awp-card awp-teacher">
          <div className="awp-tWashi">★ Teacher of the Week ★</div>
          <div className="awp-tPhoto">
            {c.teacherPhotoUrl
              ? <img src={c.teacherPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />
              : <span className="awp-tEmoji">{c.teacherEmoji || '👩‍🏫'}</span>}
          </div>
          <div className="awp-tName">{c.teacherName || 'Mrs. Johnson'}</div>
          <div className="awp-tRole">{c.teacherRole || 'Inspires kids every day'}</div>
        </div>

        {/* Birthdays cluster */}
        <div className="awp-card awp-birthdays">
          <div className="awp-bdLabel">{c.birthdayLabel || '🎂 Today\u2019s Birthdays'}</div>
          <div className="awp-bdBalloons">
            <span className="awp-balloon awp-balloon-1" />
            <span className="awp-balloon awp-balloon-2" />
            <span className="awp-balloon awp-balloon-3" />
          </div>
          <div className="awp-bdNames" style={{ fontSize: birthdayFont }}>
            {birthdays.join(' · ')}
          </div>
        </div>

        {/* Ticker */}
        <div className="awp-ticker">
          <div className="awp-ticker-stamp">{c.tickerStamp || 'SCHOOL NEWS'}</div>
          <div className="awp-ticker-scroll">
            <span
              className="awp-ticker-text"
              style={{ animationDuration: `${tickerSeconds}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — builder only. Each routes to the matching
            PropertiesPanel section via the shared aw-edit-section
            CustomEvent. */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={0}   y={0}    w={1080} h={500} />
            <Hotspot section="weather"      x={40}  y={520}  w={500}  h={300} />
            <Hotspot section="countdown"    x={540} y={520}  w={500}  h={300} />
            <Hotspot section="announcement" x={40}  y={840}  w={1000} h={400} />
            <Hotspot section="teacher"      x={40}  y={1260} w={500}  h={580} />
            <Hotspot section="birthdays"    x={540} y={1260} w={500}  h={580} />
            <Hotspot section="ticker"       x={0}   y={1840} w={1080} h={80} />
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

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Patrick+Hand&display=swap');
.awp-stage * { box-sizing: border-box; }
.awp-stage { font-family: 'Fredoka', ui-sans-serif, system-ui, sans-serif; color: #1e3a8a; }

.awp-bg { position: absolute; inset: 0; background:
  radial-gradient(ellipse at 20% 0%, #ffe0ec 0%, transparent 55%),
  radial-gradient(ellipse at 80% 15%, #fef08a 0%, transparent 50%),
  linear-gradient(180deg, #BFE8FF 0%, #FFE0EC 55%, #FFD8A8 100%);
  z-index: 0; }

.awp-confetti { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.awp-conf { position: absolute; top: -40px; width: 16px; height: 16px; border-radius: 4px;
  animation: awp-conf 14s linear infinite;
  animation-delay: calc(var(--i) * -0.6s);
  left: calc(var(--i) * 4.2%);
  background: hsl(calc(var(--i) * 22), 85%, 65%);
  transform: rotate(calc(var(--i) * 17deg));
  opacity: .55; }
@keyframes awp-conf {
  0%   { top: -50px; opacity: 0; }
  15%  { opacity: .7; }
  100% { top: 1960px; opacity: 0; transform: rotate(1080deg); }
}

.awp-cloud { position: absolute; z-index: 2; background: #fff; border-radius: 60%;
  box-shadow: 0 6px 14px rgba(59, 130, 246, .15);
  animation: awp-cloud-drift 28s ease-in-out infinite alternate;
}
.awp-cloud-1 { top: 90px; left: 40px; width: 240px; height: 110px; animation-delay: 0s; }
.awp-cloud-2 { top: 340px; right: 30px; width: 200px; height: 90px; animation-delay: -6s; }
@keyframes awp-cloud-drift {
  0%   { transform: translateX(0); }
  100% { transform: translateX(30px); }
}

.awp-sun { position: absolute; top: 60px; right: 80px; width: 160px; height: 160px;
  border-radius: 50%; background: radial-gradient(circle, #fde047 0%, #facc15 65%, #f59e0b 100%);
  box-shadow: 0 0 80px rgba(250, 204, 21, .6);
  z-index: 3; animation: awp-sun-spin 40s linear infinite; }
@keyframes awp-sun-spin {
  0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }
}

.awp-header { position: absolute; top: 60px; left: 40px; right: 40px; z-index: 8; text-align: center; }
.awp-logo { display: inline-flex; align-items: center; justify-content: center; width: 140px; height: 140px;
  background: #fff; border-radius: 36px; box-shadow: 0 8px 24px rgba(236, 72, 153, .25);
  font-size: 90px; margin: 0 auto 20px; }
.awp-title { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 96px; line-height: 1; margin: 0;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 45%, #10b981 100%); -webkit-background-clip: text;
  background-clip: text; color: transparent; text-shadow: 0 4px 0 rgba(255,255,255,.6); }
.awp-subtitle { font-family: 'Caveat', cursive; font-size: 42px; color: #be185d; margin: 10px 0 0; }
.awp-clock { display: inline-block; margin-top: 22px; padding: 14px 36px; background: #fff; border-radius: 24px;
  box-shadow: 0 6px 18px rgba(0,0,0,.1); font-family: 'Fredoka'; font-weight: 700; font-size: 52px; color: #1e40af; }

.awp-row { position: absolute; left: 40px; right: 40px; z-index: 8; display: grid; gap: 20px; }
.awp-row-2 { top: 520px; height: 300px; grid-template-columns: 1fr 1fr; }

.awp-card { background: #fff; border-radius: 32px; padding: 24px; box-shadow: 0 8px 24px rgba(30, 64, 175, .12);
  position: relative; overflow: hidden; }

.awp-weather { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  background: linear-gradient(180deg, #fef3c7, #fde68a); }
.awp-weather-ball { font-size: 80px; line-height: 1; animation: awp-breathe 3s ease-in-out infinite; }
.awp-weather-temp { font-size: 72px; font-weight: 700; color: #92400e; line-height: 1; }
.awp-weather-desc { font-family: 'Caveat'; font-size: 28px; color: #b45309; }
@keyframes awp-breathe {
  0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); }
}

.awp-countdown { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: linear-gradient(180deg, #ffe4e6, #fecdd3); }
.awp-cd-label { font-family: 'Caveat'; font-size: 32px; color: #be185d; }
.awp-cd-num { font-family: 'Fredoka'; font-weight: 700; font-size: 128px; line-height: 1; color: #be185d;
  text-shadow: 0 4px 0 rgba(255,255,255,.5); }
.awp-cd-unit { font-family: 'Fredoka'; font-weight: 500; font-size: 26px; color: #9d174d; text-transform: uppercase; letter-spacing: .2em; }

.awp-announcement { position: absolute; top: 840px; left: 40px; right: 40px; height: 400px; z-index: 8;
  background: #fff; border-radius: 40px; padding: 38px;
  box-shadow: 0 12px 32px rgba(236, 72, 153, .25);
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  border: 6px dashed #f9a8d4; }
.awp-ann-label { font-family: 'Caveat'; font-weight: 700; font-size: 44px; color: #be185d; margin-bottom: 12px;
  letter-spacing: .05em; }
.awp-ann-msg { font-family: 'Fredoka'; font-weight: 700; font-size: 58px; line-height: 1.15; color: #be185d;
  max-width: 100%; }
.awp-ann-deco { position: absolute; font-size: 64px; animation: awp-spin 6s ease-in-out infinite; }
.awp-ann-deco-1 { top: -20px; left: -20px; }
.awp-ann-deco-2 { bottom: -24px; right: -24px; animation-delay: -3s; }
@keyframes awp-spin {
  0%, 100% { transform: rotate(-8deg) scale(1); }
  50%      { transform: rotate(8deg) scale(1.1); }
}

.awp-teacher { position: absolute; top: 1260px; left: 40px; width: 500px; height: 580px; z-index: 8;
  background: #fff; padding: 24px 24px 28px;
  transform: rotate(-2deg);
  box-shadow: 0 12px 28px rgba(0, 0, 0, .15); }
.awp-tWashi { position: absolute; top: -18px; left: 50%; transform: translateX(-50%) rotate(-3deg);
  background: repeating-linear-gradient(45deg, #f9a8d4 0 14px, #fce7f3 14px 28px);
  padding: 8px 24px; font-family: 'Patrick Hand'; font-size: 22px; color: #831843;
  box-shadow: 0 3px 6px rgba(0,0,0,.1); }
.awp-tPhoto { margin-top: 18px; width: 100%; height: 360px; border-radius: 12px;
  background: linear-gradient(180deg, #fce7f3, #fbcfe8);
  display: flex; align-items: center; justify-content: center; }
.awp-tEmoji { font-size: 180px; line-height: 1; }
.awp-tName { font-family: 'Caveat'; font-weight: 700; font-size: 56px; color: #be185d; text-align: center; margin-top: 14px; }
.awp-tRole { font-family: 'Patrick Hand'; font-size: 26px; color: #475569; text-align: center; margin-top: 4px; }

.awp-birthdays { position: absolute; top: 1260px; right: 40px; width: 500px; height: 580px; z-index: 8;
  background: linear-gradient(180deg, #fef3c7, #fde68a);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  transform: rotate(2deg); padding: 24px; }
.awp-bdLabel { font-family: 'Caveat'; font-weight: 700; font-size: 48px; color: #b45309; }
.awp-bdBalloons { position: relative; width: 260px; height: 240px; }
.awp-balloon { position: absolute; width: 90px; height: 110px; border-radius: 50% 50% 50% 50% / 55% 55% 45% 45%;
  animation: awp-bob 3.5s ease-in-out infinite; }
.awp-balloon::after { content: ''; position: absolute; top: 100%; left: 50%; width: 2px; height: 70px; background: rgba(0,0,0,.3); }
.awp-balloon-1 { left: 10px;  top: 0;   background: #f472b6; animation-delay: 0s; }
.awp-balloon-2 { left: 90px;  top: 30px; background: #fbbf24; animation-delay: -1.5s; }
.awp-balloon-3 { left: 170px; top: 10px; background: #34d399; animation-delay: -3s; }
@keyframes awp-bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50%      { transform: translateY(-10px) rotate(3deg); }
}
.awp-bdNames { font-family: 'Caveat'; font-weight: 700; color: #92400e; line-height: 1.1;
  text-align: center; white-space: nowrap; }

.awp-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 80px; z-index: 9;
  background: #1e40af; color: #fff; display: flex; align-items: center; overflow: hidden; }
.awp-ticker-stamp { padding: 0 24px; font-family: 'Fredoka'; font-weight: 700; font-size: 24px; letter-spacing: .12em;
  background: #f59e0b; color: #78350f; height: 100%; display: flex; align-items: center; flex-shrink: 0; }
.awp-ticker-scroll { flex: 1; overflow: hidden; position: relative; }
.awp-ticker-text { display: inline-block; padding-left: 100%; white-space: nowrap; font-family: 'Fredoka';
  font-size: 36px; animation: awp-ticker linear infinite; }
@keyframes awp-ticker {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-100%); }
}

.awp-hotspot { outline: none; }
.awp-hotspot:hover { background: rgba(244, 114, 182, .08); border: 2px dashed #ec4899; border-radius: 16px; }
`;
