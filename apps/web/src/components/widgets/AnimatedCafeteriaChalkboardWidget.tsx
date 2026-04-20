"use client";

// PORTED 2026-04-20 from scratch/design/animated-cafeteria-chalkboard.html — transform:scale pattern, isLive-gated hotspots.
// Green chalkboard with chalk-textured text, wooden frame edges, erased-area highlights.
// Same 5-day weekMenu shape as AnimatedCafeteriaElementaryWidget.

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

  // Today's special (left)
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

  // Chef polaroid
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

export function AnimatedCafeteriaChalkboardWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { emoji: '🍕', name: 'Pepperoni Pizza',        meta: '🌾 🧀',     price: '$3.25' },
      { emoji: '🥗', name: 'Garden Salad',           meta: 'veg',       price: '$2.50' },
      { emoji: '🍎', name: 'Fresh Fruit Cup',        meta: 'veg · gf',  price: '$1.75' },
      { emoji: '🥛', name: 'Milk · White or Chocolate', meta: '🧀',     price: '$0.75' },
      { emoji: '🍪', name: 'Chocolate Chip Cookie',  meta: '🌾 🥜 🧀',  price: '$1.00' },
    ];
  }, [c.weekMenu, c.menuItems, today]);

  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

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
  const specialEmoji = c.specialEmoji || '🍕';
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
      <style>{CSS_CHALK}</style>

      <div
        className="ch-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="ch-frame" />
        <div className="ch-board">
          <div className="ch-floatFood f1">🍎</div>
          <div className="ch-floatFood f2">🥕</div>
          <div className="ch-floatFood f3">🥪</div>
          <div className="ch-floatFood f4">🥛</div>

          <div className="ch-header">
            <div className="ch-logo">
              <div className="ch-puff p1" />
              <div className="ch-puff p3" />
              <div className="ch-puff p2" />
              <div className="ch-hatBand" />
              <span className="ch-utensil spoon">🥄</span>
              <span className="ch-utensil fork">🍴</span>
            </div>
            <div className="ch-title">
              <h1>{c.title || "Today's Menu"}</h1>
              <div className="ch-sub">{c.subtitle || '~ hot + fresh + ready at 11:30 ~'}</div>
            </div>
            <div className="ch-clock">
              <div className="ch-clockT">{hh}:{mm}</div>
              <div className="ch-clockAp">{ampm}</div>
            </div>
          </div>

          <div className="ch-grid">
            <div className="ch-special">
              <div className="ch-plate">
                {isSpecialUrl ? <img src={specialEmoji} alt="" className="ch-plateImg" /> : specialEmoji}
              </div>
              <div className="ch-specialLbl">★ {(c.specialLabel || "Today's Special").toUpperCase()} ★</div>
              <div className="ch-specialName">{c.specialName || 'Stuffed Crust Pepperoni'}</div>
            </div>

            <div className="ch-menu">
              <div className="ch-menuHeader">
                <h2>Main Line</h2>
                <div className="ch-date">{dateLine}</div>
              </div>
              <div className="ch-items">
                {menuItems.slice(0, 6).map((it, i) => {
                  const src = it.emoji || '';
                  const isUrl = /^(https?:\/\/|\/|data:image\/)/.test(src);
                  return (
                    <div key={i} className="ch-item">
                      <span className="ch-itemEmoji">
                        {isUrl ? <img src={src} alt="" className="ch-itemImg" /> : (src || '🍽️')}
                      </span>
                      <span className="ch-nm">{it.name || ''}</span>
                      {it.meta && <span className="ch-allergen">{it.meta}</span>}
                      <span className="ch-dots" />
                      {it.price && <span className="ch-price">{it.price}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="ch-countdown">
              <div className="ch-slice">
                <div className="ch-crust" />
                <div className="ch-cheese" />
                <div className="ch-pep p1" />
                <div className="ch-pep p2" />
                <div className="ch-pep p3" />
                <div className="ch-pep p4" />
                <div className="ch-sliceTxt">
                  <div className="ch-cdLbl">{c.countdownLabel || 'Pizza Day in'}</div>
                  <div className="ch-cdNum">{days}</div>
                  <div className="ch-cdUnit">{unit}</div>
                </div>
              </div>
            </div>

            <div className="ch-chef">
              <div className="ch-polaroid">
                <div className="ch-photo">
                  {c.chefPhotoUrl
                    ? <img src={c.chefPhotoUrl} alt="" className="ch-chefPhoto" />
                    : <span>{chefFace}</span>}
                </div>
                <div className="ch-caption">
                  {c.chefName || 'Ms. Rodriguez'}
                  <small>~ {c.chefRole || 'lunch hero of the week'} ~</small>
                </div>
              </div>
            </div>

            <div className="ch-birthdays">
              <div className="ch-cake">
                <div className="ch-candle c1" />
                <div className="ch-candle c2" />
                <div className="ch-candle c3" />
                <div className="ch-flame f1" />
                <div className="ch-flame f2" />
                <div className="ch-flame f3" />
                <div className="ch-layer l3" />
                <div className="ch-layer l2" />
                <div className="ch-layer l1" />
              </div>
              <div className="ch-bdLbl">★ Birthdays Today ★</div>
              <div className="ch-bdNames">{bdInline}</div>
            </div>
          </div>

          <div className="ch-ticker">
            <div className="ch-tickerInner">
              <div className="ch-tickerStamp">{c.tickerStamp || '~ Cafeteria News ~'}</div>
              <div className="ch-tickerScroll">
                <span
                  className="ch-tickerText"
                  style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 44)}s` }}
                >{tickerText}</span>
              </div>
            </div>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={96}   y={80}  w={200}  h={200} />
            <Hotspot section="header"    x={340}  y={80}  w={1240} h={200} />
            <Hotspot section="header"    x={1624} y={80}  w={200}  h={200} />
            <Hotspot section="special"   x={96}   y={310} w={340}  h={280} />
            <Hotspot section="menu"      x={468}  y={310} w={984}  h={570} />
            <Hotspot section="countdown" x={1484} y={310} w={340}  h={280} />
            <Hotspot section="chef"      x={96}   y={600} w={340}  h={280} />
            <Hotspot section="birthdays" x={1484} y={600} w={340}  h={280} />
            <Hotspot section="ticker"    x={20}   y={910} w={1880} h={150} />
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

const CSS_CHALK = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Fredoka:wght@500;700&family=Permanent+Marker&family=Shadows+Into+Light&display=swap');

.ch-stage {
  position: relative; overflow: hidden;
  font-family: 'Fredoka', sans-serif; color: #fafafa;
  background:
    radial-gradient(ellipse at 20% 30%, rgba(255,255,255,.06), transparent 40%),
    radial-gradient(ellipse at 80% 70%, rgba(255,255,255,.04), transparent 50%),
    linear-gradient(135deg, #0f3d2b 0%, #14532d 50%, #0f3d2b 100%);
}
.ch-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    repeating-linear-gradient(45deg, transparent 0 60px, rgba(255,255,255,.012) 60px 62px),
    repeating-linear-gradient(-30deg, transparent 0 80px, rgba(255,255,255,.008) 80px 82px);
}

.ch-frame {
  position: absolute; inset: 20px; border-radius: 14px;
  background:
    repeating-linear-gradient(90deg,
      #78350f 0 12px, #92400e 12px 16px, #78350f 16px 28px, #a16207 28px 32px);
  box-shadow:
    inset 0 0 0 10px rgba(0,0,0,.3),
    0 20px 60px rgba(0,0,0,.5);
  z-index: 0;
}
.ch-board {
  position: absolute; inset: 52px; border-radius: 4px;
  background:
    radial-gradient(ellipse at 20% 30%, rgba(255,255,255,.06), transparent 40%),
    radial-gradient(ellipse at 80% 70%, rgba(255,255,255,.04), transparent 50%),
    linear-gradient(135deg, #0f3d2b 0%, #14532d 50%, #0f3d2b 100%);
  box-shadow: inset 0 0 40px rgba(0,0,0,.5);
  z-index: 1;
  overflow: hidden;
}

.ch-floatFood {
  position: absolute; font-size: 64px; opacity: .12;
  animation: ch-float 18s ease-in-out infinite;
  z-index: 1;
}
.ch-floatFood.f1 { top: 15%; left: 6%; animation-delay: 0s; }
.ch-floatFood.f2 { top: 65%; left: 3%; animation-delay: -5s; }
.ch-floatFood.f3 { top: 18%; right: 5%; animation-delay: -9s; }
.ch-floatFood.f4 { top: 72%; right: 4%; animation-delay: -13s; }
@keyframes ch-float {
  0%, 100% { transform: translateY(0) rotate(-5deg); }
  50%      { transform: translateY(-30px) rotate(8deg); }
}

.ch-header {
  position: absolute; top: 28px; left: 44px; right: 44px;
  display: grid; grid-template-columns: 200px 1fr 200px;
  gap: 40px; z-index: 5; align-items: center;
}

.ch-logo {
  position: relative; width: 200px; height: 200px;
  display: flex; align-items: center; justify-content: center;
  animation: ch-logoBob 4.5s ease-in-out infinite;
}
@keyframes ch-logoBob {
  0%, 100% { transform: rotate(-4deg) translateY(0); }
  50%      { transform: rotate(4deg) translateY(-6px); }
}
.ch-hatBand {
  position: absolute; bottom: 30px; left: 20px; right: 20px; height: 40px;
  background: #fafafa; border-radius: 6px;
  box-shadow: 0 4px 0 rgba(0,0,0,.2), inset 0 -6px 0 rgba(0,0,0,.1);
}
.ch-puff {
  position: absolute; background: #fafafa;
  border-radius: 50%;
  box-shadow: inset -6px -8px 0 rgba(0,0,0,.08), 0 4px 8px rgba(0,0,0,.2);
}
.ch-puff.p1 { left: 20px; top: 30px; width: 80px; height: 90px; }
.ch-puff.p2 { left: 60px; top: 10px; width: 90px; height: 100px; z-index: 1; }
.ch-puff.p3 { left: 100px; top: 30px; width: 80px; height: 90px; }
.ch-utensil {
  position: absolute; bottom: 30px; z-index: 2;
  font-size: 54px; line-height: 1;
}
.ch-utensil.spoon { left: 50px; transform: rotate(-25deg); }
.ch-utensil.fork  { right: 50px; transform: rotate(25deg); }

.ch-title {
  position: relative; text-align: center;
  padding-top: 16px;
}
.ch-title h1 {
  margin: 0; line-height: .92;
  font-family: 'Shadows Into Light', cursive;
  font-size: 128px; color: #fef3c7;
  text-shadow: 3px 3px 0 rgba(0,0,0,.5);
  letter-spacing: .02em;
  animation: ch-chalkFlicker 6s ease-in-out infinite;
}
@keyframes ch-chalkFlicker {
  0%, 95%, 100% { opacity: 1; }
  97%           { opacity: .85; }
}
.ch-sub {
  font-family: 'Caveat', cursive; font-size: 48px;
  color: #fde68a; margin-top: -4px;
  transform: rotate(-1deg);
}
.ch-title::after {
  content: ''; display: block;
  height: 8px; width: 360px; margin: 14px auto 0;
  background: radial-gradient(ellipse 180px 4px at 50% 50%, #fafafa, transparent 70%);
  opacity: .7;
}

.ch-clock {
  position: relative; width: 200px; height: 200px;
  display: flex; align-items: center; justify-content: center;
  animation: ch-clockTick 8s ease-in-out infinite;
}
@keyframes ch-clockTick {
  0%, 100% { transform: rotate(-2deg); }
  50%      { transform: rotate(2deg); }
}
.ch-clock::before {
  content: ''; position: absolute; inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle, transparent 82px, rgba(254,243,199,.9) 82px, rgba(254,243,199,.9) 90px, transparent 90px);
  filter: blur(.3px);
}
.ch-clock::after {
  content: ''; position: absolute; inset: 20px;
  border-radius: 50%;
  background: radial-gradient(ellipse at 35% 35%, rgba(255,255,255,.12), transparent 70%);
  box-shadow: inset 0 0 20px rgba(0,0,0,.4);
}
.ch-clockT {
  position: relative; z-index: 1;
  font-family: 'Shadows Into Light', cursive; font-size: 64px; line-height: 1;
  color: #fef3c7; text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}
.ch-clockAp {
  position: absolute; bottom: 46px; z-index: 1;
  font-family: 'Caveat', cursive; font-size: 28px; color: #fde68a;
  letter-spacing: .2em;
}

.ch-grid {
  position: absolute; top: 258px; left: 44px; right: 44px; bottom: 148px;
  display: grid;
  grid-template-columns: 340px 1fr 340px;
  grid-template-rows: 1fr 1fr;
  gap: 32px;
  z-index: 3;
}

.ch-special {
  grid-column: 1; grid-row: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 24px; text-align: center;
}
.ch-special::before {
  content: ''; position: absolute; top: 10%; left: 50%; transform: translateX(-50%);
  width: 280px; height: 280px; border-radius: 50%;
  background:
    conic-gradient(from 0deg,
      transparent 0 12deg, rgba(254,243,199,.3) 12deg 16deg,
      transparent 16deg 28deg, rgba(254,243,199,.3) 28deg 32deg,
      transparent 32deg 44deg, rgba(254,243,199,.3) 44deg 48deg,
      transparent 48deg 60deg, rgba(254,243,199,.3) 60deg 64deg,
      transparent 64deg 76deg, rgba(254,243,199,.3) 76deg 80deg,
      transparent 80deg 92deg, rgba(254,243,199,.3) 92deg 96deg,
      transparent 96deg 108deg, rgba(254,243,199,.3) 108deg 112deg,
      transparent 112deg 124deg, rgba(254,243,199,.3) 124deg 128deg,
      transparent 128deg 140deg, rgba(254,243,199,.3) 140deg 144deg,
      transparent 144deg 156deg, rgba(254,243,199,.3) 156deg 160deg,
      transparent 160deg 172deg, rgba(254,243,199,.3) 172deg 176deg,
      transparent 176deg 188deg, rgba(254,243,199,.3) 188deg 192deg,
      transparent 192deg 204deg, rgba(254,243,199,.3) 204deg 208deg,
      transparent 208deg 220deg, rgba(254,243,199,.3) 220deg 224deg,
      transparent 224deg 236deg, rgba(254,243,199,.3) 236deg 240deg,
      transparent 240deg 252deg, rgba(254,243,199,.3) 252deg 256deg,
      transparent 256deg 268deg, rgba(254,243,199,.3) 268deg 272deg,
      transparent 272deg 284deg, rgba(254,243,199,.3) 284deg 288deg,
      transparent 288deg 300deg, rgba(254,243,199,.3) 300deg 304deg,
      transparent 304deg 316deg, rgba(254,243,199,.3) 316deg 320deg,
      transparent 320deg 332deg, rgba(254,243,199,.3) 332deg 336deg,
      transparent 336deg 348deg, rgba(254,243,199,.3) 348deg 352deg,
      transparent 352deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 90px, #000 90px, #000 140px, transparent 140px);
          mask: radial-gradient(circle, transparent 90px, #000 90px, #000 140px, transparent 140px);
  animation: ch-starSpin 24s linear infinite;
}
@keyframes ch-starSpin { to { transform: translateX(-50%) rotate(360deg); } }
.ch-plate {
  position: relative; z-index: 1;
  font-size: 140px; line-height: 1;
  animation: ch-plateWiggle 3.6s ease-in-out infinite;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.5));
  width: 160px; height: 160px;
  display: inline-flex; align-items: center; justify-content: center;
}
.ch-plateImg { width: 100%; height: 100%; object-fit: contain; border-radius: 12px; }
@keyframes ch-plateWiggle {
  0%, 100% { transform: rotate(-6deg); }
  50%      { transform: rotate(6deg); }
}
.ch-specialLbl {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 28px;
  color: #fde68a; letter-spacing: .15em; text-transform: uppercase;
  margin-top: 8px;
}
.ch-specialName {
  font-family: 'Shadows Into Light', cursive; font-size: 48px;
  color: #fef3c7; line-height: 1.05; margin-top: 4px;
  text-shadow: 2px 2px 0 rgba(0,0,0,.5);
}

.ch-menu {
  grid-column: 2; grid-row: 1 / span 2;
  position: relative;
  display: flex; flex-direction: column; justify-content: center;
  padding: 40px 60px;
}
.ch-menu::before {
  content: ''; position: absolute; inset: 0;
  border: 6px dashed rgba(254,243,199,.55);
  border-radius: 20px;
  filter: blur(.2px);
}
.ch-menu::after {
  content: ''; position: absolute; inset: 10px;
  border: 2px solid rgba(254,243,199,.25);
  border-radius: 14px;
  filter: blur(.3px);
}
.ch-menuHeader { position: relative; text-align: center; margin-bottom: 20px; }
.ch-menuHeader h2 {
  margin: 0; line-height: 1;
  font-family: 'Shadows Into Light', cursive; font-size: 72px;
  color: #fef3c7; letter-spacing: .02em;
  text-shadow: 3px 3px 0 rgba(0,0,0,.5);
}
.ch-date {
  font-family: 'Caveat', cursive; font-size: 32px; color: #fde68a;
  margin-top: -4px;
}
.ch-items {
  position: relative; display: flex; flex-direction: column; gap: 14px;
  padding: 0 20px;
}
.ch-item {
  display: flex; align-items: baseline; gap: 18px;
  font-family: 'Shadows Into Light', cursive;
  color: #fafafa;
  animation: ch-itemIn .6s ease-out both;
}
.ch-item:nth-child(1) { animation-delay: .1s; }
.ch-item:nth-child(2) { animation-delay: .25s; }
.ch-item:nth-child(3) { animation-delay: .4s; }
.ch-item:nth-child(4) { animation-delay: .55s; }
.ch-item:nth-child(5) { animation-delay: .7s; }
.ch-item:nth-child(6) { animation-delay: .85s; }
@keyframes ch-itemIn {
  from { opacity: 0; transform: translateX(-20px); }
  to   { opacity: 1; transform: translateX(0); }
}
.ch-itemEmoji {
  font-size: 56px; line-height: 1; width: 60px; text-align: center;
  display: inline-flex; align-items: center; justify-content: center;
  height: 60px;
}
.ch-itemImg { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; }
.ch-nm { flex: 1; font-size: 44px; line-height: 1.1; }
.ch-allergen {
  font-family: 'Caveat', cursive; font-size: 26px;
  color: #fca5a5; padding-left: 12px; letter-spacing: .05em;
}
.ch-dots {
  flex: 0 0 60px; border-bottom: 3px dotted rgba(254,243,199,.35);
  margin-bottom: 8px; align-self: flex-end;
}
.ch-price {
  font-family: 'Caveat', cursive; font-size: 36px; color: #fde68a;
  letter-spacing: .03em;
}

.ch-countdown {
  grid-column: 3; grid-row: 1;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.ch-slice {
  position: relative; width: 260px; height: 260px;
  animation: ch-sliceSpin 6s ease-in-out infinite;
  transform-origin: 50% 100%;
}
@keyframes ch-sliceSpin {
  0%, 100% { transform: rotate(-8deg); }
  50%      { transform: rotate(8deg); }
}
.ch-crust {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 60%, #92400e 100%);
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.4));
}
.ch-cheese {
  position: absolute; top: 50px; left: 14%; right: 14%; bottom: 14%;
  background: linear-gradient(180deg, #fef3c7 0%, #fbbf24 100%);
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}
.ch-pep {
  position: absolute; width: 28px; height: 28px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #f87171, #991b1b);
  box-shadow: inset -2px -3px 0 rgba(0,0,0,.2);
}
.ch-pep.p1 { top: 110px; left: 45%; }
.ch-pep.p2 { top: 150px; left: 30%; }
.ch-pep.p3 { top: 150px; right: 30%; }
.ch-pep.p4 { top: 195px; left: 50%; transform: translateX(-50%); }
.ch-sliceTxt {
  position: absolute; top: 130px; left: 50%; transform: translateX(-50%);
  z-index: 2; text-align: center; width: 200px;
}
.ch-cdLbl {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 22px;
  color: #7c2d12; text-shadow: 1px 1px 0 rgba(255,255,255,.5);
  letter-spacing: .08em; text-transform: uppercase;
  line-height: 1;
}
.ch-cdNum {
  font-family: 'Shadows Into Light', cursive; font-size: 96px;
  color: #7c2d12; line-height: .9;
  text-shadow: 3px 3px 0 rgba(255,255,255,.4);
}
.ch-cdUnit {
  font-family: 'Caveat', cursive; font-size: 24px; color: #7c2d12;
  letter-spacing: .12em;
}

.ch-chef {
  grid-column: 1; grid-row: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 16px;
}
.ch-polaroid {
  position: relative; width: 280px;
  background: #fafafa;
  padding: 16px 12px 36px;
  box-shadow: 0 12px 28px rgba(0,0,0,.5);
  transform: rotate(-4deg);
  animation: ch-polaroidSway 5s ease-in-out infinite;
}
@keyframes ch-polaroidSway {
  0%, 100% { transform: rotate(-4deg) translateX(-4px); }
  50%      { transform: rotate(-2deg) translateX(4px); }
}
.ch-polaroid::before {
  content: ''; position: absolute; top: -14px; left: 50%; transform: translateX(-50%) rotate(-3deg);
  width: 120px; height: 28px;
  background:
    repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px),
    #fbbf24;
  box-shadow: 0 2px 4px rgba(0,0,0,.3);
}
.ch-photo {
  width: 100%; aspect-ratio: 1;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  display: flex; align-items: center; justify-content: center;
  font-size: 140px; line-height: 1;
  overflow: hidden;
}
.ch-chefPhoto { width: 100%; height: 100%; object-fit: cover; }
.ch-caption {
  position: absolute; bottom: 4px; left: 0; right: 0;
  font-family: 'Shadows Into Light', cursive; font-size: 24px;
  color: #1f2937; text-align: center; line-height: 1;
}
.ch-caption small {
  display: block; font-family: 'Caveat', cursive; font-size: 20px; color: #92400e;
}

.ch-birthdays {
  grid-column: 3; grid-row: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; padding: 16px; text-align: center;
}
.ch-cake {
  position: relative; width: 220px; height: 180px;
  animation: ch-cakeBob 3.2s ease-in-out infinite;
}
@keyframes ch-cakeBob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50%      { transform: translateY(-6px) rotate(3deg); }
}
.ch-layer {
  position: absolute; left: 20px; right: 20px;
  border: 4px solid #fef3c7;
  box-shadow: inset 0 0 0 2px rgba(0,0,0,.2);
  background: repeating-linear-gradient(45deg, rgba(254,243,199,.08) 0 6px, transparent 6px 14px);
}
.ch-layer.l1 { bottom: 0; height: 50px; border-radius: 0 0 8px 8px; }
.ch-layer.l2 { bottom: 50px; left: 40px; right: 40px; height: 50px; }
.ch-layer.l3 {
  bottom: 100px; left: 60px; right: 60px; height: 30px;
  border-radius: 8px 8px 0 0;
}
.ch-candle {
  position: absolute; bottom: 130px; width: 6px; height: 28px;
  background: #fef3c7; border-radius: 2px;
}
.ch-candle.c1 { left: 50%; transform: translateX(-24px); }
.ch-candle.c2 { left: 50%; transform: translateX(-3px); }
.ch-candle.c3 { left: 50%; transform: translateX(18px); }
.ch-flame {
  position: absolute; bottom: 158px; width: 10px; height: 16px;
  background: radial-gradient(ellipse at 50% 80%, #fbbf24, #f87171 70%);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  animation: ch-flame .8s ease-in-out infinite alternate;
}
.ch-flame.f1 { left: 50%; transform: translateX(-22px); }
.ch-flame.f2 { left: 50%; transform: translateX(-1px); animation-delay: .15s; }
.ch-flame.f3 { left: 50%; transform: translateX(20px); animation-delay: .3s; }
@keyframes ch-flame {
  from { transform: scaleY(1); }
  to   { transform: scaleY(1.25); }
}
.ch-bdLbl {
  font-family: 'Caveat', cursive; font-size: 28px; color: #fde68a;
  letter-spacing: .12em; text-transform: uppercase; margin-top: 10px;
}
.ch-bdNames {
  font-family: 'Shadows Into Light', cursive; font-size: 36px;
  color: #fef3c7; margin-top: 4px; line-height: 1.1;
  text-shadow: 2px 2px 0 rgba(0,0,0,.4);
}

.ch-ticker {
  position: absolute; left: 20px; right: 20px; bottom: 20px; height: 150px;
  background:
    repeating-linear-gradient(90deg,
      #78350f 0 12px, #92400e 12px 16px, #78350f 16px 28px, #a16207 28px 32px);
  border-radius: 8px;
  display: flex; align-items: center; overflow: hidden;
  z-index: 4;
  box-shadow: 0 -8px 20px rgba(0,0,0,.4);
}
.ch-tickerInner {
  position: absolute; inset: 14px; border-radius: 4px;
  background: linear-gradient(180deg, #14532d 0%, #0f3d2b 100%);
  box-shadow: inset 0 0 20px rgba(0,0,0,.5);
  display: flex; align-items: center; overflow: hidden;
}
.ch-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: #fef3c7; display: flex; align-items: center;
  font-family: 'Shadows Into Light', cursive; font-size: 48px;
  letter-spacing: .05em;
  border-right: 2px dashed #fde68a;
}
.ch-tickerScroll { flex: 1; overflow: hidden; }
.ch-tickerText {
  font-family: 'Shadows Into Light', cursive; font-size: 52px;
  color: #fafafa; white-space: nowrap;
  padding-left: 100%;
  display: inline-block;
  animation: ch-tickerScroll 44s linear infinite;
}
@keyframes ch-tickerScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 10px; }
.aw-hotspot:hover { background-color: rgba(253, 230, 138, .08); box-shadow: inset 0 0 0 3px rgba(253, 230, 138, .55); }
.aw-hotspot:focus-visible { background-color: rgba(253, 230, 138, .14); box-shadow: inset 0 0 0 3px rgba(253, 230, 138, .85); }
`;
