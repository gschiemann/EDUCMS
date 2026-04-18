"use client";

/**
 * Varsity Athletic — high school athletic-lobby jumbotron theme.
 *
 * Every widget channels stadium culture:
 *   LOGO             → chrome-bevel circular school crest with mascot silhouette
 *   TEXT / RICH_TEXT → collegiate block-letter jumbotron banner with chrome rivets
 *   CLOCK            → scoreboard LED readout + LIVE analog hands in chrome bezel
 *   WEATHER          → jumbotron "FORECAST" panel with LED-dot condition icons
 *   COUNTDOWN        → flip-card "BIG GAME" countdown with jumbotron frame
 *   ANNOUNCEMENT     → "CAPTAIN'S ANNOUNCEMENT" gold-foil ribbon on navy chalkboard
 *   CALENDAR         → 3 game-schedule cards with opponent, date, Home/Away pill
 *   STAFF_SPOTLIGHT  → MVP varsity trading-card
 *   IMAGE_CAROUSEL   → arena jumbotron photo frame with glowing LED chrome bezel
 *   TICKER           → full-width scrolling amber LED scoreboard
 */

import { useEffect, useState, useRef } from 'react';
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

// ─── Palette ────────────────────────────────────────────
export const VA = {
  stadiumNavy:    '#0F1F3A',
  stadiumDark:    '#0A1428',
  scarlet:        '#C81D1D',
  scarletDark:    '#8B0000',
  gold:           '#D4AF37',
  goldLight:      '#F0D77E',
  chrome:         '#C0C0C0',
  chromeDark:     '#8A8A8A',
  white:          '#FFFFFF',
  ink:            '#05101F',
  scoreboardAmber:'#FFB000',
  shadow:         'rgba(5,16,31,0.5)',
};

export const VA_FONT_DISPLAY = "'Bungee', 'Oswald', system-ui, sans-serif";
export const VA_FONT_BODY    = "'Fredoka', system-ui, sans-serif";
export const VA_FONT_MONO    = "'JetBrains Mono', monospace";

// ─── Shared helpers ─────────────────────────────────────
const CHROME_GRAD = `linear-gradient(135deg, ${VA.chrome} 0%, ${VA.white} 40%, ${VA.chromeDark} 60%, ${VA.chrome} 100%)`;
const GOLD_FOIL   = `linear-gradient(135deg, ${VA.gold} 0%, ${VA.goldLight} 45%, ${VA.gold} 65%, #B8960C 100%)`;

/** Tiny chrome rivet dot */
function Rivet({ x, y }: { x: number; y: number }) {
  return (
    <circle cx={x} cy={y} r="7"
      fill="url(#rivetGrad)" stroke={VA.chromeDark} strokeWidth="1.5" />
  );
}

/** LED dot matrix character indicator */
function LedDot({ x, y, lit }: { x: number; y: number; lit: boolean }) {
  return <circle cx={x} cy={y} r="4" fill={lit ? VA.scoreboardAmber : '#1A2A1A'} />;
}

