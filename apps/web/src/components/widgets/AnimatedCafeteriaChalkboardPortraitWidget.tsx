"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// Vertical re-flow of AnimatedCafeteriaChalkboardWidget — green chalkboard
// aesthetic preserved (dark green slate, chalk-textured handwriting, wooden
// frame border, chalk dust, eraser streaks) but stacked top-to-bottom for
// portrait. Same Cfg shape and data-field keys as the landscape widget so
// auto-form editor + canvas click-to-edit work identically.
//
// Stack:
//   • Wooden frame border around the entire stage (radial-gradient + inset)
//   • Top ~700px:    "TODAY'S MENU" headline + handwritten date + chalk clock
//   • ~700px:        Featured today hero — chalk-drawn frame with name + emoji
//   • ~1500px:       Weekly menu — Mon-Fri rows with chalk underlines + prices
//   • ~400px:        Chef's note polaroid — handwritten chalk message
//   • ~300px:        Erased-highlight strip — nutrition icons in muted chalk
//   • Bottom ~240px: Chalk ticker with eraser-streak background

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

  // Today's special (left in landscape, hero block in portrait)
  specialEmoji?: string;
  specialLabel?: string;
  specialName?: string;

  // Menu
  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];

  // Countdown (pizza slice)
  countdownEmoji?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;

  // Chef polaroid → portrait shows as chef's note
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

const DAY_KEYS: (keyof WeekMenu)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS: Record<keyof WeekMenu, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
};

