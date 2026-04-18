"use client";

/**
 * Campus Quad — high school modern-minimal welcome theme.
 *
 * Visual language: college campus brutalist-modern editorial design.
 * Clean lines, massive Fraunces serif typography, generous white-space,
 * a single bold accent-red, outline-only weather icons, minimal illustration.
 *
 *   LOGO             → school monogram in serif + hairline underline accent rule
 *   TEXT             → massive editorial headline + thin accent-red rule + italic subtitle
 *   CLOCK            → minimal analog face (thin strokes, live hands) + small serif digital
 *   WEATHER          → outline line-art condition icon + huge Fraunces temp + small-caps label
 *   COUNTDOWN        → enormous serif number + thin rule + small-caps kicker
 *   ANNOUNCEMENT     → editorial article card: kicker / headline / lead paragraph
 *   CALENDAR         → "UPCOMING" header + date-aligned event rows with hairline separators
 *   STAFF_SPOTLIGHT  → editorial profile: portrait left + small-caps role + massive name + italic blurb
 *   IMAGE_CAROUSEL   → full-bleed photo + small italic caption
 *   TICKER           → thin bar + accent-red dot + small-caps message
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

// ─── Palette ────────────────────────────────────────────────────────────────
export const CQ = {
  white:      '#F7F5F0',
  ink:        '#121212',
  inkSoft:    '#545454',
  accent:     '#B8322C',
  accentSoft: '#E8BFBC',
  slate:      '#3E4A55',
  paper:      '#FFFFFF',
  shadow:     'rgba(18,18,18,0.15)',
};

// ─── Typography ─────────────────────────────────────────────────────────────
export const CQ_FONT_DISPLAY = "'Fraunces', 'Playfair Display', 'Times New Roman', serif";
export const CQ_FONT_BODY    = "'Inter', system-ui, sans-serif";
export const CQ_FONT_MONO    = "'JetBrains Mono', monospace";

// Small-caps helper — renders text in letter-spaced uppercase Inter
function SmallCaps({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      fontFamily: CQ_FONT_BODY,
      fontWeight: 600,
      fontSize: '0.72em',
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      ...style,
    }}>
      {children}
    </span>
  );
}

// Thin horizontal rule in accent-red
function AccentRule({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{
      height: 2,
      background: CQ.accent,
      borderRadius: 1,
      ...style,
    }} />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGO — school monogram in serif + underline accent rule
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadLogo({
  config,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const initials = (
    config.initials
    || (config.schoolName || 'HS')
      .split(/\s+/)
      .filter(Boolean)
      .map((w: string) => w[0])
      .slice(0, 3)
      .join('')
      .toUpperCase()
    || 'HS'
  );
  const school = config.schoolName || '';
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '6%', gap: '4%' }}>
      {/* Photo or monogram block */}
      <div style={{
        flex: '0 0 62%',
        minHeight: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {photoUrl ? (
          <img
            src={resolveUrl(photoUrl)}
            alt={school || 'School logo'}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{
            height: '100%',
            aspectRatio: '1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `3px solid ${CQ.ink}`,
            background: CQ.paper,
          }}>
            <FitText max={280} min={24} style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 700, color: CQ.ink, letterSpacing: '-0.03em' }}>
              {initials}
            </FitText>
          </div>
        )}
      </div>

      {/* Accent rule */}
      <AccentRule style={{ width: '55%' }} />

      {/* School name in small-caps body font */}
      {school && (
        <div style={{ flex: '0 0 18%', minHeight: 0, width: '100%' }}>
          <FitText max={72} min={8} wrap={false} style={{ fontFamily: CQ_FONT_BODY, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: CQ.inkSoft }}>
            {school}
          </FitText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT — massive editorial headline + thin accent rule + italic subtitle
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadText({
  config,
  compact,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'Welcome to Campus';
  const subtitle = config.subtitle || 'A place to grow, connect, and excel.';

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '5% 6%', gap: '3%' }}>
      {/* Massive headline */}
      <div style={{ flex: !compact && subtitle ? '0 0 62%' : '0 0 90%', minHeight: 0 }}>
        <EditableText
          configKey="content"
          onConfigChange={onConfigChange}
          max={420}
          min={14}
          center={false}
          lineHeight={1.0}
          style={{
            fontFamily: CQ_FONT_DISPLAY,
            fontWeight: 700,
            color: CQ.ink,
            letterSpacing: '-0.025em',
          }}
        >
          {content}
        </EditableText>
      </div>

      {/* Thin accent-red rule */}
      <AccentRule style={{ width: '40%' }} />

      {/* Italic subtitle */}
      {!compact && (
        <div style={{ flex: '0 0 24%', minHeight: 0 }}>
          <EditableText
            configKey="subtitle"
            onConfigChange={onConfigChange}
            max={100}
            min={8}
            center={false}
            wrap={false}
            style={{
              fontFamily: CQ_FONT_BODY,
              fontStyle: 'italic',
              color: CQ.inkSoft,
              letterSpacing: '0.01em',
            }}
          >
            {subtitle}
          </EditableText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOCK — minimal analog face (live hands, thin strokes) + serif digital
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadClock({
  config,
  compact,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined;
  const digital = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(now);

  // Compute angles in UTC-adjusted local time
  const localDate = tz
    ? new Date(now.toLocaleString('en-US', { timeZone: tz }))
    : now;
  const s = localDate.getSeconds();
  const m = localDate.getMinutes() + s / 60;
  const h = (localDate.getHours() % 12) + m / 60;

  const secAngle = s * 6;               // 360/60
  const minAngle = m * 6;
  const hrAngle  = h * 30;              // 360/12

  function hand(angleDeg: number, len: number, width: number, color: string) {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    const x2 = 120 + Math.cos(rad) * len;
    const y2 = 120 + Math.sin(rad) * len;
    return <line x1="120" y1="120" x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '5%', gap: '3%' }}>
      {/* Analog face */}
      <div style={{ flex: '0 0 72%', minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 240 240" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
          {/* Outer ring */}
          <circle cx="120" cy="120" r="110" fill={CQ.paper} stroke={CQ.ink} strokeWidth="3" />
          {/* Hour tick marks */}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 - 90) * (Math.PI / 180);
            const x1 = 120 + Math.cos(a) * 94;
            const y1 = 120 + Math.sin(a) * 94;
            const x2 = 120 + Math.cos(a) * 107;
            const y2 = 120 + Math.sin(a) * 107;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={CQ.ink} strokeWidth="2.5" strokeLinecap="round" />;
          })}
          {/* Minute tick marks */}
          {Array.from({ length: 60 }).map((_, i) => {
            if (i % 5 === 0) return null;
            const a = (i * 6 - 90) * (Math.PI / 180);
            const x1 = 120 + Math.cos(a) * 101;
            const y1 = 120 + Math.sin(a) * 101;
            const x2 = 120 + Math.cos(a) * 107;
            const y2 = 120 + Math.sin(a) * 107;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={CQ.inkSoft} strokeWidth="1" strokeLinecap="round" />;
          })}
          {/* Hour hand */}
          {hand(hrAngle, 64, 3.5, CQ.ink)}
          {/* Minute hand */}
          {hand(minAngle, 82, 2.5, CQ.ink)}
          {/* Second hand — accent red */}
          {hand(secAngle, 88, 1.5, CQ.accent)}
          {/* Center dot */}
          <circle cx="120" cy="120" r="5" fill={CQ.ink} />
          <circle cx="120" cy="120" r="2.5" fill={CQ.accent} />
        </svg>
      </div>

      {/* Accent rule */}
      <AccentRule style={{ width: '45%' }} />

      {/* Digital readout in Fraunces */}
      {!compact && (
        <div style={{ flex: '0 0 20%', minHeight: 0, width: '100%' }}>
          <FitText max={72} min={8} wrap={false} style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 400, color: CQ.ink, letterSpacing: '0.04em' }}>
            {digital}
          </FitText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER — outline line-art icons (no fills) + huge Fraunces temp + small-caps label
// ═══════════════════════════════════════════════════════════════════════════

// Six condition buckets — line-art icons, pure outline, no fill areas
function WeatherIcon({ cond, size = 100 }: { cond: string; size?: number }) {
  const low = cond.toLowerCase();
  const isSnow    = low.includes('snow') || low.includes('flurr') || low.includes('blizzard');
  const isStorm   = low.includes('storm') || low.includes('thunder');
  const isRain    = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast= !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('fog') || low.includes('mist'));
  const isClear   = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  // partly = everything else (partly cloudy, mixed, etc.)

  const S = CQ.ink;   // stroke color — always ink for line-art aesthetic
  const W = 3;        // strokeWidth
  const scale = size / 100;

  // Viewbox always 100x100 — caller sets width/height
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
      <g stroke={S} strokeWidth={W} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {isClear && (
          // Sun: circle + 8 rays
          <g>
            <circle cx="50" cy="50" r="18" />
            <line x1="50" y1="6"  x2="50" y2="18"  />
            <line x1="50" y1="82" x2="50" y2="94"  />
            <line x1="6"  y1="50" x2="18" y2="50"  />
            <line x1="82" y1="50" x2="94" y2="50"  />
            <line x1="18" y1="18" x2="26" y2="26"  />
            <line x1="74" y1="74" x2="82" y2="82"  />
            <line x1="82" y1="18" x2="74" y2="26"  />
            <line x1="18" y1="82" x2="26" y2="74"  />
          </g>
        )}
        {isOvercast && (
          // Solid cloud outline
          <path d="M26 68 Q14 68 14 56 Q14 44 26 44 Q28 32 40 28 Q52 24 62 34 Q74 32 80 44 Q92 44 92 56 Q92 68 80 68 Z" />
        )}
        {!isClear && !isOvercast && !isRain && !isSnow && !isStorm && (
          // Partly cloudy: small sun peek top-right + cloud
          <g>
            <circle cx="72" cy="32" r="13" />
            <line x1="72" y1="10" x2="72" y2="16"  />
            <line x1="94" y1="32" x2="88" y2="32"  />
            <line x1="79" y1="18" x2="83" y2="22"  />
            <path d="M22 70 Q10 70 10 58 Q10 46 22 46 Q24 35 36 31 Q48 27 58 37 Q70 35 76 47 Q88 47 88 58 Q88 70 76 70 Z" />
          </g>
        )}
        {isRain && (
          // Cloud + 4 rain lines
          <g>
            <path d="M22 58 Q10 58 10 46 Q10 34 22 34 Q24 23 36 19 Q48 15 58 25 Q70 23 76 35 Q88 35 88 46 Q88 58 76 58 Z" />
            <line x1="30" y1="66" x2="24" y2="82"  />
            <line x1="46" y1="66" x2="40" y2="82"  />
            <line x1="62" y1="66" x2="56" y2="82"  />
            <line x1="78" y1="66" x2="72" y2="82"  />
          </g>
        )}
        {isSnow && (
          // Cloud + 5 snowflake marks
          <g>
            <path d="M22 56 Q10 56 10 44 Q10 32 22 32 Q24 21 36 17 Q48 13 58 23 Q70 21 76 33 Q88 33 88 44 Q88 56 76 56 Z" />
            {[[30, 72],[42, 82],[54, 68],[66, 80],[78, 70]].map(([x, y], i) => (
              <g key={i}>
                <line x1={x - 6} y1={y}     x2={x + 6} y2={y}     />
                <line x1={x}     y1={y - 6} x2={x}     y2={y + 6} />
              </g>
            ))}
          </g>
        )}
        {isStorm && (
          // Cloud + lightning bolt
          <g>
            <path d="M22 56 Q10 56 10 44 Q10 32 22 32 Q24 21 36 17 Q48 13 58 23 Q70 21 76 33 Q88 33 88 44 Q88 56 76 56 Z" />
            <polyline points="54,58 44,74 54,74 42,92" />
          </g>
        )}
      </g>
    </svg>
  );
}

export function CampusQuadWeather({
  config,
  compact,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const location  = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);

  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '5% 6%', gap: '3%' }}>
      {/* Icon — outline only, no fills */}
      <div style={{ flex: '0 0 38%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <WeatherIcon cond={cond} size={80} />
      </div>

      {/* Huge Fraunces temperature */}
      <div style={{ flex: '0 0 36%', minHeight: 0, width: '100%' }}>
        <FitText max={240} min={14} wrap={false} style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 700, color: CQ.ink, letterSpacing: '-0.03em' }}>
          {temp}°
        </FitText>
      </div>

      {/* Thin rule */}
      <AccentRule style={{ width: '40%' }} />

      {/* Small-caps condition label */}
      {!compact && (
        <div style={{ flex: '0 0 16%', minHeight: 0, width: '100%' }}>
          <FitText max={48} min={7} wrap={false} style={{ fontFamily: CQ_FONT_BODY, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: CQ.inkSoft }}>
            {cond}
          </FitText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNTDOWN — enormous Fraunces number + thin rule + small-caps kicker
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadCountdown({
  config,
  compact,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 12 * 86_400_000);
  const label    = config.label || resolved?.prefix || 'DAYS UNTIL';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86_400_000);
  const hours    = Math.floor((diff % 86_400_000) / 3_600_000);
  const bigNum   = days > 0 ? days : hours;
  const unit     = days > 0 ? (days === 1 ? 'DAY UNTIL' : 'DAYS UNTIL') : (hours === 1 ? 'HOUR UNTIL' : 'HOURS UNTIL');

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '5% 7%', gap: '2%' }}>
      {/* Kicker in small-caps above */}
      {!compact && (
        <div style={{ flex: '0 0 14%', minHeight: 0, width: '100%' }}>
          <FitText max={48} min={7} wrap={false} style={{ fontFamily: CQ_FONT_BODY, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: CQ.accent }}>
            {unit}
          </FitText>
        </div>
      )}

      {/* Thin rule */}
      <AccentRule style={{ width: '100%' }} />

      {/* Enormous serif number */}
      <div style={{ flex: '0 0 62%', minHeight: 0, width: '100%' }}>
        <FitText max={400} min={24} wrap={false} style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 700, color: CQ.ink, letterSpacing: '-0.05em' }}>
          {bigNum}
        </FitText>
      </div>

      {/* Thin rule */}
      <AccentRule style={{ width: '100%' }} />

      {/* Editable event label below */}
      {!compact && (
        <div style={{ flex: '0 0 16%', minHeight: 0, width: '100%' }}>
          <EditableText
            configKey="label"
            onConfigChange={onConfigChange}
            max={72}
            min={8}
            wrap={false}
            style={{ fontFamily: CQ_FONT_BODY, fontStyle: 'italic', color: CQ.inkSoft, letterSpacing: '0.02em' }}
          >
            {label}
          </EditableText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT — editorial article card: kicker / headline / lead paragraph
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadAnnouncement({
  config,
  compact,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const kicker  = config.kicker  || config.date  || 'ANNOUNCEMENT';
  const title   = config.title   || config.headline || 'Headline Goes Here';
  const message = config.message || config.body  || 'Lead copy goes here. Keep it concise — one or two impactful sentences that students will read at a glance.';

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '6% 7%', gap: '4%', background: CQ.paper }}>
      {/* Kicker — small-caps accent-red */}
      <div style={{ flex: '0 0 10%', minHeight: 0 }}>
        <FitText max={40} min={6} wrap={false} center={false} style={{ fontFamily: CQ_FONT_BODY, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', color: CQ.accent }}>
          {kicker}
        </FitText>
      </div>

      {/* Thin accent rule */}
      <AccentRule style={{ width: '100%' }} />

      {/* Headline — massive Fraunces */}
      <div style={{ flex: !compact ? '0 0 34%' : '0 0 72%', minHeight: 0 }}>
        <EditableText
          configKey="title"
          onConfigChange={onConfigChange}
          max={280}
          min={12}
          center={false}
          lineHeight={1.05}
          style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 700, color: CQ.ink, letterSpacing: '-0.02em' }}
        >
          {title}
        </EditableText>
      </div>

      {/* Lead paragraph — Inter regular */}
      {!compact && (
        <div style={{ flex: '1 1 36%', minHeight: 0 }}>
          <EditableText
            configKey="message"
            onConfigChange={onConfigChange}
            max={100}
            min={8}
            center={false}
            lineHeight={1.45}
            style={{ fontFamily: CQ_FONT_BODY, fontWeight: 400, color: CQ.inkSoft, letterSpacing: '0.005em' }}
          >
            {message}
          </EditableText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR — "UPCOMING" + date-left-aligned event rows + hairline separators
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadCalendar({
  config,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const events: { date: string; title: string }[] = (
    config.events?.length
      ? config.events
      : [
          { date: 'MON APR 21', title: 'AP Exam Registration Deadline' },
          { date: 'WED APR 23', title: 'Spring Talent Show — Main Auditorium' },
          { date: 'FRI APR 25', title: 'Senior Sunrise Breakfast 6 AM' },
        ]
  ).slice(0, Math.max(1, Math.min(6, config.maxEvents ?? 3)));

  return (
    <div className="absolute inset-0 flex flex-col" style={{ padding: '5% 6%' }}>
      {/* Header */}
      <div style={{ flex: '0 0 auto', marginBottom: '3%' }}>
        <SmallCaps style={{ color: CQ.accent, letterSpacing: '0.22em' }}>Upcoming</SmallCaps>
        <AccentRule style={{ marginTop: '2%' }} />
      </div>

      {/* Event rows */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
        {events.map((e, i) => (
          <div key={i} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {/* Row content */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4%', minHeight: 0, flex: '0 0 auto' }}>
              {/* Date column — accent red, mono */}
              <div style={{ flexShrink: 0, width: '28%' }}>
                <FitText max={36} min={6} wrap={false} center={false}
                  style={{ fontFamily: CQ_FONT_MONO, fontWeight: 400, color: CQ.accent, letterSpacing: '0.04em', fontSize: '0.8em' }}>
                  {e.date}
                </FitText>
              </div>
              {/* Title — Fraunces */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText max={80} min={8} wrap={false} center={false}
                  style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 600, color: CQ.ink, letterSpacing: '-0.01em' }}>
                  {e.title}
                </FitText>
              </div>
            </div>
            {/* Hairline separator (not after last item) */}
            {i < events.length - 1 && (
              <div style={{ height: 1, background: CQ.inkSoft, opacity: 0.2, marginTop: '2%' }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — portrait left + small-caps role + massive Fraunces name + italic blurb
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadStaffSpotlight({
  config,
  onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name    = config.staffName || config.name  || 'Alex Mercer';
  const role    = config.role                      || 'Teacher of the Month';
  const blurb   = config.bio || config.quote       || '"The best teachers ignite the spark of curiosity."';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex" style={{ padding: '5%', gap: '5%', alignItems: 'center', background: CQ.paper }}>
      {/* Portrait — circle-cropped */}
      <div style={{
        flexShrink: 0,
        width: '36%',
        aspectRatio: '1',
        borderRadius: '50%',
        overflow: 'hidden',
        background: CQ.accentSoft,
        border: `3px solid ${CQ.ink}`,
      }}>
        {photoUrl ? (
          <img src={resolveUrl(photoUrl)} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FitText max={120} min={12} style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 700, color: CQ.ink, letterSpacing: '-0.03em' }}>
              {name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
            </FitText>
          </div>
        )}
      </div>

      {/* Text block */}
      <div style={{ flex: 1, minWidth: 0, height: '88%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5%' }}>
        {/* Role — small caps accent */}
        <div style={{ flex: '0 0 14%', minHeight: 0 }}>
          <EditableText
            configKey="role"
            onConfigChange={onConfigChange}
            max={44} min={6} wrap={false} center={false}
            style={{ fontFamily: CQ_FONT_BODY, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: CQ.accent }}
          >
            {role}
          </EditableText>
        </div>

        {/* Accent rule */}
        <AccentRule style={{ width: '60%' }} />

        {/* Name — massive Fraunces */}
        <div style={{ flex: '0 0 36%', minHeight: 0 }}>
          <EditableText
            configKey="staffName"
            onConfigChange={onConfigChange}
            max={260} min={10} center={false} lineHeight={1.0}
            style={{ fontFamily: CQ_FONT_DISPLAY, fontWeight: 700, color: CQ.ink, letterSpacing: '-0.025em' }}
          >
            {name}
          </EditableText>
        </div>

        {/* Italic blurb — Inter */}
        <div style={{ flex: '1 1 30%', minHeight: 0 }}>
          <EditableText
            configKey="bio"
            onConfigChange={onConfigChange}
            max={80} min={7} center={false} lineHeight={1.4}
            style={{ fontFamily: CQ_FONT_BODY, fontStyle: 'italic', color: CQ.inkSoft }}
          >
            {blurb}
          </EditableText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL — full-bleed photo + small italic caption
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadImageCarousel({
  config,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : config.assetUrl ? [config.assetUrl] : [];
  const captions: string[] = Array.isArray(config.captions) ? config.captions : [];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 6000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const caption = captions[idx] || config.caption || '';

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: CQ.ink }}>
      {/* Full-bleed photo */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {urls.length > 0 ? (
          <img
            src={resolveUrl(urls[idx])}
            alt={caption || 'Campus photo'}
            className="transition-opacity duration-700"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `linear-gradient(135deg, ${CQ.slate} 0%, ${CQ.ink} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FitText max={64} min={10} style={{ fontFamily: CQ_FONT_BODY, fontWeight: 400, color: CQ.inkSoft, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Add photos
            </FitText>
          </div>
        )}
        {/* Subtle bottom gradient for caption legibility */}
        {caption && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%',
            background: 'linear-gradient(transparent, rgba(18,18,18,0.6))',
          }} />
        )}
      </div>

      {/* Small italic caption strip */}
      {caption && (
        <div style={{
          flex: '0 0 auto',
          padding: '1.5% 3%',
          background: CQ.ink,
        }}>
          <FitText max={28} min={6} wrap={false} center={false}
            style={{ fontFamily: CQ_FONT_BODY, fontStyle: 'italic', color: CQ.white, letterSpacing: '0.01em', opacity: 0.85 }}>
            {caption}
          </FitText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKER — thin bar + accent-red dot + small-caps sans-serif message
// ═══════════════════════════════════════════════════════════════════════════
export function CampusQuadTicker({
  config,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['Students: Senior panoramic photo — Thursday, 7:45 AM on the front steps.'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 6;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  const primary = messages[idx % messages.length];

  return (
    <div className="absolute inset-0 flex items-center" style={{
      background: CQ.paper,
      borderTop: `2px solid ${CQ.ink}`,
      borderBottom: `2px solid ${CQ.ink}`,
      padding: '0 3%',
      gap: '2%',
    }}>
      {/* Accent-red dot */}
      <div style={{
        flexShrink: 0,
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: CQ.accent,
      }} />

      {/* Small-caps message */}
      <div style={{ flex: 1, minWidth: 0, height: '60%' }}>
        <FitText max={52} min={7} wrap={false} center={false}
          style={{ fontFamily: CQ_FONT_BODY, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: CQ.ink }}>
          {primary}
        </FitText>
      </div>

      {/* Right-side accent line */}
      <div style={{
        flexShrink: 0,
        width: 2,
        height: '40%',
        background: CQ.accent,
      }} />
    </div>
  );
}
