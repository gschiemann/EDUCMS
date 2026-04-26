"use client";

/**
 * Modern 2026 — fresh, premium widget variants.
 *
 * Design language:
 *   - Big rounded display font (Fredoka), generous body text
 *   - Soft gradients (indigo, violet, teal, coral, gold)
 *   - Glassmorphism + frosted blurs for depth
 *   - High contrast, WCAG-friendly
 *   - K-12 personality (warm, encouraging) without being childish
 *   - Zero clipart / skeuomorphism
 */

import { useEffect, useState } from 'react';

const FONT_DISPLAY = "var(--font-fredoka), ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif";
const FONT_BODY    = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const C = {
  ink:      '#0F172A',
  inkSoft:  '#334155',
  inkMute:  '#64748B',
  paper:    '#FFFFFF',
  paperSoft:'#F8FAFC',
  border:   '#E2E8F0',
  // brand
  indigo:   '#6366F1',
  violet:   '#A78BFA',
  teal:     '#14B8A6',
  coral:    '#F87171',
  gold:     '#FBBF24',
  lime:     '#A3E635',
  pink:     '#EC4899',
  blue:     '#3B82F6',
  navy:     '#0F172A',
  navyMid:  '#1E293B',
};

// Helper: clock formatter
function useClockNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}
function fmtClock(now: Date, opts: Intl.DateTimeFormatOptions, tz?: string) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
}

// ════════════════════════════════════════════════════════════════════════
// CLOCKS
// ════════════════════════════════════════════════════════════════════════

// 1) Big gradient digital — bold, friendly
export function ClockGradientDigital({ config }: { config: any }) {
  const now = useClockNow();
  const tz = config.timezone;
  const is24 = config.format === '24h';
  const rawHour = parseInt(fmtClock(now, { hour: 'numeric', hour12: false }, tz), 10);
  const ampm = rawHour >= 12 ? 'PM' : 'AM';
  const hours = is24 ? rawHour : (rawHour % 12 || 12);
  const mins = fmtClock(now, { minute: '2-digit' }, tz).padStart(2, '0');
  const date = fmtClock(now, { weekday: 'short', month: 'short', day: 'numeric' }, tz);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden" style={{ background: C.paper, borderRadius: 24, fontFamily: FONT_DISPLAY, padding: '6%' }}>
      <div style={{ fontSize: '0.85em', fontWeight: 600, color: C.inkMute, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.2em' }}>{date}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.1em' }}>
        <span style={{ fontSize: '4.5em', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.04em',
          background: `linear-gradient(135deg, ${C.indigo}, ${C.pink})`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent' }}>
          {hours}:{mins}
        </span>
        {!is24 && <span style={{ fontSize: '1.1em', fontWeight: 700, color: C.inkMute }}>{ampm}</span>}
      </div>
    </div>
  );
}

// 2) Dark pill clock — minimalist
export function ClockDarkPill({ config }: { config: any }) {
  const now = useClockNow();
  const tz = config.timezone;
  const is24 = config.format === '24h';
  const rawHour = parseInt(fmtClock(now, { hour: 'numeric', hour12: false }, tz), 10);
  const hours = is24 ? rawHour : (rawHour % 12 || 12);
  const mins = fmtClock(now, { minute: '2-digit' }, tz).padStart(2, '0');
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ padding: '6%' }}>
      <div style={{
        background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})`,
        borderRadius: 9999, padding: '8% 14%',
        boxShadow: `0 16px 40px rgba(15,23,42,0.30), inset 0 1px 0 rgba(255,255,255,0.08)`,
        fontFamily: FONT_DISPLAY,
        color: 'white',
        display: 'flex', alignItems: 'baseline', gap: '0.05em',
      }}>
        <span style={{ fontSize: '3.6em', fontWeight: 700, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' as any }}>{hours}:{mins}</span>
        {!is24 && <span style={{ fontSize: '1em', fontWeight: 600, color: C.gold, marginLeft: '0.3em' }}>{rawHour >= 12 ? 'PM' : 'AM'}</span>}
      </div>
    </div>
  );
}

// 3) Minimal analog — thin clean lines on white
export function ClockMinimalAnalog({ config }: { config: any }) {
  const now = useClockNow();
  const tz = config.timezone;
  const h = parseInt(fmtClock(now, { hour: 'numeric', hour12: false }, tz), 10) % 12;
  const m = parseInt(fmtClock(now, { minute: 'numeric' }, tz), 10);
  const s = parseInt(fmtClock(now, { second: 'numeric' }, tz), 10);
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
        <circle cx="50" cy="50" r="46" fill="white" stroke={C.border} strokeWidth="1" />
        {[...Array(12)].map((_, i) => {
          const a = (i * 30) * Math.PI / 180;
          const x1 = 50 + Math.sin(a) * 38, y1 = 50 - Math.cos(a) * 38;
          const x2 = 50 + Math.sin(a) * 42, y2 = 50 - Math.cos(a) * 42;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 3 === 0 ? C.ink : C.inkMute} strokeWidth={i % 3 === 0 ? 2 : 0.8} strokeLinecap="round" />;
        })}
        <line x1="50" y1="50" x2="50" y2="26" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${h * 30 + m * 0.5} 50 50)`} />
        <line x1="50" y1="50" x2="50" y2="18" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" transform={`rotate(${m * 6} 50 50)`} />
        <line x1="50" y1="55" x2="50" y2="14" stroke={C.indigo} strokeWidth="1" strokeLinecap="round" transform={`rotate(${s * 6} 50 50)`} />
        <circle cx="50" cy="50" r="2.5" fill={C.indigo} />
      </svg>
    </div>
  );
}

