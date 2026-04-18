"use client";

/**
 * Field Day — sticker-pack / sports aesthetic.
 *
 * Every widget renders as a REAL SHAPE:
 *   - LOGO             → round mascot patch (tiger shield)
 *   - TEXT             → varsity pennant / banner patch
 *   - CLOCK            → stopwatch (circle + stem + side lugs)
 *   - WEATHER          → shield-shaped badge
 *   - COUNTDOWN        → medal (ribbon tails + round medallion)
 *   - ANNOUNCEMENT     → trophy cup + ribbon scroll
 *   - CALENDAR         → stacked jersey event cards
 *   - STAFF_SPOTLIGHT  → gold-frame portrait w/ MVP banner
 *   - IMAGE_CAROUSEL   → scoreboard frame with LED-dot bezel
 *   - TICKER           → amber dot-matrix scoreboard strip
 */

import { useEffect, useState } from 'react';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';
import { FitText } from './FitText';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '') : 'http://localhost:8080';
function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Palette ────────────────────────────────────────────
export const FD = {
  navy:     '#1E2A4A',
  ink:      '#0B1121',
  red:      '#E63946',
  gold:     '#FFD23F',
  grass:    '#4CB963',
  white:    '#FFFFFF',
  gray:     '#E5E9F0',
  blue:     '#4A90E2',
  amber:    '#FFB020',
};

export const FD_FONT_DISPLAY = "'Bungee', 'Fredoka', ui-rounded, system-ui, sans-serif";
export const FD_FONT_BODY    = "'Fredoka', ui-rounded, system-ui, sans-serif";
export const FD_FONT_SCRIPT  = "'Caveat', cursive";

