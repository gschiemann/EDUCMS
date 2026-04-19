"use client";

/**
 * Track Day — elementary-school athletics lobby theme.
 *
 * Widgets are miniature STADIUM PROPS, not rectangles:
 *   LOGO             → round school-shield badge with running-shoe + olympic rings
 *   TEXT (banner)    → chalked grass ribbon, two orange cones flanking
 *   CLOCK            → stopwatch silhouette, live analog hands
 *   WEATHER          → coach's whistle with condition icon inside
 *   COUNTDOWN        → vertical finish-line checkered banner
 *   ANNOUNCEMENT     → clipboard with ruled paper + silver clip
 *   CALENDAR         → stacked lane-colored event strips
 *   STAFF_SPOTLIGHT  → coach's polaroid tacked to cork
 *   IMAGE_CAROUSEL   → trophy-case gold frame
 *   TICKER           → finish-line ribbon with checkered pattern
 */

import { useEffect, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '') : 'http://localhost:8080';
function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Palette ────────────────────────────────────────────
export const TD = {
  grass:     '#4FB06B',
  grassDark: '#2E7A47',
  track:     '#B85450',
  trackDark: '#8B3F3C',
  lane:      '#FFFFFF',
  sun:       '#FFC857',
  chalk:     '#FFF8E7',
  ink:       '#1F2937',
  inkSoft:   '#4B5563',
  gold:      '#F5D547',
  silver:    '#C0C0C0',
  shadow:    'rgba(31,41,55,0.35)',
};

export const TD_FONT_DISPLAY = "'Bungee', 'Bebas Neue', system-ui, sans-serif";
export const TD_FONT_BODY    = "'Fredoka', system-ui, sans-serif";
export const TD_FONT_SCRIPT  = "'Caveat', cursive";

