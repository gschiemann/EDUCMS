"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// Vertical re-flow of BulletinCafeteriaWidget. Cork-board cafeteria menu.
// Stage is fixed 2160×3840 wrapped in a transform:scale shell that
// measures its parent. Same Cfg shape as the landscape widget so the
// auto-form editor and weekday-aware menu pick all keep working.
//
// Regions (top-to-bottom):
//   ~700px  cork-board header — pinned banner "TODAY'S LUNCH" with washi-tape corners + day badge + clock pin
//   ~1100px pinned plate polaroid hero — full-width tilted polaroid + caption strip + push-pin top-center
//   ~1400px 2x3 grid of index cards — push pin top, handwritten name + meta + allergen badges
//   ~400px  chef's memo card — yellow lined paper + signed initials
//   ~240px  allergen ticker on bottom strip with handwritten "ALLERGENS:" label

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
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;

  // Today's special — big polaroid-style photo card
  photoEmoji?: string;           // URL or emoji
  photoCaption?: string;
  photoStamp?: string;

  // Index cards
  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];

  // Memo (yellow sticky)
  memoMessage?: string;

  // Countdown ticket
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;

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

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function BulletinCafeteriaPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'PM';

  const today = now.getDay();
  const dayLabel = DAY_NAMES[today];
  const dateNum = now.getDate();

  const menuItems: MenuItem[] = useMemo(() => {
    const picked = pickMenuForToday(c.weekMenu, today);
    if (picked && picked.length > 0) return picked;
    if (Array.isArray(c.menuItems) && c.menuItems.length > 0) return c.menuItems;
    return [
      { emoji: '🥗', name: 'Chef Salad', meta: 'romaine, grilled chicken, cheese, ranch', price: 'GF · DAIRY' },
      { emoji: '🥕', name: 'Roasted Veggies', meta: 'carrots, zucchini, peppers, sea salt', price: 'VEGAN · GF' },
      { emoji: '🍉', name: 'Fruit Cup', meta: 'watermelon, pineapple, summer berries', price: 'VEGAN · GF' },
      { emoji: '🍝', name: 'Pasta Marinara', meta: 'whole-grain penne, basil, parmesan', price: 'VEG · DAIRY' },
      { emoji: '🥪', name: 'Turkey Sub', meta: 'whole grain bun, lettuce, tomato', price: 'GLUTEN · DAIRY' },
      { emoji: '🍪', name: "Baker's Cookie", meta: 'fresh-baked oatmeal raisin', price: 'GLUTEN · DAIRY · EGG' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list;
    return [
      'gluten 🌾',
      'nuts 🥜',
      'dairy 🧀',
      'egg 🥚',
      'soy 🌱',
      'questions? ask the kitchen — we keep printed allergen cards at the line',
    ];
  }, [c.tickerMessages]);

  const photo = c.photoEmoji || '🍝';
  const isPhotoUrl = /^(https?:\/\/|\/|data:image\/)/.test(photo);
  const logo = c.logoEmoji || '🍎';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1c0e02',
      }}
    >
      <style>{CSS_CORK_PORTRAIT}</style>

      <div
        className="bcp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="bcp-frame" />

        {/* HEADER — pinned banner with washi tape + day badge + clock */}
        <div className="bcp-header">
          {/* washi tape corners */}
          <div className="bcp-washi tl" />
          <div className="bcp-washi tr" />

          <div className="bcp-headerInner">
            <div className="bcp-logoCircle">{logo}</div>

            <div className="bcp-titleBlock">
              <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>
                {(c.title || "TODAY'S LUNCH").toUpperCase()}
              </h1>
              <div className="bcp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
                {c.subtitle || "~ what's cooking in the kitchen ~"}
              </div>
            </div>

            <div className="bcp-dayBadge">
              <div className="bcp-dayName">{dayLabel}</div>
              <div className="bcp-dayNum">{dateNum}</div>
            </div>
          </div>

          {/* clock pin (acts like an index card pinned to the right) */}
          <div className="bcp-clockPin">
            <div className="bcp-clockT">{hh}:{mm}</div>
            <div className="bcp-clockAp">{ampm}</div>
            <div className="bcp-pin blue" style={{ top: -16, left: '50%', transform: 'translateX(-50%)' }} />
          </div>
        </div>

        {/* PLATE POLAROID HERO */}
        <div className="bcp-photo">
          <div className="bcp-photoStamp" data-field="photoStamp" style={{ whiteSpace: 'pre-wrap' }}>
            {(c.photoStamp || '~ TODAY IN THE KITCHEN ~').toUpperCase()}
          </div>
          <div className="bcp-img">
            {isPhotoUrl
              ? <img src={photo} alt="" className="bcp-imgImg" />
              : <span className="bcp-imgEmoji">{photo}</span>}
          </div>
          <div className="bcp-photoCaption" data-field="photoCaption" style={{ whiteSpace: 'pre-wrap' }}>
            — {c.photoCaption || 'served fresh today'} —
          </div>
          <div className="bcp-pin yellow" style={{ top: -18, left: '50%', transform: 'translateX(-50%)' }} />
        </div>

        {/* INDEX CARD GRID — 2 cols × 3 rows */}
        <div className="bcp-cards">
          {menuItems.slice(0, 6).map((it, i) => {
            // alternating tilts, alternating pin colors
            const rotPattern = [-1.4, 1.2, -1.0, 1.6, -1.6, 1.0];
            const rot = rotPattern[i] || 0;
            const pinColors = ['', 'green', 'yellow', 'blue', 'green', ''];
            const pinSide = i % 2 === 0 ? { top: -16, left: 30 } : { top: -16, right: 30 };
            const badges = (it.price || '').split(/[·•,]+/).map(s => s.trim()).filter(Boolean);
            return (
              <div key={i} className="bcp-card" style={{ transform: `rotate(${rot}deg)` }}>
                {it.emoji && <div className="bcp-cardEmoji">{it.emoji}</div>}
                <div className="bcp-cardTitle">{it.name || ''}</div>
                {it.meta && <div className="bcp-cardDesc">{it.meta}</div>}
                {badges.length > 0 && (
                  <div className="bcp-cardBadges">
                    {badges.map((b, j) => {
                      const cls = /vegan|veg/i.test(b) ? 'v'
                        : /gf|gluten/i.test(b) ? 'gf'
                        : /dairy/i.test(b) ? 'dy'
                        : /egg/i.test(b) ? 'eg'
                        : /nut/i.test(b) ? 'nt'
                        : '';
                      return <span key={j} className={`bcp-badge ${cls}`}>{b}</span>;
                    })}
                  </div>
                )}
                <div className={`bcp-pin ${pinColors[i] || ''}`} style={pinSide} />
              </div>
            );
          })}
        </div>

        {/* CHEF'S MEMO — yellow lined paper */}
        <div className="bcp-memo">
          <div className="bcp-memoStamp">CHEF'S MEMO</div>
          <div className="bcp-memoMsg" data-field="memoMessage" style={{ whiteSpace: 'pre-wrap' }}>
            {c.memoMessage || 'Pizza Friday is BACK! Cheese + pepperoni in line 2.'}
          </div>
          <div className="bcp-memoSig">— Chef · 🍳</div>
          <div className="bcp-pin" style={{ top: -16, left: 80 }} />
          <div className="bcp-pin yellow" style={{ top: -16, right: 80 }} />
          {/* tape strip across the top edge */}
          <div className="bcp-memoTape" />
        </div>

        {/* ALLERGEN TICKER — bottom strip */}
        <div className="bcp-ticker">
          <div className="bcp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>
            {(c.tickerStamp || 'ALLERGENS').toUpperCase()}:
          </div>
          <div className="bcp-tickerScroll">
            <span
              className="bcp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 70)}s` }}
            >
              {tickerText.map((m, i) => (
                <span key={i}>{m}{i < tickerText.length - 1 && <span className="bcp-tickerSep"> · </span>}</span>
              ))}
            </span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"  x={80}  y={120}  w={2000} h={620} />
            <Hotspot section="photo"   x={120} y={780}  w={1920} h={1040} />
            <Hotspot section="menu"    x={80}  y={1860} w={2000} h={1340} />
            <Hotspot section="special" x={80}  y={3220} w={2000} h={380} />
            <Hotspot section="ticker"  x={14}  y={3640} w={2132} h={186} />
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

