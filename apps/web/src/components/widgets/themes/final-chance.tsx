"use client";

/**
 * Final Chance — premium dark glassmorphic widget theme.
 *
 * Big, fun, readable typography. Designed for the "Final Chance" preset:
 * a Canva-style ready-made canvas where every zone already looks gorgeous;
 * users just edit the content. No tiny fonts. Everything scales with zone size.
 *
 * Font sizes use `em` so they scale with the zone container's font-size,
 * which the player sets based on screen resolution.
 */

import { useEffect, useState } from 'react';

// ─── Palette ────────────────────────────────────────────────────────────
export const FC = {
  bg0: '#0B1026',         // deep navy
  bg1: '#1E1B4B',         // indigo
  bg2: '#831843',         // wine
  bg3: '#BE185D',         // hot pink
  ink: '#F8FAFC',         // near-white
  inkSoft: 'rgba(248,250,252,0.78)',
  inkMute: 'rgba(248,250,252,0.55)',
  pink: '#EC4899',
  blue: '#60A5FA',
  lime: '#A3E635',
  gold: '#FCD34D',
  coral: '#FB7185',
  card: 'rgba(255,255,255,0.10)',
  cardStrong: 'rgba(255,255,255,0.16)',
  cardBorder: 'rgba(255,255,255,0.22)',
  glow: '0 20px 60px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.18)',
};

export const FC_FONT_DISPLAY = "var(--font-fredoka), ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif";
export const FC_FONT_HAND    = "var(--font-caveat), 'Segoe Script', cursive";

