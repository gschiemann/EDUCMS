"use client";

// PORTED 2026-04-20 from scratch/design/animated-cafeteria-middle.html — transform:scale pattern, isLive-gated hotspots.

import { useEffect, useRef, useState, useMemo } from 'react';

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
  logoEmoji?: string;           // crossed utensils / shield glyph (default 🍴)
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

const CANVAS_W = 1920;
const CANVAS_H = 1080;

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

export function AnimatedCafeteriaMiddleWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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
  const bdInline = birthdayList.join(' · ');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ★  ');
    return 'VARSITY FOOTBALL PEP RALLY 2:30 FRIDAY · TACO TUESDAY $3.50 · PIZZA FRIDAY RETURNS · YEARBOOK ORDERS DUE · GO EAGLES! 🦅';
  }, [c.tickerMessages]);

  // Pennants for bunting (24 pennants, alternating colors)
  const pennants = useMemo(() => {
    const cols = ['#dc2626', '#fbbf24', '#3b82f6'];
    return Array.from({ length: 24 }, (_, i) => ({
      x: i * 80,
      color: cols[i % 3],
    }));
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0e27',
      }}
    >
      <style>{CSS_MS}</style>

      <div
        className="ms-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="ms-spot ms-l" />
        <div className="ms-spot ms-r" />

        <div className="ms-bunting">
          <svg viewBox="0 0 1920 100" preserveAspectRatio="none">
            <path d="M0 0 L1920 0 L1920 8 L0 8 Z" fill="#fbbf24"/>
            <g>
              {pennants.map((p, i) => (
                <polygon
                  key={i}
                  className="ms-pennant"
                  points={`${p.x},8 ${p.x + 70},8 ${p.x + 35},75`}
                  fill={p.color}
                  stroke="#fff"
                  strokeWidth={3}
                />
              ))}
            </g>
          </svg>
        </div>

        <div className="ms-header">
          <div className="ms-shield">
            <div className="ms-utensils">{c.logoEmoji || '🍴'}</div>
          </div>
          <div className="ms-title">
            <div className="ms-ribbon">
              <h1>{(c.title || 'EAGLE EATS').toUpperCase()}</h1>
              <div className="ms-sub">{c.subtitle || '~ fuel up, Eagles ~'}</div>
            </div>
          </div>
          <div className="ms-scoreboard">
            <div className="ms-chains"><div className="ms-chain" /><div className="ms-chain" /></div>
            <div className="ms-board">
              <div className="ms-t">{hh}:{mm}</div>
              <div className="ms-ap">{ampm}</div>
            </div>
          </div>
        </div>

        <div className="ms-grid">
          <div className="ms-special">
            <div className="ms-pole" />
            <div className="ms-flag">
              <div className="ms-flagEmoji">{c.specialEmoji || '🍕'}</div>
              <div className="ms-flagLbl">{(c.specialLabel || 'PICKUP SPECIAL').toUpperCase()}</div>
              <div className="ms-flagName">{c.specialName || 'Stuffed Crust'}</div>
            </div>
          </div>

          <div className="ms-menu">
            <div className="ms-menuBody">
              <h2>Today's Menu</h2>
              <div className="ms-date">{dateLine}</div>
              <div className="ms-dayTabs">
                {(['MON','TUE','WED','THU','FRI'] as const).map((d, i) => {
                  const isToday = today === i + 1;
                  return <span key={d} className={`ms-day${isToday ? ' ms-dayToday' : ''}`}>{d}</span>;
                })}
              </div>
              <div className="ms-items">
                {menuItems.slice(0, 12).map((it, i) => {
                  const src = it.emoji || '';
                  const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                  return (
                    <div key={i} className="ms-item">
                      <span className="ms-itemEmoji">
                        {isUrl ? <img src={src} alt="" className="ms-itemImg" /> : (src || '🍽️')}
                      </span>
                      <div className="ms-itemInfo">
                        <div className="ms-itemName">{it.name || ''}</div>
                        {it.meta && <div className="ms-itemMeta">{it.meta}</div>}
                      </div>
                      <div className="ms-leader" />
                      {it.price && <span className="ms-itemPrice">{it.price}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="ms-countdown">
            <div className="ms-stopwatch">
              <div className="ms-crown" />
              <div className="ms-ring">
                <div className="ms-cdIcon">{c.countdownEmoji || '🏈'}</div>
                <div className="ms-cdLbl">{c.countdownLabel || 'Game Day in'}</div>
                <div className="ms-cdNum">{days}</div>
                <div className="ms-cdUnit">{unit}</div>
              </div>
            </div>
          </div>

          <div className="ms-chef">
            <div className="ms-patch">
              <div className="ms-patchRole">★ {(c.chefRole || 'LUNCH CHEF').toUpperCase()} ★</div>
              <div className="ms-patchFace">
                {c.chefPhotoUrl
                  ? <img src={c.chefPhotoUrl} alt="" className="ms-patchPhoto" />
                  : <span>{c.chefEmoji || '👨‍🍳'}</span>}
              </div>
              <div className="ms-patchName">{(c.chefName || 'CHEF RIVERA').toUpperCase()}</div>
            </div>
          </div>

          <div className="ms-birthdays">
            <div className="ms-cakeWrap">
              <div className="ms-candle ms-c1" /><div className="ms-candle ms-c2" /><div className="ms-candle ms-c3" />
              <div className="ms-flame ms-f1" /><div className="ms-flame ms-f2" /><div className="ms-flame ms-f3" />
              <div className="ms-tier1" />
              <div className="ms-tier2" />
            </div>
            <div className="ms-bdLbl">★ BIRTHDAYS TODAY ★</div>
            <div className="ms-bdNames">{bdInline}</div>
          </div>
        </div>

        <div className="ms-ticker">
          <div className="ms-tickerStamp">{(c.tickerStamp || 'Eagle Eats').toUpperCase()}</div>
          <div className="ms-tickerScroll">
            <span
              className="ms-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 50)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={36}   y={110} w={220}  h={220} />
            <Hotspot section="header"    x={280}  y={110} w={1360} h={220} />
            <Hotspot section="header"    x={1660} y={110} w={220}  h={220} />
            <Hotspot section="special"   x={36}   y={350} w={300}  h={340} />
            <Hotspot section="menu"      x={360}  y={350} w={1200} h={570} />
            <Hotspot section="countdown" x={1584} y={350} w={300}  h={340} />
            <Hotspot section="chef"      x={36}   y={690} w={300}  h={230} />
            <Hotspot section="birthdays" x={1584} y={690} w={300}  h={230} />
            <Hotspot section="ticker"    x={0}    y={970} w={1920} h={110} />
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

const CSS_MS = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Bebas+Neue&family=Oswald:wght@500;700&family=Permanent+Marker&display=swap');

.ms-stage {
  position: relative;
  font-family: 'Oswald', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 20%, rgba(59,130,246,.25), transparent 60%),
    radial-gradient(ellipse at 20% 110%, rgba(251,191,36,.18), transparent 40%),
    radial-gradient(ellipse at 80% 110%, rgba(220,38,38,.18), transparent 40%),
    linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f172a 100%);
  overflow: hidden;
}
.ms-stage::before {
  content: ''; position: absolute; inset: -10%;
  background: repeating-linear-gradient(135deg,
    transparent 0 80px, rgba(251,191,36,.04) 80px 90px,
    transparent 90px 200px, rgba(220,38,38,.04) 200px 210px);
  animation: ms-stripe 54s linear infinite;
}
@keyframes ms-stripe { from { transform: translateX(0); } to { transform: translateX(80px); } }

.ms-spot { position: absolute; pointer-events: none; width: 600px; height: 1100px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.08) 50%, transparent 100%);
  transform-origin: 50% 100%; animation: ms-sweep 12.6s ease-in-out infinite; }
.ms-spot.ms-l { left: 8%;  bottom: 0; transform: rotate(-15deg); }
.ms-spot.ms-r { right: 8%; bottom: 0; transform: rotate(15deg); animation-delay: -3.5s; }
@keyframes ms-sweep { 0%, 100% { opacity: .25; } 50% { opacity: .55; } }

.ms-bunting { position: absolute; top: 0; left: 0; right: 0; height: 90px; z-index: 2; }
.ms-bunting svg { width: 100%; height: 100%; display: block; }
.ms-pennant { animation: ms-pennant 5.4s ease-in-out infinite; transform-origin: 50% 8px; }
@keyframes ms-pennant { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }

.ms-header {
  position: absolute; top: 110px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 220px 1fr 220px;
  gap: 36px; z-index: 5; align-items: start;
}

.ms-shield {
  position: relative; width: 200px; height: 220px;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 60%, #d97706);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 32px rgba(0,0,0,.5);
  animation: ms-shieldPulse 4.3s ease-in-out infinite;
}
@keyframes ms-shieldPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.ms-shield::before {
  content: ''; position: absolute; inset: 14px;
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  box-shadow: inset 0 0 0 4px #92400e;
}
.ms-utensils {
  position: relative; z-index: 1; font-size: 90px; line-height: 1;
  transform: translateY(-8px);
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.5));
}