// 4) Stacked date + time card
export function ClockStackedCard({ config }: { config: any }) {
  const now = useClockNow();
  const tz = config.timezone;
  const day = fmtClock(now, { weekday: 'long' }, tz);
  const date = fmtClock(now, { month: 'short', day: 'numeric' }, tz);
  const time = fmtClock(now, { hour: 'numeric', minute: '2-digit', hour12: config.format !== '24h' }, tz);
  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-center overflow-hidden" style={{
      background: `linear-gradient(180deg, ${C.indigo} 0%, ${C.violet} 100%)`,
      borderRadius: 24, fontFamily: FONT_DISPLAY, color: 'white',
      padding: '6%',
      boxShadow: `0 20px 50px ${C.indigo}40`,
    }}>
      <div style={{ fontSize: '0.9em', fontWeight: 700, opacity: 0.9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{day}</div>
      <div style={{ fontSize: '1.4em', fontWeight: 600, opacity: 0.85, marginBottom: '0.3em' }}>{date}</div>
      <div style={{ fontSize: '3.2em', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>{time}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// HEADLINES / TEXT
// ════════════════════════════════════════════════════════════════════════

// 1) Big Bold — massive Fredoka with subtle gradient
export function TextBigBold({ config }: { config: any }) {
  const content = config.content || 'Welcome!';
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ padding: '4% 6%', background: C.paper, borderRadius: 24 }}>
      <p data-field="content" style={{
        fontFamily: FONT_DISPLAY,
        fontSize: '3.8em', fontWeight: 700,
        color: C.ink,
        textAlign: align, lineHeight: 1.05, letterSpacing: '-0.03em',
        margin: 0, width: '100%',
        whiteSpace: 'pre-wrap' as const,
      }}>{content}</p>
    </div>
  );
}

// 2) Gradient Headline — vibrant text
export function TextGradient({ config }: { config: any }) {
  const content = config.content || 'Welcome to school';
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ padding: '4% 6%' }}>
      <p data-field="content" style={{
        fontFamily: FONT_DISPLAY,
        fontSize: '3.6em', fontWeight: 800,
        background: `linear-gradient(135deg, ${C.indigo} 0%, ${C.pink} 50%, ${C.gold} 100%)`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent',
        textAlign: align, lineHeight: 1.05, letterSpacing: '-0.03em',
        margin: 0, width: '100%',
        whiteSpace: 'pre-wrap' as const,
      }}>{content}</p>
    </div>
  );
}

// 3) Highlighted Headline — marker highlight underneath
export function TextHighlight({ config }: { config: any }) {
  const content = config.content || 'Big news!';
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ padding: '4% 6%', background: C.paper, borderRadius: 24 }}>
      <p style={{
        fontFamily: FONT_DISPLAY,
        fontSize: '3em', fontWeight: 700,
        color: C.ink,
        textAlign: align, lineHeight: 1.15, letterSpacing: '-0.02em',
        margin: 0, width: '100%',
        whiteSpace: 'pre-wrap' as const,
      }}>
        <span data-field="content" style={{ background: `linear-gradient(180deg, transparent 60%, ${C.gold}80 60%)`, padding: '0 0.15em' }}>
          {content}
        </span>
      </p>
    </div>
  );
}

