"use client";

/**
 * News Studio Pro — high school premium TV news studio aesthetic.
 *
 * CNN/ESPN broadcast feel: glass-panel lower-thirds, neon accent strips,
 * LIVE indicators, premium network typography. Sophisticated — not the
 * middle-school Morning News variant.
 *
 *   LOGO            → sharp rectangular station-ID bug, accent blue underline
 *   TEXT            → glass-panel headline card, bold Inter caps + blue left strip
 *   CLOCK           → dark glass panel, blue glow edge, LIVE "ON AIR" dot, analog hands
 *   WEATHER         → "WEATHER CENTER" glass card, condition illustrations + 5-day strip
 *   COUNTDOWN       → breaking-news "T-MINUS" glass banner with blue glow
 *   ANNOUNCEMENT    → lower-third chyron: hot-red category + dark glass body
 *   CALENDAR        → "UP NEXT" glass tiles with premium typography
 *   STAFF_SPOTLIGHT → anchor intro card: portrait frame + glass nameplate
 *   IMAGE_CAROUSEL  → widescreen broadcast frame, blue-glow bezel + corner bug
 *   TICKER          → scrolling lower-third: hot-red LIVE block + glass body
 */

import { useEffect, useRef, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ─── Palette ────────────────────────────────────────────────────────────────
export const NSP = {
  studioBlack: '#0B0F17',
  studioDark:  '#05080E',
  accent:      '#1E90FF',
  accentDeep:  '#0044AA',
  hotRed:      '#EF2929',
  gold:        '#FFC94D',
  glassWhite:  'rgba(255,255,255,0.92)',
  glassBlur:   'rgba(255,255,255,0.12)',
  ink:         '#0B0F17',
  shadow:      'rgba(5,8,14,0.5)',
};

// ─── Fonts ───────────────────────────────────────────────────────────────────
export const NSP_FONT_DISPLAY = "'Inter', 'Helvetica Neue', system-ui, sans-serif";
export const NSP_FONT_SERIF   = "'Fraunces', Georgia, serif";
export const NSP_FONT_MONO    = "'JetBrains Mono', monospace";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// Shared glass-panel CSS value — dark glass surface used by multiple widgets
const GLASS_DARK = `rgba(5,8,14,0.82)`;
const GLASS_PANEL_BORDER = `1px solid rgba(30,144,255,0.25)`;

// ═══════════════════════════════════════════════════════════════════════════
// LOGO — network-style station ID bug
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (
    config.initials ||
    (config.schoolName || 'WHS').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 3).join('').toUpperCase() ||
    'WHS'
  );
  const callSign  = config.callSign  || 'STUDENT NEWS';
  const photoUrl  = config.assetUrl  || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: GLASS_DARK,
        border: GLASS_PANEL_BORDER,
        boxShadow: `0 0 0 1px ${NSP.accentDeep}, 0 8px 32px ${NSP.shadow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}>
        {/* Blue accent underline at top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${NSP.accentDeep}, ${NSP.accent}, ${NSP.accentDeep})`,
        }} />

        {photoUrl ? (
          <div style={{ width: '55%', aspectRatio: '1', marginBottom: '4%', overflow: 'hidden' }}>
            <img src={resolveUrl(photoUrl)} alt={initials}
              style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(1.1)' }} />
          </div>
        ) : (
          /* Station-ID initials */
          <div style={{ flex: '0 0 55%', width: '100%', padding: '0 8%' }}>
            <FitText max={180} min={14} wrap={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY,
                fontWeight: 900,
                color: NSP.glassWhite,
                letterSpacing: '-0.02em',
                textShadow: `0 0 24px ${NSP.accent}55`,
              }}>
              {initials}
            </FitText>
          </div>
        )}

        {/* Call-sign / station label */}
        <div style={{ flex: '0 0 28%', width: '100%', padding: '0 6%' }}>
          <FitText max={48} min={8} wrap={false}
            style={{
              fontFamily: NSP_FONT_DISPLAY,
              fontWeight: 700,
              color: NSP.accent,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}>
            {callSign}
          </FitText>
        </div>

        {/* Blue accent underline at bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, transparent, ${NSP.accent}, transparent)`,
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT — glass-panel headline card with blue left accent strip
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProText({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'BREAKING: NEW SEMESTER BEGINS';
  const subtitle = config.subtitle || 'Stay informed. Stay connected.';

  return (
    <div className="absolute inset-0 flex items-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: GLASS_DARK,
        border: GLASS_PANEL_BORDER,
        boxShadow: `0 4px 32px ${NSP.shadow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Left blue accent strip */}
        <div style={{
          flexShrink: 0,
          width: '1.2%',
          background: `linear-gradient(180deg, ${NSP.accent}, ${NSP.accentDeep})`,
          boxShadow: `0 0 18px ${NSP.accent}88`,
        }} />

        {/* Content area */}
        <div style={{
          flex: 1, minWidth: 0,
          padding: '4% 5%',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 62%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={160} min={10} wrap={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY,
                fontWeight: 900,
                color: NSP.glassWhite,
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
                textShadow: `0 2px 12px ${NSP.shadow}`,
              }}
            >
              {content}
            </EditableText>
          </div>

          {!compact && subtitle && (
            <div style={{ flex: '0 0 34%', minHeight: 0, marginTop: '1%' }}>
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={96} min={8} wrap={false}
                style={{
                  fontFamily: NSP_FONT_SERIF,
                  fontStyle: 'italic',
                  color: `rgba(255,255,255,0.6)`,
                }}
              >
                {subtitle}
              </EditableText>
            </div>
          )}
        </div>

        {/* Gold corner accent */}
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: 0, height: 0,
          borderStyle: 'solid',
          borderWidth: '0 28px 28px 0',
          borderColor: `transparent ${NSP.gold} transparent transparent`,
          opacity: 0.8,
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOCK — dark glass panel, blue glow edge, ON AIR dot, analog hands
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz   = config.timezone || undefined;
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: tz,
  }).format(now);
  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: tz,
  }).format(now).toUpperCase();

  // Analog hand angles
  const localNow = tz
    ? new Date(now.toLocaleString('en-US', { timeZone: tz }))
    : now;
  const sec  = localNow.getSeconds();
  const min  = localNow.getMinutes();
  const hour = localNow.getHours() % 12;
  const secDeg  = sec  * 6;
  const minDeg  = min  * 6 + sec * 0.1;
  const hourDeg = hour * 30 + min * 0.5;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: GLASS_DARK,
        border: `1px solid ${NSP.accent}44`,
        boxShadow: `0 0 0 1px ${NSP.accentDeep}88, 0 0 32px ${NSP.accent}22, inset 0 1px 0 rgba(255,255,255,0.06)`,
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {/* Top blue glow edge */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent 0%, ${NSP.accent} 50%, transparent 100%)`,
          boxShadow: `0 0 12px ${NSP.accent}`,
        }} />

        {/* ON AIR indicator */}
        <div style={{
          position: 'absolute', top: '5%', right: '4%',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: NSP.hotRed,
            boxShadow: `0 0 8px ${NSP.hotRed}`,
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: NSP_FONT_DISPLAY, fontWeight: 800,
            fontSize: '0.55em', color: NSP.hotRed,
            letterSpacing: '0.12em',
          }}>ON AIR</span>
        </div>

        {/* Analog clock face */}
        {!compact && (
          <div style={{ width: '42%', aspectRatio: '1', flexShrink: 0, marginBottom: '4%' }}>
            <svg viewBox="0 0 200 200" width="100%" height="100%">
              {/* Outer ring */}
              <circle cx="100" cy="100" r="96" fill="none" stroke={`${NSP.accent}33`} strokeWidth="2" />
              <circle cx="100" cy="100" r="88" fill={NSP.studioDark} stroke={`${NSP.accent}55`} strokeWidth="1" />
              {/* Hour tick marks */}
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i * 30 - 90) * Math.PI / 180;
                const x1 = 100 + Math.cos(a) * 72;
                const y1 = 100 + Math.sin(a) * 72;
                const x2 = 100 + Math.cos(a) * 82;
                const y2 = 100 + Math.sin(a) * 82;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={NSP.accent} strokeWidth="2.5" />;
              })}
              {/* Minute tick marks */}
              {Array.from({ length: 60 }).map((_, i) => {
                if (i % 5 === 0) return null;
                const a = (i * 6 - 90) * Math.PI / 180;
                const x1 = 100 + Math.cos(a) * 78;
                const y1 = 100 + Math.sin(a) * 78;
                const x2 = 100 + Math.cos(a) * 82;
                const y2 = 100 + Math.sin(a) * 82;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={`${NSP.accent}44`} strokeWidth="1" />;
              })}
              {/* Hour hand */}
              <line
                x1="100" y1="100"
                x2={100 + Math.cos((hourDeg - 90) * Math.PI / 180) * 46}
                y2={100 + Math.sin((hourDeg - 90) * Math.PI / 180) * 46}
                stroke={NSP.glassWhite} strokeWidth="5" strokeLinecap="round"
              />
              {/* Minute hand */}
              <line
                x1="100" y1="100"
                x2={100 + Math.cos((minDeg - 90) * Math.PI / 180) * 62}
                y2={100 + Math.sin((minDeg - 90) * Math.PI / 180) * 62}
                stroke={NSP.glassWhite} strokeWidth="3.5" strokeLinecap="round"
              />
              {/* Second hand */}
              <line
                x1="100" y1="100"
                x2={100 + Math.cos((secDeg - 90) * Math.PI / 180) * 66}
                y2={100 + Math.sin((secDeg - 90) * Math.PI / 180) * 66}
                stroke={NSP.hotRed} strokeWidth="1.5" strokeLinecap="round"
              />
              {/* Center cap */}
              <circle cx="100" cy="100" r="4" fill={NSP.hotRed} />
            </svg>
          </div>
        )}

        {/* Digital time */}
        <div style={{ width: '90%', flex: compact ? '1' : '0 0 28%', minHeight: 0, padding: '0 4%' }}>
          <FitText max={compact ? 120 : 80} min={10} wrap={false}
            style={{
              fontFamily: NSP_FONT_MONO,
              fontWeight: 700,
              color: NSP.accent,
              letterSpacing: '0.04em',
              textShadow: `0 0 20px ${NSP.accent}66`,
            }}>
            {time}
          </FitText>
        </div>

        {!compact && (
          <div style={{ width: '90%', flex: '0 0 16%', minHeight: 0, padding: '0 4%' }}>
            <FitText max={40} min={8} wrap={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY,
                fontWeight: 600,
                color: `rgba(255,255,255,0.45)`,
                letterSpacing: '0.1em',
              }}>
              {dateStr}
            </FitText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER — "WEATHER CENTER" glass panel + condition illustrations
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    fetchWeather(location, isCelsius).then(setWeather);
  }, [location, isCelsius]);

  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');
  const forecast: { day: string; hi: number; lo: number; code: number }[] =
    weather?.forecast ?? config.forecast ?? [];

  // 6 condition buckets
  const low      = (cond || '').toLowerCase();
  const isSnow   = low.includes('snow') || low.includes('flurr');
  const isStorm  = low.includes('storm') || low.includes('thunder');
  const isRain   = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear  = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  // isPartly = everything else (default)

  // SVG condition icon — minimalist broadcast-style
  const CondIcon = () => {
    if (isClear) return (
      <g>
        <circle cx="100" cy="100" r="38" fill={NSP.gold} />
        {[0,45,90,135,180,225,270,315].map((a,i) => {
          const r = Math.PI * a / 180;
          return <line key={i}
            x1={100 + Math.cos(r)*48} y1={100 + Math.sin(r)*48}
            x2={100 + Math.cos(r)*60} y2={100 + Math.sin(r)*60}
            stroke={NSP.gold} strokeWidth="4" strokeLinecap="round" />;
        })}
      </g>
    );
    if (isOvercast) return (
      <path d="M55 130 Q45 130 45 115 Q45 95 65 95 Q68 72 90 70 Q112 55 130 72 Q150 60 168 80 Q190 80 190 105 Q190 130 165 130 Z"
        fill={`rgba(255,255,255,0.25)`} stroke={`rgba(255,255,255,0.4)`} strokeWidth="2" />
    );
    if (isRain) return (
      <g>
        <path d="M55 90 Q45 90 45 75 Q45 55 65 55 Q68 32 90 30 Q112 15 130 32 Q150 20 168 40 Q190 40 190 65 Q190 90 165 90 Z"
          fill={`rgba(255,255,255,0.2)`} stroke={`rgba(255,255,255,0.35)`} strokeWidth="2" />
        {[70,100,130,160].map((x,i) => (
          <line key={i} x1={x} y1={110+i*4} x2={x-8} y2={135+i*4}
            stroke={NSP.accent} strokeWidth="2.5" strokeLinecap="round" />
        ))}
      </g>
    );
    if (isSnow) return (
      <g>
        <path d="M55 90 Q45 90 45 75 Q45 55 65 55 Q68 32 90 30 Q112 15 130 32 Q150 20 168 40 Q190 40 190 65 Q190 90 165 90 Z"
          fill={`rgba(255,255,255,0.22)`} stroke={`rgba(255,255,255,0.4)`} strokeWidth="2" />
        {[[80,120],[115,135],[150,118],[95,148],[130,155]].map(([x,y],i) => (
          <g key={i}>
            <line x1={x-9} y1={y} x2={x+9} y2={y} stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1={x} y1={y-9} x2={x} y2={y+9} stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1={x-6} y1={y-6} x2={x+6} y2={y+6} stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1={x-6} y1={y+6} x2={x+6} y2={y-6} stroke="white" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
      </g>
    );
    if (isStorm) return (
      <g>
        <path d="M55 85 Q45 85 45 70 Q45 50 65 50 Q68 27 90 25 Q112 10 130 27 Q150 15 168 35 Q190 35 190 60 Q190 85 165 85 Z"
          fill={`rgba(100,100,140,0.4)`} stroke={`rgba(255,255,255,0.3)`} strokeWidth="2" />
        <path d="M115 95 L95 125 L110 125 L88 158 L130 118 L113 118 Z"
          fill={NSP.gold} stroke={NSP.studioDark} strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    );
    // partly cloudy (default)
    return (
      <g>
        <circle cx="78" cy="88" r="28" fill={NSP.gold} opacity="0.9" />
        <path d="M70 115 Q58 115 58 100 Q58 83 74 82 Q76 65 93 62 Q112 50 128 65 Q146 55 162 72 Q180 72 180 95 Q180 115 158 115 Z"
          fill={`rgba(255,255,255,0.22)`} stroke={`rgba(255,255,255,0.4)`} strokeWidth="2" />
      </g>
    );
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: GLASS_DARK,
        border: GLASS_PANEL_BORDER,
        boxShadow: `0 4px 32px ${NSP.shadow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header bar */}
        <div style={{
          flexShrink: 0,
          background: `linear-gradient(90deg, ${NSP.accentDeep}, ${NSP.accent}88)`,
          padding: '2% 4%',
          display: 'flex', alignItems: 'center', gap: '2%',
        }}>
          <FitText max={22} min={7} wrap={false}
            style={{
              fontFamily: NSP_FONT_DISPLAY, fontWeight: 800,
              color: 'white', letterSpacing: '0.16em',
            }}>
            ◈ WEATHER CENTER
          </FitText>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '3%', gap: '3%' }}>
          {/* Icon */}
          <div style={{ flex: '0 0 38%', aspectRatio: '1' }}>
            <svg viewBox="0 0 200 200" width="100%" height="100%">
              <CondIcon />
            </svg>
          </div>

          {/* Temp + condition */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ flex: '0 0 58%', minHeight: 0 }}>
              <FitText max={120} min={12} wrap={false}
                style={{
                  fontFamily: NSP_FONT_DISPLAY, fontWeight: 900,
                  color: NSP.glassWhite,
                  letterSpacing: '-0.02em',
                }}>
                {temp}°
              </FitText>
            </div>
            {!compact && (
              <div style={{ flex: '0 0 30%', minHeight: 0 }}>
                <FitText max={48} min={8} wrap={false}
                  style={{
                    fontFamily: NSP_FONT_DISPLAY, fontWeight: 500,
                    color: `rgba(255,255,255,0.55)`,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                  {cond}
                </FitText>
              </div>
            )}
            <div style={{ flex: '0 0 12%', minHeight: 0 }}>
              <FitText max={18} min={6} wrap={false}
                style={{
                  fontFamily: NSP_FONT_DISPLAY, fontWeight: 600,
                  color: NSP.accent, letterSpacing: '0.06em',
                }}>
                {location.toUpperCase()}
              </FitText>
            </div>
          </div>
        </div>

        {/* 5-day forecast strip */}
        {!compact && forecast.length > 0 && (
          <div style={{
            flexShrink: 0,
            borderTop: `1px solid ${NSP.accent}22`,
            display: 'flex',
            padding: '2% 3%',
            gap: '2%',
          }}>
            {forecast.slice(0, 5).map((f: any, i: number) => (
              <div key={i} style={{
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '2% 1%',
                borderRadius: 4,
                background: i === 0 ? `${NSP.accent}15` : 'transparent',
              }}>
                <FitText max={16} min={6} wrap={false}
                  style={{ fontFamily: NSP_FONT_DISPLAY, fontWeight: 700, color: NSP.accent, letterSpacing: '0.08em' }}>
                  {f.day ?? `D${i+1}`}
                </FitText>
                <FitText max={20} min={7} wrap={false}
                  style={{ fontFamily: NSP_FONT_DISPLAY, fontWeight: 800, color: 'white' }}>
                  {f.hi ?? '--'}°
                </FitText>
                <FitText max={14} min={6} wrap={false}
                  style={{ fontFamily: NSP_FONT_DISPLAY, color: 'rgba(255,255,255,0.4)' }}>
                  {f.lo ?? '--'}°
                </FitText>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNTDOWN — breaking-news "T-MINUS" glass banner with blue glow
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProCountdown({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 7 * 86400000);
  const label    = config.label || resolved?.prefix || 'UNTIL GAME DAY';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const mins     = Math.floor((diff % 3600000) / 60000);
  const secs     = Math.floor((diff % 60000) / 1000);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: GLASS_DARK,
        border: `1px solid ${NSP.accent}55`,
        boxShadow: `0 0 0 1px ${NSP.accentDeep}, 0 0 40px ${NSP.accent}22, inset 0 1px 0 rgba(255,255,255,0.06)`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Glow top edge */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${NSP.accent}, transparent)`,
          boxShadow: `0 0 16px ${NSP.accent}`,
        }} />

        {/* T-MINUS header */}
        <div style={{
          flexShrink: 0,
          padding: compact ? '3% 5%' : '2.5% 5%',
          display: 'flex', alignItems: 'center', gap: '2%',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: NSP.hotRed,
            boxShadow: `0 0 8px ${NSP.hotRed}`,
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0, height: compact ? '12%' : '8%', minHeight: 20 }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={32} min={7} wrap={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY, fontWeight: 800,
                color: `rgba(255,255,255,0.6)`,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
              }}
            >
              {label}
            </EditableText>
          </div>
        </div>

        {/* T-MINUS label */}
        <div style={{ padding: '0 5%', flex: '0 0 16%', minHeight: 0 }}>
          <FitText max={28} min={7} wrap={false}
            style={{
              fontFamily: NSP_FONT_DISPLAY, fontWeight: 900,
              color: NSP.accent, letterSpacing: '0.3em',
            }}>
            T — MINUS
          </FitText>
        </div>

        {/* Big numbers */}
        <div style={{ flex: 1, minHeight: 0, padding: '0 4%', display: 'flex', alignItems: 'center', gap: '2%' }}>
          {days > 0 ? (
            <>
              <TimeBlock value={days}  label="DAYS"  />
              <Divider />
              <TimeBlock value={hours} label="HRS"   />
              <Divider />
              <TimeBlock value={mins}  label="MIN"   />
            </>
          ) : (
            <>
              <TimeBlock value={hours} label="HRS"   />
              <Divider />
              <TimeBlock value={mins}  label="MIN"   />
              <Divider />
              <TimeBlock value={secs}  label="SEC"   />
            </>
          )}
        </div>

        {/* Glow bottom edge */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${NSP.accentDeep}, transparent)`,
        }} />
      </div>
    </div>
  );
}

function TimeBlock({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: '1 1 72%', minHeight: 0 }}>
        <FitText max={160} min={12} wrap={false}
          style={{
            fontFamily: NSP_FONT_MONO, fontWeight: 700,
            color: NSP.accent,
            textShadow: `0 0 24px ${NSP.accent}88`,
            letterSpacing: '-0.02em',
          }}>
          {String(value).padStart(2, '0')}
        </FitText>
      </div>
      <div style={{ flex: '0 0 20%', minHeight: 0 }}>
        <FitText max={18} min={6} wrap={false}
          style={{
            fontFamily: NSP_FONT_DISPLAY, fontWeight: 700,
            color: `rgba(255,255,255,0.35)`,
            letterSpacing: '0.18em',
          }}>
          {label}
        </FitText>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', height: '60%' }}>
      <FitText max={60} min={10} wrap={false}
        style={{
          fontFamily: NSP_FONT_MONO, fontWeight: 700,
          color: `${NSP.accent}55`,
        }}>
        :
      </FitText>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT — lower-third chyron
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProAnnouncement({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const category = config.category || config.title || 'BREAKING';
  const message  = config.message  || config.body  || 'Student Council elections open today — cast your vote in homeroom.';
  const subtitle = config.subtitle || config.date  || '';

  return (
    <div className="absolute inset-0 flex items-end" style={{ padding: '2%' }}>
      <div style={{
        width: '100%',
        display: 'flex',
        minHeight: 0,
        height: compact ? '100%' : '55%',
        boxShadow: `0 -2px 24px ${NSP.shadow}`,
      }}>
        {/* Hot-red category block */}
        <div style={{
          flexShrink: 0,
          background: NSP.hotRed,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3%',
          minWidth: '18%',
          position: 'relative',
        }}>
          {/* Clip / chevron on right */}
          <div style={{
            position: 'absolute', right: -14, top: 0, bottom: 0,
            width: 14,
            background: NSP.hotRed,
            clipPath: 'polygon(0 0, 0 100%, 100% 50%)',
          }} />
          <FitText max={36} min={7} wrap={false}
            style={{
              fontFamily: NSP_FONT_DISPLAY, fontWeight: 900,
              color: 'white', letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}>
            {category}
          </FitText>
        </div>

        {/* Dark glass body */}
        <div style={{
          flex: 1, minWidth: 0,
          background: GLASS_DARK,
          borderTop: `2px solid ${NSP.accent}44`,
          padding: '0 3% 0 5%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 58%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={80} min={8} wrap={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY, fontWeight: 800,
                color: NSP.glassWhite,
                letterSpacing: '0.01em',
              }}>
              {message}
            </EditableText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 34%', minHeight: 0 }}>
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={48} min={7} wrap={false}
                style={{
                  fontFamily: NSP_FONT_SERIF, fontStyle: 'italic',
                  color: `rgba(255,255,255,0.5)`,
                }}>
                {subtitle}
              </EditableText>
            </div>
          )}
        </div>

        {/* Gold right accent strip */}
        <div style={{
          flexShrink: 0, width: 4,
          background: `linear-gradient(180deg, ${NSP.gold}, ${NSP.gold}44)`,
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR — "UP NEXT" glass tiles
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (
    config.events?.length ? config.events : [
      { date: 'MON 9:00 AM',  title: 'Homecoming Assembly' },
      { date: 'WED 2:30 PM',  title: 'AP Study Hall — Library' },
      { date: 'FRI 7:00 PM',  title: 'Varsity Football vs. Lincoln' },
    ]
  ).slice(0, Math.max(1, Math.min(10, config.maxEvents ?? 4)));

  return (
    <div className="absolute inset-0 flex flex-col" style={{ padding: '3%', gap: 0 }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        background: `linear-gradient(90deg, ${NSP.accentDeep}, ${NSP.accent}88)`,
        padding: '2% 4%',
        marginBottom: '2%',
      }}>
        <FitText max={22} min={7} wrap={false}
          style={{
            fontFamily: NSP_FONT_DISPLAY, fontWeight: 800,
            color: 'white', letterSpacing: '0.2em',
          }}>
          ▶ UP NEXT
        </FitText>
      </div>

      {/* Event tiles */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '2%' }}>
        {events.map((e: any, i: number) => (
          <div key={i} style={{
            flex: 1, minHeight: 0,
            background: i === 0
              ? `linear-gradient(90deg, ${NSP.accent}22, ${NSP.studioBlack})`
              : `rgba(255,255,255,0.04)`,
            border: `1px solid ${i === 0 ? `${NSP.accent}44` : 'rgba(255,255,255,0.08)'}`,
            display: 'flex', alignItems: 'center',
            padding: '0 3%',
            gap: '3%',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Active indicator */}
            {i === 0 && (
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: 3,
                background: NSP.accent,
                boxShadow: `0 0 8px ${NSP.accent}`,
              }} />
            )}

            {/* Time pill */}
            <div style={{
              flexShrink: 0,
              background: i === 0 ? `${NSP.accent}33` : 'transparent',
              border: `1px solid ${i === 0 ? NSP.accent : 'rgba(255,255,255,0.15)'}`,
              borderRadius: 2,
              padding: '4% 6%',
              minWidth: '22%',
            }}>
              <FitText max={28} min={6} wrap={false} center={false}
                style={{
                  fontFamily: NSP_FONT_MONO, fontWeight: 700,
                  color: i === 0 ? NSP.accent : 'rgba(255,255,255,0.45)',
                  letterSpacing: '0.04em',
                }}>
                {e.date}
              </FitText>
            </div>

            {/* Title */}
            <div style={{ flex: 1, minWidth: 0, height: '65%' }}>
              <FitText max={52} min={8} wrap={false} center={false}
                style={{
                  fontFamily: NSP_FONT_DISPLAY, fontWeight: 700,
                  color: i === 0 ? NSP.glassWhite : 'rgba(255,255,255,0.7)',
                }}>
                {e.title}
              </FitText>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — anchor intro card
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProStaffSpotlight({
  config, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name     = config.staffName || config.name || 'Alex Rivera';
  const role     = config.role || 'Anchor — Morning Edition';
  const quote    = config.bio || config.quote || '"Keeping you informed, every day."';
  const photoUrl = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: GLASS_DARK,
        border: GLASS_PANEL_BORDER,
        boxShadow: `0 4px 32px ${NSP.shadow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Portrait frame */}
        <div style={{
          flexShrink: 0,
          width: '36%',
          background: NSP.studioDark,
          borderRight: `1px solid ${NSP.accent}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8%',
              padding: '10%',
            }}>
              <div style={{
                width: '60%', aspectRatio: '1',
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${NSP.accentDeep}, ${NSP.accent})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 0 24px ${NSP.accent}44`,
              }}>
                <svg viewBox="0 0 60 60" width="70%" height="70%">
                  <circle cx="30" cy="22" r="12" fill="rgba(255,255,255,0.7)" />
                  <path d="M8 52 Q8 36 30 36 Q52 36 52 52" fill="rgba(255,255,255,0.5)" />
                </svg>
              </div>
            </div>
          )}
          {/* Blue glow bottom of portrait */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%',
            background: `linear-gradient(0deg, ${NSP.studioBlack}, transparent)`,
          }} />
        </div>

        {/* Nameplate — glass panel right side */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '5% 6%',
          position: 'relative',
        }}>
          {/* ANCHOR label */}
          <div style={{ flex: '0 0 16%', minHeight: 0 }}>
            <FitText max={18} min={6} wrap={false} center={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY, fontWeight: 800,
                color: NSP.accent, letterSpacing: '0.2em',
              }}>
              ◈ STAFF SPOTLIGHT
            </FitText>
          </div>

          {/* Name */}
          <div style={{ flex: '0 0 30%', minHeight: 0, marginTop: '3%' }}>
            <EditableText
              configKey="staffName" onConfigChange={onConfigChange}
              max={90} min={10} wrap={false} center={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY, fontWeight: 900,
                color: NSP.glassWhite,
                letterSpacing: '-0.01em',
              }}>
              {name}
            </EditableText>
          </div>

          {/* Role */}
          <div style={{ flex: '0 0 18%', minHeight: 0, marginTop: '2%' }}>
            <EditableText
              configKey="role" onConfigChange={onConfigChange}
              max={48} min={7} wrap={false} center={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY, fontWeight: 600,
                color: NSP.gold,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
              {role}
            </EditableText>
          </div>

          {/* Quote */}
          <div style={{ flex: '1 1 30%', minHeight: 0, marginTop: '4%' }}>
            <EditableText
              configKey="bio" onConfigChange={onConfigChange}
              max={60} min={7} center={false}
              style={{
                fontFamily: NSP_FONT_SERIF, fontStyle: 'italic',
                color: `rgba(255,255,255,0.45)`,
              }}>
              {quote}
            </EditableText>
          </div>

          {/* Gold underline accent */}
          <div style={{
            position: 'absolute', bottom: '8%', left: '6%',
            width: '40%', height: 2,
            background: `linear-gradient(90deg, ${NSP.gold}, transparent)`,
          }} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL — widescreen broadcast frame with blue-glow bezel
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 6000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const caption = config.caption || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: NSP.studioDark,
        border: `1px solid ${NSP.accent}55`,
        boxShadow: `0 0 0 1px ${NSP.accentDeep}88, 0 0 40px ${NSP.accent}18, inset 0 0 0 1px rgba(255,255,255,0.04)`,
        overflow: 'hidden',
      }}>
        {/* Broadcast content */}
        {urls.length > 0 ? (
          <img
            src={resolveUrl(urls[idx])}
            alt="Broadcast"
            className="transition-opacity duration-700"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `linear-gradient(135deg, ${NSP.studioDark} 0%, ${NSP.accentDeep}44 100%)`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '4%',
          }}>
            <svg viewBox="0 0 80 56" width="28%" style={{ opacity: 0.3 }}>
              <rect x="0" y="0" width="80" height="56" rx="4" fill="none" stroke={NSP.accent} strokeWidth="2" />
              <circle cx="40" cy="26" r="12" fill={NSP.accent} opacity="0.5" />
              <polygon points="35,20 52,26 35,32" fill="white" />
            </svg>
            <FitText max={28} min={8} wrap={false}
              style={{ fontFamily: NSP_FONT_DISPLAY, fontWeight: 700, color: `rgba(255,255,255,0.3)`, letterSpacing: '0.1em' }}>
              ADD BROADCAST MEDIA
            </FitText>
          </div>
        )}

        {/* Top blue glow bezel */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${NSP.accent}, transparent)`,
          boxShadow: `0 0 12px ${NSP.accent}`,
        }} />

        {/* Corner network bug — top left */}
        <div style={{
          position: 'absolute', top: '4%', left: '3%',
          background: `${NSP.accentDeep}CC`,
          border: `1px solid ${NSP.accent}55`,
          padding: '1% 2.5%',
          backdropFilter: 'blur(4px)',
        }}>
          <FitText max={16} min={6} wrap={false}
            style={{
              fontFamily: NSP_FONT_DISPLAY, fontWeight: 900,
              color: 'white', letterSpacing: '0.1em',
            }}>
            {config.callSign || 'WHS NEWS'}
          </FitText>
        </div>

        {/* Slide indicator dots */}
        {urls.length > 1 && (
          <div style={{
            position: 'absolute', bottom: caption ? '14%' : '4%', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: '1%',
          }}>
            {urls.map((_: string, i: number) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i === idx ? NSP.accent : 'rgba(255,255,255,0.3)',
                boxShadow: i === idx ? `0 0 6px ${NSP.accent}` : 'none',
              }} />
            ))}
          </div>
        )}

        {/* Caption bar */}
        {caption && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: `${GLASS_DARK}`,
            borderTop: `1px solid ${NSP.accent}33`,
            padding: '1.5% 3%',
            height: '12%',
          }}>
            <FitText max={28} min={7} wrap={false} center={false}
              style={{
                fontFamily: NSP_FONT_DISPLAY, fontWeight: 600,
                color: `rgba(255,255,255,0.75)`,
                letterSpacing: '0.02em',
              }}>
              {caption}
            </FitText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKER — scrolling lower-third with hot-red LIVE block
// ═══════════════════════════════════════════════════════════════════════════
export function NewsStudioProTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['◈ Senior panoramic photo rescheduled to Thursday', '◈ Gym closed for maintenance — use east entrance', '◈ Spirit Week kicks off Monday'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 5 : speed === 'slow' ? 12 : 8;

  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (messages.length <= 1) return;
    timerRef.current = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % messages.length);
        setVisible(true);
      }, 400);
    }, secs * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];

  return (
    <div className="absolute inset-0 flex items-end">
      <div style={{
        width: '100%',
        height: compact ? '100%' : '42%',
        display: 'flex',
        boxShadow: `0 -4px 24px ${NSP.shadow}`,
      }}>
        {/* Hot-red LIVE block */}
        <div style={{
          flexShrink: 0,
          background: NSP.hotRed,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3.5%',
          gap: '6px',
          minWidth: '11%',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'white',
            boxShadow: '0 0 6px rgba(255,255,255,0.8)',
            flexShrink: 0,
          }} />
          <FitText max={28} min={7} wrap={false}
            style={{
              fontFamily: NSP_FONT_DISPLAY, fontWeight: 900,
              color: 'white', letterSpacing: '0.16em',
            }}>
            LIVE
          </FitText>
        </div>

        {/* Gold separator */}
        <div style={{ flexShrink: 0, width: 3, background: NSP.gold }} />

        {/* Scrolling glass body */}
        <div style={{
          flex: 1, minWidth: 0,
          background: GLASS_DARK,
          borderTop: `1px solid ${NSP.accent}33`,
          display: 'flex', alignItems: 'center',
          padding: '0 3%',
          overflow: 'hidden',
        }}>
          <div style={{
            width: '100%', height: '65%',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.35s ease',
          }}>
            <FitText max={compact ? 36 : 44} min={8} wrap={false} center={false}
              style={{
                fontFamily: NSP_FONT_SERIF, fontStyle: 'italic', fontWeight: 600,
                color: NSP.glassWhite,
                letterSpacing: '0.01em',
              }}>
              {primary}
            </FitText>
          </div>
        </div>

        {/* Blue right accent */}
        <div style={{ flexShrink: 0, width: 3, background: NSP.accent, boxShadow: `0 0 8px ${NSP.accent}` }} />
      </div>
    </div>
  );
}
