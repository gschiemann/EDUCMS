"use client";

/**
 * Morning News — middle school morning broadcast aesthetic.
 *
 * TV morning-show set vibe: LIVE badge, lower-third graphics, news ticker,
 * anchor-desk card, breaking-news color bars.
 *
 *   - LOGO             → circular station-ID badge (navy ring + gold wordmark)
 *   - TEXT / RICH_TEXT → BREAKING NEWS lower-third ribbon (red block + gold strip + white title)
 *   - CLOCK            → dark studio digital readout + ON AIR indicator + analog hands
 *   - WEATHER          → WEATHER CENTER lower-third card, condition-aware illustration
 *   - COUNTDOWN        → red breaking-news countdown badge with huge number
 *   - ANNOUNCEMENT     → chyron / lower-third banner (red category block + white body)
 *   - CALENDAR         → 3 COMING UP segments with colored vertical bars
 *   - STAFF_SPOTLIGHT  → anchor card: portrait left, TEACHER SPOTLIGHT label + red underline right
 *   - IMAGE_CAROUSEL   → TV-set frame with scanlines + corner SD/HD badge
 *   - TICKER           → cable-news scrolling red banner with LIVE badge on left
 */

import { useEffect, useRef, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';
import { fetchWeather, getWMO } from '../WidgetRenderer';
import { resolveCountdownTarget } from '../countdown-utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Palette ────────────────────────────────────────────────
export const MN = {
  anchorBlue:    '#0F172A',
  liveRed:       '#DC2626',
  liveRedBright: '#EF4444',
  paper:         '#FFFFFF',
  gold:          '#EAB308',
  sky:           '#3B82F6',
  ink:           '#020617',
  inkSoft:       '#475569',
  tickerBg:      '#1E293B',
  shadow:        'rgba(2,6,23,0.35)',
};

export const MN_FONT_DISPLAY = "'Inter', 'Helvetica Neue', system-ui, sans-serif";
export const MN_FONT_SERIF   = "'Fraunces', 'Times New Roman', serif";
export const MN_FONT_BODY    = "'Fredoka', system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════
// LOGO — circular station-ID badge (navy ring + gold wordmark)
// ═══════════════════════════════════════════════════════════
export function MorningNewsLogo({ config }: { config: any; compact?: boolean }) {
  const name   = config.schoolName || config.stationName || 'Channel 7';
  const initials = (config.initials
    || name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('')
  ).toUpperCase().slice(0, 3);
  const photoUrl = config.assetUrl || config.photoUrl;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <svg viewBox="0 0 260 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ filter: `drop-shadow(0 4px 12px ${MN.shadow})`, overflow: 'visible' }}>
        {/* Outer navy ring */}
        <circle cx="130" cy="130" r="122" fill={MN.anchorBlue} stroke={MN.gold} strokeWidth="6" />
        {/* Gold accent ring segments — broadcast-style arc marks */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const x1  = 130 + Math.cos(rad) * 108;
          const y1  = 130 + Math.sin(rad) * 108;
          const x2  = 130 + Math.cos(rad) * 118;
          const y2  = 130 + Math.sin(rad) * 118;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={MN.gold} strokeWidth="3" />;
        })}
        {/* Inner white disk */}
        <circle cx="130" cy="130" r="88" fill={MN.paper} />
        {/* Content: photo or initials */}
        {photoUrl ? (
          <image
            href={resolveUrl(photoUrl)}
            x="44" y="44" width="172" height="172"
            preserveAspectRatio="xMidYMid slice"
            clipPath="circle(86px at 130px 130px)"
          />
        ) : (
          <text
            x="130" y="148"
            textAnchor="middle"
            fontSize="54"
            fontWeight="800"
            fontFamily={MN_FONT_DISPLAY}
            fill={MN.anchorBlue}
            letterSpacing="-2"
          >
            {initials}
          </text>
        )}
        {/* Gold bottom wordmark band */}
        <path d="M44,178 A88,88 0 0,0 216,178 Z" fill={MN.gold} />
        <text
          x="130" y="202"
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          fontFamily={MN_FONT_DISPLAY}
          fill={MN.ink}
          letterSpacing="1"
        >
          MORNING NEWS
        </text>
        {/* LIVE badge top-right */}
        <rect x="172" y="16" width="52" height="22" rx="4" fill={MN.liveRed} />
        <text x="198" y="31" textAnchor="middle" fontSize="12" fontWeight="800"
          fontFamily={MN_FONT_DISPLAY} fill={MN.paper} letterSpacing="1">LIVE</text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — BREAKING NEWS lower-third ribbon
