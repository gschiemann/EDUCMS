"use client";
/**
 * HEADLINES pack — 5 widgets, one per K-12 audience.
 *
 *  HEADLINE_NEON_MARQUEE   — high school   (vegas marquee)
 *  HEADLINE_PAPER_PRESS    — middle school (newspaper masthead)
 *  HEADLINE_CRAYON_BANNER  — elementary    (crayon banner)
 *  HEADLINE_SLAB_HERO      — universal     (modern editorial)
 *  HEADLINE_BRIEF_MEMO     — admin/staff   (briefing memo)
 */

import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface HeadlineCfg {
  style?: WidgetStyle;
  eyebrow?: string;     // "BREAKING" / "Edition 47" / "Memo"
  title?: string;       // main headline
  subtitle?: string;    // dek / subhead
  byline?: string;      // "Mrs. Park · 4 min ago" / "Press · Vol 12"
  date?: string;
}

// 1. HEADLINE_NEON_MARQUEE — high school
export function HeadlineNeonMarqueeWidget({ config }: WidgetProps<HeadlineCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Bebas Neue', 'Oswald', 'Anton', system-ui, sans-serif",
    fontSize: 120, fontWeight: 700, textColor: '#fff8dc',
    bgColor: '#1a0010', bgGradient: 'radial-gradient(ellipse at top, #2d0020 0%, #0a0008 100%)',
    padding: 48, borderRadius: 16,
    accentColor: '#ff2bd6', accentColor2: '#ffd60a',
    ...(c.style || {}),
  });
  const dur = animDurationSec(r.anim.speed, 1.2);
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{`@keyframes hl-bulb-${r.accent.primary.replace(/[^a-z0-9]/gi,'')} { 50% { opacity: 0.4; } }`}</style>}
      <div style={{ position: 'absolute', inset: 16, border: `4px solid ${r.accent.highlight}`, borderRadius: 12, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, position: 'relative' }}>
        {[0,1,2,3,4,5,6,7].map(i => (
          <span key={i} aria-hidden style={{ position: 'absolute', width: 14, height: 14, borderRadius: '50%', background: r.accent.highlight, top: i < 4 ? 24 : undefined, bottom: i >= 4 ? 24 : undefined, left: `${10 + (i % 4) * 26}%`, boxShadow: `0 0 12px ${r.accent.highlight}`, animation: r.anim.on ? `hl-bulb-${r.accent.primary.replace(/[^a-z0-9]/gi,'')} ${dur}s ease-in-out ${i*0.15}s infinite` : 'none' }} />
        ))}
        {r.show('eyebrow', !!c.eyebrow) && <div style={{ background: r.accent.primary, color: '#fff', padding: '8px 24px', fontSize: '0.18em', fontWeight: 700, letterSpacing: '0.4em', boxShadow: `0 0 24px ${r.accent.primary}` }}>{c.eyebrow || 'BREAKING'}</div>}
        <div style={{ fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, letterSpacing: '0.04em', lineHeight: 1.05, textAlign: 'center', textShadow: `0 0 16px ${r.accent.highlight}, 0 0 32px ${r.accent.primary}55` }}>{c.title || 'STATE CHAMPS HEADED TO FINALS'}</div>
        {r.show('subtitle', !!c.subtitle) && c.subtitle && <div style={{ fontSize: '0.22em', color: r.accent.highlight, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase' }}>{c.subtitle}</div>}
        {r.show('byline', !!c.byline) && c.byline && <div style={{ fontSize: '0.14em', color: r.font.color, opacity: 0.7, letterSpacing: '0.2em' }}>{c.byline}</div>}
      </div>
    </div>
  );
}

// 2. HEADLINE_PAPER_PRESS — middle school
export function HeadlinePaperPressWidget({ config }: WidgetProps<HeadlineCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Playfair Display', 'Times New Roman', Georgia, serif",
    fontSize: 90, fontWeight: 900, textColor: '#0a0a0a',
    bgColor: '#f5f1e8', padding: 48, borderRadius: 0,
    borderWidth: 0, accentColor: '#7c1d1d', accentColor2: '#525252',
    ...(c.style || {}),
  });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '4px double #0a0a0a', paddingBottom: 12 }}>
          <span style={{ fontSize: '0.14em', fontWeight: 700, letterSpacing: '0.3em', color: r.accent.secondary }}>{c.eyebrow || 'THE COURIER · VOL XII · NO. 47'}</span>
          {c.date && <span style={{ fontSize: '0.14em', fontStyle: 'italic', color: r.accent.secondary }}>{c.date}</span>}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
          {r.show('eyebrow2', false) && <div style={{ fontSize: '0.16em', fontWeight: 700, color: r.accent.primary, letterSpacing: '0.2em', textTransform: 'uppercase' }}>EXTRA · EXTRA</div>}
          <h1 style={{ fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, lineHeight: 0.95, margin: 0, textAlign: 'center', letterSpacing: '-0.02em' }}>{c.title || 'Spring Musical Opens to Sold-Out Crowd'}</h1>
          {c.subtitle && <p style={{ fontSize: '0.32em', fontWeight: 400, fontStyle: 'italic', color: r.accent.secondary, textAlign: 'center', margin: 0, lineHeight: 1.3 }}>{c.subtitle}</p>}
        </div>
        <div style={{ borderTop: '1px solid #0a0a0a', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: '0.13em', color: r.accent.secondary, fontStyle: 'italic' }}>
          <span>By {c.byline || 'Editorial Staff'}</span>
          <span>—— continued inside ——</span>
        </div>
      </div>
    </div>
  );
}

