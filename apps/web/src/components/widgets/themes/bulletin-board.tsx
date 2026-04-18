"use client";

import { FitText } from './FitText';
import { EditableText } from './EditableText';

/**
 * Bulletin Board — classroom cork-board theme.
 *
 * Every widget renders as a REAL classroom craft, not a rectangle:
 *   - LOGO             → round paper school-crest badge with a red pushpin
 *   - TEXT / RICH_TEXT → construction-paper letter banner on jute string
 *   - CLOCK            → round paper clock face pinned with two thumbtacks
 *   - WEATHER          → lined index card held by a red pushpin
 *   - COUNTDOWN        → torn-paper banner with dangling ribbon tails
 *   - ANNOUNCEMENT     → lined index card pinned with two blue pushpins
 *   - CALENDAR         → stack of 3 rotated sticky notes with tape
 *   - STAFF_SPOTLIGHT  → polaroid photo with black tape, handwritten name
 *   - IMAGE_CAROUSEL   → photo pinned to cork with four pushpins
 *   - TICKER           → scalloped paper strip banner taped across
 */

import { useEffect, useState } from 'react';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '') : 'http://localhost:8080';
function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Palette ────────────────────────────────────────────
export const BB = {
  cork:       '#C69C6D',
  corkDark:   '#8D6B4A',
  paper:      '#FDF9F0',
  paperRule:  '#94B9FF',
  pink:       '#FFB3BA',
  peach:      '#FFDFBA',
  yellow:     '#FFFFBA',
  mint:       '#BAFFC9',
  sky:        '#BAE1FF',
  pinRed:     '#E63946',
  pinYellow:  '#FFD23F',
  pinGreen:   '#06A77D',
  pinBlue:    '#1D7CF2',
  ink:        '#3A2E2A',
  shadow:     'rgba(90,60,30,0.25)',
};

export const BB_FONT_DISPLAY = "'Fredoka', ui-rounded, system-ui, sans-serif";
export const BB_FONT_SCRIPT  = "'Caveat', cursive";
const PIN_SHADOW = `drop-shadow(0 4px 6px ${BB.shadow})`;
const PAPER_SHADOW = `drop-shadow(0 6px 10px ${BB.shadow})`;

