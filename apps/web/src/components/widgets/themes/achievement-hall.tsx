"use client";

/**
 * Achievement Hall — high-school Hall of Fame trophy-case lobby theme.
 *
 * Every widget evokes a physical trophy-case display:
 *   - LOGO            → circular brass crest with embossed wreath + monogram
 *   - TEXT/RICH_TEXT  → gilded ivory plaque with brass frame + small-caps subtitle
 *   - CLOCK           → brass wall clock — live analog hands + Roman numerals
 *   - WEATHER         → wrought-iron weather-vane card + engraving-style icons
 *   - COUNTDOWN       → trophy plaque with "X DAYS" + burgundy ribbon drape
 *   - ANNOUNCEMENT    → velvet-lined brass-framed plaque
 *   - CALENDAR        → 3 stacked brass-engraved event plaques
 *   - STAFF_SPOTLIGHT → Hall of Fame gold oval portrait frame + name plaque
 *   - IMAGE_CAROUSEL  → museum-style ornate gold picture frame
 *   - TICKER          → engraved brass strip with small-caps serif message
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

// ─── Palette ───────────────────────────────────────────────
export const AH = {
  wood:      '#3D2817',
  woodDark:  '#26180C',
  woodLight: '#58392A',
  velvet:    '#2C1A1A',
  brass:     '#B08D57',
  brassLight:'#D4B87A',
  brassDark: '#7A5E35',
  gold:      '#E6BE3A',
  goldFoil:  '#FFD86A',
  ivory:     '#F3EAD7',
  ink:       '#1A0E04',
  accent:    '#8B2525',
  shadow:    'rgba(26,14,4,0.55)',
};

export const AH_FONT_DISPLAY = "'Fraunces', 'Trajan Pro', 'Times New Roman', serif";
export const AH_FONT_BODY    = "'Fredoka', system-ui, sans-serif";
export const AH_FONT_SCRIPT  = "'Caveat', cursive";

// Shared brass-frame SVG border used by several widgets
function BrassFrame({ rounded = 8 }: { rounded?: number }) {
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="ahBrassH" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor={AH.brassDark} />
          <stop offset="30%"  stopColor={AH.brassLight} />
          <stop offset="70%"  stopColor={AH.brass} />
          <stop offset="100%" stopColor={AH.brassDark} />
        </linearGradient>
        <linearGradient id="ahBrassV" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor={AH.brassDark} />
          <stop offset="30%"  stopColor={AH.brassLight} />
          <stop offset="70%"  stopColor={AH.brass} />
          <stop offset="100%" stopColor={AH.brassDark} />
        </linearGradient>
      </defs>
      {/* Outer frame */}
      <rect x="0" y="0" width="400" height="300" rx={rounded} ry={rounded}
        fill="none" stroke="url(#ahBrassH)" strokeWidth="14" />
      {/* Inner accent line */}
      <rect x="10" y="10" width="380" height="280" rx={rounded - 2} ry={rounded - 2}
        fill="none" stroke={AH.brassDark} strokeWidth="3" opacity="0.7" />
      {/* Corner rosettes */}
      {[[20, 20], [380, 20], [20, 280], [380, 280]].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="10" fill={AH.gold} stroke={AH.brassDark} strokeWidth="2" />
          <circle cx={cx} cy={cy} r="4"  fill={AH.brassLight} />
        </g>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// LOGO — circular brass crest with embossed wreath + monogram
// ═══════════════════════════════════════════════════════════
export function AchievementHallLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (
    config.initials ||
    (config.schoolName || 'HS')
      .split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() ||
    'HS'
  );
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 280 280" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 6px 18px ${AH.shadow})`, overflow: 'visible' }}>
        <defs>
          <radialGradient id="ahCrestBg" cx="50%" cy="40%" r="55%">
            <stop offset="0%"   stopColor={AH.woodLight} />
            <stop offset="100%" stopColor={AH.woodDark} />
          </radialGradient>
          <radialGradient id="ahCrestGold" cx="50%" cy="35%" r="60%">
            <stop offset="0%"   stopColor={AH.goldFoil} />
            <stop offset="100%" stopColor={AH.gold} />
          </radialGradient>
          <radialGradient id="ahSpotlight" cx="50%" cy="20%" r="70%">
            <stop offset="0%"   stopColor="rgba(255,240,180,0.35)" />
            <stop offset="100%" stopColor="rgba(255,240,180,0)" />
          </radialGradient>
        </defs>

        {/* Outer brass ring */}
        <circle cx="140" cy="140" r="135" fill={AH.brassDark} />
        <circle cx="140" cy="140" r="130" fill="url(#ahCrestBg)" />
        {/* Wreath — left arc */}
        {Array.from({ length: 9 }).map((_, i) => {
          const angle = (-90 + i * 20) * Math.PI / 180;
          const r = 112;
          const x = 140 + Math.cos(angle) * r;
          const y = 140 + Math.sin(angle) * r;
          return (
            <ellipse key={`l${i}`} cx={x} cy={y} rx="10" ry="6"
              transform={`rotate(${-90 + i * 20 + 90}, ${x}, ${y})`}
              fill={AH.gold} stroke={AH.brassDark} strokeWidth="1.5" opacity="0.9" />
          );
        })}
        {/* Wreath — right arc */}
        {Array.from({ length: 9 }).map((_, i) => {
          const angle = (90 + i * 20) * Math.PI / 180;
          const r = 112;
          const x = 140 + Math.cos(angle) * r;
          const y = 140 + Math.sin(angle) * r;
          return (
            <ellipse key={`r${i}`} cx={x} cy={y} rx="10" ry="6"
              transform={`rotate(${90 + i * 20 + 90}, ${x}, ${y})`}
              fill={AH.gold} stroke={AH.brassDark} strokeWidth="1.5" opacity="0.9" />
          );
        })}
        {/* Inner velvet disc */}
        <circle cx="140" cy="140" r="88" fill={AH.velvet} stroke={AH.brass} strokeWidth="3" />
        {/* Spotlight glow overlay */}
        <circle cx="140" cy="140" r="88" fill="url(#ahSpotlight)" />

        {/* Content: photo or monogram */}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="56" y="56" width="168" height="168"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(84px at 140px 140px)" />
        ) : (
          <>
            {/* Decorative star above monogram */}
            <text x="140" y="108" textAnchor="middle" fontSize="18"
              fill={AH.gold} fontFamily={AH_FONT_DISPLAY} opacity="0.7">✦</text>
            {/* Monogram */}
            <text x="140" y="160" textAnchor="middle" fontSize="54" fontWeight="bold"
              fill={AH.goldFoil} fontFamily={AH_FONT_DISPLAY}
              style={{ letterSpacing: '0.05em' }}>
              {initials}
            </text>
            {/* Rule below */}
            <line x1="96" y1="172" x2="184" y2="172" stroke={AH.brass} strokeWidth="1.5" opacity="0.6" />
          </>
        )}

        {/* Outer brass border ring */}
        <circle cx="140" cy="140" r="135" fill="none"
          stroke="url(#ahCrestGold)" strokeWidth="10" opacity="0.7" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — gilded ivory plaque with brass frame
