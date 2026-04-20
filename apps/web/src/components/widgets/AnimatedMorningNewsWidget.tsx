"use client";

// PORTED 2026-04-20 from scratch/design/animated-morning-news.html — transform:scale pattern, isLive-gated hotspots.

import { useEffect, useMemo, useRef, useState } from 'react';

type Story = { category?: string; title?: string; time?: string };

interface Cfg {
  recLabel?: string;              // "● LIVE · ON AIR"
  clockTimeZone?: string;

  showTitle?: string;             // "THE DAILY DIGEST"
  showTagline?: string;           // "Your 5-minute school news"

  // Lead story
  leadEmoji?: string;             // "🏆"
  leadLiveTag?: string;           // "LIVE"
  leadCategory?: string;          // "Top Story · Sports"
  leadHeadline?: string;
  leadByline?: string;

  // Up-next stories
  stories?: Story[];

  // Weather
  weatherEmoji?: string;
  weatherTemp?: string;
  weatherDesc?: string;
  weatherHiLo?: string;

  // Breaking ticker (top strip, red)
  breakingText?: string;

  // Main ticker
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

const DEFAULT_STORIES: Story[] = [
  { category: 'Academics',       title: 'Science Fair Winners Announced',         time: '11:52 AM' },
  { category: 'Emergency Drill', title: 'Fire Drill Recap — Everyone Out in 2:14', time: '11:58 AM' },
  { category: 'Arts',            title: 'Spring Musical Auditions Open Friday',   time: '12:04 PM' },
  { category: 'Community',       title: 'PTA Raises $12,400 for New Playground',  time: '12:10 PM' },
];

export function AnimatedMorningNewsWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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
    weekday: 'short', month: 'short', day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  });
  const timeStr = timeFmt.format(now);
  const dateStr = dateFmt.format(now).toUpperCase().replace(/,/g, '').replace(/\s+/g, ' · ');

  const stories: Story[] = useMemo(() => {
    if (Array.isArray(c.stories) && c.stories.length > 0) return c.stories.slice(0, 4);
    return DEFAULT_STORIES;
  }, [c.stories]);

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'PEP RALLY FRIDAY 2:30 · GYM A  ✦  YEARBOOK ORDERS DUE BY MAY 2  ✦  SCIENCE FAIR JUDGING TOMORROW 9AM  ✦  PARENT-TEACHER CONFERENCES NEXT WEEK  ✦  SPRING CONCERT · APR 28 · 7PM';
  }, [c.tickerMessages]);

  const breakingText = c.breakingText
    || 'Early dismissal FRIDAY at 1:15 PM — buses depart immediately after · book fair extended through next Tuesday · new library hours: open until 4:30';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_MN}</style>
      <div
        className="mn-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="mn-recDot">
          <span className="mn-dot" />
          <span className="mn-recLabel">{c.recLabel || '● LIVE · ON AIR'}</span>
        </div>

        {/* Time chip at top-right — absolute positioning so it never competes with the title */}
        <div className="mn-topBar">
          <span className="mn-date">{dateStr}</span>
          <span className="mn-time">{timeStr}</span>
        </div>

        <div className="mn-showHeader">
          <h1>{c.showTitle || 'THE DAILY DIGEST'}</h1>
          <div className="mn-tagline">{c.showTagline || 'Your 5-minute school news'}</div>
        </div>

        <div className="mn-grid">
          <div className="mn-lead">
            <div className="mn-screen">
              <div className="mn-liveTag">{c.leadLiveTag || 'LIVE'}</div>
              <div className="mn-iconic">{c.leadEmoji || '🏆'}</div>
              <div className="mn-lowerThird">
                <div className="mn-category">{c.leadCategory || 'Top Story · Sports'}</div>
                <div className="mn-headline">{c.leadHeadline || 'Varsity Football Clinches District Title'}</div>
                <div className="mn-byline">{c.leadByline || 'Reported by the 5th-grade newsroom · Coverage at 2:30'}</div>
              </div>
            </div>
          </div>

          <div className="mn-rightCol">
            <div className="mn-rightHeader">Up Next</div>
            <div className="mn-stories">
              {stories.map((s, i) => (
                <div key={i} className="mn-story">
                  <div className="mn-idx">{String(i + 2).padStart(2, '0')}</div>
                  <div className="mn-content">
                    <div className="mn-cat">{s.category || ''}</div>
                    <div className="mn-storyTitle">{s.title || ''}</div>
                    <div className="mn-storyTime">{s.time || ''}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mn-wxCard">
              <span className="mn-wxEmoji">{c.weatherEmoji || '☀️'}</span>
              <div className="mn-wxInfo">
                <div className="mn-wxTemp">{c.weatherTemp || '68°'}</div>
                <div className="mn-wxDesc">{c.weatherDesc || 'SUNNY · LIGHT WIND'}</div>
                <div className="mn-wxHilo">{c.weatherHiLo || 'H 72° · L 51°'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mn-breakingWrap">
          <div className="mn-breaking">
            <div className="mn-bStamp">★ BREAKING</div>
            <div className="mn-bScroll">
              <span
                className="mn-bText"
                style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 40)}s` }}
              >{breakingText}</span>
            </div>
          </div>
          <div className="mn-mainTicker">
            <div className="mn-mStamp">{c.tickerStamp || 'DAILY DIGEST'}</div>
            <div className="mn-mScroll">
              <span
                className="mn-mText"
                style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 54)}s` }}
              >{tickerText}</span>
            </div>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={36}  y={36}   w={400}  h={60} />
            <Hotspot section="clock"     x={1500} y={36}  w={384}  h={60} />
            <Hotspot section="showTitle" x={36}  y={100}  w={1848} h={220} />
            <Hotspot section="lead"      x={36}  y={330}  w={1436} h={570} />
            <Hotspot section="stories"   x={1492} y={330} w={392}  h={400} />
            <Hotspot section="weather"   x={1492} y={740} w={392}  h={160} />
            <Hotspot section="breaking"  x={0}   y={930}  w={1920} h={40} />
            <Hotspot section="ticker"    x={0}   y={970}  w={1920} h={110} />
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