// ─── Reusable pushpin (3D via radial gradient) ─────────
function Pushpin({ cx, cy, r = 14, color = BB.pinRed, id }: { cx: number; cy: number; r?: number; color?: string; id: string }) {
  return (
    <g>
      <defs>
        <radialGradient id={`pin-${id}`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="35%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={BB.ink} stopOpacity="0.65" />
        </radialGradient>
      </defs>
      {/* shadow puck */}
      <ellipse cx={cx + 2} cy={cy + 3} rx={r * 0.95} ry={r * 0.55} fill={BB.shadow} />
      {/* pin head */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#pin-${id})`} stroke={BB.ink} strokeWidth={1.2} />
      {/* highlight */}
      <ellipse cx={cx - r * 0.3} cy={cy - r * 0.35} rx={r * 0.32} ry={r * 0.22} fill="#FFFFFF" opacity="0.75" />
    </g>
  );
}

// ═══════════════════════════════════════════════════════════
// LOGO — round paper crest with a red pushpin at top-center
// ═══════════════════════════════════════════════════════════
export function BulletinBoardLogo({ config }: { config: any; compact?: boolean }) {
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'transparent', padding: '8%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: PAPER_SHADOW, overflow: 'visible' }}>
        {/* Paper backing disc — slightly torn ring */}
        <circle cx="130" cy="138" r="108" fill={BB.paper} stroke={BB.corkDark} strokeWidth="2.5" />
        <circle cx="130" cy="138" r="96" fill={BB.peach} stroke={BB.ink} strokeWidth="3" />
        <circle cx="130" cy="138" r="78" fill={BB.paper} stroke={BB.ink} strokeWidth="2" />
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="56" y="64" width="148" height="148"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(74px at 130px 138px)" />
        ) : (
          <g>
            {/* stacked books + apple emblem */}
            {/* shadow */}
            <ellipse cx="130" cy="195" rx="60" ry="6" fill={BB.shadow} />
            {/* bottom book — navy-ish blue */}
            <rect x="72" y="160" width="116" height="22" rx="3" fill={BB.pinBlue} stroke={BB.ink} strokeWidth="2.5" />
            <line x1="72" y1="168" x2="188" y2="168" stroke={BB.ink} strokeWidth="1" opacity="0.4" />
            {/* middle book — mint */}
            <rect x="80" y="142" width="100" height="20" rx="3" fill={BB.pinGreen} stroke={BB.ink} strokeWidth="2.5" />
            {/* top book — red */}
            <rect x="88" y="124" width="84" height="20" rx="3" fill={BB.pinRed} stroke={BB.ink} strokeWidth="2.5" />
            {/* apple */}
            <path d="M130 92 C115 92 104 103 104 116 C104 127 113 138 130 138 C147 138 156 127 156 116 C156 103 145 92 130 92 Z"
              fill={BB.pinRed} stroke={BB.ink} strokeWidth="2.5" />
            <path d="M130 92 Q128 82 134 76" stroke="#5E3A1A" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M134 82 Q142 78 146 84 Q140 86 134 84 Z" fill={BB.pinGreen} stroke={BB.ink} strokeWidth="1.5" />
            <ellipse cx="122" cy="104" rx="5" ry="3" fill="#FFFFFF" opacity="0.7" />
          </g>
        )}
        {/* Red pushpin at top-center */}
        <Pushpin cx={130} cy={38} r={16} color={BB.pinRed} id="logo" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — construction-paper letter banner on a jute string
// ═══════════════════════════════════════════════════════════
export function BulletinBoardText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content = (config.content || 'WELCOME').toString();
  const subtitle = config.subtitle || '~ come on in, friends ~';

  // Each letter becomes a square of construction paper in alternating
  // pastels with slightly randomized rotations for a handmade feel.
  const letters = Array.from(content as string).map((ch: string, i: number) => ({
    ch,
    color: [BB.pink, BB.peach, BB.yellow, BB.mint, BB.sky][i % 5],
    // Deterministic pseudo-jitter so render is stable
    rot: ((i * 37) % 7) - 3,
    drop: ((i * 53) % 5) - 2,
  }));

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2% 2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Jute string across top with pushpins at both ends */}
        <div style={{ position: 'relative', flex: !compact && subtitle ? '0 0 72%' : '1 1 100%', minHeight: 0 }}>
          <svg viewBox="0 0 1000 60" width="100%" height="28%" preserveAspectRatio="none"
            style={{ position: 'absolute', top: '2%', left: 0 }}>
            <path d="M 10 14 Q 500 56 990 14" stroke="#8A6A42" strokeWidth="3" fill="none"
              strokeDasharray="6 4" strokeLinecap="round" />
          </svg>
          <svg viewBox="0 0 1000 80" width="100%" height="22%" preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
            <Pushpin cx={18} cy={28} r={14} color={BB.pinRed} id="text-l" />
            <Pushpin cx={982} cy={28} r={14} color={BB.pinBlue} id="text-r" />
          </svg>
          {/* Letters row */}
          <div style={{
            position: 'absolute',
            top: '14%', left: '4%', right: '4%', bottom: '4%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '0.8%',
          }}>
            {letters.map((L, i) => (
              <div key={i} style={{
                flex: '1 1 0',
                minWidth: 0, height: '92%',
                aspectRatio: L.ch === ' ' ? '0.5 / 1' : '1 / 1',
                maxWidth: L.ch === ' ' ? '4%' : '12%',
                background: L.ch === ' ' ? 'transparent' : L.color,
                border: L.ch === ' ' ? 'none' : `2.5px solid ${BB.ink}`,
                borderRadius: 4,
                boxShadow: L.ch === ' ' ? 'none' : `0 ${4 + L.drop}px 8px ${BB.shadow}`,
                transform: `rotate(${L.rot}deg) translateY(${L.drop}px)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
                fontFamily: BB_FONT_DISPLAY,
              }}>
                {L.ch !== ' ' && (
                  <FitText max={220} min={10} wrap={false}
                    style={{ fontWeight: 800, color: BB.ink, letterSpacing: '-0.02em' }}>
                    {L.ch.toUpperCase()}
                  </FitText>
                )}
              </div>
            ))}
          </div>
        </div>
        {!compact && subtitle && (
          <div style={{ flex: '0 0 44%', minHeight: 0, marginTop: '1%' }}>
            <EditableText configKey="subtitle" onConfigChange={onConfigChange}
              max={360} min={10} wrap={false}
              style={{ fontFamily: BB_FONT_SCRIPT, color: BB.ink }}>
              {subtitle}
            </EditableText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — round paper clock face held up with two thumbtacks
// ═══════════════════════════════════════════════════════════
export function BulletinBoardClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  const time = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
  const h24 = parseInt(fmt({ hour: 'numeric', hour12: false }), 10);
  const m = parseInt(fmt({ minute: 'numeric' }), 10);
  const s = parseInt(fmt({ second: 'numeric' }), 10);
  // Standard clock hand angles: 12 = 0°, clockwise.
  const hourDeg = ((h24 % 12) + m / 60) * 30;
  const minDeg  = (m + s / 60) * 6;
  const secDeg  = s * 6;

  return (
    // One unified element: a round paper clock face with tick marks,
    // LIVE analog hands (hour, minute, second), and the digital time
    // tucked into the lower-center of the face. Single pushpin at top.
    // Minimal padding so the clock fills the whole zone at any size.
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 520 520" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Paper clock face */}
          <circle cx="260" cy="260" r="230" fill={BB.paper} stroke={BB.ink} strokeWidth="6" />
          <circle cx="260" cy="260" r="230" fill="none" stroke={BB.corkDark} strokeWidth="1.5" opacity="0.4" />
          {/* 12 tick marks — chunky majors at 12/3/6/9 */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            const r1 = 212;
            const r2 = i % 3 === 0 ? 188 : 200;
            return <line key={i}
              x1={260 + Math.cos(a) * r1} y1={260 + Math.sin(a) * r1}
              x2={260 + Math.cos(a) * r2} y2={260 + Math.sin(a) * r2}
              stroke={BB.ink} strokeWidth={i % 3 === 0 ? 6 : 3} strokeLinecap="round" />;
          })}
          {/* Hour hand — shortest + fattest */}
          <line x1="260" y1="260" x2="260" y2="150"
            stroke={BB.ink} strokeWidth="10" strokeLinecap="round"
            transform={`rotate(${hourDeg} 260 260)`} />
          {/* Minute hand — longer, slimmer */}
          <line x1="260" y1="260" x2="260" y2="110"
            stroke={BB.ink} strokeWidth="6" strokeLinecap="round"
            transform={`rotate(${minDeg} 260 260)`} />
          {/* Second hand — thin red, with a small counterweight tail */}
          <g transform={`rotate(${secDeg} 260 260)`}>
            <line x1="260" y1="280" x2="260" y2="90"
              stroke={BB.pinRed} strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="260" cy="260" r="8" fill={BB.pinRed} stroke={BB.ink} strokeWidth="2" />
          </g>
          {/* Center cap on top of the seconds disc */}
          <circle cx="260" cy="260" r="4" fill={BB.ink} />
          {/* Pushpin at top-center of the paper */}
          <Pushpin cx={260} cy={40} r={22} color={BB.pinRed} id="clk-pin" />
        </svg>
        {/* Digital time written right on the paper — no pill, no
            border, just ink on the clock face below the hands' pivot. */}
        <div style={{
          position: 'absolute',
          inset: '70% 18% 14% 18%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: BB_FONT_DISPLAY,
          pointerEvents: 'none',
        }}>
          <FitText max={120} min={10} wrap={false}
            style={{ fontWeight: 800, color: BB.ink, letterSpacing: '-0.02em' }}>
            {time}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — lined index card held by a red pushpin
// ═══════════════════════════════════════════════════════════
export function BulletinBoardWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  const low = (cond || '').toLowerCase();
  const isSnow = low.includes('snow') || low.includes('flurr');
  const isStorm = low.includes('storm') || low.includes('thunder');
  const isRain = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));

  // Big, bold cloud/sun/rain/snow/storm illustration centered in the
  // upper half of the card. Temp dominates the lower half. The earlier
  // layout tucked a tiny weather icon in the top-right corner of a
  // ruled index card — it was nearly invisible at preview scale, so
  // kids couldn't tell whether it was sunny or stormy at a glance.
  const W_CLOUD = "M-120 30 Q-160 30 -160 0 Q-160 -40 -120 -40 Q-105 -80 -55 -80 Q0 -110 55 -80 Q110 -85 130 -30 Q170 -30 170 10 Q170 50 130 50 L-110 50 Q-120 50 -120 30 Z";
  const Illus = isStorm ? (
    <g transform="translate(350 180)">
      <path d={W_CLOUD} fill="#CDD3DE" stroke={BB.ink} strokeWidth="5" />
      <path d="M0 60 L50 60 L20 130 L70 130 L-30 220 L10 130 L-20 130 Z"
        fill={BB.pinYellow} stroke={BB.ink} strokeWidth="4" strokeLinejoin="round" />
    </g>
  ) : isSnow ? (
    <g transform="translate(350 180)">
      <path d={W_CLOUD} fill="#E6EBF2" stroke={BB.ink} strokeWidth="5" />
      <g stroke={BB.pinBlue} strokeWidth="5" strokeLinecap="round">
        {[[-60, 110], [0, 140], [60, 110], [-30, 170], [30, 170]].map(([x, y], i) => (
          <g key={i}>
            <line x1={x - 16} y1={y} x2={x + 16} y2={y} />
            <line x1={x} y1={y - 16} x2={x} y2={y + 16} />
            <line x1={x - 11} y1={y - 11} x2={x + 11} y2={y + 11} />
            <line x1={x - 11} y1={y + 11} x2={x + 11} y2={y - 11} />
          </g>
        ))}
      </g>
    </g>
  ) : isRain ? (
    <g transform="translate(350 180)">
      <path d={W_CLOUD} fill={BB.paper} stroke={BB.ink} strokeWidth="5" />
      <g fill={BB.pinBlue} stroke={BB.ink} strokeWidth="2">
        <ellipse cx="-50" cy="120" rx="10" ry="18" />
        <ellipse cx="-10" cy="150" rx="10" ry="18" />
        <ellipse cx="35" cy="120" rx="10" ry="18" />
        <ellipse cx="75" cy="150" rx="10" ry="18" />
      </g>
    </g>
  ) : isOvercast ? (
    <g transform="translate(350 180)">
      <path d={W_CLOUD} fill="#D8DDE8" stroke={BB.ink} strokeWidth="5" />
      <path d={W_CLOUD} transform="translate(-30 40) scale(0.75)"
        fill="#C1C7D4" stroke={BB.ink} strokeWidth="4" />
    </g>
  ) : (
    // Sunny default — big happy sun
    <g transform="translate(350 185)">
      <g stroke={BB.pinYellow} strokeWidth="10" strokeLinecap="round">
        <line x1="0" y1="-130" x2="0" y2="-95" />
        <line x1="92" y1="-92" x2="67" y2="-67" />
        <line x1="130" y1="0" x2="95" y2="0" />
        <line x1="92" y1="92" x2="67" y2="67" />
        <line x1="0" y1="130" x2="0" y2="95" />
        <line x1="-92" y1="92" x2="-67" y2="67" />
        <line x1="-130" y1="0" x2="-95" y2="0" />
        <line x1="-92" y1="-92" x2="-67" y2="-67" />
      </g>
      <circle cx="0" cy="0" r="68" fill={BB.pinYellow} stroke={BB.ink} strokeWidth="5" />
      <circle cx="-22" cy="-8" r="6" fill={BB.ink} />
      <circle cx="22" cy="-8" r="6" fill={BB.ink} />
      <path d="M -22 18 Q 0 38 22 18" stroke={BB.ink} strokeWidth="5" fill="none" strokeLinecap="round" />
      <ellipse cx="-34" cy="12" rx="8" ry="4" fill="#FFB3BA" opacity="0.6" />
      <ellipse cx="34" cy="12" rx="8" ry="4" fill="#FFB3BA" opacity="0.6" />
    </g>
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 500" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Index-card paper base — stretches with the zone so text
              always matches the visible card. */}
          <rect x="10" y="40" width="680" height="440" rx="8" fill={BB.paper}
            stroke={BB.ink} strokeWidth="4" vectorEffect="non-scaling-stroke" />
          {/* Red top rule + pink left margin — decorative but subtle at
              any aspect. */}
          <line x1="10" y1="90" x2="690" y2="90" stroke={BB.pinRed} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <line x1="60" y1="40" x2="60" y2="480" stroke={BB.pinRed} strokeWidth="2" opacity="0.5" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* The weather illustration rides in a PROPORTIONED inner SVG
            so the cloud/sun never stretches even when the card does. */}
        <svg viewBox="0 0 700 500" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {Illus}
          <Pushpin cx={350} cy={60} r={18} color={BB.pinRed} id="wx" />
        </svg>
        {/* Temp (bottom-center, prominent) + condition label below */}
        <div style={{
          position: 'absolute',
          top: '58%', left: '6%', right: '6%', bottom: '6%',
          display: 'flex', flexDirection: 'column',
          fontFamily: BB_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 68%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={320} min={12} wrap={false}
              style={{ fontWeight: 800, color: BB.ink, letterSpacing: '-0.02em' }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 32%', minHeight: 0 }}>
              <FitText max={110} min={9} wrap={false}
                style={{ fontFamily: BB_FONT_SCRIPT, color: BB.pinRed }}>
                {cond}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — torn-paper banner with dangling ribbon tails
// ═══════════════════════════════════════════════════════════
export function BulletinBoardCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 12 * 86400000);
  const label = (config.label || resolved?.prefix || 'Event In').toUpperCase();
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const bigNum = days > 0 ? days : hours;
  const unit = days > 0 ? (days === 1 ? 'DAY!' : 'DAYS!') : (hours === 1 ? 'HR!' : 'HRS!');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Torn-paper banner body. Irregular edges made from polyline. */}
          <path d="M80 120
            L120 108 L160 122 L200 110 L240 124 L280 112 L320 122 L360 110 L400 122 L440 112 L480 122 L520 110 L560 122 L600 112 L620 120
            L620 520
            L598 510 L560 524 L520 510 L480 524 L440 510 L400 524 L360 510 L320 524 L280 510 L240 524 L200 510 L160 524 L120 510 L80 520
            Z"
            fill={BB.peach} stroke={BB.ink} strokeWidth="4" strokeLinejoin="round" />
          {/* Inner highlight strip */}
          <rect x="98" y="148" width="504" height="10" fill={BB.pinRed} opacity="0.35" />
          <rect x="98" y="490" width="504" height="10" fill={BB.pinRed} opacity="0.35" />
          {/* Ribbon tails below */}
          <polygon points="200,520 180,640 215,610 235,535" fill={BB.pinRed} stroke={BB.ink} strokeWidth="3" />
          <polygon points="500,520 520,640 485,610 465,535" fill={BB.pinBlue} stroke={BB.ink} strokeWidth="3" />
          {/* Yellow pushpin at top-center */}
          <Pushpin cx={350} cy={118} r={18} color={BB.pinYellow} id="cd" />
        </svg>
        {/* Text content — label + big number + unit */}
        <div style={{
          position: 'absolute',
          inset: '22% 14% 28% 14%',
          display: 'flex', flexDirection: 'column',
          fontFamily: BB_FONT_DISPLAY, color: BB.ink,
          textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 22%', minHeight: 0 }}>
            <EditableText configKey="label" onConfigChange={onConfigChange}
              max={80} min={8} wrap={false}
              style={{ fontWeight: 800, color: BB.pinRed, letterSpacing: '0.04em' }}>
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 54%', minHeight: 0 }}>
            <FitText max={320} min={24} wrap={false}
              style={{ fontWeight: 800, color: BB.ink }}>
              {bigNum}
            </FitText>
          </div>
          <div style={{ flex: '0 0 24%', minHeight: 0 }}>
            <FitText max={90} min={8} wrap={false}
              style={{ fontFamily: BB_FONT_SCRIPT, color: BB.pinBlue }}>
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — lined index card pinned with two blue pushpins
// ═══════════════════════════════════════════════════════════
export function BulletinBoardAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const message = config.message || config.body || 'The Book Fair opens today — bring your list!';
  const date = config.date || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 1800 500" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Card body, slight rotation (-1.5deg) */}
          <g transform="rotate(-1.5 900 250)">
            <rect x="40" y="40" width="1720" height="420" rx="8" fill={BB.paper}
              stroke={BB.ink} strokeWidth="4" vectorEffect="non-scaling-stroke" />
            {/* Red header rule */}
            <line x1="40" y1="100" x2="1760" y2="100" stroke={BB.pinRed} strokeWidth="3" vectorEffect="non-scaling-stroke" />
            {/* Blue ruled lines */}
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={i} x1="40" y1={160 + i * 50} x2="1760" y2={160 + i * 50}
                stroke={BB.paperRule} strokeWidth="1.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
            ))}
            {/* Left margin vertical */}
            <line x1="140" y1="40" x2="140" y2="460" stroke={BB.pinRed} strokeWidth="2" opacity="0.55" vectorEffect="non-scaling-stroke" />
          </g>
          {/* Two blue pushpins across top */}
          <Pushpin cx={280} cy={60} r={18} color={BB.pinBlue} id="ann-l" />
          <Pushpin cx={1520} cy={60} r={18} color={BB.pinBlue} id="ann-r" />
        </svg>
        {/* Text overlay rotates with the paper card. The SVG card rotates
            -1.5° around its center (900,250) which, in a zone that's
            ~47% tall, maps to the zone's center (50%,50%). Applying the
            same rotation to the text overlay with the same transform-
            origin makes the text ride along with the paper instead of
            sitting flat on top of it. */}
        <div style={{
          position: 'absolute',
          top: '12%', left: '9%', right: '5%', bottom: '10%',
          display: 'flex', flexDirection: 'column',
          fontFamily: BB_FONT_DISPLAY,
          transform: 'rotate(-1.5deg)',
          transformOrigin: 'center center',
        }}>
          <div style={{ flex: !compact && date ? '1 1 80%' : '1 1 100%', minHeight: 0 }}>
            <EditableText configKey="message" onConfigChange={onConfigChange}
              max={280} min={12}
              style={{ fontWeight: 700, color: BB.ink, letterSpacing: '0.005em' }}>
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 20%', minHeight: 0 }}>
              <FitText max={110} min={10} wrap={false}
                style={{ fontFamily: BB_FONT_SCRIPT, color: BB.pinRed }}>
                {date}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — stack of 3 rotated sticky notes with tape
// ═══════════════════════════════════════════════════════════
export function BulletinBoardCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'MON · 8:30am', title: 'Pajama Day Reading Hour' },
    { date: 'WED · 10am',   title: "Principal's Story Time" },
    { date: 'APR 30',       title: 'Field Trip — THE ZOO!' },
  ]).slice(0, Math.max(1, Math.min(12, config.maxEvents ?? 3)));

  const stickies = [
    { bg: BB.yellow, rot: -2 },
    { bg: BB.pink,   rot: +3 },
    { bg: BB.mint,   rot: -1 },
  ];

  return (
    // Horizontal row so each sticky renders nearly square. The old
    // vertical stack forced each note to a 10:1 aspect — at that shape,
    // any rotation clipped at the zone edge and the notes looked like
    // trapezoids. Side-by-side keeps them Post-it-proportioned.
    <div className="absolute inset-0 flex items-stretch justify-center" style={{ padding: '6% 4%', gap: '3%' }}>
      {events.map((e: any, i: number) => {
        const s = stickies[i % stickies.length];
        return (
          <div key={i} style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            background: s.bg,
            border: `3px solid ${BB.ink}`,
            borderRadius: 6,
            boxShadow: `0 10px 18px ${BB.shadow}`,
            transform: `rotate(${s.rot}deg)`,
            padding: '8% 6% 6% 6%',
            display: 'flex', flexDirection: 'column',
            fontFamily: BB_FONT_DISPLAY,
          }}>
            {/* Tape strip at top — proportioned for a square-ish note */}
            <div style={{
              position: 'absolute',
              top: '-5%', left: '32%', width: '36%', height: '12%',
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(90,60,30,0.25)',
              boxShadow: `0 2px 4px ${BB.shadow}`,
              transform: 'rotate(-2deg)',
            }} />
            {/* Corner fold shadow */}
            <div style={{
              position: 'absolute',
              bottom: 0, right: 0,
              width: '18%', aspectRatio: '1 / 1',
              background: `linear-gradient(135deg, transparent 50%, ${BB.shadow} 50%)`,
              pointerEvents: 'none',
            }} />
            <div style={{ flex: '0 0 38%', minHeight: 0, marginBottom: '4%' }}>
              <FitText max={320} min={8} wrap={false}
                style={{ fontFamily: BB_FONT_SCRIPT, color: BB.pinRed }}>
                {e.date}
              </FitText>
            </div>
            <div style={{ flex: '1 1 auto', minHeight: 0 }}>
              <FitText max={280} min={10}
                style={{ fontWeight: 700, color: BB.ink }}>
                {e.title}
              </FitText>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — polaroid with black tape corner
// ═══════════════════════════════════════════════════════════
export function BulletinBoardStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || config.name || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center"
      style={{ padding: '5%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '92%', height: '94%',
        background: BB.paper,
        border: `3px solid ${BB.ink}`,
        boxShadow: `0 18px 32px ${BB.shadow}`,
        transform: 'rotate(-3deg)',
        padding: '4% 4% 2% 4%',
        display: 'flex', flexDirection: 'column',
        fontFamily: BB_FONT_DISPLAY,
      }}>
        {/* Black tape across top-right corner */}
        <div style={{
          position: 'absolute',
          top: '-4%', right: '-4%', width: '36%', height: '14%',
          background: 'rgba(40,32,28,0.85)',
          border: `1px solid ${BB.ink}`,
          transform: 'rotate(28deg)',
          boxShadow: `0 3px 6px ${BB.shadow}`,
        }} />
        {/* Photo area */}
        <div style={{
          flex: '1 1 78%', minHeight: 0,
          background: BB.sky,
          border: `2px solid ${BB.ink}`,
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg viewBox="0 0 200 200" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
              {/* default cartoon teacher portrait */}
              <rect width="200" height="200" fill={BB.sky} />
              {/* shoulders */}
              <path d="M30 200 Q30 140 100 140 Q170 140 170 200 Z" fill={BB.pinRed} stroke={BB.ink} strokeWidth="3" />
              {/* neck */}
              <rect x="88" y="120" width="24" height="24" fill="#F5CBA0" stroke={BB.ink} strokeWidth="2" />
              {/* face */}
              <ellipse cx="100" cy="95" rx="42" ry="46" fill="#F5CBA0" stroke={BB.ink} strokeWidth="3" />
              {/* hair */}
              <path d="M58 88 Q58 48 100 48 Q142 48 142 88 Q142 70 128 64 Q110 62 100 66 Q85 62 72 66 Q60 72 58 88 Z"
                fill="#6B4226" stroke={BB.ink} strokeWidth="2.5" />
              {/* glasses */}
              <circle cx="85" cy="96" r="10" fill="none" stroke={BB.ink} strokeWidth="2.5" />
              <circle cx="115" cy="96" r="10" fill="none" stroke={BB.ink} strokeWidth="2.5" />
              <line x1="95" y1="96" x2="105" y2="96" stroke={BB.ink} strokeWidth="2.5" />
              {/* eyes */}
              <circle cx="85" cy="96" r="2" fill={BB.ink} />
              <circle cx="115" cy="96" r="2" fill={BB.ink} />
              {/* blush */}
              <ellipse cx="76" cy="108" rx="5" ry="3" fill={BB.pink} opacity="0.7" />
              <ellipse cx="124" cy="108" rx="5" ry="3" fill={BB.pink} opacity="0.7" />
              {/* smile */}
              <path d="M88 118 Q100 128 112 118" stroke={BB.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </div>
        {/* Handwritten name + role below photo */}
        <div style={{
          flex: '0 0 22%', minHeight: 0,
          marginTop: '3%',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: '1 1 60%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={160} min={10} wrap={false}
              style={{ fontFamily: BB_FONT_SCRIPT, color: BB.ink, fontWeight: 600 }}>
              {name}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 40%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={70} min={8} wrap={false}
              style={{ fontFamily: BB_FONT_SCRIPT, color: BB.pinRed }}>
              {role}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — photo pinned with four pushpins
// ═══════════════════════════════════════════════════════════
export function BulletinBoardImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0 ? config.urls : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center"
      style={{ padding: '5%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
      }}>
        {/* Photo */}
        <div style={{
          position: 'absolute', inset: 0,
          background: BB.paper,
          border: `3px solid ${BB.ink}`,
          boxShadow: `0 16px 28px ${BB.shadow}`,
          overflow: 'hidden',
        }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Gallery"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: BB.paper,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: BB_FONT_SCRIPT, color: BB.ink,
              textAlign: 'center', padding: '6%',
              gap: '4%',
            }}>
              {/* cartoon pushpin illustration */}
              <svg viewBox="0 0 120 120" width="32%" height="32%" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <radialGradient id="ic-pin" cx="35%" cy="30%" r="70%">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
                    <stop offset="35%" stopColor={BB.pinRed} />
                    <stop offset="100%" stopColor={BB.ink} stopOpacity="0.7" />
                  </radialGradient>
                </defs>
                <line x1="60" y1="58" x2="60" y2="108" stroke="#888" strokeWidth="5" strokeLinecap="round" />
                <circle cx="60" cy="40" r="30" fill="url(#ic-pin)" stroke={BB.ink} strokeWidth="2.5" />
                <ellipse cx="50" cy="30" rx="8" ry="5" fill="#FFFFFF" opacity="0.7" />
              </svg>
              <div style={{ width: '100%' }}>
                <FitText max={90} min={10} wrap={false}
                  style={{ fontFamily: BB_FONT_SCRIPT, color: BB.ink }}>
                  Pin your photos here
                </FitText>
              </div>
            </div>
          )}
        </div>
        {/* Four pushpins, one per corner */}
        <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <g style={{ filter: PIN_SHADOW }}>
            <Pushpin cx={6} cy={6} r={4} color={BB.pinRed} id="ic-tl" />
            <Pushpin cx={94} cy={6} r={4} color={BB.pinYellow} id="ic-tr" />
            <Pushpin cx={6} cy={94} r={4} color={BB.pinGreen} id="ic-bl" />
            <Pushpin cx={94} cy={94} r={4} color={BB.pinBlue} id="ic-br" />
          </g>
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — scalloped paper strip banner taped across
// ═══════════════════════════════════════════════════════════
export function BulletinBoardTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length ? config.messages : ['★ Lost & Found cleanout Friday ★'];
  const speed = (config.speed as string) || 'medium';
  const secs = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);
  const primary = messages[idx % messages.length];

  return (
    <div className="absolute inset-0" style={{ overflow: 'visible' }}>
      <svg viewBox="0 0 2000 220" width="100%" height="100%" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, filter: PAPER_SHADOW, overflow: 'visible' }}>
        {/* Scalloped paper strip — wavy top and bottom */}
        <path d="
          M 0 40
          Q 50 10  100 40 T 200 40 T 300 40 T 400 40 T 500 40 T 600 40 T 700 40 T 800 40 T 900 40 T 1000 40
          T 1100 40 T 1200 40 T 1300 40 T 1400 40 T 1500 40 T 1600 40 T 1700 40 T 1800 40 T 1900 40 T 2000 40
          L 2000 180
          Q 1950 210 1900 180 T 1800 180 T 1700 180 T 1600 180 T 1500 180 T 1400 180 T 1300 180 T 1200 180 T 1100 180 T 1000 180
          T 900 180 T 800 180 T 700 180 T 600 180 T 500 180 T 400 180 T 300 180 T 200 180 T 100 180 T 0 180
          Z"
          fill={BB.yellow} stroke={BB.ink} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {/* Tape on both ends */}
        <rect x="-10" y="60" width="120" height="40" fill="rgba(255,255,255,0.55)"
          stroke="rgba(90,60,30,0.4)" strokeWidth="1" transform="rotate(-8 50 80)" />
        <rect x="1890" y="60" width="120" height="40" fill="rgba(255,255,255,0.55)"
          stroke="rgba(90,60,30,0.4)" strokeWidth="1" transform="rotate(8 1950 80)" />
      </svg>
      {/* Message overlay */}
      <div style={{
        position: 'absolute',
        inset: '18% 8% 18% 8%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: BB_FONT_DISPLAY,
      }}>
        <FitText max={compact ? 80 : 160} min={10} wrap={false}
          style={{ fontWeight: 800, color: BB.ink, letterSpacing: '0.01em' }}>
          {primary}
        </FitText>
      </div>
    </div>
  );
}
