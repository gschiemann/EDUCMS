"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// ScrapbookCafeteriaPortraitWidget — vertical re-flow of ScrapbookCafeteriaWidget at 2160×3840.
// NOT letterboxed. Scrapbook aesthetic preserved (cream paper, washi tape, polaroid plate,
// handwritten fonts, paper texture) but laid out for portrait:
//   • Header (~700px): scrapbook title plate with washi-tape banner + tilted clock polaroid
//   • Polaroid hero (~1200px): full-width polaroid plate, tilted, with handwritten caption
//   • Menu grid (~1200px): 2x3 of washi-taped menu cards
//   • Allergen note (~400px): notebook-paper card with washi-tape pin
//   • Spacer (~140px): gentle paper texture breathing room
//   • Ticker (~200px): scrapbook ticker with handwritten "TODAY:" stamp
//
// Same Cfg shape as the landscape widget so the auto-form editor and click-to-edit work
// identically. Same data flow (live clock, countdown days). Hotspots gated by !isLive.

import { useEffect, useMemo, useRef, useState } from 'react';

type MenuCard = { title?: string; desc?: string; badges?: { label?: string; kind?: 'v' | 'gf' | 'dy' | 'pk' }[]; accent?: string; rot?: string; tape?: string };

interface Cfg {
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;
  polaroidEmoji?: string;
  polaroidCaption?: string;
  cards?: MenuCard[];
  specialLabel?: string;
  specialMsg?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;
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

export function ScrapbookCafeteriaPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
  const mm = parts.find(p => p.type === 'minute')?.value || '34';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'PM';