// ═══════════════════════════════════════════════════════════
// LOGO — round school-shield badge with running-shoe + olympic rings
// ═══════════════════════════════════════════════════════════
export function TrackDayLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'Eagles').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'EA');
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 6px 10px ${TD.shadow})`, overflow: 'visible' }}>
        {/* Gold olympic-ring accents behind shield */}
        <g opacity="0.9" strokeWidth="4" fill="none">
          <circle cx="70"  cy="90"  r="18" stroke={TD.gold} />
          <circle cx="110" cy="90"  r="18" stroke={TD.track} />
          <circle cx="150" cy="90"  r="18" stroke={TD.grassDark} />
          <circle cx="190" cy="90"  r="18" stroke={TD.sun} />
        </g>
        {/* Shield body */}
        <path d="M130 30 L220 60 L220 150 Q220 220 130 240 Q40 220 40 150 L40 60 Z"
          fill={TD.grass} stroke={TD.ink} strokeWidth="6" />
        <path d="M130 30 L220 60 L220 150 Q220 220 130 240 Q40 220 40 150 L40 60 Z"
          fill="none" stroke={TD.lane} strokeWidth="3" strokeDasharray="6 8" opacity="0.65" />
        {/* Inner disc */}
        <circle cx="130" cy="140" r="58" fill={TD.chalk} stroke={TD.ink} strokeWidth="4" />
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="75" y="85" width="110" height="110"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(55px at 130px 140px)" />
        ) : (
          <g>
            {/* Running shoe silhouette */}
            <path d="M95 150 Q95 135 115 132 L140 125 Q160 122 170 138 L172 150 Q172 158 165 160 L105 160 Q95 160 95 150 Z"
              fill={TD.track} stroke={TD.ink} strokeWidth="3" />
            <path d="M100 148 L170 148" stroke={TD.lane} strokeWidth="1.5" />
            {/* Laces */}
            <line x1="120" y1="138" x2="150" y2="130" stroke={TD.ink} strokeWidth="1.5" />
            <line x1="124" y1="144" x2="154" y2="136" stroke={TD.ink} strokeWidth="1.5" />
            {/* Speed streaks */}
            <line x1="68" y1="140" x2="88" y2="140" stroke={TD.gold} strokeWidth="3" strokeLinecap="round" />
            <line x1="72" y1="152" x2="90" y2="152" stroke={TD.gold} strokeWidth="3" strokeLinecap="round" />
            <line x1="76" y1="164" x2="92" y2="164" stroke={TD.gold} strokeWidth="3" strokeLinecap="round" />
            {/* Initials on ribbon */}
            <rect x="85" y="172" width="90" height="22" rx="4" fill={TD.gold} stroke={TD.ink} strokeWidth="2" />
            <text x="130" y="188" textAnchor="middle"
              fontFamily={TD_FONT_DISPLAY} fontSize="16" fontWeight="700" fill={TD.ink}>
              {initials}
            </text>
          </g>
        )}
        {/* Top banner */}
        <path d="M50 45 Q130 25 210 45 L205 70 Q130 50 55 70 Z"
          fill={TD.gold} stroke={TD.ink} strokeWidth="3" />
        <text x="130" y="63" textAnchor="middle"
          fontFamily={TD_FONT_DISPLAY} fontSize="14" fontWeight="700" fill={TD.ink}>
          ATHLETICS
        </text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — chalked hand-painted grass ribbon with orange cones
// ═══════════════════════════════════════════════════════════
export function TrackDayText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || "LET'S RUN!";
  const subtitle = config.subtitle || '~ welcome back, team ~';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '1%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 3200 360" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: `drop-shadow(0 10px 16px ${TD.shadow})`, position: 'absolute', inset: 0 }}>
          {/* Chalk ribbon body — hand-drawn wiggle */}
          <path d="M60 70 Q200 40 500 60 T1200 55 T2000 65 T2800 50 Q3080 55 3140 80
                   L3140 280 Q3080 300 2800 295 T2000 290 T1200 300 T500 295 Q200 310 60 285 Z"
            fill={TD.chalk} stroke={TD.ink} strokeWidth="6" />
          {/* Chalk stripes */}
          <path d="M120 180 Q800 160 1600 180 T3080 175" stroke={TD.track} strokeWidth="3" fill="none" opacity="0.3" />
          {/* Left cone */}
          <g transform="translate(60 180)">
            <polygon points="0,120 -30,20 30,20" fill={TD.sun} stroke={TD.ink} strokeWidth="5" />
            <rect x="-34" y="110" width="68" height="18" rx="3" fill={TD.trackDark} stroke={TD.ink} strokeWidth="4" />
            <rect x="-26" y="55" width="52" height="8" fill={TD.lane} opacity="0.85" />
          </g>
          {/* Right cone */}
          <g transform="translate(3140 180)">
            <polygon points="0,120 -30,20 30,20" fill={TD.sun} stroke={TD.ink} strokeWidth="5" />
            <rect x="-34" y="110" width="68" height="18" rx="3" fill={TD.trackDark} stroke={TD.ink} strokeWidth="4" />
            <rect x="-26" y="55" width="52" height="8" fill={TD.lane} opacity="0.85" />
          </g>
        </svg>
        <div style={{
          position: 'absolute',
          left: '6%', right: '6%', top: '18%', bottom: '18%',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 68%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={220} min={14} wrap={false}
              style={{
                fontFamily: TD_FONT_DISPLAY, fontWeight: 700,
                color: TD.track,
                textShadow: `3px 3px 0 ${TD.chalk}, 5px 5px 0 ${TD.ink}`,
                letterSpacing: '0.04em',
              }}
            >
              {content}
            </EditableText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 32%', minHeight: 0 }}>
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={140} min={10} wrap={false}
                style={{ fontFamily: TD_FONT_SCRIPT, color: TD.grassDark }}
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
// CLOCK — stopwatch with live analog hands
// ═══════════════════════════════════════════════════════════
export function TrackDayClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(now);
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const minAngle = (minutes * 6) + (seconds * 0.1) - 90;
  const hrAngle  = (hours * 30) + (minutes * 0.5) - 90;
  const secAngle = (seconds * 6) - 90;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <svg viewBox="0 0 300 360" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 10px 14px ${TD.shadow})`, overflow: 'visible' }}>
        {/* Top button */}
        <rect x="135" y="10" width="30" height="28" rx="4" fill={TD.silver} stroke={TD.ink} strokeWidth="3" />
        <rect x="138" y="0"  width="24" height="16" rx="3" fill={TD.gold} stroke={TD.ink} strokeWidth="2.5" />
        {/* Lanyard ring */}
        <circle cx="150" cy="48" r="8" fill="none" stroke={TD.ink} strokeWidth="3" />
        {/* Body */}
        <circle cx="150" cy="200" r="115" fill={TD.chalk} stroke={TD.ink} strokeWidth="7" />
        <circle cx="150" cy="200" r="105" fill="none" stroke={TD.silver} strokeWidth="2" />
        {/* Tick marks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 - 90) * Math.PI / 180;
          const x1 = 150 + Math.cos(a) * 95;
          const y1 = 200 + Math.sin(a) * 95;
          const x2 = 150 + Math.cos(a) * 105;
          const y2 = 200 + Math.sin(a) * 105;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={TD.ink} strokeWidth={i % 3 === 0 ? 4 : 2} strokeLinecap="round" />;
        })}
        {/* Hands */}
        <line x1="150" y1="200"
          x2={150 + Math.cos(hrAngle * Math.PI / 180) * 55}
          y2={200 + Math.sin(hrAngle * Math.PI / 180) * 55}
          stroke={TD.ink} strokeWidth="6" strokeLinecap="round" />
        <line x1="150" y1="200"
          x2={150 + Math.cos(minAngle * Math.PI / 180) * 80}
          y2={200 + Math.sin(minAngle * Math.PI / 180) * 80}
          stroke={TD.inkSoft} strokeWidth="4" strokeLinecap="round" />
        <line x1="150" y1="200"
          x2={150 + Math.cos(secAngle * Math.PI / 180) * 90}
          y2={200 + Math.sin(secAngle * Math.PI / 180) * 90}
          stroke={TD.track} strokeWidth="2" strokeLinecap="round" />
        <circle cx="150" cy="200" r="6" fill={TD.track} stroke={TD.ink} strokeWidth="2" />
        {/* Digital time readout */}
        {!compact && (
          <g>
            <rect x="95" y="240" width="110" height="28" rx="4" fill={TD.ink} />
            <text x="150" y="260" textAnchor="middle"
              fontFamily={TD_FONT_DISPLAY} fontSize="20" fontWeight="700" fill={TD.gold}>
              {time}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — coach's whistle with condition icon inside
// ═══════════════════════════════════════════════════════════
export function TrackDayWeather({ config, compact }: { config: any; compact?: boolean }) {
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
  const isClear = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  const isPartly = !isClear && !isOvercast && !isRain && !isSnow && !isStorm;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 300 360" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 10px 14px ${TD.shadow})`, overflow: 'visible' }}>
        {/* Lanyard cord */}
        <path d="M150 0 Q140 30 150 55" stroke={TD.track} strokeWidth="6" fill="none" strokeLinecap="round" />
        {/* Lanyard ring */}
        <circle cx="150" cy="60" r="10" fill="none" stroke={TD.ink} strokeWidth="3" />
        {/* Whistle body — main oval */}
        <ellipse cx="150" cy="180" rx="110" ry="95" fill={TD.silver} stroke={TD.ink} strokeWidth="6" />
        <ellipse cx="150" cy="180" rx="95"  ry="80" fill={TD.chalk} stroke={TD.ink} strokeWidth="3" />
        {/* Mouthpiece spout (left) */}
        <path d="M45 170 L10 160 L10 200 L45 190 Z" fill={TD.silver} stroke={TD.ink} strokeWidth="5" />
        {/* Top air slot */}
        <rect x="125" y="105" width="50" height="10" rx="3" fill={TD.ink} />
        {/* Condition icon in the face */}
        {isClear && (
          <g>
            <circle cx="150" cy="185" r="40" fill={TD.sun} stroke={TD.ink} strokeWidth="3" />
            <g stroke={TD.sun} strokeWidth="5" strokeLinecap="round">
              <line x1="150" y1="130" x2="150" y2="138" />
              <line x1="150" y1="232" x2="150" y2="240" />
              <line x1="95"  y1="185" x2="103" y2="185" />
              <line x1="197" y1="185" x2="205" y2="185" />
              <line x1="110" y1="145" x2="116" y2="151" />
              <line x1="184" y1="219" x2="190" y2="225" />
              <line x1="190" y1="145" x2="184" y2="151" />
              <line x1="116" y1="219" x2="110" y2="225" />
            </g>
            <circle cx="140" cy="180" r="3" fill={TD.ink} />
            <circle cx="160" cy="180" r="3" fill={TD.ink} />
            <path d="M138 195 Q150 205 162 195" stroke={TD.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>
        )}
        {isPartly && (
          <g>
            <circle cx="130" cy="170" r="30" fill={TD.sun} stroke={TD.ink} strokeWidth="3" />
            <path d="M120 205 Q100 205 100 185 Q100 170 115 170 Q125 150 150 160 Q175 155 185 180 Q205 180 205 200 Q205 220 185 220 L135 220 Q120 220 120 205 Z"
              fill={TD.lane} stroke={TD.ink} strokeWidth="3" />
          </g>
        )}
        {isOvercast && (
          <path d="M95 200 Q80 200 80 180 Q80 160 100 160 Q110 135 140 145 Q165 135 180 160 Q205 160 210 185 Q215 215 190 215 L110 215 Q95 215 95 200 Z"
            fill="#D8DDE8" stroke={TD.ink} strokeWidth="4" />
        )}
        {isRain && (
          <g>
            <path d="M95 180 Q80 180 80 160 Q80 140 100 140 Q110 115 140 125 Q165 115 180 140 Q205 140 210 165 Q215 195 190 195 L110 195 Q95 195 95 180 Z"
              fill={TD.lane} stroke={TD.ink} strokeWidth="4" />
            <g fill="#3B82F6">
              <circle cx="115" cy="220" r="5" /><circle cx="145" cy="230" r="5" />
              <circle cx="175" cy="220" r="5" /><circle cx="200" cy="230" r="5" />
            </g>
          </g>
        )}
        {isSnow && (
          <g>
            <path d="M95 180 Q80 180 80 160 Q80 140 100 140 Q110 115 140 125 Q165 115 180 140 Q205 140 210 165 Q215 195 190 195 L110 195 Q95 195 95 180 Z"
              fill="#D8DDE8" stroke={TD.ink} strokeWidth="4" />
            <g stroke={TD.ink} strokeWidth="2.5" strokeLinecap="round">
              {[[120, 225], [155, 235], [190, 225]].map(([x, y], i) => (
                <g key={i}>
                  <line x1={x - 8} y1={y} x2={x + 8} y2={y} />
                  <line x1={x} y1={y - 8} x2={x} y2={y + 8} />
                </g>
              ))}
            </g>
          </g>
        )}
        {isStorm && (
          <g>
            <path d="M95 170 Q80 170 80 150 Q80 130 100 130 Q110 105 140 115 Q165 105 180 130 Q205 130 210 155 Q215 185 190 185 L110 185 Q95 185 95 170 Z"
              fill="#6B7280" stroke={TD.ink} strokeWidth="4" />
            <path d="M150 185 L170 185 L155 215 L175 215 L135 255 L150 225 L130 225 Z"
              fill={TD.gold} stroke={TD.ink} strokeWidth="3" />
          </g>
        )}
        {/* Temp + cond */}
        {!compact && (
          <g>
            <text x="150" y="320" textAnchor="middle"
              fontFamily={TD_FONT_DISPLAY} fontSize="40" fontWeight="700" fill={TD.ink}>
              {temp}°
            </text>
            <text x="150" y="348" textAnchor="middle"
              fontFamily={TD_FONT_SCRIPT} fontSize="18" fill={TD.trackDark}>
              {cond}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — vertical finish-line checkered banner
// ═══════════════════════════════════════════════════════════
export function TrackDayCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 12 * 86400000);
  const label = (config.label || resolved?.prefix || 'Field Day in').toUpperCase();
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const bigNum = days > 0 ? days : hours;
  const unit = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HR' : 'HRS');

  // Checkered pattern — 6 cols x many rows
  const cols = 6;
  const rows = 24;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%',
        filter: `drop-shadow(0 10px 16px ${TD.shadow})` }}>
        {/* Top flagpole finial */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '70%', height: '4%',
          background: TD.gold, border: `3px solid ${TD.ink}`,
          borderRadius: 4, zIndex: 2,
        }} />
        {/* Checkered body */}
        <div style={{
          position: 'absolute', top: '4%', left: '5%', right: '5%', bottom: '4%',
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          border: `4px solid ${TD.ink}`,
          background: TD.lane,
          overflow: 'hidden',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const dark = (r + c) % 2 === 0;
            return <div key={i} style={{ background: dark ? TD.ink : TD.lane }} />;
          })}
        </div>
        {/* Center label card */}
        <div style={{
          position: 'absolute', top: '20%', left: '-5%', right: '-5%', bottom: '20%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 3,
          background: TD.track,
          border: `5px solid ${TD.ink}`,
          borderRadius: 12,
          padding: '6% 3%',
          fontFamily: TD_FONT_DISPLAY, color: TD.lane,
          boxShadow: `inset 0 0 0 3px ${TD.gold}`,
        }}>
          <div style={{ flex: '0 0 18%', minHeight: 0, width: '100%' }}>
            <EditableText configKey="label" onConfigChange={onConfigChange}
              max={60} min={8} wrap={true}
              style={{ fontWeight: 800, letterSpacing: '0.05em', textShadow: `2px 2px 0 ${TD.ink}` }}>
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 58%', minHeight: 0, width: '100%' }}>
            <FitText max={240} min={24} wrap={false}
              style={{ fontWeight: 800, color: TD.gold, textShadow: `4px 4px 0 ${TD.ink}` }}>
              {bigNum}
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 22%', minHeight: 0, width: '100%' }}>
              <FitText max={90} min={10} wrap={false}
                style={{ fontWeight: 800, letterSpacing: '0.1em', textShadow: `2px 2px 0 ${TD.ink}` }}>
                {unit}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — clipboard with ruled paper + silver clip
// ═══════════════════════════════════════════════════════════
export function TrackDayAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title = config.title || 'COACH SAYS';
  const message = config.message || config.body || 'Field Day is Friday! Wear your school colors.';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        transform: 'rotate(-1.5deg)',
        filter: `drop-shadow(0 14px 20px ${TD.shadow})`,
      }}>
        {/* Clipboard backing */}
        <div style={{
          position: 'absolute', inset: 0,
          background: '#A1662F',
          borderRadius: 10,
          border: `4px solid ${TD.ink}`,
          boxShadow: `inset 0 0 0 2px #8B5A2B, inset 0 0 40px rgba(0,0,0,0.2)`,
        }} />
        {/* Silver clip */}
        <div style={{
          position: 'absolute', top: '-3%', left: '50%', transform: 'translateX(-50%)',
          width: '26%', height: '12%',
          background: `linear-gradient(180deg, #E5E7EB 0%, ${TD.silver} 60%, #9CA3AF 100%)`,
          borderRadius: '6px 6px 4px 4px',
          border: `3px solid ${TD.ink}`,
          boxShadow: `0 4px 6px ${TD.shadow}`,
          zIndex: 5,
        }}>
          <div style={{
            position: 'absolute', top: '30%', left: '50%', transform: 'translateX(-50%)',
            width: '30%', height: '50%',
            borderRadius: '50%',
            background: '#6B7280',
            boxShadow: `inset 0 0 0 2px ${TD.ink}`,
          }} />
        </div>
        {/* Paper */}
        <div style={{
          position: 'absolute', top: '7%', left: '4%', right: '4%', bottom: '4%',
          background: TD.chalk,
          border: `2px solid ${TD.inkSoft}`,
          borderRadius: 3,
          padding: '4% 5%',
          display: 'flex', flexDirection: 'column',
          backgroundImage: `repeating-linear-gradient(180deg, transparent 0 7.5%, rgba(100,116,139,0.3) 7.5% 7.8%)`,
          backgroundSize: '100% 100%',
        }}>
          {/* Red margin line */}
          <div style={{
            position: 'absolute', top: '2%', bottom: '2%', left: '12%',
            width: 2, background: TD.track, opacity: 0.7,
          }} />
          {/* Title */}
          <div style={{ flex: '0 0 22%', minHeight: 0, marginLeft: '8%' }}>
            <FitText max={80} min={10} wrap={false} center={false}
              style={{ fontFamily: TD_FONT_DISPLAY, fontWeight: 700, color: TD.track, letterSpacing: '0.04em' }}>
              ★ {title} ★
            </FitText>
          </div>
          {/* Message */}
          <div style={{ flex: '1 1 auto', minHeight: 0, marginLeft: '8%' }}>
            <EditableText configKey="message" onConfigChange={onConfigChange}
              max={240} min={10} center={false}
              style={{ fontFamily: TD_FONT_BODY, fontWeight: 500, color: TD.ink, lineHeight: 1.3 }}>
              {message}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — stacked lane-colored event strips
