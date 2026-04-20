"use client";

// PORTED 2026-04-20 from scratch/design/animated-cafeteria-high.html — transform:scale pattern, isLive-gated hotspots.

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
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;

  specialEmoji?: string;
  specialLabel?: string;
  specialName?: string;

  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];

  countdownEmoji?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;

  chefName?: string;
  chefRole?: string;
  chefEmoji?: string;
  chefPhotoUrl?: string;

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

// Deterministic pseudo-random so confetti layout is stable across renders (no SSR mismatch)
function confettiPieces(count: number) {
  const colors = ['#ec4899','#f59e0b','#06b6d4','#fbbf24','#f43f5e','#8b5cf6','#10b981'];
  const out = [];
  let seed = 1;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < count; i++) {
    const size = 6 + rand() * 12;
    const dur = 6 + rand() * 8;
    const circle = rand() < .3;
    out.push({
      left: rand() * 100,
      width: size,
      height: size * (circle ? 1 : 1.6),
      color: colors[Math.floor(rand() * colors.length)],
      radius: circle ? '50%' : '3px',
      duration: dur,
      delay: -rand() * dur,
      rotate: rand() * 360,
    });
  }
  return out;
}

export function AnimatedCafeteriaHighWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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
      { emoji: '🥪', name: 'Turkey Club Wrap', meta: '🌾 🧀 · 480 cal', price: '$4.50' },
      { emoji: '🥗', name: 'Power Bowl',       meta: 'veg · gf · 420 cal', price: '$5.25' },
      { emoji: '🍕', name: 'Pepperoni Pizza',  meta: '🌾 🧀 · 520 cal', price: '$3.75' },
      { emoji: '☕', name: 'Coffee · Tea · Matcha', meta: 'varies · sizes 8-16oz', price: '$2.50' },
      { emoji: '🍪', name: 'Bakery Cookie',    meta: '🌾 🥜 🧀', price: '$1.50' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 42;
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
    if (list.length > 0) return list.join('  ★  ');
    return 'Senior portraits next week — sign up in the office  ★  FAFSA workshop Tuesday 6pm  ★  Pizza Friday — $3.75 slices  ★  Coffee shop open 7am-bell';
  }, [c.tickerMessages]);

  const confetti = useMemo(() => isLive ? confettiPieces(50) : [], [isLive]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fce7f3',
      }}
    >
      <style>{CSS_HS}</style>

      <div
        className="hs-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="hs-scroll hs-s1">📜</div>
        <div className="hs-scroll hs-s2">🎓</div>
        <div className="hs-scroll hs-s3">📜</div>
        <div className="hs-scroll hs-s4">🎓</div>

        {isLive && (
          <div className="hs-confetti">
            {confetti.map((p, i) => (
              <div
                key={i}
                className="hs-c"
                style={{
                  left: `${p.left}%`,
                  width: p.width, height: p.height,
                  background: p.color, borderRadius: p.radius,
                  animationDuration: `${p.duration}s`,
                  animationDelay: `${p.delay}s`,
                  transform: `rotate(${p.rotate}deg)`,
                }}
              />
            ))}
          </div>
        )}

        <div className="hs-header">
          <div className="hs-cup">
            <div className="hs-cupHandle" />
            <div className="hs-cupSteam"><span /><span /><span /></div>
            <div className="hs-cupBodyLogo" />
          </div>
          <div className="hs-title">
            <div className="hs-neon">
              <h1>{(c.title || 'CAMPUS CAFÉ').toUpperCase()}</h1>
              <div className="hs-neonSub">{c.subtitle || 'open 7am · closes at the bell'}</div>
            </div>
          </div>
          <div className="hs-clock">
            <div className="hs-rays" />
            <div className="hs-face">
              <div className="hs-ft">{hh}:{mm}</div>
              <div className="hs-fap">{ampm}</div>
            </div>
          </div>
        </div>

        <div className="hs-grid">
          <div className="hs-special">
            <div className="hs-sunDisc">
              <div className="hs-sunFace">{c.specialEmoji || '🥪'}</div>
            </div>
            <div className="hs-specialLbl">★ {c.specialLabel || "Today's Pick"} ★</div>
            <div className="hs-specialName">{c.specialName || 'Turkey Club Wrap'}</div>
          </div>

          <div className="hs-menu">
            <div className="hs-menuHeader">
              <h2>Today's Menu</h2>
              <div className="hs-date">{dateLine}</div>
              <div className="hs-dayTabs">
                {(['MON','TUE','WED','THU','FRI'] as const).map((d, i) => {
                  const isToday = today === i + 1;
                  return <span key={d} className={`hs-day${isToday ? ' hs-dayToday' : ''}`}>{d}</span>;
                })}
              </div>
            </div>
            <div className="hs-menuBody">
              <div className="hs-items">
                {menuItems.slice(0, 12).map((it, i) => {
                  const src = it.emoji || '';
                  const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                  return (
                    <div key={i} className="hs-item">
                      <span className="hs-itemEmoji">
                        {isUrl ? <img src={src} alt="" className="hs-itemImg" /> : (src || '🍽️')}
                      </span>
                      <div className="hs-itemInfo">
                        <div className="hs-itemName">{it.name || ''}</div>
                        {it.meta && <div className="hs-itemMeta">{it.meta}</div>}
                      </div>
                      <div className="hs-leader" />
                      {it.price && <span className="hs-itemPrice">{it.price}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="hs-countdown">
            <div className="hs-trophy">
              <div className="hs-handleL" />
              <div className="hs-handleR" />
              <div className="hs-cupBody">
                <div className="hs-cdIcon">{c.countdownEmoji || '🎓'}</div>
                <div className="hs-cdLbl">{c.countdownLabel || 'Graduation in'}</div>
                <div className="hs-cdNum">{days}</div>
                <div className="hs-cdUnit">{unit}</div>
              </div>
              <div className="hs-stem" />
              <div className="hs-base" />
            </div>
          </div>

          <div className="hs-chef">
            <div className="hs-yearbook">
              <div className="hs-photo">
                {c.chefPhotoUrl
                  ? <img src={c.chefPhotoUrl} alt="" className="hs-photoImg" />
                  : <span>{c.chefEmoji || '👨‍🍳'}</span>}
              </div>
              <div className="hs-pageInfo">
                <div className="hs-chefName">{(c.chefName || 'MR. PATEL').toUpperCase()}</div>
                <div className="hs-chefRole">~ {c.chefRole || 'café chef'} ~</div>
              </div>
            </div>
          </div>

          <div className="hs-birthdays">
            <div className="hs-burst">
              <div className="hs-cake">🎂</div>
            </div>
            <div className="hs-bdLbl">★ Birthdays Today ★</div>
            <div className="hs-bdNames">{bdInline}</div>
          </div>
        </div>

        <div className="hs-ticker">
          <div className="hs-tickerStamp">{(c.tickerStamp || 'Campus News').toUpperCase()}</div>
          <div className="hs-tickerScroll">
            <span
              className="hs-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 54)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={36}   y={36}  w={220}  h={240} />
            <Hotspot section="header"    x={280}  y={36}  w={1360} h={240} />
            <Hotspot section="header"    x={1660} y={36}  w={220}  h={240} />
            <Hotspot section="special"   x={36}   y={280} w={300}  h={340} />
            <Hotspot section="menu"      x={360}  y={280} w={1200} h={660} />
            <Hotspot section="countdown" x={1584} y={280} w={300}  h={340} />
            <Hotspot section="chef"      x={36}   y={620} w={300}  h={320} />
            <Hotspot section="birthdays" x={1584} y={620} w={300}  h={320} />
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

const CSS_HS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Inter:wght@600;800&family=Caveat:wght@700&display=swap');

.hs-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% 100%, #fbbf24 0%, transparent 55%),
    radial-gradient(ellipse at 0% 0%, #ec4899 0%, transparent 45%),
    radial-gradient(ellipse at 100% 0%, #06b6d4 0%, transparent 45%),
    linear-gradient(180deg, #fce7f3 0%, #ffe4e6 35%, #fef3c7 75%, #fed7aa 100%);
  overflow: hidden;
}

.hs-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2; }
.hs-c { position: absolute; top: -30px; animation: hs-fall linear infinite; }
@keyframes hs-fall {
  0% { transform: translateY(-30px) rotate(0); opacity: 0; }
  8% { opacity: 1; }
  100% { transform: translateY(1110px) rotate(720deg); opacity: .85; }
}

.hs-scroll { position: absolute; font-size: 64px; opacity: .25; animation: hs-float 22s ease-in-out infinite; z-index: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,.2)); }
.hs-s1 { top: 14%; left: 4%; }
.hs-s2 { top: 72%; left: 7%; animation-delay: -3s; font-size: 52px; }
.hs-s3 { top: 22%; right: 3%; animation-delay: -6s; }
.hs-s4 { top: 62%; right: 6%; animation-delay: -9s; font-size: 56px; }
@keyframes hs-float { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-28px) rotate(8deg); } }

.hs-header {
  position: absolute; top: 36px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 220px 1fr 220px;
  gap: 36px; z-index: 5; align-items: start;
}

.hs-cup {
  position: relative; width: 200px; height: 200px;
  display: flex; align-items: center; justify-content: center;
  animation: hs-cupTilt 5.4s ease-in-out infinite;
}
@keyframes hs-cupTilt { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.hs-cupBodyLogo {
  position: absolute; top: 60px; left: 24px; width: 152px; height: 120px;
  background: linear-gradient(180deg, #fff 0%, #fef3c7 60%, #fbbf24 100%);
  border: 5px solid #1f2937;
  border-radius: 8px 8px 40px 40%;
  box-shadow: 0 8px 18px rgba(0,0,0,.2), inset 0 0 0 4px #ec4899;
}
.hs-cupBodyLogo::before {
  content: ''; position: absolute; top: 10px; left: 10px; right: 10px; height: 18px;
  background: linear-gradient(180deg, #78350f, #451a03);
  border-radius: 4px;
}
.hs-cupHandle {
  position: absolute; top: 80px; right: 0;
  width: 30px; height: 60px;
  border: 8px solid #1f2937; border-left: none;
  border-radius: 0 30px 30px 0;
  z-index: -1;
}
.hs-cupSteam {
  position: absolute; left: 50%; top: 10px; transform: translateX(-50%);
  display: flex; gap: 12px;
}
.hs-cupSteam span {
  display: inline-block; width: 8px; height: 40px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.8) 50%, transparent 100%);
  border-radius: 6px;
  animation: hs-steam 2s ease-in-out infinite;
}
.hs-cupSteam span:nth-child(2) { animation-delay: .3s; height: 50px; }
.hs-cupSteam span:nth-child(3) { animation-delay: .6s; }
@keyframes hs-steam {
  0% { transform: translateY(10px) scaleY(.8); opacity: 0; }
  50% { opacity: .8; }
  100% { transform: translateY(-20px) scaleY(1.2); opacity: 0; }
}

.hs-title { position: relative; padding-top: 20px; }
.hs-neon {
  background: linear-gradient(135deg, #fff 0%, #fef3c7 100%);
  border: 6px solid #ec4899; border-radius: 24px;
  padding: 22px 36px; text-align: center;
  box-shadow: 0 0 0 4px #fff, 0 0 0 10px #ec4899,
    0 0 30px rgba(236,72,153,.5), 0 16px 32px rgba(0,0,0,.2);
  animation: hs-neonPulse 5.4s ease-in-out infinite;
  position: relative;
}
@keyframes hs-neonPulse {
  0%, 95%, 100% { box-shadow: 0 0 0 4px #fff, 0 0 0 10px #ec4899, 0 0 30px rgba(236,72,153,.5), 0 16px 32px rgba(0,0,0,.2); }
  97%           { box-shadow: 0 0 0 4px #fff, 0 0 0 10px #ec4899, 0 0 60px rgba(236,72,153,.9), 0 16px 32px rgba(0,0,0,.2); }
}
.hs-neon h1 {
  margin: 0; line-height: .9;
  font-family: 'Anton', sans-serif; font-size: 84px;
  background: linear-gradient(135deg, #ec4899 0%, #f59e0b 50%, #06b6d4 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: hs-shift 9s linear infinite;
  letter-spacing: -.01em; text-transform: uppercase;
}
@keyframes hs-shift { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
.hs-neonSub { font-family: 'Caveat', cursive; font-size: 34px; color: #ec4899; margin-top: 4px; }

.hs-clock {
  position: relative; width: 200px; height: 200px;
  display: flex; align-items: center; justify-content: center;
}
.hs-rays {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg,
    #fbbf24 0 20deg, transparent 20deg 40deg,
    #ec4899 40deg 60deg, transparent 60deg 80deg,
    #06b6d4 80deg 100deg, transparent 100deg 120deg,
    #fbbf24 120deg 140deg, transparent 140deg 160deg,
    #ec4899 160deg 180deg, transparent 180deg 200deg,
    #06b6d4 200deg 220deg, transparent 220deg 240deg,
    #fbbf24 240deg 260deg, transparent 260deg 280deg,
    #ec4899 280deg 300deg, transparent 300deg 320deg,
    #06b6d4 320deg 340deg, transparent 340deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 64px, #000 64px, #000 92px, transparent 92px);
          mask: radial-gradient(circle, transparent 64px, #000 64px, #000 92px, transparent 92px);
  animation: hs-spin 54s linear infinite;
}
@keyframes hs-spin { to { transform: rotate(360deg); } }
.hs-face {
  width: 150px; height: 150px; border-radius: 50%;
  background: linear-gradient(135deg, #fff, #fef3c7);
  border: 6px solid #ec4899;
  box-shadow: 0 8px 24px rgba(236,72,153,.4), inset 0 0 30px rgba(251,191,36,.3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; z-index: 1;
  animation: hs-bob 3.6s ease-in-out infinite;
}
@keyframes hs-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.hs-ft {
  font-family: 'Anton', sans-serif; font-size: 48px; line-height: 1;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hs-fap { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 18px; color: #ec4899; letter-spacing: .15em; }

.hs-grid {
  position: absolute; top: 280px; left: 36px; right: 36px; bottom: 140px;
  display: grid; grid-template-columns: 300px 1fr 300px;
  grid-template-rows: 1fr 1fr; gap: 24px; z-index: 3;
}

.hs-special { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative; }
.hs-sunDisc { position: relative; width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; }
.hs-sunDisc::before {
  content: ''; position: absolute; inset: -32px; border-radius: 50%;
  background: conic-gradient(from 0deg,
    transparent 0 18deg, #fbbf24 18deg 24deg,
    transparent 24deg 48deg, #f59e0b 48deg 54deg,
    transparent 54deg 78deg, #fbbf24 78deg 84deg,
    transparent 84deg 108deg, #f59e0b 108deg 114deg,
    transparent 114deg 138deg, #fbbf24 138deg 144deg,
    transparent 144deg 168deg, #f59e0b 168deg 174deg,
    transparent 174deg 198deg, #fbbf24 198deg 204deg,
    transparent 204deg 228deg, #f59e0b 228deg 234deg,
    transparent 234deg 258deg, #fbbf24 258deg 264deg,
    transparent 264deg 288deg, #f59e0b 288deg 294deg,
    transparent 294deg 318deg, #fbbf24 318deg 324deg,
    transparent 324deg 348deg, #f59e0b 348deg 354deg,
    transparent 354deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 100px, #000 100px, #000 130px, transparent 130px);
          mask: radial-gradient(circle, transparent 100px, #000 100px, #000 130px, transparent 130px);
  animation: hs-spin 30s linear infinite;
}
.hs-sunFace {
  width: 180px; height: 180px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 50px rgba(251,191,36,.6), inset 0 -10px 18px rgba(180,83,9,.25);
  display: flex; align-items: center; justify-content: center;
  font-size: 110px; line-height: 1;
  filter: drop-shadow(0 3px 6px rgba(0,0,0,.25));
}
.hs-specialLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 18px; color: #ec4899; letter-spacing: .2em; text-transform: uppercase; margin-top: 14px; }
.hs-specialName { font-family: 'Anton', sans-serif; font-size: 34px; color: #1f2937; line-height: 1; margin-top: 2px; letter-spacing: .01em; }

.hs-menu {
  grid-column: 2; grid-row: 1 / span 2;
  position: relative; background: #fff;
  border: 6px solid #1f2937;
  border-radius: 24px;
  box-shadow: 0 16px 32px rgba(0,0,0,.25), 12px 12px 0 #fbbf24, 16px 16px 0 #ec4899;
  display: flex; flex-direction: column; overflow: hidden;
  animation: hs-menuFloat 5.4s ease-in-out infinite;
}
@keyframes hs-menuFloat { 0%, 100% { transform: rotate(-.5deg) translateY(0); } 50% { transform: rotate(.5deg) translateY(-5px); } }
.hs-menuHeader {
  flex: 0 0 auto; padding: 20px 36px 8px;
  background: linear-gradient(180deg, #fef3c7 0%, #fff 100%);
  border-bottom: 3px dashed #ec4899;
}
.hs-menu h2 {
  margin: 0; line-height: 1; text-align: center;
  font-family: 'Anton', sans-serif; font-size: 56px;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-transform: uppercase;
}
.hs-date { text-align: center; font-family: 'Caveat', cursive; font-size: 28px; color: #9d174d; margin-top: -2px; }

.hs-dayTabs { display: flex; justify-content: center; gap: 6px; padding: 10px 0 0; }
.hs-day {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px;
  padding: 6px 16px;
  border: 3px solid #1f2937; border-radius: 999px;
  background: #fef3c7; color: #92400e;
  letter-spacing: .1em;
}
.hs-dayToday {
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  color: #fff; border-color: #1f2937;
  transform: translateY(-2px);
  box-shadow: 0 4px 0 #1f2937, 0 0 0 3px #fbbf24;
}

.hs-menuBody { flex: 1; padding: 12px 36px 18px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.hs-items { display: flex; flex-direction: column; gap: clamp(4px, 1.5%, 10px); flex: 1 1 0; min-height: 0; overflow: hidden; }
.hs-item {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: clamp(12px, 3cqh + 10px, 22px);
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 3px solid #1f2937; border-radius: 14px;
  padding: clamp(6px, 10cqh, 16px) clamp(16px, 4cqh + 14px, 26px);
  box-shadow: 3px 3px 0 #ec4899;
  overflow: hidden;
}
.hs-itemEmoji {
  font-size: clamp(36px, 70cqh, 80px); line-height: 1; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: clamp(40px, 80cqh, 90px); height: clamp(40px, 80cqh, 90px);
}
.hs-itemImg { width: 100%; height: 100%; object-fit: contain; border-radius: 8px; }
.hs-itemInfo { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.hs-itemName { font-family: 'Anton', sans-serif; font-size: clamp(20px, 38cqh, 42px); color: #1f2937; line-height: 1.05; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hs-itemMeta { font-family: 'Inter', sans-serif; font-weight: 600; font-size: clamp(14px, 26cqh, 26px); color: #9d174d; margin-top: clamp(1px, 2cqh, 6px); }
.hs-leader { flex: 1 1 0; min-width: 12px; height: 0; border-bottom: 3px dotted rgba(236,72,153,.5); align-self: center; margin: 0 6px; transform: translateY(calc(-1 * clamp(5px, 10cqh, 12px))); }
.hs-itemPrice { font-family: 'Anton', sans-serif; font-size: clamp(22px, 36cqh, 40px); color: #ec4899; flex: 0 0 auto; text-shadow: 1px 1px 0 #1f2937; }

.hs-countdown { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; position: relative; }
.hs-trophy { position: relative; width: 240px; height: 260px; display: flex; flex-direction: column; align-items: center; animation: hs-trophy 5.4s ease-in-out infinite; }
@keyframes hs-trophy { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
.hs-handleL, .hs-handleR { position: absolute; top: 28px; width: 50px; height: 68px; border: 10px solid #fbbf24; border-radius: 50%; z-index: 0; }
.hs-handleL { left: 0; border-right: none; border-radius: 50% 0 0 50%; }
.hs-handleR { right: 0; border-left: none; border-radius: 0 50% 50% 0; }
.hs-cupBody {
  width: 180px; height: 150px;
  background: linear-gradient(180deg, #fde68a 0%, #fbbf24 50%, #d97706 100%);
  border: 6px solid #92400e;
  border-radius: 12px 12px 50% 50% / 12px 12px 30% 30%;
  box-shadow: 0 12px 24px rgba(0,0,0,.3), inset 0 0 20px rgba(255,255,255,.3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; position: relative; z-index: 1;
  padding: 14px 8px;
}
.hs-cdIcon { font-size: 40px; line-height: 1; }
.hs-cdLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 12px; color: #92400e; letter-spacing: .12em; text-transform: uppercase; line-height: 1.1; max-width: 140px; margin-top: 2px; }
.hs-cdNum { font-family: 'Anton', sans-serif; font-size: 64px; line-height: .9; color: #fff; text-shadow: 2px 2px 0 #92400e; }
.hs-cdUnit { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 12px; color: #92400e; letter-spacing: .15em; }
.hs-stem { width: 40px; height: 28px; background: linear-gradient(180deg, #fbbf24, #d97706); border-left: 4px solid #92400e; border-right: 4px solid #92400e; margin-top: -4px; position: relative; z-index: 1; }
.hs-base { width: 130px; height: 26px; background: linear-gradient(180deg, #fbbf24, #b45309); border: 5px solid #92400e; border-radius: 8px; box-shadow: 0 6px 12px rgba(0,0,0,.3); position: relative; z-index: 1; }

.hs-chef { grid-column: 1; grid-row: 2; display: flex; align-items: center; justify-content: center; position: relative; padding: 8px; }
.hs-yearbook { position: relative; width: 240px; padding: 12px; background: #fff; border: 4px solid #ec4899; box-shadow: 0 10px 24px rgba(0,0,0,.3); transform: rotate(-3deg); animation: hs-yearbook 9s ease-in-out infinite; }
@keyframes hs-yearbook { 0%, 100% { transform: rotate(-3deg) translateX(-3px); } 50% { transform: rotate(-3deg) translateX(3px); } }
.hs-yearbook::before { content: ''; position: absolute; bottom: 0; right: 0; width: 28px; height: 28px; background: linear-gradient(135deg, transparent 50%, #ec4899 50%); }
.hs-photo { width: 100%; aspect-ratio: 1; background: linear-gradient(135deg, #06b6d4, #0e7490); display: flex; align-items: center; justify-content: center; font-size: 100px; line-height: 1; overflow: hidden; }
.hs-photoImg { width: 100%; height: 100%; object-fit: cover; }
.hs-pageInfo { margin-top: 10px; text-align: center; }
.hs-chefName { font-family: 'Anton', sans-serif; font-size: 22px; color: #1f2937; line-height: 1; letter-spacing: .02em; }
.hs-chefRole { font-family: 'Caveat', cursive; font-weight: 700; font-size: 20px; color: #ec4899; margin-top: 2px; }

.hs-birthdays { grid-column: 3; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative; padding: 8px; }
.hs-burst { position: relative; width: 170px; height: 140px; animation: hs-burst 10s linear infinite; }
@keyframes hs-burst { from { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } to { transform: rotate(-5deg); } }
.hs-burst::before {
  content: ''; position: absolute; inset: -24px;
  background: conic-gradient(from 0deg,
    #fbbf24 0 12deg, transparent 12deg 30deg,
    #ec4899 30deg 42deg, transparent 42deg 60deg,
    #06b6d4 60deg 72deg, transparent 72deg 90deg,
    #fbbf24 90deg 102deg, transparent 102deg 120deg,
    #ec4899 120deg 132deg, transparent 132deg 150deg,
    #06b6d4 150deg 162deg, transparent 162deg 180deg,
    #fbbf24 180deg 192deg, transparent 192deg 210deg,
    #ec4899 210deg 222deg, transparent 222deg 240deg,
    #06b6d4 240deg 252deg, transparent 252deg 270deg,
    #fbbf24 270deg 282deg, transparent 282deg 300deg,
    #ec4899 300deg 312deg, transparent 312deg 330deg,
    #06b6d4 330deg 342deg, transparent 342deg 360deg);
  border-radius: 50%;
  -webkit-mask: radial-gradient(circle, #000 54px, transparent 88px);
          mask: radial-gradient(circle, #000 54px, transparent 88px);
  opacity: .5;
}
.hs-cake { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 88px; line-height: 1; filter: drop-shadow(0 5px 10px rgba(0,0,0,.3)); }
.hs-bdLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px; color: #ec4899; letter-spacing: .15em; text-transform: uppercase; margin-top: 12px; }
.hs-bdNames { font-family: 'Caveat', cursive; font-weight: 700; font-size: 34px; color: #1f2937; margin-top: 2px; line-height: 1.05; }

.hs-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 100%);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 5px solid #fff;
  box-shadow: 0 -8px 24px rgba(236,72,153,.3);
}
.hs-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: #1f2937; color: #fbbf24;
  display: flex; align-items: center;
  font-family: 'Anton', sans-serif; letter-spacing: .15em; font-size: 30px;
}
.hs-tickerScroll { flex: 1; overflow: hidden; }
.hs-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 36px; color: #fff;
  white-space: nowrap; padding-left: 100%; display: inline-block;
  text-shadow: 2px 2px 0 #1f2937;
  animation: hs-tickerScroll 54s linear infinite;
}
@keyframes hs-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
