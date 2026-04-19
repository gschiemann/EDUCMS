"use client";

/**
 * Senior Countdown — high school senior-class lobby theme.
 *
 * Graduation-themed, aspirational: diploma scrolls, mortarboard caps,
 * gold tassels, achievement ribbons, "CLASS OF 2027" banners, parchment
 * texture, classic school colors with gold foil accents.
 *
 *   LOGO             → collegiate seal (navy + gold ring + academic crest)
 *   TEXT / RICH_TEXT → "CLASS OF 2027" navy ribbon banner with gold foil
 *   CLOCK            → brass grandfather clock with Roman numerals + live analog hands
 *   WEATHER          → parchment weather card with 6 engraving-style icons
 *   COUNTDOWN        → HUGE "DAYS UNTIL GRADUATION" count, gold foil, dark banner
 *   ANNOUNCEMENT     → rolled diploma scroll with ribbon seal
 *   CALENDAR         → 3 graduation-event cards (Prom / Senior Trip / Graduation)
 *   STAFF_SPOTLIGHT  → academic portrait card, gold frame + laurel wreath
 *   IMAGE_CAROUSEL   → framed class portrait with gold picture frame + nameplate
 *   TICKER           → elegant parchment banner strip with italic serif message
 */

import { useEffect, useState } from 'react';
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

// ─── Palette ─────────────────────────────────────────────────
export const SCD = {
  parchment:    '#F5EFE1',
  parchmentDark:'#D9C79A',
  navy:         '#1B2A4E',
  navyDark:     '#0E1833',
  gold:         '#C9A227',
  goldLight:    '#E5C56E',
  maroon:       '#7D2630',
  ink:          '#0E1833',
  inkSoft:      '#5C6785',
  shadow:       'rgba(14,24,51,0.4)',
};

export const SCD_FONT_DISPLAY = "'Fraunces', 'Playfair Display', serif";
export const SCD_FONT_BODY    = "'Fredoka', system-ui, sans-serif";
export const SCD_FONT_SCRIPT  = "'Caveat', cursive";

// Roman numerals helper
const ROMAN: [number, string][] = [
  [12,'XII'],[11,'XI'],[10,'X'],[9,'IX'],[8,'VIII'],[7,'VII'],
  [6,'VI'],[5,'V'],[4,'IV'],[3,'III'],[2,'II'],[1,'I'],
];