// 4) Outlined Headline — bold stroke
export function TextOutlined({ config }: { config: any }) {
  const content = config.content || 'School Spirit';
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ padding: '4% 6%' }}>
      <p data-field="content" style={{
        fontFamily: FONT_DISPLAY,
        fontSize: '4em', fontWeight: 800,
        color: 'white',
        WebkitTextStroke: `3px ${C.ink}`,
        textAlign: align, lineHeight: 1.0, letterSpacing: '-0.03em',
        margin: 0, width: '100%',
        textShadow: `4px 4px 0 ${C.gold}, 8px 8px 0 ${C.coral}`,
        whiteSpace: 'pre-wrap' as const,
      }}>{content}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ════════════════════════════════════════════════════════════════════════

// 1) Modern Card — soft pastel gradient w/ accent bar
export function AnnouncementModernCard({ config }: { config: any }) {
  const title = config.title || 'Big news today!';
  const body = config.message || config.body || 'Tap to edit.';
  const badge = config.badgeLabel || '📣 Announcement';
  return (
    <div className="absolute inset-0 overflow-hidden flex" style={{
      background: `linear-gradient(135deg, #FFFFFF 0%, ${C.paperSoft} 100%)`,
      borderRadius: 24, boxShadow: `0 12px 32px rgba(15,23,42,0.10)`,
      fontFamily: FONT_BODY,
    }}>
      <div style={{ width: 8, flexShrink: 0, background: `linear-gradient(180deg, ${C.indigo}, ${C.pink})` }} />
      <div className="flex-1 flex flex-col justify-center" style={{ padding: '5% 6%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85em', fontWeight: 700,
          background: `${C.indigo}15`, color: C.indigo,
          padding: '0.4em 0.9em', borderRadius: 999, width: 'fit-content', marginBottom: '0.8em',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>{badge}</div>
        <div style={{ fontSize: '2.2em', fontWeight: 700, color: C.ink, lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '0.4em', fontFamily: FONT_DISPLAY }}>{title}</div>
        <div style={{ fontSize: '1.15em', fontWeight: 500, color: C.inkSoft, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

// 2) Spotlight — bold full-width with white-on-color
export function AnnouncementSpotlight({ config }: { config: any }) {
  const title = config.title || 'Important update';
  const body = config.message || config.body || 'Tap to edit.';
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col justify-center" style={{
      background: `linear-gradient(135deg, ${C.indigo} 0%, ${C.pink} 100%)`,
      borderRadius: 24, padding: '6%',
      fontFamily: FONT_DISPLAY, color: 'white',
      boxShadow: `0 20px 50px ${C.indigo}40`,
    }}>
      <div style={{ fontSize: '0.9em', fontWeight: 700, opacity: 0.9, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.4em' }}>📣 Spotlight</div>
      <div style={{ fontSize: '2.6em', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', marginBottom: '0.4em' }}>{title}</div>
      <div style={{ fontSize: '1.25em', fontWeight: 500, opacity: 0.95, lineHeight: 1.45, fontFamily: FONT_BODY }}>{body}</div>
    </div>
  );
}

// 3) Glass Card
export function AnnouncementGlass({ config }: { config: any }) {
  const title = config.title || 'Welcome!';
  const body = config.message || config.body || 'Soft, modern, frosted.';
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col justify-center" style={{
      background: 'rgba(255,255,255,0.65)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.8)',
      borderRadius: 28, padding: '6%',
      boxShadow: `0 16px 50px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.5)`,
      fontFamily: FONT_DISPLAY, color: C.ink,
    }}>
      <div style={{ fontSize: '2.4em', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em', marginBottom: '0.4em' }}>{title}</div>
      <div style={{ fontSize: '1.2em', fontWeight: 500, color: C.inkSoft, lineHeight: 1.5, fontFamily: FONT_BODY }}>{body}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// TICKERS
// ════════════════════════════════════════════════════════════════════════

// 1) Modern LED — dark with gradient text
export function TickerLed({ config }: { config: any }) {
  const messages: string[] = config.messages?.length ? config.messages : ['Welcome back!'];
  const text = messages.join('   ●   ');
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: `linear-gradient(90deg, ${C.navy}, ${C.navyMid})`,
      borderRadius: 14,
      fontFamily: FONT_DISPLAY,
      boxShadow: `inset 0 2px 8px rgba(0,0,0,0.30)`,
    }}>
      <div style={{
        whiteSpace: 'nowrap',
        animation: 'mod-tk 30s linear infinite',
        fontSize: '1.5em', fontWeight: 700, letterSpacing: '0.02em',
        background: `linear-gradient(90deg, ${C.gold}, ${C.coral}, ${C.gold})`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent',
        paddingLeft: '100%',
      }}>
        {text}   ●   {text}
      </div>
      <style>{`@keyframes mod-tk { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
    </div>
  );
}

// 2) Pastel Soft Ticker
export function TickerPastel({ config }: { config: any }) {
  const messages: string[] = config.messages?.length ? config.messages : ['Welcome back!'];
  const text = messages.join('   ★   ');
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: `linear-gradient(90deg, #E0E7FF, #FCE7F3, #FEF3C7)`,
      borderRadius: 14,
      fontFamily: FONT_DISPLAY,
    }}>
      <div style={{
        whiteSpace: 'nowrap',
        animation: 'mod-tk2 32s linear infinite',
        fontSize: '1.4em', fontWeight: 700,
        color: C.ink,
        paddingLeft: '100%',
      }}>
        {text}   ★   {text}
      </div>
      <style>{`@keyframes mod-tk2 { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
    </div>
  );
}

// 3) Alert Ticker — for emergency-style updates
export function TickerAlert({ config }: { config: any }) {
  const messages: string[] = config.messages?.length ? config.messages : ['Important update'];
  const text = messages.join('   ⚠   ');
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: `repeating-linear-gradient(45deg, ${C.coral} 0 12px, #DC2626 12px 24px)`,
      borderRadius: 12,
      fontFamily: FONT_DISPLAY,
    }}>
      <div style={{
        whiteSpace: 'nowrap',
        animation: 'mod-tk3 22s linear infinite',
        fontSize: '1.5em', fontWeight: 800,
        color: 'white',
        paddingLeft: '100%',
        textShadow: '0 2px 6px rgba(0,0,0,0.3)',
      }}>
        ⚠   {text}   ⚠   {text}
      </div>
      <style>{`@keyframes mod-tk3 { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHTS
// ════════════════════════════════════════════════════════════════════════

// 1) Modern Profile Card
export function StaffModernCard({ config }: { config: any }) {
  const name = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const bio = config.bio || 'Inspiring kids every day.';
  const photoUrl = config.photoUrl;
  const initials = name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col" style={{
      background: C.paper, borderRadius: 24, padding: '6%',
      fontFamily: FONT_DISPLAY,
      boxShadow: `0 12px 32px rgba(15,23,42,0.10)`,
    }}>
      <div style={{
        background: `${C.indigo}10`, color: C.indigo,
        fontSize: '0.8em', fontWeight: 700, padding: '0.4em 0.8em', borderRadius: 999, width: 'fit-content',
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.8em',
      }}>★ {role}</div>
      <div style={{ display: 'flex', gap: '5%', flex: 1, alignItems: 'center' }}>
        <div style={{ width: '5em', height: '5em', borderRadius: '50%', flexShrink: 0,
          background: photoUrl ? `url(${photoUrl}) center/cover` : `linear-gradient(135deg, ${C.indigo}, ${C.pink})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: '1.6em',
          boxShadow: `0 6px 16px ${C.indigo}30`,
        }}>{!photoUrl && initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '1.8em', fontWeight: 700, color: C.ink, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{name}</div>
          <div style={{ fontSize: '1.05em', fontWeight: 500, color: C.inkSoft, marginTop: '0.3em', lineHeight: 1.4, fontFamily: FONT_BODY }}>{bio}</div>
        </div>
      </div>
    </div>
  );
}

// 2) Hero Banner — large photo area with overlay
export function StaffHero({ config }: { config: any }) {
  const name = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const photoUrl = config.photoUrl;
  const initials = name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col justify-end" style={{
      background: photoUrl ? `url(${photoUrl}) center/cover` : `linear-gradient(135deg, ${C.violet}, ${C.indigo}, ${C.teal})`,
      borderRadius: 24,
      fontFamily: FONT_DISPLAY,
      position: 'relative',
    }}>
      {!photoUrl && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '4em' }}>{initials}</div>
      )}
      <div style={{
        background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.75) 100%)',
        padding: '8% 6% 6%', color: 'white',
      }}>
        <div style={{ fontSize: '0.85em', fontWeight: 700, opacity: 0.9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>★ {role}</div>
        <div style={{ fontSize: '2.2em', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', marginTop: '0.2em' }}>{name}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// COUNTDOWNS
// ════════════════════════════════════════════════════════════════════════

// 1) Big Number — minimalist huge number
export function CountdownBigNumber({ config }: { config: any }) {
  const label = config.label || 'Countdown';
  const target = config.targetDate ? new Date(config.targetDate) : new Date(Date.now() + 12 * 86400000);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const days = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 86400000));
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden" style={{
      background: C.paper, borderRadius: 24, fontFamily: FONT_DISPLAY,
      padding: '6%',
      boxShadow: `0 12px 32px rgba(15,23,42,0.08)`,
    }}>
      <div style={{ fontSize: '0.9em', fontWeight: 700, color: C.inkMute, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.2em' }}>{label}</div>
      <div style={{ fontSize: '6em', fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.05em',
        background: `linear-gradient(135deg, ${C.indigo}, ${C.pink})`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent',
      }}>{days}</div>
      <div style={{ fontSize: '1.1em', fontWeight: 700, color: C.ink, marginTop: '-0.1em' }}>days</div>
    </div>
  );
}

// 2) Day blocks — broken into d/h/m
export function CountdownBlocks({ config }: { config: any }) {
  const label = config.label || 'Countdown';
  const target = config.targetDate ? new Date(config.targetDate) : new Date(Date.now() + 12 * 86400000);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-center overflow-hidden" style={{ padding: '6%', fontFamily: FONT_DISPLAY }}>
      <div style={{ fontSize: '0.9em', fontWeight: 700, color: C.inkMute, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5em', textAlign: 'center' }}>{label}</div>
      <div style={{ display: 'flex', gap: '3%', justifyContent: 'center' }}>
        {[['DAYS', days], ['HRS', hours], ['MIN', mins]].map(([l, v]) => (
          <div key={l as string} style={{
            background: `linear-gradient(180deg, ${C.indigo}, ${C.violet})`,
            color: 'white', borderRadius: 14, padding: '8% 6%', flex: 1, textAlign: 'center',
            boxShadow: `0 8px 18px ${C.indigo}30`,
          }}>
            <div style={{ fontSize: '2.4em', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em' }}>{String(v).padStart(2, '0')}</div>
            <div style={{ fontSize: '0.7em', fontWeight: 700, opacity: 0.85, letterSpacing: '0.1em', marginTop: '0.2em' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════════════

// 1) Modern List
export function CalendarModernList({ config }: { config: any }) {
  const events = config.events || [
    { date: 'Today',    time: '7:00 PM', title: 'Spring Concert' },
    { date: 'Tomorrow', time: '6:30 PM', title: 'PTA Meeting' },
    { date: 'Fri',      time: 'All day', title: 'Picture Day' },
  ];
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col" style={{
      background: C.paper, borderRadius: 24, padding: '6%',
      fontFamily: FONT_DISPLAY,
      boxShadow: `0 12px 32px rgba(15,23,42,0.08)`,
    }}>
      <div style={{ fontSize: '0.9em', fontWeight: 700, color: C.indigo, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.7em' }}>📅 Upcoming</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7em' }}>
        {events.slice(0, 4).map((e: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7em' }}>
            <div style={{
              minWidth: '4em', textAlign: 'center', padding: '0.4em 0.5em', borderRadius: 10,
              background: `${C.indigo}10`, color: C.indigo,
              fontSize: '0.85em', fontWeight: 700,
            }}>{e.date}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '1.15em', fontWeight: 700, color: C.ink, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{e.title}</div>
              <div style={{ fontSize: '0.85em', fontWeight: 500, color: C.inkMute, marginTop: '0.1em', fontFamily: FONT_BODY }}>{e.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// WEATHER
// ════════════════════════════════════════════════════════════════════════

// 1) Hero Weather
export function WeatherHero({ config }: { config: any }) {
  const temp = config.tempF ?? 72;
  const cond = config.condition || 'Sunny';
  const loc = config.location || 'Springfield';
  const icon = cond.toLowerCase().includes('rain') ? '🌧️' : cond.toLowerCase().includes('cloud') ? '⛅' : cond.toLowerCase().includes('snow') ? '❄️' : '☀️';
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col justify-center" style={{
      background: `linear-gradient(135deg, ${C.blue}, ${C.indigo})`,
      borderRadius: 24, padding: '6%',
      fontFamily: FONT_DISPLAY, color: 'white',
      boxShadow: `0 16px 40px ${C.blue}30`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4%' }}>
        <div style={{ fontSize: '5em', lineHeight: 1, filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.35))' }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.9em', fontWeight: 700, opacity: 0.85, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{loc}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.1em' }}>
            <span style={{ fontSize: '4em', fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.04em' }}>{temp}°</span>
          </div>
          <div style={{ fontSize: '1.1em', fontWeight: 600, opacity: 0.9, marginTop: '0.1em' }}>{cond}</div>
        </div>
      </div>
    </div>
  );
}

// 2) Glass Weather
export function WeatherGlass({ config }: { config: any }) {
  const temp = config.tempF ?? 72;
  const cond = config.condition || 'Sunny';
  const loc = config.location || 'Springfield';
  const icon = cond.toLowerCase().includes('rain') ? '🌧️' : cond.toLowerCase().includes('cloud') ? '⛅' : cond.toLowerCase().includes('snow') ? '❄️' : '☀️';
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.6)',
      borderRadius: 24, padding: '6%',
      fontFamily: FONT_DISPLAY, color: C.ink,
    }}>
      <div style={{ fontSize: '4em', marginRight: '0.3em' }}>{icon}</div>
      <div>
        <div style={{ fontSize: '3em', fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.04em',
          background: `linear-gradient(135deg, ${C.indigo}, ${C.pink})`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent',
        }}>{temp}°</div>
        <div style={{ fontSize: '0.95em', fontWeight: 600, color: C.inkSoft }}>{cond} · {loc}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LOGO
// ════════════════════════════════════════════════════════════════════════

// 1) Modern Initials Circle
export function LogoCircle({ config }: { config: any }) {
  const initials = (config.initials || (config.schoolName || 'School').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()) || 'SE';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <div style={{
        width: '85%', aspectRatio: '1', borderRadius: '50%',
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.5) 0%, transparent 50%), linear-gradient(135deg, ${C.indigo}, ${C.pink})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', fontWeight: 800, fontSize: '1.8em',
        fontFamily: FONT_DISPLAY,
        boxShadow: `0 12px 30px ${C.indigo}40`,
      }}>{initials}</div>
    </div>
  );
}

// 2) Wordmark
export function LogoWordmark({ config }: { config: any }) {
  const name = config.schoolName || 'Sunnyside Elementary';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%', fontFamily: FONT_DISPLAY }}>
      <div style={{
        fontSize: '1.4em', fontWeight: 800, color: C.ink, lineHeight: 1.05, letterSpacing: '-0.02em', textAlign: 'center',
      }}>
        {name.split(' ').map((w: string, i: number) => (
          <div key={i} style={{
            background: i === 0 ? `linear-gradient(135deg, ${C.indigo}, ${C.pink})` : undefined,
            WebkitBackgroundClip: i === 0 ? 'text' : undefined, WebkitTextFillColor: i === 0 ? 'transparent' : C.ink,
            color: i === 0 ? 'transparent' : C.ink,
          }}>{w}</div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL
// ════════════════════════════════════════════════════════════════════════

// 1) Modern Gallery Frame
export function GalleryModern({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 overflow-hidden flex flex-col" style={{
      background: C.paper, borderRadius: 24, padding: '4%',
      fontFamily: FONT_DISPLAY,
      boxShadow: `0 12px 32px rgba(15,23,42,0.08)`,
    }}>
      <div style={{ fontSize: '0.85em', fontWeight: 700, color: C.indigo, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5em' }}>{config.title || '📸 Gallery'}</div>
      <div style={{ flex: 1, borderRadius: 16,
        background: `linear-gradient(135deg, ${C.violet}30, ${C.pink}30, ${C.gold}30)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3em',
      }}>📷</div>
    </div>
  );
}
