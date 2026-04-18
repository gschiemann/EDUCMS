"use client";

/**
 * Scrapbook — elementary school lobby theme.
 * "Teacher's personal scrapbook": pastel-striped bg, polaroids at angles,
 * washi tape, handwritten labels, paper clips, spiral-notebook edges, doodle frames.
 *
 * Widgets:
 *   LOGO             → round paper crest with polaroid-tape accents
 *   TEXT / RICH_TEXT → washi-tape header on a torn paper strip
 *   CLOCK            → wall-clock polaroid with live analog hands + digital
 *   WEATHER          → parchment card with 6 condition-aware doodle illustrations
 *   COUNTDOWN        → ticket stub with big number + torn edge
 *   ANNOUNCEMENT     → lined notebook page taped to scrapbook
 *   CALENDAR         → 3 overlapping index cards at slight rotations
 *   STAFF_SPOTLIGHT  → classic polaroid + handwriting below
 *   IMAGE_CAROUSEL   → polaroid frame with four corner washi tapes
 *   TICKER           → paper strip with a paperclip at each end
 */

import { useEffect, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ─── Palette ────────────────────────────────────────────────
export const SC = {
  paper:      '#FFF8E7',
  paperBlush: '#FBE8DA',
  paperMint:  '#E0F5E1',
  washiPink:  '#FF9FB0',
  washiBlue:  '#80BCFF',
  washiYellow:'#FFD66E',
  washiPurple:'#C39BFF',
  ink:        '#3A2E2A',
  inkLight:   '#7B6B5F',
  accent:     '#E8536B',
  pencil:     '#8B7765',
  shadow:     'rgba(90,60,30,0.25)',
};

export const SC_FONT_DISPLAY = "'Caveat', cursive";
export const SC_FONT_BODY    = "'Fredoka', ui-rounded, system-ui, sans-serif";
export const SC_FONT_PRINT   = "'Patrick Hand', system-ui, sans-serif";

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Washi tape strip helper ──────────────────────────────────
function WashiTape({
  color, width = '30%', height = '12%', left, right, top, bottom, rotate = 0,
}: {
  color: string; width?: string; height?: string;
  left?: string; right?: string; top?: string; bottom?: string; rotate?: number;
}) {
  return (
    <div style={{
      position: 'absolute',
      left, right, top, bottom,
      width, height,
      background: `repeating-linear-gradient(
        90deg,
        ${color}cc 0 6%,
        ${color}88 6% 12%
      )`,
      border: `1.5px solid ${color}`,
      borderRadius: 3,
      transform: `rotate(${rotate}deg)`,
      transformOrigin: 'center center',
      boxShadow: `0 2px 4px ${SC.shadow}`,
      zIndex: 10,
    }} />
  );
}

// ─── Paper clip helper ────────────────────────────────────────
function PaperClip({ left, right, top, rotate = 0 }: { left?: string; right?: string; top?: string; rotate?: number }) {
  return (
    <svg
      width="28" height="52"
      viewBox="0 0 28 52"
      style={{
        position: 'absolute',
        left, right, top,
        transform: `rotate(${rotate}deg)`,
        transformOrigin: 'center center',
        zIndex: 12,
        filter: `drop-shadow(1px 2px 2px ${SC.shadow})`,
      }}
    >
      {/* outer loop */}
      <path d="M14 4 C6 4 2 9 2 16 L2 40 C2 46 7 50 14 50 C21 50 26 46 26 40 L26 14"
        fill="none" stroke="#A0A0A0" strokeWidth="3.5" strokeLinecap="round" />
      {/* inner loop */}
      <path d="M14 12 C9 12 7 15 7 20 L7 38 C7 43 10 46 14 46 C18 46 21 43 21 38 L21 18"
        fill="none" stroke="#C0C0C0" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// LOGO — round paper crest + polaroid-tape accents
// ═══════════════════════════════════════════════════════════
export function ScrapbookLogo({ config }: { config: any; compact?: boolean }) {
  const initials = config.initials ||
    (config.schoolName || 'EDU').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Polaroid-tape strips across the top corners */}
        <WashiTape color={SC.washiPink}  width="28%" height="10%" left="4%"  top="-2%" rotate={-8} />
        <WashiTape color={SC.washiBlue}  width="28%" height="10%" right="4%" top="-2%" rotate={7}  />

        {/* Main paper crest circle */}
        <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: `drop-shadow(0 6px 12px ${SC.shadow})`, position: 'absolute', inset: 0 }}>
          {/* Outer doodle frame — hand-drawn style with offset strokes */}
          <circle cx="130" cy="130" r="118" fill={SC.paperBlush} stroke={SC.ink} strokeWidth="5" strokeDasharray="8 3" />
          <circle cx="130" cy="130" r="108" fill={SC.paper}      stroke={SC.pencil} strokeWidth="2" />

          {/* Star stickers around edge */}
          {[0, 60, 120, 180, 240, 300].map((deg, i) => {
            const rad = (deg - 90) * Math.PI / 180;
            const x = 130 + Math.cos(rad) * 96;
            const y = 130 + Math.sin(rad) * 96;
            const star = [SC.washiPink, SC.washiYellow, SC.washiBlue, SC.washiPurple, SC.accent, SC.washiYellow][i];
            return (
              <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                fontSize="14" fill={star} transform={`rotate(${deg}, ${x}, ${y})`}>★</text>
            );
          })}

          {/* Inner content */}
          {photoUrl ? (
            <>
              <defs>
                <clipPath id="sc-logo-clip">
                  <circle cx="130" cy="130" r="72" />
                </clipPath>
              </defs>
              <image href={resolveUrl(photoUrl)} x="58" y="58" width="144" height="144"
                preserveAspectRatio="xMidYMid slice" clipPath="url(#sc-logo-clip)" />
            </>
          ) : (
            <g>
              {/* Pencil doodle apple */}
              <ellipse cx="130" cy="138" rx="38" ry="36" fill={SC.accent} stroke={SC.ink} strokeWidth="3" />
              <path d="M130 102 Q138 88 148 90 Q140 96 130 102Z" fill={SC.paperMint} stroke={SC.ink} strokeWidth="2" />
              <path d="M130 102 Q124 92 118 96" fill="none" stroke={SC.ink} strokeWidth="2" strokeLinecap="round" />
              <ellipse cx="120" cy="130" rx="6" ry="8" fill="rgba(255,255,255,0.3)" />
            </g>
          )}

          {/* Initials badge at bottom */}
          <rect x="96" y="186" width="68" height="28" rx="14" fill={SC.washiYellow} stroke={SC.ink} strokeWidth="3" />
          <text x="130" y="205" textAnchor="middle" dominantBaseline="middle"
            fontSize="14" fontFamily={SC_FONT_DISPLAY} fontWeight="bold" fill={SC.ink}>
            {initials}
          </text>
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — washi-tape header on a torn paper strip
// ═══════════════════════════════════════════════════════════
export function ScrapbookText({ config, compact, onConfigChange }: {
  config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void;
}) {
  const content  = config.content  || 'Good Morning, Sunshine!';
  const subtitle = config.subtitle || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4% 3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>

        {/* Torn paper strip background (SVG) */}
        <svg viewBox="0 0 2000 380" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 8px 16px ${SC.shadow})` }}>
          {/* Pastel stripe body */}
          <rect x="0" y="20" width="2000" height="320" fill={SC.paper} />
          {/* Washi tape across top */}
          <rect x="0" y="12" width="2000" height="28" fill={`${SC.washiPink}cc`} />
          {/* Torn bottom edge */}
          <path d="M0 340 Q80 360 160 338 Q240 318 320 342 Q400 362 480 336 Q560 312 640 340 Q720 364 800 336 Q880 312 960 340 Q1040 364 1120 338 Q1200 314 1280 342 Q1360 366 1440 338 Q1520 314 1600 342 Q1680 366 1760 336 Q1840 312 2000 344 L2000 380 L0 380 Z"
            fill={SC.paperBlush} />
          {/* Arrow doodles */}
          <path d="M60 60 Q90 30 120 60" fill="none" stroke={SC.pencil} strokeWidth="4" strokeLinecap="round" />
          <polygon points="120,60 108,48 126,48" fill={SC.pencil} />
          <path d="M1880 60 Q1910 30 1940 60" fill="none" stroke={SC.pencil} strokeWidth="4" strokeLinecap="round" />
          <polygon points="1940,60 1928,48 1946,48" fill={SC.pencil} />
          {/* Pin at top-left */}
          <circle cx="80" cy="8" r="10" fill={SC.accent} stroke={SC.ink} strokeWidth="2" />
          <circle cx="80" cy="8" r="4"  fill={SC.paper} />
        </svg>

        {/* Text overlay */}
        <div style={{
          position: 'absolute',
          top: '10%', left: '6%', right: '6%',
          bottom: subtitle && !compact ? '30%' : '18%',
        }}>
          <EditableText
            configKey="content" onConfigChange={onConfigChange}
            max={220} min={12} wrap={false}
            style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 700, color: SC.ink,
              textShadow: `1px 1px 0 ${SC.paperBlush}` }}
          >
            {content}
          </EditableText>
        </div>

        {subtitle && !compact && (
          <div style={{ position: 'absolute', bottom: '16%', left: '8%', right: '8%', height: '18%' }}>
            <EditableText
              configKey="subtitle" onConfigChange={onConfigChange}
              max={120} min={9} wrap={false}
              style={{ fontFamily: SC_FONT_PRINT, color: SC.inkLight }}
            >
              {subtitle}
            </EditableText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — wall clock polaroid with live analog hands + digital
// ═══════════════════════════════════════════════════════════
export function ScrapbookClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz  = config.timezone || undefined;
  const fmt  = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  const time = fmt.format(now);

  // Compute hand angles
  const s  = now.getSeconds();
  const m  = now.getMinutes() + s / 60;
  const h  = (now.getHours() % 12) + m / 60;
  const sdeg = s * 6;
  const mdeg = m * 6;
  const hdeg = h * 30;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {/* Polaroid frame */}
        <div style={{
          position: 'relative',
          width: '88%',
          flex: compact ? '1' : '0 0 76%',
          background: SC.paper,
          border: `5px solid ${SC.paper}`,
          borderRadius: 6,
          boxShadow: `0 8px 20px ${SC.shadow}, 0 2px 4px rgba(0,0,0,0.1)`,
          transform: 'rotate(-2deg)',
          transformOrigin: 'center center',
          padding: '3% 3% 0 3%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Washi tape across top of polaroid */}
          <WashiTape color={SC.washiYellow} width="40%" height="14%" left="30%" top="-7%" rotate={1} />

          {/* Clock face SVG */}
          <svg viewBox="0 0 220 220" width="90%" style={{ display: 'block' }}>
            {/* Face */}
            <circle cx="110" cy="110" r="100" fill={SC.paperBlush} stroke={SC.ink} strokeWidth="4" />
            <circle cx="110" cy="110" r="94"  fill="none"          stroke={SC.pencil} strokeWidth="1" strokeDasharray="3 3" />

            {/* Hour markers */}
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * 30 - 90) * Math.PI / 180;
              const inner = i % 3 === 0 ? 72 : 80;
              const outer = 92;
              return (
                <line key={i}
                  x1={110 + Math.cos(a) * inner}
                  y1={110 + Math.sin(a) * inner}
                  x2={110 + Math.cos(a) * outer}
                  y2={110 + Math.sin(a) * outer}
                  stroke={i % 3 === 0 ? SC.ink : SC.pencil}
                  strokeWidth={i % 3 === 0 ? 3 : 1.5}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Hour hand */}
            <line
              x1="110" y1="110"
              x2={110 + Math.cos((hdeg - 90) * Math.PI / 180) * 54}
              y2={110 + Math.sin((hdeg - 90) * Math.PI / 180) * 54}
              stroke={SC.ink} strokeWidth="5" strokeLinecap="round"
            />
            {/* Minute hand */}
            <line
              x1="110" y1="110"
              x2={110 + Math.cos((mdeg - 90) * Math.PI / 180) * 78}
              y2={110 + Math.sin((mdeg - 90) * Math.PI / 180) * 78}
              stroke={SC.ink} strokeWidth="3.5" strokeLinecap="round"
            />
            {/* Second hand */}
            <line
              x1="110" y1="110"
              x2={110 + Math.cos((sdeg - 90) * Math.PI / 180) * 84}
              y2={110 + Math.sin((sdeg - 90) * Math.PI / 180) * 84}
              stroke={SC.accent} strokeWidth="2" strokeLinecap="round"
            />
            {/* Center dot */}
            <circle cx="110" cy="110" r="6" fill={SC.ink} />
            <circle cx="110" cy="110" r="3" fill={SC.accent} />

            {/* Doodle star at 12 */}
            <text x="110" y="24" textAnchor="middle" fontSize="12" fill={SC.washiPink}>★</text>
          </svg>
        </div>

        {/* Digital time below polaroid — handwritten label */}
        {!compact && (
          <div style={{
            flex: '1 1 0', minHeight: 0,
            width: '88%',
            background: SC.paper,
            transform: 'rotate(1deg)',
            transformOrigin: 'center center',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1% 4%',
          }}>
            <FitText max={100} min={10} wrap={false}
              style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 700, color: SC.ink }}>
              {time}
            </FitText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — parchment card with 6 condition-aware doodle illustrations
// ═══════════════════════════════════════════════════════════
export function ScrapbookWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);

  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');
  const low  = (cond || '').toLowerCase();

  const isSnow    = low.includes('snow')    || low.includes('flurr');
  const isStorm   = low.includes('storm')   || low.includes('thunder');
  const isRain    = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear   = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  const isPartly  = !isClear && !isOvercast && !isRain && !isSnow && !isStorm;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: SC.paperBlush,
        borderRadius: 8,
        border: `3px solid ${SC.pencil}`,
        boxShadow: `0 8px 20px ${SC.shadow}`,
        transform: 'rotate(1deg)',
        transformOrigin: 'center center',
        padding: '4%',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Washi tape corner */}
        <WashiTape color={SC.washiBlue} width="24%" height="10%" left="38%" top="-5%" rotate={0} />

        {/* Doodle illustration */}
        <div style={{ flex: '0 0 58%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 200 160" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
            {/* CLEAR — big hand-drawn sun */}
            {isClear && (
              <g>
                <circle cx="100" cy="80" r="42" fill={SC.washiYellow} stroke={SC.ink} strokeWidth="3" />
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
                  const r = (deg - 90) * Math.PI / 180;
                  return <line key={i}
                    x1={100 + Math.cos(r) * 50} y1={80 + Math.sin(r) * 50}
                    x2={100 + Math.cos(r) * 64} y2={80 + Math.sin(r) * 64}
                    stroke={SC.washiYellow} strokeWidth="4" strokeLinecap="round" />;
                })}
                <circle cx="88"  cy="72" r="5" fill={SC.ink} />
                <circle cx="112" cy="72" r="5" fill={SC.ink} />
                <path d="M84 95 Q100 110 116 95" fill="none" stroke={SC.ink} strokeWidth="3" strokeLinecap="round" />
                <ellipse cx="80" cy="90" rx="6" ry="3" fill={SC.washiPink} opacity="0.7" />
                <ellipse cx="120" cy="90" rx="6" ry="3" fill={SC.washiPink} opacity="0.7" />
              </g>
            )}
            {/* PARTLY — sun peeking behind a cloud */}
            {isPartly && (
              <g>
                <circle cx="130" cy="55" r="32" fill={SC.washiYellow} stroke={SC.pencil} strokeWidth="2" />
                {[225, 270, 315].map((deg, i) => {
                  const r = (deg - 90) * Math.PI / 180;
                  return <line key={i}
                    x1={130 + Math.cos(r) * 38} y1={55 + Math.sin(r) * 38}
                    x2={130 + Math.cos(r) * 48} y2={55 + Math.sin(r) * 48}
                    stroke={SC.washiYellow} strokeWidth="3" strokeLinecap="round" />;
                })}
                <path d="M40 110 Q32 110 32 94 Q32 78 48 78 Q52 56 72 56 Q88 46 104 58 Q118 44 134 60 Q148 60 152 76 Q164 76 164 98 Q164 116 148 116 L56 116 Q40 116 40 110Z"
                  fill={SC.paper} stroke={SC.ink} strokeWidth="3" />
              </g>
            )}
            {/* OVERCAST — grey doodle cloud */}
            {isOvercast && (
              <path d="M40 110 Q32 110 32 94 Q32 78 48 78 Q52 56 72 56 Q88 46 104 58 Q118 44 134 60 Q148 60 152 76 Q164 76 164 98 Q164 116 148 116 L56 116 Q40 116 40 110Z"
                fill="#D8D0C8" stroke={SC.ink} strokeWidth="3" />
            )}
            {/* RAIN — cloud + doodle raindrops */}
            {isRain && (
              <g>
                <path d="M40 90 Q32 90 32 74 Q32 58 48 58 Q52 36 72 36 Q88 26 104 38 Q118 24 134 40 Q148 40 152 56 Q164 56 164 78 Q164 96 148 96 L56 96 Q40 96 40 90Z"
                  fill={SC.paper} stroke={SC.ink} strokeWidth="3" />
                {[[60, 108, -10], [90, 118, 5], [120, 112, -5], [150, 120, 10]].map(([x, y, r], i) => (
                  <ellipse key={i} cx={x} cy={y} rx="5" ry="10"
                    fill={SC.washiBlue} stroke={SC.ink} strokeWidth="1.5"
                    transform={`rotate(${r}, ${x}, ${y})`} />
                ))}
              </g>
            )}
            {/* SNOW — cloud + snowflakes */}
            {isSnow && (
              <g>
                <path d="M40 90 Q32 90 32 74 Q32 58 48 58 Q52 36 72 36 Q88 26 104 38 Q118 24 134 40 Q148 40 152 56 Q164 56 164 78 Q164 96 148 96 L56 96 Q40 96 40 90Z"
                  fill={SC.paper} stroke={SC.ink} strokeWidth="3" />
                {[[65, 115], [100, 128], [135, 116]].map(([x, y], i) => (
                  <g key={i}>
                    <line x1={x - 12} y1={y} x2={x + 12} y2={y} stroke={SC.washiBlue} strokeWidth="3" strokeLinecap="round" />
                    <line x1={x} y1={y - 12} x2={x} y2={y + 12} stroke={SC.washiBlue} strokeWidth="3" strokeLinecap="round" />
                    <line x1={x - 8} y1={y - 8} x2={x + 8} y2={y + 8} stroke={SC.washiBlue} strokeWidth="2" strokeLinecap="round" />
                    <line x1={x - 8} y1={y + 8} x2={x + 8} y2={y - 8} stroke={SC.washiBlue} strokeWidth="2" strokeLinecap="round" />
                  </g>
                ))}
              </g>
            )}
            {/* STORM — dark cloud + lightning bolt */}
            {isStorm && (
              <g>
                <path d="M40 90 Q32 90 32 74 Q32 58 48 58 Q52 36 72 36 Q88 26 104 38 Q118 24 134 40 Q148 40 152 56 Q164 56 164 78 Q164 96 148 96 L56 96 Q40 96 40 90Z"
                  fill="#C8C0B8" stroke={SC.ink} strokeWidth="3" />
                <path d="M95 100 L115 100 L100 128 L118 128 L82 160 L96 132 L80 132Z"
                  fill={SC.washiYellow} stroke={SC.ink} strokeWidth="2.5" strokeLinejoin="round" />
              </g>
            )}
          </svg>
        </div>

        {/* Temp + label */}
        <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '0 0 60%', minHeight: 0 }}>
            <FitText max={160} min={14} wrap={false}
              style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 700, color: SC.ink }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '1 1 0', minHeight: 0 }}>
              <FitText max={70} min={9} wrap={false}
                style={{ fontFamily: SC_FONT_PRINT, color: SC.inkLight }}>
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
// COUNTDOWN — ticket stub with big number + torn edge
// ═══════════════════════════════════════════════════════════
export function ScrapbookCountdown({ config, compact, onConfigChange }: {
  config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 14 * 86400000);
  const label    = config.label || resolved?.prefix || 'Days Until';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? 'DAYS' : 'HRS';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>

        {/* Ticket stub SVG background */}
        <svg viewBox="0 0 600 380" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 10px 20px ${SC.shadow})` }}>
          {/* Main ticket body */}
          <rect x="4" y="10" width="592" height="340" rx="12" fill={SC.paperBlush} stroke={SC.ink} strokeWidth="4" />
          {/* Left stub notch */}
          <rect x="0" y="10" width="120" height="340" rx="12" fill={SC.paperMint} stroke={SC.ink} strokeWidth="4" />
          {/* Perforation line */}
          <line x1="120" y1="18" x2="120" y2="342" stroke={SC.ink} strokeWidth="2.5" strokeDasharray="8 5" />
          {/* Washi tape strip across top */}
          <rect x="180" y="6" width="240" height="18" rx="4" fill={`${SC.washiPink}cc`} stroke={SC.washiPink} strokeWidth="1" />
          {/* Torn bottom edge */}
          <path d="M4 330 Q40 350 80 330 Q120 312 160 332 Q200 350 240 330 Q280 312 320 334 Q360 354 400 330 Q440 312 480 334 Q520 352 562 330 L596 330 L596 350 Q596 356 590 356 L10 356 Q4 356 4 350Z"
            fill={`${SC.washiYellow}88`} />
          {/* Small doodle circles on stub */}
          <circle cx="60" cy="60"  r="20" fill={`${SC.washiPurple}55`} stroke={SC.pencil} strokeWidth="1.5" />
          <circle cx="60" cy="110" r="14" fill={`${SC.washiBlue}55`}   stroke={SC.pencil} strokeWidth="1.5" />
          <circle cx="60" cy="155" r="10" fill={`${SC.washiPink}55`}   stroke={SC.pencil} strokeWidth="1.5" />
        </svg>

        {/* Text overlay inside ticket (right side) */}
        <div style={{
          position: 'absolute',
          top: '8%', left: '24%', right: '4%', bottom: '16%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: SC_FONT_DISPLAY,
        }}>
          {/* Label */}
          <div style={{ flex: '0 0 22%', minHeight: 0, width: '100%' }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={80} min={8} wrap={false}
              style={{ fontFamily: SC_FONT_PRINT, color: SC.inkLight, fontWeight: 600 }}
            >
              {label}
            </EditableText>
          </div>
          {/* Big number */}
          <div style={{ flex: '0 0 56%', minHeight: 0, width: '100%' }}>
            <FitText max={320} min={24} wrap={false}
              style={{ fontWeight: 800, color: SC.accent,
                textShadow: `2px 3px 0 ${SC.shadow}` }}>
              {bigNum}
            </FitText>
          </div>
          {/* Unit */}
          <div style={{ flex: '1 1 0', minHeight: 0, width: '100%' }}>
            <FitText max={80} min={8} wrap={false}
              style={{ fontFamily: SC_FONT_PRINT, color: SC.ink, letterSpacing: '0.1em' }}>
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — lined notebook page taped to scrapbook
// ═══════════════════════════════════════════════════════════
export function ScrapbookAnnouncement({ config, compact, onConfigChange }: {
  config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void;
}) {
  const message = config.message || config.body || 'Book Fair opens this week — bring your reading list!';
  const date    = config.date || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: SC.paper,
        border: `2px solid ${SC.pencil}`,
        borderRadius: 4,
        boxShadow: `4px 4px 12px ${SC.shadow}`,
        transform: 'rotate(-1deg)',
        transformOrigin: 'center center',
        overflow: 'hidden',
      }}>
        {/* Spiral binding holes on left edge */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: '8%',
          background: `linear-gradient(to right, ${SC.paperMint}, ${SC.paperMint}88)`,
          borderRight: `2px solid ${SC.pencil}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'space-around', padding: '6% 0',
        }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{
              width: '50%', aspectRatio: '1',
              borderRadius: '50%',
              border: `2px solid ${SC.pencil}`,
              background: SC.paper,
            }} />
          ))}
        </div>

        {/* Horizontal ruled lines */}
        <div style={{
          position: 'absolute', left: '10%', right: 0, top: 0, bottom: 0,
          backgroundImage: `repeating-linear-gradient(
            to bottom,
            transparent 0px,
            transparent calc(12.5% - 1px),
            ${SC.washiBlue}44 calc(12.5% - 1px),
            ${SC.washiBlue}44 12.5%
          )`,
        }} />

        {/* Washi tape across top */}
        <WashiTape color={SC.washiPink} width="36%" height="9%" left="32%" top="-4%" rotate={0} />

        {/* Red margin line */}
        <div style={{
          position: 'absolute', left: '16%', top: 0, bottom: 0,
          width: '2px', background: `${SC.accent}66`,
        }} />

        {/* Message text */}
        <div style={{
          position: 'absolute',
          top: '10%', left: '20%', right: '4%',
          bottom: date && !compact ? '22%' : '6%',
        }}>
          <EditableText
            configKey="message" onConfigChange={onConfigChange}
            max={180} min={10}
            style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 600, color: SC.ink, lineHeight: 1.4 }}
          >
            {message}
          </EditableText>
        </div>

        {/* Date in bottom-right corner like a teacher's note */}
        {date && !compact && (
          <div style={{
            position: 'absolute', bottom: '4%', right: '5%', left: '20%', height: '16%',
          }}>
            <FitText max={60} min={8} wrap={false} center={false}
              style={{ fontFamily: SC_FONT_DISPLAY, color: SC.accent }}>
              — {date}
            </FitText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — 3 overlapping index cards at slight rotations
// ═══════════════════════════════════════════════════════════
export function ScrapbookCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events?.length ? config.events : [
    { date: 'MON · Apr 21', title: 'Pajama Day Reading Hour' },
    { date: 'WED · Apr 23', title: "Principal's Story Time" },
    { date: 'APR 30',       title: 'Field Trip — THE ZOO!' },
  ]).slice(0, Math.max(1, Math.min(5, config.maxEvents ?? 3)));

  const cardColors  = [SC.paper, SC.paperBlush, SC.paperMint, SC.paper, SC.paperBlush];
  const tapeColors  = [SC.washiPink, SC.washiYellow, SC.washiPurple, SC.washiBlue, SC.washiPink];
  const rotations   = [-3, 1, -1.5, 2, -2];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4% 3%', gap: '4%' }}>
      {events.map((e: any, i: number) => (
        <div key={i} style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          background: cardColors[i % cardColors.length],
          border: `2px solid ${SC.pencil}`,
          borderRadius: 4,
          boxShadow: `2px 4px 10px ${SC.shadow}`,
          transform: `rotate(${rotations[i % rotations.length]}deg)`,
          transformOrigin: 'center center',
          display: 'flex',
          alignItems: 'center',
          padding: '0 3% 0 4%',
          overflow: 'hidden',
        }}>
          {/* Washi tape at top of each card */}
          <WashiTape color={tapeColors[i % tapeColors.length]} width="22%" height="28%" left="4%" top="-14%" rotate={0} />

          {/* Paperclip accent */}
          <div style={{ position: 'absolute', right: '3%', top: '-8%' }}>
            <PaperClip top="0" right="0" rotate={15} />
          </div>

          {/* Date badge */}
          <div style={{
            flexShrink: 0,
            height: '70%',
            aspectRatio: '1.4 / 1',
            background: tapeColors[i % tapeColors.length],
            borderRadius: 4,
            border: `1.5px solid ${SC.ink}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '2%', marginRight: '3%',
          }}>
            <FitText max={80} min={7} wrap={true}
              style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 700, color: SC.ink, lineHeight: 1.1 }}>
              {e.date}
            </FitText>
          </div>

          {/* Event title */}
          <div style={{ flex: 1, minWidth: 0, height: '72%' }}>
            <FitText max={200} min={9} wrap={false} center={false}
              style={{ fontFamily: SC_FONT_PRINT, color: SC.ink, fontWeight: 600 }}>
              {e.title}
            </FitText>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — classic polaroid + handwriting below
