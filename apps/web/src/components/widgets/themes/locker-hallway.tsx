"use client";

/**
 * Locker Hallway — middle school lobby metal locker aesthetic.
 *
 * Every widget renders as a locker-room scene element:
 *   - LOGO             → circular magnetic badge on a locker door
 *   - TEXT / RICH_TEXT → magnetic letter-tiles spelling welcome across a locker strip
 *   - CLOCK            → combination-lock dial with live hands + digital center
 *   - WEATHER          → forecast taped inside a locker door (condition-aware 6 buckets)
 *   - COUNTDOWN        → gym-class pennant stuck to a locker with a red magnet
 *   - ANNOUNCEMENT     → notebook-paper sheet taped to a locker with two corner magnets
 *   - CALENDAR         → stack of hall-pass–style cards with colored headers
 *   - STAFF_SPOTLIGHT  → magnet-framed polaroid on a locker door
 *   - IMAGE_CAROUSEL   → photo held by 4 colored locker magnets
 *   - TICKER           → long magnetic strip across the bottom with bold condensed caps
 */

import { useEffect, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ─── Palette ────────────────────────────────────────────────────────────────
export const LH = {
  steel:      '#B8BEC7',
  steelDark:  '#6B727C',
  steelLight: '#D7DCE1',
  locker:     '#4A5568',
  lockerDark: '#2D3748',
  magnet:     '#F6AD55',
  magnetAlt:  '#68D391',
  sticker:    '#F687B3',
  notebook:   '#FDFBF0',
  rule:       '#90CDF4',
  ink:        '#1A202C',
  red:        '#E53E3E',
  shadow:     'rgba(30,40,55,0.35)',
};

export const LH_FONT_DISPLAY = "'Bebas Neue', 'Oswald', system-ui, sans-serif";
export const LH_FONT_BODY    = "'Fredoka', ui-rounded, system-ui, sans-serif";
export const LH_FONT_HAND    = "'Caveat', cursive";

// ─── Helpers ────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// Small brushed-steel locker face — reused in several widgets as a backdrop
function LockerFaceRect({ x = 0, y = 0, w = 400, h = 540, color = LH.locker }: {
  x?: number; y?: number; w?: number; h?: number; color?: string;
}) {
  return (
    <g>
      {/* Body */}
      <rect x={x} y={y} width={w} height={h} rx="6" fill={color} stroke={LH.lockerDark} strokeWidth="6" />
      {/* Brushed highlight down left edge */}
      <rect x={x + 4} y={y + 4} width={8} height={h - 8} rx="3" fill={LH.steelLight} opacity="0.3" />
      {/* Top vent slots */}
      {[20, 32, 44].map((dy, i) => (
        <rect key={i} x={x + 16} y={y + dy} width={w - 32} height={5} rx="2" fill={LH.lockerDark} opacity="0.7" />
      ))}
      {/* Combination dial circle */}
      <circle cx={x + w / 2} cy={y + h - 52} r="22" fill={LH.steel} stroke={LH.lockerDark} strokeWidth="4" />
      <circle cx={x + w / 2} cy={y + h - 52} r="10" fill={LH.steelDark} />
      {/* Handle bar */}
      <rect x={x + w / 2 - 28} y={y + h / 2 - 6} width="56" height="12" rx="6"
        fill={LH.steelLight} stroke={LH.steelDark} strokeWidth="3" />
    </g>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGO — circular magnetic badge stuck to a locker door
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayLogo({
  config,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const initials = (
    config.initials ||
    (config.schoolName || 'MS')
      .split(/\s+/)
      .filter(Boolean)
      .map((w: string) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ||
    'MS'
  );
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <svg viewBox="0 0 300 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 6px 14px ${LH.shadow})`, overflow: 'visible' }}>
        {/* Locker door backdrop */}
        <LockerFaceRect x={20} y={20} w={260} h={260} />
        {/* Circular magnetic badge */}
        <defs>
          <radialGradient id="lhBadgeGrad" cx="38%" cy="35%" r="65%">
            <stop offset="0%" stopColor={LH.steelLight} />
            <stop offset="60%" stopColor={LH.steel} />
            <stop offset="100%" stopColor={LH.steelDark} />
          </radialGradient>
          <clipPath id="lhBadgeClip">
            <circle cx="150" cy="135" r="72" />
          </clipPath>
        </defs>
        {/* Badge ring */}
        <circle cx="150" cy="135" r="80" fill={LH.magnet} stroke={LH.ink} strokeWidth="5" />
        <circle cx="150" cy="135" r="74" fill="url(#lhBadgeGrad)" stroke={LH.steelDark} strokeWidth="3" />
        {/* Ridged ring detail */}
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i * 15 * Math.PI) / 180;
          const r1 = 65, r2 = 73;
          return (
            <line
              key={i}
              x1={150 + Math.cos(a) * r1} y1={135 + Math.sin(a) * r1}
              x2={150 + Math.cos(a) * r2} y2={135 + Math.sin(a) * r2}
              stroke={LH.steelDark} strokeWidth="2" opacity="0.5"
            />
          );
        })}
        {/* Inner content */}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x={78} y={63} width={144} height={144}
            preserveAspectRatio="xMidYMid slice" clipPath="url(#lhBadgeClip)" />
        ) : (
          <text x="150" y="152" textAnchor="middle" dominantBaseline="middle"
            fontFamily={LH_FONT_DISPLAY} fontSize="52" fontWeight="900"
            fill={LH.ink} letterSpacing="2">
            {initials}
          </text>
        )}
        {/* Orange magnet dot top-left of door */}
        <circle cx="46" cy="46" r="10" fill={LH.magnet} stroke={LH.ink} strokeWidth="2" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT — magnetic letter-tiles spelling welcome across a locker-row strip
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayText({
  config,
  compact,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'WELCOME BACK!';
  const subtitle = config.subtitle || 'make it a great day';

  // Tile-letter colors cycle through palette
  const tileColors = [LH.magnet, LH.magnetAlt, LH.sticker, LH.rule, LH.magnet, LH.magnetAlt];

  return (
    <div className="absolute inset-0 flex flex-col" style={{ padding: '2%', gap: '3%' }}>
      {/* Main locker strip */}
      <div style={{ flex: !compact && subtitle ? '0 0 62%' : '0 0 100%', minHeight: 0, position: 'relative' }}>
        {/* Brushed-steel horizontal strip */}
        <svg viewBox="0 0 1800 220" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 8px 18px ${LH.shadow})` }}>
          <defs>
            <linearGradient id="lhStripGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LH.steelLight} />
              <stop offset="40%" stopColor={LH.steel} />
              <stop offset="100%" stopColor={LH.steelDark} />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="1800" height="220" rx="10" fill="url(#lhStripGrad)"
            stroke={LH.lockerDark} strokeWidth="8" vectorEffect="non-scaling-stroke" />
          {/* Vent slots at top */}
          {[14, 24, 34].map((dy, i) => (
            <rect key={i} x="20" y={dy} width="1760" height="5" rx="2"
              fill={LH.lockerDark} opacity="0.25" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Magnetic letter tiles rendered as colorful rect blocks behind the text */}
          {Array.from({ length: 16 }).map((_, i) => (
            <rect key={i} x={20 + i * 111} y="50" width="100" height="130" rx="8"
              fill={tileColors[i % tileColors.length]} stroke={LH.ink} strokeWidth="3"
              opacity="0.82" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Bottom raised edge */}
          <rect x="8" y="206" width="1784" height="10" rx="4" fill={LH.lockerDark} opacity="0.4"
            vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Text overlay centered in tile region */}
        <div style={{
          position: 'absolute',
          left: '2%', right: '2%', top: '22%', bottom: '12%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <EditableText
            configKey="content" onConfigChange={onConfigChange}
            max={200} min={14} wrap={false}
            style={{
              fontFamily: LH_FONT_DISPLAY,
              fontWeight: 900,
              color: LH.ink,
              textShadow: `2px 2px 0 rgba(255,255,255,0.6), -1px -1px 0 ${LH.shadow}`,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {content}
          </EditableText>
        </div>
      </div>

      {/* Subtitle on notebook-paper strip */}
      {!compact && subtitle && (
        <div style={{ flex: '1 1 0', minHeight: 0, position: 'relative' }}>
          <svg viewBox="0 0 1800 90" width="100%" height="100%" preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 4px 8px ${LH.shadow})` }}>
            <rect x="0" y="0" width="1800" height="90" rx="6" fill={LH.notebook}
              stroke={LH.steelDark} strokeWidth="4" vectorEffect="non-scaling-stroke" />
            {/* Notebook rule lines */}
            {[28, 48, 68].map((dy, i) => (
              <line key={i} x1="60" y1={dy} x2="1740" y2={dy}
                stroke={LH.rule} strokeWidth="2" opacity="0.7" vectorEffect="non-scaling-stroke" />
            ))}
            {/* Red margin line */}
            <line x1="55" y1="0" x2="55" y2="90" stroke={LH.red} strokeWidth="3" opacity="0.6"
              vectorEffect="non-scaling-stroke" />
          </svg>
          <div style={{ position: 'absolute', left: '5%', right: '3%', top: '10%', bottom: '10%' }}>
            <EditableText
              configKey="subtitle" onConfigChange={onConfigChange}
              max={100} min={9} wrap={false}
              style={{ fontFamily: LH_FONT_HAND, color: LH.ink }}
            >
              {subtitle}
            </EditableText>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLOCK — combination-lock dial with live hands + digital time in center
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayClock({
  config,
  compact,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined;
  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(now);
  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: tz,
  }).format(now);

  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg  = (m + s / 60) * 6;
  const secDeg  = s * 6;

  // 24 tick marks around the dial
  const ticks = Array.from({ length: 60 });
  const majorAt = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 600 600" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 10px 24px ${LH.shadow})` }}>
          <defs>
            <radialGradient id="lhDialGrad" cx="38%" cy="35%" r="70%">
              <stop offset="0%" stopColor={LH.steelLight} />
              <stop offset="55%" stopColor={LH.steel} />
              <stop offset="100%" stopColor={LH.steelDark} />
            </radialGradient>
            <radialGradient id="lhCenterGrad" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#2A3040" />
              <stop offset="100%" stopColor={LH.lockerDark} />
            </radialGradient>
          </defs>

          {/* Outer locker-face frame */}
          <LockerFaceRect x={50} y={50} w={500} h={500} />

          {/* Dial bezel */}
          <circle cx="300" cy="300" r="220" fill={LH.lockerDark} stroke={LH.steelDark} strokeWidth="10" />
          <circle cx="300" cy="300" r="210" fill="url(#lhDialGrad)" />

          {/* Tick marks */}
          {ticks.map((_, i) => {
            const a = ((i * 6 - 90) * Math.PI) / 180;
            const isMajor = majorAt.has(i);
            const r1 = isMajor ? 175 : 188;
            const r2 = 200;
            return (
              <line key={i}
                x1={300 + Math.cos(a) * r1} y1={300 + Math.sin(a) * r1}
                x2={300 + Math.cos(a) * r2} y2={300 + Math.sin(a) * r2}
                stroke={isMajor ? LH.ink : LH.steelDark}
                strokeWidth={isMajor ? 5 : 2}
                strokeLinecap="round"
              />
            );
          })}

          {/* Numbers at 12 positions */}
          {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            return (
              <text key={n}
                x={300 + Math.cos(a) * 156} y={300 + Math.sin(a) * 156}
                textAnchor="middle" dominantBaseline="central"
                fontFamily={LH_FONT_DISPLAY} fontSize="24" fontWeight="700"
                fill={LH.ink}>
                {n}
              </text>
            );
          })}

          {/* Dark center face */}
          <circle cx="300" cy="300" r="120" fill="url(#lhCenterGrad)" stroke={LH.steelDark} strokeWidth="5" />

          {/* Hour hand */}
          <g transform={`rotate(${hourDeg} 300 300)`}>
            <line x1="300" y1="300" x2="300" y2="228" stroke={LH.steelLight} strokeWidth="9" strokeLinecap="round" />
          </g>
          {/* Minute hand */}
          <g transform={`rotate(${minDeg} 300 300)`}>
            <line x1="300" y1="300" x2="300" y2="210" stroke={LH.steel} strokeWidth="6" strokeLinecap="round" />
          </g>
          {/* Second hand */}
          <g transform={`rotate(${secDeg} 300 300)`}>
            <line x1="300" y1="316" x2="300" y2="204" stroke={LH.red} strokeWidth="3" strokeLinecap="round" />
          </g>

          {/* Center pivot */}
          <circle cx="300" cy="300" r="10" fill={LH.magnet} stroke={LH.ink} strokeWidth="3" />
        </svg>

        {/* Digital time in center face */}
        <div style={{
          position: 'absolute',
          left: '29%', right: '29%', top: '50%', bottom: '15%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
        }}>
          {!compact && (
            <div style={{ width: '100%', flex: '0 0 40%', minHeight: 0 }}>
              <FitText max={36} min={8} wrap={false}
                style={{ fontFamily: LH_FONT_DISPLAY, color: LH.steelLight, letterSpacing: '0.04em' }}>
                {dateStr}
              </FitText>
            </div>
          )}
          <div style={{ width: '100%', flex: '1 1 0', minHeight: 0 }}>
            <FitText max={52} min={10} wrap={false}
              style={{ fontFamily: LH_FONT_DISPLAY, color: LH.magnet, fontWeight: 700, letterSpacing: '0.02em' }}>
              {timeStr}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// WEATHER — forecast taped inside a locker door, condition-aware magnet icons
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayWeather({
  config,
  compact,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
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
  const isOvercast = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear  = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  // isPartly covers everything else

  // Magnet-style weather icons in SVG
  const WeatherIcon = () => {
    if (isClear) return (
      <g>
        <circle cx="300" cy="190" r="70" fill={LH.magnet} stroke={LH.ink} strokeWidth="6" />
        {[0,45,90,135,180,225,270,315].map((deg, i) => {
          const a = (deg * Math.PI) / 180;
          return <line key={i} x1={300 + Math.cos(a)*76} y1={190 + Math.sin(a)*76}
            x2={300 + Math.cos(a)*96} y2={190 + Math.sin(a)*96}
            stroke={LH.magnet} strokeWidth="7" strokeLinecap="round" />;
        })}
        <circle cx="284" cy="180" r="9" fill={LH.ink} />
        <circle cx="316" cy="180" r="9" fill={LH.ink} />
        <path d="M 280 205 Q 300 225 320 205" stroke={LH.ink} strokeWidth="6" fill="none" strokeLinecap="round" />
      </g>
    );
    if (isSnow) return (
      <g>
        <path d="M180 260 Q140 260 140 220 Q140 180 180 170 Q185 120 240 115 Q280 90 320 120 Q370 100 400 150 Q440 150 450 200 Q480 200 480 235 Q480 270 440 270 Z"
          fill={LH.steelLight} stroke={LH.ink} strokeWidth="6" />
        {[[240,310],[290,340],[340,310],[390,340],[440,310]].map(([x,y],i) => (
          <g key={i} stroke={LH.rule} strokeWidth="5" strokeLinecap="round">
            <line x1={x-14} y1={y} x2={x+14} y2={y} />
            <line x1={x} y1={y-14} x2={x} y2={y+14} />
            <line x1={x-10} y1={y-10} x2={x+10} y2={y+10} />
            <line x1={x-10} y1={y+10} x2={x+10} y2={y-10} />
          </g>
        ))}
      </g>
    );
    if (isStorm) return (
      <g>
        <path d="M180 260 Q140 260 140 220 Q140 180 180 170 Q185 120 240 115 Q280 90 320 120 Q370 100 400 150 Q440 150 450 200 Q480 200 480 235 Q480 270 440 270 Z"
          fill={LH.steelDark} stroke={LH.ink} strokeWidth="6" />
        <path d="M310 280 L360 280 L330 335 L375 335 L270 415 L310 330 L270 330 Z"
          fill={LH.magnet} stroke={LH.ink} strokeWidth="5" strokeLinejoin="round" />
      </g>
    );
    if (isRain) return (
      <g>
        <path d="M180 240 Q140 240 140 200 Q140 160 180 150 Q185 100 240 95 Q280 70 320 100 Q370 80 400 130 Q440 130 450 180 Q480 180 480 215 Q480 250 440 250 Z"
          fill={LH.steelLight} stroke={LH.ink} strokeWidth="6" />
        {[[240,295],[295,320],[350,295],[405,320],[460,295]].map(([x,y],i) => (
          <ellipse key={i} cx={x} cy={y} rx="9" ry="13" fill={LH.rule} stroke={LH.ink} strokeWidth="3" />
        ))}
      </g>
    );
    if (isOvercast) return (
      <g>
        <path d="M180 280 Q130 280 130 230 Q130 180 180 165 Q190 100 260 95 Q310 70 360 110 Q420 80 460 140 Q510 140 520 210 Q560 210 560 255 Q560 300 510 300 Z"
          fill={LH.steel} stroke={LH.ink} strokeWidth="6" />
      </g>
    );
    // Partly cloudy default
    return (
      <g>
        <circle cx="380" cy="155" r="55" fill={LH.magnet} stroke={LH.ink} strokeWidth="5" />
        {[0,60,120,180,240,300].map((deg, i) => {
          const a = (deg * Math.PI) / 180;
          return <line key={i} x1={380+Math.cos(a)*60} y1={155+Math.sin(a)*60}
            x2={380+Math.cos(a)*76} y2={155+Math.sin(a)*76}
            stroke={LH.magnet} strokeWidth="6" strokeLinecap="round" />;
        })}
        <path d="M150 280 Q110 280 110 240 Q110 200 150 188 Q158 138 220 132 Q262 110 304 142 Q350 120 384 168 Q420 168 430 210 Q456 210 456 242 Q456 274 420 274 Z"
          fill={LH.steelLight} stroke={LH.ink} strokeWidth="6" />
      </g>
    );
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Locker door with paper taped inside */}
        <svg viewBox="0 0 600 540" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 8px 20px ${LH.shadow})` }}>
          {/* Door body */}
          <LockerFaceRect x={20} y={20} w={560} h={500} />
          {/* Notebook paper taped inside */}
          <rect x="60" y="65" width="480" height="340" rx="4" fill={LH.notebook}
            stroke={LH.steelDark} strokeWidth="3" />
          {/* Paper rule lines */}
          {[95, 115, 135, 155, 175, 195, 215, 235, 255, 275, 295, 315, 335, 355, 375].map((dy, i) => (
            <line key={i} x1="90" y1={dy} x2="520" y2={dy} stroke={LH.rule} strokeWidth="1.5" opacity="0.6" />
          ))}
          {/* Red margin */}
          <line x1="110" y1="65" x2="110" y2="405" stroke={LH.red} strokeWidth="2.5" opacity="0.5" />
          {/* Tape strips at top corners */}
          <rect x="100" y="55" width="70" height="22" rx="3" fill={LH.steelLight} opacity="0.6"
            stroke={LH.steelDark} strokeWidth="1.5" transform="rotate(-5 135 66)" />
          <rect x="440" y="55" width="70" height="22" rx="3" fill={LH.magnetAlt} opacity="0.55"
            stroke={LH.steelDark} strokeWidth="1.5" transform="rotate(4 475 66)" />
          {/* Condition icon area */}
          <WeatherIcon />
        </svg>
        {/* Temp + condition text */}
        <div style={{
          position: 'absolute',
          left: '14%', right: '14%', top: '68%', bottom: '16%',
          display: 'flex', flexDirection: 'column',
          fontFamily: LH_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 65%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={130} min={14} wrap={false}
              style={{ fontWeight: 900, color: LH.ink, letterSpacing: '-0.01em' }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 35%', minHeight: 0 }}>
              <FitText max={60} min={9} wrap={false}
                style={{ fontFamily: LH_FONT_HAND, color: LH.steelDark }}>
                {cond}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COUNTDOWN — gym-class pennant stuck to locker with a red magnet
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayCountdown({
  config,
  compact,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 7 * 86400000);
  const label    = (config.label || resolved?.prefix || 'DAYS LEFT').toUpperCase();
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HR' : 'HRS');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 540" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 10px 22px ${LH.shadow})` }}>
          {/* Locker door backdrop */}
          <LockerFaceRect x={20} y={20} w={660} h={500} />
          {/* Pennant — triangle shape */}
          <polygon points="80,100 640,240 80,380"
            fill={LH.red} stroke={LH.ink} strokeWidth="7" strokeLinejoin="round" />
          {/* Pennant stripes */}
          <polygon points="80,140 560,240 80,200" fill="rgba(255,255,255,0.12)" />
          <polygon points="80,280 560,240 80,340" fill="rgba(255,255,255,0.12)" />
          {/* Staff/pole */}
          <line x1="80" y1="60" x2="80" y2="480" stroke={LH.steelDark} strokeWidth="10" strokeLinecap="round" />
          {/* Red magnet holding pennant to locker */}
          <circle cx="80" cy="100" r="18" fill={LH.red} stroke={LH.ink} strokeWidth="4" />
          <circle cx="80" cy="380" r="18" fill={LH.red} stroke={LH.ink} strokeWidth="4" />
        </svg>
        {/* Text overlaid on pennant */}
        <div style={{
          position: 'absolute',
          left: '16%', right: '14%', top: '18%', bottom: '28%',
          display: 'flex', flexDirection: 'column',
          fontFamily: LH_FONT_DISPLAY, color: '#fff',
          textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 24%', minHeight: 0 }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={80} min={8} wrap={false}
              style={{ fontWeight: 700, letterSpacing: '0.05em', color: '#fff',
                textShadow: `2px 2px 0 ${LH.lockerDark}` }}
            >
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 52%', minHeight: 0 }}>
            <FitText max={280} min={20} wrap={false}
              style={{ fontWeight: 900, color: '#fff', textShadow: `3px 3px 0 ${LH.lockerDark}` }}>
              {bigNum}
            </FitText>
          </div>
          <div style={{ flex: '0 0 24%', minHeight: 0 }}>
            <FitText max={90} min={9} wrap={false}
              style={{ fontFamily: LH_FONT_BODY, color: '#fff',
                textShadow: `1px 1px 0 ${LH.lockerDark}` }}>
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT — notebook-paper sheet taped to locker with two corner magnets
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayAnnouncement({
  config,
  compact,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title   = config.title   || '📢 ATTENTION';
  const message = config.message || config.body || 'Gym uniforms required starting Monday. Check your locker!';
  const date    = config.date    || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 1600 500" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 10px 22px ${LH.shadow})` }}>
          {/* Locker body strip */}
          <defs>
            <linearGradient id="lhAnnGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LH.steelLight} />
              <stop offset="100%" stopColor={LH.steel} />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="1600" height="500" rx="8" fill="url(#lhAnnGrad)"
            stroke={LH.lockerDark} strokeWidth="8" vectorEffect="non-scaling-stroke" />
          {/* Top vent slots */}
          {[14, 26, 38].map((dy, i) => (
            <rect key={i} x="20" y={dy} width="1560" height="7" rx="3"
              fill={LH.lockerDark} opacity="0.25" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Notebook paper sheet */}
          <rect x="80" y="60" width="1440" height="400" rx="5"
            fill={LH.notebook} stroke={LH.steelDark} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {/* Rule lines */}
          {[100, 130, 160, 190, 220, 250, 280, 310, 340, 370, 400, 430].map((dy, i) => (
            <line key={i} x1="120" y1={dy} x2="1500" y2={dy}
              stroke={LH.rule} strokeWidth="1.8" opacity="0.55" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Red margin */}
          <line x1="150" y1="60" x2="150" y2="460" stroke={LH.red} strokeWidth="3" opacity="0.5"
            vectorEffect="non-scaling-stroke" />
          {/* Corner magnets — orange top-left, green top-right */}
          <circle cx="120" cy="80" r="22" fill={LH.magnet} stroke={LH.ink} strokeWidth="4" />
          <circle cx="1480" cy="80" r="22" fill={LH.magnetAlt} stroke={LH.ink} strokeWidth="4" />
          {/* Bottom magnets */}
          <circle cx="120" cy="440" r="22" fill={LH.sticker} stroke={LH.ink} strokeWidth="4" />
          <circle cx="1480" cy="440" r="22" fill={LH.rule} stroke={LH.ink} strokeWidth="4" />
        </svg>

        {/* Content */}
        <div style={{
          position: 'absolute',
          left: '11%', right: '8%', top: '14%', bottom: '12%',
          display: 'flex', flexDirection: 'column',
          fontFamily: LH_FONT_DISPLAY,
        }}>
          {!compact && (
            <div style={{ flex: '0 0 22%', minHeight: 0 }}>
              <FitText max={80} min={10} wrap={false}
                style={{ fontWeight: 900, color: LH.red, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {title}
              </FitText>
            </div>
          )}
          <div style={{ flex: !compact && date ? '1 1 60%' : '1 1 100%', minHeight: 0 }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={260} min={11}
              style={{ fontFamily: LH_FONT_HAND, color: LH.ink, lineHeight: 1.4 }}
            >
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 18%', minHeight: 0 }}>
              <FitText max={60} min={9} wrap={false}
                style={{ fontFamily: LH_FONT_HAND, color: LH.steelDark }}>
                {date}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR — stack of hall-pass–style cards with colored headers
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayCalendar({
  config,
}: { config: any; compact?: boolean }) {
  const events = (
    config.events?.length
      ? config.events
      : [
          { date: 'MON · 8:30am', title: 'Spirit Day — Wear School Colors' },
          { date: 'WED · 12pm',   title: 'Lunch with Principal' },
          { date: 'FRI · 3pm',    title: 'Early Dismissal' },
        ]
  ).slice(0, Math.max(1, Math.min(8, config.maxEvents ?? 4)));

  const headerColors = [LH.magnet, LH.magnetAlt, LH.sticker, LH.rule, LH.red, LH.magnet, LH.magnetAlt, LH.sticker];

  return (
    <div className="absolute inset-0 flex flex-col justify-center"
      style={{ padding: '3%', gap: '3%', fontFamily: LH_FONT_DISPLAY }}>
      {events.map((e: any, i: number) => {
        const hdrColor = headerColors[i % headerColors.length];
        return (
          <div key={i} style={{
            flex: 1, minHeight: 0,
            background: LH.notebook,
            borderRadius: 8,
            border: `5px solid ${LH.steelDark}`,
            boxShadow: `0 6px 16px ${LH.shadow}`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Colored header bar */}
            <div style={{
              background: hdrColor,
              flex: '0 0 34%',
              display: 'flex', alignItems: 'center',
              padding: '0 3%',
              borderBottom: `3px solid ${LH.lockerDark}`,
            }}>
              <FitText max={160} min={8} wrap={false} center={false}
                style={{ fontWeight: 900, color: LH.ink, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {e.date}
              </FitText>
            </div>
            {/* Event title */}
            <div style={{
              flex: 1, minHeight: 0,
              display: 'flex', alignItems: 'center',
              padding: '0 3%',
            }}>
              <FitText max={200} min={9} wrap={false} center={false}
                style={{ fontFamily: LH_FONT_HAND, color: LH.ink }}>
                {e.title}
              </FitText>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — magnet-framed polaroid on a locker door
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayStaffSpotlight({
  config,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name     = config.staffName || config.name || 'Mr. Rivera';
  const role     = config.role      || 'Teacher of the Week';
  const quote    = config.bio       || config.quote || '"Keep pushing — you\'ve got this!"';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 640 580" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 8px 20px ${LH.shadow})` }}>
          {/* Locker door */}
          <LockerFaceRect x={0} y={0} w={640} h={580} />
          {/* Polaroid frame */}
          <rect x="100" y="60" width="440" height="420" rx="6" fill="#fff" stroke={LH.steelDark} strokeWidth="5" />
          {/* Photo area */}
          <rect x="116" y="76" width="408" height="300" rx="3" fill={LH.steel} />
          {/* Caption strip */}
          <rect x="100" y="376" width="440" height="104" rx="0" fill="#fff" />
          {/* TEACHER OF THE WEEK text as magnetic tiles */}
          {['T','O','T','W'].map((letter, i) => (
            <g key={i}>
              <rect x={148 + i * 80} y={400} width="64" height="64" rx="6"
                fill={[LH.magnet, LH.sticker, LH.magnetAlt, LH.rule][i]}
                stroke={LH.ink} strokeWidth="3" />
              <text x={148 + i * 80 + 32} y={440} textAnchor="middle" dominantBaseline="central"
                fontFamily={LH_FONT_DISPLAY} fontSize="32" fontWeight="900" fill={LH.ink}>
                {letter}
              </text>
            </g>
          ))}
          {/* Corner magnets holding polaroid */}
          <circle cx="110" cy="70"  r="14" fill={LH.magnet}    stroke={LH.ink} strokeWidth="3" />
          <circle cx="530" cy="70"  r="14" fill={LH.sticker}   stroke={LH.ink} strokeWidth="3" />
          <circle cx="110" cy="470" r="14" fill={LH.magnetAlt} stroke={LH.ink} strokeWidth="3" />
          <circle cx="530" cy="470" r="14" fill={LH.rule}      stroke={LH.ink} strokeWidth="3" />
        </svg>

        {/* Photo */}
        <div style={{
          position: 'absolute',
          left: '18.5%', right: '18.5%', top: '13%', bottom: '38%',
          overflow: 'hidden', borderRadius: 3,
          background: LH.steelDark,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ fontSize: 'clamp(32px, 14cqh, 90px)', color: LH.steelLight }}>👤</div>
          )}
        </div>

        {/* Name + role text */}
        <div style={{
          position: 'absolute',
          left: '18%', right: '10%', top: '67%', bottom: '12%',
          display: 'flex', flexDirection: 'column',
          fontFamily: LH_FONT_DISPLAY,
        }}>
          <div style={{ flex: '0 0 40%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={160} min={10} wrap={false} center={false}
              style={{ fontWeight: 900, color: LH.ink, letterSpacing: '0.02em' }}>
              {name}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 0', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={80} min={8} wrap={false} center={false}
              style={{ fontFamily: LH_FONT_HAND, color: LH.steelDark }}>
              {role}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL — photo held by 4 colored locker magnets
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayImageCarousel({
  config,
}: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const magnetColors = [LH.magnet, LH.sticker, LH.magnetAlt, LH.rule];

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Locker-steel background plate */}
        <svg viewBox="0 0 700 560" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 8px 18px ${LH.shadow})` }}>
          <defs>
            <linearGradient id="lhCarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LH.steelLight} />
              <stop offset="100%" stopColor={LH.steel} />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="700" height="560" rx="8" fill="url(#lhCarGrad)"
            stroke={LH.lockerDark} strokeWidth="8" vectorEffect="non-scaling-stroke" />
          {/* Top vent slots */}
          {[14, 26].map((dy, i) => (
            <rect key={i} x="16" y={dy} width="668" height="6" rx="3"
              fill={LH.lockerDark} opacity="0.22" vectorEffect="non-scaling-stroke" />
          ))}
          {/* 4 colored magnets at photo corners */}
          {[
            [80,  80],
            [620, 80],
            [80,  480],
            [620, 480],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="26"
              fill={magnetColors[i]} stroke={LH.ink} strokeWidth="4" />
          ))}
        </svg>

        {/* Photo or placeholder */}
        <div style={{
          position: 'absolute',
          left: '14%', right: '14%', top: '12%', bottom: '12%',
          overflow: 'hidden', borderRadius: 4,
          background: LH.lockerDark,
          boxShadow: `0 4px 12px ${LH.shadow}`,
        }}>
          {urls.length > 0 ? (
            <img src={resolveUrl(urls[idx])} alt="Carousel"
              className="transition-opacity duration-500"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${LH.lockerDark} 0%, ${LH.locker} 100%)`,
              color: LH.steelLight, fontFamily: LH_FONT_DISPLAY, textAlign: 'center', padding: '6%',
            }}>
              <div style={{ fontSize: 'clamp(28px, 12cqh, 80px)', marginBottom: '4%' }}>📷</div>
              <FitText max={60} min={10} wrap={false}
                style={{ fontWeight: 700, color: LH.steelLight }}>
                ADD PHOTOS
              </FitText>
            </div>
          )}
        </div>

        {/* Dot indicators */}
        {urls.length > 1 && (
          <div style={{
            position: 'absolute', bottom: '6%', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: '1.5%',
          }}>
            {urls.map((_, i) => (
              <div key={i} style={{
                width: 10, height: 10, borderRadius: '50%',
                background: i === idx ? LH.magnet : LH.steelDark,
                border: `2px solid ${LH.ink}`,
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TICKER — magnetic strip across the bottom with bold condensed caps
// ═══════════════════════════════════════════════════════════════════════════════
export function LockerHallwayTicker({
  config,
  compact,
}: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['🏆 Pep rally FRIDAY at 2pm · Spirit points leader: 7th grade · Library closes early today'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];

  // Dot-matrix grid of small squares as decorative texture
  const dots = Array.from({ length: 28 }, (_, i) => i);

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
      <svg viewBox="0 0 3200 120" width="100%" height="100%" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="lhTickGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LH.lockerDark} />
            <stop offset="50%" stopColor={LH.locker} />
            <stop offset="100%" stopColor={LH.lockerDark} />
          </linearGradient>
        </defs>
        {/* Magnetic strip base */}
        <rect x="0" y="0" width="3200" height="120" fill="url(#lhTickGrad)"
          vectorEffect="non-scaling-stroke" />
        {/* Top and bottom edge bevel */}
        <rect x="0" y="0" width="3200" height="8" fill={LH.steelLight} opacity="0.3"
          vectorEffect="non-scaling-stroke" />
        <rect x="0" y="112" width="3200" height="8" fill={LH.lockerDark} opacity="0.5"
          vectorEffect="non-scaling-stroke" />
        {/* Dot-matrix decorative dots */}
        {dots.map((i) => (
          <rect key={i} x={20 + i * 114} y="18" width="10" height="10" rx="2"
            fill={LH.magnet} opacity="0.35" vectorEffect="non-scaling-stroke" />
        ))}
        {dots.map((i) => (
          <rect key={`b${i}`} x={20 + i * 114} y="92" width="10" height="10" rx="2"
            fill={LH.magnet} opacity="0.35" vectorEffect="non-scaling-stroke" />
        ))}
        {/* Side bracket bolts */}
        <circle cx="30" cy="60" r="12" fill={LH.steel} stroke={LH.steelDark} strokeWidth="3" />
        <circle cx="3170" cy="60" r="12" fill={LH.steel} stroke={LH.steelDark} strokeWidth="3" />
      </svg>

      {/* Scrolling message text */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center',
        paddingLeft: '3%', paddingRight: '3%',
        fontFamily: LH_FONT_DISPLAY,
        fontWeight: 900,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontSize: compact ? '1.1em' : '1.6em',
        color: LH.magnet,
        textShadow: `0 0 12px rgba(246,173,85,0.5), 2px 2px 0 ${LH.lockerDark}`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {/* Decorative bracket */}
        <span style={{ color: LH.steelLight, marginRight: '1.5%', flexShrink: 0 }}>▶</span>
        {primary}
        <span style={{ color: LH.steelLight, marginLeft: '1.5%', flexShrink: 0 }}>◀</span>
      </div>
    </div>
  );
}
