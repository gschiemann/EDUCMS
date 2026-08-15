"use client";
/**
 * COUNTDOWNS pack — 5 widgets.
 * CD_NEON_DIGITS, CD_PAPER_FLIP, CD_CRAYON_BLOCKS, CD_GLASS_RING, CD_OPS_TIMER
 *
 * 2026-05-04 — operator: "what do i do with this period countdown?
 * it doesnt update anything in the widget". Recurring mode (lunch
 * periods, bell schedules) was unsupported here — the v2 widgets
 * only knew how to read config.targetDate, ignored config.periods +
 * config.mode entirely, fell through to the 12-day default. Fixed
 * to use the shared resolveCountdownTarget helper which handles
 * BOTH single-date and recurring-period modes.
 */
import { useEffect, useState } from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { resolveCountdownTarget } from '../countdown-utils';
import type { CountdownConfig } from '../countdown-utils';
import { sceneCss } from '../scene-css';

interface CdCfg extends CountdownConfig {
  style?: WidgetStyle;
  staticDays?: number;
  eyebrow?: string;
}

/**
 * Unified countdown hook — accepts the full config (mode +
 * targetDate OR periods) and ticks down to the resolved target,
 * whichever it is. staticDays is the preview fallback when no
 * target can be resolved (empty templates).
 */
function diffMs(target: Date | null, fallbackDays: number) {
  if (!target) return { d: fallbackDays, h: 0, m: 0, s: 0 };
  const t = target.getTime() - Date.now();
  if (t <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  return { d: Math.floor(t / 86400000), h: Math.floor((t / 3600000) % 24), m: Math.floor((t / 60000) % 60), s: Math.floor((t / 1000) % 60) };
}
function useCountdown(cfg: CdCfg | undefined, fallback = 12, live: boolean = true) {
  const [v, setV] = useState(() => {
    const r = resolveCountdownTarget(cfg || {}, new Date());
    return diffMs(r?.target ?? null, cfg?.staticDays ?? fallback);
  });
  useEffect(() => {
    // Thumbnail / gallery (live === false): single snapshot, no tick.
    // Each countdown variant ticks every 1s; in the gallery 5 variants
    // × N tiles wakes the React scheduler 5N times/s for nothing.
    // Snapshot is sufficient because the gallery never updates either
    // way — operator clicks a variant to drop it, then it gets a real
    // live render in the canvas / on the player.
    if (!live) return;
    const id = setInterval(() => {
      const r = resolveCountdownTarget(cfg || {}, new Date());
      setV(diffMs(r?.target ?? null, cfg?.staticDays ?? fallback));
    }, 1000);
    return () => clearInterval(id);
  }, [cfg, fallback, live]);
  return v;
}
/** Resolve the active label/prefix for a countdown — recurring mode
 *  surfaces "Next lunch in" while date mode surfaces config.label. */
function useCountdownLabel(cfg: CdCfg | undefined): { primary: string; eyebrow: string } {
  const r = resolveCountdownTarget(cfg || {}, new Date());
  const primary = cfg?.label || r?.label || 'Countdown';
  const eyebrow = cfg?.eyebrow || r?.prefix || '';
  return { primary, eyebrow };
}

// 1. NEON
export function CountdownNeonDigitsWidget({ config, live = true }: WidgetProps<CdCfg>) {
  const c = config || {}; const v = useCountdown(c, undefined, live); const labelInfo = useCountdownLabel(c); const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 140, textColor: '#fff', bgColor: '#0a0014', bgGradient: 'radial-gradient(ellipse at center, #1a0033, #0a0014)', padding: 32, borderRadius: 20, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(c.style || {}) });
  const Cell = ({ n, l }: { n: number; l: string }) => (<div style={{ textAlign: 'center' }}><div style={{ fontSize: r.font.size, color: r.accent.primary, lineHeight: 1, textShadow: `0 0 16px ${r.accent.primary}, 0 0 32px ${r.accent.primary}88`, fontWeight: 700 }}>{String(n).padStart(2, '0')}</div><div style={{ fontSize: '0.18em', color: r.accent.secondary, letterSpacing: '0.3em', textShadow: `0 0 8px ${r.accent.secondary}`, marginTop: 8 }}>{l}</div></div>);
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24 }}>
        <div style={{ fontSize: '0.22em', color: r.accent.secondary, letterSpacing: '0.5em', textShadow: `0 0 12px ${r.accent.secondary}` }}>▸ <span data-field="eyebrow">{labelInfo.eyebrow || 'COUNTDOWN'}</span> ◂</div>
        <h2 style={{ margin: 0, fontSize: '0.4em', color: '#fff', letterSpacing: '0.3em' }}><span data-field="label">{labelInfo.primary || 'STATE FINALS'}</span></h2>
        <div style={{ display: 'flex', gap: 32 }}>
          <Cell n={v.d} l="DAYS" /><Cell n={v.h} l="HRS" /><Cell n={v.m} l="MIN" /><Cell n={v.s} l="SEC" />
        </div>
      </div>
    </div>
  );
}

