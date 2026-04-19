"use client";

/**
 * Scorebug — middle-school athletics dashboard theme.
 *
 * Inspired by ESPN / sports-app live scoreboards. Dark glass UI, bright
 * score readouts, neon live stats, chyron-style lower thirds.
 * NOT a bulletin board — a data feed.
 *
 * Widgets:
 *   - LOGO            → network-bug ID block
 *   - TEXT            → HOME vs AWAY matchup hero card
 *   - CLOCK           → dark LED digital pill with live analog overlay + LIVE dot
 *   - WEATHER         → mobile-status-bar weather chip (icon + temp + city + wind)
 *   - COUNTDOWN       → neon flip-digit T-MINUS card
 *   - ANNOUNCEMENT    → chyron lower-third (red category + glass body)
 *   - CALENDAR        → LEAGUE STANDINGS table (Team | W-L | Streak)
 *   - STAFF_SPOTLIGHT → ATHLETE OF THE WEEK player card with stat bars
 *   - IMAGE_CAROUSEL  → broadcast preview with REPLAY badge
 *   - TICKER          → thin red LIVE SCORES strip at the top edge
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

// ─── Palette ─────────────────────────────────────────────
export const SB = {
  bg:      '#0B111C',
  bgSoft:  '#111827',
  glass:   'rgba(255,255,255,0.08)',
  glassHi: 'rgba(255,255,255,0.14)',
  border:  'rgba(255,255,255,0.12)',
  accent:  '#1E90FF',
  live:    '#EF4444',
  neon:    '#A3E635',
  gold:    '#FACC15',
  home:    '#3B82F6',
  away:    '#E11D48',
  ink:     '#F1F5F9',
  inkSoft: '#94A3B8',
};

export const SB_FONT_DISPLAY = "'Bebas Neue', 'Oswald', 'Impact', system-ui, sans-serif";
export const SB_FONT_BODY    = "'Inter', system-ui, sans-serif";
export const SB_FONT_MONO    = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

// Thin helper — glass surface panel shared across widgets.
function glassStyle(): React.CSSProperties {
  return {
    background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
    border: `1px solid ${SB.border}`,
    borderRadius: 14,
    boxShadow: '0 12px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
    backdropFilter: 'blur(10px)',
  };
}

// ═══════════════════════════════════════════════════════════
// LOGO — network-bug ID block
// ═══════════════════════════════════════════════════════════
export function ScorebugLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'SB').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 3).join('').toUpperCase()
    || 'SB');
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {/* Accent rule down the left side */}
        <div style={{
          position: 'absolute', left: 0, top: '12%', bottom: '12%', width: 4,
          background: `linear-gradient(180deg, ${SB.accent}, ${SB.live})`,
          borderRadius: 4,
        }} />
        {/* Diagonal highlight sheen */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.06) 50%, transparent 60%)',
          pointerEvents: 'none',
        }} />
        {photoUrl ? (
          <img src={resolveUrl(photoUrl)} alt="logo"
            style={{ maxWidth: '70%', maxHeight: '70%', objectFit: 'contain' }} />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            width: '80%', height: '76%',
          }}>
            <div style={{ flex: '1 1 70%', minHeight: 0, width: '100%' }}>
              <FitText max={240} min={12} wrap={false}
                style={{
                  fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                  color: SB.ink, letterSpacing: '0.04em',
                }}>
                {initials}
              </FitText>
            </div>
            <div style={{ flex: '0 0 24%', minHeight: 0, width: '100%' }}>
              <FitText max={44} min={8} wrap={false}
                style={{
                  fontFamily: SB_FONT_MONO,
                  color: SB.accent, letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                }}>
                ATHLETICS
              </FitText>
            </div>
          </div>
        )}
        {/* Corner cue — tiny LIVE dot */}
        <div style={{
          position: 'absolute', top: 8, right: 8,
          width: 8, height: 8, borderRadius: '50%',
          background: SB.live,
          boxShadow: `0 0 8px ${SB.live}`,
          animation: 'sb-pulse 1.4s ease-in-out infinite',
        }} />
        <style>{`
          @keyframes sb-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        `}</style>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — HOME vs AWAY matchup hero card
