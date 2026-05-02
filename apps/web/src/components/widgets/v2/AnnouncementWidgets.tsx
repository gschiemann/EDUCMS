"use client";
/**
 * ANNOUNCEMENTS pack — 5 widgets, one per K-12 audience.
 *
 *  ANN_NEON_ALERT       — high school
 *  ANN_BULLETIN_PIN     — middle school (cork board pinned note)
 *  ANN_RAINBOW_BUBBLE   — elementary    (speech bubble)
 *  ANN_GLASS_TOAST      — universal     (glass toast card)
 *  ANN_OPS_DISPATCH     — admin/staff   (dispatch alert)
 */
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface AnnCfg {
  style?: WidgetStyle;
  label?: string;     // "ALERT" / "REMINDER" / "FYI"
  title?: string;     // headline
  message?: string;   // body
  cta?: string;       // call-to-action footer text
  icon?: string;      // emoji or short string
}

// 1. ANN_NEON_ALERT — high school
export function AnnouncementNeonAlertWidget({ config }: WidgetProps<AnnCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Audiowide', 'Bebas Neue', system-ui, sans-serif",
    fontSize: 80, fontWeight: 700, textColor: '#fff',
    bgColor: '#0a0014', bgGradient: 'radial-gradient(ellipse at top, #1a0033 0%, #0a0014 100%)',
    padding: 40, borderRadius: 20, accentColor: '#ff2bd6', accentColor2: '#00f0ff', highlightColor: '#ffd60a',
    ...(c.style || {}),
  });
  const dur = animDurationSec(r.anim.speed, 1.6);
  const id = 'ann-neon-' + r.accent.primary.replace(/[^a-z0-9]/gi, '');
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{`@keyframes ${id} { 0%,100% { box-shadow: 0 0 0 4px ${r.accent.primary}, 0 0 24px ${r.accent.primary}; } 50% { box-shadow: 0 0 0 4px ${r.accent.secondary}, 0 0 32px ${r.accent.secondary}; } }`}</style>}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', gap: 20, padding: 12, borderRadius: 12, animation: r.anim.on ? `${id} ${dur}s ease-in-out infinite` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '1.4em' }}>{c.icon || '⚠'}</span>
          <span style={{ fontSize: '0.32em', fontWeight: 700, letterSpacing: '0.4em', color: r.accent.highlight, textShadow: `0 0 12px ${r.accent.highlight}` }}>{c.label || 'ALERT'}</span>
        </div>
        <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: r.font.weight, color: r.accent.primary, lineHeight: 1.05, letterSpacing: '0.02em', textShadow: `0 0 16px ${r.accent.primary}` }}>{c.title || 'PEP RALLY @ 2:30 — GYM A'}</h2>
        {c.message && <p style={{ margin: 0, fontSize: '0.28em', color: '#fff', opacity: 0.9, fontWeight: 300, lineHeight: 1.4 }}>{c.message}</p>}
        {c.cta && <div style={{ marginTop: 'auto', fontSize: '0.22em', color: r.accent.secondary, letterSpacing: '0.3em', textShadow: `0 0 8px ${r.accent.secondary}` }}>▸ {c.cta}</div>}
      </div>
    </div>
  );
}

// 2. ANN_BULLETIN_PIN — middle school
export function AnnouncementBulletinPinWidget({ config }: WidgetProps<AnnCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Patrick Hand', 'Caveat', 'Comic Neue', system-ui, sans-serif",
    fontSize: 64, fontWeight: 700, textColor: '#1c1917',
    bgColor: '#a16207', bgGradient: 'repeating-radial-gradient(circle at 30% 20%, #b45309 0px, #a16207 4px, #92400e 8px)',
    padding: 40, borderRadius: 8, accentColor: '#dc2626', accentColor2: '#facc15',
    ...(c.style || {}),
  });
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'relative', background: '#fffbeb', padding: 32, transform: 'rotate(-1.5deg)', boxShadow: '0 12px 24px rgba(0,0,0,0.4)', height: 'calc(100% - 24px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', width: 28, height: 28, borderRadius: '50%', background: r.accent.primary, boxShadow: 'inset -4px -4px 6px rgba(0,0,0,0.3), 0 4px 8px rgba(0,0,0,0.4)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '1.2em' }}>{c.icon || '📌'}</span>
          <span style={{ fontSize: '0.36em', fontWeight: 700, color: r.accent.primary, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{c.label || 'Reminder'}</span>
        </div>
        <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, lineHeight: 1.15 }}>{c.title || "Don't forget your permission slip!"}</h2>
        {c.message && <p style={{ margin: 0, fontSize: '0.42em', color: '#3f3f46', lineHeight: 1.4 }}>{c.message}</p>}
        {c.cta && <div style={{ marginTop: 'auto', fontSize: '0.36em', color: r.accent.primary, fontWeight: 700, borderTop: '2px dashed #d4d4d8', paddingTop: 8 }}>→ {c.cta}</div>}
      </div>
    </div>
  );
}