// ═══════════════════════════════════════════════════════════
// LOGO — mascot patch (tiger on varsity shield with sunburst)
// ═══════════════════════════════════════════════════════════
export function FieldDayLogo({ config }: { config: any; compact?: boolean }) {
  const label = (config?.initials || config?.mascotName || 'TIGERS').toString().toUpperCase().slice(0, 8);
  const photoUrl = config?.assetUrl || config?.photoUrl;
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <svg viewBox="0 0 340 340" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.35))' }}>
        {/* sunburst rays */}
        <g stroke={FD.gold} strokeWidth="6" strokeLinecap="round" opacity="0.75">
          {Array.from({ length: 16 }).map((_, i) => {
            const a = (i * 22.5) * Math.PI / 180;
            const x1 = 170 + Math.cos(a) * 155;
            const y1 = 170 + Math.sin(a) * 155;
            const x2 = 170 + Math.cos(a) * 170;
            const y2 = 170 + Math.sin(a) * 170;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
        {/* outer gold ring */}
        <circle cx="170" cy="170" r="150" fill={FD.gold} stroke={FD.ink} strokeWidth="12" />
        {/* red inner */}
        <circle cx="170" cy="170" r="120" fill={FD.red} stroke={FD.ink} strokeWidth="8" />

        {photoUrl ? (
          <>
            <defs>
              <clipPath id="fd-logo-clip"><circle cx="170" cy="170" r="112" /></clipPath>
            </defs>
            <image href={resolveUrl(photoUrl)} x="58" y="58" width="224" height="224"
              preserveAspectRatio="xMidYMid slice" clipPath="url(#fd-logo-clip)" />
          </>
        ) : (
          <g>
            {/* tiger face */}
            <path d="M90 180 Q90 90 170 90 Q250 90 250 180 Q250 240 170 270 Q90 240 90 180" fill="#FFB347" />
            {/* stripes */}
            <path d="M110 130 L130 120 L125 145 Z" fill={FD.ink} />
            <path d="M210 120 L235 130 L225 150 Z" fill={FD.ink} />
            <path d="M100 190 L125 195 L115 215 Z" fill={FD.ink} />
            <path d="M240 190 L220 195 L230 215 Z" fill={FD.ink} />
            {/* eyes */}
            <circle cx="140" cy="165" r="16" fill={FD.white} />
            <circle cx="200" cy="165" r="16" fill={FD.white} />
            <circle cx="140" cy="168" r="8" fill={FD.ink} />
            <circle cx="200" cy="168" r="8" fill={FD.ink} />
            {/* nose */}
            <path d="M160 200 L180 200 L170 215 Z" fill={FD.ink} />
            <path d="M170 215 L170 230" stroke={FD.ink} strokeWidth="4" />
            {/* smile + fangs */}
            <path d="M140 230 Q170 255 200 230" stroke={FD.ink} strokeWidth="6" fill="none" strokeLinecap="round" />
            <polygon points="158,235 162,250 166,235" fill={FD.white} />
            <polygon points="178,235 182,250 186,235" fill={FD.white} />
          </g>
        )}

        {/* name banner across bottom */}
        <rect x="60" y="295" width="220" height="36" rx="6" fill={FD.ink} />
        <rect x="60" y="295" width="220" height="36" rx="6" fill="none" stroke={FD.gold} strokeWidth="3" />
        <text x="170" y="322" textAnchor="middle" fontFamily={FD_FONT_DISPLAY} fontSize="22" fill={FD.gold}
          letterSpacing="2">{label}</text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — varsity pennant banner patch
// ═══════════════════════════════════════════════════════════
export function FieldDayText({ config, compact }: { config: any; compact?: boolean }) {
  const content = (config?.content || "LET'S GO TIGERS!").toString();
  const sub = config?.subtitle || '';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%',
        filter: 'drop-shadow(0 10px 16px rgba(0,0,0,0.35))',
        transform: 'rotate(-1.2deg)' }}>
        <svg viewBox="0 0 2800 400" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0 }}>
          <path d="M60 40 Q20 40 20 100 L20 300 Q20 360 80 360 L160 360 L140 400 L260 360 L2540 360 L2660 400 L2640 360 L2720 360 Q2780 360 2780 300 L2780 100 Q2780 40 2740 40 Z"
            fill={FD.red} stroke={FD.ink} strokeWidth="12" />
          <path d="M80 80 L2720 80 L2720 120 L80 120 Z" fill={FD.ink} />
          <path d="M80 280 L2720 280 L2720 320 L80 320 Z" fill={FD.ink} />
          <path d="M80 80 L2720 80 L2720 100 L80 100 Z" fill={FD.gold} />
          <path d="M80 300 L2720 300 L2720 320 L80 320 Z" fill={FD.gold} />
        </svg>
        <div style={{
          position: 'absolute', inset: '12% 14%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 65%', width: '100%', minHeight: 0 }}>
            <FitText max={160} min={10} wrap={false} style={{
              fontFamily: FD_FONT_DISPLAY,
              color: FD.white,
              WebkitTextStroke: `3px ${FD.ink}`,
              textShadow: `3px 3px 0 ${FD.gold}, 5px 5px 0 ${FD.ink}`,
              letterSpacing: '0.05em',
            }}>
              {content}
            </FitText>
          </div>
          {!compact && sub && (
            <div style={{ flex: '0 0 35%', width: '100%', minHeight: 0 }}>
              <FitText max={44} min={8} wrap={false} style={{
                fontFamily: FD_FONT_BODY,
                fontWeight: 700,
                color: FD.gold,
                WebkitTextStroke: `1.5px ${FD.ink}`,
              }}>
                ☆ {sub} ☆
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — stopwatch
// ═══════════════════════════════════════════════════════════
export function FieldDayClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config?.timezone || undefined;
  const hours12 = config?.format !== '24';
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  const timeStr = hours12
    ? fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?[AP]M$/i, '')
    : fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
  const ampm = hours12 ? fmt({ hour: 'numeric', hour12: true }).replace(/^\d+\s?/, '').trim() : '';
  const secs = parseInt(fmt({ second: 'numeric' }), 10);
  const secDeg = secs * 6;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <svg viewBox="0 0 640 720" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 12px 16px rgba(0,0,0,0.35))', transform: 'rotate(-3deg)' }}>
        {/* stem */}
        <rect x="290" y="40" width="60" height="50" fill={FD.ink} />
        <rect x="270" y="30" width="100" height="30" rx="10" fill={FD.gold} stroke={FD.ink} strokeWidth="8" />
        {/* side lugs */}
        <rect x="130" y="110" width="60" height="30" rx="8" fill={FD.red} stroke={FD.ink} strokeWidth="6" transform="rotate(-30 160 125)" />
        <rect x="450" y="110" width="60" height="30" rx="8" fill={FD.red} stroke={FD.ink} strokeWidth="6" transform="rotate(30 480 125)" />
        {/* body */}
        <circle cx="320" cy="410" r="280" fill={FD.white} stroke={FD.ink} strokeWidth="14" />
        <circle cx="320" cy="410" r="250" fill={FD.gold} stroke={FD.ink} strokeWidth="6" />
        <circle cx="320" cy="410" r="220" fill={FD.white} stroke={FD.ink} strokeWidth="4" />
        {/* tick marks */}
        {!compact && (
          <g stroke={FD.ink} strokeWidth="6" strokeLinecap="round">
            <line x1="320" y1="200" x2="320" y2="230" />
            <line x1="320" y1="590" x2="320" y2="620" />
            <line x1="110" y1="410" x2="140" y2="410" />
            <line x1="500" y1="410" x2="530" y2="410" />
            <line x1="180" y1="270" x2="200" y2="290" />
            <line x1="440" y1="290" x2="460" y2="270" />
            <line x1="180" y1="550" x2="200" y2="530" />
            <line x1="440" y1="530" x2="460" y2="550" />
          </g>
        )}
        <text x="320" y="430" textAnchor="middle" fontFamily={FD_FONT_DISPLAY} fontSize="170" fill={FD.ink}>{timeStr}</text>
        {!compact && ampm && (
          <text x="320" y="500" textAnchor="middle" fontFamily={FD_FONT_DISPLAY} fontSize="44" fill={FD.red}>{ampm}</text>
        )}
        {/* sweep hand */}
        <g transform={`rotate(${secDeg} 320 410)`}>
          <line x1="320" y1="410" x2="320" y2="210" stroke={FD.red} strokeWidth="10" strokeLinecap="round" />
        </g>
        <circle cx="320" cy="410" r="14" fill={FD.ink} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — shield-shaped badge
