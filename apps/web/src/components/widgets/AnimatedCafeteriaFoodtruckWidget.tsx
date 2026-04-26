"use client";

// PORTED 2026-04-20 from scratch/design/animated-cafeteria-foodtruck.html — transform:scale pattern, isLive-gated hotspots.
// Food-truck window metaphor: striped awning, order-window frame, chalkboard grid menu. Same 5-day weekMenu shape.

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

export function AnimatedCafeteriaFoodtruckWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { emoji: '🌮', name: 'Street Tacos',     meta: '🌾 🧀 — $3.50' },
      { emoji: '🍔', name: 'Classic Burger',   meta: '🌾 🧀 — $3.25' },
      { emoji: '🍟', name: 'Crispy Fries',     meta: 'veg · gf — $1.75' },
      { emoji: '🥗', name: 'Build-a-Salad',    meta: 'veg — $2.95' },
      { emoji: '🍎', name: 'Fruit Cup',        meta: 'gf — $1.50' },
      { emoji: '🥤', name: 'Milk · Juice · Water', meta: 'varies — $0.75' },
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
      <style>{CSS_FT}</style>

      <div
        className="ft-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="ft-floater a">🌮</div>
        <div className="ft-floater b">🍔</div>
        <div className="ft-floater c">🥨</div>
        <div className="ft-floater d">🍟</div>

        <div className="ft-lights">
          <div className="ft-wire" />
          {[6,14,22,30,38,46,54,62,70,78,86,94].map((left, i) => (
            <div key={i} className="ft-bulb" style={{ left: `${left}%` }} />
          ))}
        </div>

        <div className="ft-header">
          <div className="ft-truck">
            <div className="ft-awning" />
            <div className="ft-cab" />
            <div className="ft-body" />
            <div className="ft-wheel l" />
            <div className="ft-wheel r" />
          </div>
          <div className="ft-title">
            <div className="ft-board">
              <span className="ft-star s1">✨</span>
              <span className="ft-star s2">⭐</span>
              <span className="ft-star s3">🌟</span>
              <span className="ft-star s4">💫</span>
              <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'LUNCH IS ON').toUpperCase()}</h1>
              <div className="ft-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ freshly rolled every day ~'}</div>
            </div>
          </div>
          <div className="ft-clock">
            <div className="ft-clockT">{hh}:{mm}</div>
            <div className="ft-clockAp">{ampm}</div>
          </div>
        </div>

        <div className="ft-grid">
          <div className="ft-special">
            <div className="ft-string" />
            <div className="ft-tag">
              <span className="ft-tagEmoji" data-field="specialEmoji" style={{ whiteSpace: 'pre-wrap' }}>
                {isSpecialUrl ? <img src={specialEmoji} alt="" className="ft-tagImg" /> : specialEmoji}
              </span>
              <div className="ft-tagLbl" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>★ {(c.specialLabel || 'Pickup Special').toUpperCase()} ★</div>
              <div className="ft-tagName" data-field="specialName" style={{ whiteSpace: 'pre-wrap' }}>{c.specialName || 'Street Taco Bowl'}</div>
            </div>
          </div>

          <div className="ft-menu">
            <h2>{"Today's Menu"}</h2>
            <div className="ft-date">{dateLine}</div>
            <div className="ft-items">
              {menuItems.slice(0, 8).map((it, i) => {
                const src = it.emoji || '';
                const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                return (
                  <div key={i} className="ft-item">
                    <span className="ft-itemEmoji">
                      {isUrl ? <img src={src} alt="" className="ft-itemImg" /> : (src || '🍽️')}
                    </span>
                    <div className="ft-itemBody">
                      <div className="ft-nm">{it.name || ''}</div>
                      {(it.meta || it.price) && (
                        <div className="ft-allergen">
                          {it.meta || ''}{it.price ? (it.meta ? ` — ${it.price}` : it.price) : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ft-countdown">
            <div className="ft-burst">
              <div className="ft-rays" />
              <div className="ft-center">
                <div className="ft-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Taco Tuesday in'}</div>
                <div className="ft-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
                <div className="ft-cdUnit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{unit}</div>
              </div>
            </div>
          </div>

          <div className="ft-chef">
            <div className="ft-chefCard">
              <div className="ft-chefFace">
                {c.chefPhotoUrl
                  ? <img src={c.chefPhotoUrl} alt="" className="ft-chefPhoto" />
                  : <span>{chefFace}</span>}
              </div>
              <div className="ft-chefName" data-field="chefName" style={{ whiteSpace: 'pre-wrap' }}>{(c.chefName || 'Ms. Rodriguez').toUpperCase()}</div>
              <div className="ft-chefRole" data-field="chefRole" style={{ whiteSpace: 'pre-wrap' }}>~ {c.chefRole || 'lunch hero of the week'} ~</div>
            </div>
          </div>

          <div className="ft-birthdays">
            <div className="ft-ring">
              <div className="ft-cake">🎂</div>
            </div>
            <div className="ft-bdLbl">★ Birthdays Today ★</div>
            <div className="ft-bdNames" data-field="birthdayNames" style={{ whiteSpace: 'pre-wrap' }}>{bdInline}</div>
          </div>
        </div>

        <div className="ft-ticker">
          <div className="ft-tickerBar">
            <div className="ft-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'CAFÉ NEWS').toUpperCase()}</div>
            <div className="ft-tickerScroll">
              <span
                className="ft-tickerText"
                style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 52)}s` }}
              >{tickerText}</span>
            </div>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={36}   y={140} w={240}  h={210} />
            <Hotspot section="header"    x={300}  y={140} w={1320} h={210} />
            <Hotspot section="header"    x={1644} y={140} w={240}  h={210} />
            <Hotspot section="special"   x={36}   y={370} w={340}  h={320} />
            <Hotspot section="menu"      x={400}  y={370} w={1120} h={540} />
            <Hotspot section="countdown" x={1544} y={370} w={340}  h={320} />
            <Hotspot section="chef"      x={36}   y={710} w={340}  h={200} />
            <Hotspot section="birthdays" x={1544} y={710} w={340}  h={200} />
            <Hotspot section="ticker"    x={0}    y={930} w={1920} h={150} />
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

const CSS_FT = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Fredoka:wght@500;700&family=Permanent+Marker&family=Righteous&display=swap');

.ft-stage {
  position: relative; overflow: hidden;
  font-family: 'Fredoka', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 90%, #fbbf24 0%, transparent 55%),
    linear-gradient(180deg, #fde68a 0%, #fca5a5 40%, #c084fc 100%);
}

.ft-lights {
  position: absolute; top: 30px; left: 0; right: 0; height: 80px;
  pointer-events: none; z-index: 2;
}
.ft-wire {
  position: absolute; top: 50%; left: 0; right: 0; height: 3px;
  background: #1f2937; border-radius: 2px;
}
.ft-bulb {
  position: absolute; top: 48%; width: 22px; height: 32px;
  background: radial-gradient(circle at 30% 30%, #fef3c7, #fbbf24 70%, #d97706);
  border-radius: 50% 50% 40% 40%;
  box-shadow: 0 0 20px #fbbf24, 0 0 40px rgba(251, 191, 36, .4);
  animation: ft-blink 3s ease-in-out infinite;
}
.ft-bulb:nth-child(even) {
  background: radial-gradient(circle at 30% 30%, #fecaca, #ec4899 70%, #9d174d);
  box-shadow: 0 0 20px #ec4899, 0 0 40px rgba(236, 72, 153, .4);
  animation-delay: .5s;
}
.ft-bulb:nth-child(3n) {
  background: radial-gradient(circle at 30% 30%, #bfdbfe, #06b6d4 70%, #0e7490);
  box-shadow: 0 0 20px #06b6d4, 0 0 40px rgba(6, 182, 212, .4);
  animation-delay: 1s;
}
@keyframes ft-blink { 0%, 100% { opacity: 1; } 48%, 52% { opacity: .5; } }
.ft-bulb::before {
  content: ''; position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
  width: 6px; height: 8px;
  background: #374151; border-radius: 2px 2px 0 0;
}

.ft-floater {
  position: absolute; font-size: 72px; opacity: .55;
  animation: ft-drift 24s linear infinite;
  z-index: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.2));
}
.ft-floater.a { top: 12%; left: -10%; animation-delay: 0s; }
.ft-floater.b { top: 28%; left: -10%; animation-delay: -8s; font-size: 56px; }
.ft-floater.c { top: 40%; left: -10%; animation-delay: -14s; font-size: 64px; }
.ft-floater.d { top: 58%; left: -10%; animation-delay: -3s; font-size: 60px; }
@keyframes ft-drift {
  from { transform: translateX(0) rotate(0deg); }
  to   { transform: translateX(2400px) rotate(360deg); }
}

.ft-header {
  position: absolute; top: 140px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 220px 1fr 220px;
  gap: 36px; z-index: 5; align-items: start;
}

.ft-truck {
  position: relative; width: 220px; height: 200px;
  animation: ft-truckBounce 2s ease-in-out infinite;
}
@keyframes ft-truckBounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-6px); }
}
.ft-cab {
  position: absolute; top: 40px; left: 10px; width: 70px; height: 80px;
  background: linear-gradient(180deg, #ec4899, #9d174d);
  border: 4px solid #1f2937;
  border-radius: 14px 6px 6px 6px;
  box-shadow: 0 8px 16px rgba(0,0,0,.3);
}
.ft-cab::before {
  content: ''; position: absolute; top: 8px; left: 8px; right: 8px; height: 30px;
  background: linear-gradient(135deg, #dbeafe, #93c5fd);
  border-radius: 4px;
}
.ft-body {
  position: absolute; top: 20px; left: 70px; right: 0; height: 100px;
  background: linear-gradient(180deg, #fbbf24, #d97706);
  border: 4px solid #1f2937;
  border-radius: 6px 18px 6px 6px;
  box-shadow: 0 8px 16px rgba(0,0,0,.3);
}
.ft-body::before {
  content: ''; position: absolute; top: 14px; left: 18px; right: 18px; height: 56px;
  background: #1f2937;
  border-radius: 4px;
}
.ft-body::after {
  content: 'EAT!'; position: absolute; top: 14px; left: 18px; right: 18px; height: 56px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Bungee', cursive; font-size: 32px;
  color: #fef3c7;
  text-shadow: 2px 2px 0 #ec4899;
  letter-spacing: .08em;
}
.ft-awning {
  position: absolute; top: 8px; left: 70px; right: 0; height: 18px;
  background: repeating-linear-gradient(90deg, #ec4899 0 14px, #fef3c7 14px 28px);
  border: 3px solid #1f2937;
  border-bottom: none;
  clip-path: polygon(0 0, 100% 0, 98% 100%, 93% 50%, 88% 100%, 83% 50%, 78% 100%, 73% 50%, 68% 100%, 63% 50%, 58% 100%, 53% 50%, 48% 100%, 43% 50%, 38% 100%, 33% 50%, 28% 100%, 23% 50%, 18% 100%, 13% 50%, 8% 100%, 3% 50%, 0 100%);
}
.ft-wheel {
  position: absolute; bottom: 0; width: 40px; height: 40px;
  background: radial-gradient(circle at 40% 40%, #94a3b8, #1f2937 70%);
  border-radius: 50%;
  border: 4px solid #111827;
}
.ft-wheel.l { left: 20px; }
.ft-wheel.r { right: 30px; }

.ft-title {
  position: relative; text-align: center; padding-top: 20px;
}
.ft-board {
  background: linear-gradient(180deg, #fef3c7, #fbbf24);
  border: 6px solid #1f2937;
  border-radius: 20px;
  padding: 18px 40px;
  position: relative;
  box-shadow:
    0 0 0 4px #fef3c7,
    0 0 0 10px #ec4899,
    0 16px 32px rgba(0,0,0,.25);
  animation: ft-bannerBob 4s ease-in-out infinite;
}
@keyframes ft-bannerBob {
  0%, 100% { transform: rotate(-1deg) translateY(0); }
  50%      { transform: rotate(1deg) translateY(-4px); }
}
.ft-board h1 {
  margin: 0; line-height: .95;
  font-family: 'Bungee', cursive; font-size: 92px; color: #dc2626;
  text-shadow: 4px 4px 0 #1f2937, 6px 6px 0 #fbbf24;
  letter-spacing: .03em;
}
.ft-sub {
  font-family: 'Permanent Marker', cursive; font-size: 34px;
  color: #7c2d12; margin-top: 2px;
}
.ft-star {
  position: absolute; font-size: 40px; line-height: 1;
  animation: ft-twinkle 1.4s ease-in-out infinite;
}
.ft-star.s1 { top: -10px; left: 10%; }
.ft-star.s2 { top: -10px; right: 10%; animation-delay: .3s; }
.ft-star.s3 { bottom: -14px; left: 20%; animation-delay: .6s; }
.ft-star.s4 { bottom: -14px; right: 20%; animation-delay: .9s; }
@keyframes ft-twinkle {
  0%, 100% { opacity: .4; transform: scale(.9) rotate(-10deg); }
  50%      { opacity: 1;  transform: scale(1.2) rotate(15deg); }
}

.ft-clock {
  position: relative; width: 220px; height: 220px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #fafafa 0%, #fef3c7 60%, #fde68a 100%);
  border-radius: 50%;
  border: 8px solid #1f2937;
  box-shadow: 0 12px 24px rgba(0,0,0,.3), inset 0 0 20px rgba(251, 191, 36, .3);
  animation: ft-clockBob 3.6s ease-in-out infinite;
}
@keyframes ft-clockBob {
  0%, 100% { transform: rotate(-3deg); }
  50%      { transform: rotate(3deg); }
}
.ft-clock::before {
  content: ''; position: absolute; inset: 10px; border-radius: 50%;
  background: conic-gradient(from 0deg,
    #1f2937 0 2deg, transparent 2deg 30deg,
    #1f2937 30deg 32deg, transparent 32deg 60deg,
    #1f2937 60deg 62deg, transparent 62deg 90deg,
    #1f2937 90deg 92deg, transparent 92deg 120deg,
    #1f2937 120deg 122deg, transparent 122deg 150deg,
    #1f2937 150deg 152deg, transparent 152deg 180deg,
    #1f2937 180deg 182deg, transparent 182deg 210deg,
    #1f2937 210deg 212deg, transparent 212deg 240deg,
    #1f2937 240deg 242deg, transparent 242deg 270deg,
    #1f2937 270deg 272deg, transparent 272deg 300deg,
    #1f2937 300deg 302deg, transparent 302deg 330deg,
    #1f2937 330deg 332deg, transparent 332deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 82%, #000 82%, #000 94%, transparent 94%);
          mask: radial-gradient(circle, transparent 82%, #000 82%, #000 94%, transparent 94%);
}
.ft-clockT {
  font-family: 'Bungee', cursive; font-size: 56px; line-height: 1;
  color: #dc2626; text-shadow: 2px 2px 0 rgba(0,0,0,.15);
  position: relative; z-index: 1;
}
.ft-clockAp {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 22px;
  color: #7c2d12; letter-spacing: .15em;
  position: relative; z-index: 1;
}

.ft-grid {
  position: absolute; top: 370px; left: 36px; right: 36px; bottom: 180px;
  display: grid;
  grid-template-columns: 320px 1fr 320px;
  grid-template-rows: 1fr 1fr;
  gap: 28px;
  z-index: 3;
}

.ft-special {
  grid-column: 1; grid-row: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding-top: 16px; position: relative;
}
.ft-string { width: 2px; height: 40px; background: #1f2937; border-radius: 1px; }
.ft-tag {
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 4px solid #1f2937;
  padding: 20px 30px;
  clip-path: polygon(0 50%, 12% 0, 100% 0, 100% 100%, 12% 100%);
  padding-left: 48px;
  text-align: center;
  box-shadow: 0 8px 20px rgba(0,0,0,.3);
  animation: ft-tagSwing 3.6s ease-in-out infinite;
  transform-origin: 10% 0;
  position: relative;
}
@keyframes ft-tagSwing {
  0%, 100% { transform: rotate(-4deg); }
  50%      { transform: rotate(4deg); }
}
.ft-tag::before {
  content: ''; position: absolute; left: 24px; top: 50%; transform: translateY(-50%);
  width: 10px; height: 10px; border-radius: 50%;
  background: #1f2937;
}
.ft-tagEmoji {
  font-size: 96px; line-height: 1; display: inline-flex;
  align-items: center; justify-content: center;
  width: 110px; height: 110px;
}
.ft-tagImg { width: 100%; height: 100%; object-fit: contain; border-radius: 8px; }
.ft-tagLbl {
  font-family: 'Bungee', cursive; font-size: 18px; color: #dc2626;
  letter-spacing: .12em; margin-top: 6px;
}
.ft-tagName {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 28px;
  color: #7c2d12; line-height: 1; margin-top: 2px;
}

.ft-menu {
  grid-column: 2; grid-row: 1 / span 2;
  background: #fafafa;
  border: 6px solid #1f2937;
  border-radius: 24px;
  box-shadow: 0 16px 32px rgba(0,0,0,.25), 12px 12px 0 #ec4899, 18px 18px 0 #1f2937;
  padding: 30px 40px;
  position: relative;
  display: flex; flex-direction: column;
  animation: ft-menuFloat 5.4s ease-in-out infinite;
}
@keyframes ft-menuFloat {
  0%, 100% { transform: rotate(-.5deg) translateY(0); }
  50%      { transform: rotate(.5deg) translateY(-6px); }
}
.ft-menu::before {
  content: ''; position: absolute; top: -34px; left: -6px; right: -6px; height: 36px;
  background:
    repeating-linear-gradient(90deg, #dc2626 0 28px, #fef3c7 28px 56px);
  border: 4px solid #1f2937;
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 97% 70%, 91% 100%, 85% 70%, 79% 100%, 73% 70%, 67% 100%, 61% 70%, 55% 100%, 49% 70%, 43% 100%, 37% 70%, 31% 100%, 25% 70%, 19% 100%, 13% 70%, 7% 100%, 3% 70%, 0 100%);
}
.ft-menu h2 {
  margin: 0 0 18px; line-height: 1;
  font-family: 'Bungee', cursive; font-size: 64px; text-align: center;
  background: linear-gradient(135deg, #dc2626, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .04em;
}
.ft-date {
  text-align: center; font-family: 'Permanent Marker', cursive; font-size: 28px;
  color: #9d174d; margin-top: -12px; margin-bottom: 16px;
  transform: rotate(-1deg);
}
.ft-items {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px;
}
.ft-item {
  display: flex; align-items: center; gap: 14px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 3px solid #1f2937;
  border-radius: 14px;
  padding: 10px 14px;
  box-shadow: 3px 3px 0 #1f2937;
  transition: transform .3s ease;
  animation: ft-itemPop .6s ease-out both;
}
.ft-item:nth-child(1) { animation-delay: .1s; }
.ft-item:nth-child(2) { animation-delay: .2s; }
.ft-item:nth-child(3) { animation-delay: .3s; }
.ft-item:nth-child(4) { animation-delay: .4s; }
.ft-item:nth-child(5) { animation-delay: .5s; }
.ft-item:nth-child(6) { animation-delay: .6s; }
.ft-item:nth-child(7) { animation-delay: .7s; }
.ft-item:nth-child(8) { animation-delay: .8s; }
@keyframes ft-itemPop {
  from { opacity: 0; transform: scale(.9); }
  to   { opacity: 1; transform: scale(1); }
}
.ft-itemEmoji {
  font-size: 46px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  width: 52px; height: 52px;
}
.ft-itemImg { width: 46px; height: 46px; object-fit: contain; border-radius: 6px; }
.ft-itemBody { flex: 1; min-width: 0; }
.ft-nm {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 22px;
  color: #1f2937; line-height: 1;
}
.ft-allergen {
  font-family: 'Permanent Marker', cursive; font-size: 16px;
  color: #b91c1c; margin-top: 2px;
}

.ft-countdown {
  grid-column: 3; grid-row: 1;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.ft-burst {
  position: relative; width: 260px; height: 260px;
  animation: ft-burstSpin 16s linear infinite;
}
@keyframes ft-burstSpin { to { transform: rotate(360deg); } }
.ft-rays {
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
  border: 6px solid #1f2937;
  filter: drop-shadow(0 12px 20px rgba(0,0,0,.3));
}
.ft-center {
  position: absolute; inset: 34px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fafafa, #fde68a 70%);
  border: 5px solid #1f2937;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  animation: ft-burstCounter 16s linear infinite reverse;
  padding: 14px;
}
@keyframes ft-burstCounter { to { transform: rotate(-360deg); } }
.ft-cdLbl {
  font-family: 'Bungee', cursive; font-size: 14px;
  color: #9d174d; letter-spacing: .14em; text-transform: uppercase;
  max-width: 150px; line-height: 1.1;
}
.ft-cdNum {
  font-family: 'Bungee', cursive; font-size: 80px; line-height: .9;
  color: #dc2626; text-shadow: 3px 3px 0 rgba(0,0,0,.2);
}
.ft-cdUnit {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 20px;
  color: #1f2937; letter-spacing: .15em;
}

.ft-chef {
  grid-column: 1; grid-row: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 12px; text-align: center;
}
.ft-chefCard {
  position: relative;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 5px solid #1f2937;
  border-radius: 18px;
  padding: 18px 16px 16px;
  width: 280px;
  box-shadow: 0 10px 24px rgba(0,0,0,.3), 8px 8px 0 #ec4899;
  transform: rotate(-3deg);
  animation: ft-chefSway 6s ease-in-out infinite;
}
@keyframes ft-chefSway {
  0%, 100% { transform: rotate(-3deg) translateY(0); }
  50%      { transform: rotate(-1deg) translateY(-4px); }
}
.ft-chefFace {
  width: 100%; aspect-ratio: 1.1;
  background: radial-gradient(circle at 50% 40%, #fef3c7, #fbbf24 70%);
  border: 4px solid #1f2937;
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 140px; line-height: 1;
  box-shadow: inset 0 0 20px rgba(0,0,0,.15);
  overflow: hidden;
}
.ft-chefPhoto { width: 100%; height: 100%; object-fit: cover; }
.ft-chefName {
  font-family: 'Bungee', cursive; font-size: 28px; color: #7c2d12;
  margin-top: 8px; line-height: 1;
}
.ft-chefRole {
  font-family: 'Permanent Marker', cursive; font-size: 20px; color: #9d174d;
  margin-top: 2px; line-height: 1;
}

.ft-birthdays {
  grid-column: 3; grid-row: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 12px; text-align: center;
}
.ft-ring {
  position: relative; width: 180px; height: 180px;
  display: flex; align-items: center; justify-content: center;
  animation: ft-ringSpin 18s linear infinite;
}
@keyframes ft-ringSpin { to { transform: rotate(360deg); } }
.ft-ring::before {
  content: ''; position: absolute; inset: -20px; border-radius: 50%;
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
.ft-cake {
  font-size: 120px; line-height: 1;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.3));
  animation: ft-cakeSpin 18s linear infinite reverse;
}
@keyframes ft-cakeSpin { to { transform: rotate(-360deg); } }
.ft-bdLbl {
  font-family: 'Bungee', cursive; font-size: 18px; color: #dc2626;
  letter-spacing: .12em; text-transform: uppercase; margin-top: 12px;
  text-shadow: 2px 2px 0 #fef3c7;
}
.ft-bdNames {
  font-family: 'Permanent Marker', cursive; font-size: 30px;
  color: #1f2937; margin-top: 4px; line-height: 1.05;
}

.ft-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 150px;
  background: #fafafa;
  display: flex; flex-direction: column;
  z-index: 6;
  box-shadow: 0 -8px 24px rgba(0,0,0,.15);
}
.ft-ticker::before {
  content: ''; display: block; height: 30px; flex: 0 0 auto;
  background:
    repeating-linear-gradient(90deg, #dc2626 0 30px, #fef3c7 30px 60px);
  border-bottom: 4px solid #1f2937;
  clip-path: polygon(0 0, 100% 0, 100% 50%, 96% 100%, 92% 50%, 88% 100%, 84% 50%, 80% 100%, 76% 50%, 72% 100%, 68% 50%, 64% 100%, 60% 50%, 56% 100%, 52% 50%, 48% 100%, 44% 50%, 40% 100%, 36% 50%, 32% 100%, 28% 50%, 24% 100%, 20% 50%, 16% 100%, 12% 50%, 8% 100%, 4% 50%, 0 100%);
}
.ft-tickerBar {
  flex: 1; display: flex; align-items: center; overflow: hidden;
  background: linear-gradient(180deg, #fafafa 0%, #fde68a 100%);
}
.ft-tickerStamp {
  flex: 0 0 auto; padding: 0 36px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #9d174d);
  color: #fef3c7; display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 36px;
  text-shadow: 2px 2px 0 #1f2937;
}
.ft-tickerScroll { flex: 1; overflow: hidden; }
.ft-tickerText {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 46px;
  color: #1f2937;
  white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: ft-tickerScroll 52s linear infinite;
}
@keyframes ft-tickerScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
