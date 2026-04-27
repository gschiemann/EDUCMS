"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// Portrait companion to AnimatedMorningNewsWidget. NOT a letterboxed
// landscape — re-flowed for vertical hallway/lobby displays:
//   • Top ~900px: giant "GOOD MORNING" title, school name tagline,
//     date pill + clock pill, and an on-air "● LIVE" lamp.
//   • Middle ~1500px: full-width anchor desk card. CSS-art of two
//     stylized news anchors at a desk + lower-third lead headline.
//   • Lower ~900px: 2-up grid — Today's Weather (3-tier card) and
//     Today's Lunch (driven from the up-next stories slot).
//   • Below that ~300px: full-width Pledge / Word of the Day card
//     (uses the existing breakingText slot so config stays compatible).
//   • Bottom ~240px: news ticker, full width.
//
// Reuses the landscape file's `Cfg` interface verbatim so no preset
// data shape changes. Reuses ticker speed math + live-clock cadence.
// Same `data-field` hotspot model so the THEMED_WIDGET_FIELDS editor
// keeps working. Animations re-prefixed `mnp-*` to avoid collisions.

import { useEffect, useMemo, useRef, useState } from 'react';

type Story = { category?: string; title?: string; time?: string };

interface Cfg {
  recLabel?: string;
  clockTimeZone?: string;

  showTitle?: string;
  showTagline?: string;

  leadEmoji?: string;
  leadLiveTag?: string;
  leadCategory?: string;
  leadHeadline?: string;
  leadByline?: string;

  stories?: Story[];

  weatherEmoji?: string;
  weatherTemp?: string;
  weatherDesc?: string;
  weatherHiLo?: string;