function pickMenuForToday(week: WeekMenu | undefined, dow: number): MenuItem[] | null {
  if (!week) return null;
  if (dow >= 1 && dow <= 5) {
    const list = week[DAY_KEYS[dow - 1]];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  for (let i = DAY_KEYS.length - 1; i >= 0; i--) {
    const list = week[DAY_KEYS[i]];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return null;
}

export function AnimatedCafeteriaChalkboardPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
  const todayItems: MenuItem[] = useMemo(() => {
    const picked = pickMenuForToday(c.weekMenu, today);
    if (picked && picked.length > 0) return picked;
    if (Array.isArray(c.menuItems) && c.menuItems.length > 0) return c.menuItems;
    return [
      { emoji: '🍕', name: 'Pepperoni Pizza',           meta: '🌾 🧀',     price: '$3.25' },
      { emoji: '🥗', name: 'Garden Salad',              meta: 'veg',       price: '$2.50' },
      { emoji: '🍎', name: 'Fresh Fruit Cup',           meta: 'veg · gf',  price: '$1.75' },
      { emoji: '🥛', name: 'Milk · White or Chocolate', meta: '🧀',        price: '$0.75' },
      { emoji: '🍪', name: 'Chocolate Chip Cookie',     meta: '🌾 🥜 🧀',  price: '$1.00' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  // Hero special — prefer specialName/specialEmoji, fall back to first menu item.
  const heroEmoji = c.specialEmoji || todayItems[0]?.emoji || '🍕';
  const heroIsUrl = /^(https?:\/\/|\/|data:image\/)/.test(heroEmoji);
  const heroName = c.specialName || todayItems[0]?.name || 'Stuffed Crust Pepperoni';
  const heroLabel = c.specialLabel || "Today's Special";

  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

  // Build a 5-row weekly view: each row uses the configured menu's first item
  // (or falls back to today's first item) so the board always reads.
  const weeklyRows: { label: string; item: MenuItem; isToday: boolean }[] = useMemo(() => {
    const result: { label: string; item: MenuItem; isToday: boolean }[] = [];
    const fallbacks: MenuItem[] = [
      { emoji: '🍕', name: 'Pepperoni Pizza',     meta: '🌾 🧀',     price: '$3.25' },
      { emoji: '🌮', name: 'Taco Bar',            meta: '🌾 🧀',     price: '$3.50' },
      { emoji: '🍝', name: 'Spaghetti & Meatballs', meta: '🌾 🧀',   price: '$3.75' },
      { emoji: '🍔', name: 'Cheeseburger',        meta: '🌾 🧀',     price: '$3.25' },
      { emoji: '🐟', name: 'Fish Sticks & Fries', meta: '🌾',        price: '$3.00' },
    ];
    for (let i = 0; i < 5; i++) {
      const key = DAY_KEYS[i];
      const list = c.weekMenu?.[key];
      const pick: MenuItem | undefined = (Array.isArray(list) && list.length > 0)
        ? list[0]
        : (i + 1 === today ? todayItems[0] : fallbacks[i]);
      result.push({
        label: DAY_LABELS[key],
        item: pick || fallbacks[i],
        isToday: today === i + 1,
      });
    }
    return result;
  }, [c.weekMenu, todayItems, today]);

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 3;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'DAY' : ((c.countdownUnit || 'DAYS').toUpperCase());

  const birthdayList: string[] = useMemo(() => {
    if (Array.isArray(c.birthdayNames)) return c.birthdayNames.filter(Boolean);
    if (typeof c.birthdayNames === 'string') {
      return c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean);
    }
    return ['Maya', 'Eli', 'Sofia'];
  }, [c.birthdayNames]);
  const bdInline = birthdayList.join(' · ');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'Taco Tuesday this week  ✦  Pizza Day Friday  ✦  Allergen key: 🌾 = gluten · 🥜 = nuts · 🧀 = dairy · 🥚 = egg  ✦  Reload your lunch card at the office  ✦  Hydrate! Grab a water bottle at the salad bar';
  }, [c.tickerMessages]);

  const chefFace = c.chefEmoji || '👩‍🍳';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0e27',
      }}
    >
      <style>{CSS_CHP}</style>

      <div
        className="chp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Wooden frame border (outer) */}
        <div className="chp-frame" />

        {/* Inner chalkboard slate */}
        <div className="chp-board">
          {/* Drifting chalk dust + ambient food motifs (low opacity) */}
          <div className="chp-dust d1" />
          <div className="chp-dust d2" />
          <div className="chp-dust d3" />
          <div className="chp-floatFood f1">🍎</div>
          <div className="chp-floatFood f2">🥕</div>
          <div className="chp-floatFood f3">🥪</div>
          <div className="chp-floatFood f4">🥛</div>
          <div className="chp-floatFood f5">🍪</div>
          <div className="chp-floatFood f6">🥗</div>

          {/* HEADLINE — TODAY'S MENU + date + chalk clock */}
          <div className="chp-header">
            <div className="chp-headerInner">
              <div className="chp-eyebrow">~ school cafeteria ~</div>
              <h1 className="chp-h1" data-field="title" style={{ whiteSpace: 'pre-wrap' }}>
                {(c.title || "Today's Menu").toUpperCase()}
              </h1>
              <div className="chp-h1Underline" />
              <div className="chp-dateLine">{dateLine}</div>
              <div className="chp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
                {c.subtitle || '~ hot + fresh + ready at 11:30 ~'}
              </div>
              <div className="chp-clockRow">
                <span className="chp-clockTime">{hh}:{mm}</span>
                <span className="chp-clockAp">{ampm}</span>
              </div>
            </div>
            <div className="chp-utensilLeft">🥄</div>
            <div className="chp-utensilRight">🍴</div>
          </div>

          {/* HERO TODAY — chalk-drawn frame with featured menu item */}
          <div className="chp-hero">
            <div className="chp-heroFrame">
              <div className="chp-heroCorner tl" />
              <div className="chp-heroCorner tr" />
              <div className="chp-heroCorner bl" />
              <div className="chp-heroCorner br" />
              <div className="chp-heroEmoji">
                {heroIsUrl
                  ? <img src={heroEmoji} alt="" className="chp-heroImg" />
                  : <span>{heroEmoji}</span>}
              </div>
              <div className="chp-heroLabel" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>
                ★ {heroLabel.toUpperCase()} ★
              </div>
              <div className="chp-heroName" data-field="specialName" style={{ whiteSpace: 'pre-wrap' }}>
                {heroName}
              </div>
              <div className="chp-heroCountdown">
                <span className="chp-heroCdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>
                  {c.countdownLabel || 'Pizza Day in'}
                </span>
                <span className="chp-heroCdNum">{days}</span>
                <span className="chp-heroCdUnit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>
                  {unit}
                </span>
              </div>
            </div>
          </div>

          {/* WEEKLY MENU — Mon-Fri rows with chalk-drawn underlines */}
          <div className="chp-week">
            <div className="chp-weekHeader">
              <h2>This Week's Lineup</h2>
              <div className="chp-weekSub">~ all served with milk + a fruit cup ~</div>
            </div>
            <div className="chp-weekRows">
              {weeklyRows.map((row, i) => {
                const src = row.item.emoji || '';
                const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                return (
                  <div key={row.label} className={`chp-weekRow${row.isToday ? ' chp-weekRowToday' : ''}`} style={{ animationDelay: `${0.1 + i * 0.12}s` }}>
                    <div className="chp-weekDay">
                      <span className="chp-weekDayName">{row.label}</span>
                      {row.isToday && <span className="chp-weekTodayPill">TODAY</span>}
                    </div>
                    <div className="chp-weekEmoji">
                      {isUrl ? <img src={src} alt="" className="chp-weekImg" /> : (src || '🍽️')}
                    </div>
                    <div className="chp-weekName">{row.item.name || ''}</div>
                    {row.item.meta && <div className="chp-weekMeta">{row.item.meta}</div>}
                    {row.item.price && <div className="chp-weekPrice">{row.item.price}</div>}
                    <div className="chp-weekUnderline" />
                  </div>
                );
              })}
            </div>
          </div>

          {/* CHEF'S NOTE — handwritten chalk message in lower section */}
          <div className="chp-chef">
            <div className="chp-chefNote">
              <div className="chp-chefHeader">
                <div className="chp-chefAvatar">
                  {c.chefPhotoUrl
                    ? <img src={c.chefPhotoUrl} alt="" className="chp-chefImg" />
                    : <span>{chefFace}</span>}
                </div>
                <div className="chp-chefMeta">
                  <div className="chp-chefName" data-field="chefName" style={{ whiteSpace: 'pre-wrap' }}>
                    Chef {c.chefName || 'Ms. Rodriguez'}
                  </div>
                  <div className="chp-chefRole" data-field="chefRole" style={{ whiteSpace: 'pre-wrap' }}>
                    ~ {c.chefRole || 'lunch hero of the week'} ~
                  </div>
                </div>
              </div>
              <div className="chp-chefMsg">
                {`"hey friends — ${heroName.toLowerCase()} is fresh out of the oven today.${birthdayList.length > 0 ? `\nbig shout-out to ${bdInline} — happy birthday!` : ''} hydrate + see you in line."`}
              </div>
              <div className="chp-chefSig">— xo, chef</div>
            </div>
          </div>

          {/* ERASED HIGHLIGHT STRIP — nutrition icons in muted chalk */}
          <div className="chp-nutrition">
            <div className="chp-nutritionEraser" />
            <div className="chp-nutritionRow">
              <div className="chp-nutItem">
                <div className="chp-nutEmoji">🌾</div>
                <div className="chp-nutLbl">contains gluten</div>
              </div>
              <div className="chp-nutDot">·</div>
              <div className="chp-nutItem">
                <div className="chp-nutEmoji">🥜</div>
                <div className="chp-nutLbl">contains nuts</div>
              </div>
              <div className="chp-nutDot">·</div>
              <div className="chp-nutItem">
                <div className="chp-nutEmoji">🧀</div>
                <div className="chp-nutLbl">contains dairy</div>
              </div>
              <div className="chp-nutDot">·</div>
              <div className="chp-nutItem">
                <div className="chp-nutEmoji">🥚</div>
                <div className="chp-nutLbl">contains egg</div>
              </div>
              <div className="chp-nutDot">·</div>
              <div className="chp-nutItem">
                <div className="chp-nutEmoji">🌱</div>
                <div className="chp-nutLbl">vegetarian</div>
              </div>
            </div>
          </div>

          {/* CHALK TICKER — eraser-streak background, scrolling allergen text */}
          <div className="chp-ticker">
            <div className="chp-tickerStreaks" />
            <div className="chp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>
              {c.tickerStamp || '~ Cafeteria News ~'}
            </div>
            <div className="chp-tickerScroll">
              <span
                className="chp-tickerText"
                style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
              >{tickerText}</span>
            </div>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={80}   y={120}  w={2000} h={620} />
            <Hotspot section="special"    x={80}   y={780}  w={2000} h={680} />
            <Hotspot section="menu"       x={80}   y={1500} w={2000} h={1480} />
            <Hotspot section="chef"       x={80}   y={3020} w={2000} h={380} />
            <Hotspot section="nutrition"  x={80}   y={3420} w={2000} h={180} />
            <Hotspot section="ticker"     x={0}    y={3620} w={2160} h={220} />
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

const CSS_CHP = `
@import url('https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Caveat:wght@500;700&family=Permanent+Marker&family=Shadows+Into+Light&display=swap');

.chp-stage {
  position: relative; overflow: hidden;
  font-family: 'Caveat', cursive; color: #fafafa;
  background:
    radial-gradient(ellipse at 22% 18%, rgba(255,255,255,.08), transparent 42%),
    radial-gradient(ellipse at 80% 82%, rgba(255,255,255,.05), transparent 50%),
    linear-gradient(180deg, #1f3b2a 0%, #14532d 50%, #0f3d2b 100%);
}
.chp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    repeating-linear-gradient(45deg, transparent 0 80px, rgba(255,255,255,.012) 80px 82px),
    repeating-linear-gradient(-30deg, transparent 0 110px, rgba(255,255,255,.009) 110px 112px);
  z-index: 1;
}

/* WOODEN FRAME BORDER — radial wood grain + box-shadow inset */
.chp-frame {
  position: absolute; inset: 32px;
  border-radius: 24px;
  background:
    repeating-linear-gradient(90deg,
      #78350f 0 18px, #92400e 18px 24px,
      #6c2e0a 24px 40px, #a16207 40px 46px,
      #78350f 46px 64px),
    radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.08), transparent 60%);
  box-shadow:
    inset 0 0 0 14px rgba(0,0,0,.45),
    inset 0 0 80px rgba(0,0,0,.6),
    0 30px 100px rgba(0,0,0,.55);
  z-index: 0;
}
.chp-frame::before {
  content: ''; position: absolute; inset: 14px; border-radius: 16px;
  background: repeating-linear-gradient(180deg,
    rgba(0,0,0,.18) 0 1px, transparent 1px 5px,
    rgba(255,255,255,.05) 5px 6px, transparent 6px 14px);
  pointer-events: none;
}

/* CHALKBOARD SLATE — inner */
.chp-board {
  position: absolute; inset: 80px; border-radius: 8px;
  background:
    radial-gradient(ellipse at 22% 18%, rgba(255,255,255,.08), transparent 42%),
    radial-gradient(ellipse at 80% 82%, rgba(255,255,255,.05), transparent 50%),
    linear-gradient(180deg, #1f3b2a 0%, #14532d 50%, #0f3d2b 100%);
  box-shadow: inset 0 0 80px rgba(0,0,0,.6);
  overflow: hidden;
  z-index: 2;
}

/* CHALK DUST — drifting horizontal streaks */
.chp-dust {
  position: absolute; left: -10%; right: -10%; height: 60px;
  background: radial-gradient(ellipse 800px 30px at 50% 50%, rgba(255,255,255,.07), transparent 70%);
  pointer-events: none;
  animation: chp-dust 22s ease-in-out infinite;
  filter: blur(4px);
  z-index: 1;
}
.chp-dust.d1 { top: 8%;  animation-delay: 0s; }
.chp-dust.d2 { top: 42%; animation-delay: -6s; opacity: .65; }
.chp-dust.d3 { top: 76%; animation-delay: -14s; opacity: .55; }
@keyframes chp-dust {
  0%, 100% { transform: translateX(0); opacity: .4; }
  50%      { transform: translateX(120px); opacity: .8; }
}

/* AMBIENT FLOATING FOOD */
.chp-floatFood {
  position: absolute; font-size: 110px; opacity: .12;
  animation: chp-float 24s ease-in-out infinite;
  z-index: 1;
}
.chp-floatFood.f1 { top: 7%;  left: 4%;  animation-delay: 0s; }
.chp-floatFood.f2 { top: 28%; right: 4%; animation-delay: -5s; }
.chp-floatFood.f3 { top: 50%; left: 3%;  animation-delay: -10s; }
.chp-floatFood.f4 { top: 68%; right: 3%; animation-delay: -15s; }
.chp-floatFood.f5 { top: 82%; left: 5%;  animation-delay: -19s; }
.chp-floatFood.f6 { top: 92%; right: 6%; animation-delay: -22s; }
@keyframes chp-float {
  0%, 100% { transform: translateY(0) rotate(-5deg); }
  50%      { transform: translateY(-50px) rotate(8deg); }
}

/* HEADLINE — Top ~700px */
.chp-header {
  position: absolute; top: 60px; left: 60px; right: 60px; height: 660px;
  display: flex; align-items: center; justify-content: center;
  text-align: center;
  z-index: 5;
}
.chp-headerInner { position: relative; width: 100%; }
.chp-eyebrow {
  font-family: 'Caveat', cursive; font-size: 64px;
  color: #fde68a; letter-spacing: .12em;
  opacity: .85;
  transform: rotate(-1deg);
}
.chp-h1 {
  margin: 8px 0 0;
  font-family: 'Permanent Marker', cursive; font-size: 230px;
  color: #fef3c7; line-height: .92; letter-spacing: .015em;
  text-shadow: 6px 6px 0 rgba(0,0,0,.55), 0 0 28px rgba(254,243,199,.18);
  animation: chp-chalkFlicker 7s ease-in-out infinite;
}
@keyframes chp-chalkFlicker {
  0%, 92%, 100% { opacity: 1; }
  94%, 96%      { opacity: .82; }
}
.chp-h1Underline {
  margin: 18px auto 0;
  width: 1100px; height: 12px;
  background:
    radial-gradient(ellipse 540px 6px at 50% 50%, rgba(254,243,199,.95), transparent 75%);
  filter: blur(.6px);
  opacity: .8;
}
.chp-dateLine {
  margin-top: 20px;
  font-family: 'Architects Daughter', cursive; font-size: 76px;
  color: #fde68a; letter-spacing: .03em;
  transform: rotate(-.5deg);
}
.chp-sub {
  margin-top: 6px;
  font-family: 'Caveat', cursive; font-size: 64px;
  color: #fcd34d; opacity: .9;
  transform: rotate(-1deg);
}
.chp-clockRow {
  margin-top: 16px;
  display: flex; justify-content: center; align-items: baseline; gap: 18px;
  font-family: 'Shadows Into Light', cursive;
  color: #fef3c7;
  text-shadow: 3px 3px 0 rgba(0,0,0,.5);
  animation: chp-tick 9s ease-in-out infinite;
}
@keyframes chp-tick {
  0%, 100% { transform: rotate(-1deg); }
  50%      { transform: rotate(1deg); }
}
.chp-clockTime { font-size: 130px; line-height: 1; letter-spacing: .02em; }
.chp-clockAp   { font-family: 'Caveat', cursive; font-size: 64px; color: #fde68a; letter-spacing: .15em; }
.chp-utensilLeft, .chp-utensilRight {
  position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 130px; opacity: .9;
  filter: drop-shadow(0 6px 8px rgba(0,0,0,.4));
}
.chp-utensilLeft  { left: 20px;  transform: translateY(-50%) rotate(-25deg); }
.chp-utensilRight { right: 20px; transform: translateY(-50%) rotate(25deg);  }

/* HERO TODAY — chalk-drawn frame */
.chp-hero {
  position: absolute; top: 760px; left: 100px; right: 100px; height: 660px;
  display: flex; align-items: center; justify-content: center;
  z-index: 4;
}
.chp-heroFrame {
  position: relative; width: 100%; height: 100%;
  border: 8px dashed rgba(254,243,199,.65);
  border-radius: 28px;
  box-shadow:
    inset 0 0 0 4px rgba(254,243,199,.18),
    inset 0 0 80px rgba(0,0,0,.4),
    0 30px 60px rgba(0,0,0,.45);
  background: radial-gradient(ellipse at 40% 30%, rgba(254,243,199,.06), transparent 60%);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 30px 50px;
  text-align: center;
  filter: blur(.2px);
  animation: chp-heroBreathe 8s ease-in-out infinite;
}
@keyframes chp-heroBreathe {
  0%, 100% { transform: rotate(-.4deg); }
  50%      { transform: rotate(.4deg); }
}
.chp-heroCorner {
  position: absolute; width: 60px; height: 60px;
  border: 6px solid rgba(254,243,199,.85);
  filter: blur(.4px);
}
.chp-heroCorner.tl { top: -4px; left: -4px;  border-right: none; border-bottom: none; border-radius: 14px 0 0 0; }
.chp-heroCorner.tr { top: -4px; right: -4px; border-left: none;  border-bottom: none; border-radius: 0 14px 0 0; }
.chp-heroCorner.bl { bottom: -4px; left: -4px;  border-right: none; border-top: none; border-radius: 0 0 0 14px; }
.chp-heroCorner.br { bottom: -4px; right: -4px; border-left: none;  border-top: none; border-radius: 0 0 14px 0; }
.chp-heroEmoji {
  font-size: 240px; line-height: 1;
  filter: drop-shadow(0 12px 18px rgba(0,0,0,.55));
  animation: chp-heroWiggle 4s ease-in-out infinite;
}
.chp-heroImg { width: 240px; height: 240px; object-fit: contain; border-radius: 24px; }
@keyframes chp-heroWiggle {
  0%, 100% { transform: rotate(-6deg); }
  50%      { transform: rotate(6deg); }
}
.chp-heroLabel {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px;
  color: #fde68a; letter-spacing: .18em;
  margin-top: 14px;
  text-shadow: 2px 2px 0 rgba(0,0,0,.45);
}
.chp-heroName {
  margin-top: 6px;
  font-family: 'Permanent Marker', cursive; font-size: 130px;
  color: #fef3c7; line-height: 1.0;
  text-shadow: 5px 5px 0 rgba(0,0,0,.55);
  letter-spacing: .015em;
  max-width: 1700px;
}
.chp-heroCountdown {
  margin-top: 22px;
  display: flex; align-items: baseline; justify-content: center; gap: 18px;
  color: #fde68a;
}
.chp-heroCdLbl { font-family: 'Caveat', cursive; font-size: 50px; letter-spacing: .08em; }
.chp-heroCdNum {
  font-family: 'Permanent Marker', cursive; font-size: 110px;
  color: #fef3c7; line-height: 1;
  text-shadow: 4px 4px 0 rgba(0,0,0,.5);
}
.chp-heroCdUnit { font-family: 'Caveat', cursive; font-size: 50px; letter-spacing: .15em; }

/* WEEKLY MENU — Mon-Fri rows */
.chp-week {
  position: absolute; top: 1480px; left: 80px; right: 80px; height: 1500px;
  z-index: 3;
  display: flex; flex-direction: column;
}
.chp-weekHeader { text-align: center; margin-bottom: 14px; }
.chp-weekHeader h2 {
  margin: 0; font-family: 'Permanent Marker', cursive; font-size: 120px;
  color: #fef3c7; line-height: 1; letter-spacing: .015em;
  text-shadow: 5px 5px 0 rgba(0,0,0,.55);
}
.chp-weekSub {
  margin-top: 4px;
  font-family: 'Caveat', cursive; font-size: 56px; color: #fde68a; opacity: .9;
}
.chp-weekRows {
  flex: 1; display: flex; flex-direction: column; gap: 10px;
  margin-top: 24px;
  padding: 0 30px;
}
.chp-weekRow {
  position: relative;
  display: grid;
  grid-template-columns: 360px 130px 1fr 240px 200px;
  align-items: center;
  gap: 26px;
  padding: 18px 24px;
  flex: 1 1 0; min-height: 0;
  animation: chp-weekIn .7s ease-out both;
}
@keyframes chp-weekIn {
  from { opacity: 0; transform: translateX(-30px); }
  to   { opacity: 1; transform: translateX(0); }
}
.chp-weekRow .chp-weekUnderline {
  position: absolute; left: 24px; right: 24px; bottom: 8px; height: 6px;
  background: radial-gradient(ellipse 600px 4px at 50% 50%, rgba(254,243,199,.55), transparent 75%);
  filter: blur(.6px);
  opacity: .7;
}
.chp-weekRow:last-child .chp-weekUnderline { display: none; }
.chp-weekRowToday {
  background:
    radial-gradient(ellipse at 50% 50%, rgba(253,230,138,.14), transparent 75%);
  border-radius: 16px;
  box-shadow: inset 0 0 0 2px rgba(253,230,138,.35);
}
.chp-weekDay {
  display: flex; align-items: center; gap: 22px;
}
.chp-weekDayName {
  font-family: 'Permanent Marker', cursive; font-size: 86px;
  color: #fef3c7; line-height: 1;
  text-shadow: 3px 3px 0 rgba(0,0,0,.5);
  letter-spacing: .02em;
}
.chp-weekTodayPill {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 36px;
  color: #1f3b2a; background: #fde68a;
  padding: 6px 14px; border-radius: 999px;
  letter-spacing: .12em;
  transform: rotate(-3deg);
  box-shadow: 0 4px 8px rgba(0,0,0,.4);
}
.chp-weekEmoji {
  font-size: 96px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.4));
}
.chp-weekImg { width: 96px; height: 96px; object-fit: contain; border-radius: 12px; }
.chp-weekName {
  font-family: 'Architects Daughter', cursive; font-size: 76px;
  color: #fafafa; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 2px 2px 0 rgba(0,0,0,.45);
}
.chp-weekMeta {
  font-family: 'Caveat', cursive; font-size: 46px;
  color: #fca5a5; opacity: .95; letter-spacing: .04em;
  text-align: center;
}
.chp-weekPrice {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 70px;
  color: #fde68a; text-align: right;
  letter-spacing: .03em;
  text-shadow: 2px 2px 0 rgba(0,0,0,.45);
}

/* CHEF'S NOTE */
.chp-chef {
  position: absolute; top: 3020px; left: 80px; right: 80px; height: 380px;
  z-index: 4;
  display: flex; align-items: center; justify-content: center;
}
.chp-chefNote {
  position: relative; width: 100%; height: 100%;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(254,243,199,.08), transparent 60%),
    rgba(15, 61, 43, .55);
  border-radius: 22px;
  box-shadow: inset 0 0 0 3px rgba(254,243,199,.25), inset 0 0 60px rgba(0,0,0,.35);
  padding: 28px 44px;
  display: grid; grid-template-columns: 1fr; gap: 6px;
  transform: rotate(-.6deg);
}
.chp-chefHeader { display: flex; align-items: center; gap: 28px; }
.chp-chefAvatar {
  width: 130px; height: 130px; border-radius: 50%;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 4px solid rgba(254,243,199,.65);
  display: flex; align-items: center; justify-content: center;
  font-size: 90px; line-height: 1;
  overflow: hidden;
  box-shadow: 0 8px 16px rgba(0,0,0,.45);
}
.chp-chefImg { width: 100%; height: 100%; object-fit: cover; }
.chp-chefMeta { display: flex; flex-direction: column; gap: 2px; }
.chp-chefName {
  font-family: 'Permanent Marker', cursive; font-size: 60px;
  color: #fef3c7; line-height: 1;
  text-shadow: 2px 2px 0 rgba(0,0,0,.45);
}
.chp-chefRole {
  font-family: 'Caveat', cursive; font-size: 42px;
  color: #fde68a; opacity: .9;
}
.chp-chefMsg {
  font-family: 'Architects Daughter', cursive; font-size: 50px;
  color: #fafafa; line-height: 1.2;
  white-space: pre-wrap;
  margin-top: 4px;
}
.chp-chefSig {
  font-family: 'Caveat', cursive; font-style: italic; font-size: 44px;
  color: #fde68a; text-align: right; opacity: .85;
  margin-top: 2px;
}

/* ERASED HIGHLIGHT STRIP — nutrition icons */
.chp-nutrition {
  position: absolute; top: 3420px; left: 80px; right: 80px; height: 180px;
  z-index: 4;
  display: flex; align-items: center; justify-content: center;
}
.chp-nutritionEraser {
  position: absolute; inset: 8px;
  background:
    radial-gradient(ellipse 60% 70% at 20% 50%, rgba(254,243,199,.16), transparent 70%),
    radial-gradient(ellipse 60% 70% at 80% 50%, rgba(254,243,199,.14), transparent 70%),
    repeating-linear-gradient(95deg,
      rgba(255,255,255,.03) 0 30px,
      rgba(255,255,255,.06) 30px 32px,
      rgba(255,255,255,.02) 32px 80px);
  border-radius: 18px;
  filter: blur(.4px);
}
.chp-nutritionRow {
  position: relative;
  display: flex; align-items: center; gap: 36px;
  padding: 0 30px;
}
.chp-nutItem { display: flex; align-items: center; gap: 14px; }
.chp-nutEmoji { font-size: 70px; line-height: 1; opacity: .85; }
.chp-nutLbl {
  font-family: 'Caveat', cursive; font-size: 46px; letter-spacing: .04em;
  color: rgba(254,243,199,.78);
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}
.chp-nutDot {
  font-family: 'Caveat', cursive; font-size: 60px;
  color: rgba(254,243,199,.55);
  line-height: 1;
}

/* CHALK TICKER — eraser-streak background */
.chp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 220px;
  background:
    repeating-linear-gradient(90deg,
      #78350f 0 18px, #92400e 18px 24px,
      #78350f 24px 42px, #a16207 42px 48px);
  display: flex; align-items: center;
  border-top: 8px solid #1f3b2a;
  z-index: 6;
  box-shadow: 0 -16px 40px rgba(0,0,0,.5);
}
.chp-tickerStreaks {
  position: absolute; inset: 18px; border-radius: 8px;
  background:
    radial-gradient(ellipse 220px 20px at 18% 50%, rgba(254,243,199,.18), transparent 75%),
    radial-gradient(ellipse 280px 18px at 62% 50%, rgba(254,243,199,.12), transparent 75%),
    radial-gradient(ellipse 200px 16px at 92% 50%, rgba(254,243,199,.14), transparent 75%),
    linear-gradient(180deg, #14532d 0%, #0f3d2b 100%);
  box-shadow: inset 0 0 30px rgba(0,0,0,.55);
  filter: blur(.3px);
  z-index: 1;
}
.chp-tickerStamp {
  position: relative; z-index: 2;
  flex: 0 0 auto; padding: 0 50px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: #fef3c7; display: flex; align-items: center;
  font-family: 'Permanent Marker', cursive; font-size: 70px;
  letter-spacing: .03em;
  border-right: 3px dashed #fde68a;
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}
.chp-tickerScroll {
  position: relative; z-index: 2;
  flex: 1; height: 100%; display: flex; align-items: center;
  overflow: hidden;
  margin: 18px 0;
}
.chp-tickerText {
  font-family: 'Architects Daughter', cursive; font-size: 80px;
  color: #fafafa; white-space: nowrap;
  padding-left: 100%;
  display: inline-block;
  text-shadow: 2px 2px 0 rgba(0,0,0,.5);
  animation: chp-tickerScroll 60s linear infinite;
  will-change: transform;
}
@keyframes chp-tickerScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 14px; }
.aw-hotspot:hover { background-color: rgba(253, 230, 138, .10); box-shadow: inset 0 0 0 4px rgba(253, 230, 138, .55); }
.aw-hotspot:focus-visible { background-color: rgba(253, 230, 138, .16); box-shadow: inset 0 0 0 4px rgba(253, 230, 138, .85); }
`;