.ms-title { position: relative; padding-top: 10px; }
.ms-ribbon {
  background: #dc2626; padding: 24px 38px 48px; position: relative;
  box-shadow: 0 16px 32px rgba(0,0,0,.4);
  clip-path: polygon(0 0, 100% 0, 100% 70%, 90% 100%, 80% 70%, 70% 100%, 60% 70%, 50% 100%, 40% 70%, 30% 100%, 20% 70%, 10% 100%, 0 70%);
  animation: ms-banner 6.3s ease-in-out infinite;
  transform-origin: 50% 0%;
  border: 4px solid #fff; border-bottom: none;
}
@keyframes ms-banner { 0%, 100% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } }
.ms-ribbon h1 {
  margin: 0; line-height: .92;
  font-family: 'Bungee', cursive; font-size: 80px; color: #fff;
  text-shadow: 4px 4px 0 #000, 8px 8px 0 #fbbf24;
  letter-spacing: .04em; text-align: center;
}
.ms-sub {
  font-family: 'Permanent Marker', cursive; font-size: 28px;
  color: #fbbf24; margin-top: 6px; text-align: center;
  transform: rotate(-2deg);
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}

.ms-scoreboard {
  position: relative; padding-top: 28px;
  display: flex; flex-direction: column; align-items: center;
}
.ms-chains {
  position: absolute; top: 0; left: 30%; right: 30%; height: 32px;
  display: flex; justify-content: space-between;
}
.ms-chain { width: 4px; height: 100%;
  background: linear-gradient(180deg, transparent, #94a3b8 20%, #64748b 80%, transparent);
  border-radius: 2px; }
.ms-board {
  position: relative;
  width: 200px; height: 140px;
  background-color: #000;
  border: 6px solid #fbbf24; border-radius: 8px;
  box-shadow: 0 0 40px rgba(251,191,36,.5);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: ms-sway 7.2s ease-in-out infinite;
  transform-origin: 50% -28px;
  overflow: hidden;
}
.ms-board::before {
  content: ''; position: absolute; inset: 0;
  background: #000;
  box-shadow: inset 0 0 30px rgba(251,191,36,.12);
  z-index: 0;
}
@keyframes ms-sway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
.ms-t, .ms-ap { position: relative; z-index: 1; background: transparent; }
.ms-t {
  font-family: 'Bebas Neue', sans-serif; font-size: 76px; color: #fbbf24; line-height: 1;
  text-shadow: 0 0 20px rgba(251,191,36,.8);
}
.ms-ap { font-family: 'Bebas Neue', sans-serif; font-size: 26px; color: #f59e0b; letter-spacing: .25em; }

.ms-grid {
  position: absolute; top: 350px; left: 36px; right: 36px; bottom: 160px;
  display: grid; grid-template-columns: 300px 1fr 300px; grid-template-rows: 1fr 1fr;
  gap: 24px; z-index: 3;
}

.ms-special {
  grid-column: 1; grid-row: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative;
}
.ms-pole { position: absolute; left: 50%; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #94a3b8, #475569);
  transform: translateX(-50%); border-radius: 2px; }
.ms-pole::before {
  content: ''; position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
  width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #b45309);
}
.ms-flag {
  background: linear-gradient(135deg, #dc2626, #991b1b);
  border: 4px solid #fff; border-right: none;
  padding: 16px 32px 16px 16px;
  clip-path: polygon(0 0, 100% 0, 80% 50%, 100% 100%, 0 100%);
  width: 230px; text-align: center;
  box-shadow: 0 8px 20px rgba(0,0,0,.5);
  transform-origin: left center;
  animation: ms-flag 4.5s ease-in-out infinite;
  position: relative; z-index: 1;
}
@keyframes ms-flag { 0%, 100% { transform: rotate(-2deg) skewY(-1deg); } 50% { transform: rotate(2deg) skewY(1deg); } }
.ms-flagEmoji { font-size: 70px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
.ms-flagLbl { font-family: 'Bungee', cursive; font-size: 14px; color: #fbbf24; letter-spacing: .1em; margin-top: 4px; }
.ms-flagName { font-family: 'Bebas Neue', sans-serif; font-size: 30px; color: #fff; line-height: 1; margin-top: 2px; text-shadow: 2px 2px 0 #000; }

.ms-menu {
  grid-column: 2; grid-row: 1 / span 2;
  position: relative;
  background: #0a1428;
  border: 6px solid #fbbf24;
  border-radius: 12px;
  box-shadow: 0 16px 32px rgba(0,0,0,.4), inset 0 0 40px rgba(251,191,36,.15);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.ms-menu::before {
  content: ''; display: block; height: 36px; flex: 0 0 auto;
  background: repeating-linear-gradient(90deg, #dc2626 0 24px, #000 24px 28px, #dc2626 28px 52px);
  border-bottom: 3px solid #fff;
}
.ms-menuBody {
  flex: 1; padding: 20px 40px 24px;
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.ms-menu h2 {
  margin: 0; line-height: 1; text-align: center;
  font-family: 'Bungee', cursive; font-size: 48px; color: #fbbf24;
  text-shadow: 3px 3px 0 #000;
  letter-spacing: .04em;
}
.ms-date { text-align: center; font-family: 'Permanent Marker', cursive; font-size: 22px; color: #fde68a; margin-top: 2px; margin-bottom: 10px; }

.ms-dayTabs { display: flex; justify-content: center; gap: 6px; margin-bottom: 12px; }
.ms-day { font-family: 'Bebas Neue', sans-serif; font-size: 20px; padding: 6px 14px;
  border: 3px solid #fbbf24; border-radius: 8px;
  background: rgba(0,0,0,.4); color: #fbbf24;
  letter-spacing: .1em; }
.ms-dayToday {
  background: #dc2626; color: #fff; border-color: #fff;
  transform: translateY(-2px);
  box-shadow: 0 0 0 3px #fbbf24, 0 0 20px rgba(220,38,38,.6);
}

.ms-items {
  display: flex; flex-direction: column; gap: clamp(4px, 1.5%, 10px);
  flex: 1 1 0; min-height: 0; overflow: hidden;
}
.ms-item {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: clamp(12px, 3cqh + 10px, 22px);
  background: linear-gradient(135deg, #1e3a8a, #1e40af);
  border: 3px solid #fbbf24; border-radius: 10px;
  padding: clamp(6px, 10cqh, 16px) clamp(16px, 4cqh + 14px, 26px);
  box-shadow: 3px 3px 0 #000;
  overflow: hidden;
}
.ms-itemEmoji {
  font-size: clamp(36px, 70cqh, 80px); line-height: 1; flex: 0 0 auto;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.3));
  display: inline-flex; align-items: center; justify-content: center;
  width: clamp(40px, 80cqh, 90px); height: clamp(40px, 80cqh, 90px);
}
.ms-itemImg { width: 100%; height: 100%; object-fit: contain; border-radius: 8px; }
.ms-itemInfo { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.ms-itemName {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(20px, 38cqh, 42px);
  color: #fff; line-height: 1.05;
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
  letter-spacing: .02em;
}
.ms-itemMeta {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(16px, 26cqh, 28px);
  color: #fde68a; margin-top: clamp(2px, 2.5cqh, 6px);
}
.ms-leader {
  flex: 1 1 0; min-width: 12px; height: 0;
  border-bottom: 3px dotted rgba(251,191,36,.5);
  align-self: center; margin: 0 4px;
  transform: translateY(calc(-1 * clamp(5px, 10cqh, 12px)));
}
.ms-itemPrice {
  font-family: 'Bungee', cursive;
  font-size: clamp(20px, 34cqh, 38px);
  color: #fbbf24; flex: 0 0 auto;
  text-shadow: 2px 2px 0 #000;
}

.ms-countdown {
  grid-column: 3; grid-row: 1;
  display: flex; align-items: center; justify-content: center; position: relative;
}
.ms-stopwatch { width: 240px; height: 280px; position: relative; }
.ms-crown { position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 32px; height: 28px;
  background: linear-gradient(135deg, #94a3b8, #475569);
  border-radius: 4px 4px 2px 2px;
  border: 3px solid #1e293b; z-index: 2; }
.ms-ring {
  position: absolute; top: 24px; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at 30% 30%, #fff, #cbd5e1 60%, #475569);
  border: 8px solid #1e293b; border-radius: 50%;
  box-shadow: 0 12px 24px rgba(0,0,0,.5), inset 0 0 0 4px #cbd5e1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: ms-tick 2.9s ease-in-out infinite;
  text-align: center; padding: 20px;
}
@keyframes ms-tick { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.ms-cdIcon { font-size: 46px; line-height: 1; }
.ms-cdLbl { font-family: 'Bungee', cursive; font-size: 13px; color: #dc2626; letter-spacing: .12em; text-transform: uppercase; margin-top: 4px; line-height: 1.1; max-width: 160px; }
.ms-cdNum { font-family: 'Bebas Neue', sans-serif; font-size: 90px; line-height: .9; color: #dc2626; text-shadow: 2px 2px 0 rgba(0,0,0,.15); }
.ms-cdUnit { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #1e293b; letter-spacing: .15em; }

.ms-chef {
  grid-column: 1; grid-row: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 8px;
}
.ms-patch {
  position: relative; width: 240px;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  padding: 22px 24px; text-align: center;
  box-shadow: 0 10px 24px rgba(0,0,0,.4);
  animation: ms-patch 7.2s ease-in-out infinite;
  transform-origin: top center;
}
@keyframes ms-patch { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.ms-patch::before {
  content: ''; position: absolute; inset: 10px;
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  box-shadow: inset 0 0 0 4px #dc2626;
}
.ms-patchRole { font-family: 'Bungee', cursive; font-size: 13px; color: #dc2626; letter-spacing: .1em; position: relative; z-index: 1; }
.ms-patchFace {
  font-size: 80px; line-height: 1; position: relative; z-index: 1; margin: 4px 0;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,.3));
  display: flex; align-items: center; justify-content: center;
  height: 88px;
}
.ms-patchPhoto { width: 88px; height: 88px; object-fit: cover; border-radius: 12px; }
.ms-patchName { font-family: 'Bungee', cursive; font-size: 22px; color: #000; letter-spacing: .04em; position: relative; z-index: 1; }

.ms-birthdays {
  grid-column: 3; grid-row: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 8px; text-align: center;
}
.ms-cakeWrap { position: relative; width: 200px; height: 170px; animation: ms-cake 3.2s ease-in-out infinite; }
@keyframes ms-cake { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-6px) rotate(2deg); } }
.ms-tier1 { position: absolute; bottom: 0; left: 26px; right: 26px; height: 68px;
  background: linear-gradient(180deg, #dc2626, #991b1b);
  border-radius: 8px 8px 0 0; border: 4px solid #fff;
  box-shadow: 0 6px 14px rgba(0,0,0,.4); }
.ms-tier1::before {
  content: ''; position: absolute; top: -10px; left: -4px; right: -4px; height: 18px;
  background: #fff;
  clip-path: polygon(0 100%, 100% 100%, 100% 30%, 95% 50%, 90% 30%, 85% 50%, 80% 30%, 75% 50%, 70% 30%, 65% 50%, 60% 30%, 55% 50%, 50% 30%, 45% 50%, 40% 30%, 35% 50%, 30% 30%, 25% 50%, 20% 30%, 15% 50%, 10% 30%, 5% 50%, 0 30%);
}
.ms-tier2 { position: absolute; bottom: 0; left: 0; right: 0; height: 45px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border-radius: 0 0 8px 8px; border: 4px solid #fff; border-top: none; }
.ms-candle { position: absolute; bottom: 68px; width: 6px; height: 28px;
  background: repeating-linear-gradient(180deg, #fff 0 5px, #dc2626 5px 10px);
  border-radius: 2px; }
.ms-c1 { left: 48px; }
.ms-c2 { left: 50%; transform: translateX(-50%); }
.ms-c3 { right: 48px; }
.ms-flame { position: absolute; bottom: 96px; width: 10px; height: 16px;
  background: radial-gradient(circle at 50% 80%, #fbbf24, #dc2626 70%, transparent 85%);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  animation: ms-flame .7s ease-in-out infinite alternate; }
.ms-f1 { left: 46px; }
.ms-f2 { left: 50%; transform: translateX(-50%); animation-delay: .12s; }
.ms-f3 { right: 46px; animation-delay: .24s; }
@keyframes ms-flame { from { transform: scaleY(1); } to { transform: scaleY(1.2); } }
.ms-bdLbl { font-family: 'Bungee', cursive; font-size: 18px; color: #fbbf24; letter-spacing: .1em; margin-top: 10px; text-shadow: 2px 2px 0 #000; }
.ms-bdNames { font-family: 'Bebas Neue', sans-serif; font-size: 30px; color: #fff; letter-spacing: .04em; margin-top: 2px; text-shadow: 2px 2px 0 #000, 4px 4px 0 #dc2626; }

.ms-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: #000; display: flex; align-items: center; overflow: hidden;
  z-index: 6;
  border-top: 6px solid #fbbf24;
  box-shadow: inset 0 0 40px rgba(251,191,36,.15);
}
.ms-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: #fff; display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 30px;
  border-right: 4px solid #fbbf24;
  text-shadow: 2px 2px 0 #000;
}
.ms-tickerScroll { flex: 1; overflow: hidden; }
.ms-tickerText {
  font-family: 'Bebas Neue', sans-serif; font-size: 52px; color: #fbbf24;
  white-space: nowrap; padding-left: 100%; display: inline-block;
  text-shadow: 0 0 20px rgba(251,191,36,.6);
  letter-spacing: .04em;
  animation: ms-tickerScroll 50s linear infinite;
}
@keyframes ms-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(251, 191, 36, .1); box-shadow: inset 0 0 0 3px rgba(251, 191, 36, .65); }
.aw-hotspot:focus-visible { background-color: rgba(251, 191, 36, .18); box-shadow: inset 0 0 0 3px rgba(251, 191, 36, .9); }
`;
