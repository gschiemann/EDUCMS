"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.

/**
 * AnimatedCafeteriaHighPortraitWidget — REAL 4K portrait companion to
 * AnimatedCafeteriaHighWidget (high-school neon-sunset café theme).
 *
 * NOT letterboxed. Native 2160×3840 canvas. Same data-field keys as the
 * landscape widget so the auto-form editor + canvas hotspots work
 * identically. Same data flow (live clock, weekday-aware menu pick,
 * countdown days, birthday list, allergen ticker).
 *
 * Vertical re-flow (HS aesthetic — dark navy #111827 base with
 * neon-sunset gradient, steaming coffee cup CSS-art, espresso brown
 * accents):
 *   • Top ~700px hero — neon-glow CAFÉ sign with steaming coffee cup
 *     CSS-art on left + clock pill on right + day badge ribbon
 *   • ~700px featured-of-the-day hero card with giant neon menu name
 *   • ~1400px weekly menu (5-row grid Mon-Fri tabs + featured rows
 *     styled as café receipt cards)
 *   • ~500px two-up — Trophy of the Week (CSS-art trophy with student
 *     name) + Yearbook quote card with chef polaroid
 *   • ~300px nutrition strip — 6 small allergen icons + numbers
 *   • Bottom ~240px scrolling allergen ticker with neon
 *     "ALLERGENS:" stamp
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

export function AnimatedCafeteriaHighPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
      { emoji: '🥪', name: 'Turkey Club Wrap',     meta: '🌾 🧀 · 480 cal', price: '$4.50' },
      { emoji: '🥗', name: 'Power Bowl',           meta: 'veg · gf · 420 cal', price: '$5.25' },
      { emoji: '🍕', name: 'Pepperoni Pizza',      meta: '🌾 🧀 · 520 cal', price: '$3.75' },
      { emoji: '☕', name: 'Coffee · Tea · Matcha', meta: 'varies · 8-16oz',  price: '$2.50' },
      { emoji: '🍪', name: 'Bakery Cookie',        meta: '🌾 🥜 🧀',         price: '$1.50' },
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

  const chefFace = c.chefEmoji || '👨‍🍳';
  const specialEmoji = c.specialEmoji || '🥪';
  const isSpecialUrl = /^(https?:\/\/|\/|data:image\/)/.test(specialEmoji);

  // Steam particles for header coffee cup
  const steamParticles = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => ({
      left: 32 + i * 16,
      delay: i * 0.4,
      duration: 3.2 + (i % 3) * 0.6,
    }));
  }, []);

  const dayLabel = useMemo(() => {
    const labels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return labels[today] || 'MON';
  }, [today]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#070b18',
      }}
    >
      <style>{CSS_HSP}</style>

      <div
        className="hsp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Neon-sunset glow blobs */}
        <div className="hsp-glow hsp-g1" />
        <div className="hsp-glow hsp-g2" />
        <div className="hsp-glow hsp-g3" />

        {/* Floating yearbook accents */}
        <div className="hsp-deco hsp-d1">📜</div>
        <div className="hsp-deco hsp-d2">🎓</div>
        <div className="hsp-deco hsp-d3">📜</div>
        <div className="hsp-deco hsp-d4">🎓</div>

        {/* Header — neon CAFÉ sign with steaming coffee cup + clock pill */}
        <div className="hsp-header">
          {/* Coffee cup CSS-art on left */}
          <div className="hsp-cup">
            <div className="hsp-cupSteam">
              {steamParticles.map((s, i) => (
                <span
                  key={i}
                  style={{
                    left: s.left,
                    animationDelay: `${s.delay}s`,
                    animationDuration: `${s.duration}s`,
                  }}
                />
              ))}
            </div>
            <div className="hsp-cupHandle" />
            <div className="hsp-cupBodyLogo" />
            <div className="hsp-cupSaucer" />
          </div>

          {/* Title + day badge */}
          <div className="hsp-titleStack">
            <div className="hsp-dayBadge">{dayLabel}</div>
            <div className="hsp-neon">
              <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'CAMPUS CAFÉ').toUpperCase()}</h1>
              <div className="hsp-neonSub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'open 7am · closes at the bell'}</div>
            </div>
          </div>

          {/* Clock pill on right */}
          <div className="hsp-clock">
            <div className="hsp-clockTop">{hh}:{mm}</div>
            <div className="hsp-clockBottom">{ampm}</div>
          </div>
        </div>

        {/* Featured-of-the-day hero card */}
        <div className="hsp-featured">
          <div className="hsp-featTag">★ {c.specialLabel || "Today's Pick"} ★</div>
          <div className="hsp-featBody">
            <div className="hsp-featEmoji" data-field="specialEmoji" style={{ whiteSpace: 'pre-wrap' }}>
              {isSpecialUrl ? <img src={specialEmoji} alt="" className="hsp-featImg" /> : specialEmoji}
            </div>
            <div className="hsp-featTextWrap">
              <div className="hsp-featName" data-field="specialName" style={{ whiteSpace: 'pre-wrap' }}>
                {c.specialName || 'Turkey Club Wrap'}
              </div>
              <div className="hsp-featRow">
                <span className="hsp-featAllergens">🌾 🧀 · 480 cal · gf opt</span>
                <span className="hsp-featPrice">$4.50</span>
              </div>
            </div>
          </div>
          <div className="hsp-featGlow" />
        </div>

        {/* Weekly menu — Mon-Fri tab strip + receipt cards */}
        <div className="hsp-menuBlock">
          <div className="hsp-menuHeader">
            <h2>This Week&apos;s Menu</h2>
            <div className="hsp-date">{dateLine}</div>
            <div className="hsp-dayTabs">
              {(['MON','TUE','WED','THU','FRI'] as const).map((d, i) => {
                const isToday = today === i + 1;
                return <span key={d} className={`hsp-day${isToday ? ' hsp-dayToday' : ''}`}>{d}</span>;
              })}
            </div>
          </div>
          <div className="hsp-menuBody">
            <div className="hsp-items">
              {menuItems.slice(0, 5).map((it, i) => {
                const src = it.emoji || '';
                const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                return (
                  <div key={i} className="hsp-item">
                    <span className="hsp-itemEmoji">
                      {isUrl ? <img src={src} alt="" className="hsp-itemImg" /> : (src || '🍽️')}
                    </span>
                    <div className="hsp-itemInfo">
                      <div className="hsp-itemName">{it.name || ''}</div>
                      {it.meta && <div className="hsp-itemMeta">{it.meta}</div>}
                    </div>
                    <div className="hsp-leader" />
                    {it.price && <span className="hsp-itemPrice">{it.price}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Two-up — Trophy of the Week + Yearbook quote card */}
        <div className="hsp-twoUp">
          {/* Trophy of the Week */}
          <div className="hsp-trophyCard">
            <div className="hsp-trophyHeader">★ TROPHY OF THE WEEK ★</div>
            <div className="hsp-trophy">
              <div className="hsp-handleL" />
              <div className="hsp-handleR" />
              <div className="hsp-cupBody">
                <div className="hsp-cdIcon" data-field="countdownEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownEmoji || '🏆'}</div>
                <div className="hsp-cdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Graduation in'}</div>
                <div className="hsp-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
                <div className="hsp-cdUnit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{unit}</div>
              </div>
              <div className="hsp-stem" />
              <div className="hsp-base" />
            </div>
            <div className="hsp-bdLbl">★ BIRTHDAYS TODAY ★</div>
            <div className="hsp-bdNames" data-field="birthdayNames" style={{ whiteSpace: 'pre-wrap' }}>{bdInline}</div>
          </div>

          {/* Yearbook quote card with chef polaroid */}
          <div className="hsp-yearbook">
            <div className="hsp-photo">
              {c.chefPhotoUrl
                ? <img src={c.chefPhotoUrl} alt="" className="hsp-photoImg" />
                : <span>{chefFace}</span>}
            </div>
            <div className="hsp-pageInfo">
              <div className="hsp-chefName" data-field="chefName" style={{ whiteSpace: 'pre-wrap' }}>{(c.chefName || 'MR. PATEL').toUpperCase()}</div>
              <div className="hsp-chefRole" data-field="chefRole" style={{ whiteSpace: 'pre-wrap' }}>~ {c.chefRole || 'café chef'} ~</div>
            </div>
            <div className="hsp-quote">&ldquo;Stay caffeinated, stay legendary.&rdquo;</div>
            <div className="hsp-quoteCorner" />
          </div>
        </div>

        {/* Nutrition / allergen icon strip */}
        <div className="hsp-iconStrip">
          <div className="hsp-iconCard"><div className="hsp-iconE">🌾</div><div className="hsp-iconL">GLUTEN</div></div>
          <div className="hsp-iconCard"><div className="hsp-iconE">🥜</div><div className="hsp-iconL">NUTS</div></div>
          <div className="hsp-iconCard"><div className="hsp-iconE">🧀</div><div className="hsp-iconL">DAIRY</div></div>
          <div className="hsp-iconCard"><div className="hsp-iconE">🥚</div><div className="hsp-iconL">EGG</div></div>
          <div className="hsp-iconCard"><div className="hsp-iconE">🌱</div><div className="hsp-iconL">VEG</div></div>
          <div className="hsp-iconCard"><div className="hsp-iconE">✨</div><div className="hsp-iconL">GF</div></div>
        </div>

        {/* Allergen ticker pinned bottom */}
        <div className="hsp-ticker">
          <div className="hsp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Allergens').toUpperCase()}:</div>
          <div className="hsp-tickerScroll">
            <span
              className="hsp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Edit hotspots — builder-only */}
        {!isLive && (
          <>
            <Hotspot section="header"     x={60}   y={80}   w={2040} h={620} />
            <Hotspot section="special"    x={60}   y={740}  w={2040} h={620} />
            <Hotspot section="menu"       x={60}   y={1400} w={2040} h={1340} />
            <Hotspot section="countdown"  x={60}   y={2780} w={1000} h={520} />
            <Hotspot section="chef"       x={1100} y={2780} w={1000} h={520} />
            <Hotspot section="header"     x={60}   y={3340} w={2040} h={260} />
            <Hotspot section="ticker"     x={0}    y={3600} w={2160} h={240} />
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

const CSS_HSP = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Permanent+Marker&family=Inter:wght@500;700;800&family=Caveat:wght@700&display=swap');

.hsp-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fef3c7;
  background:
    radial-gradient(ellipse at 20% 8%, rgba(236, 72, 153, .35) 0%, transparent 45%),
    radial-gradient(ellipse at 80% 28%, rgba(251, 146, 60, .28) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 100%, rgba(124, 58, 237, .35) 0%, transparent 55%),
    linear-gradient(180deg, #111827 0%, #1e1b4b 35%, #581c87 70%, #111827 100%);
  overflow: hidden;
}

/* Neon-sunset glow blobs */
.hsp-glow { position: absolute; border-radius: 50%; filter: blur(120px); pointer-events: none; }
.hsp-g1 { width: 700px; height: 700px; top: 5%; left: -10%; background: rgba(236,72,153,.45); animation: hsp-pulse 9s ease-in-out infinite; }
.hsp-g2 { width: 800px; height: 800px; top: 38%; right: -15%; background: rgba(251,146,60,.35); animation: hsp-pulse 11s ease-in-out infinite; animation-delay: -3s; }
.hsp-g3 { width: 900px; height: 900px; bottom: 5%; left: -8%; background: rgba(6,182,212,.30); animation: hsp-pulse 13s ease-in-out infinite; animation-delay: -6s; }
@keyframes hsp-pulse { 0%, 100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }

/* Floating yearbook decorations */
.hsp-deco { position: absolute; font-size: 110px; opacity: .18; animation: hsp-float 26s ease-in-out infinite; z-index: 1; filter: drop-shadow(0 6px 14px rgba(0,0,0,.4)); }
.hsp-d1 { top: 16%; left: 4%; }
.hsp-d2 { top: 38%; right: 3%; animation-delay: -4s; font-size: 96px; }
.hsp-d3 { top: 64%; left: 6%; animation-delay: -8s; }
.hsp-d4 { top: 82%; right: 4%; animation-delay: -12s; font-size: 100px; }
@keyframes hsp-float { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-46px) rotate(8deg); } }

/* HEADER — coffee cup + neon CAFÉ sign + clock pill */
.hsp-header {
  position: absolute; top: 100px; left: 60px; right: 60px; height: 600px;
  display: grid; grid-template-columns: 380px 1fr 380px; gap: 40px; z-index: 5;
  align-items: center;
}

/* Coffee cup CSS-art */
.hsp-cup {
  position: relative; width: 380px; height: 480px;
  display: flex; align-items: flex-end; justify-content: center;
  animation: hsp-cupTilt 5.4s ease-in-out infinite;
}
@keyframes hsp-cupTilt { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.hsp-cupBodyLogo {
  position: absolute; bottom: 60px; left: 50px; width: 280px; height: 280px;
  background: linear-gradient(180deg, #fef3c7 0%, #fbbf24 60%, #d97706 100%);
  border: 10px solid #1f2937;
  border-radius: 16px 16px 60px 60px;
  box-shadow: 0 18px 36px rgba(0,0,0,.5),
              inset 0 0 0 8px #ec4899,
              0 0 50px rgba(236,72,153,.4);
}
.hsp-cupBodyLogo::before {
  content: ''; position: absolute; top: 24px; left: 24px; right: 24px; height: 50px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-radius: 8px;
  box-shadow: inset 0 -4px 8px rgba(0,0,0,.4);
}
.hsp-cupBodyLogo::after {
  content: '☕'; position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
  font-size: 100px; line-height: 1;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.3));
}
.hsp-cupHandle {
  position: absolute; bottom: 110px; right: 22px;
  width: 70px; height: 130px;
  border: 16px solid #1f2937; border-left: none;
  border-radius: 0 60px 60px 0;
  z-index: -1;
  box-shadow: 4px 4px 0 rgba(236,72,153,.4);
}
.hsp-cupSaucer {
  position: absolute; bottom: 30px; left: 24px; right: 24px; height: 36px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border: 6px solid #1f2937;
  border-radius: 50%;
  box-shadow: 0 12px 24px rgba(0,0,0,.6);
}
.hsp-cupSteam {
  position: absolute; top: 30px; left: 0; right: 0; height: 200px;
  pointer-events: none;
}
.hsp-cupSteam span {
  position: absolute; top: 130px; width: 16px; height: 90px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.7) 50%, transparent 100%);
  border-radius: 10px;
  filter: blur(2px);
  animation: hsp-steam ease-in-out infinite;
}
@keyframes hsp-steam {
  0%   { transform: translateY(40px) scaleY(.6); opacity: 0; }
  40%  { opacity: .9; }
  100% { transform: translateY(-150px) scaleY(1.4); opacity: 0; }
}

/* Title stack */
.hsp-titleStack { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding-top: 6px; }
.hsp-dayBadge {
  font-family: 'Bungee', cursive;
  font-size: 50px; padding: 14px 50px;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  color: #fff; border: 5px solid #fef3c7;
  border-radius: 999px;
  box-shadow: 0 0 30px rgba(236,72,153,.6), 6px 6px 0 rgba(0,0,0,.4);
  letter-spacing: .2em;
  text-shadow: 3px 3px 0 rgba(0,0,0,.4);
  animation: hsp-badgeBob 3.6s ease-in-out infinite;
  line-height: 1;
}
@keyframes hsp-badgeBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.hsp-neon {
  position: relative;
  background: rgba(17, 24, 39, .65);
  backdrop-filter: blur(2px);
  border: 8px solid #ec4899; border-radius: 32px;
  padding: 36px 60px; text-align: center;
  box-shadow:
    0 0 0 6px #fef3c7,
    0 0 0 14px #ec4899,
    0 0 60px rgba(236,72,153,.65),
    0 0 120px rgba(251,146,60,.35),
    0 24px 48px rgba(0,0,0,.5);
  animation: hsp-neonFlicker 5.4s ease-in-out infinite;
}
@keyframes hsp-neonFlicker {
  0%, 95%, 100% {
    box-shadow: 0 0 0 6px #fef3c7, 0 0 0 14px #ec4899, 0 0 60px rgba(236,72,153,.65), 0 0 120px rgba(251,146,60,.35), 0 24px 48px rgba(0,0,0,.5);
  }
  97% {
    box-shadow: 0 0 0 6px #fef3c7, 0 0 0 14px #ec4899, 0 0 100px rgba(236,72,153,1), 0 0 200px rgba(251,146,60,.6), 0 24px 48px rgba(0,0,0,.5);
  }
}
.hsp-neon h1 {
  margin: 0; line-height: .92;
  font-family: 'Bungee', cursive; font-size: 200px;
  background: linear-gradient(135deg, #ec4899 0%, #f59e0b 50%, #06b6d4 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  -webkit-text-stroke: 3px rgba(0,0,0,.2);
  animation: hsp-shift 9s linear infinite;
  letter-spacing: .02em; text-transform: uppercase;
  filter: drop-shadow(0 0 30px rgba(236,72,153,.7)) drop-shadow(0 0 60px rgba(251,146,60,.4));
}
@keyframes hsp-shift { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
.hsp-neonSub { font-family: 'Caveat', cursive; font-size: 70px; color: #fbbf24; margin-top: 6px; text-shadow: 0 0 20px rgba(251,191,36,.6); }

/* Clock pill */
.hsp-clock {
  width: 380px; height: 380px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.1) 0%, rgba(17,24,39,.85) 60%, #111827 100%);
  border-radius: 50%;
  border: 14px solid #ec4899;
  box-shadow:
    0 0 0 6px #fef3c7,
    0 0 50px rgba(236,72,153,.6),
    inset 0 0 40px rgba(251,146,60,.2),
    0 22px 44px rgba(0,0,0,.5);
  animation: hsp-clockBob 3.6s ease-in-out infinite;
}
@keyframes hsp-clockBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.hsp-clockTop {
  font-family: 'Bungee', cursive; font-size: 130px; line-height: 1;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 24px rgba(236,72,153,.7));
}
.hsp-clockBottom { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 56px; color: #fbbf24; letter-spacing: .25em; text-shadow: 0 0 14px rgba(251,191,36,.6); margin-top: 10px; }

/* FEATURED — today's pick hero */
.hsp-featured {
  position: absolute; top: 760px; left: 60px; right: 60px; height: 600px;
  background: linear-gradient(135deg, rgba(17,24,39,.85) 0%, rgba(88,28,135,.6) 100%);
  border: 8px solid #ec4899;
  border-radius: 36px;
  padding: 36px 50px;
  display: flex; flex-direction: column;
  box-shadow:
    0 0 0 5px #fef3c7,
    0 0 80px rgba(236,72,153,.5),
    0 22px 44px rgba(0,0,0,.5);
  z-index: 4;
  overflow: hidden;
}
.hsp-featGlow {
  position: absolute; top: -30%; right: -10%; width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(251,146,60,.55), transparent 70%);
  filter: blur(40px); pointer-events: none;
  animation: hsp-pulse 6s ease-in-out infinite;
}
.hsp-featTag {
  font-family: 'Bungee', cursive; font-size: 46px;
  color: #fbbf24; letter-spacing: .2em;
  text-align: center; line-height: 1;
  text-shadow: 0 0 16px rgba(251,191,36,.7), 4px 4px 0 rgba(0,0,0,.4);
  position: relative; z-index: 1;
}
.hsp-featBody {
  flex: 1; display: flex; align-items: center; gap: 50px;
  margin-top: 20px;
  position: relative; z-index: 1;
}
.hsp-featEmoji {
  font-size: 280px; line-height: 1;
  width: 360px; height: 360px;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 60%, #d97706);
  border: 8px solid #ec4899;
  border-radius: 36px;
  box-shadow: 0 0 50px rgba(251,191,36,.6), inset 0 0 30px rgba(180,83,9,.3);
  filter: drop-shadow(0 6px 12px rgba(0,0,0,.4));
  flex: 0 0 auto;
}
.hsp-featImg { width: 320px; height: 320px; object-fit: cover; border-radius: 24px; }
.hsp-featTextWrap { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
.hsp-featName {
  font-family: 'Bungee', cursive;
  font-size: 130px; line-height: .94;
  color: #fef3c7;
  text-shadow:
    0 0 20px rgba(236,72,153,.7),
    0 0 40px rgba(251,146,60,.4),
    6px 6px 0 #ec4899;
  letter-spacing: .01em;
}
.hsp-featRow { display: flex; align-items: center; justify-content: space-between; gap: 30px; }
.hsp-featAllergens {
  font-family: 'Permanent Marker', cursive;
  font-size: 50px; color: #fbbf24;
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}
.hsp-featPrice {
  font-family: 'Bungee', cursive;
  font-size: 92px; color: #ec4899;
  text-shadow: 0 0 24px rgba(236,72,153,.7), 4px 4px 0 #1f2937;
  flex: 0 0 auto;
}

/* MENU BLOCK */
.hsp-menuBlock {
  position: absolute; top: 1420px; left: 60px; right: 60px; height: 1300px;
  background: linear-gradient(180deg, #fef3c7 0%, #fed7aa 100%);
  border: 12px solid #1f2937;
  border-radius: 36px;
  box-shadow:
    0 22px 44px rgba(0,0,0,.4),
    16px 16px 0 #fbbf24,
    24px 24px 0 #ec4899,
    0 0 80px rgba(236,72,153,.3);
  z-index: 3;
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: hsp-menuFloat 7s ease-in-out infinite;
}
@keyframes hsp-menuFloat { 0%, 100% { transform: rotate(-.3deg) translateY(0); } 50% { transform: rotate(.3deg) translateY(-6px); } }
.hsp-menuHeader {
  flex: 0 0 auto; padding: 36px 50px 20px;
  background: linear-gradient(180deg, #fef3c7 0%, #fff 100%);
  border-bottom: 5px dashed #ec4899;
}
.hsp-menuBlock h2 {
  margin: 0; line-height: 1; text-align: center;
  font-family: 'Bungee', cursive; font-size: 130px;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-transform: uppercase;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.15));
}
.hsp-date { text-align: center; font-family: 'Caveat', cursive; font-size: 60px; color: #9d174d; margin-top: 8px; }
.hsp-dayTabs { display: flex; justify-content: center; gap: 14px; padding: 24px 0 4px; }
.hsp-day {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 44px;
  padding: 16px 36px;
  border: 6px solid #1f2937; border-radius: 999px;
  background: #fef3c7; color: #92400e;
  letter-spacing: .12em;
  line-height: 1;
}
.hsp-dayToday {
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  color: #fff; border-color: #1f2937;
  transform: translateY(-4px);
  box-shadow: 0 8px 0 #1f2937, 0 0 0 5px #fbbf24, 0 0 30px rgba(236,72,153,.6);
  text-shadow: 2px 2px 0 rgba(0,0,0,.3);
}

.hsp-menuBody { flex: 1; padding: 28px 50px 36px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.hsp-items { display: flex; flex-direction: column; gap: 20px; flex: 1 1 0; min-height: 0; overflow: hidden; }
.hsp-item {
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: 32px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 6px solid #1f2937; border-radius: 24px;
  padding: 16px 36px;
  box-shadow: 8px 8px 0 #ec4899;
  overflow: hidden;
}
.hsp-itemEmoji {
  font-size: 130px; line-height: 1; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 150px; height: 150px;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.3));
}
.hsp-itemImg { width: 100%; height: 100%; object-fit: contain; border-radius: 12px; }
.hsp-itemInfo { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.hsp-itemName {
  font-family: 'Bungee', cursive; font-size: 78px; color: #1f2937; line-height: 1.02;
  letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 3px 3px 0 rgba(251,191,36,.4);
}
.hsp-itemMeta { font-family: 'Permanent Marker', cursive; font-size: 42px; color: #9d174d; margin-top: 8px; }
.hsp-leader { flex: 1 1 0; min-width: 30px; height: 0; border-bottom: 6px dotted rgba(236,72,153,.55); align-self: center; margin: 0 12px; transform: translateY(-12px); }
.hsp-itemPrice { font-family: 'Bungee', cursive; font-size: 80px; color: #ec4899; flex: 0 0 auto; text-shadow: 3px 3px 0 #1f2937; }

/* TWO-UP — Trophy + Yearbook */
.hsp-twoUp {
  position: absolute; top: 2780px; left: 60px; right: 60px; height: 540px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 36px;
  z-index: 4;
}

/* Trophy of the Week */
.hsp-trophyCard {
  position: relative;
  background: linear-gradient(180deg, rgba(17,24,39,.9) 0%, rgba(88,28,135,.7) 100%);
  border: 8px solid #fbbf24; border-radius: 30px;
  padding: 28px 32px;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  box-shadow: 0 18px 36px rgba(0,0,0,.5), 0 0 60px rgba(251,191,36,.3);
}
.hsp-trophyHeader {
  font-family: 'Bungee', cursive; font-size: 36px; color: #fbbf24;
  letter-spacing: .15em; line-height: 1;
  text-shadow: 0 0 14px rgba(251,191,36,.6), 3px 3px 0 #1f2937;
}
.hsp-trophy {
  position: relative; width: 240px; height: 280px;
  display: flex; flex-direction: column; align-items: center;
  animation: hsp-trophy 5.4s ease-in-out infinite;
}
@keyframes hsp-trophy { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
.hsp-handleL, .hsp-handleR { position: absolute; top: 28px; width: 50px; height: 80px; border: 12px solid #fbbf24; border-radius: 50%; z-index: 0; }
.hsp-handleL { left: 0; border-right: none; border-radius: 50% 0 0 50%; }
.hsp-handleR { right: 0; border-left: none; border-radius: 0 50% 50% 0; }
.hsp-cupBody {
  width: 200px; height: 170px;
  background: linear-gradient(180deg, #fde68a 0%, #fbbf24 50%, #d97706 100%);
  border: 6px solid #92400e;
  border-radius: 14px 14px 50% 50% / 14px 14px 30% 30%;
  box-shadow: 0 14px 28px rgba(0,0,0,.4), inset 0 0 20px rgba(255,255,255,.3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; position: relative; z-index: 1;
  padding: 10px 8px;
}
.hsp-cdIcon { font-size: 42px; line-height: 1; }
.hsp-cdLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px; color: #92400e; letter-spacing: .1em; text-transform: uppercase; line-height: 1.05; max-width: 160px; margin-top: 4px; }
.hsp-cdNum { font-family: 'Bungee', cursive; font-size: 70px; line-height: .9; color: #fff; text-shadow: 3px 3px 0 #92400e; }
.hsp-cdUnit { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px; color: #92400e; letter-spacing: .15em; }
.hsp-stem { width: 50px; height: 32px; background: linear-gradient(180deg, #fbbf24, #d97706); border-left: 5px solid #92400e; border-right: 5px solid #92400e; margin-top: -6px; position: relative; z-index: 1; }
.hsp-base { width: 150px; height: 30px; background: linear-gradient(180deg, #fbbf24, #b45309); border: 6px solid #92400e; border-radius: 10px; box-shadow: 0 8px 14px rgba(0,0,0,.4); position: relative; z-index: 1; }
.hsp-bdLbl {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 28px; color: #fbbf24;
  letter-spacing: .15em; text-transform: uppercase;
  margin-top: 14px; line-height: 1;
  text-shadow: 0 0 12px rgba(251,191,36,.5);
}
.hsp-bdNames {
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 50px; color: #fef3c7;
  margin-top: 6px; line-height: 1.05; text-align: center;
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}

/* Yearbook quote card */
.hsp-yearbook {
  position: relative;
  padding: 28px;
  background: #fffdf5;
  border: 6px solid #ec4899;
  box-shadow: 0 18px 36px rgba(0,0,0,.4), 0 0 50px rgba(236,72,153,.3);
  transform: rotate(-2deg);
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  animation: hsp-yearbook 9s ease-in-out infinite;
}
@keyframes hsp-yearbook { 0%, 100% { transform: rotate(-2deg) translateX(-3px); } 50% { transform: rotate(-2deg) translateX(3px); } }
.hsp-quoteCorner {
  position: absolute; bottom: 0; right: 0; width: 36px; height: 36px;
  background: linear-gradient(135deg, transparent 50%, #ec4899 50%);
}
.hsp-photo {
  width: 240px; height: 240px;
  background: linear-gradient(135deg, #06b6d4, #0e7490);
  display: flex; align-items: center; justify-content: center;
  font-size: 150px; line-height: 1; overflow: hidden;
  border: 4px solid #1f2937;
  box-shadow: 0 8px 18px rgba(0,0,0,.3);
  flex: 0 0 auto;
}
.hsp-photoImg { width: 100%; height: 100%; object-fit: cover; }
.hsp-pageInfo { margin-top: 14px; }
.hsp-chefName { font-family: 'Bungee', cursive; font-size: 44px; color: #1f2937; line-height: 1; letter-spacing: .02em; }
.hsp-chefRole { font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px; color: #ec4899; margin-top: 4px; }
.hsp-quote { font-family: 'Caveat', cursive; font-weight: 700; font-size: 42px; color: #4c1d95; margin-top: 14px; line-height: 1.1; max-width: 90%; }

/* Nutrition / allergen icon strip */
.hsp-iconStrip {
  position: absolute; top: 3360px; left: 60px; right: 60px; height: 220px;
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px;
  z-index: 4;
}
.hsp-iconCard {
  background: linear-gradient(180deg, rgba(17,24,39,.9), rgba(88,28,135,.7));
  border: 5px solid #ec4899; border-radius: 18px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 8px 18px rgba(0,0,0,.4), 0 0 20px rgba(236,72,153,.3);
  padding: 12px 8px;
}
.hsp-iconE { font-size: 80px; line-height: 1; filter: drop-shadow(0 3px 6px rgba(0,0,0,.4)); }
.hsp-iconL { font-family: 'Bungee', cursive; font-size: 30px; color: #fbbf24; letter-spacing: .08em; margin-top: 8px; line-height: 1; text-shadow: 2px 2px 0 #1f2937; }

/* TICKER */
.hsp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 220px;
  background: linear-gradient(90deg, #1f2937 0%, #4c1d95 100%);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 8px solid #ec4899;
  box-shadow: 0 -10px 40px rgba(236,72,153,.4), inset 0 0 60px rgba(0,0,0,.5);
}
.hsp-tickerStamp {
  flex: 0 0 auto; padding: 0 60px; height: 100%;
  background: linear-gradient(135deg, #ec4899, #f59e0b);
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .15em; font-size: 60px;
  color: #fff;
  text-shadow: 4px 4px 0 #1f2937;
  border-right: 6px solid #fef3c7;
  line-height: 1;
}
.hsp-tickerScroll { flex: 1; overflow: hidden; height: 100%; display: flex; align-items: center; }
.hsp-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 80px;
  color: #fbbf24;
  white-space: nowrap; padding-left: 100%; display: inline-block;
  text-shadow: 0 0 24px rgba(251,191,36,.7), 3px 3px 0 #1f2937;
  letter-spacing: .02em;
  animation: hsp-tickerScroll 60s linear infinite;
  will-change: transform;
}
@keyframes hsp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .12); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .18); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
