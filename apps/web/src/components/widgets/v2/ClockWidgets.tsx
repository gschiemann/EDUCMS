"use client";
/**
 * CLOCKS pack — 5 widgets, one per K-12 audience.
 *
 *  CLOCK_NEON_PULSE      — high school   (neon arcade)
 *  CLOCK_RECESS_BLOCKS   — elementary    (chunky color blocks)
 *  CLOCK_LOCKER_FLIP     — middle school (split-flap board)
 *  CLOCK_GLASS_MINIMAL   — universal     (glassmorphism)
 *  CLOCK_OPS_TERMINAL    — admin/staff   (monospace ops console)
 *
 * Every widget accepts:
 *   - config.style: full WidgetStyle (font, size, weight, color, bg,
 *                   padding, radius, border, shadow, animation)
 *   - config.timeZone: IANA tz string
 *   - config.label: optional eyebrow text
 *   - config.show.*: toggle date/seconds/eyebrow visibility
 *
 * Every widget is responsive (works at any aspect ratio). They DO NOT
 * use the 1920×1080 fixed-canvas pattern — they reflow to the zone size.
 */

import { useEffect, useState } from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { sceneCss } from '../scene-css';

// ─────────────────────────────────────────────────────────────────────
// Shared time hook
// ─────────────────────────────────────────────────────────────────────
function useNow(everyMs: number = 1000, live: boolean = true) {
  // Thumbnail / gallery mode (live === false): return a snapshot once
  // and skip the per-second tick. Without this, every clock variant
  // tile in the template gallery runs a 1Hz setInterval — at 5
  // variants × N tiles on screen the gallery wakes up the React
  // scheduler 5N times/s rendering content nobody is reading. Player
  // + canvas-builder paths pass live=true (default).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs, live]);
  return now;
}

function formatClock(now: Date, tz: string | undefined, fmt24: boolean) {
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    hour12: !fmt24, ...(tz ? { timeZone: tz } : {}),
  };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return {
    h: get('hour').padStart(2, '0'),
    m: get('minute'),
    s: get('second'),
    ap: get('dayPeriod') || '',
  };
}

function formatDate(now: Date, tz: string | undefined): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  }).format(now);
}

// ─────────────────────────────────────────────────────────────────────
// 1. CLOCK_NEON_PULSE — high school
// ─────────────────────────────────────────────────────────────────────
interface ClockCfg {
  style?: WidgetStyle;
  timeZone?: string;
  label?: string;
  format24?: boolean;
}

