"use client";

// PORTED 2026-04-20 from scratch/design/scrapbook-cafeteria.html — transform:scale pattern, isLive-gated hotspots.
// Scrapbook cafeteria: polaroid food photo, washi-tape menu cards, handwritten fonts.
// Ticker pinned position:absolute bottom:0 inside stage — preserve.

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

const CANVAS_W = 1920;
const CANVAS_H = 1080;

export function ScrapbookCafeteriaWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { title: 'Chef Salad', desc: 'Romaine, grilled chicken, tomatoes, cheese, ranch.', badges: [{ label: 'GF', kind: 'gf' }, { label: 'DAIRY', kind: 'dy' }], accent: '#f472b6', rot: '-1.5deg', tape: '#fcd34d' },
      { title: 'Roasted Veggies', desc: 'Carrots, zucchini, peppers — olive oil, sea salt.', badges: [{ label: 'VEGAN', kind: 'v' }, { label: 'GF', kind: 'gf' }], accent: '#86efac', rot: '1.2deg', tape: '#86efac' },
      { title: 'Fruit Cup', desc: 'Watermelon, pineapple, fresh summer berries.', badges: [{ label: 'VEGAN', kind: 'v' }, { label: 'GF', kind: 'gf' }], accent: '#fcd34d', rot: '-1deg', tape: '#93c5fd' },
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
      <style>{CSS_SBC}</style>

      <div
        className="sbc-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="sbc-header">
          <div className="sbc-logo">{c.logoEmoji || '🍎'}</div>
          <div className="sbc-titleWrap">
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || "Today's Menu"}</h1>
            <div className="sbc-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || "what's cooking in the kitchen"}</div>
          </div>
          <div className="sbc-clock"><div className="sbc-t">{hh}:{mm}</div><div className="sbc-ap">{ampm}</div></div>
        </div>

        <div className="sbc-polaroid">
          <div className="sbc-photo" data-emoji={c.polaroidEmoji || '🍝'}>
            <span className="sbc-photoEmoji">{c.polaroidEmoji || '🍝'}</span>
          </div>
          <div className="sbc-caption" data-field="polaroidCaption" style={{ whiteSpace: 'pre-wrap' }}>{c.polaroidCaption || '~ snapped this morning ~'}</div>
        </div>

        <div className="sbc-menuStack">
          {cards.slice(0, 4).map((card, i) => (
            <div
              key={i}
              className="sbc-card"
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
                <div className="sbc-badges">
                  {card.badges.map((b, bi) => (
                    <span key={bi} className={`sbc-badge sbc-badge-${b.kind || 'pk'}`}>{b.label || ''}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="sbc-special">
          <div className="sbc-specialLbl" data-field="specialLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.specialLabel || "Today's Special"}</div>
          <div className="sbc-specialMsg" data-field="specialMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.specialMsg || 'Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2.'}</div>
        </div>

        <div className="sbc-countdown">
          <div className="sbc-ctdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Next meal in'}</div>
          <div className="sbc-ctdNum">{days}</div>
          <div className="sbc-ctdUnit">{unit}</div>
        </div>

        <div className="sbc-ticker">
          <div className="sbc-stamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'FROM THE KITCHEN').toUpperCase()}</div>
          <div className="sbc-scroll">
            <span
              className="sbc-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 45)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="logo"        x={48}   y={28}  w={170} h={170} />
            <Hotspot section="header"      x={240}  y={28}  w={1440} h={170} />
            <Hotspot section="clock"       x={1700} y={28}  w={172} h={170} />
            <Hotspot section="polaroid"    x={48}   y={226} w={1072} h={660} />
            <Hotspot section="menu"        x={1140} y={226} w={732}  h={660} />
            <Hotspot section="special"     x={48}   y={912} w={1072} h={100} />
            <Hotspot section="countdown"   x={1140} y={912} w={732}  h={100} />
            <Hotspot section="ticker"      x={0}    y={1000} w={1920} h={80} />
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

const CSS_SBC = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Patrick+Hand&family=Shadows+Into+Light&family=Kalam:wght@400;700&display=swap');

.sbc-stage {
  position: relative;
  background:
    radial-gradient(ellipse at 20% 10%, rgba(253,224,71,.08), transparent 50%),
    radial-gradient(ellipse at 80% 90%, rgba(244,114,182,.07), transparent 55%),
    repeating-linear-gradient(45deg, transparent 0 6px, rgba(120,53,15,.012) 6px 7px),
    #fbf3df;
  font-family: 'Patrick Hand', cursive;
  color: #3a2614;
  overflow: hidden;
  padding: 28px 48px 96px;
}

.sbc-header {
  position: absolute; left: 48px; right: 48px; top: 28px; height: 170px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 28px; align-items: center;
}
.sbc-logo {
  width: 150px; height: 150px;
  background: #fff; border-radius: 50%;
  box-shadow: 0 4px 12px rgba(0,0,0,.15), inset 0 0 0 7px rgba(244,114,182,.3);
  display: flex; align-items: center; justify-content: center; font-size: 70px;
  transform: rotate(-6deg); position: relative;
}
.sbc-logo::before, .sbc-logo::after {
  content: ''; position: absolute; height: 26px; width: 70px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 5px, transparent 5px 10px), #93c5fd;
  box-shadow: 0 1px 3px rgba(0,0,0,.12);
}
.sbc-logo::before { top: -10px; left: -8px; transform: rotate(-30deg); }
.sbc-logo::after  { bottom: -6px; right: -4px; transform: rotate(40deg); background-color: #fcd34d; }

.sbc-titleWrap {
  padding: 22px 36px; background: #fff;
  box-shadow: 0 6px 18px rgba(120,53,15,.18); transform: rotate(-1deg);
  border-top: 5px double #f9a8d4; border-bottom: 5px double #f9a8d4;
  text-align: center; position: relative;
}
.sbc-titleWrap::before, .sbc-titleWrap::after {
  content: ''; position: absolute; top: -18px; height: 32px; width: 110px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.6) 0 5px, transparent 5px 10px), #fcd34d;
  box-shadow: 0 1px 3px rgba(0,0,0,.12);
}
.sbc-titleWrap::before { left: 80px; transform: rotate(-15deg); }
.sbc-titleWrap::after  { right: 110px; transform: rotate(12deg); background-color: #86efac; }
.sbc-titleWrap h1 { font-family: 'Caveat', cursive; font-weight: 700; font-size: 90px; line-height: 1; margin: 0; color: #be185d; }
.sbc-titleWrap .sbc-sub { font-family: 'Shadows Into Light', cursive; font-size: 30px; color: #92400e; margin-top: 6px; }

.sbc-clock {
  width: 150px; height: 150px;
  background: #fff; border-radius: 50%; border: 7px solid #fcd34d;
  box-shadow: 0 4px 12px rgba(0,0,0,.18); transform: rotate(7deg);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Kalam', cursive; font-weight: 700; position: relative;
}
.sbc-clock::before {
  content: ''; position: absolute; top: -14px; right: 32px; width: 80px; height: 26px; transform: rotate(28deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 5px, transparent 5px 10px), #f9a8d4;
  box-shadow: 0 1px 3px rgba(0,0,0,.1);
}
.sbc-clock .sbc-t { font-size: 44px; color: #be185d; line-height: 1; }
.sbc-clock .sbc-ap { font-size: 20px; color: #92400e; }

.sbc-polaroid {
  position: absolute; left: 48px; top: 226px; width: 1072px; height: 660px;
  background: #fff;
  padding: 24px 24px 80px;
  box-shadow: 0 14px 32px rgba(0,0,0,.22), 0 4px 8px rgba(0,0,0,.1);
  transform: rotate(-2deg);
  display: flex; flex-direction: column;
}
.sbc-polaroid::before {
  content: ''; position: absolute; top: -22px; left: 40%; width: 150px; height: 34px; transform: rotate(-4deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 6px, transparent 6px 12px), #93c5fd;
  box-shadow: 0 1px 4px rgba(0,0,0,.15);
}
.sbc-photo {
  flex: 1;
  background:
    radial-gradient(circle at 30% 35%, #fde68a 0 80px, transparent 80px),
    radial-gradient(circle at 65% 55%, #fca5a5 0 100px, transparent 100px),
    radial-gradient(circle at 50% 70%, #86efac 0 90px, transparent 90px),
    linear-gradient(135deg, #fef3c7, #fde68a 60%, #fcd34d);
  position: relative;
  display: flex; align-items: center; justify-content: center;
}
.sbc-photoEmoji {
  font-size: 280px; line-height: 1;
  filter: drop-shadow(0 8px 12px rgba(0,0,0,.2));
}
.sbc-caption {
  position: absolute; left: 0; right: 0; bottom: 24px;
  text-align: center; font-family: 'Caveat', cursive; font-size: 44px; color: #92400e;
}

.sbc-menuStack {
  position: absolute; left: 1140px; top: 226px; width: 732px; height: 660px;
  display: flex; flex-direction: column; gap: 22px;
}
.sbc-card {
  background: #fffaf0; padding: 18px 24px 18px;
  box-shadow: 0 6px 14px rgba(0,0,0,.15);
  position: relative;
  border-left: 6px solid var(--accent, #f472b6);
  transform: rotate(var(--rot, -1deg));
  background-image: repeating-linear-gradient(to bottom, transparent 0 36px, rgba(180,83,9,.18) 36px 37px);
  background-position: 0 14px;
  flex: 1;
  display: flex; flex-direction: column; justify-content: center;
}
.sbc-card::before {
  content: ''; position: absolute; top: -14px; left: 50%; transform: translateX(-50%) rotate(-3deg);
  width: 100px; height: 22px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 5px, transparent 5px 10px), var(--tape, #fcd34d);
  box-shadow: 0 1px 3px rgba(0,0,0,.12);
}
.sbc-card h3 { margin: 0; font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px; line-height: 1; color: #be185d; }
.sbc-card p { font-family: 'Patrick Hand', cursive; font-size: 28px; color: #4b3220; margin: 8px 0 12px; line-height: 1.25; }
.sbc-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.sbc-badge {
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 16px; padding: 5px 14px;
  border-radius: 999px; box-shadow: 0 1px 2px rgba(0,0,0,.15); letter-spacing: .04em;
}
.sbc-badge-pk { background: #f9a8d4; color: #831843; }
.sbc-badge-v  { background: #86efac; color: #14532d; }
.sbc-badge-gf { background: #fcd34d; color: #78350f; }
.sbc-badge-dy { background: #93c5fd; color: #1e3a8a; }

.sbc-special {
  position: absolute; left: 48px; top: 912px; width: 1072px; height: 100px;
  background: #fff8f0; padding: 22px 32px; transform: rotate(-1deg);
  border: 3px dashed #ec4899; box-shadow: 0 6px 14px rgba(0,0,0,.12);
  display: flex; flex-direction: column; justify-content: center;
}
.sbc-special::before {
  content: '★'; position: absolute; top: -28px; left: 28px; font-size: 48px; color: #f59e0b; text-shadow: 0 2px 0 #fff;
}
.sbc-specialLbl { font-family: 'Kalam', cursive; font-weight: 700; font-size: 20px; color: #be185d; letter-spacing: .15em; text-transform: uppercase; }
.sbc-specialMsg { font-family: 'Caveat', cursive; font-size: 56px; color: #831843; line-height: 1.05; margin-top: 4px; }

.sbc-countdown {
  position: absolute; left: 1140px; top: 912px; width: 732px; height: 100px;
  background: #fff; padding: 10px 22px; transform: rotate(2deg);
  box-shadow: 0 6px 14px rgba(0,0,0,.18);
  text-align: center; border: 1px solid #fcd34d; border-top: 8px solid #fcd34d;
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 20px;
}
.sbc-countdown::before { content: '⏰'; position: absolute; top: -28px; left: 16px; font-size: 38px; }
.sbc-ctdLbl { font-family: 'Kalam', cursive; font-weight: 700; font-size: 18px; color: #92400e; letter-spacing: .12em; text-transform: uppercase; }
.sbc-ctdNum { font-family: 'Caveat', cursive; font-weight: 700; font-size: 72px; line-height: 1; color: #be185d; }
.sbc-ctdUnit { font-family: 'Patrick Hand', cursive; font-size: 26px; color: #92400e; }

.sbc-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 80px;
  background: #fff; border-top: 5px double #f9a8d4;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -4px 12px rgba(0,0,0,.08);
  z-index: 6;
}
.sbc-stamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #fcd34d; color: #78350f; display: flex; align-items: center;
  font-family: 'Kalam', cursive; font-weight: 700; letter-spacing: .15em; font-size: 20px;
  border-right: 2px dashed #fff;
}
.sbc-scroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.sbc-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Caveat', cursive; font-size: 40px; color: #92400e;
  padding-left: 100%;
  animation: sbc-tickerScroll 45s linear infinite;
  will-change: transform;
}
@keyframes sbc-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
