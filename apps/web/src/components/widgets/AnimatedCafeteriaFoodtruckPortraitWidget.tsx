"use client";

/**
 * AnimatedCafeteriaFoodtruckPortraitWidget — REAL 4K portrait companion.
 *
 * Vertical re-flow at 2160×3840. NOT letterboxed. Food-truck theme
 * preserved (pink awning, twinkling neon bulbs, drifting food emojis,
 * chalkboard menu, pulsing countdown burst, chef polaroid, birthday
 * ring) but the major regions stack vertically:
 *   • String lights — full-width row across the top (more bulbs)
 *   • Food truck — smaller, centered (badge-sized)
 *   • Title board — full-width hero, 200px BUNGEE headline
 *   • Big neon clock — pinned right of title
 *   • Special tag — full-width row 1
 *   • Menu — full-width, fills middle (tall single-column list)
 *   • Countdown burst — full-width, hero treatment
 *   • Chef + Birthdays — two-up row
 *   • Ticker — pinned bottom-full-width
 *
 * Same data-field keys as landscape so the auto-form editor and
 * canvas click-to-edit work identically. Same data flow (live clock,
 * weekday-aware menu pick, countdown days, birthday list).
 *
 * APPROVED 2026-04-27 — third real portrait conversion.
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
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;
  specialEmoji?: string;
  specialLabel?: string;
  specialName?: string;
  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;
  chefName?: string;
  chefRole?: string;
  chefPhotoUrl?: string;
  chefEmoji?: string;
  birthdayNames?: string | string[];
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

export function AnimatedCafeteriaFoodtruckPortraitWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { emoji: '🌮', name: 'Street Tacos',          meta: '🌾 🧀 — $3.50' },
      { emoji: '🍔', name: 'Classic Burger',        meta: '🌾 🧀 — $3.25' },
      { emoji: '🍟', name: 'Crispy Fries',          meta: 'veg · gf — $1.75' },
      { emoji: '🥗', name: 'Build-a-Salad',         meta: 'veg — $2.95' },
      { emoji: '🍎', name: 'Fruit Cup',             meta: 'gf — $1.50' },
      { emoji: '🥤', name: 'Milk · Juice · Water',  meta: 'varies — $0.75' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 1;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  const birthdayList: string[] = useMemo(() => {
    if (Array.isArray(c.birthdayNames)) return c.birthdayNames.filter(Boolean);
    if (typeof c.birthdayNames === 'string') {
      return c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean);
    }
    return ['Alex', 'Jordan', 'Sam'];
  }, [c.birthdayNames]);
  const bdInline = birthdayList.join(' · ');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'TACO TUESDAY tomorrow — $3.50 tacos all day  ✦  Free water refills at the salad bar  ✦  PIZZA FRIDAY returns — $3.25 slices  ✦  Reload your lunch card in the main office  ✦  Allergen key: 🌾 = gluten · 🥜 = nuts · 🧀 = dairy · 🥚 = egg';
  }, [c.tickerMessages]);

  const chefFace = c.chefEmoji || '👩‍🍳';
  const specialEmoji = c.specialEmoji || '🌮';
  const isSpecialUrl = /^(https?:\/\/|\/|data:image\/)/.test(specialEmoji);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0e27',
      }}
    >
      <style>{CSS_FTP}</style>
      <div
        className="ftp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Drifting food emojis */}
        <div className="ftp-floater a">🌮</div>
        <div className="ftp-floater b">🍔</div>
        <div className="ftp-floater c">🥨</div>
        <div className="ftp-floater d">🍟</div>

        {/* Marquee bulbs across the top */}
        <div className="ftp-lights">
          <div className="ftp-wire" />
          {[5,11,17,23,29,35,41,47,53,59,65,71,77,83,89,95].map((left, i) => (
            <div key={i} className="ftp-bulb" style={{ left: `${left}%` }} />
          ))}
        </div>

        {/* Title row — truck + board + clock laid out as flex */}
        <div className="ftp-header">
          <div className="ftp-truck">
            <div className="ftp-awning" />
            <div className="ftp-cab" />
            <div className="ftp-body" />
            <div className="ftp-wheel l" />
            <div className="ftp-wheel r" />
          </div>
          <div className="ftp-titleWrap">
            <div className="ftp-board">
              <span className="ftp-star s1">✨</span>
              <span className="ftp-star s2">⭐</span>
              <span className="ftp-star s3">🌟</span>
              <span className="ftp-star s4">💫</span>
              <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'LUNCH IS ON').toUpperCase()}</h1>
              <div className="ftp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ freshly rolled every day ~'}</div>
            </div>
          </div>
          <div className="ftp-clock">
            <div className="ftp-clockT">{hh}:{mm}</div>
            <div className="ftp-clockAp">{ampm}</div>
          </div>
        </div>

        {/* Pickup special — full-width banner row */}
        <div className="ftp-special">
          <div className="ftp-tagEmoji" data-field="specialEmoji" style={{ whiteSpace: 'pre-wrap' }}>
            {isSpecialUrl ? <img src={specialEmoji} alt="" className="ftp-tagImg" /> : specialEmoji}
          </div>
          <div className="ftp-tagText">
            <div className="ftp-tagLbl" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.specialLabel || 'Pickup Special').toUpperCase()} ★</div>
            <div className="ftp-tagName" data-field="specialName" style={{ whiteSpace: 'pre-wrap' }}>{c.specialName || 'Street Taco Bowl'}</div>
          </div>
        </div>

        {/* Today's menu — full width, fills the middle */}
        <div className="ftp-menu">
          <h2>{"Today's Menu"}</h2>
          <div className="ftp-date">{dateLine}</div>
          <div className="ftp-items">
            {menuItems.slice(0, 6).map((it, i) => {
              const src = it.emoji || '';
              const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
              return (
                <div key={i} className="ftp-item">
                  <span className="ftp-itemEmoji">
                    {isUrl ? <img src={src} alt="" className="ftp-itemImg" /> : (src || '🍽️')}
                  </span>
                  <div className="ftp-itemBody">
                    <div className="ftp-nm">{it.name || ''}</div>
                    {(it.meta || it.price) && (
                      <div className="ftp-allergen">
                        {it.meta || ''}{it.price ? (it.meta ? ` — ${it.price}` : it.price) : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Countdown burst — full-width hero */}
        <div className="ftp-countdown">
          <div className="ftp-burst">
            <div className="ftp-rays" />
            <div className="ftp-center">
              <div className="ftp-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Taco Tuesday in'}</div>
              <div className="ftp-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
              <div className="ftp-cdUnit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{unit}</div>
            </div>
          </div>
        </div>

        {/* Chef + birthdays two-up */}
        <div className="ftp-bottomRow">
          <div className="ftp-chef">
            <div className="ftp-chefFace">
              {c.chefPhotoUrl
                ? <img src={c.chefPhotoUrl} alt="" className="ftp-chefPhoto" />
                : <span>{chefFace}</span>}
            </div>
            <div className="ftp-chefName" data-field="chefName" style={{ whiteSpace: 'pre-wrap' }}>{(c.chefName || 'Ms. Rodriguez').toUpperCase()}</div>
            <div className="ftp-chefRole" data-field="chefRole" style={{ whiteSpace: 'pre-wrap' }}>~ {c.chefRole || 'lunch hero of the week'} ~</div>
          </div>

          <div className="ftp-birthdays">
            <div className="ftp-ring">
              <div className="ftp-cake">🎂</div>
            </div>
            <div className="ftp-bdLbl">★ Birthdays Today ★</div>
            <div className="ftp-bdNames" data-field="birthdayNames" style={{ whiteSpace: 'pre-wrap' }}>{bdInline}</div>
          </div>
        </div>

        {/* Ticker pinned bottom */}
        <div className="ftp-ticker">
          <div className="ftp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'CAFÉ NEWS').toUpperCase()}</div>
          <div className="ftp-tickerScroll">
            <span
              className="ftp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={60}   y={100}  w={2040} h={550} />
            <Hotspot section="special"    x={60}   y={700}  w={2040} h={400} />
            <Hotspot section="menu"       x={60}   y={1140} w={2040} h={1500} />
            <Hotspot section="countdown"  x={60}   y={2680} w={2040} h={500} />
            <Hotspot section="chef"       x={60}   y={3220} w={1000} h={400} />
            <Hotspot section="birthdays"  x={1100} y={3220} w={1000} h={400} />
            <Hotspot section="ticker"     x={0}    y={3680} w={2160} h={160} />
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

const CSS_FTP = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Fredoka:wght@500;700&family=Permanent+Marker&family=Righteous&display=swap');

.ftp-stage {
  position: relative; overflow: hidden;
  font-family: 'Fredoka', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 95%, #fbbf24 0%, transparent 55%),
    linear-gradient(180deg, #fde68a 0%, #fca5a5 35%, #c084fc 100%);
}

/* Marquee bulbs */
.ftp-lights { position: absolute; top: 60px; left: 0; right: 0; height: 100px; pointer-events: none; z-index: 2; }
.ftp-wire { position: absolute; top: 50%; left: 0; right: 0; height: 5px; background: #1f2937; border-radius: 3px; }
.ftp-bulb {
  position: absolute; top: 38%; width: 36px; height: 52px;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #d97706);
  border-radius: 50% 50% 40% 40%;
  box-shadow: 0 0 32px #fbbf24, 0 0 60px rgba(251, 191, 36, .45);
  animation: ftp-blink 3s ease-in-out infinite;
}
.ftp-bulb:nth-child(even) {
  background: radial-gradient(circle at 30% 30%, #fecaca, #ec4899 70%, #9d174d);
  box-shadow: 0 0 32px #ec4899, 0 0 60px rgba(236, 72, 153, .45);
  animation-delay: .5s;
}
.ftp-bulb:nth-child(3n) {
  background: radial-gradient(circle at 30% 30%, #bfdbfe, #06b6d4 70%, #0e7490);
  box-shadow: 0 0 32px #06b6d4, 0 0 60px rgba(6, 182, 212, .45);
  animation-delay: 1s;
}
@keyframes ftp-blink { 0%, 100% { opacity: 1; } 48%, 52% { opacity: .5; } }
.ftp-bulb::before {
  content: ''; position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
  width: 10px; height: 14px; background: #374151; border-radius: 3px 3px 0 0;
}

/* Drifting food emojis (slower for tall canvas) */
.ftp-floater {
  position: absolute; font-size: 100px; opacity: .55;
  animation: ftp-drift 35s linear infinite;
  z-index: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.2));
}
.ftp-floater.a { top: 10%; left: -10%; animation-delay: 0s; }
.ftp-floater.b { top: 35%; left: -10%; animation-delay: -8s; font-size: 80px; }
.ftp-floater.c { top: 60%; left: -10%; animation-delay: -14s; font-size: 92px; }
.ftp-floater.d { top: 80%; left: -10%; animation-delay: -3s; font-size: 88px; }
@keyframes ftp-drift {
  from { transform: translateX(0) rotate(0deg); }
  to   { transform: translateX(2700px) rotate(360deg); }
}

/* Header — truck/title/clock 3-col laid out across the top */
.ftp-header {
  position: absolute; top: 240px; left: 60px; right: 60px;
  display: grid; grid-template-columns: 380px 1fr 380px;
  gap: 40px; z-index: 5; align-items: start;
}

.ftp-truck { position: relative; width: 380px; height: 340px; animation: ftp-truckBounce 2s ease-in-out infinite; }
@keyframes ftp-truckBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.ftp-cab { position: absolute; top: 70px; left: 18px; width: 120px; height: 140px; background: linear-gradient(180deg, #ec4899, #9d174d); border: 6px solid #1f2937; border-radius: 24px 10px 10px 10px; box-shadow: 0 14px 28px rgba(0,0,0,.3); }
.ftp-cab::before { content: ''; position: absolute; top: 14px; left: 14px; right: 14px; height: 52px; background: linear-gradient(135deg, #dbeafe, #93c5fd); border-radius: 6px; }
.ftp-body { position: absolute; top: 36px; left: 120px; right: 0; height: 174px; background: linear-gradient(180deg, #fbbf24, #d97706); border: 6px solid #1f2937; border-radius: 10px 30px 10px 10px; box-shadow: 0 14px 28px rgba(0,0,0,.3); }
.ftp-body::before { content: ''; position: absolute; top: 24px; left: 30px; right: 30px; height: 96px; background: #1f2937; border-radius: 6px; }
.ftp-body::after { content: 'EAT!'; position: absolute; top: 24px; left: 30px; right: 30px; height: 96px; display: flex; align-items: center; justify-content: center; font-family: 'Bungee', cursive; font-size: 56px; color: #fef3c7; text-shadow: 4px 4px 0 #ec4899; letter-spacing: .08em; }
.ftp-awning { position: absolute; top: 14px; left: 120px; right: 0; height: 32px; background: repeating-linear-gradient(90deg, #ec4899 0 24px, #fef3c7 24px 48px); border: 5px solid #1f2937; border-bottom: none; clip-path: polygon(0 0, 100% 0, 98% 100%, 93% 50%, 88% 100%, 83% 50%, 78% 100%, 73% 50%, 68% 100%, 63% 50%, 58% 100%, 53% 50%, 48% 100%, 43% 50%, 38% 100%, 33% 50%, 28% 100%, 23% 50%, 18% 100%, 13% 50%, 8% 100%, 3% 50%, 0 100%); }
.ftp-wheel { position: absolute; bottom: 0; width: 70px; height: 70px; background: radial-gradient(circle at 40% 40%, #94a3b8, #1f2937 70%); border-radius: 50%; border: 7px solid #111827; }
.ftp-wheel.l { left: 36px; } .ftp-wheel.r { right: 50px; }

.ftp-titleWrap { position: relative; text-align: center; padding-top: 40px; }
.ftp-board {
  background: linear-gradient(180deg, #fef3c7, #fbbf24);
  border: 10px solid #1f2937;
  border-radius: 32px;
  padding: 30px 60px;
  position: relative;
  box-shadow: 0 0 0 6px #fef3c7, 0 0 0 16px #ec4899, 0 28px 56px rgba(0,0,0,.3);
  animation: ftp-bannerBob 4s ease-in-out infinite;
}
@keyframes ftp-bannerBob { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-6px); } }
.ftp-board h1 {
  margin: 0; line-height: .95;
  font-family: 'Bungee', cursive; font-size: 200px; color: #dc2626;
  text-shadow: 8px 8px 0 #1f2937, 14px 14px 0 #fbbf24;
  letter-spacing: .03em;
}
.ftp-sub { font-family: 'Permanent Marker', cursive; font-size: 64px; color: #7c2d12; margin-top: 4px; }
.ftp-star { position: absolute; font-size: 70px; line-height: 1; animation: ftp-twinkle 1.4s ease-in-out infinite; }
.ftp-star.s1 { top: -22px; left: 8%; }
.ftp-star.s2 { top: -22px; right: 8%; animation-delay: .3s; }
.ftp-star.s3 { bottom: -28px; left: 16%; animation-delay: .6s; }
.ftp-star.s4 { bottom: -28px; right: 16%; animation-delay: .9s; }
@keyframes ftp-twinkle { 0%, 100% { opacity: .4; transform: scale(.9) rotate(-10deg); } 50% { opacity: 1; transform: scale(1.2) rotate(15deg); } }

.ftp-clock {
  position: relative; width: 380px; height: 380px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #fafafa 0%, #fef3c7 60%, #fde68a 100%);
  border-radius: 50%;
  border: 14px solid #1f2937;
  box-shadow: 0 22px 44px rgba(0,0,0,.3), inset 0 0 36px rgba(251, 191, 36, .35);
  animation: ftp-clockBob 3.6s ease-in-out infinite;
}
@keyframes ftp-clockBob { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.ftp-clockT { font-family: 'Bungee', cursive; font-size: 110px; line-height: 1; color: #dc2626; text-shadow: 4px 4px 0 rgba(0,0,0,.15); }
.ftp-clockAp { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 44px; color: #7c2d12; letter-spacing: .15em; }

/* Pickup special — full-width banner row */
.ftp-special {
  position: absolute; top: 700px; left: 60px; right: 60px; height: 380px;
  background: linear-gradient(135deg, #fef3c7 0%, #fbbf24 100%);
  border: 8px solid #ec4899;
  border-radius: 32px;
  padding: 30px 50px;
  display: flex; align-items: center; gap: 50px;
  box-shadow: 0 22px 44px rgba(236,72,153,.30), 0 0 0 5px rgba(236,72,153,.18);
  z-index: 4;
}
.ftp-tagEmoji { font-size: 200px; line-height: 1; }
.ftp-tagImg { width: 220px; height: 220px; object-fit: cover; border-radius: 24px; }
.ftp-tagText { flex: 1; }
.ftp-tagLbl { font-family: 'Bungee', cursive; font-size: 36px; color: #be185d; letter-spacing: .15em; }
.ftp-tagName { font-family: 'Bungee', cursive; font-size: 100px; color: #1f2937; line-height: 1; margin-top: 10px; text-shadow: 3px 3px 0 rgba(251,191,36,.5); }

/* Menu — full width, big chalkboard */
.ftp-menu {
  position: absolute; top: 1140px; left: 60px; right: 60px; height: 1480px;
  background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
  border: 14px solid #92400e;
  border-radius: 32px;
  padding: 50px 60px 60px;
  box-shadow: inset 0 0 80px rgba(0,0,0,.5), 0 22px 44px rgba(0,0,0,.4);
  z-index: 3;
  display: flex; flex-direction: column;
}
.ftp-menu h2 { margin: 0; font-family: 'Permanent Marker', cursive; font-size: 110px; color: #fef3c7; text-align: center; line-height: 1; letter-spacing: .04em; }
.ftp-date { font-family: 'Permanent Marker', cursive; font-size: 50px; color: #fbbf24; text-align: center; margin-top: 12px; opacity: .85; }
.ftp-items { display: flex; flex-direction: column; gap: 22px; margin-top: 40px; flex: 1; min-height: 0; }
.ftp-item {
  display: flex; align-items: center; gap: 36px;
  padding: 18px 30px;
  border-bottom: 3px dashed rgba(251,191,36,.25);
  flex: 1 1 0; min-height: 0;
}
.ftp-item:last-child { border-bottom: none; }
.ftp-itemEmoji { font-size: 110px; line-height: 1; flex: 0 0 auto; }
.ftp-itemImg { width: 110px; height: 110px; object-fit: cover; border-radius: 16px; }
.ftp-itemBody { flex: 1; min-width: 0; }
.ftp-nm { font-family: 'Permanent Marker', cursive; font-size: 80px; color: #fef3c7; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ftp-allergen { font-family: 'Fredoka', sans-serif; font-weight: 500; font-size: 42px; color: #fbbf24; margin-top: 8px; opacity: .85; }

/* Countdown burst */
.ftp-countdown {
  position: absolute; top: 2680px; left: 60px; right: 60px; height: 480px;
  display: flex; align-items: center; justify-content: center; z-index: 4;
}
.ftp-burst {
  position: relative; width: 480px; height: 480px;
  display: flex; align-items: center; justify-content: center;
}
.ftp-rays {
  position: absolute; inset: 0;
  background: conic-gradient(from 0deg, #fbbf24, #ec4899, #06b6d4, #fbbf24, #ec4899, #06b6d4, #fbbf24);
  border-radius: 50%;
  animation: ftp-burstSpin 12s linear infinite;
  filter: blur(12px);
  opacity: .85;
}
@keyframes ftp-burstSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.ftp-center {
  position: relative; width: 380px; height: 380px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24);
  border: 10px solid #1f2937;
  border-radius: 50%;
  box-shadow: inset 0 0 40px rgba(251,191,36,.5);
  text-align: center;
  padding: 30px;
}
.ftp-cdLbl { font-family: 'Permanent Marker', cursive; font-size: 38px; color: #7c2d12; line-height: 1.1; }
.ftp-cdNum { font-family: 'Bungee', cursive; font-size: 220px; color: #dc2626; line-height: 1; text-shadow: 6px 6px 0 #fbbf24; animation: ftp-cdPulse 1.4s ease-in-out infinite; }
@keyframes ftp-cdPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
.ftp-cdUnit { font-family: 'Bungee', cursive; font-size: 50px; color: #7c2d12; letter-spacing: .15em; }

/* Bottom row — chef + birthdays two-up */
.ftp-bottomRow {
  position: absolute; top: 3220px; left: 60px; right: 60px; height: 400px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
  z-index: 4;
}
.ftp-chef, .ftp-birthdays {
  background: #fffdf5;
  border: 6px solid #ec4899;
  border-radius: 24px;
  padding: 28px 40px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  box-shadow: 0 18px 36px rgba(0,0,0,.18);
}
.ftp-chefFace {
  width: 160px; height: 160px;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 5px solid #1f2937;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 120px; line-height: 1;
}
.ftp-chefPhoto { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.ftp-chefName { font-family: 'Bungee', cursive; font-size: 56px; color: #1f2937; margin-top: 14px; line-height: 1; }
.ftp-chefRole { font-family: 'Permanent Marker', cursive; font-size: 36px; color: #be185d; margin-top: 6px; }

.ftp-ring {
  width: 160px; height: 160px;
  background: radial-gradient(circle, transparent 60%, #fbbf24 60% 70%, transparent 70%);
  display: flex; align-items: center; justify-content: center;
  animation: ftp-ringSpin 14s linear infinite;
}
@keyframes ftp-ringSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.ftp-cake { font-size: 110px; line-height: 1; animation: ftp-cakeWiggle 1.4s ease-in-out infinite; }
@keyframes ftp-cakeWiggle { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
.ftp-bdLbl { font-family: 'Bungee', cursive; font-size: 40px; color: #be185d; margin-top: 14px; letter-spacing: .12em; }
.ftp-bdNames { font-family: 'Permanent Marker', cursive; font-size: 44px; color: #1f2937; margin-top: 8px; line-height: 1.15; }

/* Ticker */
.ftp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  background: linear-gradient(90deg, #1f2937 0%, #4c1d95 100%);
  display: flex; align-items: center; overflow: hidden;
  border-top: 6px solid #fbbf24;
  z-index: 6;
}
.ftp-tickerStamp {
  flex: 0 0 auto; padding: 0 50px; height: 100%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 48px; color: #1f2937;
  letter-spacing: .12em;
}
.ftp-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.ftp-tickerText {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 56px;
  color: #fef3c7; white-space: nowrap;
  display: inline-block; padding-left: 100%;
  will-change: transform;
  animation: ftp-tickerScroll 60s linear infinite;
}
@keyframes ftp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .12); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .18); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