// ═══════════════════════════════════════════════════════════
export function ScrapbookStaffSpotlight({ config, onConfigChange }: {
  config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void;
}) {
  const name     = config.staffName || config.name || 'Mrs. Johnson';
  const role     = config.role  || 'Teacher of the Month';
  const quote    = config.bio   || config.quote || '"Every day is a chance to learn something new!"';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '86%', height: '96%',
        display: 'flex', flexDirection: 'column',
        transform: 'rotate(-2deg)',
        transformOrigin: 'center center',
      }}>
        {/* Washi tape across top of polaroid */}
        <WashiTape color={SC.washiPurple} width="36%" height="8%" left="32%" top="-4%" rotate={0} />

        {/* Polaroid white frame */}
        <div style={{
          flex: '0 0 68%', minHeight: 0,
          background: SC.paper,
          border: `4px solid ${SC.paper}`,
          borderBottom: 'none',
          boxShadow: `0 6px 18px ${SC.shadow}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '3% 3% 2% 3%',
          overflow: 'hidden',
        }}>
          {/* Photo area */}
          <div style={{
            width: '100%', height: '100%',
            background: SC.paperBlush,
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {photoUrl ? (
              <img src={resolveUrl(photoUrl)} alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ textAlign: 'center', padding: '8%' }}>
                <div style={{ fontSize: 'clamp(24px, 16cqh, 96px)', lineHeight: 1 }}>👩‍🏫</div>
                <div style={{ fontFamily: SC_FONT_PRINT, color: SC.inkLight, fontSize: 'clamp(10px, 5cqh, 32px)', marginTop: '4%' }}>
                  add a photo
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Caption section — white polaroid bottom strip */}
        <div style={{
          flex: '1 1 0', minHeight: 0,
          background: SC.paper,
          border: `4px solid ${SC.paper}`,
          borderTop: `2px solid ${SC.pencil}`,
          boxShadow: `0 6px 18px ${SC.shadow}`,
          padding: '2% 4%',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Role */}
          <div style={{ flex: '0 0 28%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={60} min={7} wrap={false} center={false}
              style={{ fontFamily: SC_FONT_PRINT, color: SC.inkLight }}>
              {role}
            </EditableText>
          </div>
          {/* Name */}
          <div style={{ flex: '0 0 38%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={160} min={10} wrap={false} center={false}
              style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 700, color: SC.ink }}>
              {name}
            </EditableText>
          </div>
          {/* Bio/quote */}
          <div style={{ flex: '1 1 0', minHeight: 0 }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={80} min={7} center={false}
              style={{ fontFamily: SC_FONT_DISPLAY, color: SC.inkLight, fontStyle: 'italic' }}>
              {quote}
            </EditableText>
          </div>
        </div>

        {/* Arrow doodle label */}
        <svg style={{ position: 'absolute', right: '-12%', bottom: '18%', width: '18%', height: 'auto' }}
          viewBox="0 0 60 50">
          <path d="M10 10 Q30 5 50 25" fill="none" stroke={SC.pencil} strokeWidth="2.5" strokeLinecap="round" />
          <polygon points="50,25 40,20 46,32" fill={SC.pencil} />
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — polaroid frame with four corner washi tapes
// ═══════════════════════════════════════════════════════════
export function ScrapbookImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative', width: '94%', height: '94%',
        background: SC.paper,
        padding: '3% 3% 12% 3%',
        boxShadow: `0 10px 24px ${SC.shadow}, 0 2px 4px rgba(0,0,0,0.08)`,
        transform: 'rotate(1.5deg)',
        transformOrigin: 'center center',
      }}>
        {/* Four corner washi tape strips */}
        <WashiTape color={SC.washiPink}   width="24%" height="10%" left="-4%"  top="-4%"  rotate={-40} />
        <WashiTape color={SC.washiYellow} width="24%" height="10%" right="-4%" top="-4%"  rotate={40}  />
        <WashiTape color={SC.washiBlue}   width="24%" height="10%" left="-4%"  bottom="-4%" rotate={40}  />
        <WashiTape color={SC.washiPurple} width="24%" height="10%" right="-4%" bottom="-4%" rotate={-40} />

        {/* Photo area */}
        <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: SC.paperBlush }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Gallery"
              className="transition-opacity duration-500"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: SC_FONT_DISPLAY, color: SC.inkLight,
              textAlign: 'center', padding: '8%',
            }}>
              <div style={{ fontSize: 'clamp(28px, 18cqh, 120px)', lineHeight: 1 }}>📷</div>
              <div style={{ fontWeight: 700, fontSize: 'clamp(10px, 5cqh, 36px)', marginTop: '4%' }}>
                Add photos
              </div>
              <div style={{ fontFamily: SC_FONT_PRINT, fontSize: 'clamp(8px, 3.5cqh, 24px)', color: SC.pencil, marginTop: '2%' }}>
                drop in the builder
              </div>
            </div>
          )}
        </div>

        {/* Polaroid caption area at bottom */}
        <div style={{
          position: 'absolute', left: '3%', right: '3%', bottom: '1%',
          height: '10%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {urls.length > 1 && (
            <FitText max={40} min={8} wrap={false}
              style={{ fontFamily: SC_FONT_DISPLAY, color: SC.inkLight }}>
              {`${idx + 1} / ${urls.length}`}
            </FitText>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — paper strip with a paperclip at each end
// ═══════════════════════════════════════════════════════════
export function ScrapbookTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length ? config.messages : ['☆ Lost & Found cleanout this Friday ☆'];
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
    <div className="absolute inset-0 flex items-center" style={{ padding: '3% 6%' }}>
      <div style={{ position: 'relative', width: '100%', height: '60%' }}>
        {/* Paper strip body */}
        <div style={{
          position: 'absolute', inset: 0,
          background: SC.washiYellow,
          border: `2px solid ${SC.pencil}`,
          borderRadius: 6,
          boxShadow: `0 4px 10px ${SC.shadow}`,
          display: 'flex', alignItems: 'center',
          padding: '0 10%',
          overflow: 'hidden',
        }}>
          {/* Diagonal stripe texture */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent 0px,
              transparent 14px,
              ${SC.washiYellow}44 14px,
              ${SC.washiYellow}44 16px
            )`,
            pointerEvents: 'none',
          }} />

          {/* Message text */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1, height: '80%' }}>
            <FitText max={compact ? 60 : 100} min={10} wrap={false}
              style={{ fontFamily: SC_FONT_DISPLAY, fontWeight: 700, color: SC.ink,
                textShadow: `1px 1px 0 rgba(255,255,255,0.5)` }}>
              {primary}
            </FitText>
          </div>
        </div>

        {/* Paperclip at left end */}
        <div style={{ position: 'absolute', left: '-4%', top: '50%', transform: 'translateY(-50%)' }}>
          <PaperClip left="0" rotate={-90} />
        </div>

        {/* Paperclip at right end */}
        <div style={{ position: 'absolute', right: '-4%', top: '50%', transform: 'translateY(-50%)' }}>
          <PaperClip right="0" rotate={90} />
        </div>
      </div>
    </div>
  );
}
