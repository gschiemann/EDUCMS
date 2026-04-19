"use client";

/**
 * Spirit Rally — middle-school pep-rally lobby theme.
 *
 * Stadium bleachers backdrop, HYPE energy, megaphones, foam-finger
 * pointers, spotlight beams, confetti bursts, big bold sports type.
 *
 *   - LOGO             → foam-finger pointer + circular school shield
 *   - TEXT / RICH_TEXT → megaphone-shape banner + handwriting subtitle
 *   - CLOCK            → scoreboard-style digital clock + live analog hands
 *   - WEATHER          → pennant flag with 6-bucket condition icons
 *   - COUNTDOWN        → foam-finger pointing at "DAYS TO GO" starburst
 *   - ANNOUNCEMENT     → ribbon-banner across a stadium-light spotlight beam
 *   - CALENDAR         → pom-pom pill cards with colored top/bottom fringes
 *   - STAFF_SPOTLIGHT  → "PLAYER CARD" trading-card style with photo frame
 *   - IMAGE_CAROUSEL   → jumbotron-style frame with glowing LED bezel
 *   - TICKER           → stadium scoreboard LED strip, amber on ink
 */

import { useEffect, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ─── Palette ────────────────────────────────────────────────
export const SR = {
  navy:     '#1A365D',
  gold:     '#F6E05E',
  goldDark: '#D69E2E',
  red:      '#C53030',
  white:    '#FFFFFF',
  ink:      '#0B1A2A',
  spotlight: 'rgba(246,224,94,0.35)',
  shadow:    'rgba(26,54,93,0.4)',
};

export const SR_FONT_DISPLAY = "'Bungee', 'Bebas Neue', system-ui, sans-serif";
export const SR_FONT_BODY    = "'Fredoka', system-ui, sans-serif";
export const SR_FONT_SCRIPT  = "'Caveat', cursive";

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ═══════════════════════════════════════════════════════════
// LOGO — foam-finger pointer + circular school shield
// ═══════════════════════════════════════════════════════════
export function SpiritRallyLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'GO').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'GO');
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'transparent', padding: '6%' }}>
      <svg viewBox="0 0 320 320" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.45))', overflow: 'visible' }}>
        {/* Foam finger pointing up — left of shield */}
        <g transform="translate(20 160) rotate(-20)">
          {/* Finger glove body */}
          <rect x="0" y="-30" width="56" height="100" rx="14" fill={SR.gold} stroke={SR.ink} strokeWidth="4" />
          {/* Extended pointer finger */}
          <rect x="8" y="-90" width="26" height="70" rx="13" fill={SR.gold} stroke={SR.ink} strokeWidth="4" />
          {/* Fingernail */}
          <ellipse cx="21" cy="-85" rx="8" ry="5" fill={SR.white} stroke={SR.ink} strokeWidth="2" />
          {/* "#1" text on glove */}
          <text x="28" y="50" textAnchor="middle" fontFamily={SR_FONT_DISPLAY} fontSize="20" fill={SR.red} stroke={SR.ink} strokeWidth="1" paintOrder="stroke">#1</text>
        </g>

        {/* Shield background */}
        <path d="M160 28 L236 56 L236 160 Q236 220 160 256 Q84 220 84 160 L84 56 Z"
          fill={SR.navy} stroke={SR.gold} strokeWidth="8" />
        {/* Shield gold inner border */}
        <path d="M160 44 L222 68 L222 160 Q222 208 160 240 Q98 208 98 160 L98 68 Z"
          fill="none" stroke={SR.goldDark} strokeWidth="3" strokeDasharray="8 4" />

        {/* Megaphone icon inside shield */}
        <g transform="translate(160 148)">
          {/* Megaphone cone */}
          <polygon points="-12,-28 -12,28 40,48 40,-48" fill={SR.gold} stroke={SR.ink} strokeWidth="3" />
          {/* Megaphone handle */}
          <rect x="-36" y="-16" width="26" height="32" rx="8" fill={SR.red} stroke={SR.ink} strokeWidth="3" />
          {/* Sound waves */}
          <path d="M44 -20 Q62 0 44 20" fill="none" stroke={SR.white} strokeWidth="4" strokeLinecap="round" />
          <path d="M52 -32 Q78 0 52 32" fill="none" stroke={SR.white} strokeWidth="3" strokeLinecap="round" />
        </g>

        {/* Logo image overlay — clips to shield interior */}
        {photoUrl && (
          <image href={resolveUrl(photoUrl)} x="98" y="56" width="124" height="184"
            preserveAspectRatio="xMidYMid slice"
            clipPath="path('M160 44 L222 68 L222 160 Q222 208 160 240 Q98 208 98 160 L98 68 Z')" />
        )}

        {/* Initials rendered over shield when no photo */}
        {!photoUrl && (
          <text x="160" y="220" textAnchor="middle"
            fontFamily={SR_FONT_DISPLAY} fontSize="28" fontWeight="900"
            fill={SR.gold} stroke={SR.ink} strokeWidth="2" paintOrder="stroke">
            {initials}
          </text>
        )}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — megaphone-shape banner + handwriting subtitle
