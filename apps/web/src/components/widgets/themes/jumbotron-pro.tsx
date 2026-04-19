"use client";

/**
 * Jumbotron Pro — Friday-night-lights stadium scoreboard theme.
 *
 * The canvas IS a giant LED jumbotron screen. Every widget renders as a
 * chrome-and-amber panel on the stadium video wall:
 *   - LOGO              → chrome stadium ID bug with mascot + school initials
 *   - TEXT              → massive split HOME/AWAY scorebug with LED numerals
 *   - CLOCK             → dark LED game-clock display with live analog overlay
 *   - WEATHER           → compact LED weather chip (6 condition buckets)
 *   - COUNTDOWN         → flip-card countdown "NEXT GAME IN N DAYS"
 *   - ANNOUNCEMENT      → pinned "COACH'S MESSAGE" dark panel with red strip
 *   - CALENDAR          → vertical SEASON STANDINGS rail with W-L rows
 *   - STAFF_SPOTLIGHT   → vertical PLAYER STATS rail with portrait + stats
 *   - IMAGE_CAROUSEL    → stadium-crowd photo frame with chrome scanline bezel
 *   - TICKER            → full-width LED dot-matrix scrolling score strip
 *
 * Layout: everything orbits a center scorebug. Perimeter widgets FRAME
 * the jumbotron rather than compete with it. See system-presets.ts
 * preset-lobby-jumbotron-pro.
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
export const JP = {
  stadiumBlack:   '#050A14',
  stadiumDark:    '#0B1020',
  ledAmber:       '#FFB020',
  ledAmberBright: '#FFC94D',
  chrome:         '#D1D5DB',
  chromeDark:     '#6B7280',
  home:           '#1E3A8A',
  away:           '#B91C1C',
  gold:           '#F59E0B',
  accent:         '#EF2929',
  ink:            '#030712',
  inkSoft:        '#374151',
  white:          '#FFFFFF',
  scanline:       'rgba(255,255,255,0.04)',
};

export const JP_FONT_DISPLAY = "'Bungee', 'Oswald', system-ui, sans-serif";
export const JP_FONT_BODY = "'Inter', system-ui, sans-serif";
export const JP_FONT_MONO = "'JetBrains Mono', 'Courier New', monospace";

// Reusable LED scanline overlay. Horizontal dark lines @ ~3px spacing
// read convincingly as a stadium video board from any distance.
const LED_SCANLINES = `repeating-linear-gradient(0deg, ${JP.scanline} 0 1px, transparent 1px 3px)`;
const LED_DOT_MATRIX = `radial-gradient(circle at 1px 1px, rgba(255,176,32,0.22) 0.8px, transparent 1.2px)`;

// Shared chrome bezel helper — reused by Logo, Countdown, ImageCarousel.
function chromeBezel(radius = 12): React.CSSProperties {
  return {
    background: `linear-gradient(180deg, ${JP.chrome} 0%, ${JP.chromeDark} 50%, ${JP.chrome} 100%)`,
    borderRadius: radius,
    boxShadow:
      `inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -2px 0 rgba(0,0,0,0.45), 0 10px 22px rgba(0,0,0,0.55)`,
  };
}

// ═══════════════════════════════════════════════════════════
// LOGO — chrome stadium ID bug with mascot silhouette + initials
// ═══════════════════════════════════════════════════════════
export function JumbotronProLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'Eagles').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'EA');
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.55))', overflow: 'visible' }}>
        <defs>
          <linearGradient id="jp-chrome-bug" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={JP.chrome} />
            <stop offset="50%" stopColor={JP.chromeDark} />
            <stop offset="100%" stopColor={JP.chrome} />
          </linearGradient>
          <radialGradient id="jp-amber-glow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={JP.ledAmberBright} />
            <stop offset="70%" stopColor={JP.ledAmber} />
            <stop offset="100%" stopColor={JP.gold} />
          </radialGradient>
        </defs>
        {/* Chrome outer shield */}
        <path d="M130 10 L235 50 L225 170 Q215 220 130 250 Q45 220 35 170 L25 50 Z"
          fill="url(#jp-chrome-bug)" stroke={JP.ink} strokeWidth="4" />
        {/* Amber inner shield */}
        <path d="M130 28 L215 60 L208 168 Q200 208 130 232 Q60 208 52 168 L45 60 Z"
          fill="url(#jp-amber-glow)" stroke={JP.ink} strokeWidth="3" />
        {/* Mascot silhouette — stylized eagle wings + head */}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="55" y="45" width="150" height="150"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(65px at 130px 120px)" />
        ) : (
          <g fill={JP.ink}>
            {/* Eagle wings sweeping outward */}
            <path d="M130 80 Q75 95 55 145 Q85 130 130 140 Q175 130 205 145 Q185 95 130 80 Z" />
            {/* Head */}
            <circle cx="130" cy="78" r="14" />
            {/* Beak */}
            <polygon points="130,82 142,92 130,96" fill={JP.gold} />
          </g>
        )}
        {/* School initials across the bottom in stadium block type */}
        <rect x="55" y="178" width="150" height="38" fill={JP.ink} rx="4" />
        <text x="130" y="206" textAnchor="middle" fontFamily={JP_FONT_DISPLAY}
          fontSize="28" fontWeight="800" fill={JP.ledAmberBright} letterSpacing="2">
          {initials}
        </text>
        {/* Three rivet dots along the chrome */}
        <circle cx="130" cy="22" r="3" fill={JP.ink} />
        <circle cx="52"  cy="158" r="3" fill={JP.ink} />
        <circle cx="208" cy="158" r="3" fill={JP.ink} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — MASSIVE jumbotron center scorebug