// ═══════════════════════════════════════════════════════════
export function MorningNewsText({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const content  = config.content  || 'SCHOOL PLAY OPENS FRIDAY NIGHT';
  const subtitle = config.subtitle || 'Doors open at 6:30 PM — tickets available at the office';

  return (
    <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: '0' }}>
      {/* Three-layer lower-third structure */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Gold strip top */}
        <div style={{
          background: MN.gold,
          height: '8%',
          minHeight: 6,
          width: '100%',
        }} />
        {/* Red BREAKING block + white title row */}
        <div style={{
          display: 'flex',
          width: '100%',
          flex: '0 0 38%',
          minHeight: 0,
        }}>
          <div style={{
            background: MN.liveRed,
            padding: '2% 3%',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            minWidth: '22%',
          }}>
            <FitText max={42} min={8} wrap={false}
              style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper, letterSpacing: '0.04em' }}>
              BREAKING
            </FitText>
          </div>
          <div style={{
            background: MN.anchorBlue,
            flex: 1,
            minWidth: 0,
            padding: '1.5% 3%',
            display: 'flex',
            alignItems: 'center',
          }}>
            <EditableText
              configKey="content" onConfigChange={onConfigChange}
              max={120} min={10} wrap={false}
              style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.paper, letterSpacing: '0.01em' }}
            >
              {content}
            </EditableText>
          </div>
        </div>
        {/* White subtitle bar */}
        {!compact && (
          <div style={{
            background: MN.paper,
            padding: '1.5% 3%',
            flex: '0 0 28%',
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
          }}>
            <EditableText
              configKey="subtitle" onConfigChange={onConfigChange}
              max={90} min={8} wrap={false}
              style={{ fontFamily: MN_FONT_SERIF, fontStyle: 'italic', color: MN.ink, letterSpacing: '0.01em' }}
            >
              {subtitle}
            </EditableText>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CLOCK — studio digital readout + ON AIR indicator + analog hands
// ═══════════════════════════════════════════════════════════
export function MorningNewsClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow]       = useState(new Date());
  const [blink, setBlink]   = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      setBlink(b => !b);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const tz     = config.timezone || undefined;
  const fmt    = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  const parts  = fmt.formatToParts(now);
  const hh     = parts.find(p => p.type === 'hour')?.value   || '12';
  const mm     = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm   = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const dateStr = dateFmt.format(now).toUpperCase();

  // Analog hand angles
  const secAngle = now.getSeconds() * 6;
  const minAngle = now.getMinutes() * 6 + now.getSeconds() * 0.1;
  const hrAngle  = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;

  return (
    <div className="absolute inset-0" style={{
      background: MN.anchorBlue,
      display: 'flex',
      flexDirection: 'column',
      padding: '4%',
      boxSizing: 'border-box',
      gap: '3%',
    }}>
      {/* ON AIR indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2%', flex: '0 0 12%', minHeight: 0 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: blink ? MN.liveRed : 'transparent',
          boxShadow: blink ? `0 0 8px ${MN.liveRedBright}` : 'none',
          border: `2px solid ${MN.liveRed}`,
          flexShrink: 0,
          transition: 'background 0.2s',
        }} />
        <FitText max={28} min={7} wrap={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.liveRed, letterSpacing: '0.12em' }}>
          ON AIR
        </FitText>
      </div>

      {/* Digital time row */}
      <div style={{ flex: !compact ? '0 0 40%' : '1 1 80%', minHeight: 0, display: 'flex', alignItems: 'center', gap: '2%' }}>
        <div style={{ flex: '0 0 auto', minWidth: 0, height: '100%' }}>
          <FitText max={200} min={20} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper, letterSpacing: '-0.02em' }}>
            {hh}:{mm}
          </FitText>
        </div>
        <div style={{ flex: '0 0 auto', height: '100%' }}>
          <FitText max={48} min={8} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.gold }}>
            {ampm}
          </FitText>
        </div>
      </div>

      {/* Analog clock overlay + date — shown when not compact */}
      {!compact && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: '4%' }}>
          {/* Analog face */}
          <svg viewBox="0 0 100 100" style={{ height: '90%', aspectRatio: '1', flexShrink: 0 }}>
            <circle cx="50" cy="50" r="46" fill="none" stroke={MN.inkSoft} strokeWidth="2" />
            {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg => {
              const r = (deg * Math.PI) / 180;
              const isMajor = deg % 90 === 0;
              return <line key={deg}
                x1={50 + Math.cos(r) * (isMajor ? 34 : 38)}
                y1={50 + Math.sin(r) * (isMajor ? 34 : 38)}
                x2={50 + Math.cos(r) * 44}
                y2={50 + Math.sin(r) * 44}
                stroke={isMajor ? MN.gold : MN.inkSoft}
                strokeWidth={isMajor ? 2.5 : 1}
              />;
            })}
            {/* Hour hand */}
            <line
              x1="50" y1="50"
              x2={50 + Math.cos(((hrAngle - 90) * Math.PI) / 180) * 24}
              y2={50 + Math.sin(((hrAngle - 90) * Math.PI) / 180) * 24}
              stroke={MN.paper} strokeWidth="3.5" strokeLinecap="round"
            />
            {/* Minute hand */}
            <line
              x1="50" y1="50"
              x2={50 + Math.cos(((minAngle - 90) * Math.PI) / 180) * 34}
              y2={50 + Math.sin(((minAngle - 90) * Math.PI) / 180) * 34}
              stroke={MN.paper} strokeWidth="2.5" strokeLinecap="round"
            />
            {/* Second hand */}
            <line
              x1="50" y1="50"
              x2={50 + Math.cos(((secAngle - 90) * Math.PI) / 180) * 38}
              y2={50 + Math.sin(((secAngle - 90) * Math.PI) / 180) * 38}
              stroke={MN.liveRed} strokeWidth="1.5" strokeLinecap="round"
            />
            <circle cx="50" cy="50" r="3" fill={MN.liveRed} />
          </svg>
          {/* Date */}
          <div style={{ flex: 1, minWidth: 0, height: '60%' }}>
            <FitText max={36} min={7} wrap={false}
              style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: MN.inkSoft, letterSpacing: '0.06em' }}>
              {dateStr}
            </FitText>
          </div>
        </div>
      )}

      {/* Gold bottom rule */}
      <div style={{ height: 3, background: MN.gold, borderRadius: 2, flexShrink: 0 }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — WEATHER CENTER lower-third card
// ═══════════════════════════════════════════════════════════
export function MorningNewsWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location   = config.location || 'Springfield';
  const isCelsius  = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => { fetchWeather(location, isCelsius).then(setWeather); }, [location, isCelsius]);
  const temp = weather ? weather.temp : (config.tempF ?? '--');
  const cond = weather ? getWMO(weather.weatherCode).label : (config.condition || 'Loading…');

  const low       = (cond || '').toLowerCase();
  const isSnow    = low.includes('snow') || low.includes('flurr');
  const isStorm   = low.includes('storm') || low.includes('thunder');
  const isRain    = !isSnow && !isStorm && (low.includes('rain') || low.includes('drizzle') || low.includes('shower'));
  const isOvercast= !isRain && !isSnow && !isStorm && (low.includes('overcast') || low.includes('cloudy'));
  const isClear   = !isOvercast && !isRain && !isSnow && !isStorm && (low.includes('clear') || low.includes('sun') || low.includes('fair'));

  // Condition icon in SVG (viewBox 0 0 80 80)
  const CondIcon = () => {
    if (isClear) return (
      <g>
        <circle cx="40" cy="40" r="18" fill={MN.gold} />
        {[0,45,90,135,180,225,270,315].map(d => {
          const r = (d * Math.PI) / 180;
          return <line key={d} x1={40+Math.cos(r)*22} y1={40+Math.sin(r)*22}
            x2={40+Math.cos(r)*30} y2={40+Math.sin(r)*30}
            stroke={MN.gold} strokeWidth="3" strokeLinecap="round" />;
        })}
      </g>
    );
    if (isStorm) return (
      <g>
        <ellipse cx="40" cy="30" rx="26" ry="14" fill={MN.inkSoft} />
        <path d="M42 38 L34 54 L44 50 L36 68" stroke={MN.gold} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
    if (isSnow) return (
      <g>
        <ellipse cx="40" cy="32" rx="22" ry="14" fill="#CBD5E1" />
        {[[28,54],[40,58],[52,54]].map(([x,y],i) => (
          <g key={i}>
            <line x1={x} y1={y-8} x2={x} y2={y+8} stroke={MN.sky} strokeWidth="2.5" strokeLinecap="round"/>
            <line x1={x-6} y1={y} x2={x+6} y2={y} stroke={MN.sky} strokeWidth="2.5" strokeLinecap="round"/>
          </g>
        ))}
      </g>
    );
    if (isRain) return (
      <g>
        <circle cx="56" cy="26" r="12" fill={MN.gold} opacity="0.7" />
        <ellipse cx="36" cy="34" rx="22" ry="12" fill="#93C5FD" />
        {[[28,52],[38,56],[48,52],[34,62],[44,66]].map(([x,y],i)=>(
          <line key={i} x1={x} y1={y} x2={x-3} y2={y+10} stroke={MN.sky} strokeWidth="2" strokeLinecap="round"/>
        ))}
      </g>
    );
    if (isOvercast) return (
      <g>
        <ellipse cx="40" cy="36" rx="28" ry="16" fill={MN.inkSoft} opacity="0.6" />
        <ellipse cx="36" cy="42" rx="22" ry="14" fill="#94A3B8" />
      </g>
    );
    // Partly cloudy default
    return (
      <g>
        <circle cx="52" cy="28" r="14" fill={MN.gold} />
        <ellipse cx="34" cy="40" rx="22" ry="14" fill="#93C5FD" />
      </g>
    );
  };

  return (
    <div className="absolute inset-0" style={{
      background: MN.anchorBlue,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        background: MN.sky,
        padding: '2% 4%',
        flex: '0 0 18%',
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
      }}>
        <FitText max={32} min={8} wrap={false} center={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper, letterSpacing: '0.1em' }}>
          WEATHER CENTER
        </FitText>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', padding: '3% 4%', gap: '4%' }}>
        {/* Condition SVG */}
        <svg viewBox="0 0 80 80" style={{ height: '80%', aspectRatio: '1', flexShrink: 0 }}>
          <CondIcon />
        </svg>

        {/* Temp */}
        <div style={{ flex: '0 0 40%', height: '85%', minWidth: 0 }}>
          <FitText max={160} min={20} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper, letterSpacing: '-0.04em' }}>
            {temp}°
          </FitText>
        </div>

        {/* Condition label + location */}
        {!compact && (
          <div style={{ flex: 1, minWidth: 0, height: '80%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: '1 1 55%', minHeight: 0 }}>
              <FitText max={36} min={8}
                style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: MN.gold }}>
                {cond}
              </FitText>
            </div>
            <div style={{ flex: '1 1 45%', minHeight: 0 }}>
              <FitText max={24} min={7}
                style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 500, color: MN.inkSoft }}>
                {location}
              </FitText>
            </div>
          </div>
        )}
      </div>

      {/* Gold bottom rule */}
      <div style={{ height: 3, background: MN.gold, flexShrink: 0 }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — red breaking-news countdown badge
// ═══════════════════════════════════════════════════════════
export function MorningNewsCountdown({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target   = resolved?.target ?? new Date(Date.now() + 7 * 86400000);
  const label    = config.label || resolved?.prefix || 'COUNTDOWN TO FIELD TRIP';
  const diff     = Math.max(0, target.getTime() - now.getTime());
  const days     = Math.floor(diff / 86400000);
  const hours    = Math.floor((diff % 86400000) / 3600000);
  const mins     = Math.floor((diff % 3600000) / 60000);
  const bigNum   = days > 0 ? days : hours > 0 ? hours : mins;
  const unit     = days > 0 ? (days === 1 ? 'DAY' : 'DAYS') : hours > 0 ? (hours === 1 ? 'HOUR' : 'HOURS') : 'MIN';

  return (
    <div className="absolute inset-0" style={{
      background: MN.liveRed,
      display: 'flex',
      flexDirection: 'column',
      padding: '4%',
      boxSizing: 'border-box',
      boxShadow: `inset 0 0 0 4px ${MN.gold}`,
    }}>
      {/* Breaking label */}
      <div style={{ flex: '0 0 16%', minHeight: 0, display: 'flex', alignItems: 'center', gap: '3%' }}>
        <div style={{
          background: MN.paper,
          padding: '0 3%',
          borderRadius: 3,
          height: '80%',
          display: 'flex',
          alignItems: 'center',
        }}>
          <FitText max={22} min={7} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 900, color: MN.liveRed, letterSpacing: '0.06em' }}>
            BREAKING
          </FitText>
        </div>
      </div>

      {/* Big number */}
      <div style={{ flex: !compact ? '0 0 50%' : '1 1 70%', minHeight: 0 }}>
        <FitText max={280} min={28} wrap={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 900, color: MN.paper, letterSpacing: '-0.04em' }}>
          {bigNum}
        </FitText>
      </div>

      {/* Unit */}
      <div style={{ flex: '0 0 14%', minHeight: 0 }}>
        <FitText max={52} min={8} wrap={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.gold, letterSpacing: '0.12em' }}>
          {unit}
        </FitText>
      </div>

      {/* Editable label */}
      {!compact && (
        <div style={{ flex: 1, minHeight: 0, borderTop: `2px solid rgba(255,255,255,0.25)`, paddingTop: '2%' }}>
          <EditableText
            configKey="label" onConfigChange={onConfigChange}
            max={48} min={7} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: 'rgba(255,255,255,0.8)', letterSpacing: '0.04em' }}
          >
            {label}
          </EditableText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — chyron / lower-third banner
