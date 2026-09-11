"use client";
/**
 * TICKERS pack — 5 widgets, all scrolling.
 * TICKER_NEON_LED, TICKER_PAPER_PRESS, TICKER_CRAYON_TRAIN, TICKER_GLASS_FLOW, TICKER_OPS_FEED
 *
 * 2026-05-04 — three operator-reported issues fixed in this file:
 *
 *   (1) "setting slow, medium fast does nothing"
 *       Cause: PropertiesPanel writes top-level cfg.speed,
 *       TopContextToolbar wrote top-level cfg.speed, but the v2
 *       widgets read config.style.animationSpeed. Speed never
 *       reached the renderer.
 *       Fix: legacy/cfg-shape fallbacks in resolveTickerStyle()
 *       below — top-level cfg.speed / cfg.tickerSpeed feed
 *       config.style.animationSpeed when the latter is unset.
 *
 *   (2) "no way to change the background on a ticker"
 *       Cause: PropertiesPanel had no bg-color picker for ticker.
 *       Fix: added in PropertiesPanel.tsx — writes top-level
 *       cfg.bgColor, this file feeds it into config.style.bgColor.
 *
 *   (3) "the widgets them selves should get your branding overhaul,
 *        the tickers font, font color, background of the widgets,
 *        etc. should be able to have a branded look"
 *       Cause: widgets hard-code their own palette — never read
 *       tenant brand. So the user's brand kit had zero effect on
 *       any rendered widget.
 *       Fix: useBranding() context here as a fallback layer
 *       BETWEEN explicit operator config and the widget's hard-
 *       coded defaults. So the explicit-color path still wins;
 *       brand applies only when the operator hasn't chosen.
 */
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { useBranding, type BrandSnapshot } from '@/lib/branding-context';
import { sceneCss } from '../scene-css';

interface TickerCfg {
  style?: WidgetStyle;
  messages?: string | string[];
  stamp?: string;
  separator?: string;
  // Legacy editor fields (PropertiesPanel writes these). All optional;
  // if present they feed into config.style.* via resolveTickerStyle()
  // unless the operator also set the explicit config.style.* value.
  speed?: 'slow' | 'normal' | 'medium' | 'fast' | number;
  tickerSpeed?: 'slow' | 'normal' | 'medium' | 'fast' | number;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bgColor?: string;
}
function asArr(m?: string | string[]) { if (!m) return ['Welcome back', 'Picture day Friday', 'Library extended hours', 'Drama Club auditions Wed']; return Array.isArray(m) ? m : m.split(/[•·|]+/).map(s => s.trim()).filter(Boolean); }

/**
 * §19 CLICK-TO-EDIT (2026-09-11) — all five ticker variants rendered the
 * operator's messages with NO hotspot on the canvas.
 *
 * Every one of them paints `asArr(c.messages).join(...)` (or maps the array
 * into chips), so the visible text is a LIST flattened for display. A
 * `data-field` there would make it contentEditable and commit ONE flat string
 * over `config.messages`, destroying every row — so the message run carries
 * `data-field-jump="messages"` instead: same live affordance, but the click
 * opens the panel's real "Messages (one per line)" editor. The eyebrow
 * `stamp` IS a single string, so that one is a true inline `data-field`.
 */
const ANIM_CSS = `@keyframes tk-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`;

/**
 * Build the WidgetStyle object that gets fed to resolveStyle().
 * Layers (top wins):
 *   1) The widget-pack default (Neon, Paper, Crayon, Glass, Ops) —
 *      caller passes via `defaults`.
 *   2) Tenant brand from useBranding() — applied where the widget
 *      default left a key blank or where the brand has a meaningful
 *      override (palette.primary on textColor, palette.surface on
 *      bgColor, fontHeading on fontFamily). Applied with override:false
 *      so the widget's own defaults still win against brand.
 *   3) Top-level legacy cfg fields (cfg.color, cfg.bgColor, etc.) —
 *      operator-set via the left sidebar's editor.
 *   4) Explicit cfg.style.* — operator-set via the bottom floating
 *      "This zone" toolbar. Highest priority.
 *
 * The result is what resolveStyle() expects: a WidgetStyle that
 * already encodes the operator's intent + any brand fallbacks.
 *
 * Speed mapping: PropertiesPanel writes 'medium' (its default), which
 * isn't one of our recognized values ('slow' | 'normal' | 'fast').
 * We coerce 'medium' → 'normal' so animDurationSec() doesn't ignore.
 */