// ═══════════════════════════════════════════════════════════
export function JumbotronProText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'EAGLES   vs   COUGARS';
  const subtitle = config.subtitle || 'HOMECOMING · FRI 7PM · HOME FIELD';

  // Parse HOME vs AWAY from content string so we can split the panel.
  // Any delimiter works: " vs ", " VS ", "@". Falls back to whole string
  // centered if we can't split cleanly.
  const parts = content.split(/\s+(?:vs|VS|v\.?|@)\s+/i);
  const home = (parts[0] || 'HOME').trim();
  const away = (parts[1] || 'AWAY').trim();
  const canSplit = parts.length >= 2;

  // Stub scores for the visual — teachers can edit content/subtitle,
  // the score numerals are decorative stadium chrome. "14 – 21" reads
  // like a live game without pretending to be real data.
  const homeScore = config.homeScore ?? 14;
  const awayScore = config.awayScore ?? 21;
  const quarter = config.quarter || '3RD QTR';
  const clock = config.clockText || '04:27';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '1.2%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        borderRadius: 14,
        padding: '1.2%',
        background: `linear-gradient(180deg, ${JP.chrome} 0%, ${JP.chromeDark} 55%, ${JP.chrome} 100%)`,
        boxShadow: '0 24px 60px rgba(0,0,0,0.65), inset 0 2px 0 rgba(255,255,255,0.4)',
      }}>
        {/* Inner dark LED panel */}
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: 10, overflow: 'hidden',
          background: `${JP.stadiumBlack}`,
          backgroundImage: `${LED_SCANLINES}, ${LED_DOT_MATRIX}`,
          backgroundSize: 'auto, 3px 3px',
          border: `2px solid ${JP.ink}`,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* LIVE indicator */}
          <div style={{
            position: 'absolute', top: '3%', left: '3%',
            display: 'flex', alignItems: 'center', gap: '0.6em',
            padding: '0.25em 0.7em',
            background: JP.accent,
            borderRadius: 4,
            fontFamily: JP_FONT_DISPLAY,
            color: JP.white,
            fontSize: 'clamp(10px, 2.2cqh, 22px)',
            letterSpacing: '0.15em',
            boxShadow: `0 0 12px ${JP.accent}`,
            zIndex: 4,
          }}>
            <span style={{
              width: '0.5em', height: '0.5em', borderRadius: '50%',
              background: JP.white,
              animation: 'jp-blink 1.2s infinite',
            }} />
            LIVE
          </div>
          {/* Quarter / clock chip top-right */}
          <div style={{
            position: 'absolute', top: '3%', right: '3%',
            padding: '0.25em 0.7em',
            background: JP.stadiumDark,
            border: `1px solid ${JP.ledAmber}`,
            borderRadius: 4,
            fontFamily: JP_FONT_MONO,
            color: JP.ledAmberBright,
            fontSize: 'clamp(10px, 2.2cqh, 22px)',
            letterSpacing: '0.1em',
            textShadow: `0 0 8px ${JP.ledAmber}`,
            zIndex: 4,
          }}>
            {quarter} · {clock}
          </div>

          {/* Main split HOME / AWAY body */}
          <div style={{
            flex: 1, minHeight: 0,
            display: 'flex', flexDirection: 'row',
            padding: '7% 2% 2% 2%',
          }}>
            {canSplit ? (
              <>
                {/* HOME half */}
                <div style={{
                  flex: 1, minWidth: 0,
                  background: `linear-gradient(180deg, ${JP.home} 0%, #0F1E4A 100%)`,
                  borderRadius: 6,
                  margin: '0 1% 0 0',
                  padding: '3% 2%',
                  display: 'flex', flexDirection: 'column',
                  border: `2px solid ${JP.ink}`,
                  boxShadow: 'inset 0 0 30px rgba(0,0,0,0.5)',
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: LED_SCANLINES,
                    pointerEvents: 'none',
                  }} />
                  <div style={{
                    flex: '0 0 14%', minHeight: 0,
                    fontFamily: JP_FONT_DISPLAY, color: JP.chrome,
                    letterSpacing: '0.3em',
                  }}>
                    <FitText max={60} min={8} wrap={false}>HOME</FitText>
                  </div>
                  <div style={{ flex: '0 0 30%', minHeight: 0 }}>
                    <EditableText
                      configKey="content" onConfigChange={onConfigChange}
                      max={140} min={10} wrap={false}
                      style={{
                        fontFamily: JP_FONT_DISPLAY, color: JP.white,
                        fontWeight: 800, letterSpacing: '0.04em',
                        textShadow: `0 2px 0 ${JP.ink}`,
                      }}
                    >
                      {home}
                    </EditableText>
                  </div>
                  <div style={{ flex: '1 1 56%', minHeight: 0 }}>
                    <FitText max={520} min={40} wrap={false}
                      style={{
                        fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                        color: JP.ledAmberBright,
                        textShadow: `0 0 18px ${JP.ledAmber}, 0 0 36px ${JP.ledAmber}, 0 4px 0 ${JP.ink}`,
                        letterSpacing: '-0.02em',
                      }}>
                      {String(homeScore).padStart(2, '0')}
                    </FitText>
                  </div>
                </div>
                {/* Center divider — "vs" badge */}
                <div style={{
                  flex: '0 0 10%', minWidth: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: JP_FONT_DISPLAY, color: JP.ledAmber,
                  textShadow: `0 0 12px ${JP.ledAmber}`,
                }}>
                  <FitText max={100} min={10} wrap={false}
                    style={{ fontWeight: 800, letterSpacing: '0.05em' }}>
                    VS
                  </FitText>
                </div>
                {/* AWAY half */}
                <div style={{
                  flex: 1, minWidth: 0,
                  background: `linear-gradient(180deg, ${JP.away} 0%, #6B0F0F 100%)`,
                  borderRadius: 6,
                  margin: '0 0 0 1%',
                  padding: '3% 2%',
                  display: 'flex', flexDirection: 'column',
                  border: `2px solid ${JP.ink}`,
                  boxShadow: 'inset 0 0 30px rgba(0,0,0,0.5)',
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: LED_SCANLINES,
                    pointerEvents: 'none',
                  }} />
                  <div style={{
                    flex: '0 0 14%', minHeight: 0,
                    fontFamily: JP_FONT_DISPLAY, color: JP.chrome,
                    letterSpacing: '0.3em',
                  }}>
                    <FitText max={60} min={8} wrap={false}>AWAY</FitText>
                  </div>
                  <div style={{ flex: '0 0 30%', minHeight: 0 }}>
                    <FitText max={140} min={10} wrap={false}
                      style={{
                        fontFamily: JP_FONT_DISPLAY, color: JP.white,
                        fontWeight: 800, letterSpacing: '0.04em',
                        textShadow: `0 2px 0 ${JP.ink}`,
                      }}>
                      {away}
                    </FitText>
                  </div>
                  <div style={{ flex: '1 1 56%', minHeight: 0 }}>
                    <FitText max={520} min={40} wrap={false}
                      style={{
                        fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                        color: JP.ledAmberBright,
                        textShadow: `0 0 18px ${JP.ledAmber}, 0 0 36px ${JP.ledAmber}, 0 4px 0 ${JP.ink}`,
                        letterSpacing: '-0.02em',
                      }}>
                      {String(awayScore).padStart(2, '0')}
                    </FitText>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, minHeight: 0 }}>
                <EditableText
                  configKey="content" onConfigChange={onConfigChange}
                  max={260} min={16} wrap={false}
                  style={{
                    fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                    color: JP.ledAmberBright,
                    textShadow: `0 0 18px ${JP.ledAmber}`,
                    letterSpacing: '0.02em',
                  }}>
                  {content}
                </EditableText>
              </div>
            )}
          </div>

          {/* Subtitle strip — LED dot-matrix ticker edge along bottom */}
          {!compact && subtitle && (
            <div style={{
              flex: '0 0 14%', minHeight: 0,
              background: `linear-gradient(180deg, ${JP.stadiumDark} 0%, ${JP.ink} 100%)`,
              borderTop: `2px solid ${JP.ledAmber}`,
              padding: '0.4em 3%',
              display: 'flex', alignItems: 'center', gap: '2%',
            }}>
              <div style={{
                flex: '0 0 12%',
                padding: '0.25em 0.6em',
                background: JP.ledAmber,
                color: JP.ink,
                fontFamily: JP_FONT_DISPLAY,
                fontSize: 'clamp(10px, 2.6cqh, 26px)',
                letterSpacing: '0.1em',
                borderRadius: 3,
                textAlign: 'center',
              }}>
                ◆
              </div>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <EditableText
                  configKey="subtitle" onConfigChange={onConfigChange}
                  max={90} min={8} wrap={false} center={false}
                  style={{
                    fontFamily: JP_FONT_MONO,
                    color: JP.ledAmberBright,
                    letterSpacing: '0.15em',
                    textShadow: `0 0 6px ${JP.ledAmber}`,
                  }}>
                  {subtitle.toUpperCase()}
                </EditableText>
              </div>
            </div>
          )}
        </div>
        <style>{`
          @keyframes jp-blink { 0%,49%{opacity:1} 50%,100%{opacity:0.3} }
        `}</style>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — dark LED game-clock display with live analog overlay