// ═══════════════════════════════════════════════════════════
// LOGO — chrome-bevel circular school crest
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'HS').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'HS');
  const photoUrl = config.assetUrl || config.photoUrl;
  const teamName = config.teamName || 'VARSITY';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 280 280" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 6px 18px rgba(5,16,31,0.7))', overflow: 'visible' }}>
        <defs>
          <radialGradient id="chromeBezel" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor={VA.white} />
            <stop offset="35%" stopColor={VA.chrome} />
            <stop offset="70%" stopColor={VA.chromeDark} />
            <stop offset="100%" stopColor="#606060" />
          </radialGradient>
          <radialGradient id="rivetGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor={VA.white} />
            <stop offset="60%" stopColor={VA.chrome} />
            <stop offset="100%" stopColor={VA.chromeDark} />
          </radialGradient>
          <radialGradient id="innerCrest" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#1A3060" />
            <stop offset="100%" stopColor={VA.stadiumDark} />
          </radialGradient>
          <linearGradient id="goldRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={VA.goldLight} />
            <stop offset="40%" stopColor={VA.gold} />
            <stop offset="70%" stopColor="#B8960C" />
            <stop offset="100%" stopColor={VA.goldLight} />
          </linearGradient>
        </defs>

        {/* Outer chrome bezel */}
        <circle cx="140" cy="140" r="132" fill="url(#chromeBezel)" stroke={VA.chromeDark} strokeWidth="2" />
        {/* Gold ring */}
        <circle cx="140" cy="140" r="118" fill="url(#goldRing)" />
        {/* Inner navy field */}
        <circle cx="140" cy="140" r="106" fill="url(#innerCrest)" />

        {/* Chrome rivets at compass points */}
        <Rivet x={140} y={22} />
        <Rivet x={258} y={140} />
        <Rivet x={140} y={258} />
        <Rivet x={22} y={140} />

        {/* Star points on gold ring */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
          const r = Math.PI / 180 * deg;
          const x = 140 + Math.cos(r) * 112;
          const y = 140 + Math.sin(r) * 112;
          return <circle key={i} cx={x} cy={y} r="5" fill={VA.gold} />;
        })}

        {/* Crest content */}
        {photoUrl ? (
          <>
            <clipPath id="crestClip">
              <circle cx="140" cy="140" r="100" />
            </clipPath>
            <image href={resolveUrl(photoUrl)} x="40" y="40" width="200" height="200"
              preserveAspectRatio="xMidYMid slice" clipPath="url(#crestClip)" />
          </>
        ) : (
          <g>
            {/* Mascot silhouette — athletic lightning bolt / shield */}
            <polygon
              points="140,60 165,100 155,105 175,155 140,135 105,155 125,105 115,100"
              fill={VA.scarlet} stroke={VA.gold} strokeWidth="3" strokeLinejoin="round" />
            {/* Initials bar */}
            <rect x="100" y="158" width="80" height="28" rx="4"
              fill={VA.gold} />
            <text x="140" y="178" textAnchor="middle"
              fontFamily={VA_FONT_DISPLAY} fontWeight="900" fontSize="16"
              fill={VA.stadiumDark} letterSpacing="2">{initials}</text>
          </g>
        )}

        {/* Team name arc label */}
        <path id="arcTop" d="M 50 140 A 90 90 0 0 1 230 140" fill="none" />
        <text fill={VA.goldLight} fontFamily={VA_FONT_DISPLAY} fontWeight="700" fontSize="13" letterSpacing="3">
          <textPath href="#arcTop" startOffset="50%" textAnchor="middle">{teamName.toUpperCase()}</textPath>
        </text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — collegiate jumbotron banner with chrome rivets
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'GO EAGLES!';
  const subtitle = config.subtitle || 'HOME OF THE CHAMPIONS';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2% 1.5%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Jumbotron frame */}
        <svg viewBox="0 0 3200 400" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 8px 24px rgba(5,16,31,0.8))' }}>
          <defs>
            <linearGradient id="jumboBg" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1A3560" />
              <stop offset="50%" stopColor={VA.stadiumNavy} />
              <stop offset="100%" stopColor={VA.stadiumDark} />
            </linearGradient>
            <linearGradient id="jumboGoldBar" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={VA.gold} />
              <stop offset="50%" stopColor={VA.goldLight} />
              <stop offset="100%" stopColor={VA.gold} />
            </linearGradient>
            <linearGradient id="chromeBorder" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={VA.white} />
              <stop offset="40%" stopColor={VA.chrome} />
              <stop offset="100%" stopColor={VA.chromeDark} />
            </linearGradient>
          </defs>
          {/* Chrome outer border */}
          <rect x="0" y="0" width="3200" height="400" rx="12" fill="url(#chromeBorder)" />
          {/* Navy main field */}
          <rect x="8" y="8" width="3184" height="384" rx="8" fill="url(#jumboBg)" />
          {/* Scarlet accent stripes */}
          <rect x="8" y="8" width="3184" height="16" rx="4" fill={VA.scarlet} />
          <rect x="8" y="376" width="3184" height="16" rx="4" fill={VA.scarlet} />
          {/* Gold subtitle bar at bottom */}
          <rect x="8" y="304" width="3184" height="72" fill="url(#jumboGoldBar)" />
          {/* Chrome rivets */}
          {[80, 400, 800, 1200, 1600, 2000, 2400, 2800, 3120].map((x, i) => (
            <g key={i}>
              <circle cx={x} cy={24} r={10} fill={VA.chrome} stroke={VA.chromeDark} strokeWidth="2" />
              <circle cx={x} cy={24} r={5} fill={VA.white} opacity={0.6} />
              <circle cx={x} cy={376} r={10} fill={VA.chrome} stroke={VA.chromeDark} strokeWidth="2" />
              <circle cx={x} cy={376} r={5} fill={VA.white} opacity={0.6} />
            </g>
          ))}
          {/* LED surround dots */}
          {Array.from({ length: 32 }).map((_, i) => (
            <circle key={`led-${i}`} cx={80 + i * 98} cy={8} r={5}
              fill={i % 3 === 0 ? VA.scoreboardAmber : '#1a2a1a'} />
          ))}
        </svg>

        {/* Overlay text */}
        <div style={{
          position: 'absolute',
          left: '3%', right: '3%', top: '8%',
          height: compact ? '84%' : '56%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <EditableText
            configKey="content" onConfigChange={onConfigChange}
            max={260} min={14} wrap={false}
            style={{
              fontFamily: VA_FONT_DISPLAY,
              fontWeight: 900,
              color: VA.white,
              textShadow: `0 0 30px ${VA.scoreboardAmber}, 3px 3px 0 ${VA.stadiumDark}`,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {content}
          </EditableText>
        </div>

        {!compact && (
          <div style={{
            position: 'absolute',
            left: '5%', right: '5%',
            top: '76%', height: '18%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <EditableText
              configKey="subtitle" onConfigChange={onConfigChange}
              max={90} min={8} wrap={false}
              style={{
                fontFamily: VA_FONT_DISPLAY,
                fontWeight: 700,
                color: VA.stadiumDark,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {subtitle}
            </EditableText>
          </div>
        )}
      </div>
    </div>
  );
}

export { VarsityAthleticText as VarsityAthleticRichText };

// ═══════════════════════════════════════════════════════════
// CLOCK — scoreboard LED + LIVE analog in chrome bezel
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const tz = config.timezone || undefined;
  const timeStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).format(now);
  const dateStr = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(now);

  // Analog clock angles
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  const secDeg  = s * 6;
  const minDeg  = m * 6 + s * 0.1;
  const hourDeg = h * 30 + m * 0.5;
  const cx = 200, cy = 200, r = 165;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 460" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'drop-shadow(0 8px 24px rgba(5,16,31,0.8))', position: 'absolute', inset: 0 }}>
          <defs>
            <radialGradient id="clockBezel" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor={VA.white} />
              <stop offset="40%" stopColor={VA.chrome} />
              <stop offset="100%" stopColor="#606060" />
            </radialGradient>
            <radialGradient id="clockFace" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#0D1B33" />
              <stop offset="100%" stopColor={VA.stadiumDark} />
            </radialGradient>
            <linearGradient id="scoreboardBg" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0A1A0A" />
              <stop offset="100%" stopColor="#050F05" />
            </linearGradient>
          </defs>

          {/* Analog clock left side */}
          {/* Chrome bezel */}
          <circle cx={cx} cy={cy} r={r + 14} fill="url(#clockBezel)" />
          {/* Scarlet ring */}
          <circle cx={cx} cy={cy} r={r + 4} fill={VA.scarlet} />
          {/* Clock face */}
          <circle cx={cx} cy={cy} r={r} fill="url(#clockFace)" />
          {/* Hour markers */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            const x1 = cx + Math.cos(a) * (r - 18);
            const y1 = cy + Math.sin(a) * (r - 18);
            const x2 = cx + Math.cos(a) * (r - 6);
            const y2 = cy + Math.sin(a) * (r - 6);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={i % 3 === 0 ? VA.gold : VA.chrome} strokeWidth={i % 3 === 0 ? 5 : 2.5} />;
          })}
          {/* Gold numbers at 12, 3, 6, 9 */}
          {[['12', 0], ['3', 90], ['6', 180], ['9', 270]].map(([label, deg]) => {
            const a = (Number(deg) - 90) * Math.PI / 180;
            const x = cx + Math.cos(a) * (r - 36);
            const y = cy + Math.sin(a) * (r - 36);
            return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="central"
              fontFamily={VA_FONT_DISPLAY} fontWeight="700" fontSize="18" fill={VA.gold}>{label}</text>;
          })}
          {/* LIVE badge */}
          <rect x={cx - 28} y={cy - 100} width="56" height="18" rx="3" fill={VA.scarlet} />
          <text x={cx} y={cy - 90} textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_DISPLAY} fontWeight="700" fontSize="11" fill={VA.white} letterSpacing="3">LIVE</text>
          {/* Hour hand */}
          <line x1={cx} y1={cy}
            x2={cx + Math.cos((hourDeg - 90) * Math.PI / 180) * (r * 0.55)}
            y2={cy + Math.sin((hourDeg - 90) * Math.PI / 180) * (r * 0.55)}
            stroke={VA.white} strokeWidth="7" strokeLinecap="round" />
          {/* Minute hand */}
          <line x1={cx} y1={cy}
            x2={cx + Math.cos((minDeg - 90) * Math.PI / 180) * (r * 0.78)}
            y2={cy + Math.sin((minDeg - 90) * Math.PI / 180) * (r * 0.78)}
            stroke={VA.chrome} strokeWidth="5" strokeLinecap="round" />
          {/* Second hand */}
          <line x1={cx} y1={cy}
            x2={cx + Math.cos((secDeg - 90) * Math.PI / 180) * (r * 0.84)}
            y2={cy + Math.sin((secDeg - 90) * Math.PI / 180) * (r * 0.84)}
            stroke={VA.scarlet} strokeWidth="2.5" strokeLinecap="round" />
          {/* Center dot */}
          <circle cx={cx} cy={cy} r="7" fill={VA.gold} />

          {/* LED scoreboard display right side */}
          <rect x="410" y="60" width="260" height="340" rx="10" fill="url(#scoreboardBg)"
            stroke={VA.chrome} strokeWidth="4" />
          {/* Scoreboard label */}
          <rect x="420" y="70" width="240" height="28" rx="4" fill={VA.scarlet} />
          <text x="540" y="84" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_DISPLAY} fontSize="13" fontWeight="700" fill={VA.white} letterSpacing="3">SCOREBOARD</text>
          {/* Time digits — amber LED effect */}
          <text x="540" y="220" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_MONO} fontSize="72" fontWeight="700"
            fill={VA.scoreboardAmber}
            style={{ filter: `drop-shadow(0 0 8px ${VA.scoreboardAmber})` }}>
            {timeStr.slice(0, 5)}
          </text>
          {/* Seconds */}
          <text x="540" y="285" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_MONO} fontSize="32" fill={VA.scoreboardAmber} opacity={0.8}>
            :{timeStr.slice(6, 8)}
          </text>
          {/* Date */}
          {!compact && (
            <text x="540" y="345" textAnchor="middle" dominantBaseline="central"
              fontFamily={VA_FONT_DISPLAY} fontSize="18" fill={VA.gold} letterSpacing="2">
              {dateStr.toUpperCase()}
            </text>
          )}
          {/* LED border dots */}
          {Array.from({ length: 8 }).map((_, i) => (
            <circle key={`sdot-${i}`} cx={420 + i * 34} cy={388} r={5}
              fill={i % 2 === 0 ? VA.scoreboardAmber : '#1a2a1a'} />
          ))}
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — jumbotron "FORECAST" panel with LED condition icons
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  const low = (cond || '').toLowerCase();
  const isSnow  = low.includes('snow') || low.includes('flurr');
  const isStorm = low.includes('storm') || low.includes('thunder');
  const isRain  = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isFog   = !isSnow && !isStorm && !isRain && (low.includes('fog') || low.includes('mist') || low.includes('haze'));
  const isOvercast = !isRain && !isSnow && !isStorm && !isFog && (low.includes('overcast') || low.includes('cloudy'));
  const isClear = !isOvercast && !isRain && !isSnow && !isStorm && !isFog;

  // LED dot grid icon — a 9×7 dot matrix per condition (simplified shapes)
  // Each icon drawn with amber dots for lit, dark for off
  const dotSize = 6, dotGap = 3;
  const stride = dotSize + dotGap;

  // Maps: 0=off, 1=lit amber, 2=lit gold, 3=lit blue-ish (#4af)
  const ICONS: Record<string, number[][]> = {
    clear: [
      [0,0,1,1,1,0,0],
      [0,1,1,2,1,1,0],
      [1,1,2,2,2,1,1],
      [1,2,2,2,2,2,1],
      [1,1,2,2,2,1,1],
      [0,1,1,2,1,1,0],
      [0,0,1,1,1,0,0],
    ],
    cloud: [
      [0,0,1,1,1,0,0],
      [0,1,1,1,1,1,0],
      [1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
    ],
    rain: [
      [0,1,1,1,1,0,0],
      [1,1,1,1,1,1,0],
      [1,1,1,1,1,1,1],
      [0,0,0,0,0,0,0],
      [3,0,3,0,3,0,3],
      [0,3,0,3,0,3,0],
      [3,0,3,0,3,0,3],
    ],
    snow: [
      [0,1,0,1,0,1,0],
      [0,0,1,1,1,0,0],
      [1,1,1,1,1,1,1],
      [0,0,1,1,1,0,0],
      [0,1,0,1,0,1,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
    ],
    storm: [
      [0,1,1,1,0,0,0],
      [1,1,1,1,1,0,0],
      [1,1,1,1,1,1,0],
      [0,0,2,2,0,0,0],
      [0,2,2,0,0,0,0],
      [2,2,0,0,0,0,0],
      [0,0,0,0,0,0,0],
    ],
    fog: [
      [1,1,1,1,1,1,1],
      [0,0,0,0,0,0,0],
      [1,1,1,1,1,1,1],
      [0,0,0,0,0,0,0],
      [1,1,1,1,1,1,1],
      [0,0,0,0,0,0,0],
      [1,1,1,1,1,1,1],
    ],
  };
  const iconKey = isStorm ? 'storm' : isSnow ? 'snow' : isRain ? 'rain' : isFog ? 'fog' : isOvercast ? 'cloud' : 'clear';
  const icon = ICONS[iconKey];
  const dotColors = ['#1a2a1a', VA.scoreboardAmber, VA.gold, '#44AAFF'];
  const iconW = 7 * stride - dotGap;
  const iconH = 7 * stride - dotGap;
  const iconX = 30, iconY = 60;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 460" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'drop-shadow(0 6px 20px rgba(5,16,31,0.7))', position: 'absolute', inset: 0 }}>
          <defs>
            <linearGradient id="forecastBg" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0A1A0A" />
              <stop offset="100%" stopColor="#050A05" />
            </linearGradient>
          </defs>
          {/* Outer chrome frame */}
          <rect x="0" y="0" width="700" height="460" rx="12"
            fill={VA.chromeDark} stroke={VA.chrome} strokeWidth="4" />
          {/* Dark scoreboard background */}
          <rect x="8" y="8" width="684" height="444" rx="8" fill="url(#forecastBg)" />
          {/* FORECAST header bar */}
          <rect x="8" y="8" width="684" height="44" rx="6" fill={VA.scarlet} />
          <text x="350" y="30" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_DISPLAY} fontSize="20" fontWeight="700"
            fill={VA.white} letterSpacing="6">▶ FORECAST ◀</text>
          {/* LED dot icon */}
          {icon.map((row, ri) =>
            row.map((v, ci) => (
              <circle key={`d-${ri}-${ci}`}
                cx={iconX + ci * stride + dotSize / 2}
                cy={iconY + ri * stride + dotSize / 2}
                r={dotSize / 2 - 0.5}
                fill={dotColors[v]} />
            ))
          )}
          {/* Location */}
          <text x="350" y="118" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_DISPLAY} fontSize="16" fill={VA.chrome} letterSpacing="3">
            {location.toUpperCase()}
          </text>
          {/* Condition */}
          <text x="350" y="160" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_DISPLAY} fontSize="20" fill={VA.gold} letterSpacing="2">
            {cond.toUpperCase()}
          </text>
          {/* Temperature — large amber LED */}
          <text x="350" y="310" textAnchor="middle" dominantBaseline="central"
            fontFamily={VA_FONT_MONO} fontWeight="700" fontSize="160"
            fill={VA.scoreboardAmber}
            style={{ filter: `drop-shadow(0 0 12px ${VA.scoreboardAmber})` }}>
            {temp}°
          </text>
          {/* LED row bottom */}
          {Array.from({ length: 20 }).map((_, i) => (
            <circle key={`bl-${i}`} cx={30 + i * 34} cy={448} r={4}
              fill={i % 4 === 0 ? VA.scoreboardAmber : '#1a2a1a'} />
          ))}
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — flip-card "BIG GAME" jumbotron countdown
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 7 * 86400000);
  const label = config.label || resolved?.prefix || 'BIG GAME IN';
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);

  const FlipCard = ({ value, unit }: { value: number; unit: string }) => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4%',
      flex: 1, minWidth: 0,
    }}>
      {/* Card */}
      <div style={{
        width: '100%', aspectRatio: '1 / 1.1',
        background: `linear-gradient(180deg, #1A3060 0%, ${VA.stadiumDark} 50%, #0A1020 100%)`,
        border: `3px solid ${VA.chromeDark}`,
        borderRadius: 8,
        boxShadow: `inset 0 2px 4px rgba(255,255,255,0.05), 0 4px 12px ${VA.shadow}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Flip line */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          height: 2, background: VA.ink, zIndex: 2,
        }} />
        <span style={{
          fontFamily: VA_FONT_MONO, fontWeight: 700,
          color: VA.scoreboardAmber,
          fontSize: 'clamp(14px, 8cqh, 80px)',
          filter: `drop-shadow(0 0 8px ${VA.scoreboardAmber})`,
          zIndex: 1,
        }}>
          {String(value).padStart(2, '0')}
        </span>
      </div>
      {/* Unit label */}
      <span style={{
        fontFamily: VA_FONT_DISPLAY, fontWeight: 700,
        color: VA.chrome,
        fontSize: 'clamp(8px, 2.5cqh, 20px)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {unit}
      </span>
    </div>
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%', containerType: 'size' }}>
      <div style={{
        width: '100%', height: '100%',
        background: `linear-gradient(180deg, #0A1A0A 0%, ${VA.stadiumDark} 100%)`,
        border: `4px solid ${VA.chromeDark}`,
        borderRadius: 12,
        boxShadow: `0 0 0 2px ${VA.chrome}, inset 0 0 60px ${VA.shadow}`,
        display: 'flex', flexDirection: 'column',
        padding: '4% 3%',
        gap: '4%',
      }}>
        {/* Header */}
        <div style={{ flex: '0 0 20%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EditableText
            configKey="label" onConfigChange={onConfigChange}
            max={60} min={8} wrap={false}
            style={{
              fontFamily: VA_FONT_DISPLAY, fontWeight: 900,
              color: VA.gold, letterSpacing: '0.1em',
              textTransform: 'uppercase',
              textShadow: `0 0 16px ${VA.gold}`,
            }}
          >
            {label.toUpperCase()}
          </EditableText>
        </div>

        {/* Flip cards */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '3%' }}>
          <FlipCard value={days}  unit="DAYS" />
          <FlipCard value={hours} unit="HRS" />
          {!compact && <FlipCard value={mins} unit="MIN" />}
        </div>

        {/* Gold accent bar */}
        <div style={{
          flex: '0 0 4%', minHeight: 2,
          background: GOLD_FOIL,
          borderRadius: 2,
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — Captain's Announcement gold-foil ribbon
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title   = config.title   || "CAPTAIN'S ANNOUNCEMENT";
  const message = config.message || config.body || 'Practice moved to 4:30pm — Field House B.';
  const date    = config.date    || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: `linear-gradient(160deg, #112244 0%, ${VA.stadiumDark} 100%)`,
        border: `3px solid ${VA.chromeDark}`,
        borderRadius: 10,
        boxShadow: `0 0 0 1.5px ${VA.chrome}, inset 0 0 40px ${VA.shadow}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Gold-foil ribbon header */}
        <div style={{
          flex: '0 0 28%', minHeight: 0,
          background: GOLD_FOIL,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: `3px solid ${VA.gold}`,
          padding: '0 4%',
        }}>
          <FitText max={80} min={8} wrap={false}
            style={{
              fontFamily: VA_FONT_DISPLAY, fontWeight: 900,
              color: VA.stadiumDark, letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {title}
          </FitText>
        </div>

        {/* Message on dark chalkboard field */}
        <div style={{ flex: 1, minHeight: 0, padding: '3% 5%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: !compact && date ? '1 1 80%' : '1 1 100%', minHeight: 0 }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={220} min={10}
              style={{
                fontFamily: VA_FONT_BODY, fontWeight: 600,
                color: VA.white, letterSpacing: '0.01em',
              }}
            >
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 20%', minHeight: 0 }}>
              <FitText max={50} min={8} wrap={false}
                style={{ fontFamily: VA_FONT_DISPLAY, color: VA.goldLight, letterSpacing: '0.05em' }}>
                {date}
              </FitText>
            </div>
          )}
        </div>

        {/* Scarlet bottom stripe */}
        <div style={{ height: '5%', minHeight: 4, background: VA.scarlet }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — game-schedule cards with Home/Away pill
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'FRI · OCT 10', title: 'vs. Lincoln Tigers',   home: true  },
    { date: 'SAT · OCT 18', title: '@ Roosevelt Raiders',  home: false },
    { date: 'FRI · OCT 24', title: 'vs. Westview Warriors', home: true  },
  ]).slice(0, Math.max(1, Math.min(5, config.maxEvents ?? 3)));

  return (
    <div className="absolute inset-0 flex flex-col justify-center"
      style={{ padding: '3%', gap: '3%', containerType: 'size' }}>
      {events.map((e: any, i: number) => {
        const isHome = e.home !== false && !String(e.title || '').startsWith('@');
        return (
          <div key={i} style={{
            flex: 1, minHeight: 0,
            background: `linear-gradient(90deg, #112244 0%, ${VA.stadiumNavy} 100%)`,
            border: `2px solid ${VA.chromeDark}`,
            borderLeft: `5px solid ${isHome ? VA.gold : VA.scarlet}`,
            borderRadius: 8,
            boxShadow: `0 3px 10px ${VA.shadow}`,
            display: 'flex', alignItems: 'center',
            gap: '2%', padding: '0 3%',
            overflow: 'hidden',
          }}>
            {/* Date column */}
            <div style={{ flexShrink: 0, width: '28%', height: '70%', display: 'flex', alignItems: 'center' }}>
              <FitText max={160} min={8} wrap={false} center={false}
                style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 700, color: VA.gold, letterSpacing: '0.04em' }}>
                {e.date || e.startTime || 'TBD'}
              </FitText>
            </div>
            {/* Divider */}
            <div style={{ width: 2, height: '60%', background: VA.chromeDark, flexShrink: 0 }} />
            {/* Opponent */}
            <div style={{ flex: 1, minWidth: 0, height: '70%', display: 'flex', alignItems: 'center' }}>
              <FitText max={200} min={8} wrap={false} center={false}
                style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 700, color: VA.white, letterSpacing: '0.02em' }}>
                {e.title || e.opponent || 'Opponent TBD'}
              </FitText>
            </div>
            {/* Home/Away pill */}
            <div style={{
              flexShrink: 0,
              padding: '3% 5%',
              background: isHome ? VA.gold : VA.scarlet,
              borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontFamily: VA_FONT_DISPLAY, fontWeight: 700,
                color: isHome ? VA.stadiumDark : VA.white,
                fontSize: 'clamp(8px, 2.5cqh, 18px)',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
              }}>
                {isHome ? 'HOME' : 'AWAY'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — varsity MVP trading card
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name    = config.staffName || config.name || 'Coach Williams';
  const role    = config.role || 'Athletic Director';
  const quote   = config.bio || config.quote || '"Champions are made in the off-season."';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;
  const record  = config.record || '12-2';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: `linear-gradient(160deg, #1A3060 0%, ${VA.stadiumDark} 60%, ${VA.ink} 100%)`,
        border: `3px solid ${VA.chromeDark}`,
        borderRadius: 12,
        boxShadow: `0 0 0 1.5px ${VA.chrome}, 0 12px 32px ${VA.shadow}`,
        display: 'flex', gap: '4%',
        padding: '4%',
        overflow: 'hidden',
      }}>
        {/* Gold foil corner accent */}
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: '18%', height: '18%',
          background: GOLD_FOIL,
          clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
        }} />

        {/* MVP label strip top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '12%',
          background: GOLD_FOIL,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FitText max={60} min={7} wrap={false}
            style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 900, color: VA.stadiumDark, letterSpacing: '0.12em' }}>
            ★ MVP SPOTLIGHT ★
          </FitText>
        </div>

        {/* Portrait */}
        <div style={{
          flexShrink: 0, width: '36%',
          marginTop: '14%',
          aspectRatio: '3 / 4',
          borderRadius: 8,
          overflow: 'hidden',
          background: `linear-gradient(180deg, ${VA.scarlet} 0%, ${VA.scarletDark} 100%)`,
          border: `3px solid ${VA.gold}`,
          boxShadow: `0 0 0 1px ${VA.chromeDark}, 4px 4px 8px ${VA.shadow}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg viewBox="0 0 100 133" width="100%" height="100%">
              {/* Silhouette */}
              <circle cx="50" cy="32" r="22" fill={VA.chrome} opacity={0.5} />
              <path d="M12 133 Q12 76 50 76 Q88 76 88 133Z" fill={VA.chrome} opacity={0.5} />
            </svg>
          )}
        </div>

        {/* Info column */}
        <div style={{
          flex: 1, minWidth: 0,
          marginTop: '14%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: '4%',
        }}>
          {/* Role */}
          <div style={{ flex: '0 0 18%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={70} min={7} wrap={false} center={false}
              style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 700, color: VA.scarlet, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {role}
            </EditableText>
          </div>
          {/* Name */}
          <div style={{ flex: '0 0 30%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={160} min={9} wrap={false} center={false}
              style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 900, color: VA.white }}>
              {name}
            </EditableText>
          </div>
          {/* Record */}
          <div style={{
            flex: '0 0 16%', minHeight: 0,
            display: 'flex', alignItems: 'center', gap: '6%',
          }}>
            <span style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 700, color: VA.chrome, fontSize: 'clamp(8px, 2cqh, 14px)', letterSpacing: '0.06em' }}>RECORD</span>
            <span style={{ fontFamily: VA_FONT_MONO, fontWeight: 700, color: VA.scoreboardAmber, fontSize: 'clamp(10px, 3cqh, 20px)' }}>{record}</span>
          </div>
          {/* Quote */}
          <div style={{ flex: '1 1 36%', minHeight: 0 }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={90} min={8} center={false}
              style={{ fontFamily: VA_FONT_BODY, fontWeight: 500, color: VA.chrome, fontStyle: 'italic' }}>
              {quote}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — arena jumbotron frame with LED bezel
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticImageCarousel({ config }: { config: any; compact?: boolean }) {
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
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#050A05',
        border: `5px solid ${VA.chromeDark}`,
        borderRadius: 10,
        boxShadow: `0 0 0 2px ${VA.chrome}, 0 0 24px rgba(255,176,0,0.15), inset 0 0 12px rgba(0,0,0,0.8)`,
        overflow: 'hidden',
      }}>
        {/* LED dots across top and bottom */}
        {['top', 'bottom'].map(edge => (
          <div key={edge} style={{
            position: 'absolute', left: 8, right: 8,
            [edge]: 5,
            height: 10,
            display: 'flex', gap: 4, alignItems: 'center',
            zIndex: 3,
          }}>
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: i % 3 === 0 ? VA.scoreboardAmber : '#1a2a1a',
                boxShadow: i % 3 === 0 ? `0 0 4px ${VA.scoreboardAmber}` : 'none',
              }} />
            ))}
          </div>
        ))}

        {/* Chrome corner brackets */}
        {[
          { top: 12, left: 12 },
          { top: 12, right: 12 },
          { bottom: 12, left: 12 },
          { bottom: 12, right: 12 },
        ].map((pos, i) => (
          <div key={i} style={{
            position: 'absolute', ...pos,
            width: 24, height: 24,
            border: `4px solid ${VA.chrome}`,
            borderRadius: 2,
            zIndex: 4,
            background: 'transparent',
            ...(pos.hasOwnProperty('right') && pos.hasOwnProperty('bottom')
              ? { borderTop: 'none', borderLeft: 'none' }
              : pos.hasOwnProperty('right')
              ? { borderBottom: 'none', borderLeft: 'none' }
              : pos.hasOwnProperty('bottom')
              ? { borderTop: 'none', borderRight: 'none' }
              : { borderBottom: 'none', borderRight: 'none' }),
          }} />
        ))}

        {/* Image / placeholder */}
        <div style={{ position: 'absolute', inset: '18px 5px', overflow: 'hidden', borderRadius: 4 }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Athletic Gallery"
              className="transition-opacity duration-700"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${VA.stadiumNavy} 0%, ${VA.stadiumDark} 100%)`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: VA_FONT_DISPLAY, color: VA.chrome,
              textAlign: 'center', padding: '6%',
            }}>
              <div style={{ fontSize: 'clamp(24px, 18cqh, 120px)', color: VA.scoreboardAmber, lineHeight: 1 }}>▶</div>
              <div style={{ fontWeight: 700, fontSize: 'clamp(10px, 4cqh, 32px)', marginTop: '2%', letterSpacing: '0.06em' }}>
                JUMBOTRON READY
              </div>
              <div style={{ fontSize: 'clamp(8px, 2.5cqh, 18px)', color: VA.chromeDark, marginTop: '1%' }}>
                Add photos in the builder
              </div>
            </div>
          )}
        </div>

        {/* Dot indicators */}
        {urls.length > 1 && (
          <div style={{
            position: 'absolute', bottom: 18, left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: 6, zIndex: 4,
          }}>
            {urls.map((_, i) => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: i === idx ? VA.scoreboardAmber : VA.chromeDark,
                boxShadow: i === idx ? `0 0 6px ${VA.scoreboardAmber}` : 'none',
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — full-width amber LED scoreboard
// ═══════════════════════════════════════════════════════════
export function VarsityAthleticTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['⚡ EAGLES WIN 42-14 ⚡', '🏆 DISTRICT CHAMPIONS', '📅 HOMECOMING FRI OCT 18'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);
  const [scrollX, setScrollX] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  // Scroll animation
  useEffect(() => {
    let animId: number;
    let x = 0;
    const containerW = containerRef.current?.clientWidth ?? 800;
    const textW = textRef.current?.scrollWidth ?? 400;
    const totalW = textW + containerW;
    x = containerW;

    const animate = () => {
      x -= (speed === 'fast' ? 2.5 : speed === 'slow' ? 0.8 : 1.5);
      if (x < -textW) x = containerW;
      setScrollX(x);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [speed, messages[idx]]);

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden' }} ref={containerRef}>
      {/* Dark scoreboard bg */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, #0A1A0A 0%, #050A05 100%)`,
        border: `3px solid ${VA.chromeDark}`,
        borderRadius: 6,
      }} />

      {/* LIVE badge */}
      <div style={{
        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
        background: VA.scarlet,
        borderRadius: 4,
        padding: '2% 3%',
        zIndex: 3,
        display: 'flex', alignItems: 'center',
      }}>
        <FitText max={compact ? 30 : 50} min={8} wrap={false}
          style={{ fontFamily: VA_FONT_DISPLAY, fontWeight: 900, color: VA.white, letterSpacing: '0.08em' }}>
          LIVE
        </FitText>
      </div>

      {/* Scrolling text */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
        overflow: 'hidden',
      }}>
        <div ref={textRef} style={{
          position: 'absolute', top: 0, bottom: 0,
          left: scrollX,
          display: 'flex', alignItems: 'center',
          paddingLeft: 100,
          whiteSpace: 'nowrap',
          fontFamily: VA_FONT_MONO, fontWeight: 700,
          fontSize: compact ? 'clamp(12px, 3.5cqh, 28px)' : 'clamp(14px, 4.5cqh, 40px)',
          color: VA.scoreboardAmber,
          textShadow: `0 0 8px ${VA.scoreboardAmber}`,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {messages[idx]} &nbsp;&nbsp;&nbsp; ★ &nbsp;&nbsp;&nbsp; {messages[(idx + 1) % messages.length]}
        </div>
      </div>

      {/* LED dots bottom row */}
      <div style={{
        position: 'absolute', bottom: 2, left: 0, right: 0,
        height: 6, display: 'flex', gap: 3, padding: '0 4px',
        alignItems: 'center',
        zIndex: 2,
      }}>
        {Array.from({ length: 60 }).map((_, i) => (
          <div key={i} style={{
            width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
            background: i % 4 === 0 ? VA.scoreboardAmber : '#1a2a1a',
          }} />
        ))}
      </div>
    </div>
  );
}