function coerceSpeed(s: any): 'slow' | 'normal' | 'fast' | number | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s === 'number') return s;
  if (s === 'medium') return 'normal';
  if (s === 'slow' || s === 'normal' || s === 'fast') return s;
  return undefined;
}

function resolveTickerStyle(
  c: TickerCfg,
  defaults: WidgetStyle,
  brand: BrandSnapshot | null,
): WidgetStyle {
  const explicit = c.style || {};

  // Brand-derived fills. Each only applies when explicit + cfg legacy
  // both leave the field blank. Brand-aware widgets pick:
  //   - text color → palette.ink (foreground readable on surface)
  //   - bg color   → palette.surface (the brand's "page" tone)
  //   - accent     → palette.primary (the headline brand color)
  //   - font       → fontHeading (since tickers are display copy)
  const palette = brand?.palette || {};
  const brandFills: WidgetStyle = {};
  if (palette.ink) brandFills.textColor = palette.ink;
  if (palette.surface) brandFills.bgColor = palette.surface;
  if (palette.primary) brandFills.accentColor = palette.primary;
  if (palette.accent) brandFills.accentColor2 = palette.accent;
  if (brand?.fontHeading) brandFills.fontFamily = brand.fontHeading;

  // Legacy top-level cfg overrides — only set if the operator
  // actually entered something. Empty string / undefined skipped so
  // we don't accidentally clear a brand fill with a placeholder.
  const legacy: WidgetStyle = {};
  if (c.fontFamily) legacy.fontFamily = c.fontFamily;
  if (typeof c.fontSize === 'number' && c.fontSize > 0) legacy.fontSize = c.fontSize;
  if (c.color) legacy.textColor = c.color;
  if (c.bgColor) legacy.bgColor = c.bgColor;
  const legacySpeed = coerceSpeed(c.speed) ?? coerceSpeed(c.tickerSpeed);
  if (legacySpeed !== undefined) legacy.animationSpeed = legacySpeed;

  return {
    ...defaults,
    ...brandFills,
    ...legacy,
    ...explicit,
  };
}

// 1. NEON LED
export function TickerNeonLedWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const brand = useBranding(); const msgs = asArr(c.messages);
  const r = resolveStyle(resolveTickerStyle(c, { fontFamily: "'Audiowide', sans-serif", fontSize: 48, textColor: '#ff2bd6', bgColor: '#0a0014', padding: 0, borderRadius: 8, accentColor: '#ff2bd6', accentColor2: '#ffd60a' }, brand));
  const dur = animDurationSec(r.anim.speed, 30); const text = [...msgs, ...msgs].map(m => `★ ${m}`).join('   ');
  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(ANIM_CSS)}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 16 }}>
        {c.stamp && <div style={{ background: r.accent.highlight, color: '#000', padding: '8px 20px', fontWeight: 800, fontSize: '0.5em', letterSpacing: '0.3em', height: '100%', display: 'flex', alignItems: 'center', boxShadow: `0 0 20px ${r.accent.highlight}` }}>● <span data-field="stamp">{c.stamp}</span></div>}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div data-field-jump="messages" style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, color: r.accent.primary, textShadow: `0 0 12px ${r.accent.primary}, 0 0 24px ${r.accent.primary}`, letterSpacing: '0.1em', fontWeight: 700 }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

// 2. PAPER PRESS — middle
export function TickerPaperPressWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const brand = useBranding(); const msgs = asArr(c.messages);
  const r = resolveStyle(resolveTickerStyle(c, { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 36, textColor: '#0a0a0a', bgColor: '#f5f1e8', padding: 0, borderRadius: 0, accentColor: '#7c1d1d' }, brand));
  const dur = animDurationSec(r.anim.speed, 35); const text = [...msgs, ...msgs].map(m => m).join('  ❖  ');
  return (
    <div style={{ ...frameStyle(r), borderTop: '4px double #0a0a0a', borderBottom: '4px double #0a0a0a' }}>
      <style>{sceneCss(ANIM_CSS)}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <div style={{ background: r.accent.primary, color: '#fff', padding: '14px 24px', fontWeight: 800, fontSize: '0.5em', letterSpacing: '0.3em', height: '100%', display: 'flex', alignItems: 'center' }} data-field="stamp">{c.stamp || 'EXTRA'}</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div data-field-jump="messages" style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, fontStyle: 'italic', padding: '0 20px', fontWeight: 600 }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

