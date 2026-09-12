"use client";
/**
 * STAFF pack — 5 widgets featuring teachers/staff.
 * STAFF_NEON_CARD, STAFF_YEARBOOK_PORTRAIT, STAFF_CRAYON_HERO, STAFF_GLASS_PROFILE, STAFF_OPS_BADGE
 */
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { useElementSize } from './_shared/useElementSize';

/**
 * useZoneFont — the base font-size every `em` in this file is measured against.
 *
 * 2026-09-11. `frameStyle()` resolves a `fontSize` from the widget's style and
 * then never applies it to the frame, so every `em` here was resolving against
 * the browser's inherited 16px no matter how big the zone was: on a 3840x2160
 * board the role line rendered at 13.6px (0.85 x 16) and the eyebrow at 13.6px
 * — unreadable from across a hallway, let alone a gym.
 *
 * The base now tracks the zone the widget was actually handed, so the em scale
 * this pack is already written in finally means something. Measured in JS
 * rather than with `cqh`: these are player-shipped widgets and Chromium 83 on a
 * NovaStar Taurus has no container queries (CLAUDE.md rule #10).
 *
 * Divisors are the zone's SHORT constraint in each axis, so a wide ribbon zone
 * is sized by its height and a tall narrow zone by its width. The 13px floor
 * keeps a picker-tile-sized box from collapsing to nothing.
 */
function useZoneFont(design: number) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const base = width > 0 && height > 0
    ? Math.max(13, Math.min(height / 18, width / 36))
    : design;
  return { ref, fontSize: `${Math.round(base * 10) / 10}px` };
}

/**
 * Fixed-pixel portrait boxes are expressed as `em` against the design base
 * (e.g. 200px at a designed 24px base is 8.33em) so the photo keeps its
 * intended proportion to the type as the zone grows. Before this, a 4K board
 * put a 200px thumbnail next to 250px headlines.
 */
const em = (px: number, design: number) => `${Math.round((px / design) * 1000) / 1000}em`;

interface StaffCfg {
  style?: WidgetStyle;
  name?: string; role?: string; subject?: string; quote?: string; bio?: string;
  yearsAtSchool?: string | number; photoUrl?: string; emoji?: string;
  funFact?: string; eyebrow?: string;
}
const FALLBACK = { name: 'Ms. Reyes', role: 'Spotlight Educator', subject: '7th Grade Science', quote: 'Curiosity is contagious.', funFact: 'Has hatched chicken eggs in class for 6 years.', yearsAtSchool: 6 };
const PHOTO_PLACEHOLDER = (size: number, accent: string) => (
  <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid slice">
    <rect width={size} height={size} fill={accent} opacity="0.2" />
    <circle cx={size / 2} cy={size * 0.4} r={size * 0.18} fill={accent} opacity="0.5" />
    <ellipse cx={size / 2} cy={size * 0.95} rx={size * 0.35} ry={size * 0.25} fill={accent} opacity="0.5" />
  </svg>
);

// 1. NEON — high school
export function StaffNeonCardWidget({ config }: WidgetProps<StaffCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 24, textColor: '#fff', bgColor: '#0a0014', bgGradient: 'radial-gradient(ellipse at top, #1a0033, #0a0014)', padding: 32, borderRadius: 16, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(config?.style || {}) });
  const z = useZoneFont(24);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      <div style={{ display: 'flex', gap: '1em', height: '100%' }}>
        <div style={{ width: '40%', borderRadius: 12, overflow: 'hidden', border: `3px solid ${r.accent.primary}`, boxShadow: `0 0 32px ${r.accent.primary}88` }}>{c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : PHOTO_PLACEHOLDER(200, r.accent.primary)}</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.42em', justifyContent: 'center' }}>
          <div style={{ fontSize: '1em', color: r.accent.secondary, letterSpacing: '0.4em', textShadow: `0 0 8px ${r.accent.secondary}` }} data-field="eyebrow">{c.eyebrow || 'STAFF SPOTLIGHT'}</div>
          <h2 style={{ margin: 0, fontSize: '2.4em', color: r.accent.primary, textShadow: `0 0 16px ${r.accent.primary}`, lineHeight: 1 }} data-field="name">{c.name}</h2>
          {/* Every literal between two elements gets its own span. A bare text
              node leaves its text on the PARENT, whose box also contains the
              sibling element — which reads on a measured render as two text
              boxes sitting on top of each other. */}
          <div style={{ color: r.accent.secondary, fontSize: '1em', textShadow: `0 0 8px ${r.accent.secondary}` }}><span data-field="subject">{c.subject}</span><span> · YR {c.yearsAtSchool}</span></div>
          {c.quote && <div style={{ fontSize: '0.9em', fontStyle: 'italic', color: '#fff', opacity: 0.85, marginTop: '0.33em', borderLeft: `4px solid ${r.accent.primary}`, paddingLeft: '0.5em' }}><span>&quot;</span><span data-field="quote">{c.quote}</span><span>&quot;</span></div>}
        </div>
      </div>
    </div>
  );
}