const CSS_MN = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Inter:wght@500;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

.mn-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 10%, rgba(59,130,246,.2), transparent 60%),
    linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  overflow: hidden;
}
.mn-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 7;
  background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,.015) 2px 4px);
}

.mn-recDot {
  position: absolute; top: 36px; left: 36px; z-index: 5;
  display: flex; align-items: center; gap: 12px;
  background: rgba(0,0,0,.5); padding: 10px 20px;
  border-radius: 999px;
  border: 2px solid rgba(220,38,38,.6);
  backdrop-filter: blur(6px);
}
.mn-dot { width: 14px; height: 14px; border-radius: 50%; background: #dc2626; animation: mn-rec 1s ease-in-out infinite; box-shadow: 0 0 12px #dc2626; }
@keyframes mn-rec { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.mn-recLabel { font-family: 'Anton', sans-serif; font-size: 22px; color: #fee2e2; letter-spacing: .15em; }

.mn-topBar {
  position: absolute; top: 36px; right: 36px; z-index: 5;
  display: flex; align-items: center; gap: 16px;
}
.mn-date { font-family: 'JetBrains Mono', monospace; font-size: 20px; color: #94a3b8; letter-spacing: .05em; }
.mn-time {
  background: #fbbf24; color: #0f172a;
  padding: 8px 16px; border-radius: 8px;
  font-family: 'Anton', sans-serif; font-size: 32px; line-height: 1;
  letter-spacing: .05em; box-shadow: 0 0 20px rgba(251,191,36,.4);
}

.mn-showHeader { position: absolute; top: 100px; left: 36px; right: 36px; z-index: 4; text-align: center; }
.mn-showHeader h1 {
  margin: 0;
  font-family: 'Anton', sans-serif; font-size: 132px; line-height: .9;
  background: linear-gradient(90deg, #fbbf24 0%, #dc2626 40%, #ec4899 80%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em;
  text-shadow: 0 0 40px rgba(251,191,36,.3);
  animation: mn-titleGlow 4s ease-in-out infinite;
}
@keyframes mn-titleGlow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.15); } }
.mn-tagline {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 26px;
  color: #60a5fa; letter-spacing: .3em; text-transform: uppercase;
  margin-top: 8px;
}

.mn-grid {
  position: absolute; top: 330px; left: 36px; right: 36px; bottom: 180px;
  display: grid; grid-template-columns: 1fr 420px;
  gap: 28px; z-index: 3;
}

.mn-lead {
  position: relative;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 3px solid rgba(251,191,36,.4); border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.mn-screen {
  flex: 1; position: relative; overflow: hidden;
  background:
    radial-gradient(ellipse at 30% 20%, #2563eb 0%, transparent 40%),
    radial-gradient(ellipse at 70% 70%, #dc2626 0%, transparent 45%),
    linear-gradient(135deg, #1e3a8a 0%, #831843 100%);
}
.mn-screen::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.04) 3px 4px);
}
.mn-iconic {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 280px; line-height: 1; filter: drop-shadow(0 12px 24px rgba(0,0,0,.5));
  animation: mn-iconBob 3.6s ease-in-out infinite;
  z-index: 1;
}
@keyframes mn-iconBob { 0%, 100% { transform: translate(-50%, -50%) rotate(-3deg); } 50% { transform: translate(-50%, -50%) rotate(3deg) scale(1.03); } }
.mn-liveTag {
  position: absolute; top: 16px; left: 16px; z-index: 2;
  background: #dc2626; color: #fff;
  padding: 6px 14px;
  font-family: 'Anton', sans-serif; font-size: 22px;
  letter-spacing: .15em; border-radius: 4px;
  box-shadow: 0 0 20px rgba(220,38,38,.5);
  display: flex; align-items: center; gap: 8px;
}
.mn-liveTag::before {
  content: ''; width: 8px; height: 8px; border-radius: 50%; background: #fee2e2;
  box-shadow: 0 0 8px #fff;
  animation: mn-rec 1s ease-in-out infinite;
}
.mn-lowerThird {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 2;
  background: linear-gradient(90deg, rgba(0,0,0,.95) 0%, rgba(0,0,0,.7) 100%);
  padding: 20px 28px;
  border-top: 3px solid #fbbf24;
  backdrop-filter: blur(4px);
}
.mn-category {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 15px;
  color: #fbbf24; letter-spacing: .25em; text-transform: uppercase;
  display: flex; align-items: center; gap: 10px;
}
.mn-category::after {
  content: ''; flex: 1; height: 2px; background: linear-gradient(90deg, #fbbf24 0%, transparent 100%);
}
.mn-headline {
  font-family: 'Anton', sans-serif; font-size: 54px; line-height: 1; color: #fff;
  margin-top: 6px; letter-spacing: .01em;
}
.mn-byline {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 16px;
  color: #94a3b8; margin-top: 8px; letter-spacing: .05em;
}

.mn-rightCol { display: flex; flex-direction: column; gap: 20px; min-height: 0; }
.mn-rightHeader {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 18px;
  color: #60a5fa; letter-spacing: .25em; text-transform: uppercase;
  display: flex; align-items: center; gap: 12px;
}
.mn-rightHeader::before, .mn-rightHeader::after {
  content: ''; flex: 1; height: 2px; background: rgba(96,165,250,.3);
}

.mn-stories { flex: 1; display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: hidden; }
.mn-story {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 18px;
  background: rgba(255,255,255,.04); border-radius: 12px;
  border-left: 4px solid #fbbf24;
  position: relative;
  color-scheme: dark;
}
.mn-story:nth-child(2) { border-left-color: #dc2626; }
.mn-story:nth-child(3) { border-left-color: #60a5fa; }
.mn-story:nth-child(4) { border-left-color: #10b981; }
.mn-idx {
  font-family: 'Anton', sans-serif; font-size: clamp(42px, 70cqh, 80px);
  line-height: .85; color: rgba(255,255,255,.25);
  flex: 0 0 auto; min-width: 56px;
  align-self: center;
}
.mn-content {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; justify-content: center;
  gap: 4px;
  padding-right: 88px; /* reserve for absolute time chip */
}
.mn-cat {
  font-family: 'Inter', sans-serif; font-weight: 800;
  font-size: clamp(11px, 16cqh, 15px);
  letter-spacing: .2em; text-transform: uppercase;
  color: #fbbf24;
}
.mn-story:nth-child(2) .mn-cat { color: #f87171; }
.mn-story:nth-child(3) .mn-cat { color: #93c5fd; }
.mn-story:nth-child(4) .mn-cat { color: #6ee7b7; }
.mn-storyTitle {
  font-family: 'Inter', sans-serif; font-weight: 700;
  font-size: clamp(17px, 30cqh, 28px);
  color: #fff; line-height: 1.15;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
  background: transparent;
}
.mn-storyTime {
  position: absolute;
  top: 10px; right: 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(11px, 16cqh, 14px);
  font-weight: 700;
  color: #fbbf24; letter-spacing: .08em;
  background: rgba(251,191,36,.12);
  border: 1px solid rgba(251,191,36,.3);
  padding: 3px 10px; border-radius: 999px;
  white-space: nowrap;
}
.mn-story:nth-child(2) .mn-storyTime { color: #fca5a5; background: rgba(220,38,38,.12); border-color: rgba(220,38,38,.3); }
.mn-story:nth-child(3) .mn-storyTime { color: #bfdbfe; background: rgba(59,130,246,.12); border-color: rgba(59,130,246,.3); }
.mn-story:nth-child(4) .mn-storyTime { color: #86efac; background: rgba(16,185,129,.12); border-color: rgba(16,185,129,.3); }

.mn-wxCard {
  background: linear-gradient(135deg, #1e3a8a, #1d4ed8);
  border: 2px solid rgba(251,191,36,.3);
  border-radius: 16px; padding: 16px 20px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: 0 8px 20px rgba(0,0,0,.4);
}
.mn-wxEmoji { font-size: 60px; line-height: 1; filter: drop-shadow(0 3px 4px rgba(0,0,0,.3)); }
.mn-wxInfo { flex: 1; }
.mn-wxTemp {
  font-family: 'Anton', sans-serif; font-size: 52px; color: #fbbf24; line-height: 1;
  text-shadow: 0 0 20px rgba(251,191,36,.5);
}
.mn-wxDesc {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 14px;
  color: #dbeafe; letter-spacing: .12em; text-transform: uppercase;
  margin-top: 2px;
}
.mn-wxHilo { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #93c5fd; margin-top: 4px; }

.mn-breakingWrap { position: absolute; left: 0; right: 0; bottom: 0; height: 150px; z-index: 6; }
.mn-breaking {
  position: absolute; left: 0; right: 0; top: 0; height: 40px;
  background: linear-gradient(90deg, #dc2626, #b91c1c);
  display: flex; align-items: center; overflow: hidden;
  border-top: 2px solid #fef3c7; border-bottom: 3px solid #0f172a;
  box-shadow: 0 -4px 14px rgba(220,38,38,.35);
}
.mn-bStamp {
  flex: 0 0 auto; padding: 0 20px; height: 100%;
  background: #fef3c7; color: #dc2626;
  display: flex; align-items: center;
  font-family: 'Anton', sans-serif; font-size: 22px;
  letter-spacing: .18em;
  animation: mn-breakingFlash 2s ease-in-out infinite;
}
@keyframes mn-breakingFlash { 0%, 100% { opacity: 1; } 50% { opacity: .75; } }
.mn-bScroll { flex: 1; overflow: hidden; }
.mn-bText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 22px;
  color: #fff; white-space: nowrap;
  padding-left: 100%; display: inline-block;
  animation: mn-scroll 40s linear infinite;
}

.mn-mainTicker {
  position: absolute; left: 0; right: 0; top: 40px; bottom: 0;
  background: #0f172a;
  display: flex; align-items: center; overflow: hidden;
  border-top: 3px solid #fbbf24;
}
.mn-mStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #0f172a; display: flex; align-items: center;
  font-family: 'Anton', sans-serif; font-size: 40px; letter-spacing: .1em;
}
.mn-mScroll { flex: 1; overflow: hidden; }
.mn-mText {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 44px;
  color: #fff; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: mn-scroll 54s linear infinite;
}
@keyframes mn-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
