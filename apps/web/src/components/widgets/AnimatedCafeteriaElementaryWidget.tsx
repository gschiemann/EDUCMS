"use client";

/**
 * AnimatedCafeteriaElementaryWidget — full-screen food-truck cafeteria
 * scene for elementary schools.
 *
 * ════════════════════════════════════════════════════════════════
 *  Ported from scratch/design/animated-cafeteria-elementary.html
 *  (v2, commit 201c88f — approved 2026-04-19).
 *
 *  Same patterns as the Welcome series:
 *  - Fixed 1920×1080 canvas + transform:scale via offsetWidth
 *  - `live` prop gates expensive work in gallery thumbnails
 *  - `aw-edit-section` CustomEvent hotspots route clicks to the
 *    matching editor section in PropertiesPanel
 *
 *  Cafeteria-specific behaviors:
 *  - Day-of-week auto-pick: reads today's DOW and displays that
 *    day's menu items from config.weekMenu. Monday=1 … Friday=5;
 *    weekends fall back to Friday's menu.
 *  - Container-query auto-sizing on menu items — 4 items render
 *    huge, 10 items compress automatically. No manual layout work
 *    for admins.
 *  - Every food emoji is a separate config field (ICON-SWAP).
 * ════════════════════════════════════════════════════════════════
 */

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
  logoEmoji?: string;           // default '🚚' (rendered as a food-truck composite — see CSS)
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;

  // Today's Special (left card)
  specialEmoji?: string;
  specialLabel?: string;
  specialName?: string;

  // Menu — primary (weekMenu) or fallback flat (menuItems)
  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];       // legacy flat list; used if weekMenu empty

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
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Which day's menu is "today". 0=Sun, 1=Mon … 5=Fri, 6=Sat.
// Weekends show Friday's menu so the cafeteria doesn't display
// stale Monday content when a school reopens after a long weekend.
function pickMenuForToday(week: WeekMenu | undefined, dow: number): MenuItem[] | null {
  if (!week) return null;
  const order: (keyof WeekMenu)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  if (dow >= 1 && dow <= 5) {
    const list = week[order[dow - 1]];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  // Weekend fallback: use friday (then walk backwards for the first non-empty)
  for (let i = order.length - 1; i >= 0; i--) {
    const list = week[order[i]];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return null;
}

export function AnimatedCafeteriaElementaryWidget({ config, live }: { config: Cfg; live?: boolean }) {
  const c = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());

  // Scale the 1920x1080 canvas to the zone. offsetWidth (layout size)
  // so ScaledTemplateThumbnail's transform:scale(.13) doesn't double-apply.
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

  // Live clock — 30s tick; skipped in thumbnail mode.
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
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  // Today's menu — prefer weekMenu, fall back to flat menuItems, then built-in defaults.
  const today = now.getDay();
  const menuItems: MenuItem[] = useMemo(() => {
    const picked = pickMenuForToday(c.weekMenu, today);
    if (picked && picked.length > 0) return picked;
    if (Array.isArray(c.menuItems) && c.menuItems.length > 0) return c.menuItems;
    return [
      { emoji: '🍕', name: 'Pepperoni Pizza',        meta: '🌾 🧀',   price: '$3.25' },
      { emoji: '🥗', name: 'Build-a-Salad Bar',      meta: 'veg',     price: '$2.95' },
      { emoji: '🍟', name: 'Crispy Fries',           meta: 'veg · gf', price: '$1.75' },
      { emoji: '🍎', name: 'Fresh Fruit Cup',        meta: 'veg · gf', price: '$1.50' },
      { emoji: '🥛', name: 'Milk · White or Chocolate', meta: '🧀',   price: '$0.75' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  // Date string under "Today's Menu" — e.g. "monday · april 19"
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

  // Ticker messages
  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'TACO TUESDAY tomorrow — $3.50 tacos all day  ✦  Free water refills at the salad bar  ✦  PIZZA FRIDAY returns — $3.25 slices  ✦  Reload your lunch card in the main office';
  }, [c.tickerMessages]);

  const chefFace = c.chefEmoji || '👩‍🍳';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fce7f3',
      }}
    >
      <style>{CSS_CAFE}</style>

      <div
        className="cafe-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Floaters + string lights */}
        <div className="cafe-floater a">🌮</div>
        <div className="cafe-floater b">🍔</div>
        <div className="cafe-floater c">🥨</div>
        <div className="cafe-floater d">🍟</div>

        <div className="cafe-lights">
          <div className="cafe-wire" />
          {[6,14,22,30,38,46,54,62,70,78,86,94].map((left, i) => (
            <div key={i} className={`cafe-bulb ${['y','p','c'][i % 3]}`} style={{ left: `${left}%` }} />
          ))}
        </div>

        <div className="cafe-ground" />

        <div className="cafe-header">
          {/* Food truck composite logo */}
          <div className="cafe-truck">
            <div className="cafe-awn" />
            <div className="cafe-cab" />
            <div className="cafe-body">
              <div className="cafe-window">EAT UP!</div>
            </div>
            <div className="cafe-wheel l" />
            <div className="cafe-wheel r" />
          </div>

          {/* Title — neon sign with stars */}
          <div className="cafe-title">
            <span className="cafe-star s1">✨</span>
            <span className="cafe-star s2">⭐</span>
            <span className="cafe-star s3">🌟</span>
            <span className="cafe-star s4">💫</span>
            <h1>{(c.title || 'LUNCH IS ON').toUpperCase()}</h1>
            <div className="cafe-sub">{c.subtitle || '~ freshly rolled every day ~'}</div>
          </div>

          {/* Clock */}
          <div className="cafe-clock">
            <div className="cafe-clockT">{hh}:{mm}</div>
            <div className="cafe-clockAp">{ampm}</div>
          </div>
        </div>

        <div className="cafe-grid">
          {/* Today's Special */}
          <div className="cafe-special">
            <div className="cafe-string" />
            <div className="cafe-tag">
              <span className="cafe-tagEmoji">{c.specialEmoji || '🍕'}</span>
              <div className="cafe-tagLbl">★ {(c.specialLabel || 'Pickup Special').toUpperCase()} ★</div>
              <div className="cafe-tagName">{c.specialName || 'Cheesy Pepperoni'}</div>
            </div>
          </div>

          {/* Menu card */}
          <div className="cafe-menu">
            <div className="cafe-menuAwning" />
            <div className="cafe-menuBody">
              <h2>Today's Menu</h2>
              <div className="cafe-date">{dateLine}</div>
              <div className="cafe-dayTabs">
                {(['MON','TUE','WED','THU','FRI'] as const).map((d, i) => {
                  const isToday = today === i + 1;
                  return <span key={d} className={`cafe-day${isToday ? ' cafe-day-today' : ''}`}>{d}</span>;
                })}
              </div>
              <div className="cafe-items">
                {menuItems.slice(0, 12).map((it, i) => {
                  // emoji field doubles as an image url — admins can
                  // upload a PNG per dish from the editor. Render <img>
                  // when the value looks like a URL (http(s):, leading
                  // '/', or data:image/), otherwise render as emoji text.
                  const src = it.emoji || '';
                  const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                  return (
                    <div key={i} className="cafe-item">
                      <span className="cafe-itemEmoji">
                        {isUrl
                          ? <img src={src} alt="" className="cafe-itemImg" />
                          : (src || '🍽️')}
                      </span>
                      <div className="cafe-itemInfo">
                        <div className="cafe-itemName">{it.name || ''}</div>
                        {it.meta && <div className="cafe-itemMeta">{it.meta}</div>}
                      </div>
                      <div className="cafe-leader" />
                      {it.price && <span className="cafe-itemPrice">{it.price}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Countdown sunburst */}
          <div className="cafe-countdown">
            <div className="cafe-burst">
              <div className="cafe-rays" />
              <div className="cafe-burstCenter">
                <div className="cafe-cdIcon">{c.countdownEmoji || '🌮'}</div>
                <div className="cafe-cdLbl">{c.countdownLabel || 'Taco Tuesday in'}</div>
                <div className="cafe-cdNum">{days}</div>
                <div className="cafe-cdUnit">{unit}</div>
              </div>
            </div>
          </div>

          {/* Chef card */}
          <div className="cafe-chef">
            <div className="cafe-chefCard">
              <div className="cafe-chefFace">
                {c.chefPhotoUrl
                  ? <img src={c.chefPhotoUrl} alt="" className="cafe-chefPhoto" />
                  : <span>{chefFace}</span>}
              </div>
              <div className="cafe-chefName">{(c.chefName || 'Ms. Rodriguez').toUpperCase()}</div>
              <div className="cafe-chefRole">~ {c.chefRole || 'lunch hero of the week'} ~</div>
            </div>
          </div>

          {/* Birthdays ring */}
          <div className="cafe-birthdays">
            <div className="cafe-ring">
              <div className="cafe-cake">🎂</div>
            </div>
            <div className="cafe-bdLbl">★ Birthdays Today ★</div>
            <div className="cafe-bdNames">{bdInline}</div>
          </div>
        </div>

        {/* Ticker */}
        <div className="cafe-ticker">
          <div className="cafe-tickerBar">
            <div className="cafe-tickerStamp">{(c.tickerStamp || 'Café News').toUpperCase()}</div>
            <div className="cafe-tickerScroll">
              <span className="cafe-tickerText">{tickerText}</span>
            </div>
          </div>
        </div>

        {/* Hotspots — same aw-edit-section contract as Welcome series */}
        <Hotspot section="header"       x={36}   y={110} w={260}  h={180} />
        <Hotspot section="header"       x={320}  y={110} w={1300} h={180} />
        <Hotspot section="header"       x={1660} y={110} w={200}  h={180} />
        <Hotspot section="special"      x={36}   y={330} w={290}  h={340} />
        <Hotspot section="menu"         x={350}  y={330} w={1220} h={590} />
        <Hotspot section="countdown"    x={1594} y={330} w={290}  h={340} />
        <Hotspot section="chef"         x={36}   y={680} w={290}  h={240} />
        <Hotspot section="birthdays"    x={1594} y={680} w={290}  h={240} />
        <Hotspot section="ticker"       x={0}    y={970} w={1920} h={110} />
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

// Matches scratch/design/animated-cafeteria-elementary.html exactly.
// Pixel sizes only — scaled by the transform wrapper above.
const CSS_CAFE = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Permanent+Marker&display=swap');

.cafe-stage {
  position: relative;
  font-family: 'Fredoka', ui-rounded, sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 100%, #fbbf24 0%, transparent 55%),
    radial-gradient(ellipse at 0% 0%, #ec4899 0%, transparent 45%),
    radial-gradient(ellipse at 100% 0%, #06b6d4 0%, transparent 45%),
    linear-gradient(180deg, #fce7f3 0%, #ffe4e6 35%, #fef3c7 75%, #fed7aa 100%);
  overflow: hidden;
}

.cafe-ground {
  position: absolute; left: 0; right: 0; bottom: 110px; height: 160px;
  background:
    repeating-linear-gradient(90deg,
      transparent 0 60px, rgba(31,41,55,.25) 60px 100px, transparent 100px 160px),
    linear-gradient(180deg, #64748b 0%, #334155 100%);
  border-top: 4px solid #1f2937;
  box-shadow: 0 -8px 20px rgba(0,0,0,.2);
  z-index: 1;
}

.cafe-lights { position: absolute; top: 24px; left: 0; right: 0; height: 60px; pointer-events: none; z-index: 2; }
.cafe-wire { position: absolute; top: 30%; left: 0; right: 0; height: 3px; background: #1f2937; border-radius: 2px; }
.cafe-bulb {
  position: absolute; top: 26%; width: 22px; height: 30px;
  border-radius: 50% 50% 40% 40%;
  animation: cafe-blink 3s ease-in-out infinite;
}
.cafe-bulb::before {
  content: ''; position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
  width: 6px; height: 8px; background: #374151; border-radius: 2px 2px 0 0;
}
.cafe-bulb.y { background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #d97706); box-shadow: 0 0 18px #fbbf24; }
.cafe-bulb.p { background: radial-gradient(circle at 30% 30%, #fecaca, #ec4899 70%, #9d174d); box-shadow: 0 0 18px #ec4899; animation-delay: .5s; }
.cafe-bulb.c { background: radial-gradient(circle at 30% 30%, #bfdbfe, #06b6d4 70%, #0e7490); box-shadow: 0 0 18px #06b6d4; animation-delay: 1s; }
@keyframes cafe-blink { 0%, 100% { opacity: 1; } 48%, 52% { opacity: .45; } }

.cafe-floater { position: absolute; font-size: 56px; opacity: .55; z-index: 1; animation: cafe-drift 24s linear infinite; filter: drop-shadow(0 3px 5px rgba(0,0,0,.2)); }
.cafe-floater.a { top: 12%;  left: -10%; animation-delay: 0s; }
.cafe-floater.b { top: 28%; left: -10%; animation-delay: -8s; font-size: 48px; }
.cafe-floater.c { top: 36%; left: -10%; animation-delay: -14s; font-size: 54px; }
.cafe-floater.d { top: 48%; left: -10%; animation-delay: -3s; font-size: 50px; }
@keyframes cafe-drift { from { transform: translateX(0) rotate(0); } to { transform: translateX(120vw) rotate(360deg); } }

.cafe-header {
  position: absolute; top: 110px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 260px 1fr 220px;
  gap: 36px; z-index: 5; align-items: center;
}

/* Food truck */
.cafe-truck { position: relative; width: 260px; height: 180px; animation: cafe-truckBounce 2.2s ease-in-out infinite; }
@keyframes cafe-truckBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.cafe-cab {
  position: absolute; top: 36px; left: 8px; width: 74px; height: 90px;
  background: linear-gradient(180deg, #ec4899, #9d174d);
  border: 4px solid #1f2937; border-radius: 16px 6px 6px 6px;
  box-shadow: 0 8px 14px rgba(0,0,0,.3);
}
.cafe-cab::before { content: ''; position: absolute; top: 8px; left: 8px; right: 8px; height: 36px; background: linear-gradient(135deg, #dbeafe, #93c5fd); border-radius: 4px; }
.cafe-cab::after { content: '😊'; position: absolute; top: 12px; left: 8px; right: 8px; font-size: 26px; text-align: center; line-height: 28px; }
.cafe-body {
  position: absolute; top: 14px; left: 72px; right: 8px; height: 112px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border: 4px solid #1f2937; border-radius: 6px 20px 6px 6px;
  box-shadow: 0 8px 14px rgba(0,0,0,.3);
}
.cafe-window {
  position: absolute; top: 18px; left: 16px; right: 16px; height: 62px;
  background: #1f2937; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Bungee', cursive; font-size: 34px;
  color: #fef3c7; text-shadow: 2px 2px 0 #ec4899;
  letter-spacing: .06em;
}
.cafe-awn {
  position: absolute; top: 0; left: 72px; right: 8px; height: 20px;
  background: repeating-linear-gradient(90deg, #dc2626 0 14px, #fef3c7 14px 28px);
  border: 3px solid #1f2937; border-bottom: none;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 96% 40%, 92% 100%, 88% 40%, 84% 100%, 80% 40%, 76% 100%, 72% 40%, 68% 100%, 64% 40%, 60% 100%, 56% 40%, 52% 100%, 48% 40%, 44% 100%, 40% 40%, 36% 100%, 32% 40%, 28% 100%, 24% 40%, 20% 100%, 16% 40%, 12% 100%, 8% 40%, 4% 100%, 0 40%);
}
.cafe-wheel { position: absolute; bottom: 4px; width: 38px; height: 38px; background: radial-gradient(circle at 40% 40%, #94a3b8 0%, #1f2937 70%); border-radius: 50%; border: 4px solid #111827; animation: cafe-wheel 2s linear infinite; }
.cafe-wheel.l { left: 28px; }
.cafe-wheel.r { right: 44px; }
@keyframes cafe-wheel { to { transform: rotate(360deg); } }

/* Title */
.cafe-title {
  position: relative; text-align: center;
  background: linear-gradient(180deg, #fef3c7, #fbbf24);
  border: 6px solid #1f2937; border-radius: 20px;
  padding: 18px 40px;
  box-shadow: 0 0 0 4px #fef3c7, 0 0 0 10px #ec4899, 0 16px 28px rgba(0,0,0,.22);
  animation: cafe-sign 4s ease-in-out infinite;
}
@keyframes cafe-sign { 0%, 100% { transform: rotate(-1deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-4px); } }
.cafe-title h1 {
  margin: 0; line-height: .95;
  font-family: 'Bungee', cursive; font-size: 84px; color: #dc2626;
  text-shadow: 3px 3px 0 #1f2937, 5px 5px 0 #fbbf24;
  letter-spacing: .03em;
}
.cafe-sub { font-family: 'Permanent Marker', cursive; font-size: 30px; color: #7c2d12; margin-top: 2px; }
.cafe-star { position: absolute; font-size: 32px; animation: cafe-twinkle 1.4s ease-in-out infinite; }
.cafe-star.s1 { top: -10px; left: 10%; }
.cafe-star.s2 { top: -10px; right: 10%; animation-delay: .3s; }
.cafe-star.s3 { bottom: -14px; left: 20%; animation-delay: .6s; }
.cafe-star.s4 { bottom: -14px; right: 20%; animation-delay: .9s; }
@keyframes cafe-twinkle {
  0%, 100% { opacity: .4; transform: scale(.9) rotate(-10deg); }
  50%      { opacity: 1;  transform: scale(1.15) rotate(15deg); }
}

/* Clock */
.cafe-clock {
  position: relative; width: 180px; height: 180px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #fff, #fef3c7 70%);
  border: 8px solid #1f2937; border-radius: 50%;
  box-shadow: 0 12px 24px rgba(0,0,0,.28), inset 0 0 20px rgba(251,191,36,.3);
  animation: cafe-clockBob 3.6s ease-in-out infinite;
}
@keyframes cafe-clockBob { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.cafe-clockT { font-family: 'Bungee', cursive; font-size: 56px; line-height: 1; color: #dc2626; text-shadow: 2px 2px 0 rgba(0,0,0,.12); }
.cafe-clockAp { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 22px; color: #7c2d12; letter-spacing: .15em; }

/* Grid */
.cafe-grid {
  position: absolute; top: 330px; left: 36px; right: 36px; bottom: 140px;
  display: grid; grid-template-columns: 290px 1fr 290px;
  grid-template-rows: 1fr 1fr; gap: 24px; z-index: 3;
}

/* Today's Special */
.cafe-special { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 10px; position: relative; }
.cafe-string { width: 2px; height: 28px; background: #1f2937; border-radius: 1px; }
.cafe-tag {
  position: relative;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 4px solid #1f2937;
  clip-path: polygon(0 50%, 12% 0, 100% 0, 100% 100%, 12% 100%);
  padding: 22px 26px 22px 48px; text-align: center;
  box-shadow: 0 8px 18px rgba(0,0,0,.3);
  animation: cafe-tagSwing 3.6s ease-in-out infinite;
  transform-origin: 10% 0; min-width: 240px;
}
@keyframes cafe-tagSwing { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.cafe-tag::before { content: ''; position: absolute; left: 22px; top: 50%; transform: translateY(-50%); width: 10px; height: 10px; border-radius: 50%; background: #1f2937; }
.cafe-tagEmoji { font-size: 100px; line-height: 1; display: block; filter: drop-shadow(0 4px 6px rgba(0,0,0,.3)); }
.cafe-tagLbl { font-family: 'Bungee', cursive; font-size: 18px; color: #dc2626; letter-spacing: .12em; margin-top: 4px; }
.cafe-tagName { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 26px; color: #7c2d12; line-height: 1.05; margin-top: 2px; }

/* Menu */
.cafe-menu {
  grid-column: 2; grid-row: 1 / span 2;
  position: relative;
  background: #fafafa;
  border: 6px solid #1f2937;
  border-radius: 18px;
  box-shadow: 0 16px 30px rgba(0,0,0,.25), 10px 10px 0 #ec4899, 14px 14px 0 #1f2937;
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: cafe-menuFloat 5.4s ease-in-out infinite;
}
@keyframes cafe-menuFloat { 0%, 100% { transform: rotate(-.5deg) translateY(0); } 50% { transform: rotate(.5deg) translateY(-5px); } }
.cafe-menuAwning {
  flex: 0 0 auto; height: 36px;
  background: repeating-linear-gradient(90deg, #dc2626 0 28px, #fef3c7 28px 56px);
  border-bottom: 4px solid #1f2937;
  clip-path: polygon(0 0, 100% 0, 100% 50%, 96% 100%, 92% 50%, 88% 100%, 84% 50%, 80% 100%, 76% 50%, 72% 100%, 68% 50%, 64% 100%, 60% 50%, 56% 100%, 52% 50%, 48% 100%, 44% 50%, 40% 100%, 36% 50%, 32% 100%, 28% 50%, 24% 100%, 20% 50%, 16% 100%, 12% 50%, 8% 100%, 4% 50%, 0 100%);
}
.cafe-menuBody { flex: 1; padding: 18px 38px 22px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.cafe-menu h2 {
  margin: 0; line-height: 1;
  font-family: 'Bungee', cursive; font-size: 48px; text-align: center;
  background: linear-gradient(135deg, #dc2626, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.cafe-date { text-align: center; font-family: 'Permanent Marker', cursive; font-size: 22px; color: #9d174d; margin-top: -2px; margin-bottom: 6px; transform: rotate(-1deg); }

.cafe-dayTabs { display: flex; justify-content: center; gap: 6px; margin-bottom: 12px; }
.cafe-day {
  font-family: 'Bungee', cursive; font-size: 18px; padding: 6px 14px;
  border: 3px solid #1f2937; border-radius: 10px;
  background: #fef3c7; color: #92400e;
  box-shadow: 2px 2px 0 #1f2937; letter-spacing: .06em;
}
.cafe-day-today {
  background: linear-gradient(135deg, #dc2626, #f59e0b); color: #fff;
  transform: translateY(-2px);
  box-shadow: 2px 4px 0 #1f2937, 0 0 0 3px #fbbf24;
  text-shadow: 1px 1px 0 rgba(0,0,0,.2);
}

.cafe-items {
  display: flex; flex-direction: column; gap: clamp(4px, 1.5%, 10px);
  flex: 1 1 0; min-height: 0; overflow: hidden;
  padding-right: 2px;
}
.cafe-item {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: clamp(12px, 3cqh + 10px, 22px);
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 3px solid #1f2937; border-radius: 14px;
  padding: clamp(6px, 10cqh, 16px) clamp(16px, 4cqh + 14px, 26px);
  box-shadow: 4px 4px 0 #1f2937;
  overflow: hidden;
}
.cafe-itemEmoji {
  font-size: clamp(36px, 70cqh, 80px); line-height: 1; flex: 0 0 auto;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.2));
  display: inline-flex; align-items: center; justify-content: center;
  /* Box the emoji AND uploaded image so they occupy the same slot */
  width: clamp(40px, 80cqh, 90px); height: clamp(40px, 80cqh, 90px);
}
/* Uploaded image variant — fills the emoji slot, contain so aspect
   is preserved. Little photo look: rounded corners + subtle border. */
.cafe-itemImg {
  width: 100%; height: 100%; object-fit: contain;
  border-radius: 8px;
}
.cafe-itemInfo { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.cafe-itemName {
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  font-size: clamp(20px, 38cqh, 42px);
  color: #1f2937; line-height: 1.1;
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
}
.cafe-itemMeta {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(18px, 28cqh, 32px);
  color: #b91c1c; margin-top: clamp(2px, 2.5cqh, 6px);
  line-height: 1.1; letter-spacing: .02em;
}
.cafe-leader {
  flex: 1 1 0; min-width: 12px; height: 0;
  border-bottom: 3px dotted rgba(220, 38, 38, .55);
  align-self: center; margin: 0 4px;
  transform: translateY(calc(-1 * clamp(5px, 10cqh, 12px)));
}
.cafe-itemPrice {
  font-family: 'Bungee', cursive;
  font-size: clamp(20px, 34cqh, 38px);
  color: #dc2626; flex: 0 0 auto; line-height: 1;
}

/* Countdown */
.cafe-countdown { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; position: relative; }
.cafe-burst { position: relative; width: 240px; height: 240px; animation: cafe-burst 14s linear infinite; }
@keyframes cafe-burst { to { transform: rotate(360deg); } }
.cafe-rays {
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
  border: 5px solid #1f2937;
  filter: drop-shadow(0 10px 18px rgba(0,0,0,.3));
}
.cafe-burstCenter {
  position: absolute; inset: 30px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff, #fef3c7 70%);
  border: 5px solid #1f2937;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  animation: cafe-burstCounter 14s linear infinite reverse;
  padding: 14px;
}
.cafe-cdIcon { font-size: 44px; line-height: 1; margin-bottom: 2px; }
.cafe-cdLbl { font-family: 'Bungee', cursive; font-size: 14px; color: #9d174d; letter-spacing: .12em; text-transform: uppercase; max-width: 140px; line-height: 1.1; }
.cafe-cdNum { font-family: 'Bungee', cursive; font-size: 66px; line-height: .9; color: #dc2626; text-shadow: 2px 2px 0 rgba(0,0,0,.15); margin: 2px 0; }
.cafe-cdUnit { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 16px; color: #1f2937; letter-spacing: .15em; }

/* Chef */
.cafe-chef { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 8px; }
.cafe-chefCard {
  position: relative;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 5px solid #1f2937; border-radius: 16px;
  padding: 14px 12px 12px; width: 240px;
  box-shadow: 0 10px 22px rgba(0,0,0,.28), 6px 6px 0 #ec4899;
  transform: rotate(-3deg);
  animation: cafe-chefSway 6s ease-in-out infinite;
}
@keyframes cafe-chefSway { 0%, 100% { transform: rotate(-3deg) translateY(0); } 50% { transform: rotate(-1deg) translateY(-4px); } }
.cafe-chefFace {
  width: 100%; aspect-ratio: 1.15;
  background: radial-gradient(circle at 50% 40%, #fef3c7, #fbbf24 70%);
  border: 4px solid #1f2937; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 120px; line-height: 1;
  overflow: hidden;
}
.cafe-chefPhoto { width: 100%; height: 100%; object-fit: cover; }
.cafe-chefName { font-family: 'Bungee', cursive; font-size: 24px; color: #7c2d12; margin-top: 8px; line-height: 1; text-align: center; }
.cafe-chefRole { font-family: 'Permanent Marker', cursive; font-size: 18px; color: #9d174d; margin-top: 2px; line-height: 1; text-align: center; }

/* Birthdays */
.cafe-birthdays { grid-column: 3; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 8px; text-align: center; }
.cafe-ring {
  position: relative; width: 160px; height: 160px;
  display: flex; align-items: center; justify-content: center;
  animation: cafe-ringSpin 16s linear infinite;
}
@keyframes cafe-ringSpin { to { transform: rotate(360deg); } }
.cafe-ring::before {
  content: ''; position: absolute; inset: -18px; border-radius: 50%;
  background:
    radial-gradient(circle at 50% 0, #ec4899 0 8px, transparent 9px),
    radial-gradient(circle at 100% 50%, #06b6d4 0 8px, transparent 9px),
    radial-gradient(circle at 50% 100%, #fbbf24 0 8px, transparent 9px),
    radial-gradient(circle at 0 50%, #10b981 0 8px, transparent 9px),
    radial-gradient(circle at 15% 15%, #a78bfa 0 6px, transparent 7px),
    radial-gradient(circle at 85% 15%, #f43f5e 0 6px, transparent 7px),
    radial-gradient(circle at 85% 85%, #f97316 0 6px, transparent 7px),
    radial-gradient(circle at 15% 85%, #3b82f6 0 6px, transparent 7px);
}
.cafe-cake { font-size: 100px; line-height: 1; filter: drop-shadow(0 5px 9px rgba(0,0,0,.3)); animation: cafe-cakeSpin 16s linear infinite reverse; }
@keyframes cafe-cakeSpin { to { transform: rotate(-360deg); } }
.cafe-bdLbl {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 18px;
  color: #dc2626; letter-spacing: .18em; text-transform: uppercase;
  margin-top: 10px; text-shadow: 2px 2px 0 #fef3c7;
}
.cafe-bdNames {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px;
  color: #1f2937; margin-top: 2px; line-height: 1;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Ticker */
.cafe-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: #fafafa;
  display: flex; flex-direction: column;
  z-index: 6;
  box-shadow: 0 -6px 18px rgba(0,0,0,.18);
}
.cafe-ticker::before {
  content: ''; display: block; height: 24px; flex: 0 0 auto;
  background: repeating-linear-gradient(90deg, #dc2626 0 24px, #fef3c7 24px 48px);
  border-bottom: 3px solid #1f2937;
  clip-path: polygon(0 0, 100% 0, 100% 55%, 96% 100%, 92% 55%, 88% 100%, 84% 55%, 80% 100%, 76% 55%, 72% 100%, 68% 55%, 64% 100%, 60% 55%, 56% 100%, 52% 55%, 48% 100%, 44% 55%, 40% 100%, 36% 55%, 32% 100%, 28% 55%, 24% 100%, 20% 55%, 16% 100%, 12% 55%, 8% 100%, 4% 55%, 0 100%);
}
.cafe-tickerBar { flex: 1; display: flex; align-items: center; overflow: hidden; background: linear-gradient(180deg, #fafafa 0%, #fde68a 100%); }
.cafe-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #9d174d);
  color: #fef3c7; display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 28px;
  text-shadow: 1px 1px 0 #1f2937;
}
.cafe-tickerScroll { flex: 1; overflow: hidden; }
.cafe-tickerText {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 34px;
  color: #1f2937; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: cafe-tickerScroll 44s linear infinite;
}
@keyframes cafe-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