// ═══════════════════════════════════════════════════════════
export function AchievementHallText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'WELCOME TO OUR HALL OF FAME';
  const subtitle = config.subtitle || 'Est. 1962 · Excellence in Education';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Ivory plaque background */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(160deg, ${AH.ivory} 0%, #e8dcc8 100%)`,
          borderRadius: 6,
          boxShadow: `inset 0 2px 8px ${AH.shadow}, 0 8px 24px ${AH.shadow}`,
        }} />
        {/* Subtle wood-grain line texture */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 6, opacity: 0.06,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.4) 3px, rgba(0,0,0,0.4) 4px)',
        }} />
        <BrassFrame rounded={6} />

        {/* Text content — sits inside the brass border safe zone */}
        <div style={{
          position: 'absolute',
          top: '12%', left: '8%', right: '8%', bottom: '10%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AH_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 65%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={160} min={12} wrap={false}
              style={{
                fontFamily: AH_FONT_DISPLAY,
                color: AH.ink,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textShadow: `1px 1px 2px rgba(180,150,80,0.4)`,
              }}
            >
              {content}
            </EditableText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 35%', minHeight: 0 }}>
              {/* Divider rule */}
              <div style={{
                height: '2px',
                background: `linear-gradient(90deg, transparent, ${AH.brass}, transparent)`,
                margin: '0 10% 4% 10%',
              }} />
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={100} min={9} wrap={false}
                style={{
                  fontFamily: AH_FONT_DISPLAY,
                  color: AH.brassDark,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontVariant: 'small-caps',
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
// CLOCK — brass wall clock with Roman numerals + live hands
// ═══════════════════════════════════════════════════════════
const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

export function AchievementHallClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined;
  // Extract time components in the configured timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: tz,
  }).formatToParts(now);
  const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
  const h = getPart('hour') % 12;
  const m = getPart('minute');
  const s = getPart('second');

  const hourDeg   = (h * 30) + (m * 0.5);
  const minuteDeg = m * 6;
  const secondDeg = s * 6;

  // Date label
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: tz,
  }).format(now);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <svg viewBox="0 0 320 320" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 8px 22px ${AH.shadow})`, overflow: 'visible' }}>
        <defs>
          <radialGradient id="ahClockFace" cx="50%" cy="40%" r="55%">
            <stop offset="0%"   stopColor={AH.ivory} />
            <stop offset="100%" stopColor="#d9cebc" />
          </radialGradient>
          <radialGradient id="ahClockRim" cx="50%" cy="30%" r="65%">
            <stop offset="0%"   stopColor={AH.brassLight} />
            <stop offset="100%" stopColor={AH.brassDark} />
          </radialGradient>
          <radialGradient id="ahSpotClock" cx="50%" cy="15%" r="60%">
            <stop offset="0%"   stopColor="rgba(255,248,220,0.45)" />
            <stop offset="100%" stopColor="rgba(255,248,220,0)" />
          </radialGradient>
        </defs>

        {/* Outer brass bezel */}
        <circle cx="160" cy="160" r="155" fill="url(#ahClockRim)" />
        {/* Clock face */}
        <circle cx="160" cy="160" r="138" fill="url(#ahClockFace)" />
        {/* Spotlight glow */}
        <circle cx="160" cy="160" r="138" fill="url(#ahSpotClock)" />

        {/* Minute tick marks */}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i * 6 - 90) * Math.PI / 180;
          const isHour = i % 5 === 0;
          const r1 = isHour ? 116 : 122;
          return (
            <line key={i}
              x1={160 + Math.cos(a) * r1}   y1={160 + Math.sin(a) * r1}
              x2={160 + Math.cos(a) * 130}  y2={160 + Math.sin(a) * 130}
              stroke={isHour ? AH.brassDark : AH.brass}
              strokeWidth={isHour ? 3 : 1.2}
              opacity={isHour ? 1 : 0.5}
            />
          );
        })}

        {/* Roman numeral hour markers */}
        {ROMAN.map((numeral, i) => {
          const a = (i * 30 - 90) * Math.PI / 180;
          const r = 96;
          return (
            <text key={i}
              x={160 + Math.cos(a) * r}
              y={160 + Math.sin(a) * r}
              textAnchor="middle" dominantBaseline="central"
              fontSize={i === 0 || i === 6 ? 13 : 11}
              fontFamily={AH_FONT_DISPLAY}
              fill={AH.ink}
              fontWeight="600"
              letterSpacing="0"
            >
              {numeral}
            </text>
          );
        })}

        {/* Date sub-dial */}
        {!compact && (
          <text x="160" y="198" textAnchor="middle" fontSize="9"
            fontFamily={AH_FONT_DISPLAY} fill={AH.brassDark}
            letterSpacing="0.08em" textTransform="uppercase">
            {dateLabel.toUpperCase()}
          </text>
        )}

        {/* Hour hand */}
        <line
          x1="160" y1="160"
          x2={160 + Math.cos((hourDeg - 90) * Math.PI / 180) * 72}
          y2={160 + Math.sin((hourDeg - 90) * Math.PI / 180) * 72}
          stroke={AH.ink} strokeWidth="7" strokeLinecap="round" />

        {/* Minute hand */}
        <line
          x1="160" y1="160"
          x2={160 + Math.cos((minuteDeg - 90) * Math.PI / 180) * 100}
          y2={160 + Math.sin((minuteDeg - 90) * Math.PI / 180) * 100}
          stroke={AH.ink} strokeWidth="5" strokeLinecap="round" />

        {/* Second hand */}
        <line
          x1={160 + Math.cos((secondDeg - 90) * Math.PI / 180) * -22}
          y1={160 + Math.sin((secondDeg - 90) * Math.PI / 180) * -22}
          x2={160 + Math.cos((secondDeg - 90) * Math.PI / 180) * 112}
          y2={160 + Math.sin((secondDeg - 90) * Math.PI / 180) * 112}
          stroke={AH.accent} strokeWidth="2.5" strokeLinecap="round" />

        {/* Center cap */}
        <circle cx="160" cy="160" r="7" fill={AH.brass} stroke={AH.brassDark} strokeWidth="2" />
        <circle cx="160" cy="160" r="3" fill={AH.accent} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — wrought-iron weather-vane card + engraving icons
// ═══════════════════════════════════════════════════════════
export function AchievementHallWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  const low       = (cond || '').toLowerCase();
  const isSnow    = low.includes('snow') || low.includes('flurr');
  const isStorm   = low.includes('storm') || low.includes('thunder');
  const isRain    = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast= !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloud'));
  const isClear   = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  const isPartly  = !isClear && !isOvercast && !isRain && !isSnow && !isStorm;

  // Engraving-style icons — single-stroke brass on dark
  const SunIcon = (
    <g stroke={AH.gold} strokeWidth="5" strokeLinecap="round" fill="none">
      <circle cx="160" cy="120" r="40" stroke={AH.gold} strokeWidth="6" />
      {[0,45,90,135,180,225,270,315].map((deg, i) => {
        const a = deg * Math.PI / 180;
        return <line key={i}
          x1={160 + Math.cos(a)*52} y1={120 + Math.sin(a)*52}
          x2={160 + Math.cos(a)*68} y2={120 + Math.sin(a)*68} />;
      })}
    </g>
  );
  const CloudIcon = (
    <path d="M90 140 Q75 140 75 120 Q75 100 95 100 Q100 75 130 75 Q155 60 180 85 Q210 80 220 108 Q245 108 245 130 Q245 155 215 155 L110 155 Q90 155 90 140Z"
      fill="none" stroke={AH.brass} strokeWidth="5" />
  );
  const RainIcon = (
    <>
      {CloudIcon}
      {[[120,170],[145,182],[170,170],[195,182]].map(([x, y], i) => (
        <line key={i} x1={x} y1={y} x2={x - 8} y2={y + 24}
          stroke={AH.brassLight} strokeWidth="3.5" strokeLinecap="round" />
      ))}
    </>
  );
  const SnowIcon = (
    <>
      {CloudIcon}
      {[[120,172],[148,172],[175,172],[200,172]].map(([x, y], i) => (
        <g key={i} stroke={AH.brassLight} strokeWidth="3" strokeLinecap="round">
          <line x1={x-10} y1={y} x2={x+10} y2={y} />
          <line x1={x} y1={y-10} x2={x} y2={y+10} />
          <line x1={x-7} y1={y-7} x2={x+7} y2={y+7} />
          <line x1={x-7} y1={y+7} x2={x+7} y2={y-7} />
        </g>
      ))}
    </>
  );
  const StormIcon = (
    <>
      {CloudIcon}
      <path d="M155 158 L175 158 L155 192 L175 192 L135 228"
        stroke={AH.goldFoil} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </>
  );
  const PartlyIcon = (
    <>
      <g stroke={AH.gold} strokeWidth="4" fill="none">
        <circle cx="120" cy="100" r="30" />
        {[0,60,120,180,240,300].map((deg, i) => {
          const a = deg * Math.PI / 180;
          return <line key={i}
            x1={120 + Math.cos(a)*38} y1={100 + Math.sin(a)*38}
            x2={120 + Math.cos(a)*50} y2={100 + Math.sin(a)*50} />;
        })}
      </g>
      <path d="M130 145 Q118 145 118 130 Q118 115 130 115 Q133 100 150 100 Q165 88 178 102 Q196 98 202 114 Q218 114 218 128 Q218 145 200 145 Z"
        fill="none" stroke={AH.brass} strokeWidth="5" />
    </>
  );

  const icon = isClear ? SunIcon : isPartly ? PartlyIcon : isOvercast ? CloudIcon : isRain ? RainIcon : isSnow ? SnowIcon : StormIcon;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Dark iron backing */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          background: `linear-gradient(160deg, #2a1e12 0%, ${AH.woodDark} 100%)`,
          boxShadow: `inset 0 0 20px ${AH.shadow}, 0 8px 24px ${AH.shadow}`,
        }} />
        <BrassFrame rounded={8} />

        {/* Weather icon SVG */}
        <svg viewBox="0 0 320 240" width="100%" height="65%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', top: '2%', left: 0, right: 0 }}>
          {icon}
        </svg>

        {/* Temp + condition */}
        <div style={{
          position: 'absolute',
          left: '8%', right: '8%', top: '62%', bottom: '8%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AH_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 60%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={140} min={14} wrap={false}
              style={{ color: AH.goldFoil, letterSpacing: '0.04em' }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 38%', minHeight: 0 }}>
              <FitText max={60} min={9} wrap={false}
                style={{
                  color: AH.brassLight,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontVariant: 'small-caps',
                }}>
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
// COUNTDOWN — trophy plaque + "X DAYS" + burgundy ribbon drape
// ═══════════════════════════════════════════════════════════
export function AchievementHallCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 30 * 86400000);
  const label    = config.label || resolved?.prefix || 'Championship In';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HOUR' : 'HOURS');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Plaque background */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 4,
          background: `linear-gradient(160deg, ${AH.ivory} 0%, #e2d5be 100%)`,
          boxShadow: `inset 0 2px 8px ${AH.shadow}, 0 10px 30px ${AH.shadow}`,
        }} />
        <BrassFrame rounded={4} />

        {/* Burgundy ribbon drape SVG — decorative top strip */}
        <svg viewBox="0 0 400 80" width="100%" height="18%"
          preserveAspectRatio="none"
          style={{ position: 'absolute', top: '8%', left: 0, right: 0 }}>
          <path d="M0,0 L400,0 L400,50 Q200,70 0,50 Z" fill={AH.accent} />
          <path d="M0,0 L400,0 L400,4 Q200,24 0,4 Z" fill="#a83030" />
          {/* Ribbon ends dangling */}
          <polygon points="30,0 50,0 45,76 25,76" fill={AH.accent} />
          <polygon points="350,0 370,0 375,76 355,76" fill={AH.accent} />
          {/* Notch cuts on ribbon ends */}
          <polygon points="25,76 35,60 45,76" fill={AH.woodDark} />
          <polygon points="355,76 365,60 375,76" fill={AH.woodDark} />
        </svg>

        {/* Text content */}
        <div style={{
          position: 'absolute',
          top: '28%', left: '10%', right: '10%', bottom: '10%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AH_FONT_DISPLAY,
          textAlign: 'center',
          color: AH.ink,
        }}>
          {/* Label */}
          <div style={{ flex: '0 0 22%', minHeight: 0 }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={72} min={8} wrap={false}
              style={{
                fontFamily: AH_FONT_DISPLAY,
                color: AH.brassDark,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontVariant: 'small-caps',
              }}
            >
              {label}
            </EditableText>
          </div>
          {/* Big number */}
          <div style={{ flex: '0 0 52%', minHeight: 0 }}>
            <FitText max={280} min={22} wrap={false}
              style={{
                color: AH.ink,
                fontFamily: AH_FONT_DISPLAY,
                textShadow: `1px 1px 3px rgba(180,150,80,0.5)`,
              }}>
              {bigNum}
            </FitText>
          </div>
          {/* Unit */}
          <div style={{ flex: '0 0 26%', minHeight: 0 }}>
            <FitText max={72} min={8} wrap={false}
              style={{
                color: AH.brass,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                fontVariant: 'small-caps',
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
// ANNOUNCEMENT — velvet-lined brass-framed plaque
// ═══════════════════════════════════════════════════════════
export function AchievementHallAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title   = config.title   || 'NOTICE';
  const message = config.message || config.body || 'Congratulations to this year\'s Hall of Fame inductees — ceremony begins at 7pm in the gymnasium.';
  const date    = config.date    || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Velvet backing */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 6,
          background: `linear-gradient(160deg, #3a2020 0%, ${AH.velvet} 100%)`,
          boxShadow: `inset 0 0 24px rgba(0,0,0,0.6), 0 8px 24px ${AH.shadow}`,
        }} />
        {/* Velvet texture — subtle diagonal stripe */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 6, opacity: 0.04,
          backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 1px, transparent 8px)',
        }} />
        <BrassFrame rounded={6} />

        {/* Inner content */}
        <div style={{
          position: 'absolute',
          top: '12%', left: '9%', right: '9%', bottom: '10%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AH_FONT_DISPLAY,
        }}>
          {/* Title in brass engraving */}
          {!compact && (
            <div style={{ flex: '0 0 22%', minHeight: 0 }}>
              <FitText max={80} min={9} wrap={false}
                style={{
                  color: AH.gold,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontVariant: 'small-caps',
                  textShadow: `0 0 8px rgba(230,190,58,0.4)`,
                }}>
                — {title} —
              </FitText>
            </div>
          )}
          {/* Divider */}
          {!compact && (
            <div style={{
              height: '2px', flexShrink: 0, margin: '0 5% 2% 5%',
              background: `linear-gradient(90deg, transparent, ${AH.brass}, transparent)`,
            }} />
          )}
          {/* Message body */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={220} min={11}
              style={{
                fontFamily: AH_FONT_DISPLAY,
                color: AH.ivory,
                lineHeight: 1.35,
                textShadow: `1px 1px 3px rgba(0,0,0,0.6)`,
              }}
            >
              {message}
            </EditableText>
          </div>
          {/* Date footer */}
          {!compact && date && (
            <div style={{ flex: '0 0 16%', minHeight: 0, marginTop: '2%' }}>
              <FitText max={60} min={8} wrap={false}
                style={{
                  color: AH.brassLight,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontVariant: 'small-caps',
                }}>
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
// CALENDAR — 3 stacked brass-engraved event plaques
// ═══════════════════════════════════════════════════════════
export function AchievementHallCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events?.length ? config.events : [
    { date: 'FRI · MAY 3',  title: 'Hall of Fame Induction Ceremony' },
    { date: 'MON · MAY 6',  title: 'Spring Sports Awards Banquet' },
    { date: 'SAT · MAY 11', title: 'Alumni Golf Classic' },
  ]).slice(0, Math.max(1, Math.min(5, config.maxEvents ?? 3)));

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4%', gap: '3%' }}>
      {events.map((e: any, i: number) => (
        <div key={i} style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          {/* Ivory plaque background */}
          <div style={{
            position: 'absolute', inset: 0,
            background: i % 2 === 0
              ? `linear-gradient(135deg, ${AH.ivory} 0%, #e8dcca 100%)`
              : `linear-gradient(135deg, #ede3cf 0%, ${AH.ivory} 100%)`,
            boxShadow: `0 4px 12px ${AH.shadow}`,
          }} />
          {/* Brass left-edge accent */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px',
            background: `linear-gradient(180deg, ${AH.brassLight}, ${AH.brassDark})`,
          }} />
          {/* Thin brass border top+bottom */}
          <div style={{ position: 'absolute', top: 0,    left: 0, right: 0, height: '2px', background: AH.brass, opacity: 0.6 }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px', background: AH.brass, opacity: 0.6 }} />

          {/* Content */}
          <div style={{
            position: 'absolute',
            left: '10%', right: '3%', top: '10%', bottom: '10%',
            display: 'flex', flexDirection: 'column',
            fontFamily: AH_FONT_DISPLAY,
          }}>
            <div style={{ flex: '0 0 38%', minHeight: 0 }}>
              <FitText max={100} min={7} wrap={false} center={false}
                style={{
                  color: AH.brassDark,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontVariant: 'small-caps',
                }}>
                {e.date}
              </FitText>
            </div>
            <div style={{ flex: '1 1 62%', minHeight: 0 }}>
              <FitText max={160} min={9} wrap={false} center={false}
                style={{
                  color: AH.ink,
                  letterSpacing: '0.03em',
                }}>
                {e.title}
              </FitText>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — Hall of Fame gold oval frame + name plaque
// ═══════════════════════════════════════════════════════════
export function AchievementHallStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name     = config.staffName || config.name || 'Coach Williams';
  const role     = config.role      || 'Hall of Fame Inductee · Class of 2024';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '4%', gap: '3%', containerType: 'size' }}>
      {/* Gold oval portrait frame */}
      <div style={{ flex: '0 0 68%', width: '70%', position: 'relative', minHeight: 0 }}>
        <svg viewBox="0 0 280 340" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: `drop-shadow(0 6px 18px ${AH.shadow})`, overflow: 'visible' }}>
          <defs>
            <radialGradient id="ahOvalGold" cx="50%" cy="30%" r="65%">
              <stop offset="0%"   stopColor={AH.goldFoil} />
              <stop offset="100%" stopColor={AH.gold} />
            </radialGradient>
            <clipPath id="ahOvalClip">
              <ellipse cx="140" cy="165" rx="106" ry="138" />
            </clipPath>
          </defs>
          {/* Outer ornate oval — gold */}
          <ellipse cx="140" cy="165" rx="138" ry="168" fill="url(#ahOvalGold)" />
          {/* Inner dark ring */}
          <ellipse cx="140" cy="165" rx="120" ry="150" fill={AH.brassDark} />
          {/* Velvet mat */}
          <ellipse cx="140" cy="165" rx="110" ry="140" fill={AH.velvet} />
          {/* Portrait image or silhouette */}
          {photoUrl ? (
            <image href={resolveUrl(photoUrl)} x="30" y="25" width="220" height="280"
              preserveAspectRatio="xMidYMid slice" clipPath="url(#ahOvalClip)" />
          ) : (
            <g clipPath="url(#ahOvalClip)">
              {/* Silhouette placeholder */}
              <rect x="30" y="25" width="220" height="280" fill={AH.velvet} />
              <ellipse cx="140" cy="130" rx="44" ry="48" fill={AH.brass} opacity="0.4" />
              <ellipse cx="140" cy="240" rx="70" ry="60" fill={AH.brass} opacity="0.3" />
              <text x="140" y="168" textAnchor="middle" fontSize="28"
                fontFamily={AH_FONT_DISPLAY} fill={AH.brassLight} opacity="0.6">
                ★
              </text>
            </g>
          )}
          {/* Decorative corner ornaments on the gold oval */}
          {[[-100,-150],[100,-150]].map(([dx, dy], i) => (
            <text key={i} x={140 + dx} y={165 + dy} textAnchor="middle"
              fontSize="16" fontFamily={AH_FONT_DISPLAY} fill={AH.brassDark} opacity="0.6">
              ✦
            </text>
          ))}
        </svg>
      </div>

      {/* Engraved brass name plaque below */}
      <div style={{
        flex: '0 0 30%', width: '100%', position: 'relative', minHeight: 0,
      }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 3,
          background: `linear-gradient(160deg, ${AH.ivory} 0%, #e0d4bc 100%)`,
          boxShadow: `inset 0 1px 6px ${AH.shadow}, 0 4px 12px ${AH.shadow}`,
        }} />
        <BrassFrame rounded={3} />
        <div style={{
          position: 'absolute',
          top: '12%', left: '8%', right: '8%', bottom: '10%',
          display: 'flex', flexDirection: 'column',
          fontFamily: AH_FONT_DISPLAY,
        }}>
          <div style={{ flex: '1 1 60%', minHeight: 0 }}>
            <EditableText
              configKey="staffName" onConfigChange={onConfigChange}
              max={120} min={10} wrap={false}
              style={{
                color: AH.ink,
                letterSpacing: '0.06em',
                textShadow: `1px 1px 2px rgba(180,150,80,0.4)`,
              }}
            >
              {name}
            </EditableText>
          </div>
          <div style={{
            height: '1px', flexShrink: 0, margin: '0 8%',
            background: `linear-gradient(90deg, transparent, ${AH.brass}, transparent)`,
          }} />
          <div style={{ flex: '0 0 35%', minHeight: 0 }}>
            <EditableText
              configKey="role" onConfigChange={onConfigChange}
              max={80} min={7} wrap={false}
              style={{
                color: AH.brassDark,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontVariant: 'small-caps',
              }}
            >
              {role}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — museum ornate gold picture frame