// ═══════════════════════════════════════════════════════════
export function FieldDayWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config?.location || 'Springfield';
  const isCelsius = config?.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config?.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config?.condition || 'Loading').toString();
  const low = cond.toLowerCase();
  const isRain = low.includes('rain') || low.includes('drizzle');
  const isCloud = low.includes('cloud') || low.includes('overcast');
  const isSnow = low.includes('snow');
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <svg viewBox="0 0 640 720" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 12px 16px rgba(0,0,0,0.35))', transform: 'rotate(3deg)' }}>
        {/* shield outline */}
        <path d="M60 90 Q60 60 100 55 L540 55 Q580 60 580 90 L580 360 Q580 540 320 680 Q60 540 60 360 Z"
          fill={FD.navy} stroke={FD.ink} strokeWidth="14" />
        {/* inner shield */}
        <path d="M90 115 Q90 90 120 85 L520 85 Q550 90 550 115 L550 355 Q550 515 320 640 Q90 515 90 355 Z"
          fill={FD.gold} stroke={FD.ink} strokeWidth="6" />
        {/* condition icon */}
        <g transform="translate(320 280)">
          {isSnow ? (
            <g>
              <circle r="90" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
              <g stroke={FD.navy} strokeWidth="8" strokeLinecap="round">
                <line x1="-50" y1="0" x2="50" y2="0" />
                <line x1="0" y1="-50" x2="0" y2="50" />
                <line x1="-35" y1="-35" x2="35" y2="35" />
                <line x1="-35" y1="35" x2="35" y2="-35" />
              </g>
            </g>
          ) : isRain ? (
            <g>
              <ellipse cx="0" cy="-10" rx="110" ry="60" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
              <circle cx="-60" cy="-20" r="40" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
              <circle cx="55" cy="-25" r="35" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
              <g fill={FD.blue} stroke={FD.ink} strokeWidth="4">
                <path d="M-40 40 L-45 70 L-35 70 Z" />
                <path d="M0 50 L-5 80 L5 80 Z" />
                <path d="M40 40 L35 70 L45 70 Z" />
              </g>
            </g>
          ) : isCloud ? (
            <g>
              <ellipse cx="0" cy="0" rx="110" ry="55" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
              <circle cx="-60" cy="-15" r="40" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
              <circle cx="55" cy="-20" r="38" fill={FD.white} stroke={FD.ink} strokeWidth="8" />
            </g>
          ) : (
            <g>
              <g stroke={FD.ink} strokeWidth="10" strokeLinecap="round">
                {Array.from({ length: 8 }).map((_, i) => {
                  const a = (i * 45) * Math.PI / 180;
                  return <line key={i}
                    x1={Math.cos(a) * 110} y1={Math.sin(a) * 110}
                    x2={Math.cos(a) * 140} y2={Math.sin(a) * 140} />;
                })}
              </g>
              <circle r="90" fill="#FF9A3C" stroke={FD.ink} strokeWidth="10" />
              <circle cx="-30" cy="-15" r="10" fill={FD.ink} />
              <circle cx="30" cy="-15" r="10" fill={FD.ink} />
              <path d="M-30 25 Q0 50 30 25" stroke={FD.ink} strokeWidth="8" fill="none" strokeLinecap="round" />
            </g>
          )}
        </g>
        {/* temp plate */}
        <rect x="140" y="500" width="360" height="110" rx="24" fill={FD.ink} />
        <rect x="140" y="500" width="360" height="110" rx="24" fill="none" stroke={FD.gold} strokeWidth="6" />
        <text x="320" y="578" textAnchor="middle" fontFamily={FD_FONT_DISPLAY}
          fontSize={compact ? "78" : "66"} fill={FD.white}>
          {temp}°{compact ? '' : ` · ${cond.toUpperCase().slice(0, 10)}`}
        </text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — medal with ribbon tails
