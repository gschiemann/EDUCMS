"use client";

import { FitText } from './FitText';

/**
 * Rainbow Ribbon — candy-pop party theme.
 *
 * Every widget renders as a REAL SHAPE, not a rectangle:
 *   - LOGO             → ribbon rosette badge
 *   - TEXT / RICH_TEXT → folded ribbon banner
 *   - CLOCK            → speech-bubble clock card (tail down-left)
 *   - WEATHER          → multi-bump cloud cutout
 *   - COUNTDOWN        → 12-point starburst
 *   - ANNOUNCEMENT     → speech bubble with tail
 *   - CALENDAR         → stack of rounded event pills
 *   - STAFF_SPOTLIGHT  → polaroid card with washi-ribbon tag
 *   - IMAGE_CAROUSEL   → rounded hero frame with washi tape corners
 *   - TICKER           → pennant-flag bunting across the bottom
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
export const RR = {
  pink:     '#FF5D8F',
  pinkDk:   '#C21770',
  pinkLt:   '#FF9FBE',
  yellow:   '#FFC857',
  yellowDk: '#E0A640',
  mint:     '#A7E8BD',
  mintDk:   '#6FC58E',
  sky:      '#67B8FF',
  skyDk:    '#3B8BD9',
  lavender: '#C58CFF',
  lavenderDk:'#8E5BCC',
  peach:    '#FF9F68',
  ink:      '#2F2040',
  cream:    '#FFF8E7',
  white:    '#FFFFFF',
};

export const RR_FONT_DISPLAY = "var(--font-fredoka), ui-rounded, 'Fredoka', system-ui, sans-serif";
export const RR_FONT_SCRIPT  = "var(--font-caveat), 'Caveat', 'Segoe Script', cursive";

// ═══════════════════════════════════════════════════════════
// LOGO — ribbon rosette badge
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonLogo({ config }: { config: any; compact?: boolean }) {
  const initials = (config.initials
    || (config.schoolName || 'Star').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    || 'ST');
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    // 8% padding + shorter drop-shadow so the ribbon-tail tips plus
    // the soft shadow never clip at the zone edge. Ancestors (zone
    // containers) apply `overflow:hidden`, so anything that overhangs
    // gets cut — we keep the whole composition well inside the box.
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'transparent', padding: '8%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.2))', overflow: 'visible' }}>
        {/* Pleated ribbon rosette — 12 wedges */}
        <g transform="translate(130 130)">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30) * Math.PI / 180;
            const x = Math.cos(a) * 110;
            const y = Math.sin(a) * 110;
            const color = [RR.pink, RR.yellow, RR.mint, RR.sky, RR.lavender, RR.peach][i % 6];
            return <circle key={i} cx={x} cy={y} r="30" fill={color} stroke={RR.ink} strokeWidth="3" />;
          })}
        </g>
        {/* Outer star */}
        <polygon
          points="130,18 158,92 236,98 178,150 196,228 130,188 64,228 82,150 24,98 102,92"
          fill={RR.yellow} stroke={RR.ink} strokeWidth="6" />
        {/* Inner white disk */}
        <circle cx="130" cy="135" r="58" fill={RR.white} stroke={RR.ink} strokeWidth="4" />
        {/* Content. With a photoUrl set, clip it into the center disc.
            Otherwise render a default smiling-sun mascot so the zone
            has real personality instead of generic "Add Logo" text.
            Teachers can still drop in their school's crest from the
            properties panel — photoUrl wins when set. */}
        {photoUrl ? (
          <image href={resolveUrl(photoUrl)} x="75" y="80" width="110" height="110" preserveAspectRatio="xMidYMid slice" clipPath="circle(55px at 130px 135px)" />
        ) : (
          <g>
            {/* sunshine rays */}
            <g stroke={RR.yellow} strokeWidth="4" strokeLinecap="round" opacity="0.8">
              <line x1="130" y1="90" x2="130" y2="100" />
              <line x1="165" y1="100" x2="160" y2="108" />
              <line x1="182" y1="135" x2="175" y2="135" />
              <line x1="165" y1="170" x2="160" y2="162" />
              <line x1="95" y1="100" x2="100" y2="108" />
              <line x1="78" y1="135" x2="85" y2="135" />
              <line x1="95" y1="170" x2="100" y2="162" />
            </g>
            {/* sun face */}
            <circle cx="130" cy="135" r="34" fill={RR.yellow} stroke={RR.ink} strokeWidth="3" />
            {/* eyes */}
            <circle cx="119" cy="131" r="3.5" fill={RR.ink} />
            <circle cx="141" cy="131" r="3.5" fill={RR.ink} />
            {/* blush */}
            <ellipse cx="113" cy="142" rx="4" ry="2" fill={RR.pink} opacity="0.7" />
            <ellipse cx="147" cy="142" rx="4" ry="2" fill={RR.pink} opacity="0.7" />
            {/* smile */}
            <path d="M 117 146 Q 130 156 143 146" stroke={RR.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>
        )}
        {/* Two ribbon tails dangling below */}
        <polygon points="95,195 75,255 100,240 110,215" fill={RR.pink} stroke={RR.ink} strokeWidth="3" />
        <polygon points="165,195 185,255 160,240 150,215" fill={RR.sky} stroke={RR.ink} strokeWidth="3" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — folded ribbon banner
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonText({ config, compact }: { config: any; compact?: boolean }) {
  const content = config.content || 'GOOD MORNING, STARS!';
  const subtitle = config.subtitle || '~ let\'s make today colorful ~';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2% 1%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 3200 360" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.25))', position: 'absolute', inset: 0 }}>
          {/* Left tail */}
          <polygon points="0,180 120,60 240,180 120,300" fill={RR.pinkDk} />
          <polygon points="0,180 120,120 240,180 120,240" fill={RR.pink} />
          {/* Right tail */}
          <polygon points="3200,180 3080,60 2960,180 3080,300" fill={RR.pinkDk} />
          <polygon points="3200,180 3080,120 2960,180 3080,240" fill={RR.pink} />
          {/* Fold shadows */}
          <polygon points="200,0 260,60 260,300 200,360" fill={RR.pinkDk} />
          <polygon points="3000,0 2940,60 2940,300 3000,360" fill={RR.pinkDk} />
          {/* Main banner */}
          <rect x="260" y="0" width="2740" height="360" fill={RR.pink} />
          <rect x="260" y="0" width="2740" height="20" fill={RR.pinkLt} />
          <rect x="260" y="340" width="2740" height="20" fill={RR.pinkDk} />
        </svg>
        {/* Overlaid text — positioned inside the banner's safe interior:
            SVG viewBox 0 0 3200 360: main panel x:260-3000, y:20-340.
            As % of zone: left:8.1% right:6.25% top:5.5% bottom:5.5% */}
        <div style={{
          position: 'absolute',
          left: '8.1%', right: '6.25%', top: '5.5%', bottom: '5.5%',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: !compact && subtitle ? '0 0 70%' : '0 0 100%', minHeight: 0 }}>
            <FitText
              max={180} min={12} wrap={false}
              style={{
                fontFamily: RR_FONT_DISPLAY, fontWeight: 700,
                color: RR.white,
                textShadow: `2px 2px 0 ${RR.pinkDk}, 5px 5px 0 rgba(0,0,0,0.25)`,
                letterSpacing: '0.02em',
              }}
            >
              {content}
            </FitText>
          </div>
          {!compact && subtitle && (
            <div style={{ flex: '0 0 32%', minHeight: 0 }}>
              <FitText
                max={140} min={10} wrap={false}
                style={{
                  fontFamily: RR_FONT_SCRIPT,
                  color: RR.yellow,
                  textShadow: `2px 2px 0 ${RR.pinkDk}`,
                }}
              >
                {subtitle}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — speech bubble with tail pointing down-left
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(now);
  const hour = now.getHours();
  const greeting = hour < 12 ? 'good morning!' : hour < 17 ? 'good afternoon!' : 'good evening!';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 520" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'drop-shadow(0 16px 24px rgba(0,0,0,0.25))', position: 'absolute', inset: 0 }}>
          {/* Speech bubble body with tail pointing down-left */}
          <path d="M60 60 Q60 20 140 20 L620 20 Q680 20 680 80 L680 360 Q680 420 620 420 L280 420 L180 500 L210 420 L140 420 Q60 420 60 360 Z"
            fill={RR.white} stroke={RR.ink} strokeWidth="10" />
          {/* Rainbow top strip */}
          <g>
            <rect x="120" y="20" width="90" height="24" fill={RR.pink} />
            <rect x="210" y="20" width="90" height="24" fill={RR.yellow} />
            <rect x="300" y="20" width="90" height="24" fill={RR.mint} />
            <rect x="390" y="20" width="90" height="24" fill={RR.sky} />
            <rect x="480" y="20" width="90" height="24" fill={RR.lavender} />
          </g>
        </svg>
        {/* Text overlay matches the bubble's ACTUAL interior, not the
            zone rectangle. Bubble path: x:60-680 of viewBox 700 =
            8.6%-97.1%, inset 8.6% left and 2.9% right. Without this
            the text visibly bled off the left side of the bubble in
            the builder (preview was fine only because CSS scaling
            masked the mismatch). Bottom is 22% to clear the tail
            which drops to viewBox y:500 = 96%. */}
        <div style={{
          position: 'absolute',
          top: '12%', left: '10%', right: '5%', bottom: '22%',
          display: 'flex', flexDirection: 'column',
          fontFamily: RR_FONT_DISPLAY,
        }}>
          <div style={{ flex: !compact ? '1 1 60%' : '1 1 100%', minHeight: 0 }}>
            <FitText max={140} min={12} wrap={false}
              style={{ fontWeight: 700, color: RR.pink, letterSpacing: '-0.02em' }}>
              {time}
            </FitText>
          </div>
          {!compact && (
            <div style={{ flex: '0 0 40%', minHeight: 0 }}>
              <FitText max={100} min={10} wrap={false}
                style={{ fontFamily: RR_FONT_SCRIPT, color: RR.ink }}>
                {greeting}
              </FitText>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — multi-bump cloud cutout
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  // Pick the illustration from the current condition. Groups collapse
  // the 30+ WMO codes into five visual buckets so kids can read the
  // sky at a glance: sunny / partly / cloudy / rain / snow / storm.
  const low = (cond || '').toLowerCase();
  const isSnow = low.includes('snow') || low.includes('flurr');
  const isStorm = low.includes('storm') || low.includes('thunder');
  const isRain = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast = !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));
  const isPartly = !isClear && !isOvercast && !isRain && !isSnow && !isStorm;

  const CloudShape = (
    <path d="M140 320 Q80 320 80 260 Q80 200 140 200 Q150 120 240 120 Q300 80 360 120 Q420 80 480 140 Q560 140 580 220 Q640 220 640 290 Q640 360 560 360 L180 360 Q140 360 140 320Z"
      fill={RR.white} stroke={RR.ink} strokeWidth="10" />
  );
  const BigSun = (
    <g>
      <circle cx="350" cy="230" r="120" fill={RR.yellow} stroke={RR.ink} strokeWidth="8" />
      <g stroke={RR.yellow} strokeWidth="16" strokeLinecap="round">
        <line x1="350" y1="50" x2="350" y2="100" />
        <line x1="350" y1="360" x2="350" y2="410" />
        <line x1="170" y1="230" x2="220" y2="230" />
        <line x1="480" y1="230" x2="530" y2="230" />
        <line x1="230" y1="110" x2="265" y2="145" />
        <line x1="435" y1="315" x2="470" y2="350" />
        <line x1="470" y1="110" x2="435" y2="145" />
        <line x1="265" y1="315" x2="230" y2="350" />
      </g>
      {/* smiley */}
      <circle cx="320" cy="215" r="7" fill={RR.ink} />
      <circle cx="380" cy="215" r="7" fill={RR.ink} />
      <path d="M 315 245 Q 350 275 385 245" stroke={RR.ink} strokeWidth="6" fill="none" strokeLinecap="round" />
    </g>
  );
  const SmallSunPeek = (
    <g>
      <circle cx="580" cy="140" r="60" fill={RR.yellow} stroke={RR.ink} strokeWidth="6" />
      <g stroke={RR.yellow} strokeWidth="12" strokeLinecap="round">
        <line x1="580" y1="40" x2="580" y2="75" />
        <line x1="665" y1="75" x2="645" y2="100" />
        <line x1="665" y1="205" x2="645" y2="180" />
        <line x1="495" y1="75" x2="515" y2="100" />
      </g>
    </g>
  );
  const Raindrops = (
    <g fill={RR.sky}>
      <circle cx="220" cy="410" r="14" /><circle cx="290" cy="440" r="11" />
      <circle cx="370" cy="415" r="13" /><circle cx="450" cy="445" r="10" />
      <circle cx="530" cy="415" r="12" />
    </g>
  );
  const Snowflakes = (
    <g stroke={RR.sky} strokeWidth="5" strokeLinecap="round">
      {[[240, 410], [320, 445], [400, 415], [480, 445], [560, 415]].map(([x, y], i) => (
        <g key={i}>
          <line x1={x - 14} y1={y} x2={x + 14} y2={y} />
          <line x1={x} y1={y - 14} x2={x} y2={y + 14} />
          <line x1={x - 10} y1={y - 10} x2={x + 10} y2={y + 10} />
          <line x1={x - 10} y1={y + 10} x2={x + 10} y2={y - 10} />
        </g>
      ))}
    </g>
  );
  const Bolt = (
    <path d="M340 370 L420 370 L380 440 L450 440 L310 520 L360 430 L300 430 Z"
      fill={RR.yellow} stroke={RR.ink} strokeWidth="6" strokeLinejoin="round" />
  );
  const DarkerCloud = (
    <path d="M140 320 Q80 320 80 260 Q80 200 140 200 Q150 120 240 120 Q300 80 360 120 Q420 80 480 140 Q560 140 580 220 Q640 220 640 290 Q640 360 560 360 L180 360 Q140 360 140 320Z"
      fill="#D8DDE8" stroke={RR.ink} strokeWidth="10" />
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 520" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'drop-shadow(0 16px 24px rgba(0,0,0,0.2))', position: 'absolute', inset: 0 }}>
          {isClear && BigSun}
          {isPartly && (<>{SmallSunPeek}{CloudShape}</>)}
          {isOvercast && (<>{DarkerCloud}</>)}
          {isRain && (<>{SmallSunPeek}{CloudShape}{Raindrops}</>)}
          {isSnow && (<>{DarkerCloud}{Snowflakes}</>)}
          {isStorm && (<>{DarkerCloud}{Bolt}</>)}
        </svg>
        {/* Text overlay flex-centered inside the zone so the temp +
            condition sit dead-center no matter which illustration is
            showing. Previous absolute-percent bounds drifted slightly
            off-center as the SVG shape varied (cloud has more mass
            on one side, sun is symmetric, rain splits bottom). Flex
            center removes the math. */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '72%', height: '56%',
            display: 'flex', flexDirection: 'column',
            fontFamily: RR_FONT_DISPLAY,
          }}>
            <div style={{ flex: !compact ? '1 1 68%' : '1 1 100%', minHeight: 0 }}>
              <FitText max={280} min={14} wrap={false}
                style={{ fontWeight: 700, color: RR.sky, letterSpacing: '-0.02em' }}>
                {temp}°
              </FitText>
            </div>
            {!compact && (
              <div style={{ flex: '0 0 32%', minHeight: 0 }}>
                <FitText max={100} min={9} wrap={false}
                  style={{ fontFamily: RR_FONT_SCRIPT, color: RR.pink }}>
                  {cond}
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
// COUNTDOWN — 12-point starburst
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonCountdown({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 12 * 86400000);
  const label = (config.label || resolved?.prefix || 'Event In').toUpperCase();
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const bigNum = days > 0 ? days : hours;
  const unit = days > 0 ? (days === 1 ? 'DAY!' : 'DAYS!') : (hours === 1 ? 'HR!' : 'HRS!');

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '2%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 700 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'drop-shadow(0 20px 28px rgba(0,0,0,0.3))', position: 'absolute', inset: 0 }}>
          <g transform="translate(350 350)">
            {/* Outer yellow starburst — 12 points */}
            <polygon
              points="0,-320 60,-90 300,-120 130,60 310,210 40,180 0,340 -40,180 -310,210 -130,60 -300,-120 -60,-90"
              fill={RR.yellow} stroke={RR.ink} strokeWidth="10" />
            {/* Inner pink starburst */}
            <polygon
              points="0,-220 40,-60 210,-80 90,40 220,150 30,130 0,230 -30,130 -220,150 -90,40 -210,-80 -40,-60"
              fill={RR.pink} stroke={RR.white} strokeWidth="6" />
          </g>
        </svg>
        {/* Text overlay — shifted DOWN and widened so it lands in the
            star's visual center (the points at top/bottom leave a
            barrel-shaped flat region; earlier inset was 50/50 but
            that reads visually high because the bottom point extends
            further than the top point in this 12-pt starburst). */}
        <div style={{
          position: 'absolute',
          inset: '32% 14% 24% 14%',
          display: 'flex', flexDirection: 'column',
          fontFamily: RR_FONT_DISPLAY, color: RR.white,
          textAlign: 'center',
        }}>
          {/* Label row — 22% of interior height */}
          <div style={{ flex: '0 0 22%', minHeight: 0 }}>
            <FitText
              max={72} min={8} wrap={false}
              style={{
                fontWeight: 800,
                letterSpacing: '0.04em',
                textShadow: `3px 3px 0 ${RR.ink}`,
              }}
            >
              {label}
            </FitText>
          </div>
          {/* Big number row — 52% of interior height */}
          <div style={{ flex: '0 0 52%', minHeight: 0 }}>
            <FitText
              max={320} min={24} wrap={false}
              style={{
                fontWeight: 800,
                textShadow: `4px 4px 0 ${RR.ink}`,
              }}
            >
              {bigNum}
            </FitText>
          </div>
          {/* Unit row — 26% of interior height */}
          <div style={{ flex: '0 0 26%', minHeight: 0 }}>
            <FitText
              max={80} min={8} wrap={false}
              style={{
                fontFamily: RR_FONT_SCRIPT,
                textShadow: `2px 2px 0 ${RR.ink}`,
              }}
            >
              {unit}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — speech bubble with tail
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  const title = config.title || "★ TODAY'S SCOOP ★";
  const message = config.message || config.body || 'The Book Fair opens today — bring your list!';
  const date = config.date || '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '3%' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg viewBox="0 0 1800 500" width="100%" height="100%" preserveAspectRatio="none"
          style={{ filter: 'drop-shadow(0 18px 32px rgba(0,0,0,0.25))', position: 'absolute', inset: 0 }}>
          {/* Speech bubble stretches to fill the zone so text overlay
              bounds always match the visible bubble. Slight tail
              distortion at extreme aspect ratios is acceptable — the
              alternative (letterbox + text overflowing empty margins)
              is worse. */}
          <path d="M60 60 Q60 20 140 20 L1700 20 Q1760 20 1760 80 L1760 360 Q1760 400 1700 400 L1200 400 L1100 480 L1080 400 L140 400 Q60 400 60 340 Z"
            fill={RR.white} stroke={RR.ink} strokeWidth="10"
            vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Safe interior — tight margins so text fills the bubble.
            The bubble path has the tail hanging off the bottom-right
            (y:400-480 in the viewBox = bottom 16%), so we reserve
            the bottom 18% for the tail and let the text own the rest. */}
        <div style={{
          position: 'absolute', top: '4%', left: '3%', right: '3%', bottom: '18%',
          display: 'flex', flexDirection: 'column',
          fontFamily: RR_FONT_DISPLAY,
        }}>
          {/* Message — fills the entire bubble interior. */}
          <div style={{ flex: !compact && date ? '1 1 84%' : '1 1 100%', minHeight: 0 }}>
            <FitText
              max={320} min={12}
              style={{ fontWeight: 700, color: RR.ink, letterSpacing: '0.005em' }}
            >
              {message}
            </FitText>
          </div>
          {!compact && date && (
            <div style={{ flex: '0 0 18%', minHeight: 0 }}>
              <FitText
                max={120} min={10} wrap={false}
                style={{ fontFamily: RR_FONT_SCRIPT, color: RR.pinkDk }}
              >
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
// CALENDAR — stack of rounded event pills
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events && config.events.length ? config.events : [
    { date: 'MON · 8:30am', title: 'Pajama Day Reading Hour' },
    { date: 'WED · 10am',   title: "Principal's Story Time" },
    { date: 'APR 30',       title: 'Field Trip — THE ZOO!' },
  ]).slice(0, 4);

  const colors = [RR.sky, RR.yellow, RR.pinkLt, RR.mint];

  return (
    <div className="absolute inset-0 flex flex-col justify-center" style={{ padding: '4%', gap: '3%' }}>
      {events.map((e: any, i: number) => {
        const bg = colors[i % colors.length];
        // CSS-only pill — inherently resizable. No SVG viewBox to
        // stretch, so the rounded caps stay circular at any aspect
        // ratio. `border-radius: 9999` is the trick — it always
        // resolves to "half the shorter dimension" and never
        // distorts.
        return (
          <div key={i} style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            background: bg,
            border: `6px solid ${RR.ink}`,
            borderRadius: 9999,
            boxShadow: '0 8px 14px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5%',
            padding: '0 2.5% 0 0.8%',
            overflow: 'hidden',
          }}>
            {/* Left-side bullet — aspect-square div fills most of the
                pill's height (minus the border). */}
            <div style={{
              height: '82%',
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              background: RR.white,
              border: `5px solid ${RR.ink}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <div style={{
                width: '45%',
                height: '45%',
                borderRadius: '50%',
                background: RR.pink,
              }} />
            </div>
            {/* Text stack fills the full pill height. Title takes 72%
                so the event name is the most prominent element. */}
            <div style={{
              flex: 1,
              minWidth: 0,
              height: '94%',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: RR_FONT_DISPLAY,
            }}>
              <div style={{ flex: '0 0 42%', minHeight: 0 }}>
                <FitText max={240} min={8} wrap={false} center={false}
                  style={{ fontFamily: RR_FONT_SCRIPT, color: RR.pinkDk }}>
                  {e.date}
                </FitText>
              </div>
              <div style={{ flex: '1 1 58%', minHeight: 0 }}>
                <FitText max={320} min={10} wrap={false} center={false}
                  style={{ fontWeight: 700, color: RR.ink }}>
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
// STAFF SPOTLIGHT — polaroid card with washi-ribbon tag
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonStaffSpotlight({ config }: { config: any; compact?: boolean }) {
  const name = config.staffName || config.name || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const quote = config.bio || config.quote || '"Be bright. Be bold. Be YOU today!"';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: RR.white, borderRadius: 24,
        border: `6px solid ${RR.white}`,
        boxShadow: '0 18px 36px rgba(0,0,0,0.28)',
        transform: 'rotate(-2deg)',
        padding: '5% 5% 5% 5%',
        display: 'flex', gap: '5%', alignItems: 'center',
        fontFamily: RR_FONT_DISPLAY,
      }}>
        {/* Washi-tape ribbon tag across the top — taller + uses FitText
            so "Spotlight" reads at a glance in every zone size. */}
        <div style={{
          position: 'absolute', top: '-8%', left: '6%', width: '38%', height: '18%',
          background: `repeating-linear-gradient(45deg, ${RR.pinkLt} 0 10%, ${RR.sky} 10% 20%)`,
          border: `3px solid ${RR.ink}`,
          borderRadius: 6,
          transform: 'rotate(-6deg)',
          boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
          padding: '2% 4%',
        }}>
          <FitText max={120} min={10} wrap={false}
            style={{ color: RR.ink, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            ★ Spotlight ★
          </FitText>
        </div>
        {/* Portrait */}
        <div style={{
          flexShrink: 0, width: '38%', aspectRatio: '1',
          borderRadius: 20, overflow: 'hidden',
          background: RR.yellow,
          border: `6px solid ${RR.white}`,
          boxShadow: `0 6px 0 ${RR.lavenderDk}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ fontSize: 'clamp(30px, 30cqh, 180px)' }}>👩‍🏫</div>
          )}
        </div>
        {/* Text — three FitText rows so the card fills its vertical
            space consistently in both the builder and the preview.
            Previously used em-relative sizes which shrank visibly in
            the CSS-scaled preview compared to the built-to-FitText
            bubble and pills. */}
        <div style={{
          flex: 1, minWidth: 0, height: '90%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ flex: '0 0 22%', minHeight: 0 }}>
            <FitText max={80} min={8} wrap={false} center={false}
              style={{ fontWeight: 700, color: RR.pink, letterSpacing: '0.02em' }}>
              ★ {role.toUpperCase()} ★
            </FitText>
          </div>
          <div style={{ flex: '0 0 36%', minHeight: 0 }}>
            <FitText max={220} min={10} wrap={false} center={false}
              style={{ fontWeight: 700, color: RR.ink }}>
              {name}
            </FitText>
          </div>
          <div style={{ flex: '1 1 42%', minHeight: 0 }}>
            <FitText max={100} min={9} center={false}
              style={{ fontFamily: RR_FONT_SCRIPT, color: RR.lavenderDk }}>
              {quote}
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — rounded hero frame with washi-tape corners
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0 ? config.urls : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: RR.white, borderRadius: 28,
        border: `6px solid ${RR.ink}`,
        boxShadow: '0 16px 32px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}>
        {hasImage ? (
          <img src={resolveUrl(urls[idx])} alt="Gallery"
            className="transition-opacity duration-500"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `linear-gradient(135deg, ${RR.pinkLt} 0%, ${RR.yellow} 50%, ${RR.sky} 100%)`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontFamily: RR_FONT_DISPLAY, color: RR.ink,
            textAlign: 'center', padding: '6%',
          }}>
            <div style={{ fontSize: 'clamp(40px, 28cqh, 180px)', lineHeight: 1 }}>📷</div>
            <div style={{
              fontWeight: 700, fontSize: 'clamp(12px, 6cqh, 44px)',
              marginTop: '2cqh',
            }}>
              Add photos or GIFs
            </div>
            <div style={{
              fontFamily: RR_FONT_SCRIPT,
              fontSize: 'clamp(10px, 4cqh, 28px)',
              color: RR.pinkDk, marginTop: '1cqh',
            }}>
              drop in the builder to fill this frame
            </div>
          </div>
        )}
        {/* Washi-tape corners */}
        <div style={{
          position: 'absolute', top: '-3%', left: '6%', width: '20%', height: '10%',
          background: `repeating-linear-gradient(45deg, ${RR.pinkLt} 0 10%, ${RR.white} 10% 20%)`,
          border: `2px solid ${RR.ink}`, transform: 'rotate(-10deg)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
        }} />
        <div style={{
          position: 'absolute', top: '-3%', right: '6%', width: '20%', height: '10%',
          background: `repeating-linear-gradient(-45deg, ${RR.yellow} 0 10%, ${RR.white} 10% 20%)`,
          border: `2px solid ${RR.ink}`, transform: 'rotate(8deg)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-3%', left: '10%', width: '18%', height: '10%',
          background: `repeating-linear-gradient(45deg, ${RR.mint} 0 10%, ${RR.white} 10% 20%)`,
          border: `2px solid ${RR.ink}`, transform: 'rotate(6deg)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-3%', right: '10%', width: '18%', height: '10%',
          background: `repeating-linear-gradient(-45deg, ${RR.lavender} 0 10%, ${RR.white} 10% 20%)`,
          border: `2px solid ${RR.ink}`, transform: 'rotate(-7deg)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — pennant-flag bunting across the bottom
// ═══════════════════════════════════════════════════════════
export function RainbowRibbonTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length ? config.messages : ['☆ Lost & Found cleanout Friday ☆'];
  const primary = messages[0];

  // 12 pennants across
  const pennantColors = [RR.pink, RR.yellow, RR.mint, RR.sky, RR.lavender, RR.peach, RR.pink, RR.lavender, RR.sky, RR.mint, RR.yellow, RR.pink];

  return (
    <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
      <svg viewBox="0 0 3760 180" width="100%" height="55%" preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, right: 0, top: '5%' }}>
        {/* String */}
        <path d="M0 0 Q940 40 1880 20 T3760 0" stroke={RR.ink} strokeWidth="4" fill="none" />
        {/* Pennants */}
        {pennantColors.map((c, i) => {
          const left = 80 + i * 300;
          const drop = Math.round(Math.abs(6 - i) * 2);
          const top = 20 + drop;
          return (
            <polygon key={i}
              points={`${left},${top} ${left + 120},${top} ${left + 60},${top + 120}`}
              fill={c} stroke={RR.ink} strokeWidth="4" />
          );
        })}
      </svg>
      {/* Primary message overlaid on center */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: '8%',
        textAlign: 'center',
        fontFamily: RR_FONT_DISPLAY, fontWeight: 700,
        fontSize: compact ? '1.3em' : '1.8em',
        color: RR.ink,
        textShadow: `3px 3px 0 ${RR.white}`,
        padding: '0 4%',
      }}>
        {primary}
      </div>
    </div>
  );
}
