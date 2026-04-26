"use client";

/**
 * Back to School — scene-integrated widget theme.
 *
 * Unlike "themed cards" (which wrap each widget in a glass panel),
 * Back to School widgets render AS scene elements. The template's
 * background already paints a hand-drawn classroom (chalkboard, wall
 * clock, bulletin board, alphabet wall, desk, plants). Widgets here
 * have NO card chrome — they paint their data DIRECTLY where the zone
 * is positioned, blending into the illustration:
 *
 *   - TEXT  → white chalk handwriting on the chalkboard
 *   - CLOCK → analog clock hands rotating on the wall clock
 *   - ANNOUNCEMENT → sticky note pinned to the bulletin board
 *   - CALENDAR → lined notebook page on the desk
 *   - STAFF  → polaroid pinned with washi tape
 *   - LOGO   → school crest sticker
 *   - COUNTDOWN → chalk countdown on the small chalkboard
 *   - TICKER → paper banner garland strung across the top
 *   - WEATHER → small wall sign
 *   - IMAGE_CAROUSEL → bulletin board photos
 */

import { useEffect, useState } from 'react';
import { EditableText } from './EditableText';

// ─── Palette pulled from the scene illustration ─────────────────────────
export const BTS = {
  chalkboard:    '#3F6D52',
  chalkboardDk:  '#345C44',
  chalk:         '#F8F6EE',
  chalkSoft:     'rgba(248,246,238,0.78)',
  wallCream:     '#FFF7DC',
  woodLight:     '#E8B27D',
  woodMid:       '#C88B5C',
  paperYellow:   '#FFE587',
  paperPink:     '#FFC9D2',
  paperGreen:    '#C8E5B0',
  inkDark:       '#3A3A3A',
  red:           '#E25C56',
  green:         '#7AB17A',
  tape:          'rgba(255,220,120,0.55)',
};