const CSS_CORK_PORTRAIT = `
@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Caveat:wght@500;700&family=Indie+Flower&family=Special+Elite&family=Kalam:wght@400;700&display=swap');

.bcp-stage {
  position: relative; overflow: hidden;
  background-color: #c08457;
  background-image:
    radial-gradient(circle at 8% 6%,   #a56a3e 0 8px, transparent 10px),
    radial-gradient(circle at 18% 14%, #c79268 0 6px, transparent 8px),
    radial-gradient(circle at 32% 9%,  #8e5828 0 10px, transparent 12px),
    radial-gradient(circle at 47% 18%, #b07442 0 6px, transparent 8px),
    radial-gradient(circle at 62% 11%, #d6a072 0 8px, transparent 10px),
    radial-gradient(circle at 78% 16%, #a56a3e 0 7px, transparent 9px),
    radial-gradient(circle at 91% 7%,  #8e5828 0 9px, transparent 11px),
    radial-gradient(circle at 12% 32%, #c79268 0 6px, transparent 8px),
    radial-gradient(circle at 28% 38%, #a56a3e 0 7px, transparent 9px),
    radial-gradient(circle at 41% 28%, #8e5828 0 9px, transparent 11px),
    radial-gradient(circle at 58% 36%, #d6a072 0 6px, transparent 8px),
    radial-gradient(circle at 74% 31%, #b07442 0 8px, transparent 10px),
    radial-gradient(circle at 92% 38%, #a56a3e 0 7px, transparent 9px),
    radial-gradient(circle at 7%  56%, #8e5828 0 9px, transparent 11px),
    radial-gradient(circle at 24% 62%, #c79268 0 6px, transparent 8px),
    radial-gradient(circle at 38% 51%, #d6a072 0 8px, transparent 10px),
    radial-gradient(circle at 54% 60%, #a56a3e 0 7px, transparent 9px),
    radial-gradient(circle at 71% 53%, #b07442 0 9px, transparent 11px),
    radial-gradient(circle at 88% 62%, #c79268 0 6px, transparent 8px),
    radial-gradient(circle at 11% 78%, #8e5828 0 8px, transparent 10px),
    radial-gradient(circle at 27% 84%, #a56a3e 0 7px, transparent 9px),
    radial-gradient(circle at 44% 76%, #d6a072 0 9px, transparent 11px),
    radial-gradient(circle at 62% 86%, #b07442 0 6px, transparent 8px),
    radial-gradient(circle at 81% 81%, #c79268 0 8px, transparent 10px),
    radial-gradient(circle at 94% 89%, #8e5828 0 7px, transparent 9px),
    repeating-radial-gradient(circle at 50% 50%, #a56a3e 0 1px, transparent 2px 7px),
    linear-gradient(135deg, #c79268 0%, #b07442 50%, #a56a3e 100%);
  color: #2a1808; font-family: 'Indie Flower', cursive;
}

.bcp-frame {
  position: absolute; inset: 28px;
  border: 38px solid;
  border-image: linear-gradient(135deg, #6b3a14 0%, #8b5a2b 30%, #5a3010 70%, #3d2010 100%) 1;
  box-shadow: inset 0 0 0 6px rgba(0,0,0,.3), 0 14px 44px rgba(0,0,0,.4);
  pointer-events: none;
}

.bcp-pin {
  position: absolute; width: 44px; height: 44px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #ff8a8a, #c0392b 60%, #5a0e0e);
  box-shadow: 0 6px 8px rgba(0,0,0,.55), inset -3px -3px 5px rgba(0,0,0,.3), inset 3px 3px 5px rgba(255,255,255,.4);
  z-index: 5;
  animation: bcp-pinSway 6s ease-in-out infinite;
}
.bcp-pin.blue   { background: radial-gradient(circle at 30% 30%, #93c5fd, #1d4ed8 60%, #0c1f5a); }
.bcp-pin.green  { background: radial-gradient(circle at 30% 30%, #86efac, #15803d 60%, #0c3a1a); }
.bcp-pin.yellow { background: radial-gradient(circle at 30% 30%, #fde68a, #d97706 60%, #4a2a08); }
@keyframes bcp-pinSway {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(2deg); }
}

/* HEADER */
.bcp-header {
  position: absolute; top: 120px; left: 80px; right: 80px; height: 620px;
  z-index: 4;
}
.bcp-headerInner {
  background: #fff;
  box-shadow: 0 14px 36px rgba(0,0,0,.45);
  border: 1px solid #cbd5e1;
  transform: rotate(-.6deg);
  position: absolute; top: 30px; left: 0; right: 360px; bottom: 0;
  padding: 36px 60px 30px;
  display: grid; grid-template-columns: 200px 1fr 220px;
  align-items: center; gap: 36px;
}
.bcp-washi {
  position: absolute; width: 220px; height: 56px;
  background: repeating-linear-gradient(
    -45deg,
    #fcd34d 0 14px,
    #f59e0b 14px 28px,
    #fef3c7 28px 42px
  );
  opacity: .92;
  box-shadow: 0 4px 8px rgba(0,0,0,.25);
  z-index: 6;
}
.bcp-washi.tl { top: 0; left: 24px; transform: rotate(-6deg); }
.bcp-washi.tr { top: -10px; right: 380px; transform: rotate(7deg); }

.bcp-logoCircle {
  width: 200px; height: 200px; border-radius: 50%;
  background: #fef3c7; border: 9px solid #d97706;
  display: flex; align-items: center; justify-content: center; font-size: 110px;
  box-shadow: inset 0 -6px 0 rgba(0,0,0,.08);
}
.bcp-titleBlock { text-align: center; }
.bcp-titleBlock h1 {
  font-family: 'Permanent Marker', cursive;
  font-size: 158px; line-height: .95; margin: 0;
  color: #b91c1c; letter-spacing: .03em;
  text-shadow: 5px 5px 0 rgba(0,0,0,.06);
}
.bcp-sub {
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 60px; color: #44403c; margin-top: 12px;
}

.bcp-dayBadge {
  background: #fef3c7;
  border: 6px solid #b91c1c;
  border-radius: 18px;
  padding: 18px 14px 14px;
  text-align: center;
  transform: rotate(3deg);
  box-shadow: 0 8px 18px rgba(0,0,0,.35);
}
.bcp-dayName {
  font-family: 'Special Elite', monospace;
  font-size: 36px; letter-spacing: .25em;
  color: #b91c1c; line-height: 1;
}
.bcp-dayNum {
  font-family: 'Permanent Marker', cursive;
  font-size: 100px; line-height: 1;
  color: #1f2937; margin-top: 2px;
}

.bcp-clockPin {
  position: absolute; top: 0; right: 30px;
  width: 300px; height: 300px;
  background: #fffefa;
  border: 1px solid #cbd5e1;
  box-shadow: 0 14px 28px rgba(0,0,0,.45);
  transform: rotate(4deg);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background-image:
    repeating-linear-gradient(to bottom, transparent 0 56px, rgba(59,130,246,.18) 56px 58px);
}
.bcp-clockT {
  font-family: 'Special Elite', monospace;
  font-size: 96px; line-height: 1; color: #1f2937;
}
.bcp-clockAp {
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 44px; color: #57534e; margin-top: 8px;
}

/* PLATE POLAROID HERO */
.bcp-photo {
  position: absolute; top: 800px; left: 120px; right: 120px; height: 1020px;
  background: #fff; padding: 36px 36px 30px;
  box-shadow: 0 26px 56px rgba(0,0,0,.5);
  transform: rotate(-1.8deg);
  display: flex; flex-direction: column;
  z-index: 3;
}
.bcp-photoStamp {
  position: absolute; top: -42px; left: 36px; right: 36px;
  font-family: 'Special Elite', monospace;
  font-size: 32px; letter-spacing: .25em; color: #fef3c7;
  background: #b91c1c; padding: 12px 24px; box-shadow: 0 4px 8px rgba(0,0,0,.3);
  text-align: center;
}
.bcp-img {
  flex: 1;
  background:
    radial-gradient(circle at 30% 35%, #fde68a 0 160px, transparent 160px),
    radial-gradient(circle at 65% 55%, #fca5a5 0 200px, transparent 200px),
    radial-gradient(circle at 50% 70%, #86efac 0 180px, transparent 180px),
    linear-gradient(135deg, #fef3c7, #fde68a 60%, #fcd34d);
  position: relative;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.bcp-imgEmoji {
  font-size: 560px; line-height: 1;
  filter: drop-shadow(0 14px 24px rgba(0,0,0,.2));
}
.bcp-imgImg { width: 100%; height: 100%; object-fit: cover; }
.bcp-photoCaption {
  margin-top: 22px;
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 64px; color: #44403c; text-align: center;
  line-height: 1.05;
}

/* INDEX CARD GRID — 2 cols × 3 rows */
.bcp-cards {
  position: absolute; top: 1900px; left: 80px; right: 80px; height: 1280px;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr;
  gap: 50px 60px;
  z-index: 3;
}
.bcp-card {
  background: #fffefa; padding: 36px 36px 32px;
  box-shadow: 0 14px 28px rgba(0,0,0,.4);
  background-image:
    linear-gradient(to right, transparent 56px, rgba(220,38,38,.3) 56px 58px, transparent 58px),
    repeating-linear-gradient(to bottom, transparent 0 56px, rgba(59,130,246,.2) 56px 57px);
  background-position: 0 28px;
  display: flex; flex-direction: column; justify-content: center;
  position: relative;
}
.bcp-cardEmoji {
  position: absolute; top: 20px; right: 30px;
  font-size: 76px; line-height: 1;
}
.bcp-cardTitle {
  font-family: 'Permanent Marker', cursive;
  font-size: 64px; color: #1f2937; line-height: 1;
  margin-bottom: 14px; padding-left: 80px;
}
.bcp-cardDesc {
  font-family: 'Caveat', cursive; font-weight: 500;
  font-size: 42px; color: #44403c;
  margin: 8px 0 18px; padding-left: 80px;
  line-height: 1.2;
}
.bcp-cardBadges {
  display: flex; gap: 12px; padding-left: 80px; flex-wrap: wrap;
}
.bcp-badge {
  font-family: 'Special Elite', monospace;
  font-size: 22px; letter-spacing: .12em;
  padding: 8px 16px; background: #fef3c7; color: #78350f; border: 2px solid #d97706;
}
.bcp-badge.v  { background: #d1fae5; color: #065f46; border-color: #10b981; }
.bcp-badge.gf { background: #fef3c7; color: #92400e; border-color: #d97706; }
.bcp-badge.dy { background: #dbeafe; color: #1e40af; border-color: #2563eb; }
.bcp-badge.eg { background: #fef9c3; color: #713f12; border-color: #ca8a04; }
.bcp-badge.nt { background: #ffedd5; color: #7c2d12; border-color: #ea580c; }

/* CHEF'S MEMO */
.bcp-memo {
  position: absolute; top: 3240px; left: 80px; right: 80px; height: 360px;
  padding: 50px 60px 40px;
  background: #fef9c3;
  background-image:
    repeating-linear-gradient(to bottom, transparent 0 52px, rgba(202,138,4,.25) 52px 53px);
  background-position: 0 70px;
  box-shadow: 0 12px 24px rgba(0,0,0,.32);
  transform: rotate(-1deg);
  display: flex; flex-direction: column; justify-content: center;
  z-index: 4;
}
.bcp-memoStamp {
  position: absolute; top: 16px; left: 28px;
  font-family: 'Special Elite', monospace;
  font-size: 26px; letter-spacing: .25em; color: #92400e;
}
.bcp-memoTape {
  position: absolute; top: -18px; left: 50%; transform: translateX(-50%) rotate(-2deg);
  width: 280px; height: 50px;
  background: rgba(229, 231, 235, .75);
  box-shadow: 0 4px 8px rgba(0,0,0,.18);
  z-index: 6;
}
.bcp-memoMsg {
  font-family: 'Permanent Marker', cursive;
  font-size: 76px; color: #b91c1c; line-height: 1.05;
  margin-top: 8px;
}
.bcp-memoSig {
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 44px; color: #78350f;
  margin-top: 14px; text-align: right;
}

/* ALLERGEN TICKER */
.bcp-ticker {
  position: absolute; left: 28px; right: 28px; bottom: 28px; height: 130px;
  background: #fff;
  border-top: 8px solid #1f2937;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -6px 22px rgba(0,0,0,.2);
  z-index: 6;
}
.bcp-tickerStamp {
  flex: 0 0 auto; padding: 0 44px; height: 100%;
  background: #1f2937; color: #fef3c7; display: flex; align-items: center;
  font-family: 'Special Elite', monospace; letter-spacing: .25em; font-size: 32px;
}
.bcp-tickerScroll {
  flex: 1; overflow: hidden; position: relative; height: 100%;
  display: flex; align-items: center;
}
.bcp-tickerText {
  display: inline-block; white-space: nowrap;
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 64px; color: #44403c;
  padding-left: 100%;
  animation: bcp-tickerScroll 70s linear infinite;
}
.bcp-tickerSep { color: #b91c1c; padding: 0 32px; }
@keyframes bcp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot {
  outline: none;
  transition: box-shadow .15s ease, background-color .15s ease;
  border-radius: 12px;
}
.aw-hotspot:hover {
  background-color: rgba(185, 28, 28, .08);
  box-shadow: inset 0 0 0 4px rgba(185, 28, 28, .55);
}
.aw-hotspot:focus-visible {
  background-color: rgba(185, 28, 28, .14);
  box-shadow: inset 0 0 0 4px rgba(185, 28, 28, .85);
}
`;