// 3. CRAYON TRAIN — elementary
export function TickerCrayonTrainWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const brand = useBranding(); const msgs = asArr(c.messages);
  const r = resolveStyle(resolveTickerStyle(c, { fontFamily: "'Fredoka', sans-serif", fontSize: 40, textColor: '#fff', bgColor: '#fff8e7', padding: 8, borderRadius: 999, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d' }, brand));
  const dur = animDurationSec(r.anim.speed, 32); const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa'];
  const stream = [...msgs, ...msgs];
  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(ANIM_CSS)}</style>
      <div style={{ background: `linear-gradient(90deg, ${r.accent.primary}, ${r.accent.secondary})`, borderRadius: 999, height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden', boxShadow: '0 4px 0 rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '1.5em', padding: '0 20px' }}>🚂</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div data-field-jump="messages" style={{ display: 'inline-flex', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', gap: 18, alignItems: 'center', fontSize: r.font.size, fontWeight: 800 }}>
            {stream.map((m, i) => (<span key={i} style={{ background: '#fff', color: colors[i % colors.length], padding: '6px 18px', borderRadius: 999, boxShadow: '0 3px 0 rgba(0,0,0,0.1)' }}>★ {m}</span>))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. GLASS FLOW — universal
export function TickerGlassFlowWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const brand = useBranding(); const msgs = asArr(c.messages);
  const r = resolveStyle(resolveTickerStyle(c, { fontFamily: "'Inter', sans-serif", fontSize: 26, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', padding: 0, borderRadius: 999, accentColor: '#6366f1' }, brand));
  const dur = animDurationSec(r.anim.speed, 40); const text = [...msgs, ...msgs].join('     ◆     ');
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <style>{sceneCss(ANIM_CSS)}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 16 }}>
        {c.stamp && <div style={{ background: `linear-gradient(135deg, ${r.accent.primary}, #a855f7)`, color: '#fff', padding: '8px 20px', borderRadius: 999, fontSize: '0.7em', fontWeight: 600, letterSpacing: '0.2em', marginLeft: 12 }} data-field="stamp">{c.stamp}</div>}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div data-field-jump="messages" style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, fontWeight: 500, color: r.font.color }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

// 5. OPS FEED — admin
export function TickerOpsFeedWidget({ config }: WidgetProps<TickerCfg>) {
  const c = config || {}; const brand = useBranding(); const msgs = asArr(c.messages);
  const r = resolveStyle(resolveTickerStyle(c, { fontFamily: "'JetBrains Mono', monospace", fontSize: 22, textColor: '#22d3ee', bgColor: '#0a0e14', padding: 0, borderRadius: 4, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24' }, brand));
  const dur = animDurationSec(r.anim.speed, 50); const text = [...msgs, ...msgs].map(m => `[OK] ${m}`).join('  ::  ');
  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(ANIM_CSS)}</style>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <div style={{ background: r.accent.secondary, color: '#000', padding: '6px 16px', fontWeight: 700, fontSize: '0.85em', letterSpacing: '0.2em', height: '100%', display: 'flex', alignItems: 'center' }}>● <span data-field="stamp">{c.stamp || 'FEED'}</span></div>
        <div style={{ flex: 1, overflow: 'hidden', padding: '0 12px' }}>
          <div data-field-jump="messages" style={{ display: 'inline-block', whiteSpace: 'nowrap', animation: r.anim.on ? `tk-scroll ${dur}s linear infinite` : 'none', fontSize: r.font.size, color: r.accent.primary, textShadow: `0 0 6px ${r.accent.primary}55` }}>{text}</div>
        </div>
      </div>
    </div>
  );
}