// ─── Background (URL-encoded layered SVG + gradient) ────────────────────
function buildFinalChanceBg(): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='g1' cx='20%' cy='15%' r='60%'>
        <stop offset='0%' stop-color='%23A78BFA' stop-opacity='0.55'/>
        <stop offset='100%' stop-color='%23A78BFA' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='g2' cx='85%' cy='20%' r='50%'>
        <stop offset='0%' stop-color='%23EC4899' stop-opacity='0.55'/>
        <stop offset='100%' stop-color='%23EC4899' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='g3' cx='50%' cy='95%' r='70%'>
        <stop offset='0%' stop-color='%23F59E0B' stop-opacity='0.35'/>
        <stop offset='100%' stop-color='%23F59E0B' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23g1)'/>
    <rect width='1920' height='1080' fill='url(%23g2)'/>
    <rect width='1920' height='1080' fill='url(%23g3)'/>
    <g fill='%23ffffff' opacity='0.55'>
      <circle cx='180'  cy='120' r='2'/>
      <circle cx='340'  cy='200' r='1.5'/>
      <circle cx='520'  cy='90'  r='2.5'/>
      <circle cx='700'  cy='240' r='1.5'/>
      <circle cx='870'  cy='140' r='2'/>
      <circle cx='1080' cy='80'  r='1.5'/>
      <circle cx='1260' cy='220' r='2.5'/>
      <circle cx='1440' cy='150' r='1.5'/>
      <circle cx='1620' cy='110' r='2'/>
      <circle cx='1800' cy='240' r='1.5'/>
      <circle cx='90'   cy='340' r='1.5'/>
      <circle cx='420'  cy='400' r='2'/>
      <circle cx='760'  cy='420' r='1.5'/>
      <circle cx='1180' cy='380' r='2'/>
      <circle cx='1540' cy='430' r='1.5'/>
    </g>
    <g opacity='0.20'>
      <path d='M0,820 L120,800 L120,920 L240,900 L240,840 L380,820 L380,940 L520,910 L520,860 L680,840 L680,930 L820,910 L820,820 L980,800 L980,920 L1140,890 L1140,830 L1300,810 L1300,930 L1460,910 L1460,840 L1620,820 L1620,920 L1800,900 L1800,830 L1920,810 L1920,1080 L0,1080 Z' fill='%23000000'/>
    </g>
    <g fill='%23FCD34D' opacity='0.55'>
      <rect x='160' y='840' width='3' height='3' rx='1'/>
      <rect x='280' y='870' width='3' height='3' rx='1'/>
      <rect x='420' y='850' width='3' height='3' rx='1'/>
      <rect x='620' y='870' width='3' height='3' rx='1'/>
      <rect x='820' y='840' width='3' height='3' rx='1'/>
      <rect x='1040' y='860' width='3' height='3' rx='1'/>
      <rect x='1240' y='840' width='3' height='3' rx='1'/>
      <rect x='1440' y='870' width='3' height='3' rx='1'/>
      <rect x='1640' y='850' width='3' height='3' rx='1'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(160deg, ${FC.bg0} 0%, ${FC.bg1} 40%, ${FC.bg2} 80%, ${FC.bg3} 100%)`;
}
export const FINAL_CHANCE_BG = buildFinalChanceBg();

// ─── Animation keyframes (one global injection) ─────────────────────────
function FCAnimations() {
  return (
    <style>{`
      @keyframes fc-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
      @keyframes fc-bounce-big { 0%,100%{transform:translateY(0) rotate(-3deg)} 50%{transform:translateY(-14px) rotate(3deg)} }
      @keyframes fc-float { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-12px) rotate(8deg)} }
      @keyframes fc-spin-slow { from{transform:rotate(0)} to{transform:rotate(360deg)} }
      @keyframes fc-pulse-glow { 0%,100%{filter:drop-shadow(0 0 8px currentColor) drop-shadow(0 0 0 currentColor)} 50%{filter:drop-shadow(0 0 24px currentColor) drop-shadow(0 0 8px currentColor)} }
      @keyframes fc-wiggle { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
      @keyframes fc-rainbow { 0%{color:#EC4899} 25%{color:#FCD34D} 50%{color:#A3E635} 75%{color:#60A5FA} 100%{color:#EC4899} }
      @keyframes fc-confetti-fall { 0%{transform:translateY(-10vh) rotate(0)} 100%{transform:translateY(110vh) rotate(720deg)} }
      @keyframes fc-shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      @keyframes fc-pop { 0%{transform:scale(0.85)} 60%{transform:scale(1.08)} 100%{transform:scale(1)} }
    `}</style>
  );
}

// ─── Floating emoji decoration (use inside any card for "kid fun" feel) ──
function FloatingEmojis({ items, area = 'card' }: { items: Array<{ e: string; top: string; left: string; size?: string; delay?: string; anim?: string }>; area?: 'card' | 'screen' }) {
  return (
    <>
      {items.map((it, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            position: 'absolute',
            top: it.top, left: it.left,
            fontSize: it.size || '1.6em',
            animation: `${it.anim || 'fc-float'} ${3 + (i % 3)}s ease-in-out infinite`,
            animationDelay: it.delay || `${i * 0.4}s`,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.35))',
            zIndex: 0,
          }}
        >{it.e}</span>
      ))}
    </>
  );
}

// ─── Shared card ────────────────────────────────────────────────────────
function GlassCard({ children, padding = '6%', accent, emojis }: { children: React.ReactNode; padding?: string; accent?: string; emojis?: Array<{ e: string; top: string; left: string; size?: string; delay?: string; anim?: string }> }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden flex flex-col justify-center"
      style={{
        background: FC.card,
        backdropFilter: 'blur(24px) saturate(140%)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        border: `1px solid ${FC.cardBorder}`,
        borderRadius: 28,
        boxShadow: FC.glow,
        padding,
        fontFamily: FC_FONT_DISPLAY,
        color: FC.ink,
        position: 'relative',
      }}
    >
      {accent && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at 0% 0%, ${accent}55 0%, transparent 60%)`,
          pointerEvents: 'none', borderRadius: 28,
        }} />
      )}
      <FCAnimations />
      {emojis && <FloatingEmojis items={emojis} />}
      <div style={{ position: 'relative', zIndex: 1, width: '100%' }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceClock({ config }: { config: any }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const is24 = config.format === '24h';
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  const rawHour = parseInt(fmt({ hour: 'numeric', hour12: false }), 10);
  const ampm = rawHour >= 12 ? 'PM' : 'AM';
  const hours = is24 ? rawHour : (rawHour % 12 || 12);
  const mins = fmt({ minute: '2-digit' }).padStart(2, '0');
  const dateStr = fmt({ weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <GlassCard accent={FC.blue} emojis={[
      { e: '⏰', top: '8%',  left: '8%',  size: '1.4em', anim: 'fc-bounce' },
      { e: '✨', top: '12%', left: '88%', size: '1.2em', anim: 'fc-pulse-glow' },
    ]}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
        <div style={{ fontSize: '0.85em', fontWeight: 600, color: FC.inkMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{dateStr}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.15em', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: '4.2em', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.04em', background: `linear-gradient(135deg, ${FC.blue}, ${FC.pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent' }}>
            {hours}:{mins}
          </span>
          {!is24 && <span style={{ fontSize: '1.2em', fontWeight: 700, color: FC.inkSoft }}>{ampm}</span>}
        </div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceWeather({ config }: { config: any }) {
  const temp = config.tempF || 72;
  const cond = config.condition || 'Clear';
  const loc  = config.location || 'Springfield';
  const hi   = config.high || 78;
  const lo   = config.low || 64;
  const icon = cond.toLowerCase().includes('rain') ? '🌧️' : cond.toLowerCase().includes('cloud') ? '⛅' : cond.toLowerCase().includes('snow') ? '❄️' : '☀️';
  return (
    <GlassCard accent={FC.pink} emojis={[
      { e: '🌈', top: '6%', left: '85%', size: '1.6em', anim: 'fc-bounce-big' },
      { e: '☁️', top: '78%', left: '6%', size: '1.4em', anim: 'fc-float' },
    ]}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4%', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '4.5em', lineHeight: 1, filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.4))', animation: 'fc-bounce-big 4s ease-in-out infinite' }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2em' }}>
            <span style={{ fontSize: '4em', fontWeight: 700, lineHeight: 0.9, color: FC.ink, letterSpacing: '-0.03em' }}>{temp}°</span>
            <span style={{ fontSize: '1.4em', fontWeight: 600, color: FC.gold }}>F</span>
          </div>
          <div style={{ fontSize: '1.4em', fontWeight: 600, color: FC.inkSoft, marginTop: '0.15em' }}>{cond}</div>
          <div style={{ fontSize: '1em', fontWeight: 500, color: FC.inkMute, marginTop: '0.2em' }}>📍 {loc}  •  H {hi}° / L {lo}°</div>
        </div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEXT — big bold welcome / headline
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceText({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'Welcome!';
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  const size = config.size || 'xl'; // sm | md | lg | xl | 2xl
  const sizeMap: Record<string, string> = { sm: '1.4em', md: '1.8em', lg: '2.4em', xl: '3em', '2xl': '3.8em' };
  return (
    <GlassCard padding="4% 6%" accent={FC.gold} emojis={[
      { e: '🎉', top: '8%',  left: '4%',  size: '1.8em', anim: 'fc-wiggle' },
      { e: '⭐', top: '70%', left: '92%', size: '1.6em', anim: 'fc-spin-slow' },
      { e: '🎈', top: '76%', left: '8%',  size: '1.5em', anim: 'fc-float' },
      { e: '✨', top: '12%', left: '90%', size: '1.4em', anim: 'fc-pulse-glow' },
    ]}>
      <p data-field="content" style={{
        fontSize: sizeMap[size] || sizeMap.xl,
        fontWeight: 700,
        color: FC.ink,
        textAlign: align,
        lineHeight: 1.05,
        letterSpacing: '-0.025em',
        margin: 0,
        textShadow: '0 4px 18px rgba(0,0,0,0.35)',
        animation: 'fc-pop 0.8s ease-out',
        whiteSpace: 'pre-wrap' as const
      }}>{content}</p>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LOGO
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceLogo({ config }: { config: any }) {
  const initials = (config.initials || (config.schoolName || 'School').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()) || 'SE';
  return (
    <GlassCard padding="6%">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{
          width: '78%', aspectRatio: '1', borderRadius: '50%',
          background: `radial-gradient(circle at 30% 25%, #fff 0%, rgba(255,255,255,0) 50%), conic-gradient(from 200deg, ${FC.pink}, ${FC.blue}, ${FC.gold}, ${FC.pink})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 12px 30px ${FC.pink}55, inset 0 -6px 16px rgba(0,0,0,0.18)`,
          color: 'white', fontWeight: 800, fontSize: '1.8em',
          letterSpacing: '0.02em', textShadow: '0 3px 10px rgba(0,0,0,0.35)',
          fontFamily: FC_FONT_DISPLAY,
          animation: 'fc-bounce 3.5s ease-in-out infinite',
        }}>
          {initials}
        </div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceAnnouncement({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const title = config.title || 'Big news today!';
  const body  = config.message || config.body || 'Tap a zone to edit. Everything is already styled — just write what you want to say.';
  const badge = config.badgeLabel || '📣 Announcement';
  return (
    <GlassCard accent={FC.pink} emojis={[
      { e: '📢', top: '10%', left: '88%', size: '1.6em', anim: 'fc-wiggle' },
      { e: '🎊', top: '72%', left: '90%', size: '1.5em', anim: 'fc-bounce' },
    ]}>
      <div data-field="badgeLabel" style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: `linear-gradient(135deg, ${FC.pink}, ${FC.coral})`,
        color: 'white', fontWeight: 700,
        fontSize: '0.85em', letterSpacing: '0.06em', textTransform: 'uppercase',
        padding: '0.45em 1em', borderRadius: 999, width: 'fit-content', marginBottom: '0.7em',
        boxShadow: `0 8px 20px ${FC.pink}55`,
        animation: 'fc-pop 0.6s ease-out',
        whiteSpace: 'pre-wrap' as const
      }}>{badge}</div>
      <div data-field="title" style={{
        fontSize: '2.2em', fontWeight: 700, color: FC.ink, lineHeight: 1.1,
        letterSpacing: '-0.02em', marginBottom: '0.4em',
        textShadow: '0 3px 14px rgba(0,0,0,0.35)',
        whiteSpace: 'pre-wrap' as const
      }}>{title}</div>
      <div data-field="message" style={{ fontSize: '1.25em', fontWeight: 500, color: FC.inkSoft, lineHeight: 1.45, whiteSpace: 'pre-wrap' as const }}>{body}</div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CALENDAR / EVENTS
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceCalendar({ config }: { config: any }) {
  const events = config.events || [
    { date: 'Today',    time: '7:00 PM', title: 'Spring Concert' },
    { date: 'Tomorrow', time: '6:30 PM', title: 'PTA Meeting' },
    { date: 'Fri',      time: 'All Day', title: 'Picture Day' },
    { date: 'Sat',      time: '9:00 AM', title: 'Field Trip' },
  ];
  return (
    <GlassCard accent={FC.lime} emojis={[
      { e: '🗓️', top: '8%', left: '85%', size: '1.4em', anim: 'fc-wiggle' },
    ]}>
      <div style={{
        fontSize: '1em', fontWeight: 700, color: FC.lime,
        letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.6em',
        animation: 'fc-pulse-glow 3s ease-in-out infinite',
      }}>📅 Upcoming</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7em' }}>
        {events.slice(0, 4).map((e: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.7em' }}>
            <div style={{
              fontSize: '0.85em', fontWeight: 700, color: FC.gold,
              minWidth: '4.5em', letterSpacing: '0.02em',
            }}>{e.date}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '1.25em', fontWeight: 700, color: FC.ink, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{e.title}</div>
              <div style={{ fontSize: '0.85em', fontWeight: 500, color: FC.inkMute, marginTop: '0.1em' }}>{e.time}</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COUNTDOWN
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceCountdown({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const label = config.label || 'Countdown';
  const target = config.targetDate ? new Date(config.targetDate) : new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return (
    <GlassCard accent={FC.gold} emojis={[
      { e: '🚌', top: '8%',  left: '6%',  size: '1.4em', anim: 'fc-bounce' },
      { e: '🎒', top: '8%',  left: '85%', size: '1.4em', anim: 'fc-bounce', delay: '0.6s' },
      { e: '⏳', top: '78%', left: '88%', size: '1.3em', anim: 'fc-wiggle' },
    ]}>
      <div style={{ textAlign: 'center' }}>
        <div data-field="label" style={{ fontFamily: FC_FONT_HAND, fontSize: '1.6em', color: FC.gold, lineHeight: 1, marginBottom: '0.1em', whiteSpace: 'pre-wrap' as const }}>{label}</div>
        <div style={{ fontSize: '5em', fontWeight: 800, lineHeight: 0.95,
          background: `linear-gradient(135deg, ${FC.gold}, ${FC.coral})`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent',
          letterSpacing: '-0.04em',
          animation: 'fc-pop 1s ease-out',
        }}>{days}</div>
        <div style={{ fontSize: '1.2em', fontWeight: 700, color: FC.inkSoft, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '-0.1em' }}>days</div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STAFF SPOTLIGHT
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceStaff({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const bio  = config.bio || 'Inspiring students every day with creativity, kindness, and a big smile!';
  const initials = name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <GlassCard accent={FC.coral} emojis={[
      { e: '🌟', top: '6%',  left: '8%',  size: '1.5em', anim: 'fc-spin-slow' },
      { e: '🌟', top: '6%',  left: '85%', size: '1.5em', anim: 'fc-spin-slow', delay: '1s' },
      { e: '💖', top: '78%', left: '85%', size: '1.4em', anim: 'fc-bounce' },
    ]}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6em', textAlign: 'center' }}>
        <div data-field="role" style={{
          fontSize: '0.95em', fontWeight: 700, color: FC.coral, letterSpacing: '0.15em', textTransform: 'uppercase',
          animation: 'fc-rainbow 6s linear infinite',
          whiteSpace: 'pre-wrap' as const
        }}>★ {role} ★</div>
        <div style={{
          width: '5.2em', height: '5.2em', borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, #fff 0%, transparent 50%), conic-gradient(from 0deg, ${FC.coral}, ${FC.pink}, ${FC.gold}, ${FC.coral})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: '2em',
          boxShadow: `0 12px 26px ${FC.coral}55`,
        }}>{initials}</div>
        <div data-field="staffName" style={{ fontSize: '2em', fontWeight: 700, color: FC.ink, lineHeight: 1.05, letterSpacing: '-0.02em', whiteSpace: 'pre-wrap' as const }}>{name}</div>
        <div data-field="bio" style={{ fontSize: '1.05em', fontWeight: 500, color: FC.inkSoft, lineHeight: 1.4, fontStyle: 'italic', whiteSpace: 'pre-wrap' as const }}>"{bio}"</div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// IMAGE CAROUSEL placeholder
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceImageCarousel({ config }: { config: any }) {
  return (
    <GlassCard accent={FC.blue} emojis={[
      { e: '📸', top: '10%', left: '8%',  size: '1.5em', anim: 'fc-wiggle' },
      { e: '🎨', top: '78%', left: '85%', size: '1.5em', anim: 'fc-bounce' },
    ]}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.6em', alignItems: 'center' }}>
        <div style={{ fontSize: '3em', animation: 'fc-bounce-big 3s ease-in-out infinite' }}>🖼️</div>
        <div data-field="title" style={{ fontSize: '1.6em', fontWeight: 700, color: FC.ink, letterSpacing: '-0.01em', whiteSpace: 'pre-wrap' as const }}>{config.title || 'Photo Gallery'}</div>
        <div style={{ fontSize: '1.1em', fontWeight: 500, color: FC.inkMute }}>Drop in photos — they'll rotate every {Math.round((config.intervalMs || 5000) / 1000)}s</div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TICKER — gradient bar
// ═══════════════════════════════════════════════════════════════════════
export function FinalChanceTicker({ config }: { config: any }) {
  const messages: string[] = config.messages && config.messages.length ? config.messages : [
    'Welcome to a new year!',
    'Picture day is Friday',
    'Spring Concert next Tuesday',
  ];
  const text = messages.join('   ★   ');
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: `linear-gradient(90deg, ${FC.pink}, ${FC.coral}, ${FC.gold})`,
      borderRadius: 18,
      boxShadow: `0 10px 30px ${FC.pink}55`,
      fontFamily: FC_FONT_DISPLAY,
    }}>
      <div data-field="messages" style={{
        whiteSpace: 'nowrap',
        animation: 'fc-ticker 28s linear infinite',
        fontSize: '1.6em',
        fontWeight: 700,
        color: 'white',
        letterSpacing: '-0.01em',
        paddingLeft: '100%',
        textShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}>
        {text}   ★   {text}
      </div>
      <style>{`@keyframes fc-ticker { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }`}</style>
    </div>
  );
}
