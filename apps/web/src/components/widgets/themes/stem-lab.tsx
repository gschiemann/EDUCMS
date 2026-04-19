"use client";

/**
 * STEM Lab — middle school science lobby theme.
 *
 * Modern science lab aesthetic: glowing circuit traces, periodic-table tiles,
 * beakers, rocket countdowns, graph paper grid, tech HUD accents, neon glow.
 *
 *   LOGO            → circuit-board hexagon badge with atomic orbit rings
 *   TEXT/RICH_TEXT  → PCB title card with glowing traces + monospace subtitle
 *   CLOCK           → digital LED display in circuit-board frame with blinking LEDs + analog hands
 *   WEATHER         → periodic-table tile card (element symbol = weather condition)
 *   COUNTDOWN       → rocket-launch countdown with glowing thruster flame
 *   ANNOUNCEMENT    → terminal window with $ prompt + traffic-light dots
 *   CALENDAR        → stacked test-tube events with colored liquid levels
 *   STAFF_SPOTLIGHT → holographic HUD ID card with hex portrait frame
 *   IMAGE_CAROUSEL  → microscope-lens viewport with caliper tick marks
 *   TICKER          → oscilloscope waveform with message riding the signal
 */

import { useEffect, useRef, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { resolveCountdownTarget } from '../countdown-utils';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ─── Palette ────────────────────────────────────────────────────────────────
export const SL = {
  navy:       '#0A192F',
  deepSpace:  '#020C1B',
  grid:       '#112240',
  neonGreen:  '#64FFDA',
  neonBlue:   '#61DAFB',
  neonPurple: '#A78BFA',
  amber:      '#FBBF24',
  red:        '#F87171',
  paper:      '#E6F1FF',
  ink:        '#0A192F',
  inkOnDark:  '#CCD6F6',
  shadow:     'rgba(0,0,0,0.5)',
};

export const SL_FONT_DISPLAY = "'Space Grotesk', 'Inter', system-ui, sans-serif";
export const SL_FONT_MONO    = "'JetBrains Mono', 'Fira Code', monospace";
export const SL_FONT_BODY    = "'Fredoka', system-ui, sans-serif";

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';
function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// Neon glow filter helper
function neonFilter(color: string, intensity = 8) {
  return `drop-shadow(0 0 ${intensity}px ${color}) drop-shadow(0 0 ${intensity * 2}px ${color})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGO — circuit-board hexagon badge with atomic orbit rings
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'STEM').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'SL');
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: neonFilter(SL.neonGreen, 6), overflow: 'visible' }}>
        {/* Outer hexagon badge */}
        <polygon
          points="130,14 224,66 224,170 130,222 36,170 36,66"
          fill={SL.grid} stroke={SL.neonGreen} strokeWidth="3" />
        {/* Atomic orbit rings */}
        <ellipse cx="130" cy="118" rx="88" ry="30" fill="none" stroke={SL.neonBlue} strokeWidth="1.5" opacity="0.7" transform="rotate(-30 130 118)" />
        <ellipse cx="130" cy="118" rx="88" ry="30" fill="none" stroke={SL.neonPurple} strokeWidth="1.5" opacity="0.7" transform="rotate(30 130 118)" />
        <ellipse cx="130" cy="118" rx="88" ry="30" fill="none" stroke={SL.neonGreen} strokeWidth="1.5" opacity="0.7" transform="rotate(90 130 118)" />
        {/* Nucleus */}
        <circle cx="130" cy="118" r="8" fill={SL.amber} />
        {/* Circuit-trace pads on hex corners */}
        {[[130,14],[224,66],[224,170],[130,222],[36,170],[36,66]].map(([x,y],i) => (
          <circle key={i} cx={x} cy={y} r="5" fill={SL.neonGreen} />
        ))}
        {/* Circuit trace lines from center */}
        {[[130,14],[224,66],[224,170],[130,222],[36,170],[36,66]].map(([x,y],i) => (
          <line key={i} x1="130" y1="118" x2={x} y2={y} stroke={SL.neonGreen} strokeWidth="0.8" opacity="0.3" />
        ))}
        {/* Inner content circle */}
        <circle cx="130" cy="118" r="46" fill={SL.deepSpace} stroke={SL.neonBlue} strokeWidth="2" />
        {/* Initials or photo */}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="84" y="72" width="92" height="92"
            preserveAspectRatio="xMidYMid slice" clipPath="circle(46px at 130px 118px)" />
        ) : (
          <text x="130" y="128" textAnchor="middle" dominantBaseline="middle"
            fill={SL.neonGreen} fontFamily={SL_FONT_DISPLAY} fontWeight="700" fontSize="32">
            {initials}
          </text>
        )}
        {/* Bottom label strip */}
        <rect x="60" y="210" width="140" height="26" rx="4" fill={SL.deepSpace} stroke={SL.neonGreen} strokeWidth="1.5" />
        <text x="130" y="227" textAnchor="middle" dominantBaseline="middle"
          fill={SL.neonGreen} fontFamily={SL_FONT_MONO} fontSize="9" letterSpacing="2">
          STEM · LAB
        </text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT — PCB title card with glowing circuit traces + monospace subtitle
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabText({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'WELCOME TO STEM LAB';
  const subtitle = config.subtitle || '// where curiosity becomes discovery';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* PCB card background */}
        <svg viewBox="0 0 1800 340" width="100%" height="100%" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, filter: neonFilter(SL.neonGreen, 4) }}>
          {/* Board */}
          <rect x="0" y="0" width="1800" height="340" rx="12" fill={SL.grid} stroke={SL.neonGreen} strokeWidth="3" />
          {/* Top trace line */}
          <path d="M40 30 H400 V10 H800 V30 H1400 V10 H1760" stroke={SL.neonGreen} strokeWidth="2" fill="none" opacity="0.5" />
          {/* Bottom trace line */}
          <path d="M40 310 H300 V330 H900 V310 H1500 V330 H1760" stroke={SL.neonBlue} strokeWidth="2" fill="none" opacity="0.5" />
          {/* Solder pads */}
          {[60,160,260,360].map(x => <circle key={x} cx={x} cy={20} r="6" fill={SL.neonGreen} opacity="0.6" />)}
          {[1440,1540,1640,1740].map(x => <circle key={x} cx={x} cy={20} r="6" fill={SL.neonGreen} opacity="0.6" />)}
          {/* Left connector block */}
          <rect x="8" y="90" width="24" height="160" rx="4" fill={SL.deepSpace} stroke={SL.neonBlue} strokeWidth="2" />
          {[110,140,170,200,210,220].map((y,i) => (
            <rect key={i} x="8" y={y} width="24" height="8" rx="2" fill={SL.neonBlue} opacity="0.6" />
          ))}
          {/* Right connector block */}
          <rect x="1768" y="90" width="24" height="160" rx="4" fill={SL.deepSpace} stroke={SL.neonPurple} strokeWidth="2" />
          {[110,140,170,200,210,220].map((y,i) => (
            <rect key={i} x="1768" y={y} width="24" height="8" rx="2" fill={SL.neonPurple} opacity="0.6" />
          ))}
        </svg>
        {/* Text overlay */}
        <div style={{
          position: 'absolute',
          top: '8%', left: '4%', right: '4%', bottom: '8%',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 62%' : '0 0 100%', minHeight: 0 }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={160} min={12} wrap={false}
              style={{
                fontFamily: SL_FONT_DISPLAY, fontWeight: 700,
                color: SL.neonGreen,
                textShadow: `0 0 20px ${SL.neonGreen}, 0 0 40px ${SL.neonGreen}`,
                letterSpacing: '0.04em',
              }}
            >
              {content}
            </EditableText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 38%', minHeight: 0 }}>
              <EditableText
                configKey="subtitle" onConfigChange={onConfigChange}
                max={100} min={9} wrap={false}
                style={{
                  fontFamily: SL_FONT_MONO,
                  color: SL.neonBlue,
                  opacity: 0.85,
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

// ═══════════════════════════════════════════════════════════════════════════
// CLOCK — digital LED display in circuit-board frame + live analog hands
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); setBlink(b => !b); }, 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined;
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  const time = fmt.format(now);
  const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const dateStr = dateFmt.format(now).toUpperCase();

  // Analog hand angles
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const secAngle  = s * 6 - 90;
  const minAngle  = m * 6 + s * 0.1 - 90;
  const hourAngle = h * 30 + m * 0.5 - 90;
  const handX = (angle: number, r: number) => 130 + r * Math.cos(angle * Math.PI / 180);
  const handY = (angle: number, r: number) => 130 + r * Math.sin(angle * Math.PI / 180);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 560" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: neonFilter(SL.neonBlue, 4) }}>
          {/* Outer PCB frame */}
          <rect x="10" y="10" width="680" height="540" rx="16" fill={SL.grid} stroke={SL.neonBlue} strokeWidth="3" />
          {/* Horizontal trace lines */}
          <path d="M10 80 H690" stroke={SL.neonBlue} strokeWidth="1" opacity="0.3" />
          <path d="M10 480 H690" stroke={SL.neonGreen} strokeWidth="1" opacity="0.3" />
          {/* Status LED dots */}
          {[0,1,2,3,4].map(i => (
            <circle key={i} cx={30 + i * 22} cy={46} r="6"
              fill={i === 0 ? SL.neonGreen : i === 1 ? SL.amber : SL.grid}
              stroke={SL.neonGreen} strokeWidth="1.5"
              opacity={blink && i === 2 ? 1 : 0.4} />
          ))}
          {/* "CLOCK" label chip */}
          <rect x="580" y="34" width="100" height="24" rx="4" fill={SL.deepSpace} stroke={SL.neonBlue} strokeWidth="1.5" />
          <text x="630" y="50" textAnchor="middle" fill={SL.neonBlue} fontFamily={SL_FONT_MONO} fontSize="10" letterSpacing="1">CLOCK</text>
          {/* Digital display area */}
          <rect x="30" y="96" width="400" height="130" rx="8" fill={SL.deepSpace} stroke={SL.neonGreen} strokeWidth="2" />
          {/* Analog clock face */}
          <circle cx="560" cy="290" r="110" fill={SL.deepSpace} stroke={SL.neonPurple} strokeWidth="2.5" />
          {/* Clock tick marks */}
          {Array.from({length: 12}).map((_,i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            const x1 = 560 + 96 * Math.cos(a); const y1 = 290 + 96 * Math.sin(a);
            const x2 = 560 + 106 * Math.cos(a); const y2 = 290 + 106 * Math.sin(a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SL.neonPurple} strokeWidth="2.5" />;
          })}
          {/* Hour hand */}
          <line x1="560" y1="290" x2={560 + 60 * Math.cos(hourAngle * Math.PI / 180)} y2={290 + 60 * Math.sin(hourAngle * Math.PI / 180)}
            stroke={SL.inkOnDark} strokeWidth="5" strokeLinecap="round" />
          {/* Minute hand */}
          <line x1="560" y1="290" x2={560 + 85 * Math.cos(minAngle * Math.PI / 180)} y2={290 + 85 * Math.sin(minAngle * Math.PI / 180)}
            stroke={SL.neonBlue} strokeWidth="3.5" strokeLinecap="round" />
          {/* Second hand */}
          <line x1="560" y1="290" x2={560 + 98 * Math.cos(secAngle * Math.PI / 180)} y2={290 + 98 * Math.sin(secAngle * Math.PI / 180)}
            stroke={SL.neonGreen} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="560" cy="290" r="5" fill={SL.neonGreen} />
          {/* Date bar */}
          <rect x="30" y="450" width="640" height="58" rx="8" fill={SL.deepSpace} stroke={SL.neonBlue} strokeWidth="1.5" />
          <text x="350" y="484" textAnchor="middle" dominantBaseline="middle"
            fill={SL.neonBlue} fontFamily={SL_FONT_MONO} fontSize="18" letterSpacing="4">
            {dateStr}
          </text>
          {/* Corner pads */}
          {[[10,10],[690,10],[10,550],[690,550]].map(([cx,cy],i) => (
            <circle key={i} cx={cx} cy={cy} r="7" fill={SL.neonGreen} opacity="0.5" />
          ))}
        </svg>
        {/* Digital time text overlaid on display area.
            Display rect: x30-430, y96-226 of viewBox 700x560.
            As % of zone: left≈4.3%, right≈38.6%, top≈17.1%, bottom≈59.6% */}
        <div style={{
          position: 'absolute',
          left: '4.5%', right: '38.5%', top: '17%', bottom: '59%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FitText max={120} min={10} wrap={false}
            style={{
              fontFamily: SL_FONT_MONO, fontWeight: 700,
              color: SL.neonGreen,
              textShadow: `0 0 16px ${SL.neonGreen}, 0 0 32px ${SL.neonGreen}`,
              letterSpacing: '0.06em',
            }}>
            {time}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER — periodic-table tile card with element-symbol condition
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  // Map condition to periodic-table element symbol
  const low = (cond || '').toLowerCase();
  const isSnow   = low.includes('snow') || low.includes('flurr');
  const isStorm  = low.includes('storm') || low.includes('thunder');
  const isRain   = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear  = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));

  type CondInfo = { symbol: string; name: string; num: string; color: string };
  const condInfo: CondInfo = isSnow
    ? { symbol: 'H₂O', name: cond, num: '18', color: SL.neonBlue }
    : isStorm
    ? { symbol: 'e⁻',  name: cond, num: '29', color: SL.amber }
    : isRain
    ? { symbol: 'H₂O', name: cond, num: '18', color: SL.neonBlue }
    : isOvercast
    ? { symbol: 'O₃',  name: cond, num: '8',  color: SL.inkOnDark }
    : isClear
    ? { symbol: 'O₂',  name: cond, num: '8',  color: SL.amber }
    : { symbol: 'Ar',  name: cond, num: '18', color: SL.neonPurple };

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{
        width: '100%', height: '100%',
        background: SL.deepSpace,
        border: `3px solid ${condInfo.color}`,
        borderRadius: 12,
        boxShadow: `0 0 24px ${condInfo.color}44, inset 0 0 40px ${SL.grid}`,
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Atomic number top-left */}
        <div style={{
          position: 'absolute', top: '4%', left: '6%',
          fontFamily: SL_FONT_MONO, fontSize: 'clamp(10px, 3cqh, 24px)',
          color: condInfo.color, opacity: 0.8,
        }}>{condInfo.num}</div>
        {/* Element symbol — dominant visual */}
        <div style={{ flex: '0 0 52%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FitText max={140} min={20} wrap={false}
            style={{
              fontFamily: SL_FONT_MONO, fontWeight: 700,
              color: condInfo.color,
              textShadow: `0 0 20px ${condInfo.color}`,
            }}>
            {condInfo.symbol}
          </FitText>
        </div>
        {/* Condition name */}
        <div style={{ flex: '0 0 18%', minHeight: 0 }}>
          <FitText max={56} min={8} wrap={false}
            style={{ fontFamily: SL_FONT_MONO, color: SL.inkOnDark, opacity: 0.8 }}>
            {cond}
          </FitText>
        </div>
        {/* Bottom border — element mass line */}
        <div style={{
          height: '1px', background: condInfo.color, opacity: 0.4, margin: '0 8%',
        }} />
        {/* Temperature */}
        <div style={{ flex: '1 1 30%', minHeight: 0, paddingBottom: '3%' }}>
          <FitText max={90} min={12} wrap={false}
            style={{
              fontFamily: SL_FONT_DISPLAY, fontWeight: 700,
              color: SL.inkOnDark,
            }}>
            {temp}°
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNTDOWN — rocket-launch countdown with glowing thruster flame
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabCountdown({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 10 * 86400000);
  const label    = (config.label || resolved?.prefix || 'DAYS TO LAUNCH').toUpperCase();
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const mins     = Math.floor((diff % 3600000) / 60000);
  const secs     = Math.floor((diff % 60000) / 1000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? (days === 1 ? 'DAY TO LAUNCH' : 'DAYS TO LAUNCH') : `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  const flicker  = (now.getSeconds() % 2 === 0);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 600 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: neonFilter(SL.amber, 6) }}>
          {/* Rocket body */}
          <path d="M300 40 C300 40 240 100 230 240 L230 480 L370 480 L370 240 C360 100 300 40 300 40Z"
            fill={SL.grid} stroke={SL.neonBlue} strokeWidth="3" />
          {/* Nose cone */}
          <path d="M300 40 C280 70 260 130 250 220 L350 220 C340 130 320 70 300 40Z"
            fill={SL.deepSpace} stroke={SL.neonGreen} strokeWidth="2" />
          {/* Window */}
          <circle cx="300" cy="280" r="36" fill={SL.deepSpace} stroke={SL.neonGreen} strokeWidth="3" />
          <circle cx="300" cy="280" r="24" fill={SL.navy} stroke={SL.neonBlue} strokeWidth="2" />
          <circle cx="292" cy="272" r="6" fill={SL.neonBlue} opacity="0.6" />
          {/* Fins */}
          <path d="M230 400 L170 490 L230 470Z" fill={SL.grid} stroke={SL.neonPurple} strokeWidth="2" />
          <path d="M370 400 L430 490 L370 470Z" fill={SL.grid} stroke={SL.neonPurple} strokeWidth="2" />
          {/* Thruster bell */}
          <path d="M250 480 L210 540 L390 540 L350 480Z" fill={SL.deepSpace} stroke={SL.neonBlue} strokeWidth="2" />
          {/* Flame outer */}
          <path d="M210 540 Q240 640 300 680 Q360 640 390 540Z"
            fill={`rgba(251,191,36,${flicker ? 0.9 : 0.7})`}
            style={{ filter: `drop-shadow(0 0 16px ${SL.amber})` }} />
          {/* Flame inner */}
          <path d="M240 545 Q268 620 300 650 Q332 620 360 545Z"
            fill={`rgba(248,113,113,${flicker ? 1 : 0.85})`} />
          {/* Flame core */}
          <path d="M268 550 Q282 600 300 625 Q318 600 332 550Z"
            fill="white" opacity={flicker ? 0.9 : 0.6} />
          {/* Grid lines on body */}
          {[320,360,400,440].map(y => (
            <line key={y} x1="232" y1={y} x2="368" y2={y} stroke={SL.neonBlue} strokeWidth="0.8" opacity="0.3" />
          ))}
        </svg>
        {/* Text overlay — number sits in window region of rocket
            Window center: x≈300, y≈280 of viewBox 600x700 = 50%, 40%
            Use the left half for a wide number display */}
        <div style={{
          position: 'absolute',
          left: '6%', right: '6%', top: '4%', bottom: '44%',
          display: 'flex', flexDirection: 'column',
          textAlign: 'center',
        }}>
          <div style={{ flex: '0 0 28%', minHeight: 0 }}>
            <EditableText
              configKey="label" onConfigChange={onConfigChange}
              max={60} min={8} wrap={false}
              style={{
                fontFamily: SL_FONT_MONO, fontWeight: 700,
                color: SL.neonGreen,
                textShadow: `0 0 12px ${SL.neonGreen}`,
                letterSpacing: '0.08em',
              }}
            >
              {label}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 72%', minHeight: 0 }}>
            <FitText max={280} min={24} wrap={false}
              style={{
                fontFamily: SL_FONT_DISPLAY, fontWeight: 800,
                color: SL.amber,
                textShadow: `0 0 24px ${SL.amber}, 0 0 48px ${SL.amber}`,
              }}>
              {bigNum}
            </FitText>
          </div>
        </div>
        {!compact && (
          <div style={{
            position: 'absolute',
            left: '6%', right: '6%', bottom: '2%',
            height: '10%',
          }}>
            <FitText max={48} min={8} wrap={false}
              style={{ fontFamily: SL_FONT_MONO, color: SL.inkOnDark, opacity: 0.7 }}>
              {unit}
            </FitText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT — terminal window with $ prompt + traffic-light dots
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabAnnouncement({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const title   = config.title   || 'system.announce';
  const message = config.message || config.body || 'Science fair signups open NOW. See Mr. Okafor in Rm 204.';
  const [cursor, setCursor] = useState(true);
  useEffect(() => { const t = setInterval(() => setCursor(c => !c), 600); return () => clearInterval(t); }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        width: '100%', height: '100%',
        background: SL.deepSpace,
        border: `2px solid ${SL.neonGreen}`,
        borderRadius: 12,
        boxShadow: `0 0 20px ${SL.neonGreen}33`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Title bar */}
        <div style={{
          height: '18%', minHeight: 24,
          background: SL.grid,
          borderBottom: `1px solid ${SL.neonGreen}44`,
          display: 'flex', alignItems: 'center',
          padding: '0 3%', gap: '1.5%', flexShrink: 0,
        }}>
          {/* Traffic-light dots */}
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: SL.red, flexShrink: 0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: SL.amber, flexShrink: 0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: SL.neonGreen, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, paddingLeft: '3%' }}>
            <EditableText configKey="title" onConfigChange={onConfigChange} max={28} min={8} wrap={false} center={false}
              style={{ fontFamily: SL_FONT_MONO, color: SL.inkOnDark, opacity: 0.7 }}>{title}</EditableText>
          </div>
        </div>
        {/* Terminal body */}
        <div style={{
          flex: 1, minHeight: 0,
          padding: '3% 4%',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
        }}>
          {/* Prompt line */}
          <div style={{ flex: '0 0 28%', minHeight: 0, display: 'flex', alignItems: 'center', gap: '2%' }}>
            <span style={{
              fontFamily: SL_FONT_MONO, color: SL.neonGreen,
              fontSize: 'clamp(10px,3cqh,28px)', flexShrink: 0,
            }}>$</span>
            <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
              <FitText max={32} min={8} wrap={false} center={false}
                style={{ fontFamily: SL_FONT_MONO, color: SL.neonGreen, opacity: 0.8 }}>
                ./announce.sh
              </FitText>
            </div>
          </div>
          {/* Message */}
          <div style={{ flex: 1, minHeight: 0, marginTop: '2%' }}>
            <EditableText
              configKey="message" onConfigChange={onConfigChange}
              max={200} min={10}
              center={false}
              style={{
                fontFamily: SL_FONT_MONO, fontWeight: 600,
                color: SL.inkOnDark,
                lineHeight: 1.45,
              }}
            >
              {message}
            </EditableText>
          </div>
          {/* Blinking cursor */}
          {!compact && (
            <div style={{
              flex: '0 0 16%', minHeight: 0,
              display: 'flex', alignItems: 'center',
            }}>
              <span style={{
                fontFamily: SL_FONT_MONO,
                color: SL.neonGreen,
                fontSize: 'clamp(10px,3cqh,24px)',
                opacity: cursor ? 1 : 0,
                transition: 'opacity 0.1s',
              }}>█</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR — stacked test-tube events with colored liquid levels
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'APR 22', title: 'Chemistry Lab — Acids & Bases' },
    { date: 'APR 24', title: 'Robotics Club Meeting' },
    { date: 'APR 28', title: 'Science Fair Judging' },
  ]).slice(0, Math.max(1, Math.min(6, config.maxEvents ?? 4)));

  const tubeColors = [SL.neonGreen, SL.neonBlue, SL.neonPurple, SL.amber, SL.red, SL.neonGreen];
  const fillPcts   = [75, 55, 85, 60, 70, 45];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '3%', gap: '2%' }}>
      {events.map((e: any, i: number) => {
        const color = tubeColors[i % tubeColors.length];
        const fill  = fillPcts[i % fillPcts.length];
        return (
          <div key={i} style={{
            flex: 1, minHeight: 0,
            display: 'flex', alignItems: 'center', gap: '3%',
          }}>
            {/* Test tube SVG */}
            <svg viewBox="0 0 50 120" style={{ height: '90%', width: 'auto', flexShrink: 0, filter: `drop-shadow(0 0 6px ${color})` }}>
              {/* Tube body */}
              <rect x="10" y="10" width="30" height="90" rx="15" fill={SL.deepSpace} stroke={color} strokeWidth="2.5" />
              {/* Liquid */}
              <clipPath id={`tube-clip-${i}`}>
                <rect x="10" y={10 + 90 * (1 - fill/100)} width="30" height={90 * fill/100 + 15} />
              </clipPath>
              <rect x="10" y="10" width="30" height="90" rx="15"
                fill={color} opacity="0.6" clipPath={`url(#tube-clip-${i})`} />
              {/* Bubbles */}
              <circle cx="22" cy={10 + 90 * (1 - fill/100) + 8} r="3" fill={color} opacity="0.4" />
              <circle cx="32" cy={10 + 90 * (1 - fill/100) + 18} r="2" fill={color} opacity="0.3" />
              {/* Tube top rim */}
              <rect x="8" y="8" width="34" height="8" rx="4" fill={SL.grid} stroke={color} strokeWidth="2" />
              {/* Date label at bottom */}
              <text x="25" y="115" textAnchor="middle" fill={color}
                fontFamily={SL_FONT_MONO} fontSize="7" letterSpacing="0.5">
                {(e.date || '').toUpperCase().slice(0,6)}
              </text>
            </svg>
            {/* Event text */}
            <div style={{ flex: 1, minWidth: 0, height: '90%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ flex: '0 0 38%', minHeight: 0 }}>
                <FitText max={200} min={7} wrap={false} center={false}
                  style={{ fontFamily: SL_FONT_MONO, color, opacity: 0.9 }}>
                  {e.date}
                </FitText>
              </div>
              <div style={{ flex: '1 1 62%', minHeight: 0 }}>
                <FitText max={280} min={9} wrap={false} center={false}
                  style={{ fontFamily: SL_FONT_DISPLAY, fontWeight: 600, color: SL.inkOnDark }}>
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

// ═══════════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — holographic HUD ID card with hex portrait frame
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabStaffSpotlight({
  config, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name    = config.staffName || config.name  || 'Dr. Chen';
  const role    = config.role      || 'Lead Scientist';
  const bio     = config.bio       || config.quote || 'Every question is an experiment waiting to happen.';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{
        width: '100%', height: '100%',
        background: `linear-gradient(135deg, ${SL.deepSpace} 0%, ${SL.grid} 100%)`,
        border: `2px solid ${SL.neonPurple}`,
        borderRadius: 16,
        boxShadow: `0 0 32px ${SL.neonPurple}44, inset 0 0 60px ${SL.deepSpace}`,
        display: 'flex', gap: '4%', alignItems: 'center',
        padding: '4%', overflow: 'hidden', position: 'relative',
      }}>
        {/* HUD scan lines overlay */}
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
          preserveAspectRatio="none" viewBox="0 0 400 300">
          {Array.from({length: 12}).map((_,i) => (
            <line key={i} x1="0" y1={i * 28} x2="400" y2={i * 28}
              stroke={SL.neonPurple} strokeWidth="0.4" opacity="0.12" />
          ))}
          {/* Corner HUD brackets */}
          <path d="M10 10 H40 M10 10 V40" stroke={SL.neonPurple} strokeWidth="2" fill="none" />
          <path d="M390 10 H360 M390 10 V40" stroke={SL.neonPurple} strokeWidth="2" fill="none" />
          <path d="M10 290 H40 M10 290 V260" stroke={SL.neonPurple} strokeWidth="2" fill="none" />
          <path d="M390 290 H360 M390 290 V260" stroke={SL.neonPurple} strokeWidth="2" fill="none" />
          {/* ID label */}
          <text x="200" y="16" textAnchor="middle" fill={SL.neonPurple} fontFamily={SL_FONT_MONO} fontSize="8" letterSpacing="2" opacity="0.7">
            STAFF · ID · VERIFIED
          </text>
        </svg>
        {/* Hex portrait frame */}
        <div style={{ flexShrink: 0, width: '36%', position: 'relative', zIndex: 1 }}>
          <svg viewBox="0 0 200 230" width="100%" style={{ filter: `drop-shadow(0 0 12px ${SL.neonPurple})` }}>
            <defs>
              <clipPath id="hex-clip">
                <polygon points="100,10 180,55 180,145 100,190 20,145 20,55" />
              </clipPath>
            </defs>
            {/* Hex border glow */}
            <polygon points="100,10 180,55 180,145 100,190 20,145 20,55"
              fill="none" stroke={SL.neonPurple} strokeWidth="4" />
            {/* Photo or placeholder */}
            {photoUrl ? (
              <image href={resolveUrl(photoUrl)} x="20" y="10" width="160" height="180"
                preserveAspectRatio="xMidYMid slice" clipPath="url(#hex-clip)" />
            ) : (
              <g clipPath="url(#hex-clip)">
                <rect x="20" y="10" width="160" height="180" fill={SL.grid} />
                <text x="100" y="105" textAnchor="middle" dominantBaseline="middle"
                  fill={SL.neonPurple} fontFamily={SL_FONT_DISPLAY} fontSize="56">👩‍🔬</text>
              </g>
            )}
            {/* Bottom badge */}
            <rect x="30" y="198" width="140" height="24" rx="4" fill={SL.deepSpace} stroke={SL.neonPurple} strokeWidth="1.5" />
            <text x="100" y="214" textAnchor="middle" dominantBaseline="middle"
              fill={SL.neonPurple} fontFamily={SL_FONT_MONO} fontSize="7" letterSpacing="1.5">
              ACCESS · LEVEL · LAB
            </text>
          </svg>
        </div>
        {/* Text block */}
        <div style={{
          flex: 1, minWidth: 0, height: '88%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ flex: '0 0 20%', minHeight: 0 }}>
            <EditableText configKey="role" onConfigChange={onConfigChange}
              max={72} min={7} wrap={false} center={false}
              style={{ fontFamily: SL_FONT_MONO, color: SL.neonPurple, letterSpacing: '0.08em' }}>
              [{role.toUpperCase()}]
            </EditableText>
          </div>
          <div style={{ flex: '0 0 36%', minHeight: 0 }}>
            <EditableText configKey="staffName" onConfigChange={onConfigChange}
              max={180} min={10} wrap={false} center={false}
              style={{ fontFamily: SL_FONT_DISPLAY, fontWeight: 700, color: SL.inkOnDark }}>
              {name}
            </EditableText>
          </div>
          <div style={{ flex: '1 1 44%', minHeight: 0 }}>
            <EditableText configKey="bio" onConfigChange={onConfigChange}
              max={100} min={8} center={false}
              style={{ fontFamily: SL_FONT_MONO, color: SL.neonGreen, opacity: 0.85, lineHeight: 1.4 }}>
              {bio}
            </EditableText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL — microscope-lens viewport with caliper tick marks
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Microscope frame SVG */}
        <svg viewBox="0 0 700 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0, filter: neonFilter(SL.neonBlue, 4) }}>
          {/* Outer ring */}
          <circle cx="350" cy="350" r="310" fill="none" stroke={SL.neonBlue} strokeWidth="4" />
          {/* Inner ring (lens border) */}
          <circle cx="350" cy="350" r="270" fill={SL.deepSpace} stroke={SL.neonBlue} strokeWidth="2.5" />
          {/* Caliper tick marks */}
          {Array.from({length: 36}).map((_,i) => {
            const a = (i * 10) * Math.PI / 180;
            const isMajor = i % 3 === 0;
            const r1 = 310; const r2 = isMajor ? 290 : 300;
            return <line key={i}
              x1={350 + r1 * Math.cos(a)} y1={350 + r1 * Math.sin(a)}
              x2={350 + r2 * Math.cos(a)} y2={350 + r2 * Math.sin(a)}
              stroke={SL.neonBlue} strokeWidth={isMajor ? 2.5 : 1} opacity={isMajor ? 0.9 : 0.5} />;
          })}
          {/* Crosshair */}
          <line x1="80" y1="350" x2="150" y2="350" stroke={SL.neonGreen} strokeWidth="1.5" opacity="0.6" />
          <line x1="550" y1="350" x2="620" y2="350" stroke={SL.neonGreen} strokeWidth="1.5" opacity="0.6" />
          <line x1="350" y1="80" x2="350" y2="150" stroke={SL.neonGreen} strokeWidth="1.5" opacity="0.6" />
          <line x1="350" y1="550" x2="350" y2="620" stroke={SL.neonGreen} strokeWidth="1.5" opacity="0.6" />
          {/* Magnification label */}
          <text x="350" y="692" textAnchor="middle" fill={SL.neonBlue}
            fontFamily={SL_FONT_MONO} fontSize="18" letterSpacing="4" opacity="0.8">
            40× MAGNIFICATION
          </text>
        </svg>
        {/* Image clipped into lens circle.
            Lens center: 350,350; radius: 270 of viewBox 700 → 50%±38.6% */}
        <div style={{
          position: 'absolute',
          left: '11.4%', right: '11.4%', top: '11.4%', bottom: '11.4%',
          borderRadius: '50%',
          overflow: 'hidden',
        }}>
          {urls.length > 0 ? (
            <img src={resolveUrl(urls[idx])} alt="Lab slide"
              className="transition-opacity duration-700"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `radial-gradient(circle, ${SL.grid} 0%, ${SL.deepSpace} 100%)`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              fontFamily: SL_FONT_MONO, color: SL.neonBlue, textAlign: 'center', padding: '8%',
            }}>
              <div style={{ fontSize: 'clamp(28px, 16cqh, 100px)', lineHeight: 1 }}>🔬</div>
              <div style={{ fontSize: 'clamp(10px, 4cqh, 28px)', marginTop: '4%', opacity: 0.7 }}>
                Add specimen image
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKER — oscilloscope waveform with message riding the signal
// ═══════════════════════════════════════════════════════════════════════════
export function StemLabTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length ? config.messages : ['⚗ Lab safety: always wear goggles ⚗'];
  const speed  = (config.speed as string) || 'medium';
  const secs   = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx]   = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setTick(t => t + 1);
      if (messages.length > 1) setIdx(i => (i + 1) % messages.length);
    }, secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];

  // Generate oscilloscope waveform points (sine-ish, varies with tick)
  const W = 1920; const H = 80;
  const pts = Array.from({length: 97}).map((_,i) => {
    const x = i * (W / 96);
    const phase = (tick * 0.8) + i * 0.22;
    const amp = 28 + 8 * Math.sin(i * 0.15);
    const y = H / 2 + amp * Math.sin(phase);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="absolute inset-0 overflow-hidden"
      style={{ background: SL.deepSpace, borderTop: `2px solid ${SL.neonGreen}44` }}>
      {/* Oscilloscope grid */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="55%"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        preserveAspectRatio="none">
        {/* Grid lines */}
        {[H*0.25, H*0.5, H*0.75].map((y,i) => (
          <line key={i} x1="0" y1={y} x2={W} y2={y} stroke={SL.neonGreen} strokeWidth="0.6" opacity="0.2" />
        ))}
        {Array.from({length: 13}).map((_,i) => (
          <line key={i} x1={i*(W/12)} y1="0" x2={i*(W/12)} y2={H} stroke={SL.neonGreen} strokeWidth="0.6" opacity="0.2" />
        ))}
        {/* The waveform */}
        <polyline points={pts} fill="none" stroke={SL.neonGreen} strokeWidth="2.5"
          style={{ filter: `drop-shadow(0 0 4px ${SL.neonGreen})` }} />
        {/* Trigger marker */}
        <line x1="0" y1={H/2} x2="20" y2={H/2} stroke={SL.amber} strokeWidth="1.5" />
        <polygon points={`0,${H/2-6} 0,${H/2+6} 14,${H/2}`} fill={SL.amber} />
        {/* "CH1" label */}
        <text x="24" y="14" fill={SL.neonGreen} fontFamily={SL_FONT_MONO} fontSize="11" opacity="0.7">CH1</text>
      </svg>
      {/* Message text below waveform */}
      <div style={{
        position: 'absolute', left: '2%', right: '2%', bottom: '6%',
        height: '42%',
        display: 'flex', alignItems: 'center',
      }}>
        <FitText max={72} min={9} wrap={false}
          style={{
            fontFamily: SL_FONT_MONO, fontWeight: 600,
            color: SL.neonGreen,
            textShadow: `0 0 10px ${SL.neonGreen}`,
            letterSpacing: '0.03em',
          }}>
          {primary}
        </FitText>
      </div>
    </div>
  );
}