  const cards: MenuCard[] = useMemo(() => {
    if (Array.isArray(c.cards) && c.cards.length > 0) return c.cards;
    return [
      { title: 'Chef Salad', desc: 'Romaine, grilled chicken, tomatoes, cheese, ranch.', badges: [{ label: 'GF', kind: 'gf' }, { label: 'DAIRY', kind: 'dy' }], accent: '#f472b6', rot: '-2deg', tape: '#fcd34d' },
      { title: 'Roasted Veggies', desc: 'Carrots, zucchini, peppers — olive oil, sea salt.', badges: [{ label: 'VEGAN', kind: 'v' }, { label: 'GF', kind: 'gf' }], accent: '#86efac', rot: '1.5deg', tape: '#86efac' },
      { title: 'Fruit Cup', desc: 'Watermelon, pineapple, fresh summer berries.', badges: [{ label: 'VEGAN', kind: 'v' }, { label: 'GF', kind: 'gf' }], accent: '#fcd34d', rot: '-1.5deg', tape: '#93c5fd' },
      { title: 'Turkey Wrap', desc: 'Sliced turkey, lettuce, tomato in a whole-wheat tortilla.', badges: [{ label: 'WHEAT', kind: 'pk' }, { label: 'DAIRY', kind: 'dy' }], accent: '#93c5fd', rot: '2deg', tape: '#f472b6' },
      { title: 'Mac & Cheese', desc: 'Creamy three-cheese pasta with toasted breadcrumbs.', badges: [{ label: 'WHEAT', kind: 'pk' }, { label: 'DAIRY', kind: 'dy' }], accent: '#fcd34d', rot: '-1deg', tape: '#86efac' },
      { title: 'Garden Soup', desc: 'Tomato basil with fresh herbs and a drizzle of cream.', badges: [{ label: 'VEG', kind: 'v' }, { label: 'GF', kind: 'gf' }], accent: '#f472b6', rot: '1deg', tape: '#fcd34d' },
    ];
  }, [c.cards]);

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 12;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'day' : (c.countdownUnit || 'days');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('   ·   ');
    return 'Eat the rainbow — fruits + veggies every day 🌈   ·   Drink water, stay hydrated! 💧   ·   Free + reduced meals — ask the office';
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_SBP}</style>

      <div
        className="sbp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Header — title plate with washi-tape banner + tilted clock polaroid */}
        <div className="sbp-header">
          <div className="sbp-logo">{c.logoEmoji || '🍎'}</div>
          <div className="sbp-titleWrap">
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || "Today's Menu"}</h1>
            <div className="sbp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || "what's cooking in the kitchen"}</div>
          </div>
          <div className="sbp-clock">
            <div className="sbp-t">{hh}:{mm}</div>
            <div className="sbp-ap">{ampm}</div>
          </div>
        </div>

        {/* Featured polaroid hero — full-width, tilted, washi-tape corners */}
        <div className="sbp-polaroid">
          <div className="sbp-tapeTL" />
          <div className="sbp-tapeTR" />
          <div className="sbp-photo">
            <span className="sbp-photoEmoji">{c.polaroidEmoji || '🍝'}</span>
          </div>
          <div className="sbp-caption" data-field="polaroidCaption" style={{ whiteSpace: 'pre-wrap' }}>{c.polaroidCaption || '~ snapped this morning ~'}</div>
        </div>

        {/* 2x3 grid of washi-taped menu cards */}
        <div className="sbp-menuGrid">
          {cards.slice(0, 6).map((card, i) => (
            <div
              key={i}
              className="sbp-card"
              style={{
                // @ts-ignore css vars
                ['--accent' as any]: card.accent || '#f472b6',
                ['--rot' as any]: card.rot || '-1deg',
                ['--tape' as any]: card.tape || '#fcd34d',
              }}
            >
              <h3>{card.title || ''}</h3>
              <p>{card.desc || ''}</p>
              {card.badges && card.badges.length > 0 && (
                <div className="sbp-badges">
                  {card.badges.map((b, bi) => (
                    <span key={bi} className={`sbp-badge sbp-badge-${b.kind || 'pk'}`}>{b.label || ''}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Notebook-paper allergen note — pinned by washi tape */}
        <div className="sbp-note">
          <div className="sbp-noteTape" />
          <div className="sbp-specialLbl" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.specialLabel || "Today's Special"}</div>
          <div className="sbp-specialMsg" data-field="specialMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.specialMsg || 'Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2.'}</div>
          <div className="sbp-countdownInline">
            <span className="sbp-ctdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Next meal in'}</span>
            <span className="sbp-ctdNum">{days}</span>
            <span className="sbp-ctdUnit">{unit}</span>
          </div>
        </div>

        {/* Spacer — gentle paper texture breathing room (zone 3360-3500) */}
        <div className="sbp-spacer" aria-hidden="true">
          <div className="sbp-doodle d1">★</div>
          <div className="sbp-doodle d2">✿</div>
          <div className="sbp-doodle d3">♥</div>
        </div>

        {/* Bottom ticker — scrapbook style, handwritten "TODAY:" stamp */}
        <div className="sbp-ticker">
          <div className="sbp-stamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'TODAY').toUpperCase()}</div>
          <div className="sbp-scroll">
            <span
              className="sbp-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="logo"      x={60}   y={60}   w={300}  h={300} />
            <Hotspot section="header"    x={400}  y={60}   w={1360} h={640} />
            <Hotspot section="clock"     x={1800} y={60}   w={300}  h={300} />
            <Hotspot section="polaroid"  x={60}   y={740}  w={2040} h={1200} />
            <Hotspot section="menu"      x={60}   y={1980} w={2040} h={1200} />
            <Hotspot section="special"   x={60}   y={3220} w={2040} h={400} />
            <Hotspot section="ticker"    x={0}    y={3640} w={2160} h={200} />
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

const CSS_SBP = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Patrick+Hand&family=Permanent+Marker&family=Special+Elite&family=Shadows+Into+Light&family=Kalam:wght@400;700&display=swap');

.sbp-stage {
  position: relative;
  background:
    radial-gradient(ellipse at 18% 8%, rgba(253,224,71,.10), transparent 50%),
    radial-gradient(ellipse at 85% 35%, rgba(244,114,182,.08), transparent 55%),
    radial-gradient(ellipse at 12% 78%, rgba(134,239,172,.07), transparent 48%),
    repeating-linear-gradient(45deg, transparent 0 10px, rgba(120,53,15,.014) 10px 11px),
    repeating-linear-gradient(-45deg, transparent 0 14px, rgba(120,53,15,.010) 14px 15px),
    #fff7ed;
  font-family: 'Patrick Hand', cursive;
  color: #3a2614;
  overflow: hidden;
  animation: sbp-paperSway 18s ease-in-out infinite;
}
@keyframes sbp-paperSway {
  0%, 100% { background-position: 0 0, 0 0, 0 0, 0 0, 0 0, 0 0; }
  50%      { background-position: 6px 4px, -4px 2px, 3px -3px, 0 0, 0 0, 0 0; }
}

/* ───── Header (60–700) ───── */
.sbp-header {
  position: absolute; left: 60px; right: 60px; top: 60px; height: 640px;
  display: grid; grid-template-columns: 300px 1fr 300px; gap: 40px; align-items: center;
  z-index: 5;
}
.sbp-logo {
  width: 300px; height: 300px;
  background: #fff; border-radius: 50%;
  box-shadow: 0 12px 28px rgba(0,0,0,.18), inset 0 0 0 14px rgba(244,114,182,.3);
  display: flex; align-items: center; justify-content: center; font-size: 160px;
  transform: rotate(-7deg); position: relative;
  align-self: center;
}
.sbp-logo::before, .sbp-logo::after {
  content: ''; position: absolute; height: 50px; width: 140px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 10px, transparent 10px 20px), #93c5fd;
  box-shadow: 0 2px 6px rgba(0,0,0,.14);
}
.sbp-logo::before { top: -22px; left: -16px; transform: rotate(-30deg); }
.sbp-logo::after  { bottom: -14px; right: -10px; transform: rotate(40deg); background-color: #fcd34d; }

.sbp-titleWrap {
  padding: 70px 64px; background: #fff;
  box-shadow: 0 16px 40px rgba(120,53,15,.20); transform: rotate(-1.5deg);
  border-top: 12px double #f9a8d4; border-bottom: 12px double #f9a8d4;
  text-align: center; position: relative;
  align-self: center;
}
.sbp-titleWrap::before, .sbp-titleWrap::after {
  content: ''; position: absolute; top: -38px; height: 64px; width: 220px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.6) 0 10px, transparent 10px 20px), #fcd34d;
  box-shadow: 0 2px 6px rgba(0,0,0,.14);
}
.sbp-titleWrap::before { left: 100px; transform: rotate(-15deg); }
.sbp-titleWrap::after  { right: 130px; transform: rotate(12deg); background-color: #86efac; }
.sbp-titleWrap h1 {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 200px; line-height: .95; margin: 0;
  color: #be185d;
}
.sbp-titleWrap .sbp-sub {
  font-family: 'Shadows Into Light', cursive; font-size: 64px; color: #92400e; margin-top: 12px; line-height: 1;
}

.sbp-clock {
  width: 300px; height: 300px;
  background: #fff; border-radius: 50%; border: 14px solid #fcd34d;
  box-shadow: 0 12px 28px rgba(0,0,0,.20); transform: rotate(8deg);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Kalam', cursive; font-weight: 700; position: relative;
  align-self: center;
}
.sbp-clock::before {
  content: ''; position: absolute; top: -28px; right: 60px; width: 160px; height: 50px; transform: rotate(28deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #f9a8d4;
  box-shadow: 0 2px 6px rgba(0,0,0,.12);
}
.sbp-clock .sbp-t  { font-size: 92px; color: #be185d; line-height: 1; }
.sbp-clock .sbp-ap { font-size: 42px; color: #92400e; margin-top: 6px; }

/* ───── Polaroid hero (740–1940) ───── */
.sbp-polaroid {
  position: absolute; left: 60px; top: 740px; width: 2040px; height: 1200px;
  background: #fff;
  padding: 50px 50px 170px;
  box-shadow: 0 28px 60px rgba(0,0,0,.22), 0 8px 16px rgba(0,0,0,.10);
  transform: rotate(-2deg);
  display: flex; flex-direction: column;
  z-index: 4;
}
.sbp-tapeTL, .sbp-tapeTR {
  position: absolute; height: 60px; width: 280px;
  box-shadow: 0 2px 8px rgba(0,0,0,.18);
}
.sbp-tapeTL {
  top: -30px; left: 80px; transform: rotate(-8deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #93c5fd;
}
.sbp-tapeTR {
  top: -30px; right: 80px; transform: rotate(8deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #fcd34d;
}
.sbp-photo {
  flex: 1;
  background:
    radial-gradient(circle at 30% 35%, #fde68a 0 180px, transparent 180px),
    radial-gradient(circle at 65% 55%, #fca5a5 0 220px, transparent 220px),
    radial-gradient(circle at 50% 70%, #86efac 0 200px, transparent 200px),
    radial-gradient(circle at 80% 25%, #c4b5fd 0 130px, transparent 130px),
    linear-gradient(135deg, #fef3c7, #fde68a 60%, #fcd34d);
  position: relative;
  display: flex; align-items: center; justify-content: center;
}
.sbp-photoEmoji {
  font-size: 600px; line-height: 1;
  filter: drop-shadow(0 16px 28px rgba(0,0,0,.22));
}
.sbp-caption {
  position: absolute; left: 0; right: 0; bottom: 60px;
  text-align: center; font-family: 'Caveat', cursive; font-size: 92px; color: #92400e; line-height: 1;
}

/* ───── Menu grid (1980–3180) — 2x3 washi-taped cards ───── */
.sbp-menuGrid {
  position: absolute; left: 60px; top: 1980px; width: 2040px; height: 1200px;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; gap: 40px 60px;
  z-index: 3;
}
.sbp-card {
  background: #fffaf0; padding: 36px 44px;
  box-shadow: 0 12px 28px rgba(0,0,0,.16);
  position: relative;
  border-left: 14px solid var(--accent, #f472b6);
  transform: rotate(var(--rot, -1deg));
  background-image: repeating-linear-gradient(to bottom, transparent 0 64px, rgba(180,83,9,.18) 64px 65px);
  background-position: 0 32px;
  display: flex; flex-direction: column; justify-content: center;
}
.sbp-card::before {
  content: ''; position: absolute; top: -28px; left: 50%;
  transform: translateX(-50%) rotate(-3deg);
  width: 220px; height: 44px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 10px, transparent 10px 20px), var(--tape, #fcd34d);
  box-shadow: 0 2px 6px rgba(0,0,0,.12);
}
.sbp-card h3 {
  margin: 0; font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 96px; line-height: 1; color: #be185d;
}
.sbp-card p {
  font-family: 'Patrick Hand', cursive; font-size: 44px; color: #4b3220;
  margin: 14px 0 18px; line-height: 1.18;
}
.sbp-badges { display: flex; gap: 12px; flex-wrap: wrap; }
.sbp-badge {
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 28px;
  padding: 10px 24px; border-radius: 999px;
  box-shadow: 0 2px 4px rgba(0,0,0,.15); letter-spacing: .04em;
}
.sbp-badge-pk { background: #f9a8d4; color: #831843; }
.sbp-badge-v  { background: #86efac; color: #14532d; }
.sbp-badge-gf { background: #fcd34d; color: #78350f; }
.sbp-badge-dy { background: #93c5fd; color: #1e3a8a; }

/* ───── Notebook-paper allergen / special note (3220–3620) ───── */
.sbp-note {
  position: absolute; left: 60px; top: 3220px; width: 2040px; height: 400px;
  background: #fff8f0;
  background-image: repeating-linear-gradient(to bottom, transparent 0 50px, rgba(147, 197, 253, .35) 50px 51px);
  background-position: 0 30px;
  padding: 40px 70px 40px 100px;
  border: 4px dashed #ec4899;
  box-shadow: 0 16px 32px rgba(0,0,0,.14);
  transform: rotate(-.6deg);
  position: absolute;
  display: flex; flex-direction: column; justify-content: center;
  z-index: 4;
}
.sbp-note::before {
  content: ''; position: absolute; left: 60px; top: 0; bottom: 0; width: 4px;
  background: #f87171;
}
.sbp-note::after {
  content: '★'; position: absolute; top: -42px; left: 80px;
  font-size: 88px; color: #f59e0b; text-shadow: 0 4px 0 #fff;
}
.sbp-noteTape {
  position: absolute; top: -32px; right: 80px; width: 220px; height: 50px;
  transform: rotate(6deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #86efac;
  box-shadow: 0 2px 6px rgba(0,0,0,.14);
}
.sbp-specialLbl {
  font-family: 'Kalam', cursive; font-weight: 700;
  font-size: 38px; color: #be185d; letter-spacing: .15em; text-transform: uppercase;
  line-height: 1;
}
.sbp-specialMsg {
  font-family: 'Caveat', cursive; font-size: 96px; color: #831843; line-height: 1.05; margin-top: 10px;
}
.sbp-countdownInline {
  margin-top: 14px; display: flex; align-items: baseline; gap: 18px;
  font-family: 'Permanent Marker', cursive;
}
.sbp-ctdLbl  { font-family: 'Kalam', cursive; font-weight: 700; font-size: 32px; color: #92400e; letter-spacing: .12em; text-transform: uppercase; }
.sbp-ctdNum  { font-family: 'Caveat', cursive; font-weight: 700; font-size: 96px; line-height: 1; color: #be185d; }
.sbp-ctdUnit { font-family: 'Patrick Hand', cursive; font-size: 44px; color: #92400e; }

/* ───── Spacer (3500–3640) — paper-texture breathing room ───── */
.sbp-spacer {
  position: absolute; left: 0; right: 0; top: 3500px; height: 140px;
  pointer-events: none;
  z-index: 2;
}
.sbp-doodle {
  position: absolute; font-family: 'Caveat', cursive; font-size: 78px; color: #f9a8d4;
  opacity: .55; line-height: 1;
}
.sbp-doodle.d1 { left: 14%; top: 30px; transform: rotate(-12deg); color: #fcd34d; }
.sbp-doodle.d2 { left: 50%; top: 14px; transform: translateX(-50%) rotate(8deg); color: #f9a8d4; font-size: 84px; }
.sbp-doodle.d3 { right: 14%; top: 36px; transform: rotate(-6deg); color: #86efac; }

/* ───── Ticker pinned bottom (3640–3840) ───── */
.sbp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 200px;
  background: #fff; border-top: 12px double #f9a8d4;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -8px 24px rgba(0,0,0,.10);
  z-index: 6;
}
.sbp-stamp {
  flex: 0 0 auto; padding: 0 70px; height: 100%;
  background: #fcd34d; color: #78350f; display: flex; align-items: center;
  font-family: 'Kalam', cursive; font-weight: 700; letter-spacing: .15em; font-size: 56px;
  border-right: 5px dashed #fff;
}
.sbp-scroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.sbp-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Caveat', cursive; font-size: 100px; color: #92400e;
  padding-left: 100%;
  animation: sbp-tickerScroll 60s linear infinite;
  will-change: transform;
}
@keyframes sbp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 18px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .10); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .16); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