// ═══════════════════════════════════════════════════════════
export function JumbotronProClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const is24 = config.format === '24h';
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    hour12: !is24, timeZone: tz,
  }).format(now);

  // Analog hand angles (live)
  const sec = now.getSeconds();
  const min = now.getMinutes() + sec / 60;
  const hr = (now.getHours() % 12) + min / 60;
  const hrA = hr * 30 - 90;
  const minA = min * 6 - 90;
  const secA = sec * 6 - 90;
  const polar = (a: number, r: number) => [50 + r * Math.cos(a * Math.PI / 180), 50 + r * Math.sin(a * Math.PI / 180)];
  const [hx, hy] = polar(hrA, 22);
  const [mx, my] = polar(minA, 32);
  const [sx, sy] = polar(secA, 36);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...chromeBezel(12),
        padding: '3%',
      }}>
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: 8, overflow: 'hidden',
          background: JP.stadiumBlack,
          backgroundImage: `${LED_SCANLINES}, ${LED_DOT_MATRIX}`,
          backgroundSize: 'auto, 3px 3px',
          border: `2px solid ${JP.ink}`,
          display: 'flex', flexDirection: compact ? 'column' : 'row',
          alignItems: 'center', gap: '3%', padding: '3%',
        }}>
          {/* Analog dial */}
          <div style={{
            flex: compact ? '1 1 50%' : '0 0 38%',
            aspectRatio: '1', height: compact ? 'auto' : '92%',
            position: 'relative',
          }}>
            <svg viewBox="0 0 100 100" width="100%" height="100%">
              <circle cx="50" cy="50" r="46" fill={JP.stadiumDark} stroke={JP.chrome} strokeWidth="2" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={JP.ledAmber} strokeWidth="0.8" opacity="0.5" />
              {/* Hour ticks */}
              {Array.from({ length: 12 }).map((_, i) => {
                const a = i * 30 - 90;
                const [x1, y1] = polar(a, 38);
                const [x2, y2] = polar(a, 44);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={JP.ledAmber} strokeWidth="1.2" />;
              })}
              {/* Hour hand */}
              <line x1="50" y1="50" x2={hx} y2={hy} stroke={JP.chrome} strokeWidth="3" strokeLinecap="round" />
              {/* Minute hand */}
              <line x1="50" y1="50" x2={mx} y2={my} stroke={JP.ledAmberBright} strokeWidth="2" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 1px ${JP.ledAmber})` }} />
              {/* Second hand */}
              <line x1="50" y1="50" x2={sx} y2={sy} stroke={JP.accent} strokeWidth="1" strokeLinecap="round" />
              <circle cx="50" cy="50" r="2.5" fill={JP.chrome} stroke={JP.ink} strokeWidth="0.8" />
            </svg>
          </div>
          {/* Digital LED time */}
          <div style={{
            flex: 1, minWidth: 0, height: '100%',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <div style={{ flex: compact ? '0 0 100%' : '1 1 70%', minHeight: 0 }}>
              <FitText max={200} min={16} wrap={false}
                style={{
                  fontFamily: JP_FONT_MONO, fontWeight: 800,
                  color: JP.ledAmberBright,
                  letterSpacing: '0.02em',
                  textShadow: `0 0 12px ${JP.ledAmber}, 0 0 24px ${JP.ledAmber}`,
                }}>
                {time}
              </FitText>
            </div>
            {!compact && (
              <div style={{ flex: '0 0 26%', minHeight: 0 }}>
                <FitText max={50} min={8} wrap={false}
                  style={{
                    fontFamily: JP_FONT_DISPLAY,
                    color: JP.chrome,
                    letterSpacing: '0.3em',
                  }}>
                  GAME CLOCK
                </FitText>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — compact LED weather chip (6 condition buckets)
// ═══════════════════════════════════════════════════════════
export function JumbotronProWeather({ config, compact }: { config: any; compact?: boolean }) {
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

  // 6-bucket icons in LED amber-on-black style
  const Icon = () => (
    <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {isClear && (
        <g fill={JP.ledAmberBright} stroke={JP.ledAmber} strokeWidth="1.5"
          style={{ filter: `drop-shadow(0 0 6px ${JP.ledAmber})` }}>
          <circle cx="50" cy="50" r="18" />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = i * 45; const rad = a * Math.PI / 180;
            return <line key={i} x1={50 + 24 * Math.cos(rad)} y1={50 + 24 * Math.sin(rad)}
              x2={50 + 34 * Math.cos(rad)} y2={50 + 34 * Math.sin(rad)}
              stroke={JP.ledAmberBright} strokeWidth="3" strokeLinecap="round" />;
          })}
        </g>
      )}
      {isPartly && (
        <g>
          <circle cx="36" cy="38" r="14" fill={JP.ledAmberBright}
            style={{ filter: `drop-shadow(0 0 6px ${JP.ledAmber})` }} />
          <path d="M28 68 Q18 68 18 58 Q18 48 30 48 Q34 38 48 40 Q58 36 66 46 Q80 46 80 60 Q80 72 68 72 L32 72 Q28 72 28 68Z"
            fill={JP.chrome} stroke={JP.ink} strokeWidth="1.5" />
        </g>
      )}
      {isOvercast && (
        <path d="M28 68 Q18 68 18 58 Q18 48 30 48 Q34 38 48 40 Q58 36 66 46 Q80 46 80 60 Q80 72 68 72 L32 72 Q28 72 28 68Z"
          fill={JP.chromeDark} stroke={JP.ink} strokeWidth="1.5" />
      )}
      {isRain && (
        <g>
          <path d="M28 55 Q18 55 18 45 Q18 35 30 35 Q34 25 48 27 Q58 23 66 33 Q80 33 80 47 Q80 59 68 59 L32 59 Q28 59 28 55Z"
            fill={JP.chromeDark} stroke={JP.ink} strokeWidth="1.5" />
          {[30, 45, 60, 72].map((x, i) => (
            <line key={i} x1={x} y1="66" x2={x - 3} y2="82" stroke={JP.ledAmberBright} strokeWidth="2" strokeLinecap="round" />
          ))}
        </g>
      )}
      {isSnow && (
        <g>
          <path d="M28 55 Q18 55 18 45 Q18 35 30 35 Q34 25 48 27 Q58 23 66 33 Q80 33 80 47 Q80 59 68 59 L32 59 Q28 59 28 55Z"
            fill={JP.chromeDark} stroke={JP.ink} strokeWidth="1.5" />
          {[[30, 72], [50, 78], [70, 72]].map(([x, y], i) => (
            <g key={i} stroke={JP.chrome} strokeWidth="1.6" strokeLinecap="round">
              <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
              <line x1={x} y1={y - 5} x2={x} y2={y + 5} />
              <line x1={x - 3} y1={y - 3} x2={x + 3} y2={y + 3} />
              <line x1={x - 3} y1={y + 3} x2={x + 3} y2={y - 3} />
            </g>
          ))}
        </g>
      )}
      {isStorm && (
        <g>
          <path d="M28 55 Q18 55 18 45 Q18 35 30 35 Q34 25 48 27 Q58 23 66 33 Q80 33 80 47 Q80 59 68 59 L32 59 Q28 59 28 55Z"
            fill={JP.stadiumDark} stroke={JP.ink} strokeWidth="1.5" />
          <polygon points="48,58 60,58 52,72 62,72 40,92 48,74 40,74"
            fill={JP.ledAmberBright} stroke={JP.ink} strokeWidth="1"
            style={{ filter: `drop-shadow(0 0 4px ${JP.ledAmber})` }} />
        </g>
      )}
    </svg>
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...chromeBezel(10),
        padding: '2.5%',
      }}>
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: 7, overflow: 'hidden',
          background: JP.stadiumBlack,
          backgroundImage: `${LED_SCANLINES}, ${LED_DOT_MATRIX}`,
          backgroundSize: 'auto, 3px 3px',
          border: `2px solid ${JP.ink}`,
          display: 'flex', flexDirection: 'column',
          padding: '5% 4%',
          gap: '3%',
        }}>
          <div style={{
            flex: '0 0 54%', minHeight: 0,
            display: 'flex', alignItems: 'center', gap: '4%',
          }}>
            <div style={{ flex: '0 0 40%', height: '100%' }}><Icon /></div>
            <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
              <FitText max={150} min={12} wrap={false}
                style={{
                  fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                  color: JP.ledAmberBright,
                  textShadow: `0 0 10px ${JP.ledAmber}`,
                  letterSpacing: '-0.02em',
                }}>
                {temp}°
              </FitText>
            </div>
          </div>
          {!compact && (
            <>
              <div style={{ flex: '0 0 26%', minHeight: 0 }}>
                <FitText max={50} min={7} wrap={false}
                  style={{
                    fontFamily: JP_FONT_MONO, color: JP.chrome,
                    letterSpacing: '0.15em',
                  }}>
                  {cond.toUpperCase()}
                </FitText>
              </div>
              <div style={{ flex: '0 0 16%', minHeight: 0 }}>
                <FitText max={30} min={6} wrap={false}
                  style={{
                    fontFamily: JP_FONT_MONO, color: JP.ledAmber,
                    letterSpacing: '0.15em', opacity: 0.75,
                  }}>
                  ◆ {location.toUpperCase()}
                </FitText>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — flip-card style with chrome bezel + amber numerals
// ═══════════════════════════════════════════════════════════
export function JumbotronProCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 4 * 86400000);
  const label = (config.label || resolved?.prefix || 'Kickoff in').toUpperCase();
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const bigNum = days > 0 ? days : hours;
  const unit = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : (hours === 1 ? 'HR' : 'HRS');

  // Render as two flip-card "tiles" with the countdown numerals
  // printed across both. The center split line sells the flip-card
  // effect — that horizontal seam that real stadium countdown boards
  // have where the top half of the numeral drops.
  const numStr = String(bigNum).padStart(2, '0');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...chromeBezel(10),
        padding: '3%',
        display: 'flex', flexDirection: 'column', gap: '4%',
      }}>
        {/* Label strip */}
        <div style={{
          flex: '0 0 20%', minHeight: 0,
          background: JP.ink,
          borderRadius: 4,
          padding: '2% 4%',
          border: `1px solid ${JP.ledAmber}`,
        }}>
          <EditableText
            configKey="label" onConfigChange={onConfigChange}
            max={60} min={7} wrap={false}
            style={{
              fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
              color: JP.ledAmberBright,
              letterSpacing: '0.15em',
              textShadow: `0 0 8px ${JP.ledAmber}`,
            }}>
            ▶ {label}
          </EditableText>
        </div>
        {/* Flip-card tiles */}
        <div style={{
          flex: '1 1 60%', minHeight: 0,
          display: 'flex', gap: '4%',
        }}>
          {numStr.split('').map((d, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 0,
              position: 'relative',
              background: JP.stadiumBlack,
              borderRadius: 6,
              border: `2px solid ${JP.ink}`,
              boxShadow: 'inset 0 0 18px rgba(0,0,0,0.7)',
              overflow: 'hidden',
            }}>
              {/* Horizontal flip-seam line */}
              <div style={{
                position: 'absolute', left: 0, right: 0, top: '50%',
                height: 2, background: JP.ink,
                borderTop: `1px solid rgba(255,255,255,0.08)`,
                zIndex: 3,
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: `${LED_SCANLINES}`,
                pointerEvents: 'none', zIndex: 2,
              }} />
              <div style={{ position: 'absolute', inset: '4% 6%' }}>
                <FitText max={400} min={28} wrap={false}
                  style={{
                    fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                    color: JP.ledAmberBright,
                    textShadow: `0 0 16px ${JP.ledAmber}, 0 0 32px ${JP.ledAmber}`,
                    letterSpacing: '-0.04em',
                  }}>
                  {d}
                </FitText>
              </div>
            </div>
          ))}
        </div>
        {/* Unit label */}
        <div style={{
          flex: '0 0 14%', minHeight: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FitText max={56} min={8} wrap={false}
            style={{
              fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
              color: JP.chrome, letterSpacing: '0.3em',
            }}>
            {unit}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — pinned COACH'S MESSAGE dark-panel card
// ═══════════════════════════════════════════════════════════
export function JumbotronProAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title = (config.title || "COACH'S MESSAGE").toUpperCase();
  const message = config.message || config.body || 'GO EAGLES. Play smart, play hard, play together.';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2.5%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        borderRadius: 10,
        background: `linear-gradient(180deg, ${JP.stadiumDark} 0%, ${JP.stadiumBlack} 100%)`,
        border: `2px solid ${JP.ink}`,
        boxShadow: '0 16px 34px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'row',
      }}>
        {/* Red accent strip down the left edge */}
        <div style={{
          flex: '0 0 4%', minWidth: 8,
          background: `linear-gradient(180deg, ${JP.accent} 0%, #8B0D0D 100%)`,
          boxShadow: `0 0 18px ${JP.accent}`,
        }} />
        {/* Body */}
        <div style={{
          flex: 1, minWidth: 0,
          padding: '3% 4%',
          display: 'flex', flexDirection: 'column',
          backgroundImage: LED_SCANLINES,
        }}>
          {/* Title row */}
          <div style={{
            flex: '0 0 22%', minHeight: 0,
            display: 'flex', alignItems: 'center', gap: '2%',
          }}>
            <div style={{
              padding: '0.25em 0.7em',
              background: JP.accent,
              color: JP.white,
              fontFamily: JP_FONT_DISPLAY,
              fontSize: 'clamp(10px, 3cqh, 26px)',
              letterSpacing: '0.15em',
              borderRadius: 3,
              boxShadow: `0 0 10px ${JP.accent}`,
            }}>
              📌 PINNED
            </div>
            <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
              <EditableText configKey="title" onConfigChange={onConfigChange} max={60} min={8} wrap={false} center={false}
                style={{
                  fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                  color: JP.ledAmberBright, letterSpacing: '0.15em',
                  textShadow: `0 0 8px ${JP.ledAmber}`,
                }}>{title}</EditableText>
            </div>
          </div>
          {/* Body message */}
          <div style={{ flex: '1 1 72%', minHeight: 0, paddingTop: '2%' }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={200} min={10}
              center={false}
              style={{
                fontFamily: "'Georgia', 'Times New Roman', serif",
                fontStyle: 'italic',
                color: JP.white,
                lineHeight: 1.2,
                textShadow: `0 2px 6px rgba(0,0,0,0.7)`,
              }}>
              {message}
            </EditableText>
          </div>
          {/* Signature flourish */}
          {!compact && (
            <div style={{ flex: '0 0 14%', minHeight: 0, textAlign: 'right' }}>
              <FitText max={36} min={7} wrap={false} center={false}
                style={{
                  fontFamily: "'Georgia', serif", fontStyle: 'italic',
                  color: JP.chrome,
                }}>
                — Coach
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — vertical SEASON STANDINGS rail
// ═══════════════════════════════════════════════════════════
export function JumbotronProCalendar({ config }: { config: any; compact?: boolean }) {
  // Re-purpose calendar events as season-standings rows. Each row
  // renders as TEAM · W-L; teachers still edit via the calendar panel.
  const events = (config.events && config.events.length ? config.events : [
    { date: '12-1', title: 'EAGLES ⭐' },
    { date: '10-3', title: 'Hawks' },
    { date: '9-4',  title: 'Tigers' },
    { date: '7-6',  title: 'Bears' },
    { date: '5-8',  title: 'Wolves' },
    { date: '2-11', title: 'Cougars' },
  ]).slice(0, Math.max(1, Math.min(12, config.maxEvents ?? 6)));

  return (
    <div className="absolute inset-0" style={{ padding: '4% 6%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...chromeBezel(8),
        padding: '4% 3%',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: 6, overflow: 'hidden',
          background: JP.stadiumBlack,
          backgroundImage: LED_SCANLINES,
          border: `2px solid ${JP.ink}`,
          padding: '6% 5%',
          display: 'flex', flexDirection: 'column', gap: '3%',
        }}>
          {/* Header */}
          <div style={{
            flex: '0 0 12%', minHeight: 0,
            borderBottom: `2px solid ${JP.ledAmber}`,
            paddingBottom: '2%',
          }}>
            <FitText max={40} min={7} wrap={false}
              style={{
                fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                color: JP.ledAmberBright, letterSpacing: '0.2em',
                textShadow: `0 0 8px ${JP.ledAmber}`,
              }}>
              STANDINGS
            </FitText>
          </div>
          {/* Rows */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '1.5%' }}>
            {events.map((e: any, i: number) => {
              const isUs = /eagle|home|\*|⭐/i.test(e.title);
              const wl = e.date || '0-0';
              const name = e.title || 'Team';
              return (
                <div key={i} style={{
                  flex: 1, minHeight: 0,
                  display: 'flex', alignItems: 'center',
                  gap: '3%',
                  padding: '0 3%',
                  background: isUs
                    ? `linear-gradient(90deg, ${JP.home} 0%, rgba(30,58,138,0.2) 100%)`
                    : 'rgba(255,255,255,0.03)',
                  border: isUs ? `1px solid ${JP.ledAmber}` : `1px solid rgba(255,255,255,0.05)`,
                  borderRadius: 3,
                }}>
                  <div style={{
                    flex: '0 0 12%',
                    fontFamily: JP_FONT_MONO,
                    color: isUs ? JP.ledAmberBright : JP.chrome,
                    fontSize: 'clamp(10px, 2.4cqh, 22px)',
                    textAlign: 'center',
                    fontWeight: 700,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                    <FitText max={40} min={7} wrap={false} center={false}
                      style={{
                        fontFamily: JP_FONT_DISPLAY, fontWeight: 700,
                        color: isUs ? JP.white : JP.chrome,
                        letterSpacing: '0.05em',
                      }}>
                      {name.toUpperCase()}
                    </FitText>
                  </div>
                  <div style={{
                    flex: '0 0 28%', height: '100%',
                    textAlign: 'right',
                  }}>
                    <FitText max={36} min={6} wrap={false}
                      style={{
                        fontFamily: JP_FONT_MONO, fontWeight: 800,
                        color: isUs ? JP.ledAmberBright : JP.chrome,
                        letterSpacing: '0.05em',
                        textShadow: isUs ? `0 0 6px ${JP.ledAmber}` : undefined,
                      }}>
                      {wl}
                    </FitText>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — vertical PLAYER STATS rail
// ═══════════════════════════════════════════════════════════
export function JumbotronProStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || config.name || 'Alex Rivera';
  const role = config.role || 'QB #7 · Senior';
  const stats = config.bio || config.quote || '32 TDs · 4,112 yds · 68% comp';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  // Parse a simple stats string "A · B · C" into 3 rows so we can
  // render horizontal stat bars. Any dot / pipe / bullet works. If no
  // separator, one row of the whole string.
  const statItems = stats.split(/\s*[·•|]\s*/).filter(Boolean).slice(0, 3);

  return (
    <div className="absolute inset-0" style={{ padding: '4% 6%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...chromeBezel(8),
        padding: '4% 3%',
      }}>
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: 6, overflow: 'hidden',
          background: JP.stadiumBlack,
          backgroundImage: LED_SCANLINES,
          border: `2px solid ${JP.ink}`,
          padding: '5%',
          display: 'flex', flexDirection: 'column', gap: '3%',
        }}>
          {/* Header */}
          <div style={{
            flex: '0 0 9%', minHeight: 0,
            borderBottom: `2px solid ${JP.ledAmber}`, paddingBottom: '2%',
          }}>
            <FitText max={40} min={7} wrap={false}
              style={{
                fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                color: JP.ledAmberBright, letterSpacing: '0.2em',
                textShadow: `0 0 8px ${JP.ledAmber}`,
              }}>
              PLAYER STATS
            </FitText>
          </div>
          {/* Portrait */}
          <div style={{
            flex: '0 0 38%', minHeight: 0,
            position: 'relative',
            borderRadius: 6, overflow: 'hidden',
            background: `linear-gradient(135deg, ${JP.home} 0%, ${JP.stadiumDark} 100%)`,
            border: `2px solid ${JP.ledAmber}`,
            boxShadow: `0 0 18px ${JP.ledAmber}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {photoUrl ? (
              <img src={resolveUrl(photoUrl)} alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg viewBox="0 0 100 100" width="70%" height="70%">
                <circle cx="50" cy="38" r="16" fill={JP.chrome} />
                <path d="M20 92 Q20 62 50 62 Q80 62 80 92 Z" fill={JP.chrome} />
                {/* Jersey number tag */}
                <rect x="42" y="70" width="16" height="14" fill={JP.ledAmber} stroke={JP.ink} strokeWidth="1" />
                <text x="50" y="81" textAnchor="middle" fontFamily={JP_FONT_DISPLAY}
                  fontSize="10" fontWeight="800" fill={JP.ink}>7</text>
              </svg>
            )}
            {/* Jersey # overlay chip */}
            <div style={{
              position: 'absolute', top: '4%', right: '4%',
              padding: '0.2em 0.5em',
              background: JP.accent, color: JP.white,
              fontFamily: JP_FONT_DISPLAY,
              fontSize: 'clamp(10px, 3cqh, 24px)',
              borderRadius: 3,
              boxShadow: `0 0 8px ${JP.accent}`,
              letterSpacing: '0.05em',
            }}>
              MVP
            </div>
          </div>
          {/* Name + role */}
          <div style={{ flex: '0 0 9%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={40} min={7} wrap={false}
              style={{
                fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                color: JP.white, letterSpacing: '0.05em',
                textShadow: `0 2px 4px rgba(0,0,0,0.8)`,
              }}>
              {name.toUpperCase()}
            </EditableText>
          </div>
          <div style={{ flex: '0 0 7%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={26} min={6} wrap={false}
              style={{
                fontFamily: JP_FONT_MONO,
                color: JP.ledAmberBright, letterSpacing: '0.1em',
                textShadow: `0 0 6px ${JP.ledAmber}`,
              }}>
              {role}
            </EditableText>
          </div>
          {/* Stat bars */}
          <div style={{
            flex: 1, minHeight: 0,
            display: 'flex', flexDirection: 'column', gap: '4%',
            justifyContent: 'center',
          }}>
            {statItems.length > 0 ? statItems.map((s: string, i: number) => {
              // Extract a number from each stat for the bar fill; fall
              // back to varying fills so every row still feels like an
              // actual stat row even without parseable numbers.
              const m = s.match(/\d+(?:\.\d+)?/);
              const pct = m ? Math.min(100, parseFloat(m[0]) > 100 ? 85 - i * 10 : Math.max(20, parseFloat(m[0]))) : (80 - i * 18);
              return (
                <div key={i} style={{
                  flex: 1, minHeight: 0,
                  display: 'flex', flexDirection: 'column', gap: '15%',
                }}>
                  <div style={{ flex: '0 0 46%', minHeight: 0 }}>
                    <FitText max={20} min={6} wrap={false} center={false}
                      style={{
                        fontFamily: JP_FONT_MONO, color: JP.chrome,
                        letterSpacing: '0.05em',
                      }}>
                      {s}
                    </FitText>
                  </div>
                  <div style={{
                    flex: '0 0 38%',
                    background: JP.ink,
                    borderRadius: 2,
                    border: `1px solid ${JP.inkSoft}`,
                    overflow: 'hidden',
                    position: 'relative',
                  }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: `linear-gradient(90deg, ${JP.ledAmber} 0%, ${JP.ledAmberBright} 100%)`,
                      boxShadow: `0 0 8px ${JP.ledAmber}`,
                    }} />
                  </div>
                </div>
              );
            }) : (
              <div style={{ flex: 1, minHeight: 0 }}>
                <EditableText configKey="bio" onConfigChange={onConfigChange}
                  max={30} min={7} center={false}
                  style={{ fontFamily: JP_FONT_MONO, color: JP.chrome }}>
                  {stats}
                </EditableText>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — chrome bezel photo frame with scanlines
// ═══════════════════════════════════════════════════════════
export function JumbotronProImageCarousel({ config }: { config: any; compact?: boolean }) {
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
        ...chromeBezel(8),
        padding: '3%',
      }}>
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: 5, overflow: 'hidden',
          background: JP.stadiumBlack,
          border: `2px solid ${JP.ink}`,
        }}>
          {hasImage ? (
            <img src={resolveUrl(urls[idx])} alt="Replay"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(180deg, ${JP.home} 0%, ${JP.stadiumDark} 100%)`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '6%', textAlign: 'center',
            }}>
              <div style={{ fontSize: 'clamp(24px, 22cqh, 120px)' }}>📣</div>
              <div style={{
                fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
                color: JP.ledAmberBright,
                fontSize: 'clamp(10px, 5cqh, 34px)',
                letterSpacing: '0.15em',
                textShadow: `0 0 8px ${JP.ledAmber}`,
                marginTop: '2cqh',
              }}>
                CROWD CAM
              </div>
              <div style={{
                fontFamily: JP_FONT_MONO,
                color: JP.chrome,
                fontSize: 'clamp(9px, 3cqh, 20px)',
                letterSpacing: '0.1em',
                marginTop: '1cqh',
                opacity: 0.8,
              }}>
                Drop photos to fill
              </div>
            </div>
          )}
          {/* Scanline overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: LED_SCANLINES,
            pointerEvents: 'none',
            mixBlendMode: 'overlay',
          }} />
          {/* REC chip */}
          <div style={{
            position: 'absolute', top: '5%', left: '5%',
            display: 'flex', alignItems: 'center', gap: '0.4em',
            padding: '0.2em 0.6em',
            background: JP.accent, color: JP.white,
            fontFamily: JP_FONT_DISPLAY,
            fontSize: 'clamp(9px, 3cqh, 20px)',
            letterSpacing: '0.15em',
            borderRadius: 3,
            boxShadow: `0 0 8px ${JP.accent}`,
          }}>
            <span style={{
              width: '0.5em', height: '0.5em', borderRadius: '50%',
              background: JP.white,
              animation: 'jp-blink 1.2s infinite',
            }} />
            REC
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — full-width LED dot-matrix scrolling score strip
// ═══════════════════════════════════════════════════════════
export function JumbotronProTicker({ config }: { config: any; compact?: boolean }) {
  const messages: string[] = ((config.messages as string[]) || [])
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const list = messages.length > 0 ? messages : [
    'FINAL: Varsity 28 — Central 14',
    'JV soccer moves on to regionals',
    'Girls volleyball states next Saturday',
  ];
  const speed = (config.speed as string) || 'medium';
  const durationSec = speed === 'fast' ? 20 : speed === 'slow' ? 60 : 35;

  // Join messages into one long LED strip separated by a diamond
  // bullet. Marquee loops continuously.
  const joined = list.join('   ◆   ') + '   ◆   ' + list.join('   ◆   ');

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, ${JP.stadiumBlack} 0%, #020407 50%, ${JP.stadiumBlack} 100%)`,
        borderTop: `2px solid ${JP.ledAmber}`,
        borderBottom: `2px solid ${JP.ledAmber}`,
        backgroundImage: `${LED_SCANLINES}, ${LED_DOT_MATRIX}`,
        backgroundSize: 'auto, 3px 3px',
        display: 'flex', alignItems: 'center',
        padding: '0 0 0 0',
      }}>
        {/* Amber bookend label */}
        <div style={{
          flex: '0 0 auto',
          height: '100%',
          padding: '0 1.2em',
          background: JP.ledAmber,
          color: JP.ink,
          fontFamily: JP_FONT_DISPLAY, fontWeight: 800,
          display: 'flex', alignItems: 'center', gap: '0.5em',
          fontSize: 'clamp(12px, 40cqh, 28px)',
          letterSpacing: '0.15em',
          boxShadow: `inset -4px 0 8px rgba(0,0,0,0.4)`,
          zIndex: 2,
        }}>
          <span style={{ fontSize: '1.2em' }}>📣</span> LIVE
        </div>
        {/* Scrolling strip */}
        <div style={{
          flex: 1, minWidth: 0, height: '100%',
          overflow: 'hidden', position: 'relative',
          display: 'flex', alignItems: 'center',
        }}>
          <div style={{
            whiteSpace: 'nowrap',
            fontFamily: JP_FONT_MONO, fontWeight: 700,
            color: JP.ledAmberBright,
            fontSize: 'clamp(12px, 42cqh, 32px)',
            letterSpacing: '0.12em',
            textShadow: `0 0 8px ${JP.ledAmber}, 0 0 16px ${JP.ledAmber}`,
            padding: '0 2em',
            animation: `jp-ticker-scroll ${durationSec}s linear infinite`,
          }}>
            {joined}
          </div>
        </div>
        <style>{`
          @keyframes jp-ticker-scroll {
            0%   { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
          }
          @keyframes jp-blink { 0%,49%{opacity:1} 50%,100%{opacity:0.3} }
        `}</style>
      </div>
    </div>
  );
}