// ═══════════════════════════════════════════════════════════
export function MorningNewsAnnouncement({
  config, compact, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const category = config.title   || config.category || 'SCHOOL NEWS';
  const message  = config.message || config.body     || 'Yearbook orders are due by the end of the month — visit the main office.';

  return (
    <div className="absolute inset-0 flex flex-col justify-end" style={{ padding: 0 }}>
      {/* Gold accent bar */}
      <div style={{ height: '6%', minHeight: 4, background: MN.gold, width: '100%' }} />

      {/* Category + message row */}
      <div style={{ display: 'flex', width: '100%', flex: '0 0 44%', minHeight: 0 }}>
        {/* Red category block */}
        <div style={{
          background: MN.liveRed,
          minWidth: '20%',
          maxWidth: '30%',
          padding: '2% 3%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <EditableText
            configKey="title" onConfigChange={onConfigChange}
            max={36} min={7} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper, letterSpacing: '0.06em' }}
          >
            {category}
          </EditableText>
        </div>
        {/* White message body */}
        <div style={{
          background: MN.paper,
          flex: 1,
          minWidth: 0,
          padding: '2% 3%',
          display: 'flex',
          alignItems: 'center',
        }}>
          <EditableText
            configKey="message" onConfigChange={onConfigChange}
            max={80} min={8}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 500, color: MN.ink }}
          >
            {message}
          </EditableText>
        </div>
      </div>

      {/* Navy sub-bar */}
      {!compact && (
        <div style={{
          background: MN.anchorBlue,
          height: '18%',
          minHeight: 0,
          width: '100%',
          padding: '1% 4%',
          display: 'flex',
          alignItems: 'center',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: MN.liveRed, marginRight: '2%', flexShrink: 0 }} />
          <FitText max={22} min={6} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: MN.inkSoft, letterSpacing: '0.08em' }}>
            STUDENT BROADCAST NETWORK
          </FitText>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — COMING UP segments with colored vertical bars
// ═══════════════════════════════════════════════════════════
export function MorningNewsCalendar({ config }: { config: any; compact?: boolean }) {
  const events = (config.events?.length ? config.events : [
    { date: 'MON · 8:00 AM',  title: 'Morning Announcements Live' },
    { date: 'WED · 12:30 PM', title: 'Student Council Meeting' },
    { date: 'FRI · 2:45 PM',  title: 'Spirit Week Kickoff Assembly' },
  ]).slice(0, Math.max(1, Math.min(6, config.maxEvents ?? 3)));

  const barColors = [MN.liveRed, MN.sky, MN.gold];

  return (
    <div className="absolute inset-0" style={{
      background: MN.anchorBlue,
      display: 'flex',
      flexDirection: 'column',
      padding: '3%',
      boxSizing: 'border-box',
      gap: '0',
    }}>
      {/* Header */}
      <div style={{
        flex: '0 0 16%', minHeight: 0,
        borderBottom: `2px solid ${MN.gold}`,
        marginBottom: '3%',
        display: 'flex',
        alignItems: 'center',
        gap: '2%',
      }}>
        <div style={{ width: 4, height: '60%', background: MN.liveRed, borderRadius: 2, flexShrink: 0 }} />
        <FitText max={30} min={8} wrap={false} center={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper, letterSpacing: '0.1em' }}>
          COMING UP
        </FitText>
      </div>

      {/* Events */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3%' }}>
        {events.map((e: any, i: number) => (
          <div key={i} style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'stretch',
            gap: '3%',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 4,
            overflow: 'hidden',
            padding: '1% 2%',
          }}>
            {/* Colored vertical bar */}
            <div style={{
              width: 5,
              background: barColors[i % barColors.length],
              borderRadius: 3,
              flexShrink: 0,
            }} />
            {/* Text stack */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: '0 0 38%', minHeight: 0 }}>
                <FitText max={22} min={6} wrap={false} center={false}
                  style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: barColors[i % barColors.length], letterSpacing: '0.06em' }}>
                  {e.date}
                </FitText>
              </div>
              <div style={{ flex: '1 1 62%', minHeight: 0 }}>
                <FitText max={40} min={8} wrap={false} center={false}
                  style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.paper }}>
                  {e.title}
                </FitText>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF SPOTLIGHT — anchor card: portrait + spotlight label
