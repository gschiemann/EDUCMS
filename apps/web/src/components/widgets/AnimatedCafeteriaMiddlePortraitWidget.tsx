"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.

/**
 * AnimatedCafeteriaMiddlePortraitWidget — REAL 4K portrait companion to
 * AnimatedCafeteriaMiddleWidget (middle-school stadium / varsity theme).
 *
 * NOT letterboxed. Native 2160×3840 canvas. Same data-field keys as the
 * landscape widget so the auto-form editor + canvas hotspots work
 * identically. Same data flow (live clock, weekday-aware menu pick,
 * countdown days, birthday list, allergen ticker).
 *
 * Vertical re-flow (stadium aesthetic, navy #0f172a base):
 *   • Pennant bunting strip across the very top
 *   • ~700px hero — varsity shield + GAME-DAY MENU ribbon + scoreboard clock card
 *   • ~700px scoreboard hero — animated-bulb perimeter, TODAY'S LINEUP + clock + date
 *   • ~700px Mon-Fri tab strip + featured day's menu (5-row stadium card)
 *   • ~700px two-up — Chef varsity patch + Birthdays cake card
 *   • ~400px nutrition / allergen icon strip
 *   • ~440px scrolling allergen ticker with PA SYSTEM stamp
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type MenuItem = { emoji?: string; name?: string; meta?: string; price?: string };
type WeekMenu = {
  monday?: MenuItem[];
  tuesday?: MenuItem[];
  wednesday?: MenuItem[];
  thursday?: MenuItem[];
  friday?: MenuItem[];
};

interface Cfg {
  // Header
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;

  // Today's Special
  specialEmoji?: string;
  specialLabel?: string;
  specialName?: string;

  // Menu
  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];

  // Countdown
  countdownEmoji?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;

  // Chef
  chefName?: string;
  chefRole?: string;
  chefEmoji?: string;
  chefPhotoUrl?: string;

  // Birthdays
  birthdayNames?: string | string[];

  // Ticker
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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

function pickMenuForToday(week: WeekMenu | undefined, dow: number): MenuItem[] | null {
  if (!week) return null;
  const order: (keyof WeekMenu)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  if (dow >= 1 && dow <= 5) {
    const list = week[order[dow - 1]];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const list = week[order[i]];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return null;
}

export function AnimatedCafeteriaMiddlePortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
  const c = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());

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

  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '11';
  const mm = parts.find(p => p.type === 'minute')?.value || '45';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  const today = now.getDay();
  const menuItems: MenuItem[] = useMemo(() => {
    const picked = pickMenuForToday(c.weekMenu, today);
    if (picked && picked.length > 0) return picked;
    if (Array.isArray(c.menuItems) && c.menuItems.length > 0) return c.menuItems;
    return [
      { emoji: '🍕', name: 'Pepperoni Pizza', meta: '🌾 🧀', price: '$3.25' },
      { emoji: '🍔', name: 'Stadium Burger',  meta: '🌾 🧀', price: '$3.50' },
      { emoji: '🍟', name: 'Crispy Fries',    meta: 'veg · gf', price: '$1.75' },
      { emoji: '🥗', name: 'Garden Salad',    meta: 'veg', price: '$2.50' },
      { emoji: '🥛', name: 'Milk · White or Chocolate', meta: '🧀', price: '$0.75' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 4;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  const birthdayList: string[] = useMemo(() => {
    if (Array.isArray(c.birthdayNames)) return c.birthdayNames.filter(Boolean);
    if (typeof c.birthdayNames === 'string') {
      return c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean);
    }
    return ['JORDAN', 'TYLER', 'ALEX'];
  }, [c.birthdayNames]);

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ★  ');
    return 'VARSITY FOOTBALL PEP RALLY 2:30 FRIDAY · TACO TUESDAY $3.50 · PIZZA FRIDAY RETURNS · YEARBOOK ORDERS DUE · GO EAGLES! 🦅';
  }, [c.tickerMessages]);

  // Pennants for bunting (28 across the top, alternating colors)
  const pennants = useMemo(() => {
    const cols = ['#dc2626', '#fbbf24', '#3b82f6'];
    return Array.from({ length: 28 }, (_, i) => ({
      x: i * 80,
      color: cols[i % 3],
    }));
  }, []);

  // Scoreboard bulbs perimeter — 18 across top/bottom, 12 each side
  const scoreboardBulbs = useMemo(() => {
    const out: { left: number; top: number; delay: number }[] = [];
    const W = 1880; const H = 600;
    for (let i = 0; i < 18; i++) {
      out.push({ left: 40 + (i * (W - 80)) / 17, top: 30, delay: i * 0.08 });
      out.push({ left: 40 + (i * (W - 80)) / 17, top: H - 30, delay: i * 0.08 + 0.4 });
    }
    for (let i = 1; i < 12; i++) {
      out.push({ left: 30, top: 30 + (i * (H - 60)) / 12, delay: i * 0.1 });
      out.push({ left: W - 30, top: 30 + (i * (H - 60)) / 12, delay: i * 0.1 + 0.5 });
    }
    return out;
  }, []);

  const chefFace = c.chefEmoji || '👨‍🍳';
  const specialEmoji = c.specialEmoji || '🍕';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0e27',
      }}
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
        {/* Stadium spotlights */}
        <div className="msp-spot msp-l" />
        <div className="msp-spot msp-r" />

        {/* Pennant bunting across the top */}
        <div className="msp-bunting">
          <svg viewBox="0 0 2160 130" preserveAspectRatio="none">
            <path d="M0 0 L2160 0 L2160 12 L0 12 Z" fill="#fbbf24"/>
            <g>
              {pennants.map((p, i) => (
                <polygon
                  key={i}
                  className="msp-pennant"
                  points={`${p.x},12 ${p.x + 70},12 ${p.x + 35},95`}
                  fill={p.color}
                  stroke="#fff"
                  strokeWidth={3}
                />
              ))}
            </g>
          </svg>
        </div>

        {/* Hero — varsity shield + ribbon title + subtitle */}
        <div className="msp-hero">
          <div className="msp-shield">
            <div className="msp-shieldInner">
              <div className="msp-shieldEmoji" data-field="logoEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.logoEmoji || '🍴'}</div>
            </div>
          </div>

          <div className="msp-varsity">
            <div className="msp-letter" style={{ background: '#dc2626' }}>C</div>
            <div className="msp-letter" style={{ background: '#fbbf24', color: '#0f172a' }}>A</div>
            <div className="msp-letter" style={{ background: '#3b82f6' }}>F</div>
            <div className="msp-letter" style={{ background: '#dc2626' }}>E</div>
          </div>

          <div className="msp-ribbon">
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'GAME-DAY MENU').toUpperCase()}</h1>
            <div className="msp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ fuel up, Eagles ~'}</div>
          </div>
        </div>

        {/* Scoreboard hero card with animated bulb perimeter */}
        <div className="msp-scoreboard">
          <div className="msp-sbBulbs">
            {scoreboardBulbs.map((b, i) => (
              <div
                key={i}
                className="msp-sbBulb"
                style={{ left: b.left, top: b.top, animationDelay: `${b.delay}s` }}
              />
            ))}
          </div>
          <div className="msp-sbInner">
            <div className="msp-sbHeader">★ TODAY&apos;S LINEUP ★</div>
            <div className="msp-sbClockRow">
              <div className="msp-sbClock">
                <span className="msp-sbHH">{hh}:{mm}</span>
                <span className="msp-sbAP">{ampm}</span>
              </div>
              <div className="msp-sbDivider" />
              <div className="msp-sbDate">{dateLine}</div>
            </div>
          </div>
        </div>

        {/* Day-of-week tab strip + featured menu */}
        <div className="msp-menuBlock">
          <div className="msp-dayTabs">
            {(['MON','TUE','WED','THU','FRI'] as const).map((d, i) => {
              const isToday = today === i + 1;
              return <span key={d} className={`msp-day${isToday ? ' msp-dayToday' : ''}`}>{d}</span>;
            })}
          </div>

          <div className="msp-menu">
            <div className="msp-menuStripe" />
            <div className="msp-menuBody">
              <h2>Today&apos;s Lineup</h2>
              <div className="msp-items">
                {menuItems.slice(0, 5).map((it, i) => {
                  const src = it.emoji || '';
                  const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                  return (
                    <div key={i} className="msp-item">
                      <span className="msp-itemEmoji">
                        {isUrl ? <img src={src} alt="" className="msp-itemImg" /> : (src || '🍽️')}
                      </span>
                      <div className="msp-itemInfo">
                        <div className="msp-itemName">{it.name || ''}</div>
                        {it.meta && <div className="msp-itemMeta">{it.meta}</div>}
                      </div>
                      <div className="msp-leader" />
                      {it.price && <span className="msp-itemPrice">{it.price}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Two-up — Chef varsity patch + Birthdays cake card */}
        <div className="msp-twoUp">
          <div className="msp-chef">
            <div className="msp-patch">
              <div className="msp-patchRole" data-field="chefRole" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.chefRole || 'LUNCH CHEF').toUpperCase()} ★</div>
              <div className="msp-patchFace" data-field="chefEmoji" style={{ whiteSpace: 'pre-wrap' }}>
                {c.chefPhotoUrl
                  ? <img src={c.chefPhotoUrl} alt="" className="msp-patchPhoto" />
                  : <span>{chefFace}</span>}
              </div>
              <div className="msp-jersey">#7</div>
              <div className="msp-patchName" data-field="chefName" style={{ whiteSpace: 'pre-wrap' }}>{(c.chefName || 'CHEF RIVERA').toUpperCase()}</div>
            </div>
            <div className="msp-special">
              <div className="msp-specialEmoji" data-field="specialEmoji" style={{ whiteSpace: 'pre-wrap' }}>{specialEmoji}</div>
              <div className="msp-specialLbl" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.specialLabel || 'PICKUP SPECIAL').toUpperCase()}</div>
              <div className="msp-specialName" data-field="specialName" style={{ whiteSpace: 'pre-wrap' }}>{c.specialName || 'Stuffed Crust'}</div>
            </div>
          </div>

          <div className="msp-birthdays">
            <div className="msp-cakeWrap">
              <div className="msp-candle msp-c1" /><div className="msp-candle msp-c2" /><div className="msp-candle msp-c3" />
              <div className="msp-flame msp-f1" /><div className="msp-flame msp-f2" /><div className="msp-flame msp-f3" />
              <div className="msp-tier1" />
              <div className="msp-tier2" />
            </div>
            <div className="msp-bdLbl">★ BIRTHDAYS TODAY ★</div>
            <div className="msp-bdPills" data-field="birthdayNames">
              {birthdayList.map((name, i) => (
                <div key={i} className="msp-bdPill" style={{ background: ['#dc2626','#fbbf24','#3b82f6','#f97316','#10b981'][i % 5], color: i % 5 === 1 ? '#0f172a' : '#fff' }}>{name}</div>
              ))}
            </div>
            <div className="msp-countdown">
              <div className="msp-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Game Day in'}</div>
              <div className="msp-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
              <div className="msp-cdUnit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{unit}</div>
            </div>
          </div>
        </div>

        {/* Nutrition / allergen icon strip */}
        <div className="msp-iconStrip">
          <div className="msp-iconCard"><div className="msp-iconE">🌾</div><div className="msp-iconL">GLUTEN</div></div>
          <div className="msp-iconCard"><div className="msp-iconE">🥜</div><div className="msp-iconL">NUTS</div></div>
          <div className="msp-iconCard"><div className="msp-iconE">🧀</div><div className="msp-iconL">DAIRY</div></div>
          <div className="msp-iconCard"><div className="msp-iconE">🥚</div><div className="msp-iconL">EGG</div></div>
          <div className="msp-iconCard"><div className="msp-iconE">🌱</div><div className="msp-iconL">VEG</div></div>
          <div className="msp-iconCard"><div className="msp-iconE">✨</div><div className="msp-iconL">GF</div></div>
        </div>

        {/* PA-System scrolling allergen ticker */}
        <div className="msp-ticker">
          <div className="msp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>📢 {(c.tickerStamp || 'PA SYSTEM').toUpperCase()}</div>
          <div className="msp-tickerScroll">
            <span
              className="msp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Edit hotspots — builder-only */}
        {!isLive && (
          <>
            <Hotspot section="header"     x={60}   y={140}  w={2040} h={680} />
            <Hotspot section="header"     x={60}   y={840}  w={2040} h={620} />
            <Hotspot section="menu"       x={60}   y={1480} w={2040} h={1120} />
            <Hotspot section="chef"       x={60}   y={2620} w={1000} h={680} />
            <Hotspot section="birthdays"  x={1100} y={2620} w={1000} h={680} />
            <Hotspot section="header"     x={60}   y={3320} w={2040} h={300} />
            <Hotspot section="ticker"     x={0}    y={3640} w={2160} h={200} />
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

const CSS_MSP = `
@import url('https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Bungee&family=Oswald:wght@500;700&family=Bebas+Neue&family=Permanent+Marker&display=swap');

.msp-stage {
  position: relative;
  font-family: 'Oswald', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 12%, rgba(59,130,246,.32), transparent 55%),
    radial-gradient(ellipse at 15% 92%, rgba(251,191,36,.20), transparent 45%),
    radial-gradient(ellipse at 85% 92%, rgba(220,38,38,.20), transparent 45%),
    linear-gradient(180deg, #0f172a 0%, #1e3a8a 45%, #0f172a 100%);
  overflow: hidden;
}
.msp-stage::before {
  content: ''; position: absolute; inset: -10%;
  background: repeating-linear-gradient(135deg,
    transparent 0 100px, rgba(251,191,36,.04) 100px 110px,
    transparent 110px 240px, rgba(220,38,38,.04) 240px 250px);
  animation: msp-stripe 60s linear infinite;
  pointer-events: none;
}
@keyframes msp-stripe { from { transform: translateX(0); } to { transform: translateX(100px); } }

/* Stadium spotlights */
.msp-spot { position: absolute; pointer-events: none; width: 800px; height: 3800px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.07) 50%, transparent 100%);
  transform-origin: 50% 100%; animation: msp-sweep 14s ease-in-out infinite; z-index: 1; }
.msp-spot.msp-l { left: 5%;  bottom: 0; transform: rotate(-12deg); }
.msp-spot.msp-r { right: 5%; bottom: 0; transform: rotate(12deg); animation-delay: -3.5s; }
@keyframes msp-sweep { 0%, 100% { opacity: .25; } 50% { opacity: .6; } }

/* Pennant bunting */
.msp-bunting { position: absolute; top: 0; left: 0; right: 0; height: 130px; z-index: 3; }
.msp-bunting svg { width: 100%; height: 100%; display: block; }
.msp-pennant { animation: msp-pennant 5.4s ease-in-out infinite; transform-origin: 50% 12px; }
@keyframes msp-pennant { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }

/* Hero ~700px */
.msp-hero {
  position: absolute; top: 150px; left: 60px; right: 60px; height: 700px;
  z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 24px;
}

.msp-shield {
  position: relative; width: 240px; height: 260px;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 60%, #d97706);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 16px 36px rgba(0,0,0,.5);
  animation: msp-shieldPulse 4.3s ease-in-out infinite;
}
@keyframes msp-shieldPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.msp-shield::before {
  content: ''; position: absolute; inset: 18px;
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  box-shadow: inset 0 0 0 6px #92400e;
}
.msp-shieldInner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; }
.msp-shieldEmoji { font-size: 130px; line-height: 1; transform: translateY(-10px); filter: drop-shadow(0 6px 10px rgba(0,0,0,.5)); }

/* Varsity letter row */
.msp-varsity {
  display: flex; gap: 18px; justify-content: center; align-items: center;
  margin-top: 6px;
}
.msp-letter {
  width: 160px; height: 200px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Black Ops One', cursive; font-size: 150px; line-height: 1;
  color: #fff; border: 8px solid #fff; border-radius: 22px;
  box-shadow: 8px 8px 0 #000, 0 18px 32px rgba(0,0,0,.4);
  text-shadow: 4px 4px 0 #000;
  letter-spacing: .02em;
  animation: msp-letterBob 3.6s ease-in-out infinite;
}
.msp-letter:nth-child(1) { animation-delay: 0s; }
.msp-letter:nth-child(2) { animation-delay: .2s; }
.msp-letter:nth-child(3) { animation-delay: .4s; }
.msp-letter:nth-child(4) { animation-delay: .6s; }
@keyframes msp-letterBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(2deg); } }

.msp-ribbon {
  background: #dc2626; padding: 28px 60px 70px; position: relative;
  width: 100%; max-width: 1700px;
  box-shadow: 0 22px 44px rgba(0,0,0,.45);
  clip-path: polygon(0 0, 100% 0, 100% 70%, 92% 100%, 84% 70%, 76% 100%, 68% 70%, 60% 100%, 52% 70%, 50% 100%, 48% 70%, 40% 100%, 32% 70%, 24% 100%, 16% 70%, 8% 100%, 0 70%);
  animation: msp-banner 6.3s ease-in-out infinite;
  transform-origin: 50% 0%;
  border: 6px solid #fff; border-bottom: none;
  text-align: center;
}
@keyframes msp-banner { 0%, 100% { transform: rotate(-1deg); } 50% { transform: rotate(1deg); } }
.msp-ribbon h1 {
  margin: 0; line-height: .92;
  font-family: 'Black Ops One', cursive; font-size: 132px; color: #fff;
  text-shadow: 6px 6px 0 #000, 12px 12px 0 #fbbf24;
  letter-spacing: .03em;
}
.msp-sub {
  font-family: 'Permanent Marker', cursive; font-size: 50px;
  color: #fbbf24; margin-top: 14px;
  transform: rotate(-2deg);
  text-shadow: 3px 3px 0 rgba(0,0,0,.5);
}

/* Scoreboard hero — bulb perimeter */
.msp-scoreboard {
  position: absolute; top: 870px; left: 60px; right: 60px; height: 600px;
  background-color: #000;
  border: 12px solid #fbbf24; border-radius: 24px;
  box-shadow: 0 0 80px rgba(251,191,36,.6), inset 0 0 80px rgba(251,191,36,.18);
  z-index: 4;
  overflow: hidden;
}
.msp-scoreboard::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    repeating-linear-gradient(0deg, rgba(251,191,36,.04) 0 4px, transparent 4px 8px),
    radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0,0,0,.6));
}
.msp-sbBulbs { position: absolute; inset: 0; pointer-events: none; }
.msp-sbBulb {
  position: absolute; width: 22px; height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #92400e);
  box-shadow: 0 0 16px #fbbf24, 0 0 30px rgba(251,191,36,.6);
  animation: msp-bulb 1.4s ease-in-out infinite;
  transform: translate(-50%, -50%);
}
@keyframes msp-bulb { 0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 50% { opacity: .35; transform: translate(-50%, -50%) scale(.85); } }

.msp-sbInner {
  position: relative; z-index: 2;
  height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 100px;
  text-align: center;
}
.msp-sbHeader {
  font-family: 'Bungee', cursive; font-size: 70px;
  color: #fbbf24; letter-spacing: .12em; line-height: 1;
  text-shadow: 4px 4px 0 #000;
}
.msp-sbClockRow {
  display: flex; align-items: center; justify-content: center; gap: 60px;
  margin-top: 36px;
}
.msp-sbClock { display: flex; align-items: baseline; gap: 18px; }
.msp-sbHH {
  font-family: 'Bebas Neue', sans-serif; font-size: 240px; line-height: .9;
  color: #fbbf24; text-shadow: 0 0 30px rgba(251,191,36,.8);
  letter-spacing: .02em;
}
.msp-sbAP {
  font-family: 'Bebas Neue', sans-serif; font-size: 80px;
  color: #f59e0b; letter-spacing: .25em;
}
.msp-sbDivider { width: 6px; height: 200px; background: #fbbf24; box-shadow: 0 0 14px rgba(251,191,36,.6); }
.msp-sbDate {
  font-family: 'Permanent Marker', cursive; font-size: 56px;
  color: #fde68a; max-width: 600px; line-height: 1.05;
  text-shadow: 2px 2px 0 #000;
}

/* Day tabs + menu block ~700px */
.msp-menuBlock {
  position: absolute; top: 1530px; left: 60px; right: 60px; height: 1100px;
  z-index: 4;
  display: flex; flex-direction: column; gap: 26px;
}

.msp-dayTabs { display: flex; justify-content: center; gap: 16px; }
.msp-day {
  font-family: 'Bebas Neue', sans-serif; font-size: 70px; padding: 18px 50px;
  border: 6px solid #fbbf24; border-radius: 16px;
  background: rgba(0,0,0,.55); color: #fbbf24;
  letter-spacing: .12em;
  box-shadow: 6px 6px 0 #000;
  line-height: 1;
}
.msp-dayToday {
  background: #dc2626; color: #fff; border-color: #fff;
  transform: translateY(-6px) rotate(-2deg);
  box-shadow: 6px 6px 0 #fbbf24, 0 0 40px rgba(220,38,38,.6);
  text-shadow: 3px 3px 0 rgba(0,0,0,.4);
}

.msp-menu {
  position: relative; flex: 1;
  background: #0a1428;
  border: 10px solid #fbbf24;
  border-radius: 24px;
  box-shadow: 0 22px 44px rgba(0,0,0,.45), inset 0 0 60px rgba(251,191,36,.18);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.msp-menuStripe {
  flex: 0 0 auto; height: 50px;
  background: repeating-linear-gradient(90deg, #dc2626 0 38px, #000 38px 44px, #dc2626 44px 82px);
  border-bottom: 5px solid #fff;
}
.msp-menuBody {
  flex: 1; padding: 24px 50px 36px;
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.msp-menu h2 {
  margin: 0 0 18px; line-height: 1; text-align: center;
  font-family: 'Black Ops One', cursive; font-size: 100px; color: #fbbf24;
  text-shadow: 5px 5px 0 #000;
  letter-spacing: .04em;
}
.msp-items {
  display: flex; flex-direction: column; gap: 16px;
  flex: 1 1 0; min-height: 0; overflow: hidden;
}
.msp-item {
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: 28px;
  background: linear-gradient(135deg, #1e3a8a, #1e40af);
  border: 5px solid #fbbf24; border-radius: 16px;
  padding: 18px 36px;
  box-shadow: 6px 6px 0 #000;
  overflow: hidden;
}
.msp-itemEmoji {
  font-size: 120px; line-height: 1; flex: 0 0 auto;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.4));
  display: inline-flex; align-items: center; justify-content: center;
  width: 140px; height: 140px;
}
.msp-itemImg { width: 100%; height: 100%; object-fit: contain; border-radius: 12px; }
.msp-itemInfo { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.msp-itemName {
  font-family: 'Bebas Neue', sans-serif; font-size: 76px;
  color: #fff; line-height: 1.05;
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
  letter-spacing: .02em;
}
.msp-itemMeta {
  font-family: 'Permanent Marker', cursive; font-size: 42px;
  color: #fde68a; margin-top: 8px;
}
.msp-leader {
  flex: 1 1 0; min-width: 24px; height: 0;
  border-bottom: 5px dotted rgba(251,191,36,.55);
  align-self: center; margin: 0 8px;
  transform: translateY(-12px);
}
.msp-itemPrice {
  font-family: 'Bungee', cursive; font-size: 62px;
  color: #fbbf24; flex: 0 0 auto;
  text-shadow: 4px 4px 0 #000;
}

/* Two-up — Chef + Birthdays ~700px */
.msp-twoUp {
  position: absolute; top: 2660px; left: 60px; right: 60px; height: 700px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 36px;
  z-index: 4;
}

.msp-chef {
  position: relative;
  background: linear-gradient(180deg, #1e3a8a, #0f172a);
  border: 8px solid #fbbf24; border-radius: 24px;
  padding: 32px;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  box-shadow: 0 18px 36px rgba(0,0,0,.35);
}
.msp-patch {
  position: relative; width: 360px;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  padding: 32px 28px; text-align: center;
  box-shadow: 0 14px 30px rgba(0,0,0,.4);
  animation: msp-patch 7.2s ease-in-out infinite;
  transform-origin: top center;
}
@keyframes msp-patch { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.msp-patch::before {
  content: ''; position: absolute; inset: 14px;
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  box-shadow: inset 0 0 0 6px #dc2626;
}
.msp-patchRole { font-family: 'Bungee', cursive; font-size: 22px; color: #dc2626; letter-spacing: .15em; position: relative; z-index: 1; line-height: 1; }
.msp-patchFace {
  font-size: 130px; line-height: 1; position: relative; z-index: 1; margin: 16px 0;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.4));
  display: flex; align-items: center; justify-content: center;
  width: 150px; height: 150px; margin-left: auto; margin-right: auto;
}
.msp-patchPhoto { width: 150px; height: 150px; object-fit: cover; border-radius: 18px; }
.msp-jersey {
  position: absolute; top: 20px; right: 28px; z-index: 2;
  font-family: 'Black Ops One', cursive; font-size: 56px; color: #0f172a;
  background: #fff; border: 4px solid #0f172a; border-radius: 12px;
  width: 90px; height: 90px; display: flex; align-items: center; justify-content: center;
  box-shadow: 4px 4px 0 #dc2626;
  line-height: 1;
}
.msp-patchName { font-family: 'Black Ops One', cursive; font-size: 40px; color: #0f172a; letter-spacing: .04em; position: relative; z-index: 1; line-height: 1; }

.msp-special {
  width: 100%; text-align: center;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  border: 5px solid #fff; border-radius: 16px;
  padding: 16px 24px;
  box-shadow: 6px 6px 0 #fbbf24;
  margin-top: 16px;
}
.msp-specialEmoji { font-size: 80px; line-height: 1; }
.msp-specialLbl { font-family: 'Bungee', cursive; font-size: 22px; color: #fbbf24; letter-spacing: .12em; margin-top: 4px; }
.msp-specialName { font-family: 'Bebas Neue', sans-serif; font-size: 52px; color: #fff; line-height: 1; margin-top: 4px; text-shadow: 3px 3px 0 #000; }

.msp-birthdays {
  position: relative;
  background: linear-gradient(180deg, #1e3a8a, #0f172a);
  border: 8px solid #fbbf24; border-radius: 24px;
  padding: 24px 28px;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  text-align: center;
  box-shadow: 0 18px 36px rgba(0,0,0,.35);
  overflow: hidden;
}
.msp-cakeWrap { position: relative; width: 240px; height: 200px; animation: msp-cake 3.2s ease-in-out infinite; }
@keyframes msp-cake { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
.msp-tier1 { position: absolute; bottom: 0; left: 32px; right: 32px; height: 88px;
  background: linear-gradient(180deg, #dc2626, #991b1b);
  border-radius: 8px 8px 0 0; border: 5px solid #fff;
  box-shadow: 0 8px 18px rgba(0,0,0,.4); }
.msp-tier1::before {
  content: ''; position: absolute; top: -12px; left: -5px; right: -5px; height: 22px;
  background: #fff;
  clip-path: polygon(0 100%, 100% 100%, 100% 30%, 95% 50%, 90% 30%, 85% 50%, 80% 30%, 75% 50%, 70% 30%, 65% 50%, 60% 30%, 55% 50%, 50% 30%, 45% 50%, 40% 30%, 35% 50%, 30% 30%, 25% 50%, 20% 30%, 15% 50%, 10% 30%, 5% 50%, 0 30%);
}
.msp-tier2 { position: absolute; bottom: 0; left: 0; right: 0; height: 56px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-radius: 0 0 8px 8px; border: 5px solid #fff; border-top: none; }
.msp-candle { position: absolute; bottom: 88px; width: 8px; height: 36px;
  background: repeating-linear-gradient(180deg, #fff 0 6px, #dc2626 6px 12px);
  border-radius: 2px; }
.msp-c1 { left: 60px; }
.msp-c2 { left: 50%; transform: translateX(-50%); }
.msp-c3 { right: 60px; }
.msp-flame { position: absolute; bottom: 124px; width: 12px; height: 20px;
  background: radial-gradient(circle at 50% 80%, #fbbf24, #dc2626 70%, transparent 85%);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  animation: msp-flame .7s ease-in-out infinite alternate; }
.msp-f1 { left: 58px; }
.msp-f2 { left: 50%; transform: translateX(-50%); animation-delay: .12s; }
.msp-f3 { right: 58px; animation-delay: .24s; }
@keyframes msp-flame { from { transform: scaleY(1); } to { transform: scaleY(1.25); } }

.msp-bdLbl {
  font-family: 'Bungee', cursive; font-size: 38px; color: #fbbf24;
  letter-spacing: .12em; margin-top: 14px; text-shadow: 3px 3px 0 #000;
  line-height: 1;
}
.msp-bdPills {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;
  margin-top: 14px; max-width: 100%;
}
.msp-bdPill {
  font-family: 'Black Ops One', cursive; font-size: 36px;
  padding: 12px 26px; border-radius: 999px;
  border: 4px solid #fff; box-shadow: 4px 4px 0 #000;
  letter-spacing: .04em; line-height: 1;
}

.msp-countdown {
  margin-top: 16px;
  display: flex; flex-direction: column; align-items: center;
  background: rgba(0,0,0,.45);
  border: 5px solid #fbbf24;
  border-radius: 16px;
  padding: 14px 26px;
  width: 100%;
}
.msp-cdLbl { font-family: 'Bungee', cursive; font-size: 22px; color: #fbbf24; letter-spacing: .12em; line-height: 1; }
.msp-cdNum { font-family: 'Bebas Neue', sans-serif; font-size: 110px; line-height: .9; color: #dc2626; text-shadow: 4px 4px 0 #000; }
.msp-cdUnit { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #fff; letter-spacing: .15em; }

/* Nutrition / allergen icon strip ~300px */
.msp-iconStrip {
  position: absolute; top: 3400px; left: 60px; right: 60px; height: 220px;
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px;
  z-index: 4;
}
.msp-iconCard {
  background: linear-gradient(180deg, #1e3a8a, #0f172a);
  border: 5px solid #fbbf24; border-radius: 18px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 4px 4px 0 #000;
  padding: 12px 8px;
}
.msp-iconE { font-size: 80px; line-height: 1; filter: drop-shadow(0 3px 6px rgba(0,0,0,.4)); }
.msp-iconL { font-family: 'Black Ops One', cursive; font-size: 36px; color: #fbbf24; letter-spacing: .08em; margin-top: 8px; line-height: 1; text-shadow: 2px 2px 0 #000; }

/* PA-system allergen ticker ~200px */
.msp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 200px;
  background: #000; display: flex; align-items: center; overflow: hidden;
  z-index: 6;
  border-top: 8px solid #fbbf24;
  box-shadow: inset 0 0 60px rgba(251,191,36,.18);
}
.msp-tickerStamp {
  flex: 0 0 auto; padding: 0 50px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: #fff; display: flex; align-items: center;
  font-family: 'Black Ops One', cursive; letter-spacing: .12em; font-size: 64px;
  border-right: 6px solid #fbbf24;
  text-shadow: 3px 3px 0 #000;
  line-height: 1;
}
.msp-tickerScroll { flex: 1; overflow: hidden; height: 100%; display: flex; align-items: center; }
.msp-tickerText {
  font-family: 'Bebas Neue', sans-serif; font-size: 92px; color: #fbbf24;
  white-space: nowrap; padding-left: 100%; display: inline-block;
  text-shadow: 0 0 24px rgba(251,191,36,.6);
  letter-spacing: .04em;
  animation: msp-tickerScroll 60s linear infinite;
  will-change: transform;
}
@keyframes msp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(251, 191, 36, .12); box-shadow: inset 0 0 0 4px rgba(251, 191, 36, .65); }
.aw-hotspot:focus-visible { background-color: rgba(251, 191, 36, .18); box-shadow: inset 0 0 0 4px rgba(251, 191, 36, .9); }
`;
