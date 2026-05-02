"use client";
/**
 * LOGOS pack — 5 widgets for school crests / branding.
 * LOGO_NEON_EMBLEM, LOGO_VARSITY_PATCH, LOGO_CRAYON_SUN, LOGO_GLASS_MARK, LOGO_OPS_STAMP
 */
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface LogoCfg { style?: WidgetStyle; logoUrl?: string; emoji?: string; schoolName?: string; tagline?: string; established?: string; mascot?: string; }
const FALLBACK = { schoolName: 'Roosevelt Academy', tagline: 'Excellence · Honor · Service', established: 'EST. 1948', mascot: '🦅' };

// 1. NEON EMBLEM
export function LogoNeonEmblemWidget({ config }: WidgetProps<LogoCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 48, textColor: '#fff', bgColor: '#0a0014', bgGradient: 'radial-gradient(circle at center, #1a0033, #0a0014)', padding: 32, borderRadius: 16, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(config?.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <div style={{ width: 160, height: 160, border: `4px solid ${r.accent.primary}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 32px ${r.accent.primary}, inset 0 0 20px ${r.accent.primary}55`, fontSize: 80 }}>
          {c.logoUrl ? <img src={c.logoUrl} alt="" style={{ width: '80%', height: '80%', objectFit: 'contain' }} /> : c.mascot}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: r.font.size, color: r.accent.primary, textShadow: `0 0 16px ${r.accent.primary}`, letterSpacing: '0.1em', lineHeight: 1 }}>{c.schoolName?.toUpperCase()}</div>
          <div style={{ fontSize: '0.4em', color: r.accent.secondary, letterSpacing: '0.4em', marginTop: 8, textShadow: `0 0 8px ${r.accent.secondary}` }}>★ {c.tagline} ★</div>
        </div>
      </div>
    </div>
  );
}

// 2. VARSITY PATCH — middle/high
export function LogoVarsityPatchWidget({ config }: WidgetProps<LogoCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, textColor: '#fff', bgColor: '#7c1d1d', bgGradient: 'radial-gradient(circle at 30% 30%, #991b1b, #7c1d1d 70%)', padding: 20, borderRadius: 16, borderWidth: 6, borderStyle: 'solid', borderColor: '#fef3c7', shadow: '0 12px 24px rgba(0,0,0,0.3)', accentColor: '#fbbf24', ...(config?.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', inset: 12, border: `3px solid ${r.accent.primary}`, borderRadius: 8, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
        <div style={{ fontSize: '0.5em', letterSpacing: '0.4em', color: r.accent.primary, fontWeight: 700 }}>★ {c.established} ★</div>
        <div style={{ fontSize: 96, lineHeight: 1, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}>{c.logoUrl ? <img src={c.logoUrl} alt="" style={{ width: 100, height: 100, objectFit: 'contain' }} /> : c.mascot}</div>
        <div style={{ fontSize: r.font.size, letterSpacing: '0.2em', textAlign: 'center', lineHeight: 1.1, textShadow: '2px 2px 0 rgba(0,0,0,0.4)' }}>{c.schoolName?.toUpperCase()}</div>
        <div style={{ background: r.accent.primary, color: '#7c1d1d', padding: '4px 16px', fontSize: '0.42em', fontWeight: 800, letterSpacing: '0.2em', borderRadius: 4 }}>{c.tagline?.toUpperCase()}</div>
      </div>
    </div>
  );
}

// 3. CRAYON SUN — elementary
export function LogoCrayonSunWidget({ config }: WidgetProps<LogoCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 36, textColor: '#1c1917', bgColor: '#fff8e7', padding: 24, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(config?.style || {}) });
  const dur = animDurationSec(r.anim.speed, 12);
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{`@keyframes logo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, position: 'relative' }}>
        <div style={{ position: 'relative', width: 180, height: 180 }}>
          <svg width="180" height="180" style={{ animation: r.anim.on ? `logo-spin ${dur}s linear infinite` : 'none' }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <rect key={i} x="86" y="6" width="8" height="32" rx="4" fill={[r.accent.primary, r.accent.secondary, r.accent.highlight][i % 3]} transform={`rotate(${i * 30} 90 90)`} />
            ))}
          </svg>
          <div style={{ position: 'absolute', inset: 32, background: r.accent.highlight, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, boxShadow: '0 8px 0 rgba(0,0,0,0.15)' }}>{c.logoUrl ? <img src={c.logoUrl} alt="" style={{ width: '70%', height: '70%' }} /> : c.mascot}</div>
        </div>
        <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: 800, textAlign: 'center', textShadow: '3px 3px 0 #fff' }}>{c.schoolName}</h2>
        <div style={{ fontSize: '0.55em', fontWeight: 700, color: r.accent.primary }}>♥ {c.tagline} ♥</div>
      </div>
    </div>
  );
}

// 4. GLASS MARK — universal
export function LogoGlassMarkWidget({ config }: WidgetProps<LogoCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 44, fontWeight: 300, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', padding: 32, borderRadius: 24, accentColor: '#6366f1', ...(config?.style || {}) });
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <div style={{ width: 140, height: 140, borderRadius: 28, background: `linear-gradient(135deg, ${r.accent.primary}, ${r.accent.secondary})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72, color: '#fff', boxShadow: `0 16px 32px ${r.accent.primary}33` }}>{c.logoUrl ? <img src={c.logoUrl} alt="" style={{ width: '70%', height: '70%' }} /> : c.mascot}</div>
        <h2 style={{ margin: 0, fontSize: r.font.size, fontWeight: r.font.weight, letterSpacing: '-0.02em', textAlign: 'center' }}>{c.schoolName}</h2>
        <div style={{ fontSize: '0.45em', color: '#64748b', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600 }}>{c.tagline}</div>
      </div>
    </div>
  );
}

// 5. OPS STAMP — admin
export function LogoOpsStampWidget({ config }: WidgetProps<LogoCfg>) {
  const c = { ...FALLBACK, ...(config || {}) }; const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 26, textColor: '#fafafa', bgColor: '#0a0e14', padding: 24, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', ...(config?.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
        <div style={{ borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 6, fontSize: '0.7em', color: r.accent.primary, letterSpacing: '0.2em' }}>● ORG.IDENTIFIER</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: `2px dashed ${r.accent.primary}`, borderRadius: 8, padding: 18 }}>
          <div style={{ fontSize: 56, filter: 'grayscale(0.5)' }}>{c.logoUrl ? <img src={c.logoUrl} alt="" style={{ width: 80, height: 80 }} /> : c.mascot}</div>
          <div style={{ textAlign: 'center', color: r.accent.primary, textShadow: `0 0 8px ${r.accent.primary}88` }}>
            <div style={{ fontSize: r.font.size, fontWeight: 700, letterSpacing: '0.15em' }}>{c.schoolName?.toUpperCase()}</div>
            <div style={{ fontSize: '0.55em', color: r.accent.secondary, marginTop: 4 }}>// {c.tagline}</div>
          </div>
        </div>
        <div style={{ borderTop: `1px dashed ${r.accent.primary}55`, paddingTop: 6, fontSize: '0.55em', color: r.accent.secondary, display: 'flex', justifyContent: 'space-between' }}><span>{c.established}</span><span>VERIFIED ✓</span></div>
      </div>
    </div>
  );
}
