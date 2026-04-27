"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// StorybookCafeteriaPortraitWidget — REAL 4K portrait companion.
//
// Vertical re-flow at 2160×3840. NOT letterboxed. Storybook metaphor preserved
// (illuminated drop caps, parchment texture, gold-leaf flourishes, ribbon
// bookmark, page-turn shadow at edges, serif fonts) but reorganized as the
// pages of an open book rather than a two-page spread:
//   • ~700px Top: illuminated header with title + bookmark ribbon
//   • ~1200px Featured chapter card (today's main course)
//   • ~1300px Weekly menu as table of contents (Mon–Fri w/ roman numerals)
//   • ~400px Chef's note on parchment scrap with wax seal
//   • ~240px Bottom ticker with running allergen scroll
//
// Same Cfg shape as StorybookCafeteriaWidget so editor + auto-form work
// identically. Same data flow (live clock, weekday-aware menu pick,
// countdown days, ticker speed).

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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const DAY_NAMES: { key: keyof WeekMenu; label: string }[] = [
  { key: 'monday',    label: 'Monday' },
  { key: 'tuesday',   label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday' },
  { key: 'friday',    label: 'Friday' },
];

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

export function StorybookCafeteriaPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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

  // Featured-of-the-day = first item from today's menu
  const featured: MenuItem = menuItems[0] || { name: 'Chef Salad', meta: 'A garden of greens, with chicken, cheese, and a hand-mixed ranch dressing.', emoji: 'C', price: 'GLUTEN-FREE · DAIRY' };
  const featuredDropcap = (featured.emoji || (featured.name || '?').charAt(0) || '?').toString().charAt(0).toUpperCase();
  const featuredHeroSrc = featured.emoji || c.heroEmoji || '🍝';
  const featuredIsUrl = /^(https?:\/\/|\/|data:image\/)/.test(featuredHeroSrc);

  // Weekly TOC entries — pick first item from each weekday
  const tocEntries = useMemo(() => {
    return DAY_NAMES.map((d, idx) => {
      const list = c.weekMenu?.[d.key];
      const first: MenuItem | undefined = Array.isArray(list) && list.length > 0 ? list[0] : undefined;
      const fallback: Record<string, string> = {
        monday:    'Pasta Primavera',
        tuesday:   'Soft-Shell Tacos',
        wednesday: 'Garden Pizza',
        thursday:  'Roast Chicken',
        friday:    'Grilled Cheese & Tomato Soup',
      };
      return {
        label: d.label,
        roman: ROMAN[idx + 1] || String(idx + 1),
        title: (first && first.name) || fallback[d.key] || '—',
        isToday: today === idx + 1,
      };
    });
  }, [c.weekMenu, today]);

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
    return 'Once upon a time, the kitchen opened   ·   Eat the rainbow — fruits & veggies every day   ·   Drink water, stay hydrated   ·   Free & reduced meals — ask the office   ·   Allergen key: 🌾 = gluten · 🥜 = nuts · 🧀 = dairy · 🥚 = egg';
  }, [c.tickerMessages]);

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
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=EB+Garamond:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Pinyon+Script&family=Tangerine:wght@400;700&display=swap" />
      <style>{CSS_BOOK_PORTRAIT}</style>

      <div
        className="bkp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Page-turn shadows along the edges to imply paper depth */}
        <div className="bkp-edgeShadowL" />
        <div className="bkp-edgeShadowR" />
        <div className="bkp-edgeShadowT" />

        {/* Outer + inner page borders */}
        <div className="bkp-pageFrame" />
        <div className="bkp-pageFrameInner" />

        {/* Decorative corners */}
        <div className="bkp-corner tl"><svg viewBox="0 0 80 80"><path d="M3 3 Q 40 3 40 40 M3 3 Q 3 40 40 40 M14 14 Q 30 14 30 30 M14 14 Q 14 30 30 30" /></svg></div>
        <div className="bkp-corner tr"><svg viewBox="0 0 80 80"><path d="M3 3 Q 40 3 40 40 M3 3 Q 3 40 40 40 M14 14 Q 30 14 30 30 M14 14 Q 14 30 30 30" /></svg></div>
        <div className="bkp-corner bl"><svg viewBox="0 0 80 80"><path d="M3 3 Q 40 3 40 40 M3 3 Q 3 40 40 40 M14 14 Q 30 14 30 30 M14 14 Q 14 30 30 30" /></svg></div>
        <div className="bkp-corner br"><svg viewBox="0 0 80 80"><path d="M3 3 Q 40 3 40 40 M3 3 Q 3 40 40 40 M14 14 Q 30 14 30 30 M14 14 Q 14 30 30 30" /></svg></div>

        {/* Ribbon bookmark hanging from top */}
        <div className="bkp-ribbon">
          <div className="bkp-ribbonBody" />
          <div className="bkp-ribbonTail" />
        </div>

        {/* HEADER — illuminated title with bookmark ribbon */}
        <div className="bkp-header">
          <div className="bkp-flourishTop">
            <svg viewBox="0 0 800 70" preserveAspectRatio="none">
              <path d="M0 35 Q 200 5 400 35 T 800 35" fill="none" stroke="#8b5a2b" strokeWidth="2" />
              <circle cx="400" cy="35" r="8" fill="#d4a86a" stroke="#8b5a2b" strokeWidth="2" />
              <path d="M380 35 L 360 25 M380 35 L 360 45" fill="none" stroke="#8b5a2b" strokeWidth="2" />
              <path d="M420 35 L 440 25 M420 35 L 440 45" fill="none" stroke="#8b5a2b" strokeWidth="2" />
            </svg>
          </div>
          <div className="bkp-logo">{logo}</div>
          <div className="bkp-clock">
            <div className="bkp-clockTime">{hh}:{mm} {ampm}</div>
            <div className="bkp-clockLbl">~ noon hour ~</div>
          </div>
          <div className="bkp-chapter"><span data-field="chapter" style={{ whiteSpace: 'pre-wrap' }}>{c.chapter || 'Chapter Twelve'}</span></div>
          <h1 className="bkp-title"><span data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || "Today's Feast").toUpperCase()}</span></h1>
          <div className="bkp-subtitle"><span data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'in which the kitchen serves a feast'}</span></div>
          <div className="bkp-flourishBottom">
            <svg viewBox="0 0 800 70" preserveAspectRatio="none">
              <path d="M0 35 Q 200 65 400 35 T 800 35" fill="none" stroke="#8b5a2b" strokeWidth="2" />
              <circle cx="400" cy="35" r="8" fill="#d4a86a" stroke="#8b5a2b" strokeWidth="2" />
              <path d="M380 35 L 360 25 M380 35 L 360 45" fill="none" stroke="#8b5a2b" strokeWidth="2" />
              <path d="M420 35 L 440 25 M420 35 L 440 45" fill="none" stroke="#8b5a2b" strokeWidth="2" />
            </svg>
          </div>
        </div>

        {/* FEATURED — full-width parchment chapter card */}
        <div className="bkp-featured">
          <div className="bkp-featuredFrame">
            <div className="bkp-featuredInner">
              <div className="bkp-featuredHero">
                {featuredIsUrl
                  ? <img src={featuredHeroSrc} alt="" className="bkp-featuredImg" />
                  : <span className="bkp-featuredEmoji">{featuredHeroSrc}</span>}
              </div>
              <div className="bkp-featuredBody">
                <div className="bkp-featuredChapter">Chapter I · The Main Course</div>
                <div className="bkp-featuredTitleRow">
                  <span className="bkp-featuredDropcap">{featuredDropcap}</span>
                  <h2 className="bkp-featuredName">{featured.name || "Today's Feature"}</h2>
                </div>
                <p className="bkp-featuredMeta">{featured.meta || 'A wholesome plate, freshly made for the noon hour.'}</p>
                {featured.price && (
                  <div className="bkp-featuredBadges">
                    {featured.price.split(/[·•,]+/).map(s => s.trim()).filter(Boolean).map((b, j) => (
                      <span key={j} className="bkp-featuredBadge">{b}</span>
                    ))}
                  </div>
                )}
                <div className="bkp-featuredCaption">— <span data-field="heroCaption" style={{ whiteSpace: 'pre-wrap' }}>{c.heroCaption || 'from the kitchen'}</span> —</div>
              </div>
            </div>
          </div>
        </div>

        {/* WEEKLY TOC — table of contents */}
        <div className="bkp-toc">
          <div className="bkp-tocHeader">
            <div className="bkp-tocChapter">~ The Week's Menu ~</div>
            <h3 className="bkp-tocTitle">Table of Contents</h3>
          </div>
          <div className="bkp-tocList">
            {tocEntries.map((e, i) => (
              <div key={i} className={'bkp-tocRow' + (e.isToday ? ' today' : '')}>
                <div className="bkp-tocDay">{e.label}</div>
                <div className="bkp-tocDots" />
                <div className="bkp-tocDish">{e.title}</div>
                <div className="bkp-tocPg">PG · {e.roman}</div>
              </div>
            ))}
          </div>
          <div className="bkp-countdown">
            <div className="bkp-cdLbl"><span data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'until next meal'}</span></div>
            <div className="bkp-cdNum"><span data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</span></div>
            <div className="bkp-cdUnit">{unit}</div>
          </div>
        </div>

        {/* CHEF'S NOTE — parchment scrap with wax seal */}
        <div className="bkp-note">
          <div className="bkp-noteScrap">
            <div className="bkp-noteSeal">
              <span className="bkp-noteSealText">N</span>
            </div>
            <div className="bkp-noteContent">
              <div className="bkp-noteLabel"><span data-field="noteLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.noteLabel || 'A note from the cook —'}</span></div>
              <div className="bkp-noteMessage"><span data-field="noteMessage" style={{ whiteSpace: 'pre-wrap' }}>{c.noteMessage || 'Pizza Friday returns at last! Cheese & pepperoni in line two.'}</span></div>
            </div>
          </div>
        </div>

        {/* PAGE-NUMBERED FOOTER + TICKER */}
        <div className="bkp-pgnums">
          <div className="bkp-pgnum l">— page {c.pageLeft || 'xii'} —</div>
          <div className="bkp-pgnum r">— page {c.pageRight || 'xiii'} —</div>
        </div>
        <div className="bkp-ticker">
          <div className="bkp-tickerStamp"><span data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Once upon a time…').toUpperCase()}</span></div>
          <div className="bkp-tickerScroll">
            <span
              className="bkp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 80)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={60}   y={80}   w={2040} h={760} />
            <Hotspot section="vignette"  x={60}   y={880}  w={2040} h={1180} />
            <Hotspot section="menu"      x={60}   y={2080} w={2040} h={1280} />
            <Hotspot section="special"   x={60}   y={3380} w={2040} h={300} />
            <Hotspot section="ticker"    x={0}    y={3680} w={2160} h={160} />
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