// ═══════════════════════════════════════════════════════════
export function MorningNewsStaffSpotlight({
  config, onConfigChange,
}: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name     = config.staffName || config.name || 'Ms. Rivera';
  const role     = config.role      || 'Teacher Spotlight';
  const bio      = config.bio       || config.quote || '"Every student has a story worth telling."';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;

  return (
    <div className="absolute inset-0" style={{
      background: MN.anchorBlue,
      display: 'flex',
      alignItems: 'stretch',
      overflow: 'hidden',
    }}>
      {/* Portrait left */}
      <div style={{
        flexShrink: 0,
        width: '38%',
        background: MN.tickerBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {photoUrl ? (
          <img src={resolveUrl(photoUrl)} alt={name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <svg viewBox="0 0 100 100" style={{ width: '60%', height: '60%', opacity: 0.4 }}>
            <circle cx="50" cy="38" r="22" fill={MN.inkSoft} />
            <ellipse cx="50" cy="85" rx="32" ry="22" fill={MN.inkSoft} />
          </svg>
        )}
        {/* Dark gradient over bottom of photo */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%',
          background: 'linear-gradient(to top, rgba(2,6,23,0.8), transparent)',
        }} />
      </div>

      {/* Text panel right */}
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '5% 5% 4% 5%',
        gap: '4%',
      }}>
        {/* TEACHER SPOTLIGHT label */}
        <div style={{ flex: '0 0 16%', minHeight: 0 }}>
          <FitText max={22} min={6} wrap={false} center={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.liveRed, letterSpacing: '0.1em' }}>
            TEACHER SPOTLIGHT
          </FitText>
        </div>

        {/* Name + red underline */}
        <div style={{ flex: '0 0 30%', minHeight: 0 }}>
          <EditableText
            configKey="staffName" onConfigChange={onConfigChange}
            max={100} min={10} wrap={false} center={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 800, color: MN.paper }}
          >
            {name}
          </EditableText>
        </div>
        <div style={{ height: 3, background: MN.liveRed, borderRadius: 2, flexShrink: 0, width: '80%' }} />

        {/* Role */}
        <div style={{ flex: '0 0 14%', minHeight: 0 }}>
          <EditableText
            configKey="role" onConfigChange={onConfigChange}
            max={48} min={7} wrap={false} center={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: MN.gold, letterSpacing: '0.04em' }}
          >
            {role}
          </EditableText>
        </div>

        {/* Bio / quote */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <EditableText
            configKey="bio" onConfigChange={onConfigChange}
            max={60} min={7} center={false}
            style={{ fontFamily: MN_FONT_SERIF, fontStyle: 'italic', color: MN.inkSoft }}
          >
            {bio}
          </EditableText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — TV-set frame with scanlines + corner badge
// ═══════════════════════════════════════════════════════════
export function MorningNewsImageCarousel({ config }: { config: any; compact?: boolean }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0
    ? config.urls
    : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  const hasImage = urls.length > 0;

  return (
    <div className="absolute inset-0" style={{
      background: MN.ink,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3%',
      boxSizing: 'border-box',
    }}>
      {/* Outer TV bezel */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        border: `4px solid ${MN.inkSoft}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: MN.ink,
      }}>
        {hasImage ? (
          <img src={resolveUrl(urls[idx])} alt="Broadcast"
            className="transition-opacity duration-700"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(255,255,255,0.03) 2px,
              rgba(255,255,255,0.03) 4px
            ), linear-gradient(135deg, ${MN.tickerBg} 0%, ${MN.anchorBlue} 100%)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {/* Color bars placeholder — classic broadcast test card */}
            <div style={{ display: 'flex', width: '70%', height: '40%', gap: 2, marginBottom: '4%' }}>
              {['#EAB308','#22D3EE','#22C55E','#A855F7','#EF4444','#3B82F6','#F97316'].map((c, i) => (
                <div key={i} style={{ flex: 1, background: c, borderRadius: 2 }} />
              ))}
            </div>
            <FitText max={28} min={8} wrap={false}
              style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.inkSoft, letterSpacing: '0.06em' }}>
              ADD PHOTOS TO BROADCAST
            </FitText>
          </div>
        )}

        {/* CRT scanline overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(0,0,0,0.08) 3px,
            rgba(0,0,0,0.08) 4px
          )`,
        }} />

        {/* SD/HD corner badge */}
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: MN.anchorBlue,
          border: `1px solid ${MN.gold}`,
          borderRadius: 3,
          padding: '2px 6px',
        }}>
          <span style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, fontSize: 10, color: MN.gold, letterSpacing: '0.06em' }}>
            HD
          </span>
        </div>

        {/* Dot indicator for multi-image */}
        {urls.length > 1 && (
          <div style={{
            position: 'absolute', bottom: 8, left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: 4,
          }}>
            {urls.map((_, i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i === idx ? MN.gold : MN.inkSoft,
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — cable-news scrolling red banner with LIVE badge
// ═══════════════════════════════════════════════════════════
export function MorningNewsTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages: string[] = config.messages?.length
    ? config.messages
    : ['Student council elections next Tuesday · Spirit wear orders close Friday · Drama club auditions in Room 204'];
  const speed = (config.speed as string) || 'medium';
  const secs  = speed === 'fast' ? 4 : speed === 'slow' ? 10 : 7;
  const [idx, setIdx] = useState(0);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % messages.length), secs * 1000);
    return () => clearInterval(t);
  }, [messages.length, secs]);

  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 800);
    return () => clearInterval(t);
  }, []);

  const primary = messages[idx % messages.length];

  return (
    <div className="absolute inset-0" style={{
      background: MN.tickerBg,
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
    }}>
      {/* LIVE badge left */}
      <div style={{
        flexShrink: 0,
        height: '100%',
        background: MN.liveRed,
        display: 'flex',
        alignItems: 'center',
        padding: '0 4%',
        gap: '6%',
        minWidth: compact ? '14%' : '12%',
      }}>
        {/* Blink dot */}
        <div style={{
          width: compact ? 8 : 10,
          height: compact ? 8 : 10,
          borderRadius: '50%',
          background: blink ? MN.paper : 'transparent',
          border: `2px solid ${MN.paper}`,
          flexShrink: 0,
          transition: 'background 0.2s',
        }} />
        <FitText max={32} min={8} wrap={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 900, color: MN.paper, letterSpacing: '0.1em' }}>
          LIVE
        </FitText>
      </div>

      {/* Gold divider */}
      <div style={{ width: 3, height: '60%', background: MN.gold, flexShrink: 0 }} />

      {/* Scrolling message */}
      <div style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        padding: '0 3%',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}>
        <FitText max={compact ? 28 : 36} min={8} wrap={false}
          style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 600, color: MN.paper, letterSpacing: '0.01em' }}>
          {primary}
        </FitText>
      </div>

      {/* Right station ID */}
      {!compact && (
        <div style={{
          flexShrink: 0,
          height: '100%',
          padding: '0 3%',
          display: 'flex',
          alignItems: 'center',
          borderLeft: `1px solid ${MN.inkSoft}`,
        }}>
          <FitText max={18} min={7} wrap={false}
            style={{ fontFamily: MN_FONT_DISPLAY, fontWeight: 700, color: MN.gold, letterSpacing: '0.06em' }}>
            SBN
          </FitText>
        </div>
      )}
    </div>
  );
}
