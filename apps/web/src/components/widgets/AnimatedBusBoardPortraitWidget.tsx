"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// AnimatedBusBoardPortraitWidget — REAL portrait companion for the
// landscape AnimatedBusBoardWidget. Vertical re-flow at 2160x3840.
//
// Layout regions stack purposefully:
//   • Top band ~600px — title block + crest + clock pill, full width,
//     with sun + drifting clouds overhead
//   • Driving-bus band ~360px — animated road + bus driving across
//     the full 2160px width (bigger bus, more presence)
//   • Routes band ~2000px — 6-8 route rows, each ~250px tall, with
//     route number, destination, ETA, late warning, and a small
//     animated bus icon driving along the row's road line
//   • Next-bus countdown ~480px — full-width hero card, big numerals
//   • Bottom branding strip ~200px — weather pill + spirit message
//   • Ticker pinned to bottom ~120px — late-bus warnings scroll
//
// Same Cfg shape + same data-field hotspots as the landscape variant
// so the THEMED_WIDGET_FIELDS registry editor "just works." Every CSS
// keyframe re-prefixed `bbp-*` to avoid collision with landscape `bb-*`.

import { useEffect, useRef, useState, useMemo } from 'react';

type Route = {
  num?: string | number;
  dest?: string;
  stops?: string;
  eta?: string;
  etaUnit?: string;
  late?: boolean;
};

interface Cfg {
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;

  routes?: Route[];

  nextBusLabel?: string;
  nextBusRoute?: string;
  nextBusEta?: string | number;
  nextBusEtaUnit?: string;

  weatherEmoji?: string;
  weatherTemp?: string;
  weatherDesc?: string;

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

export function AnimatedBusBoardPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
  const hh = parts.find(p => p.type === 'hour')?.value || '2';
  const mm = parts.find(p => p.type === 'minute')?.value || '45';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'PM';