// ═══════════════════════════════════════════════════════════
// LOGO — collegiate seal (navy + gold ring + academic crest)
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'SCHOOL').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'SC');
  const year = config.classYear || '2027';
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 300 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 6px 16px ${SCD.shadow})`, overflow: 'visible' }}>
        {/* Outer gold ring */}
        <circle cx="150" cy="150" r="138" fill={SCD.navy} stroke={SCD.gold} strokeWidth="10" />
        <circle cx="150" cy="150" r="126" fill="none" stroke={SCD.goldLight} strokeWidth="2" strokeDasharray="6 4" />
        {/* Inner navy field */}
        <circle cx="150" cy="150" r="108" fill={SCD.navyDark} stroke={SCD.gold} strokeWidth="4" />
        {/* Laurel branches — left */}
        <g stroke={SCD.gold} strokeWidth="2.5" fill="none" opacity="0.9">
          <path d="M60 180 Q72 155 85 160" /><ellipse cx="73" cy="162" rx="10" ry="6" fill={SCD.gold} opacity="0.7" transform="rotate(-30 73 162)" />
          <path d="M55 200 Q68 175 82 178" /><ellipse cx="68" cy="180" rx="10" ry="6" fill={SCD.gold} opacity="0.7" transform="rotate(-25 68 180)" />
          <path d="M58 220 Q74 196 88 198" /><ellipse cx="74" cy="200" rx="10" ry="6" fill={SCD.gold} opacity="0.7" transform="rotate(-20 74 200)" />
        </g>
        {/* Laurel branches — right (mirrored) */}
        <g stroke={SCD.gold} strokeWidth="2.5" fill="none" opacity="0.9">
          <path d="M240 180 Q228 155 215 160" /><ellipse cx="227" cy="162" rx="10" ry="6" fill={SCD.gold} opacity="0.7" transform="rotate(30 227 162)" />
          <path d="M245 200 Q232 175 218 178" /><ellipse cx="232" cy="180" rx="10" ry="6" fill={SCD.gold} opacity="0.7" transform="rotate(25 232 180)" />
          <path d="M242 220 Q226 196 212 198" /><ellipse cx="226" cy="200" rx="10" ry="6" fill={SCD.gold} opacity="0.7" transform="rotate(20 226 200)" />
        </g>
        {/* Mortarboard icon at top */}
        <g transform="translate(150 68)">
          <polygon points="0,-22 36,0 0,22 -36,0" fill={SCD.gold} stroke={SCD.navyDark} strokeWidth="2" />
          <rect x="-16" y="0" width="32" height="20" rx="3" fill={SCD.gold} stroke={SCD.navyDark} strokeWidth="2" />
          <line x1="24" y1="2" x2="30" y2="18" stroke={SCD.goldLight} strokeWidth="3" strokeLinecap="round" />
          <circle cx="30" cy="20" r="4" fill={SCD.goldLight} />
        </g>
        {/* Photo or initials */}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="100" y="100" width="100" height="100"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(47px at 150px 150px)" />
        ) : (
          <text x="150" y="165" textAnchor="middle" dominantBaseline="middle"
            fontFamily={SCD_FONT_DISPLAY} fontWeight="700" fontSize="44" fill={SCD.goldLight}
            letterSpacing="2">
            {initials}
          </text>
        )}
        {/* Curved "CLASS OF" text at top arc */}
        <path id="topArc" d="M 40 150 A 110 110 0 0 1 260 150" fill="none" />
        <text fontFamily={SCD_FONT_BODY} fontSize="13" fill={SCD.goldLight} letterSpacing="3">
          <textPath href="#topArc" startOffset="50%" textAnchor="middle">CLASS OF {year}</textPath>
        </text>
        {/* Bottom ribbon */}
        <path d="M 90 228 Q 150 248 210 228" stroke={SCD.gold} strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — "CLASS OF 2027" navy ribbon banner, gold foil
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'CLASS OF 2027';
  const subtitle = config.subtitle || 'making memories that last a lifetime…';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2% 1%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* SVG ribbon banner */}
        <svg viewBox="0 0 3200 380" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: `drop-shadow(0 14px 24px ${SCD.shadow})`, position: 'absolute', inset: 0 }}>
          {/* Forked tail — left */}
          <polygon points="0,190 130,80 250,190 130,300" fill={SCD.navyDark} />
          {/* Forked tail — right */}
          <polygon points="3200,190 3070,80 2950,190 3070,300" fill={SCD.navyDark} />
          {/* Fold shadows */}
          <polygon points="210,0 260,60 260,320 210,380" fill={SCD.navyDark} />
          <polygon points="2990,0 2940,60 2940,320 2990,380" fill={SCD.navyDark} />
          {/* Main banner body */}
          <rect x="260" y="0" width="2680" height="380" fill={SCD.navy} />
          {/* Gold top stripe */}
          <rect x="260" y="0"   width="2680" height="22" fill={SCD.gold} />
          {/* Gold bottom stripe */}
          <rect x="260" y="358" width="2680" height="22" fill={SCD.gold} />
          {/* Subtle vertical gold rules at folds */}
          <line x1="300" y1="22" x2="300" y2="358" stroke={SCD.goldLight} strokeWidth="2" strokeDasharray="8 6" opacity="0.4" />
          <line x1="2900" y1="22" x2="2900" y2="358" stroke={SCD.goldLight} strokeWidth="2" strokeDasharray="8 6" opacity="0.4" />
        </svg>
        {/* Text overlay — inside banner safe area */}
        <div style={{
          position: 'absolute',
          left: '8.5%', right: '7%', top: '7%', bottom: '7%',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 68%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={180} min={12} wrap={false}
              style={{
                fontFamily: SCD_FONT_DISPLAY, fontWeight: 700,
                color: SCD.goldLight,
                textShadow: `0 2px 4px ${SCD.navyDark}, 0 0 30px rgba(201,162,39,0.6)`,
                letterSpacing: '0.08em',
              }}
            >
              {content}
            </EditableText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 34%', minHeight: 0 }}>
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={120} min={9} wrap={false}
                style={{
                  fontFamily: SCD_FONT_SCRIPT,
                  color: SCD.parchmentDark,
                  textShadow: `1px 1px 4px ${SCD.navyDark}`,
                }}
              >
                {subtitle}
              </EditableText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — brass grandfather clock with Roman numerals + live analog hands
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const tz = config.timezone || undefined;
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).format(now);
  const [hh, mm, ss] = fmt.split(':').map(Number);
  const hourAngle   = ((hh % 12) + mm / 60) * 30;
  const minuteAngle = mm * 6;
  const secondAngle = ss * 6;

  const cx = 200, cy = 200, r = 178;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <svg viewBox="0 0 400 460" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 12px 28px ${SCD.shadow})`, overflow: 'visible' }}>
        {/* Case / pediment */}
        <rect x="10" y="380" width="380" height="70" rx="8" fill={SCD.navyDark} stroke={SCD.gold} strokeWidth="4" />
        <rect x="30" y="360" width="340" height="30" rx="4" fill={SCD.navy} stroke={SCD.gold} strokeWidth="3" />
        {/* Arch top */}
        <path d="M 40 40 Q 200 0 360 40 L 360 60 Q 200 20 40 60 Z" fill={SCD.gold} />
        {/* Clock body */}
        <rect x="20" y="55" width="360" height="340" rx="10" fill={SCD.navy} stroke={SCD.gold} strokeWidth="6" />
        {/* Parchment dial */}
        <circle cx={cx} cy={cy} r={r} fill={SCD.parchment} stroke={SCD.gold} strokeWidth="8" />
        <circle cx={cx} cy={cy} r={r - 12} fill="none" stroke={SCD.parchmentDark} strokeWidth="2" />
        {/* Hour tick marks + Roman numerals */}
        {ROMAN.map(([h, numeral]) => {
          const angleDeg = h * 30 - 90;
          const rad = angleDeg * Math.PI / 180;
          const tx = cx + Math.cos(rad) * (r - 30);
          const ty = cy + Math.sin(rad) * (r - 30);
          const ix = cx + Math.cos(rad) * (r - 14);
          const iy = cy + Math.sin(rad) * (r - 14);
          const ox = cx + Math.cos(rad) * (r - 6);
          const oy = cy + Math.sin(rad) * (r - 6);
          return (
            <g key={h}>
              <line x1={ix} y1={iy} x2={ox} y2={oy} stroke={SCD.navyDark} strokeWidth="3" strokeLinecap="round" />
              <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central"
                fontFamily={SCD_FONT_DISPLAY} fontSize="14" fill={SCD.ink} fontWeight="600">
                {numeral}
              </text>
            </g>
          );
        })}
        {/* Minute ticks */}
        {Array.from({ length: 60 }).map((_, i) => {
          if (i % 5 === 0) return null;
          const rad = (i * 6 - 90) * Math.PI / 180;
          return (
            <line key={i}
              x1={cx + Math.cos(rad) * (r - 6)} y1={cy + Math.sin(rad) * (r - 6)}
              x2={cx + Math.cos(rad) * (r - 14)} y2={cy + Math.sin(rad) * (r - 14)}
              stroke={SCD.inkSoft} strokeWidth="1.5" strokeLinecap="round" />
          );
        })}
        {/* Hour hand */}
        <g transform={`rotate(${hourAngle} ${cx} ${cy})`}>
          <line x1={cx} y1={cy + 20} x2={cx} y2={cy - 100}
            stroke={SCD.navyDark} strokeWidth="10" strokeLinecap="round" />
        </g>
        {/* Minute hand */}
        <g transform={`rotate(${minuteAngle} ${cx} ${cy})`}>
          <line x1={cx} y1={cy + 28} x2={cx} y2={cy - 138}
            stroke={SCD.navy} strokeWidth="7" strokeLinecap="round" />
        </g>
        {/* Second hand */}
        <g transform={`rotate(${secondAngle} ${cx} ${cy})`}>
          <line x1={cx} y1={cy + 36} x2={cx} y2={cy - 155}
            stroke={SCD.maroon} strokeWidth="3" strokeLinecap="round" />
        </g>
        {/* Center cap */}
        <circle cx={cx} cy={cy} r="10" fill={SCD.gold} stroke={SCD.navyDark} strokeWidth="3" />
        <circle cx={cx} cy={cy} r="4" fill={SCD.navyDark} />
        {/* Pendulum rod */}
        {!compact && (
          <>
            <rect x="197" y="375" width="6" height="55" rx="3" fill={SCD.gold} />
            <ellipse cx="200" cy="434" rx="20" ry="14" fill={SCD.goldLight} stroke={SCD.gold} strokeWidth="3" />
          </>
        )}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — parchment card with 6 engraving-style icons
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownWeather({ config, compact }: { config: any; compact?: boolean }) {
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
  // isPartly = anything else

  // Classic engraving icons
  const SunIcon = (
    <g stroke={SCD.gold} strokeWidth="5" strokeLinecap="round" fill="none">
      <circle cx="200" cy="170" r="60" fill={SCD.goldLight} stroke={SCD.gold} strokeWidth="6" />
      {[0,45,90,135,180,225,270,315].map((a, i) => {
        const rad = a * Math.PI / 180;
        return <line key={i} x1={200 + Math.cos(rad)*70} y1={170 + Math.sin(rad)*70}
          x2={200 + Math.cos(rad)*95} y2={170 + Math.sin(rad)*95} stroke={SCD.gold} strokeWidth="5" />;
      })}
    </g>
  );
  const CloudIcon = (
    <path d="M 100 220 Q 80 220 80 195 Q 80 168 110 168 Q 118 130 160 130 Q 195 110 230 140 Q 268 140 280 180 Q 320 180 320 215 Q 320 250 280 250 L 140 250 Q 100 250 100 220Z"
      fill={SCD.parchmentDark} stroke={SCD.navyDark} strokeWidth="5" />
  );
  const PartlyIcon = (
    <g>
      <circle cx="265" cy="120" r="50" fill={SCD.goldLight} stroke={SCD.gold} strokeWidth="5" />
      {[0,60,120,180,240,300].map((a, i) => {
        const rad = a * Math.PI / 180;
        return <line key={i} x1={265 + Math.cos(rad)*58} y1={120 + Math.sin(rad)*58}
          x2={265 + Math.cos(rad)*76} y2={120 + Math.sin(rad)*76} stroke={SCD.gold} strokeWidth="4" />;
      })}
      {CloudIcon}
    </g>
  );
  const RainIcon = (
    <g>
      {CloudIcon}
      {[[150,270],[185,290],[220,270],[255,292],[290,274]].map(([x,y],i) => (
        <line key={i} x1={x} y1={y} x2={x-8} y2={y+32} stroke={SCD.navy} strokeWidth="5" strokeLinecap="round" />
      ))}
    </g>
  );
  const SnowIcon = (
    <g>
      {CloudIcon}
      {[[155,275],[190,295],[225,275],[260,295],[295,275]].map(([x,y],i) => (
        <g key={i} stroke={SCD.navy} strokeWidth="4" strokeLinecap="round">
          <line x1={x-12} y1={y} x2={x+12} y2={y} />
          <line x1={x} y1={y-12} x2={x} y2={y+12} />
          <line x1={x-8} y1={y-8} x2={x+8} y2={y+8} />
          <line x1={x-8} y1={y+8} x2={x+8} y2={y-8} />
        </g>
      ))}
    </g>
  );
  const StormIcon = (
    <g>
      {CloudIcon}
      <path d="M 185 255 L 220 255 L 195 305 L 225 305 L 165 370 L 195 298 L 168 298 Z"
        fill={SCD.gold} stroke={SCD.navyDark} strokeWidth="4" strokeLinejoin="round" />
    </g>
  );

  const icon = isSnow ? SnowIcon : isStorm ? StormIcon : isRain ? RainIcon : isOvercast ? CloudIcon : isClear ? SunIcon : PartlyIcon;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 400 500" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: `drop-shadow(0 10px 22px ${SCD.shadow})`, position: 'absolute', inset: 0 }}>
          {/* Parchment card */}
          <rect x="10" y="10" width="380" height="480" rx="16"
            fill={SCD.parchment} stroke={SCD.parchmentDark} strokeWidth="3" />
          <rect x="18" y="18" width="364" height="464" rx="12"
            fill="none" stroke={SCD.gold} strokeWidth="2" strokeDasharray="8 5" />
          {/* Weather icon area (top 75%) */}
          <g>{icon}</g>
          {/* Gold divider */}
          <line x1="30" y1="360" x2="370" y2="360" stroke={SCD.gold} strokeWidth="3" />
        </svg>
        {/* Temp + condition in bottom 30% */}
        <div style={{
          position: 'absolute',
          left: '8%', right: '8%', top: '70%', bottom: '6%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SCD_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 62%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={140} min={14} wrap={false}
              style={{ fontWeight: 700, color: SCD.navyDark, letterSpacing: '-0.02em' }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 38%', minHeight: 0 }}>
              <FitText max={60} min={9} wrap={false}
                style={{ fontFamily: SCD_FONT_SCRIPT, color: SCD.inkSoft }}>
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
// COUNTDOWN — HUGE gold-foil count on dark banner, tassels
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 285 * 86400000);
  const label    = config.label || resolved?.prefix || 'DAYS UNTIL GRADUATION';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HOUR' : 'HOURS');

  // Tassel SVG helper at a corner
  const Tassel = ({ x, y, flip }: { x: number; y: number; flip?: boolean }) => {
    const sign = flip ? -1 : 1;
    return (
      <g>
        <line x1={x} y1={y} x2={x + sign * 18} y2={y + 50} stroke={SCD.gold} strokeWidth="4" strokeLinecap="round" />
        {[-12, -6, 0, 6, 12].map((dx, i) => (
          <line key={i}
            x1={x + sign * 18 + dx} y1={y + 50}
            x2={x + sign * 18 + dx * 0.5} y2={y + 100}
            stroke={SCD.goldLight} strokeWidth="2.5" strokeLinecap="round" />
        ))}
        <circle cx={x} cy={y} r="10" fill={SCD.gold} stroke={SCD.navyDark} strokeWidth="3" />
      </g>
    );
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 900 560" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: `drop-shadow(0 18px 36px ${SCD.shadow})`, position: 'absolute', inset: 0 }}>
          {/* Dark banner with gold border */}
          <rect x="10" y="30" width="880" height="500" rx="18"
            fill={SCD.navyDark} stroke={SCD.gold} strokeWidth="8" />
          <rect x="22" y="42" width="856" height="476" rx="12"
            fill="none" stroke={SCD.goldLight} strokeWidth="2" strokeDasharray="10 6" />
          {/* Corner tassels */}
          <Tassel x={55} y={60} />
          <Tassel x={845} y={60} flip />
        </svg>
        {/* Text — label / number / unit */}
        <div style={{
          position: 'absolute',
          inset: '8% 8% 10% 8%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SCD_FONT_DISPLAY, color: SCD.goldLight,
          textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 20%', minHeight: 0 }}>
            <EditableText configKey="label" onConfigChange={onConfigChange}
              max={70} min={8} wrap={false}
              style={{
                fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: SCD.parchmentDark,
                textShadow: `1px 1px 6px ${SCD.navyDark}`,
              }}>
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 58%', minHeight: 0 }}>
            <FitText max={360} min={28} wrap={false}
              style={{
                fontWeight: 700,
                color: SCD.goldLight,
                textShadow: `0 4px 18px rgba(201,162,39,0.8), 0 2px 4px ${SCD.navyDark}`,
              }}>
              {bigNum}
            </FitText>
          </div>
          <div style={{ flex: '0 0 22%', minHeight: 0 }}>
            <FitText max={80} min={8} wrap={false}
              style={{
                fontWeight: 400, letterSpacing: '0.2em',
                color: SCD.gold,
                textShadow: `1px 1px 6px ${SCD.navyDark}`,
              }}>
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — rolled diploma scroll with ribbon seal
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const message = config.message || config.body || 'Senior Portraits — bring your cap & gown!';
  const date    = config.date || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 1800 520" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: `drop-shadow(0 16px 30px ${SCD.shadow})`, position: 'absolute', inset: 0 }}>
          {/* Scroll end-caps (rolled tube) */}
          <ellipse cx="50" cy="260" rx="50" ry="255" fill={SCD.parchmentDark} stroke={SCD.gold} strokeWidth="5" />
          <ellipse cx="50" cy="260" rx="35" ry="240" fill={SCD.parchment} />
          <ellipse cx="1750" cy="260" rx="50" ry="255" fill={SCD.parchmentDark} stroke={SCD.gold} strokeWidth="5" />
          <ellipse cx="1750" cy="260" rx="35" ry="240" fill={SCD.parchment} />
          {/* Main scroll body */}
          <rect x="50" y="5" width="1700" height="510" fill={SCD.parchment} />
          {/* Top + bottom edge shadow lines */}
          <line x1="50" y1="20" x2="1750" y2="20" stroke={SCD.parchmentDark} strokeWidth="3" />
          <line x1="50" y1="500" x2="1750" y2="500" stroke={SCD.parchmentDark} strokeWidth="3" />
          {/* Gold border */}
          <rect x="70" y="24" width="1660" height="472" rx="4"
            fill="none" stroke={SCD.gold} strokeWidth="3" strokeDasharray="14 6" />
          {/* Ribbon seal */}
          <circle cx="1620" cy="400" r="58" fill={SCD.maroon} stroke={SCD.gold} strokeWidth="5" />
          <circle cx="1620" cy="400" r="44" fill={SCD.maroon} stroke={SCD.goldLight} strokeWidth="2" />
          <text x="1620" y="408" textAnchor="middle" dominantBaseline="middle"
            fontFamily={SCD_FONT_DISPLAY} fontSize="16" fill={SCD.goldLight} fontWeight="700" letterSpacing="2">
            OFFICIAL
          </text>
          {/* Ribbon tails below seal */}
          <polygon points="1590,456 1605,510 1620,485 1635,510 1650,456" fill={SCD.maroon} />
        </svg>
        {/* Scroll content */}
        <div style={{
          position: 'absolute',
          top: '8%', left: '6%', right: '18%', bottom: '8%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SCD_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact && date ? '1 1 82%' : '1 1 100%', minHeight: 0 }}>
            <EditableText configKey="message" onConfigChange={onConfigChange}
              max={300} min={12}
              style={{ fontWeight: 400, color: SCD.ink, letterSpacing: '0.01em' }}>
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 20%', minHeight: 0 }}>
              <EditableText configKey="date" onConfigChange={onConfigChange} max={100} min={10} wrap={false}
                style={{ fontFamily: SCD_FONT_SCRIPT, color: SCD.maroon }}>{date}</EditableText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — 3 graduation-event cards with calligraphic dates
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events?.length ? config.events : [
    { date: 'MAY 17 · 7PM',  title: 'Prom Night' },
    { date: 'JUNE 3–7',      title: 'Senior Trip' },
    { date: 'JUNE 14 · 10AM', title: 'Graduation' },
  ]).slice(0, Math.max(1, Math.min(6, config.maxEvents ?? 3)));

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4%', gap: '3%' }}>
      {events.map((e: any, i: number) => (
        <div key={i} style={{
          position: 'relative',
          flex: 1, minHeight: 0,
          background: i === 2 ? SCD.navyDark : i === 1 ? SCD.navy : SCD.parchment,
          border: `5px solid ${SCD.gold}`,
          borderRadius: 10,
          boxShadow: `0 6px 20px ${SCD.shadow}`,
          display: 'flex', alignItems: 'center',
          gap: '2%', padding: '0 2.5%',
          overflow: 'hidden',
        }}>
          {/* Gold ribbon accent on left */}
          <div style={{
            width: '8px', height: '80%',
            background: `linear-gradient(180deg, ${SCD.goldLight}, ${SCD.gold})`,
            borderRadius: 4, flexShrink: 0,
          }} />
          {/* Date + title */}
          <div style={{
            flex: 1, minWidth: 0, height: '90%',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <div style={{ flex: '0 0 40%', minHeight: 0 }}>
              <FitText max={200} min={8} wrap={false} center={false}
                style={{ fontFamily: SCD_FONT_SCRIPT, color: i === 0 ? SCD.maroon : SCD.goldLight }}>
                {e.date}
              </FitText>
            </div>
            <div style={{ flex: '1 1 60%', minHeight: 0 }}>
              <FitText max={320} min={10} wrap={false} center={false}
                style={{
                  fontFamily: SCD_FONT_DISPLAY, fontWeight: 700,
                  color: i === 0 ? SCD.navyDark : SCD.parchment,
                  letterSpacing: '0.02em',
                }}>
                {e.title}
              </FitText>
            </div>
          </div>
          {/* Mortarboard badge on rightmost event */}
          {i === 2 && (
            <svg viewBox="0 0 60 50" width="14%" height="80%" style={{ flexShrink: 0, opacity: 0.85 }}>
              <polygon points="30,5 55,18 30,31 5,18" fill={SCD.gold} />
              <rect x="14" y="18" width="32" height="20" rx="3" fill={SCD.gold} />
              <line x1="50" y1="18" x2="55" y2="34" stroke={SCD.goldLight} strokeWidth="3" strokeLinecap="round" />
              <circle cx="55" cy="36" r="4" fill={SCD.goldLight} />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — academic portrait, gold frame + laurel
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name    = config.staffName || config.name || 'Mr. Harrison';
  const role    = config.role || 'Senior Class Advisor';
  const quote   = config.bio || config.quote || '"The tassel is worth the hassle."';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: SCD.parchment,
        borderRadius: 16,
        border: `8px solid ${SCD.gold}`,
        boxShadow: `0 0 0 3px ${SCD.navyDark}, 0 16px 40px ${SCD.shadow}`,
        padding: '6% 5%',
        display: 'flex', gap: '5%', alignItems: 'center',
        fontFamily: SCD_FONT_DISPLAY,
      }}>
        {/* Laurel wreath header */}
        <div style={{
          position: 'absolute', top: '-6%', left: '50%', transform: 'translateX(-50%)',
          background: SCD.gold, borderRadius: 20, padding: '2% 5%',
          border: `3px solid ${SCD.navyDark}`,
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontFamily: SCD_FONT_BODY, fontSize: 'clamp(8px, 1.6cqh, 14px)', fontWeight: 700, color: SCD.navyDark, letterSpacing: '0.1em' }}>
            ❧ FACULTY SPOTLIGHT ❧
          </span>
        </div>
        {/* Portrait frame */}
        <div style={{
          flexShrink: 0, width: '36%', aspectRatio: '1',
          background: SCD.navyDark,
          border: `6px solid ${SCD.gold}`,
          boxShadow: `inset 0 0 0 2px ${SCD.goldLight}, 0 8px 0 ${SCD.navyDark}`,
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg viewBox="0 0 100 100" width="70%" height="70%">
              <circle cx="50" cy="38" r="26" fill={SCD.parchmentDark} />
              <path d="M 10 100 Q 10 68 50 68 Q 90 68 90 100" fill={SCD.parchmentDark} />
            </svg>
          )}
        </div>
        {/* Text */}
        <div style={{ flex: 1, minWidth: 0, height: '88%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ flex: '0 0 20%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={70} min={8} wrap={false} center={false}
              style={{ fontWeight: 400, color: SCD.maroon, letterSpacing: '0.06em', fontStyle: 'italic' }}>
              {role}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 36%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={200} min={10} wrap={false} center={false}
              style={{ fontWeight: 700, color: SCD.navyDark, letterSpacing: '0.02em' }}>
              {name}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 44%', minHeight: 0 }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={90} min={9} center={false}
              style={{ fontFamily: SCD_FONT_SCRIPT, color: SCD.inkSoft }}>
              {quote}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — gold picture frame with nameplate
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0 ? config.urls : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);
  const caption = config.caption || 'Class of 2027';

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '4%' }}>
      {/* Frame */}
      <div style={{
        position: 'relative', flex: '1 1 85%', width: '100%', minHeight: 0,
        border: `10px solid ${SCD.gold}`,
        boxShadow: `0 0 0 4px ${SCD.navyDark}, 0 0 0 8px ${SCD.goldLight}, 0 20px 40px ${SCD.shadow}`,
        background: SCD.navyDark,
        overflow: 'hidden',
      }}>
        {/* Frame corner ornaments (SVG overlay) */}
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }} width="100%" height="100%">
          {[['0%','0%','8 0 0 8'],['100%','0%','-8 0 0 8'],['0%','100%','8 0 0 -8'],['100%','100%','-8 0 0 -8']].map(([x,y,r],i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${r})`} opacity="0.9">
              <path d="M 0 30 L 0 0 L 30 0" stroke={SCD.goldLight} strokeWidth="3" fill="none" />
            </g>
          ))}
        </svg>
        {hasImage ? (
          <img src={resolveUrl(urls[idx])} alt={caption}
            className="transition-opacity duration-700"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `linear-gradient(135deg, ${SCD.navy} 0%, ${SCD.navyDark} 100%)`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontFamily: SCD_FONT_DISPLAY, color: SCD.parchmentDark, textAlign: 'center', padding: '8%',
          }}>
            <div style={{ fontSize: 'clamp(28px, 20cqh, 100px)', opacity: 0.4 }}>🎓</div>
            <div style={{ fontSize: 'clamp(10px, 5cqh, 28px)', fontWeight: 600, marginTop: '4%' }}>
              Add class photos
            </div>
          </div>
        )}
      </div>
      {/* Nameplate */}
      <div style={{
        flex: '0 0 13%', width: '70%', minHeight: 0,
        background: `linear-gradient(90deg, ${SCD.navyDark}, ${SCD.navy}, ${SCD.navyDark})`,
        border: `3px solid ${SCD.gold}`,
        borderTop: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 4%',
      }}>
        <FitText max={60} min={8} wrap={false}
          style={{ fontFamily: SCD_FONT_DISPLAY, fontWeight: 600, color: SCD.goldLight, letterSpacing: '0.12em' }}>
          {caption}
        </FitText>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — elegant parchment banner strip, italic serif
// ═══════════════════════════════════════════════════════════
export function SeniorCountdownTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length ? config.messages : ['✦ Senior Sunrise — Friday 6:00 AM on the front steps ✦'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 12 : 7;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
      {/* Parchment banner SVG */}
      <svg viewBox="0 0 3200 180" width="100%" height="100%" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0 }}>
        {/* Main parchment strip */}
        <rect x="0" y="20" width="3200" height="140" fill={SCD.parchment} />
        {/* Top gold rule */}
        <line x1="0" y1="22" x2="3200" y2="22" stroke={SCD.gold} strokeWidth="6" />
        {/* Bottom gold rule */}
        <line x1="0" y1="158" x2="3200" y2="158" stroke={SCD.gold} strokeWidth="6" />
        {/* Fine inner rules */}
        <line x1="0" y1="32" x2="3200" y2="32" stroke={SCD.parchmentDark} strokeWidth="2" />
        <line x1="0" y1="148" x2="3200" y2="148" stroke={SCD.parchmentDark} strokeWidth="2" />
        {/* Left curl */}
        <ellipse cx="0" cy="90" rx="20" ry="70" fill={SCD.parchmentDark} />
        <ellipse cx="0" cy="90" rx="10" ry="58" fill={SCD.parchment} opacity="0.6" />
        {/* Right curl */}
        <ellipse cx="3200" cy="90" rx="20" ry="70" fill={SCD.parchmentDark} />
        <ellipse cx="3200" cy="90" rx="10" ry="58" fill={SCD.parchment} opacity="0.6" />
        {/* Decorative gold diamond dividers */}
        {[400,800,1200,1600,2000,2400,2800].map(x => (
          <polygon key={x} points={`${x},78 ${x+14},90 ${x},102 ${x-14},90`}
            fill={SCD.gold} opacity="0.5" />
        ))}
      </svg>
      {/* Message text */}
      <div style={{
        position: 'absolute', left: '3%', right: '3%', top: '14%', bottom: '14%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: SCD_FONT_DISPLAY,
        fontSize: compact ? '1.1em' : '1.5em',
        color: SCD.navyDark,
        fontStyle: 'italic',
        fontWeight: 500,
        letterSpacing: '0.04em',
        textAlign: 'center',
        textShadow: `0 1px 2px ${SCD.parchmentDark}`,
      }}>
        {primary}
      </div>
    </div>
  );
}