  breakingText?: string;

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

const DEFAULT_STORIES: Story[] = [
  { category: 'Academics',       title: 'Science Fair Winners Announced',          time: '11:52 AM' },
  { category: 'Emergency Drill', title: 'Fire Drill Recap — Everyone Out in 2:14', time: '11:58 AM' },
  { category: 'Arts',            title: 'Spring Musical Auditions Open Friday',    time: '12:04 PM' },
  { category: 'Community',       title: 'PTA Raises $12,400 for New Playground',   time: '12:10 PM' },
];

export function AnimatedMorningNewsPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  });
  const timeStr = timeFmt.format(now);
  const dateStr = dateFmt.format(now).toUpperCase();

  const stories: Story[] = useMemo(() => {
    if (Array.isArray(c.stories) && c.stories.length > 0) return c.stories.slice(0, 4);
    return DEFAULT_STORIES;
  }, [c.stories]);

  // Repurpose the first up-next story as "Today's Lunch" panel content
  const lunchStory = stories[0];

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'PEP RALLY FRIDAY 2:30 · GYM A  ✦  YEARBOOK ORDERS DUE BY MAY 2  ✦  SCIENCE FAIR JUDGING TOMORROW 9AM  ✦  PARENT-TEACHER CONFERENCES NEXT WEEK  ✦  SPRING CONCERT · APR 28 · 7PM';
  }, [c.tickerMessages]);

  const pledgeText = c.breakingText
    || 'I pledge allegiance to the flag of the United States of America, and to the republic for which it stands, one nation under God, indivisible, with liberty and justice for all.';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_MNP}</style>
      <div
        className="mnp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* TOP BAND ~ 900px — title + tagline + chips + live lamp */}
        <div className="mnp-recDot">
          <span className="mnp-dot" />
          <span className="mnp-recLabel" data-field="recLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.recLabel || '● LIVE · ON AIR'}</span>
        </div>

        <div className="mnp-dateChip">{dateStr}</div>
        <div className="mnp-clockChip">{timeStr}</div>

        <div className="mnp-showHeader">
          <div className="mnp-greet">GOOD MORNING</div>
          <h1 data-field="showTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.showTitle || 'THE DAILY DIGEST'}</h1>
          <div className="mnp-tagline" data-field="showTagline" style={{ whiteSpace: 'pre-wrap' }}>{c.showTagline || 'Your 5-minute school news'}</div>
        </div>

        {/* MIDDLE ~ 1500px — full-width anchor desk card */}
        <div className="mnp-desk">
          {/* Studio background — gradient + scan lines */}
          <div className="mnp-studio">
            <div className="mnp-studioGrid" />
            <div className="mnp-station">CHANNEL <strong>5</strong></div>
          </div>

          {/* Two stylized anchors */}
          <div className="mnp-anchor mnp-anchorLeft">
            <div className="mnp-aHair mnp-aHairL" />
            <div className="mnp-aHead" />
            <div className="mnp-aShoulders mnp-aShouldersL" />
            <div className="mnp-aTie" />
            <div className="mnp-aMic mnp-aMicL" />
          </div>
          <div className="mnp-anchor mnp-anchorRight">
            <div className="mnp-aHair mnp-aHairR" />
            <div className="mnp-aHead" />
            <div className="mnp-aShoulders mnp-aShouldersR" />
            <div className="mnp-aCollar" />
            <div className="mnp-aMic mnp-aMicR" />
          </div>

          {/* News desk surface */}
          <div className="mnp-deskTop">
            <div className="mnp-deskLogo">DAILY · DIGEST</div>
          </div>

          {/* On-screen ON-AIR tag */}
          <div className="mnp-liveTag">{c.leadLiveTag || 'LIVE'}</div>
          <div className="mnp-leadEmoji" data-field="leadEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.leadEmoji || '🏆'}</div>

          {/* Lower-third — pinned to bottom of the desk card */}
          <div className="mnp-lowerThird">
            <div className="mnp-category" data-field="leadCategory" style={{ whiteSpace: 'pre-wrap' }}>{c.leadCategory || 'Top Story · Sports'}</div>
            <div className="mnp-headline" data-field="leadHeadline" style={{ whiteSpace: 'pre-wrap' }}>{c.leadHeadline || 'Varsity Football Clinches District Title'}</div>
            <div className="mnp-byline" data-field="leadByline" style={{ whiteSpace: 'pre-wrap' }}>{c.leadByline || 'Reported by the 5th-grade newsroom · Coverage at 2:30'}</div>
          </div>
        </div>

        {/* LOWER ~ 900px — Weather + Lunch two-up */}
        <div className="mnp-twoUp">
          <div className="mnp-weatherCard">
            <div className="mnp-cardHeader">Today's Weather</div>
            <div className="mnp-weatherBody">
              <span className="mnp-wxEmoji" data-field="weatherEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherEmoji || '☀️'}</span>
              <div className="mnp-wxTemp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '68°'}</div>
              <div className="mnp-wxDesc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherDesc || 'SUNNY · LIGHT WIND'}</div>
              <div className="mnp-wxHilo" data-field="weatherHiLo" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherHiLo || 'H 72° · L 51°'}</div>
            </div>
          </div>

          <div className="mnp-lunchCard">
            <div className="mnp-cardHeader">Today's Lunch</div>
            <div className="mnp-lunchBody">
              <div className="mnp-lunchEmoji">🍱</div>
              <div className="mnp-lunchCat">{lunchStory?.category || 'Cafeteria'}</div>
              <div className="mnp-lunchTitle">{lunchStory?.title || 'Chicken Tacos · Spanish Rice · Fresh Fruit Cup'}</div>
              <div className="mnp-lunchTime">SERVED · {lunchStory?.time || '11:30 AM – 12:45 PM'}</div>
            </div>
          </div>
        </div>

        {/* PLEDGE / WORD OF THE DAY ~ 300px — full width */}
        <div className="mnp-pledgeCard">
          <div className="mnp-pledgeBadge">★ PLEDGE OF ALLEGIANCE</div>
          <div className="mnp-pledgeText" data-field="breakingText" style={{ whiteSpace: 'pre-wrap' }}>{pledgeText}</div>
        </div>

        {/* TICKER ~ 240px — pinned bottom, full width */}
        <div className="mnp-ticker">
          <div className="mnp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.tickerStamp || 'DAILY DIGEST'}</div>
          <div className="mnp-tickerScroll">
            <span
              className="mnp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={60}   y={60}   w={2040} h={140} />
            <Hotspot section="clock"      x={60}   y={220}  w={2040} h={120} />
            <Hotspot section="showTitle"  x={60}   y={360}  w={2040} h={520} />
            <Hotspot section="lead"       x={60}   y={920}  w={2040} h={1500} />
            <Hotspot section="weather"    x={60}   y={2460} w={1000} h={900} />
            <Hotspot section="stories"    x={1100} y={2460} w={1000} h={900} />
            <Hotspot section="breaking"   x={60}   y={3400} w={2040} h={300} />
            <Hotspot section="ticker"     x={0}    y={3720} w={2160} h={120} />
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

