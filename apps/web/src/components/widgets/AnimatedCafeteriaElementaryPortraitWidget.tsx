"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.

/**
 * AnimatedCafeteriaElementaryPortraitWidget — REAL 4K portrait companion
 * to AnimatedCafeteriaElementaryWidget.
 *
 * NOT letterboxed. Native 2160×3840 canvas. Same data-field keys as the
 * landscape widget so the auto-form editor + canvas hotspots work
 * identically. Same data flow (live clock, weekday-aware menu pick,
 * countdown days, birthday list, allergen ticker).
 *
 * Vertical re-flow:
 *   • Marquee bulbs across the very top (more bulbs for the wider feel)
 *   • Drifting food emojis layer
 *   • TODAY'S LUNCH neon sign + Mon-Fri day strip — top hero (~700px)
 *   • Today's chef polaroid pinned right of the title
 *   • Pickup special — full-width banner
 *   • Today's menu — chunky 2-column grid of food cards (~1600px)
 *   • Countdown sunburst — full-width hero
 *   • Birthdays ring — fun-fact card row
 *   • Allergen ticker pinned at the bottom (full-width scroll)
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

  // Today's Special (pickup card)
  specialEmoji?: string;
  specialLabel?: string;
  specialName?: string;

  // Menu — primary (weekMenu) or fallback flat (menuItems)
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
  chefPhotoUrl?: string;
  chefEmoji?: string;

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

// Which day's menu is "today". 0=Sun, 1=Mon … 5=Fri, 6=Sat.
// Weekends fall back to Friday (then walks back) so a school re-open
// after a long weekend doesn't show stale content.
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

export function AnimatedCafeteriaElementaryPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
  const c = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());

  // Scale the 2160×3840 canvas to the parent zone using offsetWidth so a
  // ScaledTemplateThumbnail wrapper doesn't double-apply.
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

  // Live clock — 30s tick; gallery thumbs (live=false) skip the work.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isLive]);

  // Clock formatting with optional IANA tz.
  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '11';
  const mm = parts.find(p => p.type === 'minute')?.value || '45';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  // Today's menu — prefer weekMenu, fall back to flat menuItems, then defaults.
  const today = now.getDay();
  const menuItems: MenuItem[] = useMemo(() => {
    const picked = pickMenuForToday(c.weekMenu, today);
    if (picked && picked.length > 0) return picked;
    if (Array.isArray(c.menuItems) && c.menuItems.length > 0) return c.menuItems;
    return [
      { emoji: '🍕', name: 'Pepperoni Pizza',         meta: '🌾 🧀',   price: '$3.25' },
      { emoji: '🥗', name: 'Build-a-Salad Bar',       meta: 'veg',     price: '$2.95' },
      { emoji: '🍟', name: 'Crispy Fries',            meta: 'veg · gf', price: '$1.75' },
      { emoji: '🍎', name: 'Fresh Fruit Cup',         meta: 'veg · gf', price: '$1.50' },
      { emoji: '🥛', name: 'Milk · White or Choc',    meta: '🧀',      price: '$0.75' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

  // Countdown — date-driven preferred, fall back to static number.
  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 1;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  // Birthdays — accept string or array; render inline with center dots.
  const birthdayList: string[] = useMemo(() => {
    if (Array.isArray(c.birthdayNames)) return c.birthdayNames.filter(Boolean);
    if (typeof c.birthdayNames === 'string') {
      return c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean);
    }
    return ['Alex', 'Jordan', 'Sam'];
  }, [c.birthdayNames]);
  const bdInline = birthdayList.join(' · ');

  // Ticker text — joined with sparkle separators.
  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'Allergen key: 🌾 = gluten · 🥜 = nuts · 🧀 = dairy · 🥚 = egg  ✦  TACO TUESDAY tomorrow — $3.50 tacos all day  ✦  Free water refills at the salad bar  ✦  PIZZA FRIDAY returns — $3.25 slices  ✦  Reload your lunch card in the main office';
  }, [c.tickerMessages]);

  const chefFace = c.chefEmoji || '👩‍🍳';
  const specialEmoji = c.specialEmoji || '🍕';
  const isSpecialUrl = /^(https?:\/\/|\/|data:image\/)/.test(specialEmoji);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fce7f3',
      }}
    >
      <style>{CSS_CAFE_PORTRAIT}</style>

      <div
        className="cep-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Drifting food emojis */}
        <div className="cep-floater a">🌮</div>
        <div className="cep-floater b">🍔</div>
        <div className="cep-floater c">🥨</div>
        <div className="cep-floater d">🍟</div>
        <div className="cep-floater e">🍩</div>
        <div className="cep-floater f">🍰</div>

        {/* Marquee bulbs across the top */}
        <div className="cep-lights">
          <div className="cep-wire" />
          {[3,8,13,18,23,28,33,38,43,48,53,58,63,68,73,78,83,88,93,97].map((left, i) => (
            <div key={i} className={`cep-bulb ${['y','p','c'][i % 3]}`} style={{ left: `${left}%` }} />
          ))}
        </div>

        {/* Header — title hero + day-of-week strip + chef pinned right */}
        <div className="cep-header">
          {/* Title sign */}
          <div className="cep-title">
            <span className="cep-star s1">✨</span>
            <span className="cep-star s2">⭐</span>
            <span className="cep-star s3">🌟</span>
            <span className="cep-star s4">💫</span>
            <div className="cep-eyebrow">★ TODAY'S ★</div>
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'LUNCH').toUpperCase()}</h1>
            <div className="cep-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ freshly rolled every day ~'}</div>
            <div className="cep-clockBadge">
              <div className="cep-clockT">{hh}:{mm}</div>
              <div className="cep-clockAp">{ampm}</div>
              <div className="cep-clockDate">{dateLine}</div>
            </div>
          </div>

          {/* Day-of-week tab strip */}
          <div className="cep-dayTabs">
            {(['MON','TUE','WED','THU','FRI'] as const).map((d, i) => {
              const isToday = today === i + 1;
              return (
                <span key={d} className={`cep-day${isToday ? ' cep-day-today' : ''}`}>
                  {d}
                </span>
              );
            })}
          </div>
        </div>

        {/* Pickup special — full-width banner row */}
        <div className="cep-special">
          <div className="cep-string" />
          <div className="cep-tag">
            <span className="cep-tagEmoji" data-field="specialEmoji" style={{ whiteSpace: 'pre-wrap' }}>
              {isSpecialUrl ? <img src={specialEmoji} alt="" className="cep-tagImg" /> : specialEmoji}
            </span>
            <div className="cep-tagText">
              <div className="cep-tagLbl" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.specialLabel || 'Pickup Special').toUpperCase()} ★</div>
              <div className="cep-tagName" data-field="specialName" style={{ whiteSpace: 'pre-wrap' }}>{c.specialName || 'Cheesy Pepperoni'}</div>
            </div>
          </div>
        </div>

        {/* Today's menu — 2-col grid of chunky food cards */}
        <div className="cep-menu">
          <div className="cep-menuAwning" />
          <div className="cep-menuBody">
            <h2>Today&apos;s Menu</h2>
            <div className="cep-menuItems">
              {menuItems.slice(0, 6).map((it, i) => {
                const src = it.emoji || '';
                const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                return (
                  <div key={i} className="cep-card">
                    <div className="cep-cardEmoji">
                      {isUrl
                        ? <img src={src} alt="" className="cep-cardImg" />
                        : (src || '🍽️')}
                    </div>
                    <div className="cep-cardName">{it.name || ''}</div>
                    {it.meta && <div className="cep-cardMeta">{it.meta}</div>}
                    {it.price && <div className="cep-cardPrice">{it.price}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Chef polaroid + Birthdays — two-up row */}
        <div className="cep-bottomRow">
          <div className="cep-chef">
            <div className="cep-chefHat">👨‍🍳</div>
            <div className="cep-chefFace">
              {c.chefPhotoUrl
                ? <img src={c.chefPhotoUrl} alt="" className="cep-chefPhoto" />
                : <span>{chefFace}</span>}
            </div>
            <div className="cep-chefTape" />
            <div className="cep-chefName" data-field="chefName" style={{ whiteSpace: 'pre-wrap' }}>{(c.chefName || 'Ms. Rodriguez').toUpperCase()}</div>
            <div className="cep-chefRole" data-field="chefRole" style={{ whiteSpace: 'pre-wrap' }}>~ {c.chefRole || 'lunch hero of the week'} ~</div>
          </div>

          <div className="cep-countdown">
            <div className="cep-burst">
              <div className="cep-rays" />
              <div className="cep-burstCenter">
                <div className="cep-cdIcon">{c.countdownEmoji || '🌮'}</div>
                <div className="cep-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Taco Tuesday in'}</div>
                <div className="cep-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
                <div className="cep-cdUnit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{unit}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Birthdays ring — full width row */}
        <div className="cep-birthdays">
          <div className="cep-ring">
            <div className="cep-cake">🎂</div>
          </div>
          <div className="cep-bdInfo">
            <div className="cep-bdLbl">★ Birthdays Today ★</div>
            <div className="cep-bdNames" data-field="birthdayNames" style={{ whiteSpace: 'pre-wrap' }}>{bdInline}</div>
          </div>
          <div className="cep-confetti">
            <span style={{ left: '8%', top: '20%' }}>🎉</span>
            <span style={{ left: '92%', top: '24%' }}>🎈</span>
            <span style={{ left: '18%', top: '70%' }}>🎈</span>
            <span style={{ left: '82%', top: '76%' }}>🎉</span>
          </div>
        </div>

        {/* Allergen ticker pinned to the bottom */}
        <div className="cep-ticker">
          <div className="cep-tickerBar">
            <div className="cep-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Café News').toUpperCase()}</div>
            <div className="cep-tickerScroll">
              <span
                className="cep-tickerText"
                style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
              >{tickerText}</span>
            </div>
          </div>
        </div>

        {/* Edit hotspots — builder-only */}
        {!isLive && (
          <>
            <Hotspot section="header"      x={60}   y={140}  w={2040} h={780} />
            <Hotspot section="header"      x={60}   y={940}  w={2040} h={180} />
            <Hotspot section="special"     x={60}   y={1160} w={2040} h={380} />
            <Hotspot section="menu"        x={60}   y={1580} w={2040} h={1380} />
            <Hotspot section="chef"        x={60}   y={3000} w={1000} h={420} />
            <Hotspot section="countdown"   x={1100} y={3000} w={1000} h={420} />
            <Hotspot section="birthdays"   x={60}   y={3440} w={2040} h={220} />
            <Hotspot section="ticker"      x={0}    y={3680} w={2160} h={160} />
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

const CSS_CAFE_PORTRAIT = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Permanent+Marker&display=swap');

.cep-stage {
  position: relative;
  font-family: 'Fredoka', ui-rounded, sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 100%, #fbbf24 0%, transparent 50%),
    radial-gradient(ellipse at 0% 0%, #ec4899 0%, transparent 40%),
    radial-gradient(ellipse at 100% 0%, #06b6d4 0%, transparent 40%),
    linear-gradient(180deg, #fce7f3 0%, #ffe4e6 30%, #fef3c7 65%, #fed7aa 100%);
  overflow: hidden;
}

/* Marquee bulbs across the very top */
.cep-lights { position: absolute; top: 40px; left: 0; right: 0; height: 80px; pointer-events: none; z-index: 2; }
.cep-wire { position: absolute; top: 50%; left: 0; right: 0; height: 5px; background: #1f2937; border-radius: 3px; }
.cep-bulb {
  position: absolute; top: 38%; width: 38px; height: 56px;
  border-radius: 50% 50% 40% 40%;
  animation: cep-blink 3s ease-in-out infinite;
}
.cep-bulb::before {
  content: ''; position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
  width: 10px; height: 14px; background: #374151; border-radius: 3px 3px 0 0;
}
.cep-bulb.y { background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #d97706); box-shadow: 0 0 32px #fbbf24, 0 0 60px rgba(251,191,36,.4); }
.cep-bulb.p { background: radial-gradient(circle at 30% 30%, #fecaca, #ec4899 70%, #9d174d); box-shadow: 0 0 32px #ec4899, 0 0 60px rgba(236,72,153,.4); animation-delay: .5s; }
.cep-bulb.c { background: radial-gradient(circle at 30% 30%, #bfdbfe, #06b6d4 70%, #0e7490); box-shadow: 0 0 32px #06b6d4, 0 0 60px rgba(6,182,212,.4); animation-delay: 1s; }
@keyframes cep-blink { 0%, 100% { opacity: 1; } 48%, 52% { opacity: .45; } }

/* Drifting food */
.cep-floater {
  position: absolute; font-size: 130px; opacity: .5;
  z-index: 1;
  animation: cep-drift 38s linear infinite;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.2));
}
.cep-floater.a { top: 8%;  left: -10%; animation-delay: 0s; }
.cep-floater.b { top: 22%; left: -10%; animation-delay: -8s; font-size: 110px; }
.cep-floater.c { top: 48%; left: -10%; animation-delay: -14s; font-size: 120px; }
.cep-floater.d { top: 62%; left: -10%; animation-delay: -3s; font-size: 100px; }
.cep-floater.e { top: 78%; left: -10%; animation-delay: -20s; font-size: 110px; }
.cep-floater.f { top: 90%; left: -10%; animation-delay: -26s; font-size: 100px; }
@keyframes cep-drift {
  from { transform: translateX(0) rotate(0deg); }
  to   { transform: translateX(2700px) rotate(360deg); }
}

/* Header hero */
.cep-header {
  position: absolute; top: 160px; left: 60px; right: 60px;
  z-index: 5;
  display: flex; flex-direction: column; gap: 30px;
}
.cep-title {
  position: relative; text-align: center;
  background: linear-gradient(180deg, #fef3c7, #fbbf24);
  border: 14px solid #1f2937; border-radius: 40px;
  padding: 50px 60px 60px;
  box-shadow: 0 0 0 8px #fef3c7, 0 0 0 20px #ec4899, 0 32px 60px rgba(0,0,0,.28);
  animation: cep-sign 4s ease-in-out infinite;
}
@keyframes cep-sign { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-6px); } }
.cep-eyebrow { font-family: 'Bungee', cursive; font-size: 56px; color: #be185d; letter-spacing: .2em; line-height: 1; margin-bottom: 14px; }
.cep-title h1 {
  margin: 0; line-height: .9;
  font-family: 'Bungee', cursive; font-size: 320px; color: #dc2626;
  text-shadow: 10px 10px 0 #1f2937, 18px 18px 0 #fbbf24;
  letter-spacing: .03em;
}
.cep-sub { font-family: 'Permanent Marker', cursive; font-size: 76px; color: #7c2d12; margin-top: 14px; line-height: 1.05; }
.cep-star { position: absolute; font-size: 90px; line-height: 1; animation: cep-twinkle 1.4s ease-in-out infinite; }
.cep-star.s1 { top: -32px; left: 6%; }
.cep-star.s2 { top: -32px; right: 6%; animation-delay: .3s; }
.cep-star.s3 { bottom: -38px; left: 14%; animation-delay: .6s; }
.cep-star.s4 { bottom: -38px; right: 14%; animation-delay: .9s; }
@keyframes cep-twinkle {
  0%, 100% { opacity: .4; transform: scale(.9) rotate(-10deg); }
  50%      { opacity: 1;  transform: scale(1.2) rotate(15deg); }
}

/* Inline clock badge inside the title board */
.cep-clockBadge {
  position: absolute; top: 30px; right: 30px;
  width: 240px; height: 240px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #fff, #fef3c7 70%);
  border: 10px solid #1f2937; border-radius: 50%;
  box-shadow: 0 14px 28px rgba(0,0,0,.28), inset 0 0 26px rgba(251,191,36,.3);
  animation: cep-clockBob 3.6s ease-in-out infinite;
}
@keyframes cep-clockBob { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.cep-clockT { font-family: 'Bungee', cursive; font-size: 70px; line-height: 1; color: #dc2626; text-shadow: 3px 3px 0 rgba(0,0,0,.12); }
.cep-clockAp { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 28px; color: #7c2d12; letter-spacing: .15em; margin-top: 4px; }
.cep-clockDate { font-family: 'Permanent Marker', cursive; font-size: 18px; color: #9d174d; margin-top: 4px; line-height: 1; max-width: 200px; text-align: center; }

/* Day tabs strip */
.cep-dayTabs {
  display: flex; justify-content: center; gap: 24px;
}
.cep-day {
  font-family: 'Bungee', cursive; font-size: 64px; padding: 22px 44px;
  border: 8px solid #1f2937; border-radius: 26px;
  background: #fef3c7; color: #92400e;
  box-shadow: 6px 6px 0 #1f2937; letter-spacing: .08em;
  line-height: 1;
}
.cep-day-today {
  background: linear-gradient(135deg, #dc2626, #f59e0b); color: #fff;
  transform: translateY(-6px) rotate(-2deg);
  box-shadow: 6px 10px 0 #1f2937, 0 0 0 8px #fbbf24;
  text-shadow: 3px 3px 0 rgba(0,0,0,.2);
}

/* Pickup special — full-width banner */
.cep-special {
  position: absolute; top: 1180px; left: 60px; right: 60px; height: 360px;
  z-index: 4;
  display: flex; align-items: flex-start; justify-content: center; flex-direction: column;
}
.cep-string { width: 4px; height: 36px; background: #1f2937; border-radius: 2px; margin: 0 auto; }
.cep-tag {
  position: relative; width: 100%;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 10px solid #1f2937;
  clip-path: polygon(4% 50%, 9% 0, 100% 0, 100% 100%, 9% 100%);
  padding: 30px 60px 30px 200px;
  display: flex; align-items: center; gap: 50px;
  box-shadow: 0 22px 44px rgba(0,0,0,.3);
  animation: cep-tagSwing 3.6s ease-in-out infinite;
  transform-origin: 6% 0;
  min-height: 280px;
}
@keyframes cep-tagSwing { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
.cep-tag::before {
  content: ''; position: absolute;
  left: 90px; top: 50%; transform: translateY(-50%);
  width: 28px; height: 28px; border-radius: 50%; background: #1f2937;
}
.cep-tagEmoji {
  font-size: 240px; line-height: 1; flex: 0 0 auto;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.3));
}
.cep-tagImg { width: 240px; height: 240px; object-fit: contain; border-radius: 24px; }
.cep-tagText { flex: 1; }
.cep-tagLbl { font-family: 'Bungee', cursive; font-size: 44px; color: #dc2626; letter-spacing: .15em; line-height: 1; }
.cep-tagName { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 110px; color: #7c2d12; line-height: 1.05; margin-top: 12px; }

/* Menu — chunky 2-column food cards */
.cep-menu {
  position: absolute; top: 1600px; left: 60px; right: 60px; height: 1340px;
  background: #fafafa;
  border: 12px solid #1f2937;
  border-radius: 36px;
  box-shadow: 0 28px 50px rgba(0,0,0,.25), 16px 16px 0 #ec4899, 22px 22px 0 #1f2937;
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 3;
  animation: cep-menuFloat 5.4s ease-in-out infinite;
}
@keyframes cep-menuFloat { 0%, 100% { transform: rotate(-.4deg) translateY(0); } 50% { transform: rotate(.4deg) translateY(-6px); } }
.cep-menuAwning {
  flex: 0 0 auto; height: 60px;
  background: repeating-linear-gradient(90deg, #dc2626 0 50px, #fef3c7 50px 100px);
  border-bottom: 8px solid #1f2937;
  clip-path: polygon(0 0, 100% 0, 100% 50%, 96% 100%, 92% 50%, 88% 100%, 84% 50%, 80% 100%, 76% 50%, 72% 100%, 68% 50%, 64% 100%, 60% 50%, 56% 100%, 52% 50%, 48% 100%, 44% 50%, 40% 100%, 36% 50%, 32% 100%, 28% 50%, 24% 100%, 20% 50%, 16% 100%, 12% 50%, 8% 100%, 4% 50%, 0 100%);
}
.cep-menuBody { flex: 1; padding: 50px 60px 60px; display: flex; flex-direction: column; min-height: 0; }
.cep-menu h2 {
  margin: 0 0 30px; line-height: 1; text-align: center;
  font-family: 'Bungee', cursive; font-size: 130px;
  background: linear-gradient(135deg, #dc2626, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.cep-menuItems {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: 1fr;
  gap: 28px;
}
.cep-card {
  position: relative;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 8px solid #1f2937; border-radius: 28px;
  padding: 24px 28px;
  box-shadow: 8px 8px 0 #1f2937;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  overflow: hidden;
  min-height: 0;
  animation: cep-cardWiggle 5s ease-in-out infinite;
}
.cep-card:nth-child(2n) { animation-delay: -1.2s; }
.cep-card:nth-child(3n) { animation-delay: -2.4s; background: linear-gradient(135deg, #fce7f3, #fbcfe8); }
.cep-card:nth-child(4n) { animation-delay: -3.6s; background: linear-gradient(135deg, #cffafe, #a5f3fc); }
@keyframes cep-cardWiggle { 0%, 100% { transform: rotate(-1deg); } 50% { transform: rotate(1deg) translateY(-4px); } }
.cep-cardEmoji {
  font-size: 220px; line-height: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25));
  display: inline-flex; align-items: center; justify-content: center;
  width: 240px; height: 240px;
  margin-bottom: 8px;
}
.cep-cardImg { width: 100%; height: 100%; object-fit: contain; border-radius: 18px; }
.cep-cardName {
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  font-size: 60px; color: #1f2937; line-height: 1.05;
  text-overflow: ellipsis; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  max-width: 100%;
}
.cep-cardMeta {
  font-family: 'Permanent Marker', cursive;
  font-size: 38px; color: #b91c1c; line-height: 1.1;
  margin-top: 10px; letter-spacing: .02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.cep-cardPrice {
  margin-top: auto; padding-top: 12px;
  font-family: 'Bungee', cursive; font-size: 56px;
  color: #dc2626; line-height: 1;
}

/* Bottom row — chef polaroid + countdown burst */
.cep-bottomRow {
  position: absolute; top: 3000px; left: 60px; right: 60px; height: 420px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
  z-index: 4;
}

.cep-chef {
  position: relative;
  background: #fffdf5;
  border: 8px solid #1f2937; border-radius: 24px;
  padding: 28px 30px 30px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  box-shadow: 0 18px 36px rgba(0,0,0,.25), 10px 10px 0 #ec4899;
  transform: rotate(-2deg);
  animation: cep-chefSway 6s ease-in-out infinite;
}
@keyframes cep-chefSway { 0%, 100% { transform: rotate(-2deg) translateY(0); } 50% { transform: rotate(0deg) translateY(-6px); } }
.cep-chefHat {
  position: absolute; top: -52px; left: 50%; transform: translateX(-50%);
  font-size: 90px; line-height: 1;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.3));
}
.cep-chefTape {
  position: absolute; top: -22px; right: 30px;
  width: 110px; height: 30px; transform: rotate(18deg);
  background: rgba(236, 72, 153, .55);
  border-left: 2px dashed rgba(255,255,255,.55);
  border-right: 2px dashed rgba(255,255,255,.55);
}
.cep-chefFace {
  width: 200px; height: 200px;
  background: radial-gradient(circle at 50% 40%, #fef3c7, #fbbf24 70%);
  border: 6px solid #1f2937; border-radius: 22px;
  display: flex; align-items: center; justify-content: center;
  font-size: 150px; line-height: 1; overflow: hidden;
  flex: 0 0 auto;
}
.cep-chefPhoto { width: 100%; height: 100%; object-fit: cover; }
.cep-chefName { font-family: 'Bungee', cursive; font-size: 50px; color: #7c2d12; margin-top: 14px; line-height: 1; }
.cep-chefRole { font-family: 'Permanent Marker', cursive; font-size: 32px; color: #9d174d; margin-top: 6px; line-height: 1; }

/* Countdown sunburst */
.cep-countdown { display: flex; align-items: center; justify-content: center; }
.cep-burst { position: relative; width: 380px; height: 380px; animation: cep-burstSpin 14s linear infinite; }
@keyframes cep-burstSpin { to { transform: rotate(360deg); } }
.cep-rays {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg,
    #fde68a 0 20deg, #fbbf24 20deg 40deg,
    #fde68a 40deg 60deg, #fbbf24 60deg 80deg,
    #fde68a 80deg 100deg, #fbbf24 100deg 120deg,
    #fde68a 120deg 140deg, #fbbf24 140deg 160deg,
    #fde68a 160deg 180deg, #fbbf24 180deg 200deg,
    #fde68a 200deg 220deg, #fbbf24 220deg 240deg,
    #fde68a 240deg 260deg, #fbbf24 260deg 280deg,
    #fde68a 280deg 300deg, #fbbf24 300deg 320deg,
    #fde68a 320deg 340deg, #fbbf24 340deg 360deg);
  border: 10px solid #1f2937;
  filter: drop-shadow(0 18px 30px rgba(0,0,0,.3));
}
.cep-burstCenter {
  position: absolute; inset: 50px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff, #fef3c7 70%);
  border: 10px solid #1f2937;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 24px;
  animation: cep-burstSpin 14s linear infinite reverse;
}
.cep-cdIcon { font-size: 60px; line-height: 1; }
.cep-cdLbl { font-family: 'Bungee', cursive; font-size: 22px; color: #9d174d; letter-spacing: .12em; text-transform: uppercase; max-width: 200px; line-height: 1.1; margin-top: 4px; }
.cep-cdNum { font-family: 'Bungee', cursive; font-size: 130px; line-height: .9; color: #dc2626; text-shadow: 4px 4px 0 rgba(0,0,0,.18); margin: 6px 0; animation: cep-cdPulse 1.4s ease-in-out infinite; }
@keyframes cep-cdPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
.cep-cdUnit { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 28px; color: #1f2937; letter-spacing: .15em; }

/* Birthdays row — full-width fun-fact card */
.cep-birthdays {
  position: absolute; top: 3460px; left: 60px; right: 60px; height: 200px;
  background: linear-gradient(135deg, #fce7f3, #fbcfe8);
  border: 8px solid #ec4899; border-radius: 28px;
  padding: 0 60px;
  display: flex; align-items: center; gap: 36px;
  box-shadow: 0 14px 28px rgba(236,72,153,.25);
  z-index: 4;
  overflow: hidden;
}
.cep-ring {
  position: relative; width: 160px; height: 160px;
  display: flex; align-items: center; justify-content: center;
  animation: cep-ringSpin 16s linear infinite;
  flex: 0 0 auto;
}
@keyframes cep-ringSpin { to { transform: rotate(360deg); } }
.cep-ring::before {
  content: ''; position: absolute; inset: -16px; border-radius: 50%;
  background:
    radial-gradient(circle at 50% 0, #ec4899 0 9px, transparent 10px),
    radial-gradient(circle at 100% 50%, #06b6d4 0 9px, transparent 10px),
    radial-gradient(circle at 50% 100%, #fbbf24 0 9px, transparent 10px),
    radial-gradient(circle at 0 50%, #10b981 0 9px, transparent 10px),
    radial-gradient(circle at 15% 15%, #a78bfa 0 7px, transparent 8px),
    radial-gradient(circle at 85% 15%, #f43f5e 0 7px, transparent 8px),
    radial-gradient(circle at 85% 85%, #f97316 0 7px, transparent 8px),
    radial-gradient(circle at 15% 85%, #3b82f6 0 7px, transparent 8px);
}
.cep-cake { font-size: 110px; line-height: 1; filter: drop-shadow(0 6px 10px rgba(0,0,0,.3)); animation: cep-cakeSpin 16s linear infinite reverse; }
@keyframes cep-cakeSpin { to { transform: rotate(-360deg); } }
.cep-bdInfo { flex: 1; min-width: 0; }
.cep-bdLbl {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 38px;
  color: #be185d; letter-spacing: .18em; text-transform: uppercase;
  text-shadow: 2px 2px 0 #fef3c7;
  line-height: 1;
}
.cep-bdNames {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 76px;
  color: #1f2937; margin-top: 4px; line-height: 1;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cep-confetti { position: absolute; inset: 0; pointer-events: none; }
.cep-confetti span {
  position: absolute; font-size: 60px; line-height: 1;
  animation: cep-confettiFloat 3.4s ease-in-out infinite;
}
.cep-confetti span:nth-child(2) { animation-delay: -.7s; }
.cep-confetti span:nth-child(3) { animation-delay: -1.5s; }
.cep-confetti span:nth-child(4) { animation-delay: -2.3s; }
@keyframes cep-confettiFloat { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-12px) rotate(8deg); } }

/* Allergen ticker pinned bottom */
.cep-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  background: #fafafa;
  display: flex; flex-direction: column;
  z-index: 6;
  box-shadow: 0 -10px 26px rgba(0,0,0,.18);
}
.cep-ticker::before {
  content: ''; display: block; height: 32px; flex: 0 0 auto;
  background: repeating-linear-gradient(90deg, #dc2626 0 32px, #fef3c7 32px 64px);
  border-bottom: 5px solid #1f2937;
  clip-path: polygon(0 0, 100% 0, 100% 55%, 96% 100%, 92% 55%, 88% 100%, 84% 55%, 80% 100%, 76% 55%, 72% 100%, 68% 55%, 64% 100%, 60% 55%, 56% 100%, 52% 55%, 48% 100%, 44% 55%, 40% 100%, 36% 55%, 32% 100%, 28% 55%, 24% 100%, 20% 55%, 16% 100%, 12% 55%, 8% 100%, 4% 55%, 0 100%);
}
.cep-tickerBar { flex: 1; display: flex; align-items: center; overflow: hidden; background: linear-gradient(180deg, #fafafa 0%, #fde68a 100%); }
.cep-tickerStamp {
  flex: 0 0 auto; padding: 0 50px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #9d174d);
  color: #fef3c7; display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 50px;
  text-shadow: 2px 2px 0 #1f2937;
}
.cep-tickerScroll { flex: 1; overflow: hidden; height: 100%; display: flex; align-items: center; }
.cep-tickerText {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 60px;
  color: #1f2937; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: cep-tickerScroll 60s linear infinite;
}
@keyframes cep-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .12); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .18); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
