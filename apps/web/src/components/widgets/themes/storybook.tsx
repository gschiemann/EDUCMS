"use client";

import { FitText } from './FitText';
import { EditableText } from './EditableText';

/**
 * Storybook — elementary school lobby "open picture book" theme.
 *
 * Every widget renders as a REAL page from a children's book, not a
 * rectangle:
 *   - LOGO             → illuminated gold crest medallion with stacked books + quill
 *   - TEXT / RICH_TEXT → opening-page header with a drop-cap initial + swash underline
 *   - CLOCK            → pocket watch (gold bezel, chain stem, live analog hands)
 *   - WEATHER          → parchment corner sketch with condition-aware ink illustration
 *   - COUNTDOWN        → library bookmark ribbon with dangling tails
 *   - ANNOUNCEMENT     → open-book page with ruled lines + fleur-de-lis, tilted
 *   - CALENDAR         → chapter headings on a parchment scroll strip
 *   - STAFF_SPOTLIGHT  → pop-up book polaroid rising from the page
 *   - IMAGE_CAROUSEL   → ornate oval frame (illustrated plate)
 *   - TICKER           → library banner strip with rope tassels
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
export const SB = {
  parchmentLight: '#FBF0DC',
  parchment:      '#F0E2C2',
  parchmentDark:  '#D9BD8C',
  ink:            '#2F241A',
  inkSoft:        '#7B5E3C',
  gold:           '#C28D2D',
  goldLight:      '#E8C87A',
  red:            '#B84A3A',
  blue:           '#3A5A9C',
  moss:           '#6B8E4E',
  rose:           '#D9A3A0',
  shadow:         'rgba(70,50,30,0.28)',
  white:          '#FFFDF6',
};

export const SB_FONT_DISPLAY = "'Fraunces', 'Merriweather', Georgia, serif";
export const SB_FONT_BODY    = "'Fredoka', ui-rounded, system-ui, sans-serif";
export const SB_FONT_SCRIPT  = "'Caveat', cursive";

const PAPER_SHADOW = `drop-shadow(0 8px 14px ${SB.shadow})`;

// ═══════════════════════════════════════════════════════════
// LOGO — illuminated gold crest medallion
// ═══════════════════════════════════════════════════════════
export function StorybookLogo({ config }: { config: any; compact?: boolean }) {
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'transparent', padding: '8%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 4px 8px ${SB.shadow})`, overflow: 'visible' }}>
        <defs>
          <radialGradient id="sb-gold" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor={SB.goldLight} />
            <stop offset="60%" stopColor={SB.gold} />
            <stop offset="100%" stopColor="#8C5F18" />
          </radialGradient>
          <radialGradient id="sb-parch" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor={SB.parchmentLight} />
            <stop offset="100%" stopColor={SB.parchment} />
          </radialGradient>
        </defs>
        {/* Outer scalloped gold crest — 16 bumps */}
        <g transform="translate(130 130)">
          {Array.from({ length: 16 }).map((_, i) => {
            const a = (i * 22.5) * Math.PI / 180;
            const x = Math.cos(a) * 112;
            const y = Math.sin(a) * 112;
            return <circle key={i} cx={x} cy={y} r="14" fill="url(#sb-gold)" stroke={SB.ink} strokeWidth="1.5" />;
          })}
        </g>
        {/* Gold medallion body */}
        <circle cx="130" cy="130" r="110" fill="url(#sb-gold)" stroke={SB.ink} strokeWidth="3.5" />
        {/* Inner filigree ring */}
        <circle cx="130" cy="130" r="96" fill="none" stroke={SB.ink} strokeWidth="1.8" opacity="0.55" strokeDasharray="2 3" />
        {/* Parchment center */}
        <circle cx="130" cy="130" r="82" fill="url(#sb-parch)" stroke={SB.ink} strokeWidth="3" />
        {/* Filigree corner flourishes at cardinal points */}
        {[0, 90, 180, 270].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 130 130)`}>
            <path d="M130 24 Q 124 32 130 40 Q 136 32 130 24 Z" fill={SB.ink} opacity="0.85" />
          </g>
        ))}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="60" y="60" width="140" height="140"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(78px at 130px 130px)" />
        ) : (
          <g>
            {/* Stacked books + quill emblem */}
            {/* bottom book — blue */}
            <rect x="74" y="160" width="112" height="22" rx="2" fill={SB.blue} stroke={SB.ink} strokeWidth="2.5" />
            <line x1="74" y1="167" x2="186" y2="167" stroke={SB.goldLight} strokeWidth="1.2" />
            {/* middle book — red */}
            <rect x="82" y="142" width="96" height="20" rx="2" fill={SB.red} stroke={SB.ink} strokeWidth="2.5" />
            <line x1="82" y1="149" x2="178" y2="149" stroke={SB.goldLight} strokeWidth="1.2" />
            {/* top book — moss */}
            <rect x="90" y="124" width="80" height="20" rx="2" fill={SB.moss} stroke={SB.ink} strokeWidth="2.5" />
            {/* quill pen */}
            <path d="M 102 122 L 162 78 Q 176 70 170 88 L 118 138 Z"
              fill={SB.white} stroke={SB.ink} strokeWidth="2" />
            <path d="M 110 130 L 158 86" stroke={SB.ink} strokeWidth="1" opacity="0.6" />
            <path d="M 114 134 L 162 90" stroke={SB.ink} strokeWidth="1" opacity="0.5" />
            {/* inkwell dot */}
            <circle cx="100" cy="128" r="4" fill={SB.ink} />
            {/* small star above */}
            <polygon points="130,90 134,100 145,100 136,106 140,117 130,111 120,117 124,106 115,100 126,100"
              fill={SB.gold} stroke={SB.ink} strokeWidth="1.2" />
          </g>
        )}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — opening page header with drop-cap + swash
// ═══════════════════════════════════════════════════════════
export function StorybookText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content = (config.content || 'Once Upon a School Day').toString();
  const subtitle = config.subtitle || 'welcome, little readers';
  // Extract the first letter for a drop cap; keep the rest as the title body.
  const firstChar = content.trim().charAt(0) || 'W';
  const rest = content.trim().slice(1);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3% 3%', containerType: 'size' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Title row — drop cap + serif rest */}
        <div style={{
          flex: !compact && subtitle ? '1 1 68%' : '1 1 100%',
          minHeight: 0,
          display: 'flex', alignItems: 'center', gap: '3%',
        }}>
          {/* Illuminated drop-cap box */}
          <div style={{
            flexShrink: 0,
            height: '92%',
            aspectRatio: '1 / 1',
            background: `radial-gradient(circle at 32% 28%, ${SB.goldLight}, ${SB.gold} 65%, #8C5F18)`,
            border: `3px solid ${SB.ink}`,
            borderRadius: 8,
            boxShadow: `0 6px 12px ${SB.shadow}, inset 0 0 12px rgba(0,0,0,0.18)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            {/* corner filigree dots */}
            <div style={{ position: 'absolute', top: '6%', left: '6%', width: '8%', height: '8%', background: SB.ink, borderRadius: '50%' }} />
            <div style={{ position: 'absolute', top: '6%', right: '6%', width: '8%', height: '8%', background: SB.ink, borderRadius: '50%' }} />
            <div style={{ position: 'absolute', bottom: '6%', left: '6%', width: '8%', height: '8%', background: SB.ink, borderRadius: '50%' }} />
            <div style={{ position: 'absolute', bottom: '6%', right: '6%', width: '8%', height: '8%', background: SB.ink, borderRadius: '50%' }} />
            <div style={{ width: '72%', height: '78%' }}>
              <FitText max={320} min={12} wrap={false}
                style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 900, color: SB.ink, lineHeight: 1 }}>
                {firstChar.toUpperCase()}
              </FitText>
            </div>
          </div>
          {/* Title rest — serif */}
          <div style={{ flex: 1, minWidth: 0, height: '88%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ flex: '1 1 auto', minHeight: 0 }}>
              <FitText max={260} min={12} wrap={true} center={false}
                style={{
                  fontFamily: SB_FONT_DISPLAY, fontWeight: 700,
                  color: SB.ink, letterSpacing: '-0.005em',
                }}>
                {rest}
              </FitText>
            </div>
            {/* Hand-drawn underline swash */}
            <svg viewBox="0 0 600 30" width="100%" height="12%" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <path d="M 10 18 Q 150 2 300 18 T 590 14" stroke={SB.gold} strokeWidth="4" fill="none"
                strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <circle cx="10" cy="18" r="3" fill={SB.gold} />
              <circle cx="590" cy="14" r="3" fill={SB.gold} />
            </svg>
          </div>
        </div>
        {!compact && subtitle && (
          <div style={{ flex: '0 0 30%', minHeight: 0, marginTop: '1.5%' }}>
            <EditableText configKey="subtitle" onConfigChange={onConfigChange}
              max={140} min={10} wrap={false}
              style={{ fontFamily: SB_FONT_SCRIPT, color: SB.inkSoft }}>
              {subtitle}
            </EditableText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — pocket watch with live analog hands
// ═══════════════════════════════════════════════════════════
export function StorybookClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  const time = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
  const h24 = parseInt(fmt({ hour: 'numeric', hour12: false }), 10);
  const m = parseInt(fmt({ minute: 'numeric' }), 10);
  const s = parseInt(fmt({ second: 'numeric' }), 10);
  const hourDeg = ((h24 % 12) + m / 60) * 30;
  const minDeg  = (m + s / 60) * 6;
  const secDeg  = s * 6;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 520 620" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs>
            <radialGradient id="sb-bezel" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor={SB.goldLight} />
              <stop offset="55%" stopColor={SB.gold} />
              <stop offset="100%" stopColor="#8C5F18" />
            </radialGradient>
            <radialGradient id="sb-face" cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor={SB.parchmentLight} />
              <stop offset="100%" stopColor={SB.parchment} />
            </radialGradient>
          </defs>
          {/* Chain + stem at top */}
          <circle cx="260" cy="22" r="12" fill="none" stroke={SB.gold} strokeWidth="5" />
          <circle cx="260" cy="22" r="12" fill="none" stroke={SB.ink} strokeWidth="1.5" />
          <rect x="248" y="34" width="24" height="18" rx="4" fill="url(#sb-bezel)" stroke={SB.ink} strokeWidth="2" />
          {/* bezel outer ring */}
          <circle cx="260" cy="310" r="250" fill="url(#sb-bezel)" stroke={SB.ink} strokeWidth="4" />
          {/* decorative notches on bezel */}
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i * 15) * Math.PI / 180;
            const x1 = 260 + Math.cos(a) * 238;
            const y1 = 310 + Math.sin(a) * 238;
            const x2 = 260 + Math.cos(a) * 250;
            const y2 = 310 + Math.sin(a) * 250;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SB.ink} strokeWidth="1.5" opacity="0.55" />;
          })}
          {/* inner thin bezel ring */}
          <circle cx="260" cy="310" r="220" fill="url(#sb-face)" stroke={SB.ink} strokeWidth="2.5" />
          <circle cx="260" cy="310" r="220" fill="none" stroke={SB.gold} strokeWidth="3" opacity="0.6" />
          {/* Roman-numeral-style ticks (majors at 12/3/6/9) */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            const r1 = 204;
            const r2 = i % 3 === 0 ? 178 : 192;
            return <line key={i}
              x1={260 + Math.cos(a) * r1} y1={310 + Math.sin(a) * r1}
              x2={260 + Math.cos(a) * r2} y2={310 + Math.sin(a) * r2}
              stroke={SB.ink} strokeWidth={i % 3 === 0 ? 5 : 2.5} strokeLinecap="round" />;
          })}
          {/* decorative center rosette behind hands */}
          <circle cx="260" cy="310" r="22" fill={SB.goldLight} stroke={SB.ink} strokeWidth="1.5" opacity="0.6" />
          {/* Hour hand */}
          <line x1="260" y1="310" x2="260" y2="210"
            stroke={SB.ink} strokeWidth="9" strokeLinecap="round"
            transform={`rotate(${hourDeg} 260 310)`} />
          {/* Minute hand */}
          <line x1="260" y1="310" x2="260" y2="170"
            stroke={SB.ink} strokeWidth="5.5" strokeLinecap="round"
            transform={`rotate(${minDeg} 260 310)`} />
          {/* Second hand — ornate red */}
          <g transform={`rotate(${secDeg} 260 310)`}>
            <line x1="260" y1="328" x2="260" y2="150"
              stroke={SB.red} strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="260" cy="310" r="7" fill={SB.red} stroke={SB.ink} strokeWidth="1.8" />
          </g>
          <circle cx="260" cy="310" r="3" fill={SB.ink} />
        </svg>
        {/* Digital ribbon under the pivot, inside the face */}
        <div style={{
          position: 'absolute',
          inset: '68% 22% 16% 22%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: SB_FONT_DISPLAY,
          pointerEvents: 'none',
        }}>
          <FitText max={100} min={10} wrap={false}
            style={{ fontWeight: 700, color: SB.inkSoft, letterSpacing: '0.02em', fontStyle: 'italic' }}>
            {compact ? time : time}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — parchment corner sketch with condition-aware ink illustration
// ═══════════════════════════════════════════════════════════
export function StorybookWeather({ config, compact }: { config: any; compact?: boolean }) {
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

  // Ink + watercolor wash illustrations — centered around (350, 180)
  const CLOUD = "M-120 30 Q-160 30 -160 0 Q-160 -40 -120 -40 Q-105 -80 -55 -80 Q0 -110 55 -80 Q110 -85 130 -30 Q170 -30 170 10 Q170 50 130 50 L-110 50 Q-120 50 -120 30 Z";
  const InkSun = (
    <g transform="translate(350 180)">
      <g stroke={SB.gold} strokeWidth="9" strokeLinecap="round" opacity="0.95">
        <line x1="0" y1="-130" x2="0" y2="-95" />
        <line x1="92" y1="-92" x2="67" y2="-67" />
        <line x1="130" y1="0" x2="95" y2="0" />
        <line x1="92" y1="92" x2="67" y2="67" />
        <line x1="0" y1="130" x2="0" y2="95" />
        <line x1="-92" y1="92" x2="-67" y2="67" />
        <line x1="-130" y1="0" x2="-95" y2="0" />
        <line x1="-92" y1="-92" x2="-67" y2="-67" />
      </g>
      <circle cx="0" cy="0" r="68" fill={SB.goldLight} stroke={SB.ink} strokeWidth="4" />
      <circle cx="0" cy="0" r="68" fill="none" stroke={SB.gold} strokeWidth="2" opacity="0.7" />
      <circle cx="-20" cy="-6" r="5" fill={SB.ink} />
      <circle cx="20" cy="-6" r="5" fill={SB.ink} />
      <path d="M -20 18 Q 0 32 20 18" stroke={SB.ink} strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
  const InkCloud = (fill: string) => (
    <g transform="translate(350 180)">
      <path d={CLOUD} fill={fill} stroke={SB.ink} strokeWidth="4" />
      {/* watercolor wash outline echo */}
      <path d={CLOUD} fill="none" stroke={SB.inkSoft} strokeWidth="1.2" opacity="0.5" transform="translate(6 6)" />
    </g>
  );
  const SmallSunPeek = (
    <g transform="translate(470 80)">
      <g stroke={SB.gold} strokeWidth="6" strokeLinecap="round">
        <line x1="0" y1="-55" x2="0" y2="-38" />
        <line x1="40" y1="-40" x2="28" y2="-28" />
        <line x1="55" y1="0" x2="38" y2="0" />
        <line x1="-40" y1="-40" x2="-28" y2="-28" />
      </g>
      <circle cx="0" cy="0" r="30" fill={SB.goldLight} stroke={SB.ink} strokeWidth="3" />
    </g>
  );
  const RainDrops = (
    <g fill={SB.blue} stroke={SB.ink} strokeWidth="1.5">
      {[[-70, 260], [-20, 290], [30, 260], [80, 290], [-100, 290]].map(([x, y], i) => (
        <path key={i} d={`M ${350 + x} ${y} C ${343 + x} ${y + 18}, ${357 + x} ${y + 18}, ${350 + x} ${y}`} />
      ))}
    </g>
  );
  const SnowFlakes = (
    <g stroke={SB.blue} strokeWidth="3.5" strokeLinecap="round">
      {[[-70, 260], [0, 290], [70, 260], [-35, 310], [35, 310]].map(([x, y], i) => (
        <g key={i} transform={`translate(${350 + x} ${y})`}>
          <line x1="-10" y1="0" x2="10" y2="0" />
          <line x1="0" y1="-10" x2="0" y2="10" />
          <line x1="-7" y1="-7" x2="7" y2="7" />
          <line x1="-7" y1="7" x2="7" y2="-7" />
        </g>
      ))}
    </g>
  );
  const Bolt = (
    <path d="M340 230 L390 230 L360 290 L405 290 L310 380 L345 300 L315 300 Z"
      fill={SB.gold} stroke={SB.ink} strokeWidth="4" strokeLinejoin="round" />
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 500" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0 }}>
          {/* Parchment page with torn top edge */}
          <defs>
            <linearGradient id="sb-wx-wash" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SB.parchmentLight} />
              <stop offset="100%" stopColor={SB.parchment} />
            </linearGradient>
          </defs>
          <path d="M 0 40
            L 40 26 L 90 40 L 140 26 L 200 40 L 260 26 L 320 40 L 380 26 L 440 40 L 500 26 L 560 40 L 620 26 L 660 40 L 700 30
            L 700 500 L 0 500 Z"
            fill="url(#sb-wx-wash)" stroke={SB.ink} strokeWidth="3" strokeLinejoin="round"
            vectorEffect="non-scaling-stroke" />
          {/* page corner fold shadow */}
          <path d="M 660 40 L 700 30 L 700 90 Z" fill={SB.parchmentDark} opacity="0.4" />
        </svg>
        <svg viewBox="0 0 700 500" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {isClear && InkSun}
          {isPartly && (<>{InkCloud(SB.white)}{SmallSunPeek}</>)}
          {isOvercast && (<>{InkCloud('#D8DDE8')}</>)}
          {isRain && (<>{InkCloud(SB.white)}{RainDrops}</>)}
          {isSnow && (<>{InkCloud('#EAEFF5')}{SnowFlakes}</>)}
          {isStorm && (<>{InkCloud('#BFC5CE')}{Bolt}</>)}
        </svg>
        {/* Temp + label on the lower half of the page */}
        <div style={{
          position: 'absolute',
          top: '56%', left: '6%', right: '6%', bottom: '6%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SB_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 68%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={300} min={12} wrap={false}
              style={{ fontWeight: 800, color: SB.ink, letterSpacing: '-0.02em' }}>
              {temp}°
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 32%', minHeight: 0 }}>
              <FitText max={110} min={9} wrap={false}
                style={{ fontFamily: SB_FONT_SCRIPT, color: SB.red }}>
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
// COUNTDOWN — library bookmark ribbon
// ═══════════════════════════════════════════════════════════
export function StorybookCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 12 * 86400000);
  const label = (config.label || resolved?.prefix || 'Next Chapter').toUpperCase();
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const bigNum = days > 0 ? days : hours;
  const unit = days > 0 ? (days === 1 ? 'DAY!' : 'DAYS!') : (hours === 1 ? 'HR!' : 'HRS!');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 500 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs>
            <linearGradient id="sb-ribbon" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#8A2F22" />
              <stop offset="50%" stopColor={SB.red} />
              <stop offset="100%" stopColor="#8A2F22" />
            </linearGradient>
          </defs>
          {/* Bookmark ribbon body */}
          <path d="M 120 20 L 380 20 L 380 540 L 250 470 L 120 540 Z"
            fill="url(#sb-ribbon)" stroke={SB.ink} strokeWidth="5" strokeLinejoin="round" />
          {/* Inner gold border stripe */}
          <path d="M 135 36 L 365 36 L 365 510"
            fill="none" stroke={SB.gold} strokeWidth="3" strokeLinejoin="round" opacity="0.85" />
          <path d="M 135 36 L 135 510"
            fill="none" stroke={SB.gold} strokeWidth="3" opacity="0.85" />
          {/* Top tab decoration */}
          <rect x="180" y="20" width="140" height="14" fill={SB.gold} stroke={SB.ink} strokeWidth="2" />
          {/* Ribbon tails dangling below */}
          <polygon points="170,540 150,680 210,620 220,520" fill={SB.red} stroke={SB.ink} strokeWidth="3" />
          <polygon points="330,540 350,680 290,620 280,520" fill="#8A2F22" stroke={SB.ink} strokeWidth="3" />
          {/* small stars */}
          <polygon points="160,100 164,110 174,110 166,116 170,126 160,120 150,126 154,116 146,110 156,110"
            fill={SB.gold} opacity="0.8" />
          <polygon points="340,100 344,110 354,110 346,116 350,126 340,120 330,126 334,116 326,110 336,110"
            fill={SB.gold} opacity="0.8" />
        </svg>
        {/* Text */}
        <div style={{
          position: 'absolute',
          inset: '10% 26% 32% 26%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SB_FONT_DISPLAY, color: SB.parchmentLight,
          textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 20%', minHeight: 0 }}>
            <EditableText configKey="label" onConfigChange={onConfigChange}
              max={70} min={8} wrap={false}
              style={{ fontWeight: 700, color: SB.goldLight, letterSpacing: '0.06em' }}>
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 56%', minHeight: 0 }}>
            <FitText max={320} min={24} wrap={false}
              style={{ fontWeight: 900, color: SB.parchmentLight,
                textShadow: `2px 2px 0 ${SB.ink}` }}>
              {bigNum}
            </FitText>
          </div>
          <div style={{ flex: '0 0 24%', minHeight: 0 }}>
            <FitText max={80} min={8} wrap={false}
              style={{ fontFamily: SB_FONT_SCRIPT, color: SB.goldLight }}>
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — open book page with ruled lines + fleur-de-lis
// ═══════════════════════════════════════════════════════════
export function StorybookAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const message = config.message || config.body || 'The Book Fair opens today — bring your reading list, friends!';
  const date = config.date || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 1800 500" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: PAPER_SHADOW, position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs>
            <linearGradient id="sb-page" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SB.parchmentLight} />
              <stop offset="100%" stopColor={SB.parchment} />
            </linearGradient>
          </defs>
          <g transform="rotate(-1 900 250)">
            {/* Open book page */}
            <rect x="40" y="30" width="1720" height="440" rx="4" fill="url(#sb-page)"
              stroke={SB.ink} strokeWidth="4" vectorEffect="non-scaling-stroke" />
            {/* Center spine gutter */}
            <line x1="900" y1="30" x2="900" y2="470" stroke={SB.inkSoft} strokeWidth="2"
              opacity="0.55" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
            {/* Ruled lines (left + right pages) */}
            {Array.from({ length: 5 }).map((_, i) => (
              <g key={i}>
                <line x1="100" y1={120 + i * 70} x2="860" y2={120 + i * 70}
                  stroke={SB.inkSoft} strokeWidth="1" opacity="0.3" vectorEffect="non-scaling-stroke" />
                <line x1="940" y1={120 + i * 70} x2="1700" y2={120 + i * 70}
                  stroke={SB.inkSoft} strokeWidth="1" opacity="0.3" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {/* Corner flourishes — gold */}
            <path d="M 60 60 Q 90 50 110 60 Q 90 70 60 60" fill={SB.gold} opacity="0.7" />
            <path d="M 1740 60 Q 1710 50 1690 60 Q 1710 70 1740 60" fill={SB.gold} opacity="0.7" />
            <path d="M 60 440 Q 90 430 110 440 Q 90 450 60 440" fill={SB.gold} opacity="0.7" />
            <path d="M 1740 440 Q 1710 430 1690 440 Q 1710 450 1740 440" fill={SB.gold} opacity="0.7" />
          </g>
        </svg>
        {/* Text overlay — rotates with the page */}
        <div style={{
          position: 'absolute',
          top: '10%', left: '5%', right: '5%', bottom: '10%',
          display: 'flex', flexDirection: 'column',
          fontFamily: SB_FONT_DISPLAY,
          transform: 'rotate(-1deg)',
          transformOrigin: 'center center',
        }}>
          {/* Fleur-de-lis separator at start */}
          <div style={{ flex: '0 0 12%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 80 40" width="auto" height="100%" preserveAspectRatio="xMidYMid meet">
              <g stroke={SB.gold} strokeWidth="1.5" fill={SB.gold}>
                <path d="M 40 4 Q 36 14 30 18 Q 26 22 30 26 Q 36 28 40 34 Q 44 28 50 26 Q 54 22 50 18 Q 44 14 40 4 Z" />
                <line x1="6" y1="20" x2="28" y2="20" stroke={SB.gold} strokeWidth="1.2" />
                <line x1="52" y1="20" x2="74" y2="20" stroke={SB.gold} strokeWidth="1.2" />
                <circle cx="4" cy="20" r="2" fill={SB.gold} />
                <circle cx="76" cy="20" r="2" fill={SB.gold} />
              </g>
            </svg>
          </div>
          <div style={{ flex: !compact && date ? '1 1 70%' : '1 1 100%', minHeight: 0 }}>
            <EditableText configKey="message" onConfigChange={onConfigChange}
              max={260} min={12}
              style={{ fontWeight: 600, color: SB.ink, letterSpacing: '0.005em', fontStyle: 'italic' }}>
              {message}
            </EditableText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 18%', minHeight: 0 }}>
              <EditableText configKey="date" onConfigChange={onConfigChange} max={120} min={10} wrap={false}
                style={{ fontFamily: SB_FONT_SCRIPT, color: SB.red }}>{date}</EditableText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — chapter headings on parchment scroll strips
// ═══════════════════════════════════════════════════════════
export function StorybookCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'MON · 8:30am', title: 'Pajama Day Reading Hour' },
    { date: 'WED · 10am',   title: "Principal's Story Time" },
    { date: 'APR 30',       title: 'Field Trip — The Zoo!' },
  ]).slice(0, Math.max(1, Math.min(12, config.maxEvents ?? 3)));

  const romans = ['I', 'II', 'III', 'IV'];
  const accents = [SB.red, SB.blue, SB.moss, SB.gold];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4%', gap: '3%' }}>
      {events.map((e: any, i: number) => {
        const accent = accents[i % accents.length];
        return (
          <div key={i} style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            background: `linear-gradient(180deg, ${SB.parchmentLight}, ${SB.parchment})`,
            border: `2px solid ${SB.ink}`,
            borderTop: `4px double ${accent}`,
            borderBottom: `4px double ${accent}`,
            boxShadow: `0 6px 12px ${SB.shadow}`,
            display: 'flex',
            alignItems: 'center',
            gap: '2%',
            padding: '0 3% 0 2%',
            overflow: 'hidden',
          }}>
            {/* Roman-numeral chapter badge */}
            <div style={{
              flexShrink: 0,
              height: '78%',
              aspectRatio: '1 / 1',
              background: `radial-gradient(circle at 32% 28%, ${SB.goldLight}, ${SB.gold} 70%, #8C5F18)`,
              border: `2.5px solid ${SB.ink}`,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `inset 0 0 8px rgba(0,0,0,0.2)`,
            }}>
              <div style={{ width: '70%', height: '64%' }}>
                <FitText max={180} min={8} wrap={false}
                  style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 900, color: SB.ink }}>
                  {romans[i] || (i + 1).toString()}
                </FitText>
              </div>
            </div>
            {/* "Chapter N" label + event title stacked */}
            <div style={{
              flex: 1,
              minWidth: 0,
              height: '92%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              fontFamily: SB_FONT_DISPLAY,
            }}>
              <div style={{ flex: '0 0 36%', minHeight: 0 }}>
                <FitText max={160} min={8} wrap={false} center={false}
                  style={{ fontFamily: SB_FONT_SCRIPT, color: accent, fontWeight: 600 }}>
                  Chapter {romans[i] || i + 1} · {e.date}
                </FitText>
              </div>
              <div style={{ flex: '1 1 64%', minHeight: 0 }}>
                <FitText max={280} min={10} wrap={false} center={false}
                  style={{ fontWeight: 700, color: SB.ink, fontStyle: 'italic' }}>
                  {e.title}
                </FitText>
              </div>
            </div>
            {/* Small decorative star at right */}
            <div style={{ flexShrink: 0, width: '4%', height: '60%', display: 'flex', alignItems: 'center' }}>
              <svg viewBox="0 0 30 30" width="100%" height="60%" preserveAspectRatio="xMidYMid meet">
                <polygon points="15,2 18,12 28,12 20,18 23,28 15,22 7,28 10,18 2,12 12,12"
                  fill={accent} stroke={SB.ink} strokeWidth="1" opacity="0.8" />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — pop-up book card rising from the page