// ═══════════════════════════════════════════════════════════
export function AchievementHallImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 6000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Ornate frame SVG overlay */}
        <svg viewBox="0 0 400 300" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none' }}>
          <defs>
            <linearGradient id="ahFrameH" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor={AH.brassDark} />
              <stop offset="20%"  stopColor={AH.goldFoil} />
              <stop offset="50%"  stopColor={AH.brassLight} />
              <stop offset="80%"  stopColor={AH.goldFoil} />
              <stop offset="100%" stopColor={AH.brassDark} />
            </linearGradient>
          </defs>
          {/* Outer thick frame */}
          <rect x="0" y="0" width="400" height="300" rx="4"
            fill="none" stroke="url(#ahFrameH)" strokeWidth="28" />
          {/* Inner accent line */}
          <rect x="18" y="18" width="364" height="264" rx="2"
            fill="none" stroke={AH.brassDark} strokeWidth="3" opacity="0.8" />
          {/* Corner florals */}
          {[[14, 14], [386, 14], [14, 286], [386, 286]].map(([cx, cy], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r="14" fill={AH.gold} stroke={AH.brassDark} strokeWidth="2" />
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central"
                fontSize="12" fill={AH.brassDark} fontFamily={AH_FONT_DISPLAY}>✦</text>
            </g>
          ))}
          {/* Mid-edge ornaments */}
          {[[200, 8], [200, 292]].map(([cx, cy], i) => (
            <g key={`m${i}`}>
              <ellipse cx={cx} cy={cy} rx="18" ry="10" fill={AH.gold} stroke={AH.brassDark} strokeWidth="2" />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                fontSize="9" fill={AH.brassDark} fontFamily={AH_FONT_DISPLAY}>❧</text>
            </g>
          ))}
        </svg>

        {/* Image / placeholder inside the frame */}
        <div style={{
          position: 'absolute', inset: '10%',
          background: AH.velvet,
          overflow: 'hidden',
        }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Gallery"
              className="transition-opacity duration-700"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: AH_FONT_DISPLAY,
              color: AH.brassLight,
              textAlign: 'center',
              padding: '8%',
            }}>
              <div style={{ fontSize: 'clamp(28px, 20cqh, 120px)', lineHeight: 1, opacity: 0.5 }}>🏆</div>
              <div style={{
                marginTop: '4%', fontSize: 'clamp(10px, 5cqh, 36px)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>
                Add Photo
              </div>
              <div style={{
                fontSize: 'clamp(8px, 3.5cqh, 22px)',
                color: AH.brass, marginTop: '2%',
                fontVariant: 'small-caps', letterSpacing: '0.08em',
              }}>
                drop image in the builder
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — engraved brass strip with small-caps serif message
// ═══════════════════════════════════════════════════════════
export function AchievementHallTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['✦ CONGRATULATIONS TO ALL 2024 HALL OF FAME INDUCTEES ✦'];
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
      {/* Brass strip background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, ${AH.brassLight} 0%, ${AH.brass} 40%, ${AH.brassDark} 100%)`,
        boxShadow: `inset 0 3px 8px rgba(0,0,0,0.5), inset 0 -3px 8px rgba(0,0,0,0.35)`,
      }} />
      {/* Engraving line accents top + bottom */}
      <div style={{ position: 'absolute', top: '10%',    left: '1%', right: '1%', height: '2px', background: AH.brassDark, opacity: 0.6 }} />
      <div style={{ position: 'absolute', bottom: '10%', left: '1%', right: '1%', height: '2px', background: AH.brassDark, opacity: 0.6 }} />
      {/* Left/right finial ornaments */}
      <div style={{
        position: 'absolute', left: '0.5%', top: '50%', transform: 'translateY(-50%)',
        fontSize: compact ? '0.7em' : '1em',
        color: AH.brassDark, fontFamily: AH_FONT_DISPLAY,
        lineHeight: 1,
      }}>✦</div>
      <div style={{
        position: 'absolute', right: '0.5%', top: '50%', transform: 'translateY(-50%)',
        fontSize: compact ? '0.7em' : '1em',
        color: AH.brassDark, fontFamily: AH_FONT_DISPLAY,
        lineHeight: 1,
      }}>✦</div>

      {/* Message text */}
      <div style={{
        position: 'absolute', inset: '10% 4% 10% 4%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        <FitText max={compact ? 60 : 80} min={9} wrap={false}
          style={{
            fontFamily: AH_FONT_DISPLAY,
            color: AH.ink,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontVariant: 'small-caps',
            textShadow: `0 1px 2px rgba(255,255,200,0.5), 0 -1px 2px rgba(0,0,0,0.35)`,
          }}>
          {primary}
        </FitText>
      </div>
    </div>
  );
}