// 3. HEADLINE_CRAYON_BANNER — elementary
export function HeadlineCrayonBannerWidget({ config }: WidgetProps<HeadlineCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Fredoka', 'Comic Neue', 'Marker Felt', system-ui, sans-serif",
    fontSize: 110, fontWeight: 700, textColor: '#fff',
    bgColor: '#fff8e7', padding: 40, borderRadius: 32,
    accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d',
    ...(c.style || {}),
  });
  const dur = animDurationSec(r.anim.speed, 4);
  const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa', '#fb923c'];
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{`@keyframes crayon-wiggle { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }`}</style>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20 }}>
        {r.show('eyebrow', !!c.eyebrow) && <div style={{ display: 'flex', gap: 6 }}>{[0,1,2].map(i => <span key={i} style={{ background: colors[i], color: '#fff', padding: '6px 16px', borderRadius: 999, fontSize: '0.18em', fontWeight: 800, transform: `rotate(${i % 2 === 0 ? -3 : 3}deg)`, boxShadow: '0 4px 0 rgba(0,0,0,0.12)' }}>{(c.eyebrow || 'NEWS!').split(' ')[i] || ['BIG','BIG','NEWS!'][i]}</span>)}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, fontSize: r.font.size, fontWeight: r.font.weight, lineHeight: 1.05 }}>
          {(c.title || 'Field Day is Friday!').split(' ').map((word, i) => (
            <span key={i} style={{ color: colors[i % colors.length], textShadow: '3px 3px 0 #fff, 6px 6px 0 rgba(0,0,0,0.1)', animation: r.anim.on ? `crayon-wiggle ${dur}s ease-in-out ${i*0.2}s infinite` : 'none', display: 'inline-block' }}>{word}</span>
          ))}
        </div>
        {c.subtitle && <div style={{ fontSize: '0.22em', color: '#475569', fontWeight: 700, background: '#fff', padding: '10px 24px', borderRadius: 999, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>★ {c.subtitle} ★</div>}
      </div>
    </div>
  );
}

// 4. HEADLINE_SLAB_HERO — universal
export function HeadlineSlabHeroWidget({ config }: WidgetProps<HeadlineCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Inter Tight', 'Inter', 'Helvetica Neue', system-ui, sans-serif",
    fontSize: 120, fontWeight: 800, textColor: '#0f172a',
    bgColor: '#ffffff', padding: 56, borderRadius: 8,
    accentColor: '#6366f1', accentColor2: '#a855f7',
    ...(c.style || {}),
  });
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 8, height: '100%', background: `linear-gradient(180deg, ${r.accent.primary}, ${r.accent.secondary})` }} />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 20, paddingLeft: 20 }}>
        {r.show('eyebrow', !!c.eyebrow) && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, alignSelf: 'flex-start' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.accent.primary }} />
          <span style={{ fontSize: '0.16em', fontWeight: 700, letterSpacing: '0.3em', color: r.accent.primary, textTransform: 'uppercase' }}>{c.eyebrow || 'Featured'}</span>
        </div>}
        <h1 style={{ fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, lineHeight: 0.95, margin: 0, letterSpacing: '-0.04em' }}>{c.title || 'Innovation Lab Opens Doors to All Grades'}</h1>
        {c.subtitle && <p style={{ fontSize: '0.28em', fontWeight: 400, color: '#475569', margin: 0, lineHeight: 1.4, maxWidth: '85%' }}>{c.subtitle}</p>}
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {r.show('byline', !!c.byline) && <span style={{ fontSize: '0.16em', color: '#64748b', fontWeight: 500 }}>{c.byline || 'Communications Team'}</span>}
          {c.date && <span style={{ fontSize: '0.16em', color: '#64748b', fontWeight: 500 }}>{c.date}</span>}
        </div>
      </div>
    </div>
  );
}

// 5. HEADLINE_BRIEF_MEMO — admin/staff
export function HeadlineBriefMemoWidget({ config }: WidgetProps<HeadlineCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'IBM Plex Sans', 'Inter', system-ui, sans-serif",
    fontSize: 56, fontWeight: 700, textColor: '#0f172a',
    bgColor: '#fefce8', padding: 40, borderRadius: 4, borderWidth: 2, borderStyle: 'solid', borderColor: '#0f172a',
    accentColor: '#dc2626', accentColor2: '#475569',
    ...(c.style || {}),
  });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `2px solid ${r.font.color}`, paddingBottom: 12 }}>
          <span style={{ fontSize: '0.36em', fontWeight: 800, letterSpacing: '0.2em', color: r.font.color }}>MEMORANDUM</span>
          <span style={{ background: r.accent.primary, color: '#fff', padding: '4px 12px', fontSize: '0.28em', fontWeight: 700, letterSpacing: '0.2em' }}>{c.eyebrow || 'PRIORITY'}</span>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.32em', color: r.accent.secondary, lineHeight: 1.8 }}>
          <div><b style={{ color: r.font.color }}>TO: &nbsp;&nbsp;&nbsp;&nbsp;</b> All Staff</div>
          <div><b style={{ color: r.font.color }}>FROM: &nbsp;</b> {c.byline || 'Principal Office'}</div>
          {c.date && <div><b style={{ color: r.font.color }}>DATE: &nbsp;</b> {c.date}</div>}
          <div><b style={{ color: r.font.color }}>RE: &nbsp;&nbsp;&nbsp;&nbsp;</b> {c.subtitle || 'Updated procedures'}</div>
        </div>
        <div style={{ borderTop: `1px dashed ${r.accent.secondary}`, paddingTop: 16, flex: 1 }}>
          <div style={{ fontSize: r.font.size, fontWeight: r.font.weight, color: r.font.color, lineHeight: 1.2 }}>{c.title || 'Early dismissal Friday — 1:30 PM bell.'}</div>
        </div>
      </div>
    </div>
  );
}