export function ClockNeonPulseWidget({ config, live = true }: WidgetProps<ClockCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Audiowide', 'Orbitron', 'Bebas Neue', system-ui, sans-serif",
    fontSize: 180,
    fontWeight: 700,
    textColor: '#ff2bd6',
    bgColor: '#0a0014',
    bgGradient: 'radial-gradient(ellipse at center, #1a0033 0%, #0a0014 70%)',
    padding: 32,
    borderRadius: 24,
    accentColor: '#ff2bd6',
    accentColor2: '#00f0ff',
    ...(c.style || {}),
  });
  const now = useNow(1000, live);
  const t = formatClock(now, c.timeZone, !!c.format24);
  const dur = animDurationSec(r.anim.speed, 2);
  const pulseId = 'neon-pulse-' + (r.accent.primary.replace(/[^a-z0-9]/gi, '') || 'x');

  return (
    <div style={frameStyle(r)}>
      {r.anim.on && (
        <style>{sceneCss(`
          @keyframes ${pulseId} { 0%,100% { filter: drop-shadow(0 0 12px ${r.accent.primary}) drop-shadow(0 0 32px ${r.accent.primary}); }
            50% { filter: drop-shadow(0 0 24px ${r.accent.primary}) drop-shadow(0 0 64px ${r.accent.primary}); } }
          @keyframes ${pulseId}-blink { 50% { opacity: 0.2; } }
        `)}</style>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
        {r.show('label', !!c.label) && c.label && (
          <div style={{ color: r.accent.secondary, fontSize: '0.18em', letterSpacing: '0.5em', textTransform: 'uppercase', fontWeight: 400, textShadow: `0 0 8px ${r.accent.secondary}` }} data-field="label">{c.label}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.05em', fontSize: r.font.size, fontWeight: r.font.weight, color: r.accent.primary, lineHeight: 1, letterSpacing: '0.02em', animation: r.anim.on ? `${pulseId} ${dur}s ease-in-out infinite` : 'none', textShadow: `0 0 8px ${r.accent.primary}, 0 0 24px ${r.accent.primary}` }}>
          <span>{t.h}</span>
          <span style={{ animation: r.anim.on ? `${pulseId}-blink 1s steps(2) infinite` : 'none' }}>:</span>
          <span>{t.m}</span>
          {r.show('seconds', false) && <span style={{ fontSize: '0.5em', color: r.accent.secondary, marginLeft: '0.2em', textShadow: `0 0 8px ${r.accent.secondary}` }}>:{t.s}</span>}
          {!c.format24 && t.ap && <span style={{ fontSize: '0.4em', color: r.accent.secondary, marginLeft: '0.3em', textShadow: `0 0 8px ${r.accent.secondary}` }}>{t.ap}</span>}
        </div>
        {r.show('date', true) && (
          <div style={{ color: r.font.color, fontSize: '0.15em', textTransform: 'uppercase', letterSpacing: '0.3em', opacity: 0.85 }}>{formatDate(now, c.timeZone)}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. CLOCK_RECESS_BLOCKS — elementary
// ─────────────────────────────────────────────────────────────────────
export function ClockRecessBlocksWidget({ config, live = true }: WidgetProps<ClockCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Fredoka', 'Nunito', system-ui, sans-serif",
    fontSize: 140,
    fontWeight: 800,
    textColor: '#ffffff',
    bgColor: '#fff8e7',
    padding: 32,
    borderRadius: 32,
    accentColor: '#ff6b9d',
    accentColor2: '#4ecdc4',
    highlightColor: '#ffd93d',
    ...(c.style || {}),
  });
  const now = useNow(1000, live);
  const t = formatClock(now, c.timeZone, !!c.format24);
  const blocks: Array<[string, string]> = [
    [t.h[0], r.accent.primary],
    [t.h[1], r.accent.secondary],
    [t.m[0], r.accent.highlight],
    [t.m[1], '#a78bfa'],
  ];
  const dur = animDurationSec(r.anim.speed, 4);

  return (
    <div style={frameStyle(r)}>
      {r.anim.on && <style>{sceneCss(`@keyframes blocks-bob { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-6px) rotate(2deg); } }`)}</style>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        {r.show('label', !!c.label) && c.label && (
          <div style={{ color: r.accent.primary, fontSize: '0.2em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }} data-field="label">{c.label}</div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {blocks.map(([digit, color], i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '0.85em', height: '1em', background: color, color: r.font.color, borderRadius: 18,
              fontSize: r.font.size, fontWeight: r.font.weight, lineHeight: 1,
              boxShadow: `0 8px 0 ${color}88, inset 0 4px 8px rgba(255,255,255,0.3)`,
              animation: r.anim.on ? `blocks-bob ${dur}s ease-in-out ${i * 0.2}s infinite` : 'none',
            }}>{digit}</span>
          ))}
          {r.show('seconds', false) && (
            <span style={{ fontSize: '0.5em', color: r.accent.primary, fontWeight: 800 }}>:{t.s}</span>
          )}
        </div>
        {r.show('date', true) && (
          <div style={{ color: '#475569', fontSize: '0.18em', fontWeight: 700 }}>{formatDate(now, c.timeZone)}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. CLOCK_LOCKER_FLIP — middle school
// ─────────────────────────────────────────────────────────────────────
export function ClockLockerFlipWidget({ config, live = true }: WidgetProps<ClockCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 160,
    fontWeight: 700,
    textColor: '#fafafa',
    bgColor: '#0c0c0d',
    bgGradient: 'linear-gradient(180deg, #18181b 0%, #09090b 100%)',
    padding: 32,
    borderRadius: 12,
    accentColor: '#fbbf24',
    accentColor2: '#71717a',
    ...(c.style || {}),
  });
  const now = useNow(1000, live);
  const t = formatClock(now, c.timeZone, !!c.format24);

  function FlipCell({ digit }: { digit: string }) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '0.7em', height: '1em',
        background: 'linear-gradient(180deg, #27272a 0%, #18181b 50%, #27272a 50%, #18181b 100%)',
        backgroundSize: '100% 4px',
        color: r.font.color, borderRadius: 6, fontSize: r.font.size, fontWeight: r.font.weight,
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.5)',
        position: 'relative',
      }}>
        <span style={{ position: 'relative', zIndex: 2 }}>{digit}</span>
        <span aria-hidden style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(0,0,0,0.8)', zIndex: 3 }} />
      </div>
    );
  }

  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        {r.show('label', !!c.label) && c.label && (
          <div style={{ color: r.accent.primary, fontSize: '0.16em', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4em' }}>▸ <span data-field="label">{c.label}</span> ◂</div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: r.font.size }}>
          <FlipCell digit={t.h[0]} /><FlipCell digit={t.h[1]} />
          <span style={{ color: r.accent.primary, fontSize: '0.8em', fontWeight: 700 }}>:</span>
          <FlipCell digit={t.m[0]} /><FlipCell digit={t.m[1]} />
          {r.show('seconds', false) && (<>
            <span style={{ color: r.accent.secondary, fontSize: '0.5em' }}>:</span>
            <FlipCell digit={t.s[0]} /><FlipCell digit={t.s[1]} />
          </>)}
        </div>
        {!c.format24 && t.ap && <div style={{ color: r.accent.primary, fontSize: '0.18em', fontWeight: 700, letterSpacing: '0.3em' }}>{t.ap}</div>}
        {r.show('date', true) && (
          <div style={{ color: r.accent.secondary, fontSize: '0.14em', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3em' }}>{formatDate(now, c.timeZone)}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4. CLOCK_GLASS_MINIMAL — universal
// ─────────────────────────────────────────────────────────────────────
export function ClockGlassMinimalWidget({ config, live = true }: WidgetProps<ClockCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
    fontSize: 160,
    fontWeight: 200,
    textColor: '#0f172a',
    bgColor: 'rgba(255,255,255,0.7)',
    bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.08) 100%)',
    padding: 40,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    shadow: '0 8px 32px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.6)',
    accentColor: '#6366f1',
    ...(c.style || {}),
  });
  const now = useNow(1000, live);
  const t = formatClock(now, c.timeZone, !!c.format24);

  return (
    <div style={{ ...frameStyle(r), backdropFilter: r.bg.blur ? `blur(${r.bg.blur}px)` : 'blur(20px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
        {r.show('label', !!c.label) && c.label && (
          <div style={{ color: r.accent.primary, fontSize: '0.14em', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3em' }} data-field="label">{c.label}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', fontSize: r.font.size, fontWeight: r.font.weight, lineHeight: 1, letterSpacing: '-0.04em' }}>
          <span>{t.h}</span><span style={{ opacity: 0.3, margin: '0 0.05em' }}>:</span><span>{t.m}</span>
          {r.show('seconds', false) && <span style={{ fontSize: '0.45em', color: r.accent.primary, marginLeft: '0.2em', fontWeight: 400 }}>{t.s}</span>}
          {!c.format24 && t.ap && <span style={{ fontSize: '0.3em', marginLeft: '0.3em', fontWeight: 500, color: r.accent.primary }}>{t.ap}</span>}
        </div>
        {r.show('date', true) && (
          <div style={{ fontSize: '0.14em', fontWeight: 400, color: '#64748b', letterSpacing: '0.05em' }}>{formatDate(now, c.timeZone)}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 5. CLOCK_OPS_TERMINAL — admin/staff
// ─────────────────────────────────────────────────────────────────────
export function ClockOpsTerminalWidget({ config, live = true }: WidgetProps<ClockCfg>) {
  const c = config || {};
  const r = resolveStyle({
    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 100,
    fontWeight: 500,
    textColor: '#22d3ee',
    bgColor: '#0a0e14',
    padding: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    accentColor: '#22d3ee',
    accentColor2: '#10b981',
    ...(c.style || {}),
  });
  const now = useNow(1000, live);
  const t = formatClock(now, c.timeZone, true);
  const iso = now.toISOString().slice(0, 10);

  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.18em', color: r.accent.secondary, fontWeight: 600 }}>
          <span>● <span data-field="label">{c.label || 'OPERATIONS'}</span> </span>
          <span>{c.timeZone || 'LOCAL'}</span>
        </div>
        <div style={{ borderTop: `1px dashed ${r.accent.secondary}55`, opacity: 0.5 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
          <span style={{ color: r.accent.secondary, fontSize: '0.4em' }}>$</span>
          <div style={{ fontSize: r.font.size, fontWeight: r.font.weight, color: r.accent.primary, letterSpacing: '0.05em', textShadow: `0 0 12px ${r.accent.primary}88` }}>
            {t.h}:{t.m}{r.show('seconds', true) && `:${t.s}`}
          </div>
        </div>
        <div style={{ borderTop: `1px dashed ${r.accent.secondary}55`, opacity: 0.5 }} />
        {r.show('date', true) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.18em', fontWeight: 500, color: r.font.color, opacity: 0.7 }}>
            <span>DATE: {iso}</span>
            <span>UTC{(now.getTimezoneOffset() / -60 >= 0 ? '+' : '')}{now.getTimezoneOffset() / -60}</span>
          </div>
        )}
      </div>
    </div>
  );
}