const CSS_MNP = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Inter:wght@500;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');

.mnp-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 8%, rgba(59,130,246,.28), transparent 55%),
    radial-gradient(ellipse at 50% 95%, rgba(220,38,38,.18), transparent 60%),
    linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #0f172a 100%);
  overflow: hidden;
}
.mnp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 9;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.012) 3px 5px);
}

/* TOP BAND — chips + greeting + title */
.mnp-recDot {
  position: absolute; top: 60px; left: 60px; z-index: 5;
  display: flex; align-items: center; gap: 18px;
  background: rgba(0,0,0,.55); padding: 18px 36px;
  border-radius: 999px;
  border: 4px solid rgba(220,38,38,.65);
  backdrop-filter: blur(8px);
}
.mnp-dot { width: 28px; height: 28px; border-radius: 50%; background: #dc2626; animation: mnp-rec 1s ease-in-out infinite; box-shadow: 0 0 24px #dc2626; }
@keyframes mnp-rec { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.mnp-recLabel { font-family: 'Anton', sans-serif; font-size: 44px; color: #fee2e2; letter-spacing: .15em; }

.mnp-dateChip {
  position: absolute; top: 76px; right: 60px; z-index: 5;
  font-family: 'JetBrains Mono', monospace; font-size: 36px; color: #cbd5e1;
  letter-spacing: .08em;
  background: rgba(15,23,42,.65);
  border: 2px solid rgba(148,163,184,.35);
  padding: 14px 28px; border-radius: 12px;
}
.mnp-clockChip {
  position: absolute; top: 220px; right: 60px; z-index: 5;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #0f172a;
  padding: 18px 36px; border-radius: 16px;
  font-family: 'Anton', sans-serif; font-size: 64px; line-height: 1;
  letter-spacing: .04em; box-shadow: 0 0 36px rgba(251,191,36,.45), 0 8px 18px rgba(0,0,0,.4);
}

.mnp-showHeader { position: absolute; top: 360px; left: 60px; right: 60px; z-index: 4; text-align: center; }
.mnp-greet {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 56px;
  color: #60a5fa; letter-spacing: .4em; text-transform: uppercase;
  margin-bottom: 24px;
}
.mnp-showHeader h1 {
  margin: 0;
  font-family: 'Anton', sans-serif; font-size: 320px; line-height: .88;
  background: linear-gradient(90deg, #fbbf24 0%, #dc2626 45%, #ec4899 80%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .015em;
  text-shadow: 0 0 80px rgba(251,191,36,.35);
  animation: mnp-titleGlow 4s ease-in-out infinite;
}
@keyframes mnp-titleGlow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.18); } }
.mnp-tagline {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 56px;
  color: #93c5fd; letter-spacing: .32em; text-transform: uppercase;
  margin-top: 28px;
}

/* MIDDLE — anchor desk card */
.mnp-desk {
  position: absolute; top: 920px; left: 60px; right: 60px; height: 1500px;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 6px solid rgba(251,191,36,.45);
  border-radius: 32px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.5), inset 0 0 0 2px rgba(0,0,0,.4);
  z-index: 3;
}
.mnp-studio {
  position: absolute; top: 0; left: 0; right: 0; height: 1080px;
  background:
    radial-gradient(ellipse at 30% 18%, #2563eb 0%, transparent 45%),
    radial-gradient(ellipse at 75% 70%, #dc2626 0%, transparent 50%),
    linear-gradient(135deg, #1e3a8a 0%, #831843 100%);
  overflow: hidden;
}
.mnp-studioGrid {
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(0deg, transparent 0 4px, rgba(255,255,255,.05) 4px 6px),
    repeating-linear-gradient(90deg, transparent 0 80px, rgba(255,255,255,.04) 80px 82px);
}
.mnp-station {
  position: absolute; top: 36px; right: 42px;
  font-family: 'Anton', sans-serif; font-size: 64px; color: rgba(255,255,255,.85);
  letter-spacing: .12em;
  text-shadow: 0 4px 16px rgba(0,0,0,.6);
}
.mnp-station strong {
  color: #fbbf24;
  text-shadow: 0 0 24px rgba(251,191,36,.7);
}

/* News desk surface */
.mnp-deskTop {
  position: absolute; left: 0; right: 0; bottom: 320px; height: 240px;
  background: linear-gradient(180deg, #1e3a8a 0%, #0c1c4d 100%);
  border-top: 8px solid #fbbf24;
  box-shadow: 0 -10px 40px rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 3;
}
.mnp-deskLogo {
  font-family: 'Anton', sans-serif; font-size: 96px; color: #fbbf24;
  letter-spacing: .2em;
  text-shadow: 0 4px 0 #b45309, 0 0 28px rgba(251,191,36,.4);
}

/* Stylized anchors — pure CSS shapes */
.mnp-anchor { position: absolute; bottom: 320px; width: 480px; height: 720px; z-index: 2; }
.mnp-anchorLeft  { left: 240px; }
.mnp-anchorRight { right: 240px; }

.mnp-aHead {
  position: absolute; bottom: 360px; left: 50%; transform: translateX(-50%);
  width: 220px; height: 260px; border-radius: 50% 50% 48% 48%;
  background: linear-gradient(180deg, #fde68a 0%, #f5d0a9 60%, #d4a574 100%);
  box-shadow: 0 12px 30px rgba(0,0,0,.45), inset -16px -10px 20px rgba(180,83,9,.22);
  z-index: 2;
}
/* Subtle facial features so the head reads as a face, not a pill */
.mnp-aHead::before {
  content: ''; position: absolute; top: 110px; left: 56px;
  width: 22px; height: 14px; background: #1f2937; border-radius: 50%;
  box-shadow: 88px 0 0 #1f2937;
}
.mnp-aHead::after {
  content: ''; position: absolute; top: 168px; left: 50%; transform: translateX(-50%);
  width: 50px; height: 16px; background: #b91c1c; border-radius: 50%;
}

.mnp-aHair {
  position: absolute; bottom: 540px; left: 50%; transform: translateX(-50%);
  width: 260px; height: 130px;
  z-index: 3;
}
.mnp-aHairL {
  background: linear-gradient(180deg, #44403c 0%, #292524 100%);
  border-radius: 130px 130px 18px 18px;
  box-shadow: 0 -4px 0 #1c1917;
}
.mnp-aHairR {
  background: linear-gradient(180deg, #92400e 0%, #78350f 100%);
  border-radius: 130px 130px 30px 30px;
  box-shadow: 0 -4px 0 #451a03;
}

.mnp-aShoulders {
  position: absolute; bottom: 240px; left: 50%; transform: translateX(-50%);
  width: 480px; height: 200px;
  border-radius: 240px 240px 0 0;
  z-index: 1;
  box-shadow: 0 -8px 24px rgba(0,0,0,.45);
}
.mnp-aShouldersL { background: linear-gradient(180deg, #1e3a8a 0%, #0c1c4d 100%); }
.mnp-aShouldersR { background: linear-gradient(180deg, #7f1d1d 0%, #450a0a 100%); }

/* Tie / collar accent */
.mnp-aTie {
  position: absolute; bottom: 240px; left: 50%; transform: translateX(-50%);
  width: 36px; height: 140px;
  background: linear-gradient(180deg, #dc2626 0%, #991b1b 100%);
  clip-path: polygon(0 0, 100% 0, 75% 100%, 25% 100%);
  z-index: 4;
}
.mnp-aCollar {
  position: absolute; bottom: 320px; left: 50%; transform: translateX(-50%);
  width: 140px; height: 60px;
  background: #fef3c7;
  clip-path: polygon(0 0, 100% 0, 75% 100%, 50% 50%, 25% 100%);
  z-index: 4;
}

/* Microphone */
.mnp-aMic {
  position: absolute; bottom: 280px; width: 44px; height: 60px;
  background: #1f2937; border-radius: 22px 22px 8px 8px;
  border: 3px solid #fbbf24;
  z-index: 5;
}
.mnp-aMic::before {
  content: ''; position: absolute; bottom: -90px; left: 50%; transform: translateX(-50%);
  width: 6px; height: 100px; background: #1f2937; border-radius: 3px;
}
.mnp-aMicL { right: 80px; }
.mnp-aMicR { left: 80px; }

/* On-screen LIVE tag inside the desk frame */
.mnp-liveTag {
  position: absolute; top: 32px; left: 32px; z-index: 6;
  background: #dc2626; color: #fff;
  padding: 14px 28px;
  font-family: 'Anton', sans-serif; font-size: 44px;
  letter-spacing: .15em; border-radius: 8px;
  box-shadow: 0 0 32px rgba(220,38,38,.55), 0 8px 16px rgba(0,0,0,.35);
  display: flex; align-items: center; gap: 14px;
}
.mnp-liveTag::before {
  content: ''; width: 16px; height: 16px; border-radius: 50%; background: #fee2e2;
  box-shadow: 0 0 12px #fff;
  animation: mnp-rec 1s ease-in-out infinite;
}
.mnp-leadEmoji {
  position: absolute; top: 90px; right: 96px; z-index: 4;
  font-size: 220px; line-height: 1;
  filter: drop-shadow(0 18px 32px rgba(0,0,0,.6));
  animation: mnp-iconBob 3.6s ease-in-out infinite;
}
@keyframes mnp-iconBob { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg) scale(1.04); } }

.mnp-lowerThird {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 6;
  background: linear-gradient(90deg, rgba(0,0,0,.97) 0%, rgba(0,0,0,.78) 100%);
  padding: 36px 56px;
  border-top: 6px solid #fbbf24;
  backdrop-filter: blur(6px);
}
.mnp-category {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 36px;
  color: #fbbf24; letter-spacing: .25em; text-transform: uppercase;
  display: flex; align-items: center; gap: 18px;
}
.mnp-category::after {
  content: ''; flex: 1; height: 4px; background: linear-gradient(90deg, #fbbf24 0%, transparent 100%);
}
.mnp-headline {
  font-family: 'Anton', sans-serif; font-size: 124px; line-height: 1; color: #fff;
  margin-top: 16px; letter-spacing: .01em;
}
.mnp-byline {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 36px;
  color: #cbd5e1; margin-top: 18px; letter-spacing: .04em;
}

/* LOWER — Weather + Lunch two-up */
.mnp-twoUp {
  position: absolute; top: 2460px; left: 60px; right: 60px; height: 900px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
  z-index: 3;
}

.mnp-weatherCard, .mnp-lunchCard {
  position: relative;
  border-radius: 32px;
  padding: 48px 56px;
  border: 4px solid rgba(251,191,36,.4);
  box-shadow: 0 24px 60px rgba(0,0,0,.45);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.mnp-weatherCard {
  background:
    radial-gradient(ellipse at 80% 20%, rgba(251,191,36,.25), transparent 60%),
    linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%);
}
.mnp-lunchCard {
  background:
    radial-gradient(ellipse at 20% 80%, rgba(236,72,153,.25), transparent 60%),
    linear-gradient(135deg, #581c87 0%, #831843 100%);
  border-color: rgba(236,72,153,.45);
}

.mnp-cardHeader {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 44px;
  color: #fbbf24; letter-spacing: .25em; text-transform: uppercase;
  display: flex; align-items: center; gap: 20px;
  margin-bottom: 32px;
}
.mnp-cardHeader::after {
  content: ''; flex: 1; height: 4px; background: linear-gradient(90deg, rgba(251,191,36,.6) 0%, transparent 100%);
}
.mnp-lunchCard .mnp-cardHeader { color: #fbcfe8; }
.mnp-lunchCard .mnp-cardHeader::after { background: linear-gradient(90deg, rgba(236,72,153,.6) 0%, transparent 100%); }

.mnp-weatherBody { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.mnp-wxEmoji { font-size: 220px; line-height: 1; filter: drop-shadow(0 12px 24px rgba(0,0,0,.5)); animation: mnp-iconBob 3.6s ease-in-out infinite; }
.mnp-wxTemp {
  font-family: 'Anton', sans-serif; font-size: 200px; color: #fbbf24; line-height: 1;
  margin-top: 12px;
  text-shadow: 0 0 40px rgba(251,191,36,.55);
}
.mnp-wxDesc {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 40px;
  color: #dbeafe; letter-spacing: .15em; text-transform: uppercase;
  margin-top: 20px;
}
.mnp-wxHilo {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 36px;
  color: #93c5fd; margin-top: 16px; letter-spacing: .06em;
}

.mnp-lunchBody { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.mnp-lunchEmoji { font-size: 180px; line-height: 1; filter: drop-shadow(0 12px 24px rgba(0,0,0,.5)); animation: mnp-iconBob 3.6s ease-in-out infinite; }
.mnp-lunchCat {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 32px;
  color: #fbcfe8; letter-spacing: .3em; text-transform: uppercase;
  margin-top: 28px;
}
.mnp-lunchTitle {
  font-family: 'Anton', sans-serif; font-size: 76px;
  color: #fff; line-height: 1.05; margin-top: 18px;
  letter-spacing: .01em;
  text-shadow: 0 4px 16px rgba(0,0,0,.5);
}
.mnp-lunchTime {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  color: #f5d0fe; letter-spacing: .1em;
  margin-top: 22px;
  background: rgba(236,72,153,.18);
  border: 2px solid rgba(236,72,153,.4);
  padding: 12px 28px; border-radius: 999px;
}

/* PLEDGE / WORD OF THE DAY full-width strip */
.mnp-pledgeCard {
  position: absolute; top: 3400px; left: 60px; right: 60px; height: 280px;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(251,191,36,.2), transparent 60%),
    linear-gradient(90deg, #7f1d1d 0%, #1e3a8a 50%, #7f1d1d 100%);
  border: 5px solid #fef3c7;
  border-radius: 24px;
  padding: 36px 56px;
  z-index: 4;
  box-shadow: 0 18px 48px rgba(0,0,0,.4);
  overflow: hidden;
}
.mnp-pledgeCard::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg, transparent 0 80px, rgba(255,255,255,.05) 80px 82px);
  pointer-events: none;
}
.mnp-pledgeBadge {
  font-family: 'Anton', sans-serif; font-size: 44px;
  color: #fef3c7; letter-spacing: .2em;
  text-shadow: 0 4px 12px rgba(0,0,0,.5);
  margin-bottom: 18px;
  position: relative; z-index: 1;
}
.mnp-pledgeText {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 38px;
  color: #fff; line-height: 1.25;
  position: relative; z-index: 1;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden;
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
}

/* TICKER — pinned bottom */
.mnp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 240px;
  background: #0f172a;
  display: flex; align-items: center; overflow: hidden;
  border-top: 6px solid #fbbf24;
  z-index: 7;
  box-shadow: 0 -8px 24px rgba(0,0,0,.55);
}
.mnp-tickerStamp {
  flex: 0 0 auto; padding: 0 56px; height: 100%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #0f172a; display: flex; align-items: center;
  font-family: 'Anton', sans-serif; font-size: 84px; letter-spacing: .1em;
  border-right: 6px solid #b45309;
}
.mnp-tickerScroll { flex: 1; overflow: hidden; height: 100%; display: flex; align-items: center; }
.mnp-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 88px;
  color: #fff; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: mnp-tickerScroll 60s linear infinite;
  letter-spacing: .02em;
}
@keyframes mnp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