// 2. PAPER FLIP — middle school
export function CountdownPaperFlipWidget({ config, live = true }: WidgetProps<CdCfg>) {
  const c = config || {}; const v = useCountdown(c, undefined, live); const labelInfo = useCountdownLabel(c); const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, textColor: '#1c1917', bgColor: '#f5f1e8', padding: 40, accentColor: '#7c1d1d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, alignItems: 'center', justifyContent: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.5em', fontStyle: 'italic', borderBottom: '4px double #0a0a0a', paddingBottom: 10 }}><span data-field="label">{labelInfo.primary || 'Days Until Spring Break'}</span></h2>
        <div style={{ display: 'flex', gap: 16 }}>
          {[['DAYS', v.d], ['HOURS', v.h], ['MINUTES', v.m]].map(([label, n], i) => (
            <div key={i} style={{ background: '#fff', padding: '18px 24px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', borderRadius: 4, position: 'relative', minWidth: 120 }}>
              <div style={{ fontSize: '3.5em', fontWeight: 900, lineHeight: 1, textAlign: 'center', fontFamily: 'monospace' }}>{String(n).padStart(2, '0')}</div>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(0,0,0,0.15)' }} />
              <div style={{ fontSize: '0.7em', textAlign: 'center', letterSpacing: '0.3em', color: r.accent.primary, marginTop: 8 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 3. CRAYON
export function CountdownCrayonBlocksWidget({ config, live = true }: WidgetProps<CdCfg>) {
  const c = config || {}; const v = useCountdown(c, undefined, live); const labelInfo = useCountdownLabel(c); const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 24, textColor: '#1c1917', bgColor: '#fff8e7', padding: 32, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  const dur = animDurationSec(r.anim.speed, 3); const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa'];
  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{sceneCss(`@keyframes cd-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }`)}</style>}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, alignItems: 'center', justifyContent: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.8em', fontWeight: 800 }}>🎉 <span data-field="label">{labelInfo.primary || 'Field Day in...'}</span></h2>
        <div style={{ display: 'flex', gap: 14 }}>
          {[['DAYS', v.d], ['HRS', v.h], ['MIN', v.m]].map(([label, n], i) => (
            <div key={i} style={{ background: colors[i], color: '#fff', padding: 20, borderRadius: 24, minWidth: 130, textAlign: 'center', boxShadow: '0 6px 0 rgba(0,0,0,0.15)', animation: r.anim.on ? `cd-bounce ${dur}s ease-in-out ${i * 0.2}s infinite` : 'none', transform: `rotate(${i % 2 ? 2 : -2}deg)` }}>
              <div style={{ fontSize: '3.6em', fontWeight: 900, lineHeight: 1, textShadow: '3px 3px 0 rgba(0,0,0,0.15)' }}>{n}</div>
              <div style={{ fontSize: '0.9em', fontWeight: 800, letterSpacing: '0.15em', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 4. GLASS RING — universal
export function CountdownGlassRingWidget({ config, live = true }: WidgetProps<CdCfg>) {
  const c = config || {}; const v = useCountdown(c, undefined, live); const labelInfo = useCountdownLabel(c); const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 22, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', padding: 32, borderRadius: 24, accentColor: '#6366f1', accentColor2: '#a855f7', ...(c.style || {}) });
  const total = (c.staticDays || 30); const pct = Math.max(0, Math.min(1, (total - v.d) / total));
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', gap: 32, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: 200, height: 200 }}>
          <svg width="200" height="200" style={{ transform: 'rotate(-90deg)' }}>
            <defs><linearGradient id="cdg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={r.accent.primary} /><stop offset="100%" stopColor={r.accent.secondary} /></linearGradient></defs>
            <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="14" />
            <circle cx="100" cy="100" r="84" fill="none" stroke="url(#cdg)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${pct * 528} 528`} />
          </svg>
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 68, fontWeight: 200, lineHeight: 1, letterSpacing: '-0.04em' }}>{v.d}</div>
            <div style={{ fontSize: '0.7em', color: '#64748b', fontWeight: 600, letterSpacing: '0.2em' }}>DAYS</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.85em', fontWeight: 600, letterSpacing: '0.2em', color: r.accent.primary, textTransform: 'uppercase' }}><span data-field="eyebrow">{labelInfo.eyebrow || 'Counting down'}</span></div>
          <h2 style={{ margin: '8px 0 12px 0', fontSize: '2em', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}><span data-field="label">{labelInfo.primary || 'Graduation Day'}</span></h2>
          <div style={{ display: 'flex', gap: 8, fontSize: '0.85em', color: '#64748b' }}>
            <span style={{ background: 'rgba(99,102,241,0.1)', padding: '4px 12px', borderRadius: 999 }}>{v.h}h</span>
            <span style={{ background: 'rgba(168,85,247,0.1)', padding: '4px 12px', borderRadius: 999 }}>{v.m}m</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 5. OPS — admin/staff
export function CountdownOpsTimerWidget({ config, live = true }: WidgetProps<CdCfg>) {
  const c = config || {}; const v = useCountdown(c, undefined, live); const labelInfo = useCountdownLabel(c); const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 80, textColor: '#fafafa', bgColor: '#0a0e14', padding: 24, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#fbbf24', accentColor2: '#22d3ee', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.secondary}55`, paddingBottom: 6, fontSize: '0.32em', color: r.accent.secondary }}><b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● T-MINUS</b><span data-field="label">{labelInfo.primary || 'TARGET_EVENT'}</span></div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit', color: r.accent.primary, textShadow: `0 0 16px ${r.accent.primary}88`, letterSpacing: '0.05em' }}>
          <span style={{ fontSize: r.font.size }}>{String(v.d).padStart(3, '0')}</span><span style={{ fontSize: '0.5em', color: r.accent.secondary }}>d</span>
          <span style={{ fontSize: r.font.size, marginLeft: 12 }}>{String(v.h).padStart(2, '0')}</span><span style={{ fontSize: '0.5em', color: r.accent.secondary }}>h</span>
          <span style={{ fontSize: r.font.size, marginLeft: 12 }}>{String(v.m).padStart(2, '0')}</span><span style={{ fontSize: '0.5em', color: r.accent.secondary }}>m</span>
        </div>
        <div style={{ borderTop: `1px dashed ${r.accent.secondary}55`, paddingTop: 6, fontSize: '0.28em', color: r.accent.secondary, display: 'flex', justifyContent: 'space-between' }}><span>$ <span data-field="eyebrow">{c.eyebrow || 'monitoring'}</span>_</span><span>STATUS: NOMINAL</span></div>
      </div>
    </div>
  );
}
