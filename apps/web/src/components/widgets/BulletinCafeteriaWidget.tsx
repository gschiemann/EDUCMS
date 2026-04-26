"use client";

// PORTED 2026-04-20 from scratch/design/bulletin-cafeteria.html — transform:scale pattern, isLive-gated hotspots.
// Cork-board metaphor: pinned index cards, washi tape accents, dashed rule memo, punched-ticket countdown.
// Ticker is pinned `position: absolute; bottom: 14px` inside the cork frame (recent fix), and the stage reserves
// padding-bottom: 140 so a 2-line MEMO paragraph can't crash into the ticker band.

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

export function BulletinCafeteriaWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
  const menuItems: MenuItem[] = useMemo(() => {
    const picked = pickMenuForToday(c.weekMenu, today);
    if (picked && picked.length > 0) return picked;
    if (Array.isArray(c.menuItems) && c.menuItems.length > 0) return c.menuItems;
    return [
      { emoji: '🥗', name: 'Chef Salad', meta: 'Romaine, grilled chicken, tomatoes, cheese, ranch.', price: 'GF · DAIRY' },
      { emoji: '🥕', name: 'Roasted Veggies', meta: 'Carrots, zucchini, peppers — olive oil, sea salt.', price: 'VEGAN · GF' },
      { emoji: '🍉', name: 'Fruit Cup', meta: 'Watermelon, pineapple, fresh summer berries.', price: 'VEGAN · GF' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 12;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = c.countdownUnit || 'days';

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list;
    return [
      'Eat the rainbow — fruits + veggies every day',
      'Drink water, stay hydrated',
      'Free + reduced meals — ask the office',
      'Pizza Friday is back — cheese + pepperoni in line 2',
      'Lunch Wave A 11:30, Wave B 12:05, Wave C 12:40',
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
      <style>{CSS_CORK}</style>

      <div
        className="bc-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="bc-frame" />

        <div className="bc-header">
          <div className="bc-logoCircle">{logo}</div>
          <div className="bc-titleBlock">
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || "TODAY'S MENU").toUpperCase()}</h1>
            <div className="bc-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || "~ what's cooking in the kitchen ~"}</div>
          </div>
          <div className="bc-clockBlock">
            <div className="bc-clockT">{hh}:{mm}</div>
            <div className="bc-clockAp">{ampm}</div>
          </div>
          <div className="bc-pin" style={{ top: -13, left: -13 }} />
          <div className="bc-pin blue" style={{ top: -13, right: -13 }} />
        </div>

        <div className="bc-photo">
          <div className="bc-photoStamp" data-field="photoStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.photoStamp || '~ TODAY IN THE KITCHEN ~').toUpperCase()}</div>
          <div className="bc-img">
            {isPhotoUrl ? <img src={photo} alt="" className="bc-imgImg" /> : <span className="bc-imgEmoji">{photo}</span>}
          </div>
          <div className="bc-photoCaption" data-field="photoCaption" style={{ whiteSpace: 'pre-wrap' }}>— {c.photoCaption || 'served fresh today'} —</div>
          <div className="bc-pin yellow" style={{ top: -13, left: '50%', transform: 'translateX(-50%)' }} />
        </div>

        <div className="bc-cards">
          {menuItems.slice(0, 3).map((it, i) => {
            const rot = [-1.2, 1.4, -1][i] || -1;
            const badges = (it.price || '').split(/[·•,]+/).map(s => s.trim()).filter(Boolean);
            const pinClass = ['', 'green', 'yellow'][i] || '';
            const pinSide = i === 1 ? { top: -13, right: 18 } : { top: -13, left: 18 };
            return (
              <div key={i} className="bc-card" style={{ transform: `rotate(${rot}deg)` }}>
                <div className="bc-cardTitle">{it.name || ''}</div>
                {it.meta && <div className="bc-cardDesc">{it.meta}</div>}
                {badges.length > 0 && (
                  <div className="bc-cardBadges">
                    {badges.map((b, j) => {
                      const cls = /vegan|veg/i.test(b) ? 'v' : /gf|gluten/i.test(b) ? 'gf' : /dairy/i.test(b) ? 'dy' : '';
                      return <span key={j} className={`bc-badge ${cls}`}>{b}</span>;
                    })}
                  </div>
                )}
                <div className={`bc-pin ${pinClass}`} style={pinSide} />
              </div>
            );
          })}
        </div>

        <div className="bc-memo">
          <div className="bc-memoMsg" data-field="memoMessage" style={{ whiteSpace: 'pre-wrap' }}>{c.memoMessage || 'Pizza Friday is BACK! Cheese + pepperoni in line 2.'}</div>
          <div className="bc-pin" style={{ top: -13, left: 18 }} />
          <div className="bc-pin yellow" style={{ top: -13, right: 18 }} />
        </div>

        <div className="bc-ticket">
          <div className="bc-ticketLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.countdownLabel || 'NEXT MEAL IN').toUpperCase()}</div>
          <div className="bc-ticketNum">{days}</div>
          <div className="bc-ticketUnit">{unit}</div>
          <div className="bc-pin blue" style={{ top: -13, left: '50%', transform: 'translateX(-50%)' }} />
        </div>

        <div className="bc-ticker">
          <div className="bc-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'FROM THE KITCHEN').toUpperCase()}</div>
          <div className="bc-tickerScroll">
            <span
              className="bc-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 50)}s` }}
            >
              {tickerText.map((m, i) => (
                <span key={i}>{m}{i < tickerText.length - 1 && <span className="bc-tickerSep"> · </span>}</span>
              ))}
            </span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={80}   y={56}  w={1760} h={150} />
            <Hotspot section="photo"     x={80}   y={238} w={1040} h={550} />
            <Hotspot section="menu"      x={1152} y={238} w={688}  h={550} />
            <Hotspot section="special"   x={80}   y={820} w={1040} h={120} />
            <Hotspot section="countdown" x={1152} y={820} w={688}  h={120} />
            <Hotspot section="ticker"    x={14}   y={986} w={1892} h={80} />
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

const CSS_CORK = `
@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Indie+Flower&family=Special+Elite&family=Kalam:wght@400;700&display=swap');

.bc-stage {
  position: relative; overflow: hidden;
  background-color: #b88251;
  background-image:
    radial-gradient(circle at 12% 18%, #a56a3e 0 4px, transparent 5px),
    radial-gradient(circle at 27% 41%, #c79268 0 3px, transparent 4px),
    radial-gradient(circle at 56% 12%, #8e5828 0 5px, transparent 6px),
    radial-gradient(circle at 78% 28%, #b07442 0 3px, transparent 4px),
    radial-gradient(circle at 22% 62%, #d6a072 0 4px, transparent 5px),
    radial-gradient(circle at 71% 71%, #8e5828 0 4px, transparent 5px),
    radial-gradient(circle at 41% 88%, #c79268 0 3px, transparent 4px),
    radial-gradient(circle at 86% 92%, #a56a3e 0 5px, transparent 6px),
    repeating-radial-gradient(circle at 50% 50%, #a56a3e 0 1px, transparent 2px 5px),
    linear-gradient(135deg, #c79268 0%, #b07442 50%, #a56a3e 100%);
  color: #2a1808; font-family: 'Indie Flower', cursive;
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 32px;
  padding: 56px 80px 140px;
}

.bc-frame {
  position: absolute; inset: 14px;
  border: 22px solid;
  border-image: linear-gradient(135deg, #6b3a14 0%, #8b5a2b 30%, #5a3010 70%, #3d2010 100%) 1;
  box-shadow: inset 0 0 0 3px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.4);
  pointer-events: none;
}

.bc-pin {
  position: absolute; width: 26px; height: 26px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #ff8a8a, #c0392b 60%, #5a0e0e);
  box-shadow: 0 4px 5px rgba(0,0,0,.55), inset -2px -2px 3px rgba(0,0,0,.3), inset 2px 2px 3px rgba(255,255,255,.4);
  z-index: 5;
}
.bc-pin.blue   { background: radial-gradient(circle at 30% 30%, #93c5fd, #1d4ed8 60%, #0c1f5a); }
.bc-pin.green  { background: radial-gradient(circle at 30% 30%, #86efac, #15803d 60%, #0c3a1a); }
.bc-pin.yellow { background: radial-gradient(circle at 30% 30%, #fde68a, #d97706 60%, #4a2a08); }

.bc-header {
  grid-column: 1 / -1;
  background: #fff;
  box-shadow: 0 8px 22px rgba(0,0,0,.45);
  border: 1px solid #cbd5e1;
  transform: rotate(-.4deg);
  display: grid; grid-template-columns: 110px 1fr 130px;
  align-items: center; padding: 18px 36px; gap: 24px;
  position: relative;
}
.bc-logoCircle {
  width: 110px; height: 110px; border-radius: 50%;
  background: #fef3c7; border: 5px solid #d97706;
  display: flex; align-items: center; justify-content: center; font-size: 56px;
  box-shadow: inset 0 -4px 0 rgba(0,0,0,.08);
}
.bc-titleBlock { text-align: center; }
.bc-titleBlock h1 { font-family: 'Permanent Marker', cursive; font-size: 76px; line-height: 1; margin: 0; color: #b91c1c; letter-spacing: .03em; }
.bc-sub { font-family: 'Indie Flower'; font-size: 30px; color: #44403c; margin-top: 4px; }
.bc-clockBlock { text-align: center; border-left: 2px dashed #94a3b8; padding-left: 18px; }
.bc-clockT { font-family: 'Special Elite'; font-size: 46px; line-height: 1; color: #1f2937; }
.bc-clockAp { font-family: 'Indie Flower'; font-size: 22px; color: #57534e; }

.bc-photo {
  background: #fff; padding: 20px 20px 18px;
  box-shadow: 0 12px 28px rgba(0,0,0,.45);
  transform: rotate(-1.5deg);
  position: relative;
  display: flex; flex-direction: column;
}
.bc-photoStamp {
  position: absolute; top: -28px; left: 16px; right: 16px;
  font-family: 'Special Elite'; font-size: 18px; letter-spacing: .25em; color: #fef3c7;
  background: #b91c1c; padding: 6px 14px; box-shadow: 0 2px 4px rgba(0,0,0,.3);
}
.bc-img {
  flex: 1;
  background:
    radial-gradient(circle at 30% 35%, #fde68a 0 80px, transparent 80px),
    radial-gradient(circle at 65% 55%, #fca5a5 0 100px, transparent 100px),
    radial-gradient(circle at 50% 70%, #86efac 0 90px, transparent 90px),
    linear-gradient(135deg, #fef3c7, #fde68a 60%, #fcd34d);
  position: relative;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.bc-imgEmoji { font-size: 280px; line-height: 1; filter: drop-shadow(0 8px 12px rgba(0,0,0,.2)); }
.bc-imgImg { width: 100%; height: 100%; object-fit: cover; }
.bc-photoCaption {
  margin-top: 12px;
  font-family: 'Indie Flower'; font-size: 32px; color: #44403c; text-align: center;
}

.bc-cards { display: flex; flex-direction: column; gap: 26px; }
.bc-card {
  background: #fffefa; padding: 16px 22px 18px;
  box-shadow: 0 8px 18px rgba(0,0,0,.4);
  background-image:
    linear-gradient(to right, transparent 36px, rgba(220,38,38,.3) 36px 38px, transparent 38px),
    repeating-linear-gradient(to bottom, transparent 0 36px, rgba(59,130,246,.2) 36px 37px);
  background-position: 0 14px;
  flex: 1;
  display: flex; flex-direction: column; justify-content: center;
  position: relative;
}
.bc-cardTitle { font-family: 'Permanent Marker', cursive; font-size: 42px; color: #1f2937; line-height: 1; margin-bottom: 6px; padding-left: 50px; }
.bc-cardDesc  { font-family: 'Indie Flower'; font-size: 26px; color: #44403c; margin: 6px 0 12px; padding-left: 50px; line-height: 1.25; }
.bc-cardBadges { display: flex; gap: 8px; padding-left: 50px; flex-wrap: wrap; }
.bc-badge {
  font-family: 'Special Elite'; font-size: 14px; letter-spacing: .12em;
  padding: 5px 12px; background: #fef3c7; color: #78350f; border: 1px solid #d97706;
}
.bc-badge.v  { background: #d1fae5; color: #065f46; border-color: #10b981; }
.bc-badge.gf { background: #fef3c7; color: #92400e; border-color: #d97706; }
.bc-badge.dy { background: #dbeafe; color: #1e40af; border-color: #2563eb; }

.bc-memo {
  grid-column: 1; padding: 22px 32px;
  background: #fef9c3;
  box-shadow: 0 6px 14px rgba(0,0,0,.3);
  transform: rotate(-1.2deg);
  position: relative;
  display: flex; flex-direction: column; justify-content: center;
}
.bc-memo::before {
  content: 'MEMO'; position: absolute; top: 10px; left: 18px;
  font-family: 'Special Elite'; font-size: 16px; letter-spacing: .25em; color: #92400e;
}
.bc-memo::after {
  content: ''; position: absolute; left: 0; right: 0; top: 38px; height: 2px;
  background: repeating-linear-gradient(90deg, #ca8a04 0 8px, transparent 8px 14px);
}
.bc-memoMsg { font-family: 'Permanent Marker', cursive; font-size: 48px; color: #b91c1c; line-height: 1.05; margin-top: 44px; }

.bc-ticket {
  grid-column: 2;
  background: #fff; padding: 18px 22px;
  box-shadow: 0 6px 14px rgba(0,0,0,.3);
  transform: rotate(2deg);
  text-align: center;
  border-left: 8px dashed #b91c1c;
  position: relative;
  display: flex; flex-direction: column; justify-content: center;
}
.bc-ticket::before, .bc-ticket::after {
  content: ''; position: absolute; top: 50%; width: 18px; height: 18px; border-radius: 50%; background: #b88251; transform: translateY(-50%);
}
.bc-ticket::before { left: -9px; } .bc-ticket::after  { right: -9px; }
.bc-ticketLbl  { font-family: 'Special Elite'; font-size: 16px; letter-spacing: .2em; color: #57534e; }
.bc-ticketNum  { font-family: 'Permanent Marker', cursive; font-size: 90px; line-height: 1; color: #b91c1c; }
.bc-ticketUnit { font-family: 'Indie Flower'; font-size: 26px; color: #57534e; }

.bc-ticker {
  position: absolute; left: 14px; right: 14px; bottom: 14px; height: 80px;
  background: #fff;
  border-top: 5px solid #1f2937;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -4px 14px rgba(0,0,0,.2);
  z-index: 4;
}
.bc-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #1f2937; color: #fef3c7; display: flex; align-items: center;
  font-family: 'Special Elite'; letter-spacing: .25em; font-size: 20px;
}
.bc-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.bc-tickerText {
  display: inline-block; white-space: nowrap;
  font-family: 'Indie Flower'; font-size: 38px; color: #44403c;
  padding-left: 100%;
  animation: bc-tickerScroll 50s linear infinite;
}
.bc-tickerSep { color: #b91c1c; padding: 0 22px; }
@keyframes bc-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 8px; }
.aw-hotspot:hover { background-color: rgba(185, 28, 28, .08); box-shadow: inset 0 0 0 3px rgba(185, 28, 28, .55); }
.aw-hotspot:focus-visible { background-color: rgba(185, 28, 28, .14); box-shadow: inset 0 0 0 3px rgba(185, 28, 28, .85); }
`;