export const BTS_FONT_HAND    = "var(--font-caveat), 'Segoe Script', cursive";
export const BTS_FONT_DISPLAY = "var(--font-fredoka), ui-rounded, system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════════════════
// CHALKBOARD TEXT — replaces the chalkboard's "Back to School" content
// Renders directly on the chalkboard background — NO card.
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolText({ config, onConfigChange }: { config: any; onConfigChange?: (patch: Record<string, any>) => void }) {
  const content = config.content || 'Back to School';
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  return (
    <div className="absolute inset-0 overflow-hidden" style={{
      // Paint the actual chalkboard surface here so the widget reads as a real chalkboard
      // even when the scene SVG behind it is partially obscured.
      background: `
        radial-gradient(ellipse at 30% 40%, rgba(255,255,255,0.06) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 70%, rgba(0,0,0,0.10) 0%, transparent 55%),
        linear-gradient(135deg, #3F6D52 0%, #345C44 60%, #2D4F3A 100%)`,
      borderRadius: 10,
      boxShadow: 'inset 0 0 60px rgba(0,0,0,0.30), inset 0 4px 18px rgba(0,0,0,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '4% 6%',
    }}>
      {/* faint chalk dust at the bottom edge */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: '14%',
        background: 'linear-gradient(180deg, transparent 0%, rgba(248,246,238,0.10) 100%)',
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', width: '100%' }}>
        <EditableText
          configKey="content" onConfigChange={onConfigChange}
          max={240} min={16} wrap={true}
          style={{
            fontFamily: BTS_FONT_HAND,
            fontSize: '4.2em',
            fontWeight: 700,
            color: BTS.chalk,
            textShadow: `
              0 0 2px rgba(248,246,238,0.55),
              0 0 12px rgba(248,246,238,0.18),
              1px 1px 0 rgba(0,0,0,0.18),
              0 -1px 0 rgba(248,246,238,0.10)`,
            letterSpacing: '0.015em',
            filter: 'drop-shadow(0 0 0.5px rgba(248,246,238,0.6))',
          }}
        >
          {content}
        </EditableText>
      </div>
      <style>{`@keyframes bts-chalkin { 0%{opacity:0;filter:blur(4px)} 100%{opacity:1;filter:blur(0)} }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// WALL CLOCK — analog clock with rotating hands. Round face, no card.
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolClock({ config }: { config: any }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  const h = parseInt(fmt({ hour: 'numeric', hour12: false }), 10) % 12;
  const m = parseInt(fmt({ minute: 'numeric' }), 10);
  const s = parseInt(fmt({ second: 'numeric' }), 10);
  const hourDeg = (h * 30) + (m * 0.5);
  const minDeg  = m * 6;
  const secDeg  = s * 6;

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-visible">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {/* outer wood frame */}
        <circle cx="50" cy="50" r="48" fill={BTS.woodMid} stroke={BTS.woodLight} strokeWidth="1.5" />
        {/* inner face */}
        <circle cx="50" cy="50" r="42" fill={BTS.wallCream} stroke="#3A3A3A" strokeWidth="1" />
        {/* hour ticks */}
        {[...Array(12)].map((_, i) => {
          const a = (i * 30) * Math.PI / 180;
          const x1 = 50 + Math.sin(a) * 36;
          const y1 = 50 - Math.cos(a) * 36;
          const x2 = 50 + Math.sin(a) * 40;
          const y2 = 50 - Math.cos(a) * 40;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={BTS.inkDark} strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round" />;
        })}
        {/* numerals 12 / 3 / 6 / 9 */}
        <text x="50" y="16" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={BTS_FONT_DISPLAY} fill={BTS.inkDark}>12</text>
        <text x="84" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={BTS_FONT_DISPLAY} fill={BTS.inkDark}>3</text>
        <text x="50" y="86" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={BTS_FONT_DISPLAY} fill={BTS.inkDark}>6</text>
        <text x="16" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={BTS_FONT_DISPLAY} fill={BTS.inkDark}>9</text>
        {/* hour hand */}
        <line x1="50" y1="50" x2="50" y2="28" stroke={BTS.inkDark} strokeWidth="3" strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
        {/* minute hand */}
        <line x1="50" y1="50" x2="50" y2="18" stroke={BTS.inkDark} strokeWidth="2" strokeLinecap="round" transform={`rotate(${minDeg} 50 50)`} />
        {/* second hand */}
        <line x1="50" y1="50" x2="50" y2="14" stroke={BTS.red} strokeWidth="1" strokeLinecap="round" transform={`rotate(${secDeg} 50 50)`} />
        {/* center cap */}
        <circle cx="50" cy="50" r="2.5" fill={BTS.inkDark} />
        <circle cx="50" cy="50" r="1" fill={BTS.red} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STICKY NOTE — for ANNOUNCEMENT. Rotated paper square pinned with tape.
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolAnnouncement({ config, onConfigChange }: { config: any; onConfigChange?: (patch: Record<string, any>) => void }) {
  const title = config.title || 'Big news today!';
  const body  = config.message || config.body || 'Tap to edit. Write your announcement here.';
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-visible" style={{ padding: '6%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: `linear-gradient(135deg, ${BTS.paperYellow} 0%, #FFD96B 100%)`,
        boxShadow: '0 14px 28px rgba(0,0,0,0.18), inset 0 -8px 16px rgba(0,0,0,0.04)',
        transform: 'rotate(-1.8deg)',
        padding: '6% 7%',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        fontFamily: BTS_FONT_HAND,
      }}>
        {/* washi tape — top center */}
        <div style={{
          position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%) rotate(-3deg)',
          width: '24%', height: '14px',
          background: BTS.tape,
          boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
        }} />
        <div style={{ flex: '0 0 auto', marginBottom: '0.3em' }}>
          <EditableText
            configKey="title" onConfigChange={onConfigChange}
            max={120} min={12} wrap={false}
            style={{
              fontFamily: BTS_FONT_HAND,
              fontSize: '2.4em',
              fontWeight: 700,
              color: BTS.inkDark,
              lineHeight: 1.1,
              letterSpacing: '0.01em',
            }}
          >
            {title}
          </EditableText>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <EditableText
            configKey="message" onConfigChange={onConfigChange}
            max={180} min={10} wrap={true}
            style={{
              fontFamily: BTS_FONT_HAND,
              fontSize: '1.4em',
              fontWeight: 600,
              color: BTS.inkDark,
              opacity: 0.85,
              lineHeight: 1.35,
            }}
          >
            {body}
          </EditableText>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// NOTEBOOK CALENDAR — lined paper with events as bulleted entries
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolCalendar({ config }: { config: any }) {
  const events = config.events || [
    { date: 'Today',    title: 'Spring Concert' },
    { date: 'Tomorrow', title: 'PTA Meeting' },
    { date: 'Fri',      title: 'Picture Day' },
    { date: 'Sat',      title: 'Field Trip' },
  ];
  return (
    <div className="absolute inset-0 flex" style={{ padding: '4%' }}>
      <div style={{
        width: '100%', height: '100%',
        background: `repeating-linear-gradient(180deg, transparent 0 22px, rgba(58,58,58,0.12) 22px 23px), ${BTS.wallCream}`,
        borderLeft: `6px solid ${BTS.red}`,
        boxShadow: '0 12px 24px rgba(0,0,0,0.18), 2px 2px 0 rgba(0,0,0,0.05)',
        padding: '5% 6%',
        fontFamily: BTS_FONT_HAND,
        transform: 'rotate(-0.8deg)',
        position: 'relative',
      }}>
        {/* hole punches */}
        <div style={{ position: 'absolute', left: '-3px', top: '15%', width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(0,0,0,0.12)' }} />
        <div style={{ position: 'absolute', left: '-3px', top: '50%', width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(0,0,0,0.12)' }} />
        <div style={{ position: 'absolute', left: '-3px', top: '85%', width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(0,0,0,0.12)' }} />
        <div style={{
          fontSize: '1.4em', fontWeight: 700, color: BTS.red,
          letterSpacing: '0.05em', textTransform: 'uppercase',
          marginBottom: '0.5em', fontFamily: BTS_FONT_DISPLAY,
        }}>★ Upcoming</div>
        {events.slice(0, 5).map((e: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5em', marginBottom: '0.35em', fontSize: '1.4em', color: BTS.inkDark }}>
            <span style={{ color: BTS.red, fontWeight: 700 }}>•</span>
            <span style={{ fontWeight: 700, minWidth: '3.5em' }}>{e.date}</span>
            <span style={{ fontWeight: 600, opacity: 0.85 }}>{e.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// POLAROID STAFF — pinned with washi tape, handwritten caption
// ═══════════════════════════════════════════════════════════════════════
// Friendly cartoon teacher avatar SVG — used when no photoUrl is provided
function TeacherCartoon({ accent = BTS.red }: { accent?: string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
      {/* sky-gradient backdrop */}
      <defs>
        <linearGradient id="bts-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BFE4FF"/>
          <stop offset="100%" stopColor="#FFF1B8"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#bts-sky)"/>
      {/* sun */}
      <circle cx="80" cy="20" r="9" fill="#FCD34D"/>
      {/* hill */}
      <path d="M0,80 Q25,65 50,75 T100,72 L100,100 L0,100 Z" fill="#7AB17A"/>
      {/* shoulders / shirt */}
      <path d="M22,100 Q22,78 50,76 Q78,78 78,100 Z" fill={accent}/>
      <path d="M50,76 L46,86 L50,90 L54,86 Z" fill={BTS.wallCream}/>
      {/* neck */}
      <rect x="46" y="62" width="8" height="14" rx="2" fill="#F2C29B"/>
      {/* face */}
      <ellipse cx="50" cy="48" rx="18" ry="20" fill="#F8D2A8"/>
      {/* hair (bun + side) */}
      <path d="M32,46 Q30,28 50,26 Q70,28 68,46 Q68,38 60,34 Q55,30 50,30 Q45,30 40,34 Q32,38 32,46 Z" fill="#6B3F2A"/>
      <circle cx="50" cy="22" r="6" fill="#6B3F2A"/>
      {/* glasses */}
      <circle cx="42" cy="49" r="5" fill="none" stroke="#3A3A3A" strokeWidth="1.2"/>
      <circle cx="58" cy="49" r="5" fill="none" stroke="#3A3A3A" strokeWidth="1.2"/>
      <line x1="47" y1="49" x2="53" y2="49" stroke="#3A3A3A" strokeWidth="1"/>
      {/* eyes */}
      <circle cx="42" cy="49" r="1.3" fill="#3A3A3A"/>
      <circle cx="58" cy="49" r="1.3" fill="#3A3A3A"/>
      {/* cheeks */}
      <circle cx="36" cy="55" r="2.2" fill="#FFAEB4" opacity="0.7"/>
      <circle cx="64" cy="55" r="2.2" fill="#FFAEB4" opacity="0.7"/>
      {/* smile */}
      <path d="M44,58 Q50,63 56,58" stroke="#3A3A3A" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      {/* earrings */}
      <circle cx="32.5" cy="52" r="1.2" fill={BTS.red}/>
      <circle cx="67.5" cy="52" r="1.2" fill={BTS.red}/>
    </svg>
  );
}

export function BackToSchoolStaff({ config, onConfigChange }: { config: any; onConfigChange?: (patch: Record<string, any>) => void }) {
  const name = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const bio  = config.bio || 'Inspires kids every day with kindness and a big smile!';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: '#FFFCF4',
        boxShadow: '0 16px 30px rgba(0,0,0,0.20)',
        padding: '5%',
        transform: 'rotate(-2.5deg)',
        display: 'flex', flexDirection: 'column',
        fontFamily: BTS_FONT_HAND,
      }}>
        {/* washi tape — top corners */}
        <div style={{ position: 'absolute', top: '-6px', left: '12%', width: '22%', height: '14px', background: BTS.tape, transform: 'rotate(-8deg)' }} />
        <div style={{ position: 'absolute', top: '-6px', right: '12%', width: '22%', height: '14px', background: BTS.tape, transform: 'rotate(8deg)' }} />
        {/* photo area — real photo if provided, otherwise cartoon teacher */}
        <div style={{
          flex: 1,
          marginBottom: '5%',
          overflow: 'hidden',
          background: BTS.wallCream,
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
        }}>
          {photoUrl ? (
            <img src={photoUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <TeacherCartoon />
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.95em', fontWeight: 700, color: BTS.red, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: BTS_FONT_DISPLAY, marginBottom: '0.2em' }}>★<span style={{ marginLeft: '0.3em' }}>
            <EditableText
              configKey="role" onConfigChange={onConfigChange}
              max={90} min={8} wrap={false}
              clickToEdit={!!onConfigChange}
              style={{ fontFamily: BTS_FONT_DISPLAY, color: BTS.red, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 700 }}
            >
              {role}
            </EditableText>
          </span></div>
          <div style={{ fontSize: '1.7em', fontWeight: 700, color: BTS.inkDark, lineHeight: 1.0, marginTop: '0.1em' }}>
            <EditableText
              configKey="staffName" onConfigChange={onConfigChange}
              max={120} min={8} wrap={false}
              style={{ fontFamily: BTS_FONT_HAND, fontWeight: 700, color: BTS.inkDark }}
            >
              {name}
            </EditableText>
          </div>
          <div style={{ fontSize: '1.1em', fontWeight: 600, color: BTS.inkDark, opacity: 0.75, marginTop: '0.2em', lineHeight: 1.25, fontStyle: 'italic' }}>
            "
            <EditableText
              configKey="bio" onConfigChange={onConfigChange}
              max={140} min={10} wrap={true}
              style={{ fontFamily: BTS_FONT_HAND, fontWeight: 600, color: BTS.inkDark, opacity: 0.75, fontStyle: 'italic' }}
            >
              {bio}
            </EditableText>
            "
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CHALK COUNTDOWN — chalk numerals on the small chalkboard area
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolCountdown({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const label = config.label || 'Field Trip in';
  const target = config.targetDate ? new Date(config.targetDate) : new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const days = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 86400000));
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      padding: '6%',
      fontFamily: BTS_FONT_HAND,
      color: BTS.chalk,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.5em', fontWeight: 600, opacity: 0.92, lineHeight: 1, marginBottom: '0.05em', textShadow: '1px 1px 0 rgba(0,0,0,0.12)' }}>{label}</div>
      <div style={{ fontSize: '5em', fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.02em', textShadow: '0 0 1px rgba(248,246,238,0.4), 1px 1px 0 rgba(0,0,0,0.18)' }}>{days}</div>
      <div style={{ fontSize: '1.4em', fontWeight: 600, opacity: 0.85, marginTop: '-0.1em', textShadow: '1px 1px 0 rgba(0,0,0,0.12)', fontFamily: BTS_FONT_DISPLAY, letterSpacing: '0.1em', textTransform: 'uppercase' }}>days</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LOGO — round school crest sticker
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolLogo({ config }: { config: any }) {
  const initials = (config.initials || (config.schoolName || 'School').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()) || 'SE';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <div style={{
        width: '85%', aspectRatio: '1', borderRadius: '50%',
        background: `radial-gradient(circle at 30% 25%, #fff 0%, rgba(255,255,255,0) 50%), ${BTS.red}`,
        border: `4px solid ${BTS.wallCream}`,
        boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: BTS.wallCream, fontWeight: 800, fontSize: '1.6em',
        fontFamily: BTS_FONT_DISPLAY,
        textShadow: '0 2px 4px rgba(0,0,0,0.25)',
      }}>{initials}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAPER BANNER TICKER — letters on hanging triangular pennants
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolTicker({ config }: { config: any }) {
  const messages: string[] = config.messages && config.messages.length ? config.messages : ['Welcome back, students!'];
  const text = messages.join('  ★  ');
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: `repeating-linear-gradient(135deg, ${BTS.paperPink} 0 24px, ${BTS.paperGreen} 24px 48px, ${BTS.paperYellow} 48px 72px)`,
      borderTop: `4px dashed ${BTS.red}`, borderBottom: `4px dashed ${BTS.red}`,
      fontFamily: BTS_FONT_HAND,
    }}>
      <div style={{
        whiteSpace: 'nowrap',
        animation: 'bts-ticker 32s linear infinite',
        fontSize: '1.6em',
        fontWeight: 700,
        color: BTS.inkDark,
        paddingLeft: '100%',
        letterSpacing: '0.02em',
      }}>
        {text}  ★  {text}
      </div>
      <style>{`@keyframes bts-ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// WALL SIGN WEATHER — small wood-framed sign
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolWeather({ config }: { config: any }) {
  const temp = config.tempF || 72;
  const cond = (config.condition || 'Sunny');
  const icon = cond.toLowerCase().includes('rain') ? '🌧️' : cond.toLowerCase().includes('cloud') ? '⛅' : cond.toLowerCase().includes('snow') ? '❄️' : '☀️';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{
        width: '100%', height: '100%',
        background: `linear-gradient(180deg, ${BTS.woodLight} 0%, ${BTS.woodMid} 100%)`,
        border: `3px solid ${BTS.woodMid}`, borderRadius: '8px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.20)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: BTS_FONT_HAND,
        color: BTS.wallCream,
        textShadow: '1px 1px 0 rgba(0,0,0,0.25)',
        padding: '4%',
      }}>
        <div style={{ fontSize: '2.6em', lineHeight: 1, filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.3))' }}>{icon}</div>
        <div style={{ fontSize: '2.4em', fontWeight: 700, lineHeight: 1, marginTop: '0.1em' }}>{temp}°</div>
        <div style={{ fontSize: '1.2em', fontWeight: 600, opacity: 0.92, marginTop: '0.05em' }}>{cond}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// BULLETIN BOARD PHOTOS — IMAGE_CAROUSEL placeholder as pinned photo
// ═══════════════════════════════════════════════════════════════════════
export function BackToSchoolImageCarousel({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: '#FFFCF4',
        boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
        transform: 'rotate(1.5deg)',
        padding: '5%',
        fontFamily: BTS_FONT_HAND,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%) rotate(2deg)', width: '20%', height: '14px', background: BTS.tape }} />
        <div style={{
          width: '90%', flex: 1, marginBottom: '5%',
          background: `repeating-linear-gradient(45deg, ${BTS.paperGreen} 0 18px, #B0D098 18px 36px)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '3em',
        }}>📸</div>
        <div style={{ fontSize: '1.3em', fontWeight: 700, color: BTS.inkDark }}>{config.title || 'Class Photos'}</div>
      </div>
    </div>
  );
}