// ═══════════════════════════════════════════════════════════
export function SpiritRallyText({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'LET\'S GO EAGLES!';
  const subtitle = config.subtitle || 'rally day · be loud · be proud';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2% 1%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Megaphone-shaped SVG banner */}
        <svg viewBox="0 0 3200 400" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: 'drop-shadow(0 14px 22px rgba(0,0,0,0.45))', position: 'absolute', inset: 0 }}>
          {/* Megaphone cone on left — wide mouth */}
          <polygon points="0,200 220,60 220,340" fill={SR.red} stroke={SR.ink} strokeWidth="8" />
          {/* Megaphone handle box */}
          <rect x="220" y="120" width="160" height="160" rx="24" fill={SR.red} stroke={SR.ink} strokeWidth="8" />
          {/* Sound waves from right side */}
          <path d="M3140 120 Q3200 200 3140 280" fill="none" stroke={SR.gold} strokeWidth="16" strokeLinecap="round" />
          <path d="M3100 80 Q3200 200 3100 320" fill="none" stroke={SR.goldDark} strokeWidth="12" strokeLinecap="round" />
          {/* Main banner body */}
          <rect x="380" y="0" width="2740" height="400" fill={SR.navy} />
          {/* Gold top stripe */}
          <rect x="380" y="0" width="2740" height="28" fill={SR.gold} />
          {/* Gold bottom stripe */}
          <rect x="380" y="372" width="2740" height="28" fill={SR.gold} />
          {/* Red side accent */}
          <rect x="380" y="28" width="18" height="344" fill={SR.red} />
          <rect x="3102" y="28" width="18" height="344" fill={SR.red} />
          {/* Corner confetti bursts */}
          <polygon points="398,28 448,28 398,78" fill={SR.gold} />
          <polygon points="3102,28 3052,28 3102,78" fill={SR.gold} />
        </svg>

        {/* Text overlaid on the banner body: x:398–3102 of 3200, y:28–372 */}
        <div style={{
          position: 'absolute',
          left: '12.5%', right: '3%', top: '7%', bottom: '7%',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 68%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={200} min={12} wrap={false}
              style={{
                fontFamily: SR_FONT_DISPLAY,
                fontWeight: 900,
                color: SR.gold,
                textShadow: `3px 3px 0 ${SR.ink}, 6px 6px 0 ${SR.red}`,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {content}
            </EditableText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 32%', minHeight: 0 }}>
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={120} min={9} wrap={false}
                style={{
                  fontFamily: SR_FONT_SCRIPT,
                  color: SR.white,
                  textShadow: `1px 1px 0 ${SR.navy}`,
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
// CLOCK — scoreboard-style digital + live analog hands
// ═══════════════════════════════════════════════════════════
export function SpiritRallyClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined;
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: tz,
  }).format(now);
  const timeNoSec = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(now);

  // Analog hand angles
  const s = now.getSeconds();
  const m = now.getMinutes();
  const h = now.getHours() % 12;
  const secDeg  = s * 6;
  const minDeg  = m * 6 + s * 0.1;
  const hourDeg = h * 30 + m * 0.5;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Scoreboard frame */}
        <svg viewBox="0 0 700 460" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.55))' }}>
          {/* Outer scoreboard housing */}
          <rect x="10" y="10" width="680" height="440" rx="24" fill={SR.ink} stroke={SR.gold} strokeWidth="8" />
          {/* LED-style inner panel */}
          <rect x="30" y="30" width="640" height="280" rx="12" fill="#0A1525" stroke={SR.goldDark} strokeWidth="4" />
          {/* Bottom section for analog overlay */}
          <rect x="30" y="330" width="640" height="100" rx="12" fill="#0A1525" stroke={SR.goldDark} strokeWidth="3" />
          {/* Team color stripes */}
          <rect x="10" y="10" width="680" height="14" rx="12" fill={SR.red} />
          <rect x="10" y="436" width="680" height="14" rx="12" fill={SR.red} />
          {/* Gold corner bolts */}
          {[[42,42],[658,42],[42,418],[658,418]].map(([cx,cy],i) => (
            <circle key={i} cx={cx} cy={cy} r="10" fill={SR.goldDark} stroke={SR.ink} strokeWidth="2" />
          ))}
          {/* Analog clock face inside lower section */}
          <circle cx="350" cy="380" r="42" fill="#0d1e36" stroke={SR.gold} strokeWidth="3" />
          {/* Hour markers */}
          {Array.from({ length: 12 }).map((_, i) => {
            const ang = (i * 30 - 90) * Math.PI / 180;
            const r1 = 34, r2 = 40;
            return <line key={i}
              x1={350 + Math.cos(ang) * r1} y1={380 + Math.sin(ang) * r1}
              x2={350 + Math.cos(ang) * r2} y2={380 + Math.sin(ang) * r2}
              stroke={SR.goldDark} strokeWidth="2" />;
          })}
          {/* Hour hand */}
          <line
            x1="350" y1="380"
            x2={350 + Math.cos((hourDeg - 90) * Math.PI / 180) * 22}
            y2={380 + Math.sin((hourDeg - 90) * Math.PI / 180) * 22}
            stroke={SR.white} strokeWidth="5" strokeLinecap="round" />
          {/* Minute hand */}
          <line
            x1="350" y1="380"
            x2={350 + Math.cos((minDeg - 90) * Math.PI / 180) * 30}
            y2={380 + Math.sin((minDeg - 90) * Math.PI / 180) * 30}
            stroke={SR.gold} strokeWidth="3" strokeLinecap="round" />
          {/* Second hand */}
          <line
            x1="350" y1="380"
            x2={350 + Math.cos((secDeg - 90) * Math.PI / 180) * 34}
            y2={380 + Math.sin((secDeg - 90) * Math.PI / 180) * 34}
            stroke={SR.red} strokeWidth="2" strokeLinecap="round" />
          {/* Center dot */}
          <circle cx="350" cy="380" r="5" fill={SR.gold} />
        </svg>

        {/* Digital time — displayed inside the LED panel area */}
        <div style={{
          position: 'absolute',
          left: '5%', right: '5%', top: '8%', bottom: '42%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: SR_FONT_DISPLAY,
        }}>
          <FitText max={160} min={14} wrap={false}
            style={{
              color: SR.gold,
              fontWeight: 900,
              letterSpacing: '0.06em',
              textShadow: `0 0 20px ${SR.gold}, 0 0 40px rgba(246,224,94,0.4)`,
              fontVariantNumeric: 'tabular-nums',
            }}>
            {compact ? timeNoSec : time}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — pennant flag with 6-bucket condition icons
// ═══════════════════════════════════════════════════════════
export function SpiritRallyWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => {
    fetchWeather(location, isCelsius).then(setWeather);
  }, [location, isCelsius]);

  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  const low       = (cond || '').toLowerCase();
  const isSnow    = low.includes('snow') || low.includes('flurr');
  const isStorm   = low.includes('storm') || low.includes('thunder');
  const isRain    = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast= !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear   = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  const isPartly  = !isClear && !isOvercast && !isRain && !isSnow && !isStorm;

  // Condition icon SVG group (rendered inside pennant)
  const SunIcon = (
    <g transform="translate(470 200)">
      <circle r="52" fill={SR.gold} stroke={SR.ink} strokeWidth="4" />
      {[0,45,90,135,180,225,270,315].map((a,i) => {
        const r = Math.PI * a / 180;
        return <line key={i} x1={Math.cos(r)*58} y1={Math.sin(r)*58} x2={Math.cos(r)*74} y2={Math.sin(r)*74}
          stroke={SR.gold} strokeWidth="6" strokeLinecap="round" />;
      })}
    </g>
  );
  const CloudIcon = (
    <g transform="translate(470 200)">
      <ellipse cx="-10" cy="10" rx="52" ry="36" fill={SR.white} stroke={SR.ink} strokeWidth="4" />
      <ellipse cx="20" cy="-8" rx="34" ry="28" fill={SR.white} stroke={SR.ink} strokeWidth="4" />
    </g>
  );
  const SunCloudIcon = (
    <g transform="translate(470 200)">
      <circle cx="-14" cy="-18" r="36" fill={SR.gold} stroke={SR.ink} strokeWidth="3" />
      <ellipse cx="14" cy="16" rx="50" ry="32" fill={SR.white} stroke={SR.ink} strokeWidth="4" />
    </g>
  );
  const RainIcon = (
    <g transform="translate(470 200)">
      <ellipse cx="0" cy="-20" rx="50" ry="34" fill="#8ab4c8" stroke={SR.ink} strokeWidth="4" />
      {[[-28,30],[-10,46],[8,30],[26,46]].map(([x,y],i) => (
        <line key={i} x1={x} y1={y} x2={x-6} y2={y+20} stroke="#67B8FF" strokeWidth="5" strokeLinecap="round" />
      ))}
    </g>
  );
  const SnowIcon = (
    <g transform="translate(470 200)">
      <ellipse cx="0" cy="-20" rx="50" ry="34" fill="#c8d8e8" stroke={SR.ink} strokeWidth="4" />
      {[[-24,30],[0,38],[24,30],[-12,50],[12,50]].map(([x,y],i) => (
        <g key={i}>
          <line x1={x} y1={y-8} x2={x} y2={y+8} stroke={SR.white} strokeWidth="4" strokeLinecap="round" />
          <line x1={x-7} y1={y} x2={x+7} y2={y} stroke={SR.white} strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
  const StormIcon = (
    <g transform="translate(470 200)">
      <ellipse cx="0" cy="-24" rx="50" ry="32" fill="#556" stroke={SR.ink} strokeWidth="4" />
      <polygon points="-8,16 16,16 2,42 20,42 -18,72 -4,44 -22,44" fill={SR.gold} stroke={SR.ink} strokeWidth="3" strokeLinejoin="round" />
    </g>
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.4))' }}>
          {/* Pennant flag body */}
          <polygon points="40,20 640,200 40,380" fill={SR.navy} stroke={SR.gold} strokeWidth="8" />
          {/* Inner pennant detail stripe */}
          <polygon points="40,60 580,200 40,340" fill={SR.red} stroke="none" opacity="0.35" />
          {/* Pole */}
          <rect x="20" y="10" width="24" height="380" rx="8" fill={SR.goldDark} stroke={SR.ink} strokeWidth="4" />
          <ellipse cx="32" cy="12" rx="16" ry="10" fill={SR.gold} stroke={SR.ink} strokeWidth="3" />
          {/* Team name arc text area — decorative lines */}
          <path d="M100 140 Q280 100 460 200" fill="none" stroke={SR.gold} strokeWidth="2" strokeDasharray="6 4" opacity="0.5" />
          {/* Condition icon */}
          {isClear    && SunIcon}
          {isPartly   && SunCloudIcon}
          {isOvercast && CloudIcon}
          {isRain     && RainIcon}
          {isSnow     && SnowIcon}
          {isStorm    && StormIcon}
        </svg>

        {/* Temp + condition text overlaid in pennant's safe left zone */}
        <div style={{
          position: 'absolute',
          left: '8%', right: '40%', top: '20%', bottom: '20%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SR_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 62%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={140} min={12} wrap={false}
              style={{
                fontWeight: 900,
                color: SR.gold,
                textShadow: `2px 2px 0 ${SR.ink}`,
              }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 38%', minHeight: 0 }}>
              <FitText max={60} min={8} wrap={false}
                style={{ fontFamily: SR_FONT_BODY, color: SR.white, textShadow: `1px 1px 0 ${SR.ink}` }}>
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
// COUNTDOWN — foam-finger pointing at "DAYS TO GO" burst
// ═══════════════════════════════════════════════════════════
export function SpiritRallyCountdown({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 7 * 86400000);
  const label    = config.label || resolved?.prefix || 'DAYS TO GO';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HR' : 'HRS');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 18px 28px rgba(0,0,0,0.45))' }}>
          {/* Foam finger pointing at burst — top left */}
          <g transform="translate(60 80) rotate(35)">
            <rect x="-20" y="-90" width="56" height="100" rx="14" fill={SR.gold} stroke={SR.ink} strokeWidth="5" />
            <rect x="-12" y="-160" width="28" height="80" rx="14" fill={SR.gold} stroke={SR.ink} strokeWidth="5" />
            <ellipse cx="2" cy="-156" rx="10" ry="6" fill={SR.white} stroke={SR.ink} strokeWidth="2" />
            <text x="8" y="0" textAnchor="middle" fontFamily={SR_FONT_DISPLAY} fontSize="18" fill={SR.red} stroke={SR.ink} strokeWidth="1" paintOrder="stroke">#1</text>
          </g>

          {/* 16-point gold starburst centered at 350,350 */}
          <g transform="translate(350 350)">
            <polygon
              points="0,-290 38,-80 276,-108 110,60 290,194 36,170 0,310 -36,170 -290,194 -110,60 -276,-108 -38,-80"
              fill={SR.gold} stroke={SR.ink} strokeWidth="10" />
            {/* Inner navy starburst */}
            <polygon
              points="0,-200 26,-56 190,-74 76,42 200,134 24,116 0,214 -24,116 -200,134 -76,42 -190,-74 -26,-56"
              fill={SR.navy} stroke={SR.goldDark} strokeWidth="6" />
            {/* Red accent ring */}
            <circle r="110" fill="none" stroke={SR.red} strokeWidth="8" strokeDasharray="16 8" />
          </g>

          {/* Confetti dots scattered around burst */}
          {[[180,120],[520,100],[600,320],[580,560],[160,560],[100,380]].map(([cx,cy],i) => (
            <circle key={i} cx={cx} cy={cy} r="10"
              fill={[SR.gold,SR.red,SR.white][i%3]} stroke={SR.ink} strokeWidth="2" />
          ))}
        </svg>

        {/* Text stack centered in the starburst: inset ~22% all sides */}
        <div style={{
          position: 'absolute',
          inset: '26% 16% 20% 16%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SR_FONT_DISPLAY,
          color: SR.gold,
          textAlign: 'center',
        }}>
          {/* Label */}
          <div style={{ flex: '0 0 22%', minHeight: 0 }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={80} min={8} wrap={false}
              style={{
                fontWeight: 900,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textShadow: `2px 2px 0 ${SR.ink}`,
              }}>
              {String(label).toUpperCase()}
            </EditableText>
          </div>
          {/* Big number */}
          <div style={{ flex: '0 0 52%', minHeight: 0 }}>
            <FitText max={340} min={28} wrap={false}
              style={{
                fontWeight: 900,
                textShadow: `4px 4px 0 ${SR.ink}, 8px 8px 0 ${SR.goldDark}`,
                color: SR.white,
              }}>
              {bigNum}
            </FitText>
          </div>
          {/* Unit */}
          <div style={{ flex: '0 0 26%', minHeight: 0 }}>
            <FitText max={90} min={8} wrap={false}
              style={{
                fontFamily: SR_FONT_BODY,
                fontWeight: 700,
                textShadow: `2px 2px 0 ${SR.ink}`,
                color: SR.gold,
              }}>
              {unit}!
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — ribbon-banner across a stadium spotlight beam
// ═══════════════════════════════════════════════════════════
export function SpiritRallyAnnouncement({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title   = config.title   || '📣 HEY EAGLES!';
  const message = config.message || config.body || 'Pep rally starts at 2PM — gym bleachers!';
  const date    = config.date    || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 1800 520" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 16px 28px rgba(0,0,0,0.5))' }}>
          {/* Stadium spotlight cone behind banner */}
          <polygon points="900,0 400,520 1400,520" fill={SR.spotlight} />
          <polygon points="900,0 600,520 1200,520" fill="rgba(246,224,94,0.15)" />

          {/* Ribbon banner body */}
          <rect x="60" y="60" width="1680" height="340" rx="0" fill={SR.navy} />
          {/* Diagonal left fold */}
          <polygon points="60,60 140,60 60,160" fill={SR.goldDark} />
          <polygon points="60,400 140,400 60,300" fill={SR.goldDark} />
          {/* Diagonal right fold */}
          <polygon points="1740,60 1660,60 1740,160" fill={SR.goldDark} />
          <polygon points="1740,400 1660,400 1740,300" fill={SR.goldDark} />
          {/* Gold top stripe */}
          <rect x="60" y="60" width="1680" height="22" fill={SR.gold} />
          <rect x="60" y="378" width="1680" height="22" fill={SR.gold} />
          {/* Red accent lines */}
          <rect x="60" y="82" width="1680" height="10" fill={SR.red} />
          <rect x="60" y="368" width="1680" height="10" fill={SR.red} />

          {/* Megaphone icon on left side */}
          <g transform="translate(110 200)">
            <polygon points="-10,-22 -10,22 36,38 36,-38" fill={SR.gold} stroke={SR.ink} strokeWidth="4" />
            <rect x="-28" y="-14" width="20" height="28" rx="6" fill={SR.red} stroke={SR.ink} strokeWidth="3" />
            <path d="M40 -16 Q58 0 40 16" fill="none" stroke={SR.white} strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Star accents */}
          {[[220,200],[1580,200]].map(([cx,cy],i) => (
            <text key={i} x={cx} y={cy+12} textAnchor="middle" fontSize="48" fill={SR.gold} opacity="0.6">★</text>
          ))}
        </svg>

        {/* Safe interior — inside gold stripes: top 16%, bottom 16%, sides 14% */}
        <div style={{
          position: 'absolute',
          top: '17%', left: '15%', right: '8%', bottom: '17%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SR_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact && date ? '1 1 82%' : '1 1 100%', minHeight: 0 }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={300} min={12}
              style={{
                fontWeight: 900,
                color: SR.white,
                textShadow: `2px 2px 0 ${SR.ink}`,
                letterSpacing: '0.02em',
              }}>
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 20%', minHeight: 0 }}>
              <EditableText configKey="date" onConfigChange={onConfigChange} max={100} min={9} wrap={false}
                style={{ fontFamily: SR_FONT_SCRIPT, color: SR.gold }}>{date}</EditableText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — pom-pom pill cards with colored top/bottom fringes
// ═══════════════════════════════════════════════════════════
export function SpiritRallyCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'MON · 2PM',  title: 'Pep Rally — Gym' },
    { date: 'WED · 7PM',  title: 'Varsity Basketball Home Game' },
    { date: 'FRI · 4PM',  title: 'Spirit Week Costume Contest' },
  ]).slice(0, Math.max(1, Math.min(8, config.maxEvents ?? 4)));

  const accentColors = [SR.gold, SR.red, '#4A90D9', '#6ABF69'];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4%', gap: '3%' }}>
      {events.map((e: any, i: number) => {
        const accent = accentColors[i % accentColors.length];
        const fringeCount = 7;

        return (
          <div key={i} style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            background: SR.navy,
            border: `5px solid ${SR.ink}`,
            borderRadius: 12,
            boxShadow: `0 6px 16px ${SR.shadow}, inset 0 0 0 2px ${accent}22`,
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
          }}>
            {/* Top pom-pom fringe */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '18%', display: 'flex' }}>
              {Array.from({ length: fringeCount }).map((_, fi) => (
                <div key={fi} style={{
                  flex: 1,
                  background: fi % 2 === 0 ? accent : SR.ink,
                  borderBottom: `2px solid ${SR.ink}`,
                }} />
              ))}
            </div>
            {/* Bottom pom-pom fringe */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '18%', display: 'flex' }}>
              {Array.from({ length: fringeCount }).map((_, fi) => (
                <div key={fi} style={{
                  flex: 1,
                  background: fi % 2 === 0 ? SR.ink : accent,
                  borderTop: `2px solid ${SR.ink}`,
                }} />
              ))}
            </div>

            {/* Content area between fringes */}
            <div style={{
              position: 'absolute',
              top: '20%', bottom: '20%', left: '2%', right: '2%',
              display: 'flex', alignItems: 'center', gap: '2%',
              fontFamily: SR_FONT_DISPLAY,
            }}>
              {/* Date badge */}
              <div style={{
                flexShrink: 0,
                height: '80%',
                aspectRatio: '1.6 / 1',
                background: accent,
                border: `3px solid ${SR.ink}`,
                borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `2px 3px 0 ${SR.ink}`,
              }}>
                <div style={{ width: '90%', height: '90%' }}>
                  <FitText max={80} min={6} wrap={false}
                    style={{ fontWeight: 900, color: SR.ink, letterSpacing: '-0.02em' }}>
                    {e.date}
                  </FitText>
                </div>
              </div>

              {/* Event title */}
              <div style={{ flex: 1, minWidth: 0, height: '90%' }}>
                <FitText max={200} min={8} wrap={false} center={false}
                  style={{ fontWeight: 900, color: SR.white, letterSpacing: '0.01em' }}>
                  {e.title}
                </FitText>
              </div>

              {/* Star bullet */}
              <div style={{ flexShrink: 0, color: accent, fontSize: '1.2em' }}>★</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — "PLAYER CARD" trading card style
// ═══════════════════════════════════════════════════════════
export function SpiritRallyStaffSpotlight({
  config, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name     = config.staffName || config.name  || 'Coach Rivera';
  const role     = config.role      || 'Staff MVP of the Week';
  const quote    = config.bio       || config.quote || '"Great things never come from comfort zones."';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;
  const number   = config.number    || '01';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: `linear-gradient(160deg, ${SR.navy} 0%, #0d1e36 60%, ${SR.ink} 100%)`,
        border: `6px solid ${SR.gold}`,
        borderRadius: 18,
        boxShadow: `0 0 0 3px ${SR.ink}, 0 18px 36px rgba(0,0,0,0.5), inset 0 0 60px ${SR.spotlight}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: SR_FONT_DISPLAY,
      }}>
        {/* Card header stripe */}
        <div style={{
          background: SR.gold,
          padding: '2% 4%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `3px solid ${SR.goldDark}`,
        }}>
          <div style={{ flex: 1, minWidth: 0, height: '8cqh' }}>
            <FitText max={100} min={8} wrap={false} center={false}
              style={{ fontWeight: 900, color: SR.ink, letterSpacing: '0.06em' }}>
              ★ PLAYER CARD ★
            </FitText>
          </div>
          <div style={{
            background: SR.red, color: SR.white,
            border: `3px solid ${SR.ink}`,
            borderRadius: 8, padding: '1% 3%',
            fontWeight: 900, fontSize: 'clamp(10px, 3.5cqh, 32px)',
            marginLeft: '3%', flexShrink: 0,
          }}>
            #{number}
          </div>
        </div>

        {/* Card body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '3%', gap: '4%' }}>
          {/* Photo frame */}
          <div style={{
            flexShrink: 0, width: '38%',
            display: 'flex', flexDirection: 'column', gap: '4%',
          }}>
            <div style={{
              flex: 1,
              background: SR.goldDark,
              border: `5px solid ${SR.gold}`,
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: `4px 4px 0 ${SR.ink}, 0 0 20px ${SR.spotlight}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {photoUrl ? (
                <img src={resolveUrl(photoUrl)} alt={name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ fontSize: 'clamp(28px, 22cqh, 140px)', lineHeight: 1 }}>🏆</div>
              )}
            </div>
          </div>

          {/* Info column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ flex: '0 0 20%', minHeight: 0 }}>
              <EditableText configKey="role" onConfigChange={onConfigChange}
                max={80} min={7} wrap={false} center={false}
                style={{ fontWeight: 900, color: SR.gold, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {role}
              </EditableText>
            </div>
            <div style={{ flex: '0 0 35%', minHeight: 0 }}>
              <EditableText configKey="staffName" onConfigChange={onConfigChange}
                max={240} min={10} wrap={false} center={false}
                style={{
                  fontWeight: 900, color: SR.white,
                  textShadow: `2px 2px 0 ${SR.navy}`,
                }}>
                {name}
              </EditableText>
            </div>
            {/* Stats divider */}
            <div style={{ borderTop: `2px solid ${SR.goldDark}`, margin: '2% 0', opacity: 0.6 }} />
            <div style={{ flex: '1 1 45%', minHeight: 0 }}>
              <EditableText configKey="bio" onConfigChange={onConfigChange}
                max={120} min={8} center={false}
                style={{ fontFamily: SR_FONT_SCRIPT, color: SR.gold, lineHeight: 1.3 }}>
                {quote}
              </EditableText>
            </div>
          </div>
        </div>

        {/* Bottom ribbon */}
        <div style={{
          background: `repeating-linear-gradient(90deg, ${SR.navy} 0 20px, ${SR.red} 20px 40px)`,
          height: '6%',
          borderTop: `3px solid ${SR.gold}`,
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — jumbotron-style frame with glowing LED bezel
// ═══════════════════════════════════════════════════════════
export function SpiritRallyImageCarousel({ config }: { config: any; compact?: boolean }) {
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

  // LED dot colors cycle for bezel animation feel
  const ledColors = [SR.gold, SR.red, SR.white, SR.goldDark];

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: SR.ink,
        border: `8px solid ${SR.goldDark}`,
        borderRadius: 16,
        boxShadow: `0 0 0 4px ${SR.ink}, 0 0 0 8px ${SR.gold}, 0 0 40px rgba(246,224,94,0.3), 0 20px 40px rgba(0,0,0,0.6)`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Top LED strip */}
        <div style={{
          height: '8%', background: SR.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1%',
          borderBottom: `3px solid ${SR.goldDark}`,
          padding: '0 2%',
        }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} style={{
              width: 'clamp(4px, 1.2cqw, 14px)',
              height: 'clamp(4px, 1.2cqw, 14px)',
              borderRadius: '50%',
              background: ledColors[i % ledColors.length],
              boxShadow: `0 0 6px ${ledColors[i % ledColors.length]}`,
              opacity: 0.85,
            }} />
          ))}
        </div>

        {/* Main display area */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Jumbotron"
              className="transition-opacity duration-700"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `radial-gradient(ellipse at 50% 30%, ${SR.navy} 0%, ${SR.ink} 100%)`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: SR_FONT_DISPLAY, color: SR.gold,
              textAlign: 'center', padding: '6%',
              containerType: 'size',
            }}>
              <div style={{ fontSize: 'clamp(36px, 22cqh, 140px)', lineHeight: 1 }}>📺</div>
              <div style={{
                fontWeight: 900, fontSize: 'clamp(10px, 5cqh, 40px)',
                marginTop: '2cqh', letterSpacing: '0.06em',
              }}>
                JUMBOTRON
              </div>
              <div style={{
                fontFamily: SR_FONT_BODY,
                fontSize: 'clamp(8px, 3cqh, 24px)',
                color: SR.white, marginTop: '1cqh',
              }}>
                Add photos in the builder
              </div>
            </div>
          )}

          {/* Image counter dots */}
          {urls.length > 1 && (
            <div style={{
              position: 'absolute', bottom: '4%', left: 0, right: 0,
              display: 'flex', justifyContent: 'center', gap: '1%',
            }}>
              {urls.map((_: string, i: number) => (
                <div key={i} style={{
                  width: 'clamp(6px, 1.5cqw, 16px)', height: 'clamp(6px, 1.5cqw, 16px)',
                  borderRadius: '50%',
                  background: i === idx ? SR.gold : SR.white,
                  opacity: i === idx ? 1 : 0.4,
                  boxShadow: i === idx ? `0 0 8px ${SR.gold}` : 'none',
                  border: `2px solid ${SR.ink}`,
                }} />
              ))}
            </div>
          )}
        </div>

        {/* Bottom LED strip */}
        <div style={{
          height: '8%', background: SR.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1%',
          borderTop: `3px solid ${SR.goldDark}`,
          padding: '0 2%',
        }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} style={{
              width: 'clamp(4px, 1.2cqw, 14px)',
              height: 'clamp(4px, 1.2cqw, 14px)',
              borderRadius: '50%',
              background: ledColors[(i + 2) % ledColors.length],
              boxShadow: `0 0 6px ${ledColors[(i + 2) % ledColors.length]}`,
              opacity: 0.85,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — stadium scoreboard LED strip, amber on ink
// ═══════════════════════════════════════════════════════════
export function SpiritRallyTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['★ GO EAGLES! ★ HOME GAME FRIDAY 7PM ★ SPIRIT WEEK — WEAR YOUR COLORS ★'];

  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];
  const ledCount = compact ? 8 : 14;

  return (
    <div className="absolute inset-0 flex flex-col" style={{ overflow: 'hidden', background: SR.ink }}>
      {/* Scoreboard housing top rail */}
      <div style={{
        background: SR.navy,
        borderBottom: `3px solid ${SR.gold}`,
        height: '18%',
        display: 'flex', alignItems: 'center',
        padding: '0 2%',
        gap: '1%',
      }}>
        {/* LED indicator lights */}
        {Array.from({ length: ledCount }).map((_, i) => (
          <div key={i} style={{
            width: 'clamp(4px, 1.5cqw, 18px)',
            height: 'clamp(4px, 1.5cqw, 18px)',
            borderRadius: '50%',
            background: [SR.gold, SR.red, SR.white][i % 3],
            boxShadow: `0 0 6px ${[SR.gold, SR.red, SR.white][i % 3]}`,
            flexShrink: 0,
          }} />
        ))}
        {/* LIVE label */}
        <div style={{
          marginLeft: 'auto', flexShrink: 0,
          background: SR.red, color: SR.white,
          fontFamily: SR_FONT_DISPLAY, fontWeight: 900,
          fontSize: 'clamp(8px, 3cqh, 28px)',
          padding: '1% 3%', borderRadius: 4,
          border: `2px solid ${SR.ink}`,
          letterSpacing: '0.1em',
        }}>
          ● LIVE
        </div>
      </div>

      {/* Main LED message area */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', alignItems: 'center',
        padding: '2% 3%',
        background: '#050d14',
      }}>
        <FitText max={compact ? 56 : 100} min={10} wrap={false}
          style={{
            fontFamily: SR_FONT_DISPLAY,
            fontWeight: 900,
            color: '#FFB800',  /* Amber LED color */
            textShadow: '0 0 10px #FFB80088, 0 0 20px #FFB80044',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
          {primary}
        </FitText>
      </div>

      {/* Bottom rail */}
      <div style={{
        background: SR.navy,
        borderTop: `3px solid ${SR.gold}`,
        height: '16%',
        display: 'flex', alignItems: 'center',
        padding: '0 3%', gap: '2%',
      }}>
        {/* Gold team stripe pattern */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            height: '60%',
            flex: 1,
            background: i % 2 === 0 ? SR.gold : SR.navy,
            border: `1px solid ${SR.goldDark}`,
          }} />
        ))}
        <div style={{
          marginLeft: 'auto', flexShrink: 0,
          color: SR.goldDark, fontFamily: SR_FONT_DISPLAY,
          fontSize: 'clamp(7px, 2.5cqh, 22px)',
          fontWeight: 900, letterSpacing: '0.06em',
        }}>
          SPIRIT RALLY
        </div>
      </div>
    </div>
  );
}