  const routes: Route[] = useMemo(() => {
    if (Array.isArray(c.routes) && c.routes.length > 0) return c.routes;
    return [
      { num: 1, dest: 'Maplewood · Oakdale · Birch Ln', stops: '12 stops · last at Riverbend · arrives 3:42', eta: '3:05', etaUnit: 'PM' },
      { num: 2, dest: 'Forest Hills · Willow Pk',       stops: '9 stops · last at Cedar Crest · arrives 3:38', eta: '3:12', etaUnit: '8 MIN LATE', late: true },
      { num: 3, dest: 'Sunnyside · Pine Grove',          stops: '11 stops · last at Magnolia · arrives 3:48', eta: '3:15', etaUnit: 'PM' },
      { num: 4, dest: 'Lakeview · Harbor · East End',    stops: '14 stops · last at Sea Breeze · arrives 4:02', eta: '3:20', etaUnit: 'PM' },
      { num: 5, dest: 'Downtown Shuttle',                stops: '6 stops · last at Main St · arrives 3:30', eta: '3:25', etaUnit: 'PM' },
      { num: 6, dest: 'Northridge · Hillcrest',          stops: '10 stops · last at Summit · arrives 3:50', eta: '3:30', etaUnit: 'PM' },
      { num: 7, dest: 'Riverside · South Bend',          stops: '8 stops · last at Brookline · arrives 3:55', eta: '3:35', etaUnit: 'PM' },
    ];
  }, [c.routes]);

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ★  ');
    return 'Route 2 is running 8 min late due to construction on Forest Hills Dr  ★  Parent pickup at Door 3 · buses at Door 1  ★  Please board your assigned route only  ★  Early dismissal Friday — buses leave at 1:15';
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#bae6fd',
      }}
    >
      <style>{CSS_BBP}</style>

      <div
        className="bbp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Sun + drifting clouds — repositioned for the tall canvas */}
        <div className="bbp-sun" />
        <div className="bbp-cloud bbp-c1" />
        <div className="bbp-cloud bbp-c2" />
        <div className="bbp-cloud bbp-c3" />

        {/* Top band — title + crest, full-width, generous breathing room */}
        <div className="bbp-header">
          <div className="bbp-crest">
            <div className="bbp-shield" style={{ whiteSpace: 'pre-wrap' }}>{c.logoEmoji || '🚌'}</div>
          </div>
          <div className="bbp-titleBlock">
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'Bus Board'}</h1>
            <div className="bbp-titleSub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'Eagle Elementary · after-school routes'}</div>
          </div>
        </div>

        {/* Clock pill — pinned top-right under the header */}
        <div className="bbp-clock">
          <div className="bbp-clockT">{hh}:{mm}</div>
          <div className="bbp-clockAp">{ampm}</div>
        </div>

        {/* Driving-bus band — animated road + bus across full width */}
        <div className="bbp-road" />
        <div className="bbp-bus">
          <div className="bbp-stopSign">STOP</div>
          <div className="bbp-body" />
          <div className="bbp-stripe" />
          <div className="bbp-window bbp-w1" />
          <div className="bbp-window bbp-w2" />
          <div className="bbp-window bbp-w3" />
          <div className="bbp-window bbp-w4" />
          <div className="bbp-window bbp-w5" />
          <div className="bbp-window bbp-w6" />
          <div className="bbp-door" />
          <div className="bbp-wheel bbp-l" />
          <div className="bbp-wheel bbp-r" />
        </div>

        {/* Routes band — 7 rows, each 250px tall */}
        <div className="bbp-routes">
          <h2>Today's Routes</h2>
          <div className="bbp-routesSubtitle">Departure times from the front loop</div>
          <div className="bbp-routesList">
            {routes.slice(0, 7).map((r, i) => (
              <div key={i} className={`bbp-route${r.late ? ' bbp-late' : ''}`}>
                <span className="bbp-num">{r.num}</span>
                <div className="bbp-info">
                  <div className="bbp-dest">{r.dest || ''}</div>
                  {r.stops && <div className="bbp-stops">{r.stops}</div>}
                </div>
                <div className="bbp-eta">
                  {r.eta}
                  {r.etaUnit && <small>{r.etaUnit}</small>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Next-bus countdown — full-width hero */}
        <div className="bbp-nextBus">
          <div className="bbp-nextBusLbl" data-field="nextBusLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.nextBusLabel || 'NEXT BUS').toUpperCase()}</div>
          <div className="bbp-nextBusRt" data-field="nextBusRoute" style={{ whiteSpace: 'pre-wrap' }}>{c.nextBusRoute || 'Route 1 · Maplewood'}</div>
          <div className="bbp-nextBusRow">
            <div className="bbp-nextBusEta" style={{ whiteSpace: 'pre-wrap' }}>{c.nextBusEta ?? 20}</div>
            <div className="bbp-nextBusEtaUnit" data-field="nextBusEtaUnit" style={{ whiteSpace: 'pre-wrap' }}>{(c.nextBusEtaUnit || 'MINUTES').toUpperCase()}</div>
          </div>
        </div>

        {/* Weather pill — full-width branding strip above the ticker */}
        <div className="bbp-weather">
          <span className="bbp-weatherEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherEmoji || '☀️'}</span>
          <div className="bbp-weatherInfo">
            <div className="bbp-weatherTemp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '68°'}</div>
            <div className="bbp-weatherDesc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{(c.weatherDesc || 'SUNNY · NO DELAYS').toUpperCase()}</div>
          </div>
        </div>

        {/* Ticker — pinned bottom */}
        <div className="bbp-ticker">
          <div className="bbp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Bus News').toUpperCase()}</div>
          <div className="bbp-tickerScroll">
            <span
              className="bbp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 120)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — operator clicks land in the right region */}
        {!isLive && (
          <>
            <Hotspot section="header"   x={60}   y={80}   w={1500} h={460} />
            <Hotspot section="clock"    x={1660} y={120}  w={440}  h={300} />
            <Hotspot section="routes"   x={60}   y={1020} w={2040} h={2000} />
            <Hotspot section="nextBus"  x={60}   y={3050} w={2040} h={460} />
            <Hotspot section="weather"  x={60}   y={3530} w={2040} h={180} />
            <Hotspot section="ticker"   x={0}    y={3720} w={2160} h={120} />
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

const CSS_BBP = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Fredoka:wght@500;700&family=Bebas+Neue&display=swap');

.bbp-stage {
  position: relative;
  font-family: 'Fredoka', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 20% 8%, #fde68a 0%, transparent 38%),
    linear-gradient(180deg, #bae6fd 0%, #a7f3d0 55%, #86efac 100%);
  overflow: hidden;
}

/* Sun */
.bbp-sun {
  position: absolute; top: 130px; left: 60%; width: 220px; height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 60%, #d97706);
  box-shadow: 0 0 110px rgba(251,191,36,.65);
  animation: bbp-sunBob 6s ease-in-out infinite;
  z-index: 1;
}
@keyframes bbp-sunBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-18px); } }
.bbp-sun::before {
  content: ''; position: absolute; inset: -54px; border-radius: 50%;
  background: conic-gradient(from 0deg,
    transparent 0 18deg, #fbbf24 18deg 22deg,
    transparent 22deg 40deg, #fbbf24 40deg 44deg,
    transparent 44deg 62deg, #fbbf24 62deg 66deg,
    transparent 66deg 84deg, #fbbf24 84deg 88deg,
    transparent 88deg 106deg, #fbbf24 106deg 110deg,
    transparent 110deg 128deg, #fbbf24 128deg 132deg,
    transparent 132deg 150deg, #fbbf24 150deg 154deg,
    transparent 154deg 172deg, #fbbf24 172deg 176deg,
    transparent 176deg 194deg, #fbbf24 194deg 198deg,
    transparent 198deg 216deg, #fbbf24 216deg 220deg,
    transparent 220deg 238deg, #fbbf24 238deg 242deg,
    transparent 242deg 260deg, #fbbf24 260deg 264deg,
    transparent 264deg 282deg, #fbbf24 282deg 286deg,
    transparent 286deg 304deg, #fbbf24 304deg 308deg,
    transparent 308deg 326deg, #fbbf24 326deg 330deg,
    transparent 330deg 348deg, #fbbf24 348deg 352deg, transparent 352deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 114px, #000 114px, #000 146px, transparent 146px);
          mask: radial-gradient(circle, transparent 114px, #000 114px, #000 146px, transparent 146px);
  animation: bbp-sunSpin 40s linear infinite;
}
@keyframes bbp-sunSpin { to { transform: rotate(360deg); } }

/* Drifting clouds */
.bbp-cloud {
  position: absolute; width: 280px; height: 88px;
  background: #fff; border-radius: 56px;
  box-shadow:
    -72px -8px 0 -10px #fff, -144px 0 0 -22px #fff,
     72px -10px 0 -8px #fff,  144px 0 0 -18px #fff;
  animation: bbp-cloudDrift linear infinite;
  opacity: .92;
  z-index: 1;
}
.bbp-c1 { top: 160px; left: 8%;  animation-duration: 110s; }
.bbp-c2 { top: 280px; left: -22%; animation-duration: 140s; animation-delay: -40s; transform: scale(.75); }
.bbp-c3 { top: 100px; left: -12%; animation-duration: 120s; animation-delay: -70s; transform: scale(1.15); }
@keyframes bbp-cloudDrift { from { transform: translateX(0); } to { transform: translateX(2700px); } }

/* Header — full-width, big shield + huge title */
.bbp-header {
  position: absolute; top: 100px; left: 80px; right: 520px;
  display: flex; align-items: center; gap: 56px; z-index: 5;
}
.bbp-crest {
  width: 260px; height: 260px; position: relative; flex: 0 0 auto;
  animation: bbp-crestBob 3s ease-in-out infinite;
}
@keyframes bbp-crestBob { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.bbp-shield {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 35% 30%, #fde68a, #f59e0b 60%, #b45309);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 18px 38px rgba(0,0,0,.32);
  font-size: 144px;
}
.bbp-titleBlock { flex: 1; min-width: 0; }
.bbp-titleBlock h1 {
  margin: 0; line-height: .95;
  font-family: 'Bungee', cursive; font-size: 200px;
  background: linear-gradient(90deg, #1d4ed8 0%, #f59e0b 50%, #dc2626 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em;
}
.bbp-titleSub {
  font-family: 'Bebas Neue', sans-serif; font-size: 64px; color: #1e3a8a;
  letter-spacing: .1em; margin-top: 4px;
}

/* Clock pill */
.bbp-clock {
  position: absolute; top: 120px; right: 80px; width: 420px; z-index: 5;
  background: #1e293b;
  border: 8px solid #fbbf24; border-radius: 22px;
  padding: 28px 32px;
  text-align: center;
  box-shadow: 0 16px 36px rgba(0,0,0,.4);
}
.bbp-clockT {
  font-family: 'Bungee', cursive; font-size: 132px; line-height: 1;
  color: #fbbf24; text-shadow: 0 0 36px rgba(251,191,36,.8);
}
.bbp-clockAp {
  font-family: 'Bebas Neue', sans-serif; font-size: 44px; color: #f59e0b;
  letter-spacing: .2em;
}

/* Driving-bus band */
.bbp-road {
  position: absolute; left: 0; right: 0; top: 600px; height: 260px;
  background: #374151;
  border-top: 6px solid #1f2937;
  border-bottom: 6px solid #1f2937;
  box-shadow: 0 -6px 14px rgba(0,0,0,.18), 0 6px 14px rgba(0,0,0,.18);
  z-index: 2; overflow: hidden;
}
.bbp-road::before {
  content: ''; position: absolute; top: 50%; left: 0; width: 200%; height: 10px;
  background: repeating-linear-gradient(90deg, #fde68a 0 110px, transparent 110px 220px);
  transform: translateY(-50%);
  animation: bbp-roadMove 1.4s linear infinite;
}
@keyframes bbp-roadMove { from { transform: translate(0, -50%); } to { transform: translate(-220px, -50%); } }

.bbp-bus {
  position: absolute; top: 612px; height: 240px; width: 660px;
  animation: bbp-busDrive 24s linear infinite;
  z-index: 4;
}
@keyframes bbp-busDrive {
  0%   { left: -700px; }
  50%  { left: 50%; transform: translateX(-50%); }
  100% { left: 100%; }
}
.bbp-bus .bbp-body {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 70%, #d97706 100%);
  border: 8px solid #1f2937;
  border-radius: 36px 36px 6px 6px;
  box-shadow: 0 14px 26px rgba(0,0,0,.35);
}
.bbp-bus .bbp-stripe {
  position: absolute; top: 118px; left: 10px; right: 10px; height: 22px;
  background: #1f2937;
}
.bbp-bus .bbp-window {
  position: absolute; top: 26px; background: linear-gradient(135deg, #bfdbfe, #60a5fa);
  border: 5px solid #1f2937;
  width: 80px; height: 74px;
  border-radius: 6px;
}
.bbp-bus .bbp-w1 { left: 44px; }
.bbp-bus .bbp-w2 { left: 150px; }
.bbp-bus .bbp-w3 { left: 256px; }
.bbp-bus .bbp-w4 { left: 362px; }
.bbp-bus .bbp-w5 { left: 468px; }
.bbp-bus .bbp-w6 { left: 574px; }
.bbp-bus .bbp-door {
  position: absolute; bottom: 56px; left: 26px; width: 56px; height: 92px;
  background: #1e3a8a; border: 5px solid #1f2937;
  border-radius: 6px;
}
.bbp-bus .bbp-stopSign {
  position: absolute; top: 70px; left: -26px;
  width: 74px; height: 74px;
  background: #dc2626;
  clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-family: 'Bungee', cursive; font-size: 22px;
  border: 5px solid #fff;
  animation: bbp-stopSign 1s ease-in-out infinite;
}
@keyframes bbp-stopSign { 0%, 50%, 100% { opacity: 1; } 25%, 75% { opacity: .3; } }
.bbp-bus .bbp-wheel {
  position: absolute; bottom: -42px; width: 80px; height: 80px;
  background: radial-gradient(circle at 40% 40%, #94a3b8, #1f2937 70%);
  border: 8px solid #111827; border-radius: 50%;
  animation: bbp-wheelSpin .4s linear infinite;
}
.bbp-bus .bbp-wheel.bbp-l { left: 76px; }
.bbp-bus .bbp-wheel.bbp-r { right: 76px; }
@keyframes bbp-wheelSpin { to { transform: rotate(360deg); } }

/* Routes panel — fills the upper-mid portion */
.bbp-routes {
  position: absolute; top: 1020px; left: 60px; right: 60px; height: 2000px;
  background: #fff; border: 10px solid #1f2937;
  border-radius: 36px; padding: 40px 56px;
  box-shadow: 0 20px 40px rgba(0,0,0,.22), 16px 16px 0 #fbbf24, 24px 24px 0 #1f2937;
  overflow: hidden;
  display: flex; flex-direction: column;
  z-index: 3;
}
.bbp-routes h2 {
  margin: 0; font-family: 'Bungee', cursive; font-size: 96px;
  color: #1e3a8a; text-align: center; letter-spacing: .02em; line-height: 1;
}
.bbp-routesSubtitle {
  text-align: center; font-family: 'Bebas Neue', sans-serif;
  font-size: 44px; color: #64748b; letter-spacing: .15em;
  margin-top: 8px; margin-bottom: 24px;
}
.bbp-routesList {
  flex: 1; display: flex; flex-direction: column; gap: 18px;
  min-height: 0; overflow: hidden;
}
.bbp-route {
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: 36px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 5px solid #1f2937;
  border-radius: 22px;
  padding: 18px 36px;
  box-shadow: 6px 6px 0 #1e3a8a;
  overflow: hidden;
}
.bbp-route .bbp-num {
  font-family: 'Bungee', cursive; font-size: 110px;
  color: #fff;
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  border: 5px solid #1f2937;
  border-radius: 20px;
  padding: 10px 24px;
  min-width: 140px; text-align: center; flex: 0 0 auto;
  line-height: 1;
  text-shadow: 3px 3px 0 rgba(0,0,0,.2);
}
.bbp-route .bbp-info { flex: 1; min-width: 0; }
.bbp-route .bbp-dest {
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  font-size: 64px;
  color: #1f2937; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bbp-route .bbp-stops {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 38px;
  color: #475569; letter-spacing: .05em;
  margin-top: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bbp-route .bbp-eta {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 76px;
  color: #1e3a8a; flex: 0 0 auto; text-align: right;
  line-height: 1;
  letter-spacing: .02em;
}
.bbp-route .bbp-eta small {
  display: block; font-family: 'Fredoka', sans-serif; font-weight: 500;
  font-size: 28px;
  color: #64748b; letter-spacing: .1em; text-transform: uppercase;
  margin-top: 4px;
}
.bbp-route.bbp-late .bbp-eta { color: #dc2626; }
.bbp-route.bbp-late .bbp-eta::before { content: '⚠ '; }

/* Next-bus countdown — full-width hero */
.bbp-nextBus {
  position: absolute; top: 3050px; left: 60px; right: 60px; height: 460px;
  background: linear-gradient(135deg, #1e3a8a, #1d4ed8);
  border: 10px solid #fbbf24; border-radius: 32px;
  padding: 36px 40px 24px;
  text-align: center;
  box-shadow: 0 20px 40px rgba(0,0,0,.3);
  color: #fff;
  animation: bbp-nextBus 3s ease-in-out infinite;
  z-index: 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
@keyframes bbp-nextBus { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.01); } }
.bbp-nextBus::before {
  content: '🚌'; position: absolute; top: -56px; left: 50%;
  transform: translateX(-50%); font-size: 100px;
  animation: bbp-nextBusIcon 1.2s ease-in-out infinite;
}
@keyframes bbp-nextBusIcon { 0%, 100% { transform: translateX(-50%) rotate(-6deg); } 50% { transform: translateX(-50%) rotate(6deg); } }
.bbp-nextBusLbl {
  font-family: 'Bungee', cursive; font-size: 44px; color: #fbbf24;
  letter-spacing: .14em; margin-top: 24px;
}
.bbp-nextBusRt {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 60px;
  margin-top: 6px;
}
.bbp-nextBusRow {
  display: flex; align-items: baseline; gap: 32px; justify-content: center;
  margin-top: 8px;
}
.bbp-nextBusEta {
  font-family: 'Bebas Neue', sans-serif; font-size: 200px; color: #fbbf24;
  line-height: .9;
  text-shadow: 0 0 40px rgba(251,191,36,.8);
}
.bbp-nextBusEtaUnit {
  font-family: 'Bebas Neue', sans-serif; font-size: 60px;
  letter-spacing: .2em; color: #dbeafe;
}

/* Weather strip — full-width branding above ticker */
.bbp-weather {
  position: absolute; top: 3540px; left: 60px; right: 60px; height: 160px;
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 8px solid #1f2937; border-radius: 28px;
  padding: 18px 40px;
  display: flex; align-items: center; gap: 32px;
  box-shadow: 0 14px 28px rgba(0,0,0,.25);
  z-index: 3;
}
.bbp-weatherEmoji {
  font-size: 110px; line-height: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.2));
}
.bbp-weatherInfo { flex: 1; display: flex; align-items: baseline; gap: 32px; }
.bbp-weatherTemp {
  font-family: 'Bungee', cursive; font-size: 88px; color: #1e3a8a; line-height: 1;
}
.bbp-weatherDesc {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 36px;
  color: #7c2d12; letter-spacing: .08em;
}

/* Ticker — pinned bottom */
.bbp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 120px;
  background: linear-gradient(135deg, #1e3a8a, #1d4ed8);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 8px solid #fbbf24;
  box-shadow: 0 -10px 22px rgba(0,0,0,.25);
}
.bbp-tickerStamp {
  flex: 0 0 auto; padding: 0 56px; height: 100%;
  background: linear-gradient(135deg, #fbbf24, #d97706); color: #1e3a8a;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 56px;
  border-right: 6px solid #1e3a8a;
}
.bbp-tickerScroll { flex: 1; overflow: hidden; }
.bbp-tickerText {
  font-family: 'Bebas Neue', sans-serif; font-size: 76px; color: #fff;
  white-space: nowrap; padding-left: 100%; display: inline-block;
  letter-spacing: .04em;
  animation: bbp-tickerScroll 120s linear infinite;
}
@keyframes bbp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(29, 78, 216, .1); box-shadow: inset 0 0 0 4px rgba(29, 78, 216, .6); }
.aw-hotspot:focus-visible { background-color: rgba(29, 78, 216, .18); box-shadow: inset 0 0 0 4px rgba(29, 78, 216, .9); }
`;