// ═══════════════════════════════════════════════════════════
export function StorybookStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || config.name || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center"
      style={{ padding: '5%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
      }}>
        {/* Book page base (behind the pop-up) */}
        <div style={{
          position: 'absolute',
          inset: '58% 4% 2% 4%',
          background: `linear-gradient(180deg, ${SB.parchment}, ${SB.parchmentDark})`,
          border: `2px solid ${SB.ink}`,
          borderRadius: 3,
          boxShadow: `0 4px 8px ${SB.shadow}`,
        }}>
          {/* center spine */}
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 0,
            borderLeft: `2px dashed ${SB.inkSoft}`, opacity: 0.5 }} />
        </div>
        {/* Pop-up shadow (the "rise" illusion) */}
        <div style={{
          position: 'absolute',
          left: '12%', right: '12%',
          top: '56%', height: '6%',
          background: `radial-gradient(ellipse at center, ${SB.shadow} 0%, transparent 70%)`,
          filter: 'blur(2px)',
        }} />
        {/* Polaroid card */}
        <div style={{
          position: 'absolute',
          left: '8%', right: '8%', top: '2%', bottom: '38%',
          background: SB.white,
          border: `3px solid ${SB.ink}`,
          boxShadow: `0 16px 28px ${SB.shadow}, 0 3px 0 ${SB.goldLight}`,
          transform: 'rotate(-2deg)',
          padding: '3%',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Photo area */}
          <div style={{
            flex: '1 1 78%', minHeight: 0,
            background: SB.parchment,
            border: `2px solid ${SB.ink}`,
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {photoUrl ? (
              <img src={resolveUrl(photoUrl)} alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg viewBox="0 0 200 200" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
                <rect width="200" height="200" fill={SB.parchment} />
                {/* soft storybook teacher */}
                <path d="M24 200 Q24 140 100 140 Q176 140 176 200 Z" fill={SB.blue} stroke={SB.ink} strokeWidth="3" />
                <rect x="88" y="120" width="24" height="22" fill="#F2CBA0" stroke={SB.ink} strokeWidth="2" />
                <ellipse cx="100" cy="92" rx="44" ry="48" fill="#F2CBA0" stroke={SB.ink} strokeWidth="3" />
                <path d="M56 86 Q56 44 100 44 Q144 44 144 86 Q132 68 116 66 Q100 70 84 66 Q68 68 56 86 Z"
                  fill={SB.gold} stroke={SB.ink} strokeWidth="2.5" />
                <circle cx="85" cy="92" r="2.5" fill={SB.ink} />
                <circle cx="115" cy="92" r="2.5" fill={SB.ink} />
                <ellipse cx="76" cy="108" rx="6" ry="3" fill={SB.rose} opacity="0.7" />
                <ellipse cx="124" cy="108" rx="6" ry="3" fill={SB.rose} opacity="0.7" />
                <path d="M86 118 Q100 128 114 118" stroke={SB.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
              </svg>
            )}
          </div>
          {/* Caveat name + role */}
          <div style={{
            flex: '0 0 22%', minHeight: 0,
            marginTop: '2%',
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center',
          }}>
            <div style={{ flex: '1 1 60%', minHeight: 0 }}>
              <EditableText configKey="staffName" onConfigChange={onConfigChange}
                max={180} min={10} wrap={false}
                style={{ fontFamily: SB_FONT_SCRIPT, color: SB.ink, fontWeight: 700 }}>
                {name}
              </EditableText>
            </div>
            <div style={{ flex: '0 0 40%', minHeight: 0 }}>
              <EditableText configKey="role" onConfigChange={onConfigChange}
                max={90} min={8} wrap={false}
                style={{ fontFamily: SB_FONT_SCRIPT, color: SB.red }}>
                {role}
              </EditableText>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — ornate oval illustrated plate frame
// ═══════════════════════════════════════════════════════════
export function StorybookImageCarousel({ config }: { config: any; compact?: boolean }) {
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
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Parchment plate backing */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at center, ${SB.parchmentLight}, ${SB.parchment} 70%, ${SB.parchmentDark})`,
          border: `4px solid ${SB.ink}`,
          borderRadius: '50% / 50%',
          boxShadow: `0 14px 26px ${SB.shadow}, inset 0 0 24px rgba(194, 141, 45, 0.3)`,
          overflow: 'hidden',
        }}>
          {/* Inner ornate gold frame */}
          <div style={{
            position: 'absolute',
            inset: '6%',
            border: `4px solid ${SB.gold}`,
            borderRadius: '50% / 50%',
            boxShadow: `inset 0 0 12px ${SB.gold}`,
            overflow: 'hidden',
          }}>
            {/* Inner thin ink line */}
            <div style={{
              position: 'absolute',
              inset: '3%',
              border: `1.5px solid ${SB.ink}`,
              borderRadius: '50% / 50%',
              overflow: 'hidden',
            }}>
              {hasImage ? (
                <img src={resolveUrl(urls[idx])} alt="Gallery"
                  className="transition-opacity duration-500"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  background: `linear-gradient(180deg, ${SB.parchmentLight}, ${SB.parchment})`,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: SB_FONT_SCRIPT, color: SB.ink,
                  textAlign: 'center', padding: '6%', gap: '3%',
                }}>
                  {/* quill + inkwell cartoon */}
                  <svg viewBox="0 0 160 120" width="44%" height="44%" preserveAspectRatio="xMidYMid meet">
                    {/* inkwell */}
                    <ellipse cx="42" cy="100" rx="28" ry="8" fill={SB.shadow} />
                    <path d="M 20 70 L 64 70 L 60 104 Q 60 110 42 110 Q 24 110 24 104 Z"
                      fill={SB.ink} stroke={SB.ink} strokeWidth="2" />
                    <ellipse cx="42" cy="70" rx="22" ry="6" fill={SB.blue} stroke={SB.ink} strokeWidth="2" />
                    {/* quill */}
                    <path d="M 50 70 L 140 10 Q 154 6 148 22 L 66 98 Z"
                      fill={SB.white} stroke={SB.ink} strokeWidth="2" />
                    <path d="M 58 80 L 142 18" stroke={SB.ink} strokeWidth="1" opacity="0.5" />
                    <path d="M 66 86 L 148 24" stroke={SB.ink} strokeWidth="1" opacity="0.4" />
                    <circle cx="48" cy="76" r="3.5" fill={SB.ink} />
                  </svg>
                  <div style={{ width: '80%' }}>
                    <FitText max={80} min={8} wrap={false}
                      style={{ fontFamily: SB_FONT_SCRIPT, color: SB.inkSoft, fontWeight: 600 }}>
                      Add story pictures
                    </FitText>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Corner decorative rosettes on the outer plate (non-occluding) */}
        {[[8, 50], [92, 50], [50, 8], [50, 92]].map(([x, y], i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${x}%`, top: `${y}%`,
            width: '6%', aspectRatio: '1 / 1',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle at 32% 28%, ${SB.goldLight}, ${SB.gold} 70%, #8C5F18)`,
            border: `2px solid ${SB.ink}`,
            borderRadius: '50%',
            boxShadow: `0 2px 4px ${SB.shadow}`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — library banner strip with rope tassels
// ═══════════════════════════════════════════════════════════
export function StorybookTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = ((config.messages as string[]) || []).map((s) => (s || '').trim()).filter(Boolean).length ? ((config.messages as string[]) || []).map((s) => (s || '').trim()).filter(Boolean) : ['~ Library open until 4pm today ~'];
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
        <defs>
          <linearGradient id="sb-banner" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SB.parchmentLight} />
            <stop offset="100%" stopColor={SB.parchment} />
          </linearGradient>
        </defs>
        {/* Banner body with swallow-tail ends */}
        <path d="M 80 40 L 1920 40
          L 1990 110 L 1920 180 L 80 180 L 10 110 Z"
          fill="url(#sb-banner)" stroke={SB.ink} strokeWidth="4"
          vectorEffect="non-scaling-stroke" />
        {/* Double gold border stripe inside */}
        <path d="M 100 60 L 1900 60" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <path d="M 100 160 L 1900 160" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Rope tassels on both ends */}
      <svg viewBox="0 0 2000 220" width="100%" height="100%" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
        {/* left rope */}
        <path d="M 10 110 Q -20 130 -30 170 Q -38 200 -20 210"
          stroke={SB.gold} strokeWidth="5" fill="none" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />
        <circle cx="-20" cy="210" r="10" fill={SB.gold} stroke={SB.ink} strokeWidth="2" />
        <line x1="-28" y1="218" x2="-24" y2="240" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <line x1="-20" y1="220" x2="-18" y2="242" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <line x1="-12" y1="218" x2="-10" y2="240" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {/* right rope */}
        <path d="M 1990 110 Q 2020 130 2030 170 Q 2038 200 2020 210"
          stroke={SB.gold} strokeWidth="5" fill="none" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />
        <circle cx="2020" cy="210" r="10" fill={SB.gold} stroke={SB.ink} strokeWidth="2" />
        <line x1="2012" y1="218" x2="2016" y2="240" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <line x1="2020" y1="220" x2="2022" y2="242" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <line x1="2028" y1="218" x2="2030" y2="240" stroke={SB.gold} strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Message overlay */}
      <div style={{
        position: 'absolute',
        inset: '18% 8% 18% 8%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: SB_FONT_DISPLAY,
      }}>
        <FitText max={compact ? 80 : 150} min={10} wrap={false}
          style={{ fontWeight: 700, color: SB.ink, letterSpacing: '0.01em', fontStyle: 'italic' }}>
          {primary}
        </FitText>
      </div>
    </div>
  );
}
