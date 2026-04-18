"use client";

/**
 * Art Studio — middle school art-room lobby theme.
 * Artist's loft / studio vibe: paint splatters, brush strokes,
 * watercolor washes, palette + brushes, canvas easels, framed art.
 *
 *  LOGO             → painter's palette with thumb hole + paint blobs + crossed brushes
 *  TEXT             → hand-painted banner with brush-stroke underline
 *  CLOCK            → wall clock with paint-drip rim + live analog hands
 *  WEATHER          → watercolor-wash card with condition-aware painterly icons
 *  COUNTDOWN        → spray-paint tag on brick with stencil "DAYS!" text
 *  ANNOUNCEMENT     → sketchbook page with pencil doodle border + handwritten message
 *  CALENDAR         → 3 postcard-style event cards with paint-splash accent
 *  STAFF_SPOTLIGHT  → self-portrait on art easel with painted frame
 *  IMAGE_CAROUSEL   → blank canvas on wooden easel frame
 *  TICKER           → rolled kraft-paper scroll with handwriting
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Palette ────────────────────────────────────────────────────────────────
export const AS = {
  canvas:      '#FBF7F0',
  kraft:       '#C9A16F',
  paintRed:    '#D84040',
  paintYellow: '#F5C542',
  paintBlue:   '#3570D6',
  paintGreen:  '#3AA856',
  paintPurple: '#9457C0',
  charcoal:    '#2A2624',
  pencil:      '#5C5450',
  ink:         '#1F1B19',
  shadow:      'rgba(42,38,36,0.35)',
};

export const AS_FONT_DISPLAY = "'Caveat', 'Permanent Marker', cursive";
export const AS_FONT_SERIF   = "'Fraunces', Georgia, serif";
export const AS_FONT_BODY    = "'Fredoka', system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════════════════════
// LOGO — painter's palette with thumb hole + colorful blobs + crossed brushes
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioLogo({ config }: { config: any; compact?: boolean }) {
  const photoUrl: string | undefined = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 280 280" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 6px 14px ${AS.shadow})`, overflow: 'visible' }}>
        {/* Palette body — kidney-bean shape */}
        <path
          d="M140,240 C60,240 20,190 20,140 C20,80 70,30 135,30 C175,30 210,50 230,80 C250,110 240,145 220,160 C200,175 205,200 185,215 C165,230 165,240 140,240 Z"
          fill={AS.kraft} stroke={AS.charcoal} strokeWidth="5"
        />
        {/* Inner palette — lighter fill */}
        <path
          d="M140,228 C68,228 34,185 34,140 C34,86 78,44 135,44 C170,44 200,62 218,88 C236,114 226,145 208,158 C190,171 196,196 176,210 C158,222 160,228 140,228 Z"
          fill="#D4AA78"
        />
        {/* Thumb hole */}
        <ellipse cx="88" cy="195" rx="22" ry="16" fill={AS.canvas} stroke={AS.charcoal} strokeWidth="4" />
        {/* Paint blobs */}
        <circle cx="115" cy="65"  r="18" fill={AS.paintRed}    stroke={AS.charcoal} strokeWidth="3" />
        <circle cx="160" cy="58"  r="16" fill={AS.paintYellow} stroke={AS.charcoal} strokeWidth="3" />
        <circle cx="200" cy="80"  r="16" fill={AS.paintBlue}   stroke={AS.charcoal} strokeWidth="3" />
        <circle cx="218" cy="120" r="15" fill={AS.paintGreen}  stroke={AS.charcoal} strokeWidth="3" />
        <circle cx="80"  cy="90"  r="14" fill={AS.paintPurple} stroke={AS.charcoal} strokeWidth="3" />
        {/* Optional logo photo clipped into palette center */}
        {photoUrl && (
          <>
            <defs>
              <clipPath id="as-logo-clip">
                <circle cx="148" cy="148" r="48" />
              </clipPath>
            </defs>
            <image href={resolveUrl(photoUrl)} x="100" y="100" width="96" height="96"
              preserveAspectRatio="xMidYMid slice" clipPath="url(#as-logo-clip)" />
            <circle cx="148" cy="148" r="48" fill="none" stroke={AS.charcoal} strokeWidth="4" />
          </>
        )}
        {/* Crossed brushes below palette */}
        <g transform="translate(140 255)">
          {/* Brush 1 — angled left */}
          <g transform="rotate(-30)">
            <rect x="-4" y="-70" width="8" height="55" rx="3" fill="#A0805A" stroke={AS.charcoal} strokeWidth="2" />
            <rect x="-5" y="-88" width="10" height="20" rx="2" fill="#C0C0C0" stroke={AS.charcoal} strokeWidth="1.5" />
            <path d="M-4,-88 L4,-88 L3,-112 L-3,-112 Z" fill={AS.paintRed} stroke={AS.charcoal} strokeWidth="1.5" />
          </g>
          {/* Brush 2 — angled right */}
          <g transform="rotate(30)">
            <rect x="-4" y="-70" width="8" height="55" rx="3" fill="#8A6A44" stroke={AS.charcoal} strokeWidth="2" />
            <rect x="-5" y="-88" width="10" height="20" rx="2" fill="#C0C0C0" stroke={AS.charcoal} strokeWidth="1.5" />
            <path d="M-4,-88 L4,-88 L3,-112 L-3,-112 Z" fill={AS.paintBlue} stroke={AS.charcoal} strokeWidth="1.5" />
          </g>
        </g>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT — hand-painted banner with messy brush-stroke underline
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'ART IS EVERYWHERE';
  const subtitle = config.subtitle || 'express · create · inspire';

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '5% 6%' }}>
      {/* Title in handwriting font */}
      <div style={{ flex: !compact && subtitle ? '0 0 58%' : '0 0 100%', width: '100%', minHeight: 0, position: 'relative' }}>
        <EditableText
          configKey="content" onConfigChange={onConfigChange}
          max={200} min={14} wrap={false}
          style={{
            fontFamily: AS_FONT_DISPLAY,
            fontWeight: 700,
            color: AS.ink,
            letterSpacing: '0.01em',
            textShadow: `2px 3px 0 ${AS.shadow}`,
          }}
        >
          {content}
        </EditableText>
      </div>
      {/* Brush-stroke underline SVG — messy, slightly wavy */}
      <svg viewBox="0 0 400 28" width="88%" height="10%" preserveAspectRatio="none" style={{ flexShrink: 0 }}>
        <path
          d="M8,20 C60,8 130,24 200,16 C270,8 340,22 392,14"
          stroke={AS.paintRed} strokeWidth="10" fill="none"
          strokeLinecap="round" strokeLinejoin="round" opacity="0.85"
        />
        <path
          d="M20,14 C80,24 150,10 220,18 C290,26 360,12 395,20"
          stroke={AS.paintYellow} strokeWidth="5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" opacity="0.55"
        />
      </svg>
      {/* Subtitle — italic serif */}
      {!compact && subtitle && (
        <div style={{ flex: '0 0 32%', width: '100%', minHeight: 0, marginTop: '2%' }}>
          <EditableText
            configKey="subtitle" onConfigChange={onConfigChange}
            max={120} min={10} wrap={false}
            style={{
              fontFamily: AS_FONT_SERIF,
              fontStyle: 'italic',
              color: AS.pencil,
              letterSpacing: '0.04em',
            }}
          >
            {subtitle}
          </EditableText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOCK — round wall clock with paint-drip rim + live analog hands
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined;
  const local = tz
    ? new Date(now.toLocaleString('en-US', { timeZone: tz }))
    : now;

  const sec  = local.getSeconds();
  const min  = local.getMinutes();
  const hour = local.getHours() % 12;

  const secDeg  = sec  * 6;
  const minDeg  = min  * 6  + sec  * 0.1;
  const hourDeg = hour * 30 + min  * 0.5;

  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(now);

  // Paint drip positions around the rim
  const drips = [
    { angle: 30,  color: AS.paintRed,    h: 28, w: 9  },
    { angle: 80,  color: AS.paintYellow, h: 22, w: 7  },
    { angle: 150, color: AS.paintBlue,   h: 32, w: 10 },
    { angle: 210, color: AS.paintGreen,  h: 20, w: 8  },
    { angle: 300, color: AS.paintPurple, h: 26, w: 9  },
    { angle: 340, color: AS.paintRed,    h: 18, w: 7  },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 300 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0 }}>
          {/* Outer bezel with canvas texture look */}
          <circle cx="150" cy="150" r="140" fill={AS.kraft} stroke={AS.charcoal} strokeWidth="6" />
          {/* Clock face */}
          <circle cx="150" cy="150" r="120" fill={AS.canvas} stroke={AS.charcoal} strokeWidth="4" />
          {/* Hour markers — tick marks */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            const r1 = 105, r2 = 115;
            return (
              <line key={i}
                x1={150 + r1 * Math.cos(a)} y1={150 + r1 * Math.sin(a)}
                x2={150 + r2 * Math.cos(a)} y2={150 + r2 * Math.sin(a)}
                stroke={AS.charcoal} strokeWidth={i % 3 === 0 ? 4 : 2}
                strokeLinecap="round"
              />
            );
          })}
          {/* Paint drips on the bezel rim */}
          {drips.map((d, i) => {
            const a = (d.angle - 90) * Math.PI / 180;
            const rim = 130;
            const bx = 150 + rim * Math.cos(a);
            const by = 150 + rim * Math.sin(a);
            // drip hangs outward along the radius direction
            const ox = Math.cos(a) * d.h;
            const oy = Math.sin(a) * d.h;
            return (
              <g key={i}>
                <rect
                  x={bx - d.w / 2} y={by - d.w / 2}
                  width={d.w} height={d.h + d.w}
                  rx={d.w / 2}
                  fill={d.color}
                  transform={`rotate(${d.angle}, ${bx}, ${by})`}
                  opacity="0.9"
                />
                {/* Drip bulge at bottom */}
                <circle cx={bx + ox} cy={by + oy} r={d.w * 0.65} fill={d.color} opacity="0.9" />
              </g>
            );
          })}
          {/* Hour hand */}
          <line
            x1="150" y1="150"
            x2={150 + 65 * Math.cos((hourDeg - 90) * Math.PI / 180)}
            y2={150 + 65 * Math.sin((hourDeg - 90) * Math.PI / 180)}
            stroke={AS.charcoal} strokeWidth="8" strokeLinecap="round"
          />
          {/* Minute hand */}
          <line
            x1="150" y1="150"
            x2={150 + 92 * Math.cos((minDeg - 90) * Math.PI / 180)}
            y2={150 + 92 * Math.sin((minDeg - 90) * Math.PI / 180)}
            stroke={AS.pencil} strokeWidth="5" strokeLinecap="round"
          />
          {/* Second hand */}
          <line
            x1="150" y1="150"
            x2={150 + 98 * Math.cos((secDeg - 90) * Math.PI / 180)}
            y2={150 + 98 * Math.sin((secDeg - 90) * Math.PI / 180)}
            stroke={AS.paintRed} strokeWidth="2.5" strokeLinecap="round"
          />
          {/* Center hub */}
          <circle cx="150" cy="150" r="7" fill={AS.ink} />
          <circle cx="150" cy="150" r="3" fill={AS.canvas} />
        </svg>
        {/* Digital readout below clock only in non-compact */}
        {!compact && (
          <div style={{
            position: 'absolute', bottom: '2%', left: 0, right: 0,
            textAlign: 'center',
            fontFamily: AS_FONT_DISPLAY,
            fontSize: 'clamp(10px, 4cqh, 36px)',
            color: AS.pencil,
          }}>
            {timeStr}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER — watercolor-wash card with condition-aware painterly icons
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);

  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  const low      = (cond || '').toLowerCase();
  const isSnow   = low.includes('snow') || low.includes('flurr');
  const isStorm  = low.includes('storm') || low.includes('thunder');
  const isRain   = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isCloud  = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloud'));
  const isClear  = !isCloud && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  const isPartly = !isClear && !isCloud && !isRain && !isSnow && !isStorm;

  // Watercolor wash background per condition
  const washColor = isSnow ? '#C8DFEF' : isStorm ? '#8890A4' : isRain ? '#7BADD4' : isCloud ? '#BCCAD8' : isClear ? '#FFD87C' : '#D4EDFF';
  const wash2     = isSnow ? '#E8F2FA' : isStorm ? '#6878A0' : isRain ? '#5590C8' : isCloud ? '#A0B4C4' : isClear ? '#FFF0A0' : '#BCDFFF';

  return (
    <div className="absolute inset-0" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 340 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <radialGradient id="as-wash" cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor={wash2} stopOpacity="0.9" />
              <stop offset="100%" stopColor={washColor} stopOpacity="0.95" />
            </radialGradient>
          </defs>
          {/* Watercolor card — slightly torn edges via path */}
          <path
            d="M12,16 Q18,8 30,12 L305,10 Q322,8 328,22 L332,238 Q334,252 318,252 L22,250 Q8,252 10,236 Z"
            fill="url(#as-wash)" stroke={AS.kraft} strokeWidth="3" opacity="0.95"
          />
          {/* ── Condition icons ── */}
          {/* CLEAR — watercolor sun */}
          {(isClear || isPartly) && (
            <g transform="translate(170 100)">
              <circle r="50" fill={AS.paintYellow} opacity="0.85" />
              {Array.from({ length: 8 }).map((_, i) => {
                const a = i * 45 * Math.PI / 180;
                return (
                  <line key={i}
                    x1={Math.cos(a) * 56} y1={Math.sin(a) * 56}
                    x2={Math.cos(a) * 72} y2={Math.sin(a) * 72}
                    stroke={AS.paintYellow} strokeWidth="6" strokeLinecap="round" opacity="0.75"
                  />
                );
              })}
            </g>
          )}
          {/* Partly cloudy extra puff */}
          {isPartly && (
            <path d="M90,120 Q80,100 100,95 Q105,75 130,82 Q145,65 165,80 Q185,70 195,90 Q215,90 215,110 Q215,130 195,130 L110,130 Q85,130 90,120Z"
              fill="white" stroke={AS.kraft} strokeWidth="2" opacity="0.9" />
          )}
          {/* OVERCAST / CLOUD */}
          {isCloud && (
            <path d="M80,110 Q70,88 92,82 Q98,60 124,68 Q140,50 164,66 Q188,54 200,76 Q224,76 224,100 Q224,124 200,124 L100,124 Q72,124 80,110Z"
              fill="white" stroke={AS.kraft} strokeWidth="3" opacity="0.92" />
          )}
          {/* RAIN */}
          {isRain && (
            <g>
              <path d="M80,90 Q70,68 92,62 Q98,40 124,48 Q140,30 164,46 Q188,34 200,56 Q224,56 224,80 Q224,104 200,104 L100,104 Q72,104 80,90Z"
                fill="white" stroke={AS.kraft} strokeWidth="3" opacity="0.9" />
              {[[115,135],[155,148],[195,135],[130,162],[170,165]].map(([x,y],i) => (
                <line key={i} x1={x} y1={y} x2={x-8} y2={y+20}
                  stroke={AS.paintBlue} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
              ))}
            </g>
          )}
          {/* SNOW */}
          {isSnow && (
            <g>
              <path d="M80,90 Q70,68 92,62 Q98,40 124,48 Q140,30 164,46 Q188,34 200,56 Q224,56 224,80 Q224,104 200,104 L100,104 Q72,104 80,90Z"
                fill="white" stroke="#A0C8E0" strokeWidth="3" opacity="0.92" />
              {[[120,138],[160,150],[200,138],[140,168],[180,168]].map(([x,y],i) => (
                <g key={i}>
                  <line x1={x-10} y1={y} x2={x+10} y2={y} stroke="white" strokeWidth="3" strokeLinecap="round" />
                  <line x1={x} y1={y-10} x2={x} y2={y+10} stroke="white" strokeWidth="3" strokeLinecap="round" />
                </g>
              ))}
            </g>
          )}
          {/* STORM */}
          {isStorm && (
            <g>
              <path d="M60,100 Q50,74 76,66 Q84,38 116,50 Q134,28 164,48 Q192,32 208,58 Q240,58 240,88 Q240,116 212,116 L88,116 Q54,116 60,100Z"
                fill="#9AA0B0" stroke={AS.charcoal} strokeWidth="3" opacity="0.95" />
              <path d="M158,130 L178,130 L155,168 L170,168 L135,215 L148,175 L132,175 Z"
                fill={AS.paintYellow} stroke={AS.charcoal} strokeWidth="2" strokeLinejoin="round" />
            </g>
          )}
        </svg>
        {/* Temp + condition text overlay */}
        <div style={{
          position: 'absolute', left: '4%', right: '4%', top: '60%', bottom: '8%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AS_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 65%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={140} min={14} wrap={false}
              style={{ fontWeight: 700, color: AS.ink }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 35%', minHeight: 0 }}>
              <FitText max={60} min={9} wrap={false}
                style={{ fontFamily: AS_FONT_SERIF, fontStyle: 'italic', color: AS.pencil }}>
                {cond}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNTDOWN — spray-paint tag on brick, stencil "DAYS!" text
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 12 * 86400000);
  const label    = (config.label || resolved?.prefix || 'Until').toUpperCase();
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? 'DAYS!' : 'HRS!';

  // Spray-paint halo colors
  const sprayColors = [AS.paintRed, AS.paintBlue, AS.paintPurple];

  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 400 320" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0 }}>
          {/* Brick wall pattern */}
          {Array.from({ length: 8 }).map((_, row) =>
            Array.from({ length: 5 }).map((_, col) => {
              const offset = row % 2 === 0 ? 0 : 40;
              return (
                <rect key={`${row}-${col}`}
                  x={col * 80 + offset - 40} y={row * 40}
                  width="76" height="36" rx="3"
                  fill={row % 3 === 0 ? '#B05A3C' : '#A04830'} stroke="#8B3C24" strokeWidth="1.5"
                />
              );
            })
          )}
          {/* Spray-paint halos — concentric ellipses with blur effect */}
          {sprayColors.map((c, i) => (
            <ellipse key={i}
              cx="200" cy="160" rx={170 - i * 18} ry={135 - i * 14}
              fill={c} opacity={0.18 - i * 0.04}
              style={{ filter: 'blur(8px)' }}
            />
          ))}
          {/* Stencil tag border — rough rectangle */}
          <rect x="28" y="38" width="344" height="244" rx="12"
            fill={AS.charcoal} opacity="0.82" />
          <rect x="32" y="42" width="336" height="236" rx="10"
            fill="none" stroke={AS.paintYellow} strokeWidth="3" strokeDasharray="14 6" opacity="0.6" />
        </svg>
        {/* Stencil text overlay */}
        <div style={{
          position: 'absolute', inset: '16% 8% 10% 8%',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          fontFamily: AS_FONT_DISPLAY, color: AS.paintYellow, textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 22%', minHeight: 0, width: '100%' }}>
            <EditableText configKey="label" onConfigChange={onConfigChange}
              max={72} min={8} wrap={false}
              style={{
                fontWeight: 800, letterSpacing: '0.12em',
                textShadow: `0 0 12px ${AS.paintYellow}`,
                textTransform: 'uppercase',
              }}>
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 52%', minHeight: 0, width: '100%' }}>
            <FitText max={280} min={24} wrap={false}
              style={{
                fontWeight: 900, color: 'white',
                textShadow: `0 0 20px ${AS.paintRed}, 3px 3px 0 ${AS.ink}`,
                letterSpacing: '-0.02em',
              }}>
              {bigNum}
            </FitText>
          </div>
          <div style={{ flex: '0 0 26%', minHeight: 0, width: '100%' }}>
            <FitText max={80} min={8} wrap={false}
              style={{
                fontWeight: 800, letterSpacing: '0.08em',
                textShadow: `0 0 8px ${AS.paintBlue}`,
              }}>
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT — sketchbook page with pencil doodle border + handwritten msg
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title   = config.title   || '✏ Studio News';
  const message = config.message || config.body || 'The ceramics kiln is open after school! Bring your bisque pieces.';
  const date    = config.date    || '';

  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 500 380" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0 }}>
          {/* Sketchbook page — slight cream tint, ruled lines */}
          <rect x="6" y="6" width="488" height="368" rx="4"
            fill="#F5F0E8" stroke={AS.kraft} strokeWidth="4" />
          {/* Spiral binding holes on left */}
          {[40, 80, 120, 160, 200, 240, 280, 320, 360].map((y, i) => (
            <circle key={i} cx="18" cy={y} r="7" fill={AS.canvas} stroke={AS.charcoal} strokeWidth="2" />
          ))}
          {/* Ruled lines */}
          {[100, 140, 180, 220, 260, 300, 340].map((y, i) => (
            <line key={i} x1="40" y1={y} x2="468" y2={y}
              stroke={AS.paintBlue} strokeWidth="1" opacity="0.2" />
          ))}
          {/* Pencil doodle border — wavy hand-drawn look */}
          <rect x="32" y="28" width="436" height="324" rx="8"
            fill="none" stroke={AS.pencil} strokeWidth="2.5"
            strokeDasharray="6 3" opacity="0.5" />
          {/* Corner doodles — small stars */}
          <text x="40" y="58" fontSize="18" fill={AS.paintPurple} opacity="0.6">★</text>
          <text x="450" y="58" fontSize="18" fill={AS.paintRed} opacity="0.6">★</text>
          <text x="40" y="355" fontSize="14" fill={AS.paintGreen} opacity="0.6">✦</text>
          <text x="450" y="355" fontSize="14" fill={AS.paintYellow} opacity="0.6">✦</text>
        </svg>
        {/* Text overlay */}
        <div style={{
          position: 'absolute', top: '10%', left: '10%', right: '5%', bottom: '8%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AS_FONT_DISPLAY,
        }}>
          {/* Title */}
          {!compact && (
            <div style={{ flex: '0 0 22%', minHeight: 0 }}>
              <FitText max={80} min={10} wrap={false} center={false}
                style={{ fontWeight: 700, color: AS.paintPurple, letterSpacing: '0.02em' }}>
                {title}
              </FitText>
            </div>
          )}
          {/* Message — handwritten feel */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <EditableText configKey="message" onConfigChange={onConfigChange}
              max={220} min={12} center={false}
              style={{
                fontWeight: 600, color: AS.ink,
                lineHeight: 1.4,
              }}>
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 18%', minHeight: 0 }}>
              <FitText max={60} min={9} wrap={false} center={false}
                style={{ fontFamily: AS_FONT_SERIF, fontStyle: 'italic', color: AS.pencil }}>
                {date}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR — 3 postcard-style event cards with colored paint-splash accent
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events?.length ? config.events : [
    { date: 'MON · 3pm',  title: 'Ceramics Club — Glaze Day' },
    { date: 'WED · All Day', title: 'School Art Show Opens' },
    { date: 'FRI · 6pm',  title: 'Gallery Walk & Open House' },
  ]).slice(0, Math.max(1, Math.min(6, config.maxEvents ?? 3)));

  const splashColors = [AS.paintRed, AS.paintBlue, AS.paintGreen, AS.paintPurple, AS.paintYellow, AS.paintRed];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4%', gap: '4%' }}>
      {events.map((e: any, i: number) => (
        <div key={i} style={{
          flex: 1, minHeight: 0,
          position: 'relative',
          background: AS.canvas,
          border: `4px solid ${AS.kraft}`,
          borderRadius: 10,
          boxShadow: `3px 4px 0 ${AS.shadow}`,
          display: 'flex', alignItems: 'stretch',
          overflow: 'hidden',
        }}>
          {/* Paint splash accent — left strip with blob shape */}
          <div style={{
            width: '18%', flexShrink: 0,
            background: splashColors[i % splashColors.length],
            position: 'relative',
          }}>
            <svg viewBox="0 0 50 100" width="100%" height="100%" preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0 }}>
              <path d="M0,0 L40,0 Q55,20 48,50 Q55,80 40,100 L0,100 Z"
                fill="rgba(255,255,255,0.25)" />
            </svg>
          </div>
          {/* Text */}
          <div style={{
            flex: 1, minWidth: 0, padding: '3% 4%',
            display: 'flex', flexDirection: 'column',
            fontFamily: AS_FONT_DISPLAY,
          }}>
            <div style={{ flex: '0 0 40%', minHeight: 0 }}>
              <FitText max={80} min={8} wrap={false} center={false}
                style={{ fontFamily: AS_FONT_SERIF, fontStyle: 'italic', color: AS.pencil }}>
                {e.date}
              </FitText>
            </div>
            <div style={{ flex: '1 1 60%', minHeight: 0 }}>
              <FitText max={160} min={10} wrap={false} center={false}
                style={{ fontWeight: 700, color: AS.ink }}>
                {e.title}
              </FitText>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — self-portrait on an art easel with painted frame
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name    = config.staffName || config.name  || 'Ms. Rivera';
  const role    = config.role                       || 'Art Teacher';
  const quote   = config.bio || config.quote        || '"Every artist was first an amateur."';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 420 360" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Easel legs */}
          <line x1="210" y1="290" x2="120" y2="360" stroke="#8A6030" strokeWidth="9" strokeLinecap="round" />
          <line x1="210" y1="290" x2="300" y2="360" stroke="#8A6030" strokeWidth="9" strokeLinecap="round" />
          <line x1="160" y1="340" x2="260" y2="340" stroke="#8A6030" strokeWidth="6" strokeLinecap="round" />
          {/* Canvas frame on easel */}
          <rect x="60" y="12" width="300" height="280" rx="6"
            fill="#C09050" stroke={AS.charcoal} strokeWidth="6" />
          <rect x="72" y="24" width="276" height="256" rx="4"
            fill={AS.canvas} stroke={AS.charcoal} strokeWidth="3" />
          {/* Top ledge */}
          <rect x="50" y="6" width="320" height="20" rx="6"
            fill="#A07040" stroke={AS.charcoal} strokeWidth="4" />
          {/* Painted-border accent strips on frame */}
          <rect x="60" y="12" width="12" height="280" fill={AS.paintRed}   opacity="0.5" rx="3" />
          <rect x="348" y="12" width="12" height="280" fill={AS.paintBlue}  opacity="0.5" rx="3" />
          <rect x="60" y="12" width="300" height="12" fill={AS.paintYellow} opacity="0.5" rx="3" />
          <rect x="60" y="280" width="300" height="12" fill={AS.paintGreen} opacity="0.4" rx="3" />
          {/* Portrait area — photo or placeholder silhouette */}
          {photoUrl ? (
            <>
              <defs>
                <clipPath id="as-ss-clip"><rect x="80" y="32" width="178" height="236" rx="4" /></clipPath>
              </defs>
              <image href={resolveUrl(photoUrl)} x="80" y="32" width="178" height="236"
                preserveAspectRatio="xMidYMid slice" clipPath="url(#as-ss-clip)" />
            </>
          ) : (
            <g>
              <circle cx="170" cy="108" r="52" fill={AS.kraft} stroke={AS.pencil} strokeWidth="3" />
              <ellipse cx="170" cy="220" rx="68" ry="52" fill={AS.kraft} stroke={AS.pencil} strokeWidth="3" />
              <text x="170" y="120" textAnchor="middle" fontSize="52" fill={AS.charcoal} opacity="0.6">👩‍🎨</text>
            </g>
          )}
        </svg>
        {/* Name + role + quote overlay on the right side of canvas */}
        <div style={{
          position: 'absolute',
          top: '10%', left: '46%', right: '4%', bottom: '20%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AS_FONT_DISPLAY,
        }}>
          <div style={{ flex: '0 0 20%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={70} min={8} wrap={false} center={false}
              style={{ fontWeight: 700, color: AS.paintPurple, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {role}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 35%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={180} min={10} wrap={false} center={false}
              style={{ fontWeight: 700, color: AS.ink }}>
              {name}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 45%', minHeight: 0 }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={100} min={8} center={false}
              style={{ fontFamily: AS_FONT_SERIF, fontStyle: 'italic', color: AS.pencil }}>
              {quote}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL — blank canvas on a wooden easel frame
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : config.assetUrl ? [config.assetUrl] : [];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 420 370" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Easel legs */}
          <line x1="210" y1="290" x2="115" y2="370" stroke="#8A6030" strokeWidth="10" strokeLinecap="round" />
          <line x1="210" y1="290" x2="305" y2="370" stroke="#8A6030" strokeWidth="10" strokeLinecap="round" />
          <line x1="152" y1="346" x2="268" y2="346" stroke="#8A6030" strokeWidth="7" strokeLinecap="round" />
          {/* Wooden frame outer */}
          <rect x="55" y="10" width="310" height="288" rx="6"
            fill="#B07838" stroke={AS.charcoal} strokeWidth="6" />
          {/* Canvas area */}
          <rect x="68" y="22" width="284" height="264" rx="3"
            fill={hasImage ? 'transparent' : AS.canvas} stroke={AS.charcoal} strokeWidth="3" />
          {/* Top rail */}
          <rect x="44" y="4" width="332" height="18" rx="5"
            fill="#946428" stroke={AS.charcoal} strokeWidth="4" />
          {/* Frame corner joints */}
          {[[55,10],[349,10],[55,282],[349,282]].map(([cx,cy],i) => (
            <circle key={i} cx={cx} cy={cy} r="8" fill={AS.kraft} stroke={AS.charcoal} strokeWidth="3" />
          ))}
          {/* Image clip region — defined but only used when image present */}
          <defs>
            <clipPath id="as-easel-clip">
              <rect x="68" y="22" width="284" height="264" />
            </clipPath>
          </defs>
          {hasImage && (
            <image
              href={resolveUrl(urls[idx])}
              x="68" y="22" width="284" height="264"
              preserveAspectRatio="xMidYMid slice"
              clipPath="url(#as-easel-clip)"
              style={{ transition: 'opacity 0.5s' }}
            />
          )}
          {/* Empty canvas placeholder */}
          {!hasImage && (
            <g>
              <text x="210" y="130" textAnchor="middle" fontSize="52" opacity="0.3">🖼</text>
              <text x="210" y="178" textAnchor="middle" fontSize="14" fill={AS.pencil} opacity="0.5"
                fontFamily={AS_FONT_DISPLAY}>
                Add photos to fill this canvas
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKER — rolled kraft-paper scroll with handwriting across the bottom
// ═══════════════════════════════════════════════════════════════════════════
export function ArtStudioTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length ? config.messages : ['🎨 Supply drive this week — donate any art supplies in the main office!'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Scroll shape background */}
      <svg viewBox="0 0 1920 160" width="100%" height="100%" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="as-scroll" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#DBBF8C" />
            <stop offset="30%"  stopColor={AS.kraft} />
            <stop offset="70%"  stopColor={AS.kraft} />
            <stop offset="100%" stopColor="#B89050" />
          </linearGradient>
        </defs>
        {/* Main scroll body */}
        <rect x="0" y="20" width="1920" height="120" fill="url(#as-scroll)" />
        {/* Rolled ends — left */}
        <ellipse cx="0" cy="80" rx="24" ry="60" fill="#B89050" stroke={AS.charcoal} strokeWidth="3" />
        <ellipse cx="0" cy="80" rx="14" ry="50" fill="#D4A870" />
        {/* Rolled ends — right */}
        <ellipse cx="1920" cy="80" rx="24" ry="60" fill="#B89050" stroke={AS.charcoal} strokeWidth="3" />
        <ellipse cx="1920" cy="80" rx="14" ry="50" fill="#D4A870" />
        {/* Faint horizontal grain lines */}
        {[40, 60, 80, 100, 120].map(y => (
          <line key={y} x1="30" y1={y} x2="1890" y2={y}
            stroke={AS.charcoal} strokeWidth="0.8" opacity="0.08" />
        ))}
        {/* Paint smear decoration at edges */}
        <rect x="30" y="22" width="80" height="12" rx="6" fill={AS.paintRed}    opacity="0.5" />
        <rect x="140" y="22" width="60" height="12" rx="6" fill={AS.paintBlue}  opacity="0.4" />
        <rect x="1760" y="126" width="80" height="12" rx="6" fill={AS.paintGreen}  opacity="0.4" />
        <rect x="1660" y="126" width="60" height="12" rx="6" fill={AS.paintPurple} opacity="0.35" />
      </svg>
      {/* Message text */}
      <div style={{
        position: 'absolute', left: '3%', right: '3%',
        top: '12%', bottom: '12%',
        display: 'flex', alignItems: 'center',
        fontFamily: AS_FONT_DISPLAY,
        fontWeight: 700,
        color: AS.ink,
      }}>
        <FitText max={compact ? 60 : 80} min={12} wrap={false}
          style={{ textShadow: `1px 1px 0 rgba(255,255,255,0.5)` }}>
          {primary}
        </FitText>
      </div>
    </div>
  );
}
