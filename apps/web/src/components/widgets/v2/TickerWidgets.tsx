"use client";
/**
 * TICKERS pack — 5 widgets, all scrolling.
 * TICKER_NEON_LED, TICKER_PAPER_PRESS, TICKER_CRAYON_TRAIN, TICKER_GLASS_FLOW, TICKER_OPS_FEED
 */
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface TickerCfg { style?: WidgetStyle; messages?: string | string[]; stamp?: string; separator?: string; }
function asArr(m?: string | string[]) { if (!m) return ['Welcome back', 'Picture day Friday', 'Library extended hours', 'Drama Club auditions Wed']; return Array.isArray(m) ? m : m.split(/[•·|]+/).map(s => s.trim()).filter(Boolean); }

const ANIM_CSS = `@keyframes tk-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`;

// 1. NEON LED
export function TickerNeonLedWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const msgs = asArr(c.messages); const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 48, textColor: '#ff2bd6', bgColor: '#0a0014', padding: 0, borderRadius: 8, accentColor: '#ff2bd6', accentColor2: '#ffd60a', ...(c.style || {}) });
  const dur = animDurationSec(r.anim.speed, 30); const text = [...msgs, ...msgs].map(m => `★ ${m}`).join('   ');
  return (
    <div style={frameStyle(r)}>
      <style>{ANIM_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 16 }}>
        {c.stamp && <div style={{ background: r.accent.highlight, color: '#000', padding: '8px 20px', fontWeight: 800, fontSize: '0.5em', letterSpacing: '0.3em', height: '100%', display: 'flex', alignItems: 'center', boxShadow: `0 0 20px ${r.accent.highlight}` }}>● {c.stamp}</div>}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, color: r.accent.primary, textShadow: `0 0 12px ${r.accent.primary}, 0 0 24px ${r.accent.primary}`, letterSpacing: '0.1em', fontWeight: 700 }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

// 2. PAPER PRESS — middle
export function TickerPaperPressWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const msgs = asArr(c.messages); const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 36, textColor: '#0a0a0a', bgColor: '#f5f1e8', padding: 0, borderRadius: 0, accentColor: '#7c1d1d', ...(c.style || {}) });
  const dur = animDurationSec(r.anim.speed, 35); const text = [...msgs, ...msgs].map(m => m).join('  ❖  ');
  return (
    <div style={{ ...frameStyle(r), borderTop: '4px double #0a0a0a', borderBottom: '4px double #0a0a0a' }}>
      <style>{ANIM_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <div style={{ background: r.accent.primary, color: '#fff', padding: '14px 24px', fontWeight: 800, fontSize: '0.5em', letterSpacing: '0.3em', height: '100%', display: 'flex', alignItems: 'center' }}>{c.stamp || 'EXTRA'}</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, fontStyle: 'italic', padding: '0 20px', fontWeight: 600 }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

// 3. CRAYON TRAIN — elementary
export function TickerCrayonTrainWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const msgs = asArr(c.messages); const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 40, textColor: '#fff', bgColor: '#fff8e7', padding: 8, borderRadius: 999, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  const dur = animDurationSec(r.anim.speed, 32); const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa'];
  const stream = [...msgs, ...msgs];
  return (
    <div style={frameStyle(r)}>
      <style>{ANIM_CSS}</style>
      <div style={{ background: `linear-gradient(90deg, ${r.accent.primary}, ${r.accent.secondary})`, borderRadius: 999, height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden', boxShadow: '0 4px 0 rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '1.5em', padding: '0 20px' }}>🚂</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'inline-flex', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', gap: 18, alignItems: 'center', fontSize: r.font.size, fontWeight: 800 }}>
            {stream.map((m, i) => (<span key={i} style={{ background: '#fff', color: colors[i % colors.length], padding: '6px 18px', borderRadius: 999, boxShadow: '0 3px 0 rgba(0,0,0,0.1)' }}>★ {m}</span>))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. GLASS FLOW — universal
export function TickerGlassFlowWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const msgs = asArr(c.messages); const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 26, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', padding: 0, borderRadius: 999, accentColor: '#6366f1', ...(c.style || {}) });
  const dur = animDurationSec(r.anim.speed, 40); const text = [...msgs, ...msgs].join('     ◆     ');
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <style>{ANIM_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 16 }}>
        {c.stamp && <div style={{ background: `linear-gradient(135deg, ${r.accent.primary}, #a855f7)`, color: '#fff', padding: '8px 20px', borderRadius: 999, fontSize: '0.7em', fontWeight: 600, letterSpacing: '0.2em', marginLeft: 12 }}>{c.stamp}</div>}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, fontWeight: 500, color: r.font.color }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

// 5. OPS FEED — admin
export function TickerOpsFeedWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const msgs = asArr(c.messages); const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, textColor: '#22d3ee', bgColor: '#0a0e14', padding: 0, borderRadius: 4, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24', ...(c.style || {}) });
  const dur = animDurationSec(r.anim.speed, 50); const text = [...msgs, ...msgs].map(m => `[OK] ${m}`).join('  ::  ');
  return (
    <div style={frameStyle(r)}>
      <style>{ANIM_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <div style={{ background: r.accent.secondary, color: '#000', padding: '6px 16px', fontWeight: 700, fontSize: '0.85em', letterSpacing: '0.2em', height: '100%', display: 'flex', alignItems: 'center' }}>● {c.stamp || 'FEED'}</div>
        <div style={{ flex: 1, overflow: 'hidden', padding: '0 12px' }}>
          <div style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, color: r.accent.primary, textShadow: `0 0 6px ${r.accent.primary}55` }}>{text}</div>
        </div>
      </div>
    </div>
  );
}