// 3. ANN_RAINBOW_BUBBLE — elementary
export function AnnouncementRainbowBubbleWidget({ config }: WidgetProps<AnnCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Fredoka', 'Nunito', system-ui, sans-serif",
    fontSize: 72, fontWeight: 800, textColor: '#1c1917',
    bgColor: '#fff8e7', padding: 40, borderRadius: 32,
    accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d',
    ...(c.style || {}),
  });
  const dur = animDurationSec(r.anim.speed, 3);
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{`@keyframes bubble-pop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }`}</style>}
      <div style={{ position: 'relative', background: `linear-gradient(135deg, ${r.accent.primary}, ${r.accent.secondary})`, padding: 32, borderRadius: 40, height: '100%', display: 'flex', flexDirection: 'column', gap: 16, color: '#fff', boxShadow: '0 12px 0 rgba(0,0,0,0.12)', animation: r.anim.on ? `bubble-pop ${dur}s ease-in-out infinite` : 'none' }}>
        <span aria-hidden style={{ position: 'absolute', bottom: -20, left: 60, width: 40, height: 40, background: r.accent.primary, transform: 'rotate(45deg)', borderRadius: 6 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '1.3em' }}>{c.icon || '🌟'}</span>
          <span style={{ fontSize: '0.32em', fontWeight: 800, background: r.accent.highlight, color: '#1c1917', padding: '6px 18px', borderRadius: 999, transform: 'rotate(-3deg)' }}>{c.label || 'YAY!'}</span>
        </div>
        <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: r.font.weight, lineHeight: 1.05, color: '#fff', textShadow: '3px 3px 0 rgba(0,0,0,0.15)' }}>{c.title || 'Pizza day is tomorrow!'}</h2>
        {c.message && <p style={{ margin: 0, fontSize: '0.36em', fontWeight: 600, lineHeight: 1.3, color: 'rgba(255,255,255,0.95)' }}>{c.message}</p>}
        {c.cta && <div style={{ marginTop: 'auto', fontSize: '0.28em', background: '#fff', color: r.accent.primary, padding: '10px 20px', borderRadius: 999, alignSelf: 'flex-start', fontWeight: 800 }}>★ {c.cta} ★</div>}
      </div>
    </div>
  );
}

// 4. ANN_GLASS_TOAST — universal
export function AnnouncementGlassToastWidget({ config }: WidgetProps<AnnCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 64, fontWeight: 600, textColor: '#0f172a',
    bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12))',
    padding: 40, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', shadow: '0 8px 32px rgba(99,102,241,0.15)',
    accentColor: '#6366f1', accentColor2: '#10b981',
    ...(c.style || {}),
  });
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', gap: 20, height: '100%', alignItems: 'center' }}>
        <div style={{ width: 80, height: 80, flex: '0 0 80px', borderRadius: 16, background: `linear-gradient(135deg, ${r.accent.primary}, ${r.accent.secondary})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: '#fff', boxShadow: `0 8px 24px ${r.accent.primary}55` }}>{c.icon || '✓'}</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {r.show('label', !!c.label) && <span style={{ fontSize: '0.22em', fontWeight: 700, letterSpacing: '0.2em', color: r.accent.primary, textTransform: 'uppercase' }}>{c.label || 'Update'}</span>}
          <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{c.title || 'Library hours extended this week'}</h2>
          {c.message && <p style={{ margin: 0, fontSize: '0.36em', color: '#475569', lineHeight: 1.4, fontWeight: 400 }}>{c.message}</p>}
          {c.cta && <div style={{ marginTop: 8, fontSize: '0.28em', color: r.accent.primary, fontWeight: 600 }}>{c.cta} →</div>}
        </div>
      </div>
    </div>
  );
}

// 5. ANN_OPS_DISPATCH — admin/staff
export function AnnouncementOpsDispatchWidget({ config }: WidgetProps<AnnCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 48, fontWeight: 600, textColor: '#fafafa',
    bgColor: '#0a0e14', padding: 32, borderRadius: 8, borderWidth: 1, borderColor: '#dc2626',
    accentColor: '#dc2626', accentColor2: '#22d3ee', highlightColor: '#fbbf24',
    ...(c.style || {}),
  });
  const dur = animDurationSec(r.anim.speed, 1.5);
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{`@keyframes dispatch-blink { 50% { opacity: 0.3; } }`}</style>}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.secondary}55`, paddingBottom: 8, fontSize: '0.32em', color: r.accent.secondary }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.accent.primary, animation: r.anim.on ? `dispatch-blink ${dur}s steps(2) infinite` : 'none' }} />
            <b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>{c.label || 'DISPATCH'}</b>
          </span>
          <span>SEQ #{(Math.random() * 9000 + 1000).toFixed(0)}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontSize: '0.32em', color: r.accent.highlight, letterSpacing: '0.1em' }}>&gt; INCOMING_TRANSMISSION</div>
          <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, lineHeight: 1.2 }}>{c.title || 'Lockdown drill scheduled 10:15 AM'}</h2>
          {c.message && <p style={{ margin: 0, fontSize: '0.4em', color: r.accent.secondary, fontWeight: 400, lineHeight: 1.5 }}>{c.message}</p>}
        </div>
        {c.cta && <div style={{ borderTop: `1px dashed ${r.accent.secondary}55`, paddingTop: 8, fontSize: '0.32em', color: r.accent.highlight }}>$ {c.cta}_</div>}
      </div>
    </div>
  );
}