// ═══════════════════════════════════════════════════════════
export function ScorebugText({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'EAGLES vs COUGARS';
  const subtitle = config.subtitle || 'HOMECOMING · FRIDAY 7PM · HOME FIELD';

  // Split "HOME vs AWAY" — tolerant of " vs ", " VS ", " @ ", " - "
  const m = /^(.+?)\s*(?:vs|VS|@|-)\s*(.+)$/.exec(content);
  const home = (m?.[1] || 'HOME').trim();
  const away = (m?.[2] || 'AWAY').trim();

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '1.5%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        overflow: 'hidden',
        display: 'flex',
      }}>
        {/* HOME half */}
        <div style={{
          flex: 1, position: 'relative',
          background: `linear-gradient(135deg, ${SB.home} 0%, rgba(59,130,246,0.2) 70%, transparent 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
          padding: '0 3% 0 3%',
        }}>
          <div style={{ width: '100%', height: '62%' }}>
            <FitText max={260} min={12} wrap={false}
              center={false}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.ink, letterSpacing: '0.02em',
                textShadow: `0 4px 16px rgba(0,0,0,0.6)`,
              }}>
              {home}
            </FitText>
          </div>
          {/* HOME tag */}
          <div style={{
            position: 'absolute', top: '8%', left: '3%',
            fontFamily: SB_FONT_MONO, fontSize: 'clamp(8px, 1.2vw, 16px)',
            color: 'rgba(255,255,255,0.7)', letterSpacing: '0.4em',
          }}>HOME</div>
        </div>

        {/* VS center */}
        <div style={{
          flex: '0 0 14%', position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)',
        }}>
          {/* Slanted dividers */}
          <div style={{
            position: 'absolute', left: '-20%', top: 0, bottom: 0, width: '40%',
            background: SB.home,
            clipPath: 'polygon(70% 0, 100% 0, 30% 100%, 0 100%)',
            opacity: 0.8,
          }} />
          <div style={{
            position: 'absolute', right: '-20%', top: 0, bottom: 0, width: '40%',
            background: SB.away,
            clipPath: 'polygon(0 0, 30% 0, 100% 100%, 70% 100%)',
            opacity: 0.8,
          }} />
          <div style={{
            position: 'relative', zIndex: 2, width: '78%', height: '58%',
          }}>
            <FitText max={200} min={14} wrap={false}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.gold, letterSpacing: '0.02em',
                textShadow: '0 0 18px rgba(250,204,21,0.55), 0 4px 0 rgba(0,0,0,0.6)',
              }}>
              VS
            </FitText>
          </div>
        </div>

        {/* AWAY half */}
        <div style={{
          flex: 1, position: 'relative',
          background: `linear-gradient(225deg, ${SB.away} 0%, rgba(225,29,72,0.2) 70%, transparent 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '0 3% 0 3%',
        }}>
          <div style={{ width: '100%', height: '62%' }}>
            <FitText max={260} min={12} wrap={false}
              center={false}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.ink, letterSpacing: '0.02em',
                textShadow: `0 4px 16px rgba(0,0,0,0.6)`,
                textAlign: 'right',
              }}>
              {away}
            </FitText>
          </div>
          {/* AWAY tag */}
          <div style={{
            position: 'absolute', top: '8%', right: '3%',
            fontFamily: SB_FONT_MONO, fontSize: 'clamp(8px, 1.2vw, 16px)',
            color: 'rgba(255,255,255,0.7)', letterSpacing: '0.4em',
          }}>AWAY</div>
        </div>

        {/* Subtitle ribbon at the bottom */}
        {!compact && subtitle && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            height: '18%',
            background: 'rgba(0,0,0,0.55)',
            borderTop: `1px solid ${SB.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3%',
          }}>
            <EditableText
              configKey="subtitle" onConfigChange={onConfigChange}
              max={72} min={8} wrap={false}
              style={{
                fontFamily: SB_FONT_MONO,
                color: SB.neon, letterSpacing: '0.25em',
                textTransform: 'uppercase',
              }}>
              {subtitle}
            </EditableText>
          </div>
        )}
        {/* Hidden editor for content (headline) — tiny pencil icon zone up top */}
        <div style={{
          position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
          width: '20%', height: '12%', pointerEvents: 'auto',
        }}>
          <EditableText
            configKey="content" onConfigChange={onConfigChange}
            max={24} min={6} wrap={false}
            style={{ fontFamily: SB_FONT_MONO, color: 'rgba(255,255,255,0.35)', fontSize: 10, letterSpacing: '0.2em' }}>
            {`edit: ${content}`}
          </EditableText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — dark LED digital pill with LIVE dot + analog overlay
// ═══════════════════════════════════════════════════════════
export function ScorebugClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(now);

  // Live analog hand angles
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const hourAng = (h + m / 60) * 30;
  const minAng  = (m + s / 60) * 6;
  const secAng  = s * 6;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        borderRadius: 9999,
        display: 'flex', alignItems: 'center', padding: '0 4% 0 3%',
        overflow: 'hidden',
      }}>
        {/* LIVE dot */}
        <div style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', gap: '6%',
          marginRight: '4%',
        }}>
          <div style={{
            width: 'clamp(6px, 1.4vw, 14px)',
            height: 'clamp(6px, 1.4vw, 14px)',
            borderRadius: '50%',
            background: SB.live,
            boxShadow: `0 0 10px ${SB.live}`,
            animation: 'sb-pulse 1.2s ease-in-out infinite',
          }} />
        </div>
        {/* Analog mini-clock */}
        {!compact && (
          <div style={{ flex: '0 0 22%', aspectRatio: '1 / 1', height: '74%', marginRight: '4%' }}>
            <svg viewBox="0 0 100 100" width="100%" height="100%">
              <circle cx="50" cy="50" r="46" fill="rgba(0,0,0,0.4)" stroke={SB.accent} strokeWidth="2" />
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i * 30) * Math.PI / 180;
                const x1 = 50 + Math.cos(a - Math.PI / 2) * 40;
                const y1 = 50 + Math.sin(a - Math.PI / 2) * 40;
                const x2 = 50 + Math.cos(a - Math.PI / 2) * 44;
                const y2 = 50 + Math.sin(a - Math.PI / 2) * 44;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SB.inkSoft} strokeWidth="1.4" />;
              })}
              {/* hour */}
              <line x1="50" y1="50"
                x2={50 + Math.cos((hourAng - 90) * Math.PI / 180) * 24}
                y2={50 + Math.sin((hourAng - 90) * Math.PI / 180) * 24}
                stroke={SB.ink} strokeWidth="3.5" strokeLinecap="round" />
              {/* min */}
              <line x1="50" y1="50"
                x2={50 + Math.cos((minAng - 90) * Math.PI / 180) * 34}
                y2={50 + Math.sin((minAng - 90) * Math.PI / 180) * 34}
                stroke={SB.ink} strokeWidth="2.2" strokeLinecap="round" />
              {/* sec */}
              <line x1="50" y1="50"
                x2={50 + Math.cos((secAng - 90) * Math.PI / 180) * 38}
                y2={50 + Math.sin((secAng - 90) * Math.PI / 180) * 38}
                stroke={SB.live} strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="50" cy="50" r="2.2" fill={SB.live} />
            </svg>
          </div>
        )}
        {/* LED digit time */}
        <div style={{ flex: 1, minWidth: 0, height: '70%' }}>
          <FitText max={140} min={12} wrap={false} center={false}
            style={{
              fontFamily: SB_FONT_MONO, fontWeight: 700,
              color: SB.neon, letterSpacing: '0.06em',
              textShadow: `0 0 10px rgba(163,230,53,0.4)`,
            }}>
            {time}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — mobile-status-bar weather chip
// ═══════════════════════════════════════════════════════════
export function ScorebugWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading');
  const wind = weather?.windSpeed ?? config.windMph ?? '--';

  // 6-bucket weather
  const low = (cond || '').toLowerCase();
  const isSnow   = low.includes('snow') || low.includes('flurr');
  const isStorm  = low.includes('storm') || low.includes('thunder');
  const isRain   = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOver   = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear  = !isOver && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  // const isPartly = !isClear && !isOver && !isRain && !isSnow && !isStorm;

  const Icon = () => (
    <svg viewBox="0 0 40 40" width="100%" height="100%">
      {isClear && (
        <g>
          <circle cx="20" cy="20" r="9" fill={SB.gold} />
          <g stroke={SB.gold} strokeWidth="2" strokeLinecap="round">
            <line x1="20" y1="3" x2="20" y2="8" />
            <line x1="20" y1="32" x2="20" y2="37" />
            <line x1="3" y1="20" x2="8" y2="20" />
            <line x1="32" y1="20" x2="37" y2="20" />
          </g>
        </g>
      )}
      {isOver && <ellipse cx="20" cy="22" rx="14" ry="8" fill={SB.inkSoft} />}
      {isRain && (
        <g>
          <ellipse cx="20" cy="16" rx="13" ry="7" fill={SB.inkSoft} />
          <g stroke={SB.accent} strokeWidth="2" strokeLinecap="round">
            <line x1="14" y1="26" x2="12" y2="34" />
            <line x1="22" y1="26" x2="20" y2="34" />
            <line x1="30" y1="26" x2="28" y2="34" />
          </g>
        </g>
      )}
      {isSnow && (
        <g>
          <ellipse cx="20" cy="16" rx="13" ry="7" fill={SB.inkSoft} />
          <g stroke={SB.ink} strokeWidth="1.8" strokeLinecap="round">
            <line x1="14" y1="28" x2="14" y2="34" /><line x1="11" y1="31" x2="17" y2="31" />
            <line x1="22" y1="28" x2="22" y2="34" /><line x1="19" y1="31" x2="25" y2="31" />
            <line x1="30" y1="28" x2="30" y2="34" /><line x1="27" y1="31" x2="33" y2="31" />
          </g>
        </g>
      )}
      {isStorm && (
        <g>
          <ellipse cx="20" cy="16" rx="13" ry="7" fill={SB.inkSoft} />
          <polygon points="18,24 26,24 21,32 28,32 16,40 20,30 14,30" fill={SB.gold} />
        </g>
      )}
      {!isClear && !isOver && !isRain && !isSnow && !isStorm && (
        <g>
          <circle cx="14" cy="16" r="6" fill={SB.gold} />
          <ellipse cx="24" cy="22" rx="10" ry="6" fill={SB.inkSoft} />
        </g>
      )}
    </svg>
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        borderRadius: 9999,
        display: 'flex', alignItems: 'center',
        padding: '0 4%',
        gap: '4%',
      }}>
        {/* Icon pill */}
        <div style={{ flex: '0 0 auto', width: '20%', height: '70%' }}><Icon /></div>
        {/* Temp */}
        <div style={{ flex: '0 0 28%', height: '68%' }}>
          <FitText max={120} min={10} wrap={false} center={false}
            style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 800, color: SB.ink, letterSpacing: '-0.02em' }}>
            {temp}°
          </FitText>
        </div>
        {/* Divider */}
        <div style={{ flex: '0 0 1px', height: '56%', background: SB.border }} />
        {/* City + wind stack */}
        <div style={{ flex: 1, minWidth: 0, height: '70%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4%' }}>
          <div style={{ flex: '1 1 52%', minHeight: 0 }}>
            <FitText max={44} min={8} wrap={false} center={false}
              style={{ fontFamily: SB_FONT_BODY, fontWeight: 700, color: SB.ink, letterSpacing: '0.02em' }}>
              {location}
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 42%', minHeight: 0 }}>
              <FitText max={30} min={7} wrap={false} center={false}
                style={{ fontFamily: SB_FONT_MONO, color: SB.neon, letterSpacing: '0.15em' }}>
                {`WIND ${wind} MPH · ${cond.toUpperCase()}`}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — neon flip-digit T-MINUS card
// ═══════════════════════════════════════════════════════════
export function ScorebugCountdown({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 5 * 86400000);
  const label  = (config.label || resolved?.prefix || 'Homecoming in').toUpperCase();
  const diff   = Math.max(0, target.getTime() - now.getTime());
  const days   = Math.floor(diff / 86400000);
  const hours  = Math.floor((diff % 86400000) / 3600000);
  const mins   = Math.floor((diff % 3600000) / 60000);

  // Pick the headline unit; decompose the rest into a MM:SS style readout.
  const bigNum = days > 0 ? days : hours > 0 ? hours : mins;
  const unit   = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : hours > 0 ? 'HRS' : 'MIN';
  const tail   = days > 0
    ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')}`;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        overflow: 'hidden',
        display: 'flex',
      }}>
        {/* Left — T-MINUS label */}
        <div style={{
          flex: '0 0 30%',
          background: `linear-gradient(135deg, ${SB.live} 0%, rgba(239,68,68,0.2) 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '4%', borderRight: `1px solid ${SB.border}`,
        }}>
          <div style={{ width: '100%', height: '60%' }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={60} min={7} wrap={true}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.ink, letterSpacing: '0.08em',
                textTransform: 'uppercase', lineHeight: 1,
              }}>
              {`T-MINUS ${label}`}
            </EditableText>
          </div>
        </div>
        {/* Right — big neon digit */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'stretch',
          padding: '3% 4%',
        }}>
          <div style={{ flex: '1 1 70%', minHeight: 0, display: 'flex', alignItems: 'center', gap: '3%' }}>
            <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
              <FitText max={260} min={20} wrap={false}
                style={{
                  fontFamily: SB_FONT_MONO, fontWeight: 800,
                  color: SB.neon, letterSpacing: '-0.02em',
                  textShadow: `0 0 18px rgba(163,230,53,0.55), 0 0 2px rgba(163,230,53,0.9)`,
                }}>
                {String(bigNum).padStart(2, '0')}
              </FitText>
            </div>
            <div style={{ flex: '0 0 32%', height: '80%' }}>
              <FitText max={60} min={10} wrap={false}
                style={{
                  fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                  color: SB.gold, letterSpacing: '0.08em',
                }}>
                {unit}
              </FitText>
            </div>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 26%', minHeight: 0, borderTop: `1px solid ${SB.border}`, paddingTop: '2%' }}>
              <FitText max={36} min={7} wrap={false}
                style={{ fontFamily: SB_FONT_MONO, color: SB.inkSoft, letterSpacing: '0.25em' }}>
                {`NEXT SPLIT · ${tail}`}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — chyron lower-third
// ═══════════════════════════════════════════════════════════
export function ScorebugAnnouncement({ config, compact, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const category = (config.title || 'BREAKING').toUpperCase();
  const message  = config.message || config.body || 'Pep rally moved to Friday at 2:30 PM in the gym.';

  return (
    <div className="absolute inset-0 flex items-center" style={{ padding: '2%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        display: 'flex', overflow: 'hidden',
        boxShadow: '0 16px 32px rgba(0,0,0,0.55)',
        border: `1px solid ${SB.border}`,
      }}>
        {/* Red category block */}
        <div style={{
          flex: '0 0 28%',
          background: `linear-gradient(180deg, ${SB.live} 0%, #B91C1C 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          clipPath: 'polygon(0 0, 100% 0, calc(100% - 18px) 100%, 0 100%)',
          padding: '2% 8% 2% 3%',
        }}>
          <div style={{ width: '100%', height: '52%' }}>
            <EditableText
              configKey="title" onConfigChange={onConfigChange}
              max={90} min={9} wrap={false}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.ink, letterSpacing: '0.08em',
              }}>
              {category}
            </EditableText>
          </div>
        </div>
        {/* Glass body */}
        <div style={{
          flex: 1, minWidth: 0,
          background: 'linear-gradient(90deg, rgba(11,17,28,0.96), rgba(17,24,39,0.92))',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center',
          padding: '2% 3% 2% 4%',
          position: 'relative',
        }}>
          {/* Live red dot */}
          <div style={{
            position: 'absolute', top: '18%', right: '2.5%',
            width: 'clamp(6px, 1.2vw, 12px)', height: 'clamp(6px, 1.2vw, 12px)',
            borderRadius: '50%', background: SB.live,
            boxShadow: `0 0 10px ${SB.live}`,
            animation: 'sb-pulse 1.2s ease-in-out infinite',
          }} />
          <div style={{ width: '100%', height: compact ? '100%' : '84%' }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={96} min={9}
              center={false}
              style={{
                fontFamily: SB_FONT_BODY, fontWeight: 500,
                fontStyle: 'italic',
                color: SB.ink, letterSpacing: '0.005em',
              }}>
              {message}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — LEAGUE STANDINGS table
// ═══════════════════════════════════════════════════════════
export function ScorebugCalendar({ config }: { config: any; compact?: boolean }) {
  const standings: { team: string; wl: string; streak: string }[] =
    (Array.isArray(config.standings) && config.standings.length)
      ? config.standings
      : (Array.isArray(config.events) && config.events.length)
        ? config.events.slice(0, 5).map((e: any, i: number) => ({
            team: e.title || `Team ${i + 1}`,
            wl: e.date || `${5 - i}-${i}`,
            streak: i === 0 ? 'W3' : i === 1 ? 'W1' : i === 2 ? 'L1' : 'L2',
          }))
        : [
            { team: 'EAGLES',    wl: '7-1', streak: 'W4' },
            { team: 'COUGARS',   wl: '6-2', streak: 'W2' },
            { team: 'LIONS',     wl: '5-3', streak: 'L1' },
            { team: 'WILDCATS',  wl: '4-4', streak: 'W1' },
            { team: 'PANTHERS',  wl: '2-6', streak: 'L3' },
          ];
  const rows = standings.slice(0, Math.max(1, Math.min(8, config.maxEvents ?? 5)));

  return (
    <div className="absolute inset-0 flex flex-col" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          flex: '0 0 14%', minHeight: 0,
          background: `linear-gradient(90deg, ${SB.accent} 0%, rgba(30,144,255,0.2) 100%)`,
          display: 'flex', alignItems: 'center', padding: '0 4%',
          borderBottom: `1px solid ${SB.border}`,
        }}>
          <div style={{ flex: 1, height: '64%' }}>
            <FitText max={60} min={9} wrap={false} center={false}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.ink, letterSpacing: '0.12em',
              }}>
              LEAGUE STANDINGS
            </FitText>
          </div>
          <div style={{ flex: '0 0 auto', height: '46%', paddingLeft: '2%' }}>
            <FitText max={28} min={7} wrap={false}
              style={{ fontFamily: SB_FONT_MONO, color: SB.neon, letterSpacing: '0.2em' }}>
              LIVE
            </FitText>
          </div>
        </div>
        {/* Column headers */}
        <div style={{
          flex: '0 0 10%', minHeight: 0,
          display: 'flex', alignItems: 'center',
          padding: '0 4%',
          fontFamily: SB_FONT_MONO, color: SB.inkSoft, letterSpacing: '0.2em',
          borderBottom: `1px solid ${SB.border}`,
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ flex: '0 0 10%', fontSize: 'clamp(7px, 1vw, 13px)' }}>#</div>
          <div style={{ flex: 1, fontSize: 'clamp(7px, 1vw, 13px)' }}>TEAM</div>
          <div style={{ flex: '0 0 22%', textAlign: 'center', fontSize: 'clamp(7px, 1vw, 13px)' }}>W-L</div>
          <div style={{ flex: '0 0 22%', textAlign: 'right', fontSize: 'clamp(7px, 1vw, 13px)' }}>STRK</div>
        </div>
        {/* Rows */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => {
            const streakUp = /^W/i.test(r.streak);
            return (
              <div key={i} style={{
                flex: 1, minHeight: 0,
                display: 'flex', alignItems: 'center',
                padding: '0 4%',
                borderBottom: i < rows.length - 1 ? `1px solid rgba(255,255,255,0.06)` : 'none',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                gap: '2%',
              }}>
                <div style={{ flex: '0 0 10%', height: '52%' }}>
                  <FitText max={56} min={9} wrap={false} center={false}
                    style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 800, color: i === 0 ? SB.gold : SB.inkSoft }}>
                    {i + 1}
                  </FitText>
                </div>
                <div style={{ flex: 1, height: '58%', minWidth: 0 }}>
                  <FitText max={56} min={9} wrap={false} center={false}
                    style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 700, color: SB.ink, letterSpacing: '0.03em' }}>
                    {r.team}
                  </FitText>
                </div>
                <div style={{ flex: '0 0 22%', height: '54%' }}>
                  <FitText max={52} min={8} wrap={false}
                    style={{ fontFamily: SB_FONT_MONO, fontWeight: 700, color: SB.ink }}>
                    {r.wl}
                  </FitText>
                </div>
                <div style={{ flex: '0 0 22%', height: '50%' }}>
                  <FitText max={46} min={8} wrap={false}
                    style={{ fontFamily: SB_FONT_MONO, fontWeight: 700, color: streakUp ? SB.neon : SB.live, letterSpacing: '0.1em' }}>
                    {r.streak}
                  </FitText>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — ATHLETE OF THE WEEK player card with stat bars