const CSS_BOOK_PORTRAIT = `
.bkp-stage {
  position: relative;
  font-family: 'EB Garamond', 'Cormorant Garamond', serif; color: #3d2410;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(180,120,60,.12), transparent 60%),
    radial-gradient(ellipse at 50% 100%, rgba(180,120,60,.18), transparent 60%),
    linear-gradient(180deg, #f5f0dc 0%, #ede0bf 50%, #e2cf9a 100%),
    #f5f0dc;
  overflow: hidden;
}
/* Old-book paper grain */
.bkp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background:
    repeating-linear-gradient(0deg, transparent 0 4px, rgba(120,53,15,.025) 4px 5px),
    repeating-linear-gradient(90deg, transparent 0 9px, rgba(120,53,15,.018) 9px 10px);
  mix-blend-mode: multiply;
}
/* Vignette darkening at corners */
.bkp-stage::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  box-shadow: inset 0 0 200px rgba(120,53,15,.40), inset 0 0 60px rgba(120,53,15,.25);
}

.bkp-edgeShadowL { position: absolute; top: 0; bottom: 0; left: 0; width: 60px; background: linear-gradient(90deg, rgba(70,40,15,.45), transparent); pointer-events: none; z-index: 2; }
.bkp-edgeShadowR { position: absolute; top: 0; bottom: 0; right: 0; width: 60px; background: linear-gradient(270deg, rgba(70,40,15,.45), transparent); pointer-events: none; z-index: 2; }
.bkp-edgeShadowT { position: absolute; top: 0; left: 0; right: 0; height: 50px; background: linear-gradient(180deg, rgba(70,40,15,.35), transparent); pointer-events: none; z-index: 2; }

.bkp-pageFrame { position: absolute; inset: 50px; border: 4px solid #8b5a2b; pointer-events: none; z-index: 2; }
.bkp-pageFrameInner { position: absolute; inset: 70px; border: 1px solid #8b5a2b; pointer-events: none; z-index: 2; }

.bkp-corner { position: absolute; width: 120px; height: 120px; pointer-events: none; z-index: 3; }
.bkp-corner svg { width: 100%; height: 100%; fill: none; stroke: #8b5a2b; stroke-width: 2.5; opacity: .85; }
.bkp-corner.tl { top: 60px; left: 60px; }
.bkp-corner.tr { top: 60px; right: 60px; transform: scaleX(-1); }
.bkp-corner.bl { bottom: 60px; left: 60px; transform: scaleY(-1); }
.bkp-corner.br { bottom: 60px; right: 60px; transform: scale(-1,-1); }

/* Ribbon bookmark hangs from the top edge, falls to ~340px */
.bkp-ribbon {
  position: absolute; top: 0; right: 280px; width: 110px; height: 360px;
  z-index: 4; pointer-events: none;
  filter: drop-shadow(8px 6px 14px rgba(0,0,0,.35));
}
.bkp-ribbonBody {
  position: absolute; top: 0; left: 0; width: 110px; height: 320px;
  background: linear-gradient(180deg, #c43137 0%, #9b1f23 50%, #c43137 100%);
  border-left: 3px solid rgba(255,255,255,.18);
  border-right: 3px solid rgba(0,0,0,.20);
}
.bkp-ribbonBody::after {
  content: ''; position: absolute; inset: 12px 14px;
  border-left: 1px dashed rgba(250,236,198,.45);
  border-right: 1px dashed rgba(250,236,198,.45);
}
.bkp-ribbonTail {
  position: absolute; top: 320px; left: 0; width: 110px; height: 40px;
  background: #c43137;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 60%, 0 100%);
}

/* HEADER */
.bkp-header {
  position: absolute; top: 110px; left: 130px; right: 130px;
  height: 660px; text-align: center; z-index: 5;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding-top: 30px;
}
.bkp-flourishTop, .bkp-flourishBottom {
  width: 1400px; height: 70px; max-width: 100%;
}
.bkp-logo {
  position: absolute; top: 70px; left: 60px;
  width: 150px; height: 150px;
  background: radial-gradient(circle at 30% 30%, #faecc6, #d4a86a);
  border: 4px solid #8b5a2b; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 84px; line-height: 1;
  box-shadow: inset 0 0 0 6px #faecc6, 0 6px 18px rgba(70,40,15,.35);
}
.bkp-clock {
  position: absolute; top: 70px; right: 60px;
  width: 220px; text-align: right; line-height: 1;
}
.bkp-clockTime { font-family: 'Cinzel', 'EB Garamond', serif; font-weight: 700; font-size: 56px; color: #3d2410; letter-spacing: .04em; }
.bkp-clockLbl { font-family: 'Tangerine', 'Pinyon Script', cursive; font-weight: 700; font-size: 42px; color: #8b5a2b; margin-top: 6px; }

.bkp-chapter {
  font-family: 'Pinyon Script', 'Tangerine', cursive; font-size: 90px; color: #8b5a2b;
  line-height: 1; margin-top: 40px;
}
.bkp-chapter::before { content: '~ '; } .bkp-chapter::after { content: ' ~'; }
.bkp-title {
  font-family: 'Cinzel', 'EB Garamond', serif; font-weight: 900;
  font-size: 200px; line-height: .95; color: #3d2410;
  margin: 18px 0 14px; letter-spacing: .04em;
  text-shadow:
    0 2px 0 rgba(250,236,198,.85),
    0 -1px 0 rgba(70,40,15,.30),
    0 14px 24px rgba(70,40,15,.18);
  /* Subtle illuminated flicker — doesn't move; just gentle gold halo pulse */
  animation: bkp-illum 4.6s ease-in-out infinite;
}
@keyframes bkp-illum {
  0%, 100% { text-shadow: 0 2px 0 rgba(250,236,198,.85), 0 -1px 0 rgba(70,40,15,.30), 0 14px 24px rgba(212,168,106,.30); }
  50%      { text-shadow: 0 2px 0 rgba(250,236,198,.95), 0 -1px 0 rgba(70,40,15,.30), 0 14px 32px rgba(212,168,106,.55); }
}
.bkp-subtitle {
  font-family: 'Tangerine', 'Pinyon Script', cursive; font-weight: 700;
  font-size: 80px; color: #8b5a2b; line-height: 1; margin-bottom: 16px;
}

/* FEATURED chapter card — full-width parchment with two columns */
.bkp-featured {
  position: absolute; top: 880px; left: 130px; right: 130px; height: 1180px;
  z-index: 5;
}
.bkp-featuredFrame {
  position: absolute; inset: 0;
  border: 5px double #8b5a2b;
  background:
    radial-gradient(ellipse at 30% 0%, rgba(255,255,255,.35), transparent 65%),
    linear-gradient(180deg, #fff8e1 0%, #f5deb3 100%);
  box-shadow:
    inset 0 0 0 10px #faecc6,
    inset 0 0 0 11px #8b5a2b,
    inset 0 0 60px rgba(120,53,15,.18),
    0 14px 30px rgba(0,0,0,.20);
  padding: 48px;
  overflow: hidden;
}
.bkp-featuredFrame::before {
  content: ''; position: absolute; inset: 24px;
  background: repeating-conic-gradient(from 0deg, rgba(255,255,255,.12) 0 6deg, transparent 6deg 18deg);
  pointer-events: none;
}
.bkp-featuredInner {
  position: relative; height: 100%;
  display: grid; grid-template-columns: 760px 1fr; gap: 60px;
  align-items: stretch;
}
.bkp-featuredHero {
  border: 4px solid #8b5a2b;
  background: linear-gradient(180deg, #fff8e1, #f5deb3);
  box-shadow: inset 0 0 0 10px #faecc6, inset 0 0 0 11px #8b5a2b;
  display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
  padding: 20px;
}
.bkp-featuredHero::before {
  content: ''; position: absolute; inset: -50%;
  background: repeating-conic-gradient(from 0deg, rgba(255,255,255,.20) 0 6deg, transparent 6deg 18deg);
}
.bkp-featuredEmoji {
  font-size: 460px; line-height: 1; position: relative; z-index: 1;
  filter: drop-shadow(0 12px 18px rgba(0,0,0,.30));
}
.bkp-featuredImg { width: 100%; height: 100%; object-fit: contain; position: relative; z-index: 1; }
.bkp-featuredBody {
  display: flex; flex-direction: column; justify-content: center;
  padding: 12px 0;
}
.bkp-featuredChapter {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 38px;
  letter-spacing: .25em; color: #8b5a2b; text-transform: uppercase;
  border-bottom: 1px solid #8b5a2b; padding-bottom: 14px; margin-bottom: 18px;
}
.bkp-featuredTitleRow { display: flex; align-items: flex-start; gap: 24px; }
.bkp-featuredDropcap {
  font-family: 'Cinzel', serif; font-weight: 900; font-size: 200px;
  line-height: .85; color: #c43137;
  text-shadow:
    0 0 0 #c43137,
    4px 4px 0 #faecc6,
    6px 6px 0 #8b5a2b;
  padding: 0 14px 0 4px;
  background: linear-gradient(180deg, rgba(196,49,55,0), rgba(196,49,55,.10));
  /* Light flicker on drop cap (gold halo) */
  animation: bkp-dropcap 5s ease-in-out infinite;
}
@keyframes bkp-dropcap {
  0%, 100% { filter: drop-shadow(0 0 6px rgba(212,168,106,.35)); }
  50%      { filter: drop-shadow(0 0 14px rgba(212,168,106,.75)); }
}
.bkp-featuredName {
  margin: 6px 0 0;
  font-family: 'EB Garamond', serif; font-weight: 700; font-style: italic;
  font-size: 90px; line-height: 1; color: #3d2410;
}
.bkp-featuredMeta {
  margin: 22px 0 22px;
  font-family: 'EB Garamond', serif; font-size: 42px; line-height: 1.35; color: #5d3a1a;
}
.bkp-featuredBadges { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; }
.bkp-featuredBadge {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 22px; letter-spacing: .18em;
  padding: 10px 22px; background: #faecc6; color: #5d3a1a;
  border: 1px solid #8b5a2b;
}
.bkp-featuredCaption {
  margin-top: auto; padding-top: 30px;
  font-family: 'Tangerine', 'Pinyon Script', cursive; font-weight: 700;
  font-size: 70px; color: #8b5a2b; line-height: 1;
}

/* WEEKLY TABLE OF CONTENTS */
.bkp-toc {
  position: absolute; top: 2080px; left: 130px; right: 130px; height: 1280px;
  z-index: 5;
  border-top: 1px solid #8b5a2b;
  padding-top: 30px;
  display: flex; flex-direction: column;
}
.bkp-toc::before {
  content: ''; position: absolute; left: 0; right: 0; top: 6px; height: 1px; background: #8b5a2b;
}
.bkp-tocHeader { text-align: center; }
.bkp-tocChapter {
  font-family: 'Pinyon Script', 'Tangerine', cursive; font-size: 78px; color: #8b5a2b; line-height: 1;
}
.bkp-tocTitle {
  margin: 14px 0 4px;
  font-family: 'Cinzel', serif; font-weight: 900; font-size: 110px;
  color: #3d2410; line-height: 1; letter-spacing: .06em;
  text-shadow: 0 2px 0 rgba(250,236,198,.7);
}
.bkp-tocList {
  flex: 1; min-height: 0;
  margin-top: 30px; padding: 8px 30px;
  display: flex; flex-direction: column; justify-content: space-around;
}
.bkp-tocRow {
  display: grid; grid-template-columns: 360px 1fr 200px;
  align-items: center; gap: 28px;
  padding: 16px 4px;
  border-bottom: 1px dotted rgba(139,90,43,.35);
}
.bkp-tocRow:last-child { border-bottom: none; }
.bkp-tocRow.today {
  background: linear-gradient(90deg, transparent 0%, rgba(212,168,106,.18) 50%, transparent 100%);
  border-left: 6px solid #c43137;
  padding-left: 18px;
}
.bkp-tocRow.today .bkp-tocDay { color: #c43137; }
.bkp-tocRow.today::after {
  content: '★'; position: relative; right: -10px; color: #c43137; font-size: 36px;
}
.bkp-tocDay {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 60px; color: #3d2410; line-height: 1;
}
.bkp-tocDots {
  position: relative; height: 6px; margin: 0 12px;
  background-image: radial-gradient(circle, #8b5a2b 1.5px, transparent 2px);
  background-size: 18px 6px;
  background-repeat: repeat-x;
  background-position: 0 50%;
  opacity: .55;
}
.bkp-tocDish {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 500;
  font-size: 60px; color: #5d3a1a; line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bkp-tocPg {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 38px;
  color: #8b5a2b; letter-spacing: .15em; text-align: right;
}
.bkp-tocRow .bkp-tocDish, .bkp-tocRow .bkp-tocDay, .bkp-tocRow .bkp-tocPg {
  /* keep grid items aligned even when day row gets ★ pseudo from .today */
}

/* Countdown — sits inline at the bottom of TOC */
.bkp-countdown {
  margin-top: 16px;
  border-top: 1px solid #8b5a2b;
  padding: 18px 30px;
  display: grid; grid-template-columns: 1fr auto 1fr; gap: 30px;
  align-items: center;
}
.bkp-cdLbl { font-family: 'Tangerine', 'Pinyon Script', cursive; font-weight: 700; font-size: 70px; color: #8b5a2b; line-height: 1; text-align: right; }
.bkp-cdNum { font-family: 'Cinzel', serif; font-weight: 900; font-size: 140px; color: #3d2410; line-height: 1; text-align: center; text-shadow: 0 2px 0 rgba(250,236,198,.7), 0 8px 16px rgba(70,40,15,.20); }
.bkp-cdUnit { font-family: 'EB Garamond', serif; font-style: italic; font-size: 44px; color: #5d3a1a; line-height: 1; text-align: left; }

/* CHEF'S NOTE — small parchment scrap with wax seal */
.bkp-note {
  position: absolute; top: 3380px; left: 130px; right: 130px; height: 300px;
  z-index: 5;
}
.bkp-noteScrap {
  position: relative; height: 100%;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.45), transparent 60%),
    linear-gradient(180deg, #f7e7b6 0%, #e8cf86 100%);
  border: 2px solid #8b5a2b;
  box-shadow:
    0 16px 30px rgba(70,40,15,.30),
    inset 0 0 0 6px #faecc6,
    inset 0 0 0 7px #8b5a2b;
  /* Slightly tilted scrap effect with rough cut edges */
  transform: rotate(-1.2deg);
  padding: 26px 200px 26px 50px;
  display: flex; flex-direction: column; justify-content: center;
  /* Torn-paper shadow at bottom */
  clip-path: polygon(
    0% 6%, 4% 0%, 12% 4%, 22% 0%, 32% 4%, 44% 1%, 56% 4%, 68% 0%, 80% 4%, 92% 0%, 100% 6%,
    100% 94%, 96% 100%, 86% 96%, 74% 100%, 62% 96%, 50% 100%, 38% 96%, 26% 100%, 14% 96%, 4% 100%, 0% 94%
  );
}
.bkp-noteSeal {
  position: absolute; top: 50%; right: 60px; transform: translateY(-50%);
  width: 130px; height: 130px;
  background:
    radial-gradient(circle at 35% 30%, #e85d6a 0%, #c43137 50%, #8b1a1f 100%);
  border-radius: 50%;
  box-shadow:
    inset 0 0 0 4px rgba(0,0,0,.15),
    inset 6px 6px 16px rgba(255,255,255,.20),
    inset -6px -6px 16px rgba(0,0,0,.30),
    0 6px 14px rgba(0,0,0,.40);
  display: flex; align-items: center; justify-content: center;
}
.bkp-noteSeal::before {
  content: ''; position: absolute; inset: 14px;
  border: 2px dashed rgba(250,236,198,.55);
  border-radius: 50%;
}
.bkp-noteSealText {
  font-family: 'Cinzel', serif; font-weight: 900; font-size: 64px;
  color: #faecc6; line-height: 1;
  text-shadow: 0 2px 0 rgba(0,0,0,.30);
}
.bkp-noteContent { position: relative; z-index: 1; }
.bkp-noteLabel { font-family: 'Pinyon Script', 'Tangerine', cursive; font-size: 60px; color: #8b5a2b; line-height: 1; }
.bkp-noteMessage { font-family: 'EB Garamond', serif; font-weight: 500; font-style: italic; font-size: 64px; color: #3d2410; line-height: 1.05; margin-top: 8px; }

/* Page numbers + ticker */
.bkp-pgnums { position: absolute; left: 0; right: 0; bottom: 240px; z-index: 5; pointer-events: none; }
.bkp-pgnum { position: absolute; bottom: 0; font-family: 'EB Garamond', serif; font-style: italic; color: #8b5a2b; font-size: 36px; }
.bkp-pgnum.l { left: 130px; }
.bkp-pgnum.r { right: 130px; }

.bkp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  background: linear-gradient(180deg, #3d2410 0%, #261607 100%);
  color: #faecc6;
  display: flex; align-items: center; overflow: hidden;
  border-top: 6px double #8b5a2b;
  z-index: 6;
}
.bkp-tickerStamp {
  flex: 0 0 auto; padding: 0 50px; height: 100%;
  background: #8b5a2b; color: #faecc6; display: flex; align-items: center;
  font-family: 'Cinzel', serif; font-weight: 700; letter-spacing: .25em; font-size: 38px;
}
.bkp-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.bkp-tickerText {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 500;
  font-size: 60px; color: #faecc6; white-space: nowrap; padding-left: 100%;
  display: inline-block; will-change: transform;
  animation: bkp-tickerScroll 80s linear infinite;
}
@keyframes bkp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(139, 90, 43, .10); box-shadow: inset 0 0 0 4px rgba(139, 90, 43, .55); }
.aw-hotspot:focus-visible { background-color: rgba(139, 90, 43, .18); box-shadow: inset 0 0 0 4px rgba(139, 90, 43, .85); }
`;
