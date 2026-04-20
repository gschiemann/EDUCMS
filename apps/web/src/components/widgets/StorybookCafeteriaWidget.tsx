"use client";

// PORTED 2026-04-20 from scratch/design/storybook-cafeteria.html — transform:scale pattern, isLive-gated hotspots.
// Open-book metaphor: left-page illuminated vignette + right-page story panels, center spine, parchment texture,
// illuminated drop caps, page numbers in roman numerals, double border frames. The HTML had a top-left logo that
// could overlap the book's top-left corner flourish — repositioned here so the logo sits below the corner SVG.

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
  chapter?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;

  // Left page — hero vignette
  heroEmoji?: string;
  heroCaption?: string;

  // Menu (right page story panels) — full week data preferred
  weekMenu?: WeekMenu;
  menuItems?: MenuItem[];

  // Footer — note from the cook
  noteLabel?: string;
  noteMessage?: string;

  // Countdown to next meal / period
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;

  // Ticker
  tickerStamp?: string;
  tickerMessages?: string[] | string;
  tickerSpeed?: 'slow' | 'normal' | 'fast' | number;

  // Page numbers
  pageLeft?: string;
  pageRight?: string;
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

export function StorybookCafeteriaWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { emoji: 'C', name: 'Chef Salad', meta: 'Romaine, grilled chicken, tomatoes, cheese, ranch.', price: 'GLUTEN-FREE · DAIRY' },
      { emoji: 'R', name: 'Roasted Veggies', meta: 'Carrots, zucchini, peppers — olive oil & sea salt.', price: 'VEGAN · GLUTEN-FREE' },
      { emoji: 'F', name: 'Fruit Cup', meta: 'Watermelon, pineapple, fresh summer berries.', price: 'VEGAN · GLUTEN-FREE' },
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
  const unit = (c.countdownUnit || 'days hence');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('   ·   ');
    return 'Eat the rainbow — fruits & veggies every day   ·   Drink water, stay hydrated   ·   Free & reduced meals — ask the office';
  }, [c.tickerMessages]);

  const heroEmoji = c.heroEmoji || '🍝';
  const isHeroUrl = /^(https?:\/\/|\/|data:image\/)/.test(heroEmoji);
  const logo = c.logoEmoji || '📖';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1c1206',
      }}
    >
      <style>{CSS_BOOK}</style>

      <div
        className="book-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="book-pageFrames"><div className="book-pfL" /><div className="book-pfR" /></div>

        <div className="book-corner tl"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>
        <div className="book-corner tr"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>
        <div className="book-corner bl"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>
        <div className="book-corner br"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>

        {/* Logo repositioned to avoid top-left book corner flourish overlap */}
        <div className="book-logo">{logo}</div>
        <div className="book-clock">
          <div>{hh}:{mm} {ampm}</div>
          <div className="book-clockLbl">~ noon hour ~</div>
        </div>

        <div className="book-pages">
          <div className="book-header">
            <div className="book-chapter">{c.chapter || 'Chapter Twelve'}</div>
            <h1>{c.title || "Today's Menu"}</h1>
            <div className="book-sub">{c.subtitle || 'in which the kitchen serves a feast'}</div>
          </div>

          <div className="book-vignette">
            <div className="book-frame">
              <div className="book-hero">
                {isHeroUrl ? <img src={heroEmoji} alt="" className="book-heroImg" /> : heroEmoji}
              </div>
            </div>
            <div className="book-caption">— {c.heroCaption || 'from the kitchen'} —</div>
          </div>

          <div className="book-spine" />

          <div className="book-panels">
            {menuItems.slice(0, 3).map((it, i) => {
              const dropcap = (it.emoji || (it.name || '?').charAt(0) || '?').toString().charAt(0).toUpperCase();
              const badges = (it.price || '').split(/[·•,]+/).map(s => s.trim()).filter(Boolean);
              return (
                <div key={i} className="book-panel">
                  <div className="book-dropcap">{dropcap}</div>
                  <div className="book-body">
                    <h3>{it.name || ''}</h3>
                    {it.meta && <p>{it.meta}</p>}
                    {badges.length > 0 && (
                      <div className="book-badges">
                        {badges.map((b, j) => <span key={j} className="book-badge">{b}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="book-footer">
            <div className="book-special">
              <div className="book-specialLbl">{c.noteLabel || 'A note from the cook —'}</div>
              <div className="book-specialMsg">{c.noteMessage || 'Pizza Friday returns at last! Cheese & pepperoni in line two.'}</div>
            </div>
            <div className="book-ctd">
              <div className="book-ctdLbl">{c.countdownLabel || 'until next meal'}</div>
              <div className="book-ctdNum">{days}</div>
              <div className="book-ctdUnit">{unit}</div>
            </div>
          </div>
        </div>

        <div className="book-pgnum l">— {c.pageLeft || 'xii'} —</div>
        <div className="book-pgnum r">— {c.pageRight || 'xiii'} —</div>

        <div className="book-ticker">
          <div className="book-tickerStamp">{(c.tickerStamp || 'FROM THE KITCHEN').toUpperCase()}</div>
          <div className="book-tickerScroll">
            <span
              className="book-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 50)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={80}   y={80}  w={1760} h={140} />
            <Hotspot section="header"    x={1500} y={30}  w={340}  h={120} />
            <Hotspot section="vignette"  x={100}  y={240} w={780}  h={560} />
            <Hotspot section="menu"      x={1040} y={240} w={800}  h={560} />
            <Hotspot section="special"   x={80}   y={820} w={1100} h={140} />
            <Hotspot section="countdown" x={1180} y={820} w={660}  h={140} />
            <Hotspot section="ticker"    x={0}    y={1004} w={1920} h={76} />
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

const CSS_BOOK = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;700&family=Quattrocento:wght@400;700&family=Italianno&display=swap');

.book-stage {
  position: relative;
  font-family: 'Quattrocento', serif; color: #3d2410;
  background:
    linear-gradient(90deg, transparent 48%, rgba(70,40,15,0) 48%, rgba(70,40,15,.35) 50%, rgba(70,40,15,0) 52%, transparent 52%),
    linear-gradient(90deg, #faecc6 0%, #f5dca0 45%, #d4a86a 50%, #f5dca0 55%, #faecc6 100%),
    #faecc6;
  overflow: hidden;
}
.book-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(120,53,15,.025) 3px 4px);
  mix-blend-mode: multiply;
}
.book-stage::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 80px rgba(120,53,15,.35);
}

.book-pageFrames { position: absolute; inset: 28px; pointer-events: none; }
.book-pfL, .book-pfR { position: absolute; top: 0; bottom: 0; width: calc(50% - 24px); border: 2px solid #8b5a2b; }
.book-pfL { left: 0; }
.book-pfR { right: 0; }
.book-pfL::after, .book-pfR::after { content: ''; position: absolute; inset: 8px; border: 1px solid #8b5a2b; }

.book-corner { position: absolute; width: 70px; height: 70px; pointer-events: none; }
.book-corner svg { width: 100%; height: 100%; fill: none; stroke: #8b5a2b; stroke-width: 2; opacity: .8; }
.book-corner.tl { top: 36px; left: 36px; }
.book-corner.tr { top: 36px; right: 36px; transform: scaleX(-1); }
.book-corner.bl { bottom: 36px; left: 36px; transform: scaleY(-1); }
.book-corner.br { bottom: 36px; right: 36px; transform: scale(-1,-1); }

/* Logo tucked into top-left page margin but below the corner flourish so they don't collide */
.book-logo {
  position: absolute; top: 130px; left: 120px;
  width: 90px; height: 90px;
  background: radial-gradient(circle, #faecc6, #d4a86a);
  border: 2px solid #8b5a2b; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 50px;
  box-shadow: inset 0 0 0 4px #faecc6;
  z-index: 5;
}
.book-clock {
  position: absolute; top: 36px; right: 120px;
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 36px; color: #3d2410; line-height: 1;
  text-align: right; z-index: 5;
}
.book-clockLbl { font-family: 'Italianno', cursive; font-size: 26px; color: #8b5a2b; line-height: 1; }

.book-pages {
  position: absolute; top: 70px; left: 80px; right: 80px; bottom: 70px;
  display: grid;
  grid-template-columns: 1fr 80px 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 20px 0;
}

.book-header {
  grid-column: 1 / -1; text-align: center;
  padding: 0 0 10px; border-bottom: 1px solid #8b5a2b;
  position: relative;
}
.book-header::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -6px; height: 1px; background: #8b5a2b;
}
.book-chapter { font-family: 'Italianno', cursive; font-size: 56px; color: #8b5a2b; line-height: 1; }
.book-chapter::before { content: '~ '; } .book-chapter::after { content: ' ~'; }
.book-header h1 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 110px;
  margin: 0; line-height: 1; color: #3d2410; letter-spacing: .02em;
}
.book-sub { font-family: 'Italianno', cursive; font-size: 40px; color: #8b5a2b; }

.book-vignette {
  grid-column: 1; grid-row: 2;
  display: flex; flex-direction: column; align-items: stretch;
  padding: 20px 12px;
}
.book-frame {
  flex: 1;
  border: 3px double #8b5a2b;
  background: linear-gradient(180deg, #fff8e1, #f5deb3);
  box-shadow: inset 0 0 0 6px #faecc6, inset 0 0 0 7px #8b5a2b;
  padding: 24px;
  display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
}
.book-frame::before {
  content: ''; position: absolute; inset: -50%;
  background: repeating-conic-gradient(from 0deg, rgba(255,255,255,.18) 0 6deg, transparent 6deg 18deg);
}
.book-hero {
  font-size: 320px; filter: drop-shadow(0 6px 8px rgba(0,0,0,.25));
  position: relative; z-index: 1; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  width: 360px; height: 360px;
}
.book-heroImg { width: 100%; height: 100%; object-fit: contain; }
.book-caption {
  text-align: center; font-family: 'Italianno', cursive; font-size: 50px; color: #8b5a2b; padding-top: 14px;
}

.book-spine { grid-column: 2; grid-row: 2; }

.book-panels {
  grid-column: 3; grid-row: 2;
  display: flex; flex-direction: column; gap: 18px; padding: 20px 12px;
}
.book-panel {
  flex: 1;
  border: 2px solid #8b5a2b;
  background: rgba(255,248,225,.5);
  box-shadow: inset 0 0 0 5px #faecc6, inset 0 0 0 6px #8b5a2b;
  padding: 16px 22px;
  display: flex; gap: 18px; align-items: center;
}
.book-dropcap {
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 110px;
  line-height: 1; color: #8b5a2b;
  border-right: 2px solid #c89868; padding-right: 18px;
}
.book-body { flex: 1; }
.book-body h3 { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 46px; line-height: 1; margin: 0 0 6px; color: #3d2410; }
.book-body p  { font-family: 'Quattrocento', serif; font-size: 22px; color: #5d3a1a; margin: 0 0 10px; line-height: 1.3; }
.book-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.book-badge {
  font-family: 'Quattrocento', serif; font-weight: 700; font-size: 14px; letter-spacing: .12em;
  padding: 4px 12px; background: #faecc6; color: #5d3a1a;
  border: 1px solid #8b5a2b;
}

.book-footer {
  grid-column: 1 / -1; grid-row: 3;
  display: grid; grid-template-columns: 1fr 320px; gap: 0;
  border-top: 1px solid #8b5a2b; padding-top: 12px; position: relative;
}
.book-footer::before {
  content: ''; position: absolute; left: 0; right: 0; top: 6px; height: 1px; background: #8b5a2b;
}
.book-special {
  padding: 10px 24px;
  border-right: 1px solid #8b5a2b;
  background: linear-gradient(180deg, transparent, rgba(250,236,198,.6));
  position: relative;
}
.book-special::before { content: '✦'; position: absolute; top: 14px; left: 4px; color: #8b5a2b; font-size: 22px; }
.book-specialLbl { font-family: 'Italianno', cursive; font-size: 36px; color: #8b5a2b; line-height: 1; padding-left: 30px; }
.book-specialMsg { font-family: 'Cormorant Garamond', serif; font-weight: 500; font-size: 44px; color: #3d2410; line-height: 1.05; padding-left: 30px; margin-top: 4px; }
.book-ctd { text-align: center; padding: 10px 18px; }
.book-ctdLbl { font-family: 'Italianno', cursive; font-size: 32px; color: #8b5a2b; line-height: 1; }
.book-ctdNum { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 78px; line-height: 1; color: #3d2410; }
.book-ctdUnit { font-family: 'Quattrocento', serif; font-style: italic; font-size: 22px; color: #5d3a1a; }

.book-pgnum {
  position: absolute; bottom: 96px; font-family: 'Cormorant Garamond', serif; font-style: italic; color: #8b5a2b; font-size: 22px;
}
.book-pgnum.l { left: 100px; }
.book-pgnum.r { right: 100px; }

.book-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 76px;
  background: #3d2410; color: #faecc6;
  display: flex; align-items: center; overflow: hidden;
  border-top: 4px double #8b5a2b;
  z-index: 6;
}
.book-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #8b5a2b; color: #faecc6; display: flex; align-items: center;
  font-family: 'Cormorant Garamond', serif; font-weight: 700; letter-spacing: .25em; font-size: 18px;
}
.book-tickerScroll { flex: 1; overflow: hidden; }
.book-tickerText {
  font-family: 'Cormorant Garamond', serif; font-size: 38px; font-style: italic;
  color: #faecc6; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: book-tickerScroll 50s linear infinite;
}
@keyframes book-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 6px; }
.aw-hotspot:hover { background-color: rgba(139, 90, 43, .10); box-shadow: inset 0 0 0 3px rgba(139, 90, 43, .55); }
.aw-hotspot:focus-visible { background-color: rgba(139, 90, 43, .18); box-shadow: inset 0 0 0 3px rgba(139, 90, 43, .85); }
`;