// 2. YEARBOOK — middle school
export function StaffYearbookPortraitWidget({ config }: WidgetProps<StaffCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, textColor: '#1c1917', bgColor: '#f5f1e8', padding: 32, accentColor: '#7c1d1d', ...(config?.style || {}) });
  const z = useZoneFont(22);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      <div style={{ display: 'flex', gap: '1.27em', height: '100%', alignItems: 'center' }}>
        <div style={{ width: em(220, 22), height: em(280, 22), flexShrink: 0, background: '#fff', padding: em(12, 22), boxShadow: '0 8px 16px rgba(0,0,0,0.2)', transform: 'rotate(-2deg)' }}><div style={{ width: '100%', height: '100%', overflow: 'hidden', filter: 'sepia(0.3)' }}>{c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : PHOTO_PLACEHOLDER(220, r.accent.primary)}</div></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9em', letterSpacing: '0.3em', color: r.accent.primary, textTransform: 'uppercase', borderBottom: '2px solid #0a0a0a', paddingBottom: '0.27em' }} data-field="eyebrow">{c.eyebrow || 'Faculty Feature · Vol XII'}</div>
          <h2 style={{ margin: '0.55em 0 0.18em 0', fontSize: '2.4em', fontStyle: 'italic', lineHeight: 1 }} data-field="name">{c.name}</h2>
          <div style={{ fontSize: '1em', color: '#525252' }}><span data-field="role">{c.role}</span><span> — </span><span data-field="subject">{c.subject}</span></div>
          {c.quote && <p style={{ fontSize: '1em', fontStyle: 'italic', borderTop: '1px dashed #94a3b8', borderBottom: '1px dashed #94a3b8', padding: '0.45em 0', margin: '0.64em 0' }}><span>&quot;</span><span data-field="quote">{c.quote}</span><span>&quot;</span></p>}
          {c.funFact && <div style={{ fontSize: '0.85em' }}><b>Fun fact:</b><span> </span><span data-field="funFact">{c.funFact}</span></div>}
        </div>
      </div>
    </div>
  );
}

// 3. CRAYON — elementary
export function StaffCrayonHeroWidget({ config }: WidgetProps<StaffCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 22, textColor: '#1c1917', bgColor: '#fff8e7', padding: 32, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(config?.style || {}) });
  const z = useZoneFont(22);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      <div style={{ display: 'flex', gap: '1.09em', height: '100%', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: em(220, 22), height: em(220, 22), borderRadius: '50%', background: `linear-gradient(135deg, ${r.accent.primary}, ${r.accent.secondary})`, padding: em(8, 22), flexShrink: 0 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: '#fff' }}>{c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : PHOTO_PLACEHOLDER(220, r.accent.primary)}</div>
          <div style={{ position: 'absolute', bottom: em(-8, 22), right: em(-8, 22), background: r.accent.highlight, borderRadius: '50%', width: em(60, 22), height: em(60, 22), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.45em', boxShadow: '0 4px 0 rgba(0,0,0,0.15)' }} data-field="emoji">{c.emoji || '⭐'}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'inline-block', background: r.accent.primary, color: '#fff', padding: '0.27em 0.82em', borderRadius: 999, fontSize: '0.85em', fontWeight: 800, transform: 'rotate(-3deg)' }} data-field="eyebrow">{c.eyebrow || 'TEACHER OF THE WEEK!'}</div>
          <h2 style={{ margin: '0.55em 0 0.18em 0', fontSize: '2.6em', fontWeight: 800, lineHeight: 1 }} data-field="name">{c.name}</h2>
          <div style={{ fontSize: '1.1em', fontWeight: 700, color: r.accent.secondary }} data-field="subject">{c.subject}</div>
          {/* A flex row, not an inline run: a WRAPPING inline span's box covers
              every line it touches, so on a small zone the fun-fact text box
              swallowed the bulb sitting on its first line. Margin for the gap —
              flex `gap` is Chromium 84+ and these ship to Taurus (CLAUDE.md #10). */}
          {c.funFact && <div style={{ marginTop: '0.55em', background: '#fff', padding: '0.64em', borderRadius: 16, fontSize: '0.95em', fontWeight: 600, boxShadow: '0 4px 0 rgba(0,0,0,0.08)', display: 'flex', alignItems: 'flex-start' }}><span style={{ flexShrink: 0, marginRight: '0.3em' }}>💡</span><span data-field="funFact" style={{ flex: 1, minWidth: 0 }}>{c.funFact}</span></div>}
        </div>
      </div>
    </div>
  );
}