// ═══════════════════════════════════════════════════════════
export function TrackDayCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'MON · 3:15pm', title: '🏃 100m Sprint — Lane Relay' },
    { date: 'TUE · 3:30pm', title: '🥏 Disc Toss — Field B' },
    { date: 'WED · 3:00pm', title: '🦘 Long Jump Practice' },
    { date: 'FRI · 10:00am', title: '🏆 Field Day — ALL GRADES' },
  ]).slice(0, Math.max(1, Math.min(12, config.maxEvents ?? 4)));

  const laneColors = [TD.track, TD.sun, TD.grassDark, TD.gold];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '3%', gap: '2%' }}>
      {events.map((e: any, i: number) => {
        const bg = laneColors[i % laneColors.length];
        const laneNum = i + 1;
        return (
          <div key={i} style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            background: bg,
            border: `4px solid ${TD.ink}`,
            borderRadius: 8,
            boxShadow: `0 6px 10px ${TD.shadow}`,
            display: 'flex',
            alignItems: 'center',
            gap: '2%',
            padding: '0 3% 0 1%',
            overflow: 'hidden',
            backgroundImage: `repeating-linear-gradient(90deg, transparent 0 3%, rgba(255,255,255,0.15) 3% 3.3%)`,
          }}>
            {/* Lane number bubble */}
            <div style={{
              height: '84%', aspectRatio: '1 / 1',
              borderRadius: '50%',
              background: TD.chalk,
              border: `4px solid ${TD.ink}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              fontFamily: TD_FONT_DISPLAY, fontWeight: 800,
              color: TD.ink,
              fontSize: 'clamp(14px, 5cqh, 40px)',
            }}>
              {laneNum}
            </div>
            {/* Text stack */}
            <div style={{
              flex: 1, minWidth: 0, height: '92%',
              display: 'flex', flexDirection: 'column',
              fontFamily: TD_FONT_DISPLAY,
            }}>
              <div style={{ flex: '0 0 38%', minHeight: 0 }}>
                <FitText max={160} min={8} wrap={false} center={false}
                  style={{ fontFamily: TD_FONT_SCRIPT, color: TD.chalk, textShadow: `1.5px 1.5px 0 ${TD.ink}` }}>
                  {e.date}
                </FitText>
              </div>
              <div style={{ flex: '1 1 62%', minHeight: 0 }}>
                <FitText max={260} min={10} wrap={false} center={false}
                  style={{ fontWeight: 700, color: TD.lane, textShadow: `2px 2px 0 ${TD.ink}` }}>
                  {e.title}
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
// STAFF SPOTLIGHT — coach's polaroid tacked to cork
// ═══════════════════════════════════════════════════════════
export function TrackDayStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || config.name || 'Coach Martinez';
  const role = config.role || 'Coach of the Month';
  const quote = config.bio || config.quote || '"Make today your personal best!"';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%', containerType: 'size' }}>
      {/* Cork backing */}
      <div style={{
        position: 'absolute', inset: '2%',
        background: `radial-gradient(circle at 20% 20%, #D4A574 0%, #B8894F 100%)`,
        borderRadius: 10,
        boxShadow: `inset 0 0 60px rgba(0,0,0,0.3)`,
        backgroundImage: `radial-gradient(circle at 12% 22%, rgba(0,0,0,0.18) 0 1px, transparent 2px),
                          radial-gradient(circle at 78% 34%, rgba(0,0,0,0.15) 0 1px, transparent 2px),
                          radial-gradient(circle at 45% 78%, rgba(0,0,0,0.2) 0 1px, transparent 2px),
                          radial-gradient(circle at 88% 88%, rgba(0,0,0,0.15) 0 1px, transparent 2px)`,
        backgroundSize: '30px 30px, 40px 40px, 25px 25px, 35px 35px',
      }} />
      {/* Polaroid */}
      <div style={{
        position: 'relative', width: '86%', height: '92%',
        background: TD.chalk,
        borderRadius: 4,
        padding: '5% 5% 2% 5%',
        boxShadow: `0 14px 24px ${TD.shadow}`,
        transform: 'rotate(-3deg)',
        display: 'flex', flexDirection: 'column',
        fontFamily: TD_FONT_DISPLAY,
      }}>
        {/* Red pushpin */}
        <div style={{
          position: 'absolute', top: '-4%', left: '50%', transform: 'translateX(-50%)',
          width: '10%', aspectRatio: '1 / 1',
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, #FF9B9B 0%, ${TD.track} 60%, ${TD.trackDark} 100%)`,
          border: `2px solid ${TD.ink}`,
          boxShadow: `0 4px 6px ${TD.shadow}`,
          zIndex: 5,
        }} />
        {/* Photo */}
        <div style={{
          flex: '1 1 68%', minHeight: 0,
          background: TD.grass,
          border: `3px solid ${TD.ink}`,
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ fontSize: 'clamp(30px, 30cqh, 180px)' }}>🏃‍♂️</div>
          )}
        </div>
        {/* Caption area */}
        <div style={{
          flex: '0 0 28%', minHeight: 0,
          display: 'flex', flexDirection: 'column',
          paddingTop: '3%',
        }}>
          <div style={{ flex: '0 0 30%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={60} min={8} wrap={false}
              style={{ fontFamily: TD_FONT_SCRIPT, color: TD.track, fontWeight: 700 }}>
              ★ {role} ★
            </EditableText>
          </div>
          <div style={{ flex: '0 0 32%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={160} min={10} wrap={false}
              style={{ fontWeight: 800, color: TD.ink, letterSpacing: '0.02em' }}>
              {name}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 38%', minHeight: 0 }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={80} min={8}
              style={{ fontFamily: TD_FONT_SCRIPT, color: TD.grassDark }}>
              {quote}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — trophy-case gold frame
// ═══════════════════════════════════════════════════════════
export function TrackDayImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0 ? config.urls : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: `linear-gradient(145deg, ${TD.gold} 0%, #D4A817 50%, ${TD.gold} 100%)`,
        borderRadius: 10,
        padding: '4%',
        boxShadow: `0 14px 24px ${TD.shadow}, inset 0 0 0 3px ${TD.trackDark}`,
        border: `3px solid ${TD.ink}`,
      }}>
        {/* Trophy nameplate on top */}
        <div style={{
          position: 'absolute', top: '-8%', left: '50%', transform: 'translateX(-50%)',
          width: '50%', height: '14%',
          background: `linear-gradient(145deg, ${TD.gold}, #D4A817)`,
          border: `3px solid ${TD.ink}`,
          borderRadius: '8px 8px 2px 2px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 6px 10px ${TD.shadow}`,
          zIndex: 3,
        }}>
          <div style={{
            fontFamily: TD_FONT_DISPLAY, fontWeight: 800,
            color: TD.ink, fontSize: 'clamp(10px, 5cqh, 28px)',
            letterSpacing: '0.08em',
          }}>
            🏆 HALL OF FAME 🏆
          </div>
        </div>
        {/* Inner image frame */}
        <div style={{
          width: '100%', height: '100%',
          borderRadius: 4,
          border: `3px solid ${TD.ink}`,
          overflow: 'hidden',
          background: TD.ink,
        }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Gallery"
              className="transition-opacity duration-500"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${TD.grass} 0%, ${TD.grassDark} 100%)`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              fontFamily: TD_FONT_DISPLAY, color: TD.chalk,
              textAlign: 'center', padding: '6%',
            }}>
              <div style={{ fontSize: 'clamp(40px, 28cqh, 180px)', lineHeight: 1 }}>🏅</div>
              <div style={{ fontWeight: 700, fontSize: 'clamp(12px, 6cqh, 44px)', marginTop: '2cqh' }}>
                Team Photos
              </div>
              <div style={{ fontFamily: TD_FONT_SCRIPT, fontSize: 'clamp(10px, 4cqh, 28px)', color: TD.gold }}>
                drop in the builder
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — finish-line ribbon with checkered pattern
// ═══════════════════════════════════════════════════════════
export function TrackDayTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = ((config.messages as string[]) || [])
    .map((s) => (s || '').trim()).filter(Boolean).length
      ? ((config.messages as string[]) || []).map((s) => (s || '').trim()).filter(Boolean)
      : ['Go team! ⚡ Track Day Saturday at 10am'];
  const speed = (config.speed as string) || 'medium';
  const secs = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);
  const primary = messages[idx % messages.length];

  // checkered bands top/bottom
  const checkers = 48;

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
      {/* Top checkered band */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '22%',
        display: 'grid',
        gridTemplateColumns: `repeat(${checkers}, 1fr)`,
        gridTemplateRows: '1fr 1fr',
        borderBottom: `3px solid ${TD.ink}`,
      }}>
        {Array.from({ length: checkers * 2 }).map((_, i) => {
          const r = Math.floor(i / checkers);
          const c = i % checkers;
          const dark = (r + c) % 2 === 0;
          return <div key={i} style={{ background: dark ? TD.ink : TD.lane }} />;
        })}
      </div>
      {/* Bottom checkered band */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '22%',
        display: 'grid',
        gridTemplateColumns: `repeat(${checkers}, 1fr)`,
        gridTemplateRows: '1fr 1fr',
        borderTop: `3px solid ${TD.ink}`,
      }}>
        {Array.from({ length: checkers * 2 }).map((_, i) => {
          const r = Math.floor(i / checkers);
          const c = i % checkers;
          const dark = (r + c) % 2 === 0;
          return <div key={i} style={{ background: dark ? TD.ink : TD.lane }} />;
        })}
      </div>
      {/* Red ribbon center */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '22%', bottom: '22%',
        background: `linear-gradient(180deg, ${TD.track} 0%, ${TD.trackDark} 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 3%',
        fontFamily: TD_FONT_DISPLAY, fontWeight: 800,
        color: TD.lane,
        textShadow: `2px 2px 0 ${TD.ink}`,
        fontSize: compact ? '1.2em' : '1.7em',
        letterSpacing: '0.04em',
      }}>
        {primary}
      </div>
    </div>
  );
}