// ═══════════════════════════════════════════════════════════
export function FieldDayCountdown({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 12 * 24 * 3600 * 1000);
  const label = (config?.label || resolved?.prefix || 'Field Trip').toString().toUpperCase();
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const showDays = days > 0;
  const bigNum = showDays ? days : hours;
  const unit = showDays ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HR' : 'HRS');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', transform: 'rotate(-3deg)' }}>
        <svg viewBox="0 0 520 640" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.4))' }}>
          {/* ribbon tails */}
          <path d="M160 40 L160 240 L210 210 L260 240 L260 40 Z" fill={FD.red} stroke={FD.ink} strokeWidth="10" />
          <path d="M260 40 L260 240 L310 210 L360 240 L360 40 Z" fill={FD.blue} stroke={FD.ink} strokeWidth="10" />
          {/* medallion outer */}
          <circle cx="260" cy="400" r="200" fill={FD.red} stroke={FD.ink} strokeWidth="14" />
          {/* gear / fluted ring */}
          <g>
            {Array.from({ length: 16 }).map((_, i) => {
              const a = (i * 22.5) * Math.PI / 180;
              const x = 260 + Math.cos(a) * 200;
              const y = 400 + Math.sin(a) * 200;
              return <circle key={i} cx={x} cy={y} r="16" fill={FD.red} stroke={FD.ink} strokeWidth="6" />;
            })}
          </g>
          <circle cx="260" cy="400" r="170" fill={FD.gold} stroke={FD.ink} strokeWidth="8" />
          <circle cx="260" cy="400" r="150" fill={FD.gold} stroke={FD.ink} strokeWidth="3" strokeDasharray="6 6" />
        </svg>
        {/* HTML text overlay inside the gold disc — top:42% left:10% right:10% bottom:15% */}
        <div style={{
          position: 'absolute', top: '42%', left: '10%', right: '10%', bottom: '15%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ flex: '0 0 22%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FitText max={28} min={8} style={{ fontFamily: FD_FONT_DISPLAY, color: FD.ink, textTransform: 'uppercase', textAlign: 'center' }}>
              {label.slice(0, 16)}
            </FitText>
          </div>
          <div style={{ flex: '0 0 52%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FitText max={180} min={20} style={{ fontFamily: FD_FONT_DISPLAY, color: FD.ink, fontWeight: 'bold', textAlign: 'center' }}>
              {String(bigNum)}
            </FitText>
          </div>
          <div style={{ flex: '0 0 26%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FitText max={36} min={8} style={{ fontFamily: FD_FONT_DISPLAY, color: FD.ink, textAlign: 'center' }}>
              {unit}!
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — trophy cup + ribbon scroll
// ═══════════════════════════════════════════════════════════
export function FieldDayAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  const title = (config?.title || "Today's Headline").toString();
  const body = (config?.message || config?.body || 'Exciting things happening at school today!').toString();
  const date = config?.date || '';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%',
        filter: 'drop-shadow(0 14px 22px rgba(0,0,0,0.35))',
        transform: 'rotate(-0.8deg)' }}>
        <svg viewBox="0 0 1900 600" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0 }}>
          {/* trophy cup on left */}
          <g transform="translate(80 80)">
            <path d="M40 40 L240 40 L230 160 Q230 240 140 260 Q50 240 50 160 Z"
              fill={FD.gold} stroke={FD.ink} strokeWidth="10" />
            <rect x="100" y="260" width="80" height="40" fill={FD.gold} stroke={FD.ink} strokeWidth="8" />
            <rect x="70" y="290" width="140" height="30" rx="8" fill={FD.red} stroke={FD.ink} strokeWidth="8" />
            <path d="M40 80 Q0 80 0 130 Q0 180 50 190" stroke={FD.ink} strokeWidth="10" fill="none" />
            <path d="M240 80 Q280 80 280 130 Q280 180 230 190" stroke={FD.ink} strokeWidth="10" fill="none" />
            <text x="140" y="175" textAnchor="middle" fontFamily={FD_FONT_DISPLAY} fontSize="70" fill={FD.ink}>1st</text>
          </g>
          {/* ribbon scroll banner */}
          <path d="M360 80 L1820 80 L1870 160 L1820 240 L1820 440 L1870 520 L1820 600 L360 600 L320 520 L360 440 L360 240 L320 160 Z"
            fill={FD.white} stroke={FD.ink} strokeWidth="12" />
          <rect x="380" y="110" width="1420" height="460" rx="16" fill="none"
            stroke={FD.red} strokeWidth="6" strokeDasharray="20 10" />
        </svg>
        <div style={{
          position: 'absolute',
          left: '22%', right: '4%', top: '18%', bottom: '15%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          textAlign: 'center', fontFamily: FD_FONT_BODY,
        }}>
          <div style={{ flex: '0 0 28%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FitText max={72} min={10} style={{
              fontFamily: FD_FONT_DISPLAY,
              color: FD.red, WebkitTextStroke: `2px ${FD.ink}`,
              letterSpacing: '0.05em', textAlign: 'center',
            }}>
              {title}
            </FitText>
          </div>
          <div style={{ flex: '0 0 55%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FitText max={60} min={10} style={{
              fontFamily: FD_FONT_BODY,
              fontWeight: 700,
              color: FD.ink, textAlign: 'center',
            }}>
              {body}
            </FitText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 17%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FitText max={44} min={8} style={{ fontFamily: FD_FONT_SCRIPT, color: FD.navy, textAlign: 'center' }}>
                ~ {date} ~
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — stacked jersey cards
// ═══════════════════════════════════════════════════════════
export function FieldDayCalendar({ config, compact }: { config: any; compact?: boolean }) {
  const events: any[] = (config?.events && Array.isArray(config.events) && config.events.length > 0)
    ? config.events
    : [
        { date: 'MON · 8:30', title: 'Pajama Day Reading' },
        { date: 'WED · 10 AM', title: "Principal's Story Time" },
        { date: 'APR 30', title: 'Field Trip — The Zoo!' },
      ];
  const colors = [FD.red, FD.blue, FD.grass, FD.gold];
  const limit = compact ? 2 : 3;
  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-center"
      style={{ padding: '4%', gap: '3%', containerType: 'size' }}>
      {events.slice(0, limit).map((ev, i) => {
        const bg = colors[i % colors.length];
        const isGold = bg === FD.gold;
        const fg = isGold ? FD.ink : FD.white;
        const meta = isGold ? FD.ink : FD.gold;
        return (
          <div key={i} style={{ position: 'relative', flex: 1, minHeight: 0,
            filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.3))',
            transform: `rotate(${i % 2 === 0 ? -1 : 1}deg)` }}>
            <svg viewBox="0 0 390 200" width="100%" height="100%" preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0 }}>
              <path d="M60 20 Q40 20 40 60 L40 160 Q40 180 70 180 L320 180 Q350 180 350 160 L350 60 Q350 20 330 20 L260 20 L260 50 L130 50 L130 20 Z"
                fill={bg} stroke={FD.ink} strokeWidth="10" />
            </svg>
            <div style={{ position: 'absolute', inset: '15% 10%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', fontFamily: FD_FONT_BODY }}>
              <div style={{ flex: '0 0 40%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FitText max={80} min={14} style={{
                  fontFamily: FD_FONT_DISPLAY, fontWeight: 'bold',
                  color: fg, WebkitTextStroke: isGold ? '0' : `2px ${FD.ink}`, textAlign: 'center',
                }}>
                  #{String(i + 1).padStart(2, '0')}
                </FitText>
              </div>
              <div style={{ flex: '0 0 25%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FitText max={28} min={8} style={{
                  fontFamily: FD_FONT_BODY, fontWeight: 700,
                  color: meta, WebkitTextStroke: isGold ? '0' : `1px ${FD.ink}`, textAlign: 'center',
                }}>
                  {(ev.date || '').toString().toUpperCase()}
                </FitText>
              </div>
              <div style={{ flex: '0 0 35%', width: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FitText max={32} min={8} style={{
                  fontFamily: FD_FONT_BODY, fontWeight: 700,
                  color: fg, textAlign: 'center', whiteSpace: 'normal',
                }}>
                  {ev.title}
                </FitText>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — gold-frame portrait + MVP banner
// ═══════════════════════════════════════════════════════════
export function FieldDayStaffSpotlight({ config, compact }: { config: any; compact?: boolean }) {
  const name = (config?.staffName || config?.name || 'Mrs. Johnson').toString();
  const role = (config?.role || 'Teacher of the Week').toString();
  const bio = (config?.bio || config?.quote || '"Be kind · work hard · high-five everyone."').toString();
  const photoUrl: string | undefined = config?.photoUrl || config?.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: FD.gold,
        border: `8px solid ${FD.ink}`,
        borderRadius: 24,
        boxShadow: `10px 10px 0 ${FD.ink}`,
        transform: 'rotate(-1.5deg)',
        padding: '6%',
        display: 'flex', gap: '5%', alignItems: 'center',
        fontFamily: FD_FONT_BODY,
      }}>
        {/* MVP sticker */}
        <div style={{
          position: 'absolute', top: '-6%', right: '-4%',
          background: FD.red, color: FD.white,
          fontFamily: FD_FONT_DISPLAY,
          fontSize: 'clamp(14px, 7cqh, 42px)',
          padding: '0.25em 0.6em',
          border: `5px solid ${FD.ink}`,
          borderRadius: 12,
          transform: 'rotate(8deg)',
          WebkitTextStroke: `1px ${FD.ink}`,
          letterSpacing: '0.08em',
          zIndex: 3,
        }}>MVP</div>

        {/* Portrait */}
        <div style={{
          flexShrink: 0,
          width: '38%', aspectRatio: '1',
          borderRadius: '50%',
          border: `6px solid ${FD.ink}`,
          background: FD.blue,
          overflow: 'hidden',
          position: 'relative',
          boxShadow: `inset 0 0 0 4px ${FD.white}`,
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg viewBox="0 0 300 300" width="100%" height="100%">
              <circle cx="150" cy="130" r="90" fill="#FFD6A0" stroke={FD.ink} strokeWidth="8" />
              <path d="M60 130 Q60 30 150 30 Q240 30 240 130 Q240 90 200 80 Q150 75 100 85 Q60 100 60 130" fill={FD.ink} />
              <circle cx="125" cy="130" r="8" fill={FD.ink} />
              <circle cx="175" cy="130" r="8" fill={FD.ink} />
              <path d="M125 165 Q150 190 175 165" stroke={FD.red} strokeWidth="8" fill="none" strokeLinecap="round" />
              <rect x="50" y="220" width="200" height="90" fill={FD.gold} stroke={FD.ink} strokeWidth="8" />
              <text x="150" y="275" textAnchor="middle" fontFamily={FD_FONT_DISPLAY} fontSize="40" fill={FD.ink}>TCHR</text>
            </svg>
          )}
        </div>

        {/* Text block */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{
            fontFamily: FD_FONT_DISPLAY,
            fontSize: 'clamp(10px, 4.5cqh, 28px)',
            color: FD.ink, letterSpacing: '0.04em', lineHeight: 1,
          }}>{role.toUpperCase()}</div>
          <div style={{
            fontFamily: FD_FONT_DISPLAY,
            fontSize: 'clamp(16px, 9cqh, 56px)',
            color: FD.red, WebkitTextStroke: `3px ${FD.ink}`,
            lineHeight: 1, marginTop: '2cqh',
          }}>{name.toUpperCase()}</div>
          {!compact && (
            <div style={{
              fontWeight: 700,
              fontSize: 'clamp(10px, 4cqh, 24px)',
              color: FD.ink, lineHeight: 1.15, marginTop: '3cqh',
            }}>{bio}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — scoreboard frame w/ LED-dot bezel
// ═══════════════════════════════════════════════════════════
export function FieldDayImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config?.urls) && config.urls.length > 0
    ? config.urls
    : (config?.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config?.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config?.intervalMs]);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: FD.ink,
        border: `6px solid ${FD.gold}`,
        borderRadius: 18,
        boxShadow: `8px 8px 0 rgba(0,0,0,0.4), inset 0 0 0 4px ${FD.ink}, inset 0 0 30px rgba(255,210,63,0.2)`,
        padding: '4%',
        transform: 'rotate(-1deg)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* LED dot bezel top + bottom */}
        {[0, 1].map((row) => (
          <div key={row} style={{
            position: 'absolute', left: '4%', right: '4%',
            top: row === 0 ? '4%' : 'auto', bottom: row === 1 ? '4%' : 'auto',
            height: '8%',
            backgroundImage: `radial-gradient(${FD.amber} 35%, transparent 40%)`,
            backgroundSize: '5% 100%',
            opacity: 0.85,
          }} />
        ))}
        {/* inner screen */}
        <div style={{
          position: 'absolute', inset: '13% 6%',
          borderRadius: 8,
          overflow: 'hidden',
          background: FD.navy,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {urls.length > 0 ? (
            <img src={resolveUrl(urls[idx])} alt="Gallery"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            // mascot holding "Add photo" sign
            <svg viewBox="0 0 400 300" width="80%" height="80%" preserveAspectRatio="xMidYMid meet">
              {/* mascot head */}
              <circle cx="110" cy="170" r="70" fill="#FFB347" stroke={FD.ink} strokeWidth="8" />
              <path d="M60 145 L80 135 L78 160 Z" fill={FD.ink} />
              <path d="M145 135 L165 145 L150 160 Z" fill={FD.ink} />
              <circle cx="90" cy="165" r="10" fill={FD.white} />
              <circle cx="130" cy="165" r="10" fill={FD.white} />
              <circle cx="90" cy="167" r="5" fill={FD.ink} />
              <circle cx="130" cy="167" r="5" fill={FD.ink} />
              <path d="M98 195 Q110 210 122 195" stroke={FD.ink} strokeWidth="4" fill="none" strokeLinecap="round" />
              {/* arm */}
              <rect x="165" y="175" width="40" height="14" fill="#FFB347" stroke={FD.ink} strokeWidth="4" />
              {/* sign */}
              <rect x="200" y="90" width="190" height="120" rx="10" fill={FD.gold} stroke={FD.ink} strokeWidth="8" />
              <text x="295" y="140" textAnchor="middle" fontFamily={FD_FONT_DISPLAY}
                fontSize="28" fill={FD.ink}>ADD</text>
              <text x="295" y="180" textAnchor="middle" fontFamily={FD_FONT_DISPLAY}
                fontSize="28" fill={FD.red}>PHOTO!</text>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — scoreboard LED strip
// ═══════════════════════════════════════════════════════════
export function FieldDayTicker({ config }: { config: any; compact?: boolean }) {
  const messages: string[] = config?.messages?.length
    ? config.messages
    : ['★ LOST & FOUND FRIDAY · HATS · JACKETS · ONE MYSTERY BOOT AT THE OFFICE ★'];
  const speed = config?.speed === 'slow' ? 50 : config?.speed === 'fast' ? 18 : 30;
  const text = messages.join('     ★     ');
  const repeated = `${text}     ★     ${text}`;

  return (
    <div className="absolute inset-0" style={{ padding: '1%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: FD.ink,
        border: `6px solid ${FD.gold}`,
        borderRadius: 20,
        boxShadow: `6px 6px 0 rgba(0,0,0,0.4), inset 0 0 30px rgba(255,46,138,0.25)`,
        display: 'flex', alignItems: 'center', overflow: 'hidden',
        transform: 'rotate(-0.4deg)',
        fontFamily: FD_FONT_DISPLAY,
      }}>
        {/* LIVE scoreboard tag */}
        <div style={{
          flexShrink: 0,
          background: '#111',
          border: `4px solid ${FD.gold}`,
          borderRadius: 12,
          margin: '0 2% 0 2%',
          padding: '0.3em 0.8em',
          boxShadow: `inset 0 0 20px rgba(230,57,70,0.5)`,
          color: FD.gold,
          letterSpacing: '0.1em',
          fontSize: '1.2em',
        }}>LIVE</div>
        {/* LED dot pattern overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `radial-gradient(rgba(255,176,32,0.08) 1px, transparent 1.5px)`,
          backgroundSize: '8px 8px',
          pointerEvents: 'none',
        }} />
        {/* scrolling text */}
        <div style={{
          flex: 1, minWidth: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center',
          height: '100%',
          position: 'relative',
        }}>
          <div style={{
            whiteSpace: 'nowrap',
            animation: `fd-ticker ${speed}s linear infinite`,
            display: 'flex',
          }}>
            <span style={{
              paddingLeft: '100%',
              fontSize: '1.3em',
              color: FD.amber,
              WebkitTextStroke: `1.5px ${FD.red}`,
              letterSpacing: '0.08em',
              textShadow: `0 0 8px rgba(255,176,32,0.6), 0 0 18px rgba(255,176,32,0.3)`,
            }}>
              {repeated}
            </span>
          </div>
        </div>
        <style>{`@keyframes fd-ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
      </div>
    </div>
  );
}