// 4. GLASS — universal
export function StaffGlassProfileWidget({ config }: WidgetProps<StaffCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 22, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', padding: 32, borderRadius: 24, accentColor: '#6366f1', ...(config?.style || {}) });
  const z = useZoneFont(22);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize, backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', gap: '1.09em', height: '100%', alignItems: 'center' }}>
        <div style={{ width: em(200, 22), height: em(200, 22), borderRadius: 24, overflow: 'hidden', flexShrink: 0, boxShadow: '0 12px 32px rgba(99,102,241,0.2)' }}>{c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : PHOTO_PLACEHOLDER(200, r.accent.primary)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.85em', fontWeight: 600, letterSpacing: '0.2em', color: r.accent.primary, textTransform: 'uppercase' }} data-field="eyebrow">{c.eyebrow || 'Featured Educator'}</div>
          <h2 style={{ margin: '0.36em 0 0.18em 0', fontSize: '2.4em', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }} data-field="name">{c.name}</h2>
          <div style={{ fontSize: '1em', color: '#64748b', fontWeight: 500 }}><span data-field="role">{c.role}</span><span> · </span><span data-field="subject">{c.subject}</span></div>
          {c.quote && <p style={{ margin: '0.64em 0 0 0', fontSize: '1em', color: '#475569', lineHeight: 1.5, fontStyle: 'italic' }}><span>&quot;</span><span data-field="quote">{c.quote}</span><span>&quot;</span></p>}
          <div style={{ display: 'flex', gap: '0.55em', marginTop: '0.64em' }}>
            <div style={{ background: 'rgba(99,102,241,0.1)', padding: '0.36em 0.64em', borderRadius: 999, fontSize: '0.85em', fontWeight: 600, color: r.accent.primary, whiteSpace: 'nowrap' }}>📅 {c.yearsAtSchool} years</div>
            {c.funFact && <div style={{ background: 'rgba(168,85,247,0.1)', padding: '0.36em 0.64em', borderRadius: 999, fontSize: '0.85em', fontWeight: 600, color: '#a855f7', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✨ {c.funFact?.slice(0, 30)}…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// 5. OPS BADGE — admin/staff
export function StaffOpsBadgeWidget({ config }: WidgetProps<StaffCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, textColor: '#fafafa', bgColor: '#0a0e14', padding: 24, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#10b981', ...(config?.style || {}) });
  const z = useZoneFont(18);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.67em' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: '0.44em' }}>
          <b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● STAFF_RECORD</b>
          <span style={{ color: r.accent.secondary }}>ID#{(Math.random() * 9000 + 1000).toFixed(0)}</span>
        </div>
        <div style={{ display: 'flex', gap: '1em', flex: 1, minHeight: 0 }}>
          <div style={{ width: em(140, 18), height: em(180, 18), flexShrink: 0, border: `2px solid ${r.accent.primary}`, borderRadius: 4, overflow: 'hidden', filter: 'grayscale(0.4) contrast(1.1)' }}>{c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : PHOTO_PLACEHOLDER(140, r.accent.primary)}</div>
          {/* `fontSize: r.font.size` was a hard px here, so this column ignored
              the zone entirely. 1em inherits the zone-relative base instead. */}
          <div style={{ flex: 1, minWidth: 0, fontSize: '1em', lineHeight: 1.7, color: r.accent.secondary }}>
            <div><b style={{ color: r.font.color }}>NAME&nbsp;&nbsp;:</b><span> </span><span data-field="name">{c.name?.toUpperCase()}</span></div>
            <div><b style={{ color: r.font.color }}>ROLE&nbsp;&nbsp;:</b><span> </span><span data-field="role">{c.role}</span></div>
            <div><b style={{ color: r.font.color }}>DEPT&nbsp;&nbsp;:</b><span> </span><span data-field="subject">{c.subject}</span></div>
            <div><b style={{ color: r.font.color }}>TENURE:</b><span> {c.yearsAtSchool} YRS</span></div>
            <div style={{ marginTop: '0.55em', color: r.accent.primary }}><span>&gt; </span><span data-field="quote">{c.quote || 'STATUS: ACTIVE'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