// ═══════════════════════════════════════════════════════════
export function ScorebugStaffSpotlight({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name  = config.staffName || config.name || 'Jordan Miller';
  const role  = config.role || 'Point Guard · Grade 8';
  const bio   = config.bio || config.quote || 'Season avg: 18.4 PPG, 6 assists, 3 steals.';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  // Three stat bars — harvested from config.stats or a default set.
  const stats: { label: string; value: string; pct: number; color: string }[] =
    Array.isArray(config.stats) && config.stats.length
      ? config.stats.slice(0, 3)
      : [
          { label: 'WINS',       value: '18', pct: 86, color: SB.neon },
          { label: 'PTS / GAME', value: '18.4', pct: 74, color: SB.accent },
          { label: 'STREAK',     value: 'W4', pct: 64, color: SB.gold },
        ];

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header ribbon */}
        <div style={{
          flex: '0 0 12%', minHeight: 0,
          background: `linear-gradient(90deg, ${SB.gold} 0%, rgba(250,204,21,0.15) 100%)`,
          display: 'flex', alignItems: 'center', padding: '0 4%',
          borderBottom: `1px solid ${SB.border}`,
        }}>
          <div style={{ flex: 1, height: '60%' }}>
            <FitText max={56} min={8} wrap={false} center={false}
              style={{
                fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
                color: SB.bg, letterSpacing: '0.14em',
              }}>
              ★ ATHLETE OF THE WEEK
            </FitText>
          </div>
        </div>

        {/* Body: portrait + identity */}
        <div style={{ flex: '0 0 40%', minHeight: 0, display: 'flex', padding: '4% 4% 2%', gap: '4%' }}>
          <div style={{
            flex: '0 0 38%', aspectRatio: '1 / 1',
            borderRadius: 12, overflow: 'hidden',
            background: `linear-gradient(135deg, ${SB.home}, ${SB.away})`,
            border: `2px solid ${SB.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            {photoUrl ? (
              <img src={resolveUrl(photoUrl)} alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ fontSize: 'clamp(28px, 14cqh, 120px)' }}>🏀</div>
            )}
            {/* Number bug */}
            <div style={{
              position: 'absolute', bottom: 4, right: 4,
              background: SB.live, color: SB.ink,
              fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
              padding: '2px 6px', fontSize: 'clamp(8px, 1.6vw, 18px)',
              letterSpacing: '0.05em', borderRadius: 4,
            }}>#23</div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2%' }}>
            <div style={{ flex: '1 1 58%', minHeight: 0 }}>
              <EditableText configKey="staffName" onConfigChange={onConfigChange}
                max={90} min={10} wrap={false} center={false}
                style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 800, color: SB.ink, letterSpacing: '0.02em' }}>
                {name}
              </EditableText>
            </div>
            <div style={{ flex: '0 0 40%', minHeight: 0 }}>
              <EditableText configKey="role" onConfigChange={onConfigChange}
                max={30} min={7} wrap={false} center={false}
                style={{ fontFamily: SB_FONT_MONO, color: SB.accent, letterSpacing: '0.15em' }}>
                {role.toUpperCase()}
              </EditableText>
            </div>
          </div>
        </div>

        {/* Stat bars */}
        <div style={{ flex: 1, minHeight: 0, padding: '0 4% 2%', display: 'flex', flexDirection: 'column', gap: '3%' }}>
          {stats.map((s, i) => (
            <div key={i} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ flex: '0 0 46%', minHeight: 0, display: 'flex', alignItems: 'center', gap: '3%' }}>
                <div style={{ flex: 1, height: '100%' }}>
                  <FitText max={28} min={7} wrap={false} center={false}
                    style={{ fontFamily: SB_FONT_MONO, color: SB.inkSoft, letterSpacing: '0.2em' }}>
                    {s.label}
                  </FitText>
                </div>
                <div style={{ flex: '0 0 26%', height: '100%' }}>
                  <FitText max={48} min={8} wrap={false} center={false}
                    style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 800, color: s.color, textAlign: 'right' }}>
                    {s.value}
                  </FitText>
                </div>
              </div>
              {/* Bar track */}
              <div style={{
                flex: '1 1 54%', minHeight: 6,
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 9999, overflow: 'hidden', position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${Math.max(8, Math.min(100, s.pct))}%`,
                  background: `linear-gradient(90deg, ${s.color} 0%, rgba(255,255,255,0.9) 120%)`,
                  boxShadow: `0 0 10px ${s.color}`,
                  borderRadius: 9999,
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* Bio caption */}
        <div style={{
          flex: '0 0 12%', minHeight: 0,
          borderTop: `1px solid ${SB.border}`,
          background: 'rgba(0,0,0,0.3)',
          padding: '0 4%',
          display: 'flex', alignItems: 'center',
        }}>
          <div style={{ width: '100%', height: '70%' }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={28} min={7} wrap={false} center={false}
              style={{ fontFamily: SB_FONT_BODY, fontStyle: 'italic', color: SB.inkSoft }}>
              {bio}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — broadcast preview with REPLAY badge
// OR in the scorebug preset acts as the "UPCOMING GAMES" feed.
// ═══════════════════════════════════════════════════════════
export function ScorebugImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  // Default "UPCOMING GAMES" feed — 3 card rows when no image set.
  const games: { date: string; opponent: string; venue: string }[] =
    Array.isArray(config.games) && config.games.length
      ? config.games
      : [
          { date: 'FRI 7:00PM', opponent: 'vs EAGLES',  venue: 'HOME · GYM A' },
          { date: 'SAT 2:00PM', opponent: 'vs LIONS',   venue: 'AWAY · LINCOLN' },
          { date: 'TUE 6:30PM', opponent: 'vs WILDCATS',venue: 'HOME · FIELD 2' },
        ];

  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        ...glassStyle(),
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {hasImage ? (
          <>
            <img src={resolveUrl(urls[idx])} alt="Preview"
              className="transition-opacity duration-500"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* REPLAY badge */}
            <div style={{
              position: 'absolute', top: 10, left: 10,
              background: SB.live, color: SB.ink,
              fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
              letterSpacing: '0.2em',
              fontSize: 'clamp(10px, 1.6vw, 20px)',
              padding: '4px 10px',
              borderRadius: 3,
              boxShadow: '0 4px 12px rgba(239,68,68,0.5)',
            }}>
              ▶ REPLAY
            </div>
            {/* 16:9 gradient overlay for legibility */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.6) 100%)',
              pointerEvents: 'none',
            }} />
          </>
        ) : (
          <>
            {/* Header strip */}
            <div style={{
              flex: '0 0 12%', minHeight: 0,
              background: `linear-gradient(90deg, ${SB.live} 0%, rgba(239,68,68,0.2) 100%)`,
              display: 'flex', alignItems: 'center', padding: '0 4%',
              borderBottom: `1px solid ${SB.border}`,
            }}>
              <div style={{ flex: 1, height: '60%' }}>
                <FitText max={46} min={8} wrap={false} center={false}
                  style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 800, color: SB.ink, letterSpacing: '0.12em' }}>
                  UPCOMING GAMES
                </FitText>
              </div>
            </div>
            {/* Game rows */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {games.slice(0, 4).map((g, i) => (
                <div key={i} style={{
                  flex: 1, minHeight: 0,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  padding: '3% 4%', gap: '3%',
                  borderBottom: i < games.length - 1 ? `1px solid rgba(255,255,255,0.06)` : 'none',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  position: 'relative',
                }}>
                  {/* Left accent bar */}
                  <div style={{
                    position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3,
                    background: i === 0 ? SB.neon : SB.accent,
                    boxShadow: i === 0 ? `0 0 8px ${SB.neon}` : 'none',
                  }} />
                  <div style={{ flex: '0 0 38%', minHeight: 0 }}>
                    <FitText max={32} min={7} wrap={false} center={false}
                      style={{ fontFamily: SB_FONT_MONO, color: i === 0 ? SB.neon : SB.inkSoft, letterSpacing: '0.16em' }}>
                      {g.date}
                    </FitText>
                  </div>
                  <div style={{ flex: '0 0 38%', minHeight: 0 }}>
                    <FitText max={56} min={9} wrap={false} center={false}
                      style={{ fontFamily: SB_FONT_DISPLAY, fontWeight: 800, color: SB.ink, letterSpacing: '0.04em' }}>
                      {g.opponent}
                    </FitText>
                  </div>
                  <div style={{ flex: '0 0 24%', minHeight: 0 }}>
                    <FitText max={26} min={7} wrap={false} center={false}
                      style={{ fontFamily: SB_FONT_BODY, color: SB.inkSoft, letterSpacing: '0.12em' }}>
                      {g.venue}
                    </FitText>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — thin red LIVE SCORES strip
// ═══════════════════════════════════════════════════════════
export function ScorebugTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = (((config.messages as string[]) || [])
    .map((s) => (s || '').trim()).filter(Boolean).length)
      ? (config.messages as string[]).map((s) => s.trim()).filter(Boolean)
      : ['LIVE: Varsity basketball 62-58 Q4', 'Next home game: Fri 7PM vs Central', 'Swim meet results posted'];

  const speed = (config.speed as string) || 'fast';
  const secs = speed === 'fast' ? 18 : speed === 'slow' ? 40 : 26;

  // One long loop of the joined messages — classic sports-channel crawl.
  const reel = messages.join('   ◆   ');

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden', background: SB.live }}>
      {/* LIVE bug on the left */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 'clamp(60px, 8vw, 140px)',
        background: SB.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, zIndex: 2,
        borderRight: `2px solid ${SB.live}`,
        clipPath: 'polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
        padding: '0 4%',
      }}>
        <div style={{
          width: 'clamp(6px, 1.2vw, 10px)', height: 'clamp(6px, 1.2vw, 10px)',
          borderRadius: '50%', background: SB.live,
          boxShadow: `0 0 8px ${SB.live}`,
          animation: 'sb-pulse 1.2s ease-in-out infinite',
        }} />
        <div style={{
          fontFamily: SB_FONT_DISPLAY, fontWeight: 800,
          color: SB.ink, letterSpacing: '0.15em',
          fontSize: compact ? '0.9em' : '1.2em',
        }}>
          LIVE
        </div>
      </div>

      {/* Scrolling reel */}
      <div style={{
        position: 'absolute', left: 'clamp(60px, 8vw, 140px)', right: 0, top: 0, bottom: 0,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{
          whiteSpace: 'nowrap',
          fontFamily: SB_FONT_DISPLAY, fontWeight: 700,
          color: SB.ink, letterSpacing: '0.08em',
          fontSize: compact ? '0.9em' : '1.25em',
          paddingLeft: '100%',
          animation: `sb-ticker-scroll ${secs}s linear infinite`,
        }}>
          {reel}   ◆   {reel}
        </div>
      </div>

      <style>{`
        @keyframes sb-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes sb-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
      `}</style>
    </div>
  );
}
