"use client";

// PORTED 2026-04-20 from scratch/design/animated-bus-board.html — transform:scale pattern, isLive-gated hotspots.

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

const CANVAS_W = 1920;
const CANVAS_H = 1080;

export function AnimatedBusBoardWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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
      <style>{CSS_BB}</style>

      <div
        className="bb-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="bb-sun" />
        <div className="bb-cloud bb-c1" />
        <div className="bb-cloud bb-c2" />
        <div className="bb-cloud bb-c3" />

        <div className="bb-header">
          <div className="bb-crest">
            <div className="bb-shield" style={{ whiteSpace: 'pre-wrap' }}>{c.logoEmoji || '🚌'}</div>
          </div>
          <div className="bb-titleBlock">
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'Bus Board'}</h1>
            <div className="bb-titleSub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'Eagle Elementary · after-school routes'}</div>
          </div>
        </div>

        <div className="bb-clock">
          <div className="bb-clockT">{hh}:{mm}</div>
          <div className="bb-clockAp">{ampm}</div>
        </div>

        <div className="bb-road" />
        <div className="bb-bus">
          <div className="bb-stopSign">STOP</div>
          <div className="bb-body" />
          <div className="bb-stripe" />
          <div className="bb-window bb-w1" />
          <div className="bb-window bb-w2" />
          <div className="bb-window bb-w3" />
          <div className="bb-window bb-w4" />
          <div className="bb-window bb-w5" />
          <div className="bb-window bb-w6" />
          <div className="bb-door" />
          <div className="bb-wheel bb-l" />
          <div className="bb-wheel bb-r" />
        </div>

        <div className="bb-grid">
          <div className="bb-routes">
            <h2>Today's Routes</h2>
            <div className="bb-routesSubtitle">Departure times from the front loop</div>
            <div className="bb-routesList">
              {routes.slice(0, 8).map((r, i) => (
                <div key={i} className={`bb-route${r.late ? ' bb-late' : ''}`}>
                  <span className="bb-num">{r.num}</span>
                  <div className="bb-info">
                    <div className="bb-dest">{r.dest || ''}</div>
                    {r.stops && <div className="bb-stops">{r.stops}</div>}
                  </div>
                  <div className="bb-eta">
                    {r.eta}
                    {r.etaUnit && <small>{r.etaUnit}</small>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bb-rightCol">
            <div className="bb-nextBus">
              <div className="bb-nextBusLbl" data-field="nextBusLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.nextBusLabel || 'NEXT BUS').toUpperCase()}</div>
              <div className="bb-nextBusRt" data-field="nextBusRoute" style={{ whiteSpace: 'pre-wrap' }}>{c.nextBusRoute || 'Route 1 · Maplewood'}</div>
              <div className="bb-nextBusEta" style={{ whiteSpace: 'pre-wrap' }}>{c.nextBusEta ?? 20}</div>
              <div className="bb-nextBusEtaUnit" data-field="nextBusEtaUnit" style={{ whiteSpace: 'pre-wrap' }}>{(c.nextBusEtaUnit || 'MINUTES').toUpperCase()}</div>
            </div>
            <div className="bb-weather">
              <span className="bb-weatherEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherEmoji || '☀️'}</span>
              <div className="bb-weatherInfo">
                <div className="bb-weatherTemp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '68°'}</div>
                <div className="bb-weatherDesc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{(c.weatherDesc || 'SUNNY · NO DELAYS').toUpperCase()}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="bb-ticker">
          <div className="bb-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Bus News').toUpperCase()}</div>
          <div className="bb-tickerScroll">
            <span
              className="bb-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 90)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"  x={36}   y={36}  w={700}  h={170} />
            <Hotspot section="clock"   x={1664} y={36}  w={220}  h={130} />
            <Hotspot section="routes"  x={36}   y={410} w={1380} h={530} />
            <Hotspot section="nextBus" x={1444} y={410} w={440}  h={260} />
            <Hotspot section="weather" x={1444} y={690} w={440}  h={250} />
            <Hotspot section="ticker"  x={0}    y={970} w={1920} h={110} />
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

const CSS_BB = `
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Fredoka:wght@500;700&family=Bebas+Neue&display=swap');

.bb-stage {
  position: relative;
  font-family: 'Fredoka', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 20% 10%, #fde68a 0%, transparent 40%),
    linear-gradient(180deg, #bae6fd 0%, #a7f3d0 60%, #86efac 100%);
  overflow: hidden;
}

.bb-sun {
  position: absolute; top: 60px; left: 55%; width: 120px; height: 120px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 60%, #d97706);
  box-shadow: 0 0 60px rgba(251,191,36,.65);
  animation: bb-sunBob 6s ease-in-out infinite;
}
@keyframes bb-sunBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.bb-sun::before {
  content: ''; position: absolute; inset: -30px; border-radius: 50%;
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
  -webkit-mask: radial-gradient(circle, transparent 62px, #000 62px, #000 80px, transparent 80px);
          mask: radial-gradient(circle, transparent 62px, #000 62px, #000 80px, transparent 80px);
  animation: bb-sunSpin 40s linear infinite;
}
@keyframes bb-sunSpin { to { transform: rotate(360deg); } }

.bb-cloud {
  position: absolute; width: 160px; height: 50px;
  background: #fff; border-radius: 30px;
  box-shadow:
    -40px -4px 0 -6px #fff, -80px 0 0 -12px #fff,
     40px -6px 0 -4px #fff,  80px 0 0 -10px #fff;
  animation: bb-cloudDrift linear infinite;
  opacity: .9;
}
.bb-c1 { top: 80px; left: 10%; animation-duration: 90s; }
.bb-c2 { top: 140px; left: -20%; animation-duration: 120s; animation-delay: -30s; transform: scale(.7); }
.bb-c3 { top: 50px; left: -10%; animation-duration: 100s; animation-delay: -60s; transform: scale(1.1); }
@keyframes bb-cloudDrift { from { transform: translateX(0); } to { transform: translateX(2400px); } }

.bb-header {
  position: absolute; top: 36px; left: 36px; right: 280px;
  display: flex; align-items: center; gap: 32px; z-index: 5;
}
.bb-crest {
  width: 140px; height: 140px; position: relative;
  animation: bb-crestBob 3s ease-in-out infinite;
}
@keyframes bb-crestBob { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.bb-shield {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 35% 30%, #fde68a, #f59e0b 60%, #b45309);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 22px rgba(0,0,0,.3);
  font-size: 76px;
}
.bb-titleBlock h1 {
  margin: 0; line-height: .95;
  font-family: 'Bungee', cursive; font-size: 96px;
  background: linear-gradient(90deg, #1d4ed8 0%, #f59e0b 50%, #dc2626 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em;
}
.bb-titleSub {
  font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #1e3a8a;
  letter-spacing: .1em; margin-top: -4px;
}

.bb-clock {
  position: absolute; top: 36px; right: 36px; width: 220px; z-index: 5;
  background: #1e293b;
  border: 5px solid #fbbf24; border-radius: 12px;
  padding: 12px 20px;
  text-align: center;
  box-shadow: 0 8px 20px rgba(0,0,0,.4);
}
.bb-clockT {
  font-family: 'Bungee', cursive; font-size: 64px; line-height: 1;
  color: #fbbf24; text-shadow: 0 0 20px rgba(251,191,36,.8);
}
.bb-clockAp {
  font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #f59e0b;
  letter-spacing: .2em;
}

.bb-road {
  position: absolute; left: 0; right: 0; top: 240px; height: 140px;
  background: #374151;
  border-top: 4px solid #1f2937;
  border-bottom: 4px solid #1f2937;
  box-shadow: 0 -4px 10px rgba(0,0,0,.18), 0 4px 10px rgba(0,0,0,.18);
  z-index: 2; overflow: hidden;
}
.bb-road::before {
  content: ''; position: absolute; top: 50%; left: 0; width: 200%; height: 6px;
  background: repeating-linear-gradient(90deg, #fde68a 0 60px, transparent 60px 120px);
  transform: translateY(-50%);
  animation: bb-roadMove 1.2s linear infinite;
}
@keyframes bb-roadMove { from { transform: translate(0, -50%); } to { transform: translate(-120px, -50%); } }

.bb-bus {
  position: absolute; top: 248px; height: 130px; width: 360px;
  animation: bb-busDrive 22s linear infinite;
  z-index: 4;
}
@keyframes bb-busDrive {
  0%   { left: -380px; }
  50%  { left: 50%; transform: translateX(-50%); }
  100% { left: 100%; }
}
.bb-bus .bb-body {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 70%, #d97706 100%);
  border: 5px solid #1f2937;
  border-radius: 20px 20px 4px 4px;
  box-shadow: 0 8px 14px rgba(0,0,0,.35);
}
.bb-bus .bb-stripe {
  position: absolute; top: 64px; left: 6px; right: 6px; height: 12px;
  background: #1f2937;
}
.bb-bus .bb-window {
  position: absolute; top: 14px; background: linear-gradient(135deg, #bfdbfe, #60a5fa);
  border: 3px solid #1f2937;
  width: 44px; height: 40px;
  border-radius: 4px;
}
.bb-bus .bb-w1 { left: 24px; }
.bb-bus .bb-w2 { left: 82px; }
.bb-bus .bb-w3 { left: 140px; }
.bb-bus .bb-w4 { left: 198px; }
.bb-bus .bb-w5 { left: 256px; }
.bb-bus .bb-w6 { left: 314px; }
.bb-bus .bb-door {
  position: absolute; bottom: 30px; left: 14px; width: 30px; height: 50px;
  background: #1e3a8a; border: 3px solid #1f2937;
  border-radius: 4px;
}
.bb-bus .bb-stopSign {
  position: absolute; top: 38px; left: -14px;
  width: 40px; height: 40px;
  background: #dc2626;
  clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-family: 'Bungee', cursive; font-size: 11px;
  border: 3px solid #fff;
  animation: bb-stopSign 1s ease-in-out infinite;
}
@keyframes bb-stopSign { 0%, 50%, 100% { opacity: 1; } 25%, 75% { opacity: .3; } }
.bb-bus .bb-wheel {
  position: absolute; bottom: -24px; width: 44px; height: 44px;
  background: radial-gradient(circle at 40% 40%, #94a3b8, #1f2937 70%);
  border: 5px solid #111827; border-radius: 50%;
  animation: bb-wheelSpin .4s linear infinite;
}
.bb-bus .bb-wheel.bb-l { left: 40px; }
.bb-bus .bb-wheel.bb-r { right: 40px; }
@keyframes bb-wheelSpin { to { transform: rotate(360deg); } }

.bb-grid {
  position: absolute; top: 410px; left: 36px; right: 36px; bottom: 140px;
  display: grid; grid-template-columns: 1fr 400px;
  gap: 30px; z-index: 3;
}

.bb-routes {
  position: relative;
  background: #fff; border: 6px solid #1f2937;
  border-radius: 22px; padding: 24px 32px;
  box-shadow: 0 14px 28px rgba(0,0,0,.22), 10px 10px 0 #fbbf24, 14px 14px 0 #1f2937;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.bb-routes h2 {
  margin: 0; font-family: 'Bungee', cursive; font-size: 40px;
  color: #1e3a8a; text-align: center; letter-spacing: .02em;
}
.bb-routesSubtitle { text-align: center; font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #64748b; letter-spacing: .15em; margin-bottom: 14px; }
.bb-routesList {
  flex: 1; display: flex; flex-direction: column; gap: clamp(4px, 1.5%, 10px);
  min-height: 0; overflow: hidden;
}
.bb-route {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: clamp(14px, 3cqh + 10px, 24px);
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 3px solid #1f2937;
  border-radius: 14px;
  padding: clamp(8px, 10cqh, 16px) clamp(18px, 4cqh + 14px, 26px);
  box-shadow: 4px 4px 0 #1e3a8a;
  overflow: hidden;
}
.bb-route .bb-num {
  font-family: 'Bungee', cursive; font-size: clamp(28px, 58cqh, 64px);
  color: #fff;
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  border: 3px solid #1f2937;
  border-radius: 12px;
  padding: clamp(2px, 6cqh, 12px) clamp(10px, 4cqh + 6px, 18px);
  min-width: 74px; text-align: center; flex: 0 0 auto;
  line-height: 1;
  text-shadow: 2px 2px 0 rgba(0,0,0,.2);
}
.bb-route .bb-info { flex: 1; min-width: 0; }
.bb-route .bb-dest {
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  font-size: clamp(20px, 36cqh, 38px);
  color: #1f2937; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bb-route .bb-stops {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(14px, 22cqh, 24px);
  color: #475569; letter-spacing: .05em;
  margin-top: clamp(1px, 2cqh, 4px);
}
.bb-route .bb-eta {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(20px, 40cqh, 42px);
  color: #1e3a8a; flex: 0 0 auto; text-align: right;
  line-height: 1;
  letter-spacing: .02em;
}
.bb-route .bb-eta small {
  display: block; font-family: 'Fredoka', sans-serif; font-weight: 500;
  font-size: clamp(11px, 16cqh, 18px);
  color: #64748b; letter-spacing: .1em; text-transform: uppercase;
  margin-top: 2px;
}
.bb-route.bb-late .bb-eta { color: #dc2626; }
.bb-route.bb-late .bb-eta::before { content: '⚠ '; }

.bb-rightCol { display: flex; flex-direction: column; gap: 20px; }

.bb-nextBus {
  position: relative;
  background: linear-gradient(135deg, #1e3a8a, #1d4ed8);
  border: 5px solid #fbbf24; border-radius: 18px;
  padding: 24px 20px; text-align: center;
  box-shadow: 0 12px 24px rgba(0,0,0,.3);
  color: #fff;
  animation: bb-nextBus 3s ease-in-out infinite;
}
@keyframes bb-nextBus { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
.bb-nextBus::before {
  content: '🚌'; position: absolute; top: -26px; left: 50%;
  transform: translateX(-50%); font-size: 48px;
  animation: bb-nextBusIcon 1.2s ease-in-out infinite;
}
@keyframes bb-nextBusIcon { 0%, 100% { transform: translateX(-50%) rotate(-6deg); } 50% { transform: translateX(-50%) rotate(6deg); } }
.bb-nextBusLbl { font-family: 'Bungee', cursive; font-size: 18px; color: #fbbf24; letter-spacing: .12em; margin-top: 14px; }
.bb-nextBusRt { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 30px; margin-top: 4px; }
.bb-nextBusEta { font-family: 'Bebas Neue', sans-serif; font-size: 76px; color: #fbbf24; line-height: .9; margin: 4px 0; text-shadow: 0 0 20px rgba(251,191,36,.8); }
.bb-nextBusEtaUnit { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: .2em; color: #dbeafe; }

.bb-weather {
  background: linear-gradient(135deg, #fef3c7, #fbbf24);
  border: 5px solid #1f2937; border-radius: 18px;
  padding: 16px 20px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: 0 10px 20px rgba(0,0,0,.25);
}
.bb-weatherEmoji { font-size: 64px; line-height: 1; filter: drop-shadow(0 3px 4px rgba(0,0,0,.2)); }
.bb-weatherInfo { flex: 1; }
.bb-weatherTemp { font-family: 'Bungee', cursive; font-size: 44px; color: #1e3a8a; line-height: 1; }
.bb-weatherDesc { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 16px; color: #7c2d12; letter-spacing: .08em; margin-top: 2px; }

.bb-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(135deg, #1e3a8a, #1d4ed8);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 5px solid #fbbf24;
  box-shadow: 0 -6px 18px rgba(0,0,0,.25);
}
.bb-tickerStamp {
  flex: 0 0 auto; padding: 0 32px; height: 100%;
  background: linear-gradient(135deg, #fbbf24, #d97706); color: #1e3a8a;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; letter-spacing: .12em; font-size: 32px;
  border-right: 4px solid #1e3a8a;
}
.bb-tickerScroll { flex: 1; overflow: hidden; }
.bb-tickerText {
  font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #fff;
  white-space: nowrap; padding-left: 100%; display: inline-block;
  letter-spacing: .04em;
  animation: bb-tickerScroll 90s linear infinite;
}
@keyframes bb-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(29, 78, 216, .1); box-shadow: inset 0 0 0 3px rgba(29, 78, 216, .6); }
.aw-hotspot:focus-visible { background-color: rgba(29, 78, 216, .18); box-shadow: inset 0 0 0 3px rgba(29, 78, 216, .9); }
`;
