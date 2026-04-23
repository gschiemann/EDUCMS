'use client';

/**
 * KioskSplash — the screens you see on a paired/pairing/registering
 * kiosk before content actually loads. Replaces the previous
 * "rounded rectangle + spinner on dark background" placeholder that
 * the user reasonably called "kinda lame".
 *
 * Three modes, one visual language:
 *   • `mode='registering'`  — quick handshake with the API, branded
 *                             loader
 *   • `mode='pairing'`      — show the 6-character pairing code as
 *                             the hero, big enough to read from the
 *                             far end of a cafeteria
 *   • `mode='connecting'`   — post-pair, waiting for first manifest
 *
 * Design DNA (inherits from the approved Rainbow / Sunny Meadow
 * templates per CLAUDE.md):
 *   — Real shapes, not rounded rectangles. Each pairing-code
 *     character gets its own floating glass tile with a warm inner
 *     glow + subtle 3D bevel.
 *   — Ambient motion: aurora gradient that slowly drifts, 5
 *     semi-transparent orbs floating in parallax, a pulse ring on
 *     the brand logo. None of it competes with the code itself.
 *   — Brand presence: the logo + a thin accent ring + the pairing
 *     tiles all pick up `--brand-primary` / `--brand-accent` via CSS
 *     custom properties, so a Chardon install renders in their red
 *     automatically (same vars BrandStyleInjector writes to :root).
 *     Fallback is an EduCMS indigo/violet palette.
 *   — Typography: Fredoka for headlines (rounded, friendly, reads at
 *     30 feet), Inter-mono for the actual code + IP/device chips.
 *
 * The code tiles use fixed pixel sizes on a 1920×1080 "design canvas"
 * so they look identical on every target (browser tab, Nova Taurus
 * 4K portrait, 1920×1080 hallway TV). CSS clamp() scales the hero
 * down on narrow viewports so the code never overflows a phone.
 */

import { useMemo } from 'react';
import { Wifi, QrCode, MonitorPlay } from 'lucide-react';

type Mode = 'registering' | 'pairing' | 'connecting';

/**
 * Progress state the player pipes into the 'connecting' mode so the
 * splash can tell the operator WHY the kiosk is still on the splash.
 * Previously the splash just said "Loading content…" even if the WS
 * handshake was stuck or a 50MB asset was mid-download; field reports
 * read that as "the player is hung" when it wasn't.
 */
export type LoadPhase =
  | 'manifest'       // fetching /screens/:id/manifest
  | 'assets'         // service-worker is pre-caching media
  | 'emergency'      // topping up the emergency-assets cache tier
  | 'connecting-ws'  // manifest ok, waiting for WS AUTH_OK
  | 'ready';         // about to flip to playing

export interface LoadProgress {
  phase: LoadPhase;
  /** Count of items downloaded (or 0 if we don't know yet). */
  loaded?: number;
  /** Total items to download — undefined = indeterminate (spinner). */
  total?: number;
  /** Current item's human-readable name (file name, playlist title…). */
  currentItem?: string | null;
  /** Non-fatal failures that auto-retry — number of items currently retrying. */
  retrying?: number;
  /** Last error message surfaced by the fetcher — rendered subtle-small. */
  lastError?: string | null;
}

export interface KioskSplashProps {
  mode: Mode;
  brandName?: string | null;
  brandLogoUrl?: string | null;
  pairingCode?: string | null;
  screenName?: string | null;
  /** Resolution string for the tech-chip row, e.g. "1920×1080". */
  resolution?: string | null;
  /** Optional: when the kiosk knows its dashboard URL, we show a QR
   *  pointing to /pair?code=... so an admin can scan from their phone
   *  instead of typing. Pass the fully qualified URL. */
  pairDeepLinkUrl?: string | null;
  /** Connecting-mode progress breakdown. Omit for old behaviour
   *  ("Loading content…" + pulse). */
  loadProgress?: LoadProgress | null;
}

export function KioskSplash({
  mode,
  brandName,
  brandLogoUrl,
  pairingCode,
  screenName,
  resolution,
  pairDeepLinkUrl,
  loadProgress,
}: KioskSplashProps) {
  const displayName = brandName && brandName.trim() ? brandName : 'EduSignage';

  // Each pairing-code character gets its own tile. Map ahead of time
  // so React can key them stably and the stagger animation has a
  // per-index delay.
  const codeChars = useMemo(() => {
    const src = (pairingCode || '').toUpperCase();
    // If the code is shorter than 6 (shouldn't happen but don't blow
    // up in dev), pad with non-breaking spaces so the layout doesn't
    // jump mid-render while we're fetching the code.
    const padded = src.padEnd(6, ' ');
    return padded.split('').slice(0, 6);
  }, [pairingCode]);

  return (
    <div
      className="fixed inset-0 overflow-hidden kiosk-splash"
      data-mode={mode}
      role="status"
      aria-live="polite"
    >
      <style>{CSS}</style>

      {/* Aurora background — two slow-drifting radial gradients + a
          base diagonal. The brand-primary colors thread through so
          Chardon's red (or any tenant's palette) takes over this
          layer instead of the default indigo/violet. */}
      <div className="kiosk-aurora kiosk-aurora-1" />
      <div className="kiosk-aurora kiosk-aurora-2" />
      <div className="kiosk-base" />

      {/* Ambient floating orbs — 5 soft circles drifting on different
          axes to give real depth without anything distracting the
          eye from the code. */}
      <div className="kiosk-orb kiosk-orb-1" />
      <div className="kiosk-orb kiosk-orb-2" />
      <div className="kiosk-orb kiosk-orb-3" />
      <div className="kiosk-orb kiosk-orb-4" />
      <div className="kiosk-orb kiosk-orb-5" />

      {/* Fine grain noise for premium feel (SVG dataURI — no extra
          request, no build step). */}
      <div className="kiosk-grain" aria-hidden />

      {/* Centered stage */}
      <div className="kiosk-stage">
        {/* Brand lockup: logo in a pulsing ring + tenant name */}
        <div className="kiosk-brand">
          <div className="kiosk-logo-ring">
            <div className="kiosk-logo-ring-inner" />
            <div className="kiosk-logo-tile">
              {brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brandLogoUrl} alt="" className="kiosk-logo-img" />
              ) : (
                <MonitorPlay className="kiosk-logo-fallback" />
              )}
            </div>
          </div>
          <h1 className="kiosk-brand-name">{displayName}</h1>
          <p className="kiosk-brand-sub">Digital Signage Player</p>
        </div>

        {/* ── Pairing mode: the hero is the 6-character code ── */}
        {mode === 'pairing' && (
          <>
            <div className="kiosk-instructions">
              <span className="kiosk-instruction-label">To activate this screen</span>
              <span className="kiosk-instruction-line">
                Open your dashboard &rarr; <strong>Screens</strong> &rarr; <strong>Pair Screen</strong>, enter the code below
              </span>
            </div>

            <div className="kiosk-code-row" aria-label={`Pairing code ${pairingCode || ''}`}>
              {codeChars.map((ch, i) => (
                <div
                  key={i}
                  className="kiosk-code-tile"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="kiosk-code-char">{ch.trim() ? ch : '•'}</span>
                  <div className="kiosk-code-glow" />
                </div>
              ))}
            </div>

            {/* Optional: QR helper next to the code — scan from phone
                to pair without typing. Only renders when the URL is
                actually known; keeps the layout balanced either way. */}
            {pairDeepLinkUrl && (
              <div className="kiosk-qr-hint">
                <QrCode className="kiosk-qr-icon" />
                <span>Or scan to pair from your phone</span>
              </div>
            )}

            <div className="kiosk-status-row">
              <span className="kiosk-status-dot" />
              <span className="kiosk-status-text">Waiting for pairing</span>
              <span className="kiosk-status-dots" aria-hidden>
                <span /><span /><span />
              </span>
            </div>
          </>
        )}

        {/* ── Registering mode: branded loader ── */}
        {mode === 'registering' && (
          <>
            <div className="kiosk-pulse-loader">
              <div />
              <div />
              <div />
            </div>
            <p className="kiosk-phase-copy">Connecting to your district&rsquo;s CMS&hellip;</p>
          </>
        )}

        {/* ── Connecting mode: post-pair manifest fetch ── */}
        {mode === 'connecting' && (
          <>
            <div className="kiosk-pulse-loader">
              <div />
              <div />
              <div />
            </div>
            <p className="kiosk-phase-copy">
              {(() => {
                // Phase-specific copy. Falls back to the generic
                // 'Loading content…' when no progress payload yet.
                if (!loadProgress) {
                  return screenName
                    ? <>Loading content for <strong>{screenName}</strong>&hellip;</>
                    : 'Loading content…';
                }
                switch (loadProgress.phase) {
                  case 'manifest':
                    return <>Fetching playlist{screenName ? <> for <strong>{screenName}</strong></> : null}&hellip;</>;
                  case 'assets':
                    return <>Downloading content&hellip;</>;
                  case 'emergency':
                    return <>Caching emergency content&hellip;</>;
                  case 'connecting-ws':
                    return <>Connecting to live updates&hellip;</>;
                  case 'ready':
                    return <>Starting playback&hellip;</>;
                  default:
                    return 'Loading content…';
                }
              })()}
            </p>

            {/* Progress bar — only when we have real counts to show.
                'total' unknown = indeterminate shimmer; 'total' known =
                fill proportion of loaded/total. */}
            {loadProgress && (loadProgress.total || loadProgress.loaded) ? (
              <div className="kiosk-progress-wrap">
                <div
                  className={
                    'kiosk-progress-bar ' +
                    (loadProgress.total ? 'kiosk-progress-bar--determinate' : 'kiosk-progress-bar--indeterminate')
                  }
                  style={
                    loadProgress.total
                      ? { width: `${Math.min(100, Math.round(((loadProgress.loaded ?? 0) / loadProgress.total) * 100))}%` }
                      : undefined
                  }
                />
              </div>
            ) : null}

            {/* Count + current-item line. Kept small so it doesn't
                compete with the phase copy. */}
            {loadProgress && (loadProgress.total || loadProgress.currentItem) ? (
              <p className="kiosk-progress-detail">
                {loadProgress.total ? (
                  <span>
                    {loadProgress.loaded ?? 0} of {loadProgress.total}
                    {loadProgress.retrying ? <> · {loadProgress.retrying} retrying</> : null}
                  </span>
                ) : null}
                {loadProgress.currentItem ? (
                  <span className="kiosk-progress-current">
                    {' '}· {loadProgress.currentItem}
                  </span>
                ) : null}
              </p>
            ) : null}

            {/* Last error — shown subtle; the kiosk keeps trying but
                the operator deserves to know something failed. */}
            {loadProgress?.lastError ? (
              <p className="kiosk-progress-error">⚠ {loadProgress.lastError}</p>
            ) : null}
          </>
        )}

        {/* Tech chips — resolution / screen name / online state. Tiny
            by design: clear on close inspection, invisible across a
            room so it never competes with the code. */}
        <div className="kiosk-tech-chips" aria-hidden={mode !== 'pairing'}>
          {resolution && (
            <span className="kiosk-chip">
              <span className="kiosk-chip-label">Display</span>
              <span className="kiosk-chip-value">{resolution}</span>
            </span>
          )}
          <span className="kiosk-chip">
            <Wifi className="kiosk-chip-icon" />
            <span className="kiosk-chip-value">Online</span>
          </span>
          {screenName && mode !== 'pairing' && (
            <span className="kiosk-chip">
              <span className="kiosk-chip-label">Screen</span>
              <span className="kiosk-chip-value">{screenName}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// All sizes in pixels — the wrapper doesn't scale; the splash lives in
// the viewport directly. clamp() is used to shrink gracefully on
// phone-width browsers without distorting the 1920×1080 kiosk target.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@600;700&display=swap');

.kiosk-splash {
  font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  color: #f1f5f9;
  background: #05060f;
  /* Brand-color fallbacks so the default (unbranded) kiosk still looks
     premium. When a tenant has branding these get overridden by the
     --brand-* vars BrandStyleInjector writes to :root. */
  --splash-primary: var(--brand-primary, #6366f1);
  --splash-accent: var(--brand-accent, #a855f7);
  --splash-warm: #f97316;
}

/* ─── Background layers ──────────────────────────────────────── */
.kiosk-base {
  position: absolute; inset: 0; z-index: 0;
  background:
    radial-gradient(1400px 800px at 15% 20%, rgba(99, 102, 241, 0.18), transparent 60%),
    radial-gradient(1100px 700px at 85% 80%, rgba(168, 85, 247, 0.15), transparent 60%),
    linear-gradient(135deg, #0a0a1a 0%, #111024 40%, #0a0a1a 100%);
}
.kiosk-aurora {
  position: absolute; inset: -20%; z-index: 1;
  pointer-events: none; filter: blur(120px); opacity: 0.55;
  will-change: transform;
}
.kiosk-aurora-1 {
  background: radial-gradient(closest-side, var(--splash-primary), transparent 70%);
  width: 60%; height: 60%; left: -5%; top: -10%;
  animation: aurora-drift-1 32s ease-in-out infinite alternate;
}
.kiosk-aurora-2 {
  background: radial-gradient(closest-side, var(--splash-accent), transparent 70%);
  width: 55%; height: 55%; right: -10%; bottom: -10%;
  animation: aurora-drift-2 40s ease-in-out infinite alternate;
}
@keyframes aurora-drift-1 {
  0%   { transform: translate(0, 0) scale(1); }
  50%  { transform: translate(15%, 10%) scale(1.1); }
  100% { transform: translate(5%, 25%) scale(0.95); }
}
@keyframes aurora-drift-2 {
  0%   { transform: translate(0, 0) scale(1); }
  50%  { transform: translate(-10%, -15%) scale(1.05); }
  100% { transform: translate(-15%, 5%) scale(1.1); }
}

/* ─── Floating orbs ──────────────────────────────────────────── */
.kiosk-orb {
  position: absolute; z-index: 2;
  border-radius: 50%;
  pointer-events: none;
  will-change: transform;
}
.kiosk-orb-1 {
  left: 8%; top: 15%; width: 280px; height: 280px;
  background: radial-gradient(circle at 30% 30%, rgba(167, 139, 250, 0.4), transparent 70%);
  animation: orb-float 14s ease-in-out infinite alternate;
}
.kiosk-orb-2 {
  right: 12%; top: 25%; width: 180px; height: 180px;
  background: radial-gradient(circle at 40% 30%, rgba(251, 146, 60, 0.35), transparent 70%);
  animation: orb-float 18s ease-in-out infinite alternate-reverse;
}
.kiosk-orb-3 {
  left: 20%; bottom: 18%; width: 220px; height: 220px;
  background: radial-gradient(circle at 60% 40%, rgba(236, 72, 153, 0.3), transparent 70%);
  animation: orb-float 22s ease-in-out infinite alternate;
}
.kiosk-orb-4 {
  right: 18%; bottom: 22%; width: 150px; height: 150px;
  background: radial-gradient(circle at 50% 40%, rgba(56, 189, 248, 0.35), transparent 70%);
  animation: orb-float 16s ease-in-out infinite alternate-reverse;
}
.kiosk-orb-5 {
  left: 48%; top: 10%; width: 110px; height: 110px;
  background: radial-gradient(circle at 50% 50%, rgba(52, 211, 153, 0.3), transparent 70%);
  animation: orb-float 20s ease-in-out infinite alternate;
}
@keyframes orb-float {
  from { transform: translate(0, 0); }
  to   { transform: translate(40px, -30px); }
}

.kiosk-grain {
  position: absolute; inset: 0; z-index: 3;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ─── Stage ─────────────────────────────────────────────────── */
.kiosk-stage {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: clamp(20px, 4vw, 48px);
  text-align: center;
}

/* ─── Brand lockup ──────────────────────────────────────────── */
.kiosk-brand {
  display: flex; flex-direction: column; align-items: center;
  margin-bottom: clamp(24px, 4vh, 56px);
}
.kiosk-logo-ring {
  position: relative;
  width: clamp(96px, 11vh, 140px); height: clamp(96px, 11vh, 140px);
  margin-bottom: 18px;
}
.kiosk-logo-ring-inner {
  position: absolute; inset: -8px;
  border-radius: 50%;
  border: 2px solid var(--splash-primary);
  opacity: 0.5;
  animation: logo-pulse 2.8s ease-in-out infinite;
}
.kiosk-logo-tile {
  position: absolute; inset: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  border: 1.5px solid rgba(255,255,255,0.12);
  box-shadow:
    0 20px 40px rgba(0,0,0,0.45),
    inset 0 1px 0 rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  backdrop-filter: blur(8px);
}
.kiosk-logo-img {
  width: 76%; height: 76%; object-fit: contain;
  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
}
.kiosk-logo-fallback {
  width: 48%; height: 48%; color: var(--splash-primary);
  filter: drop-shadow(0 4px 12px rgba(99,102,241,0.5));
}
@keyframes logo-pulse {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50%      { transform: scale(1.08); opacity: 0.85; }
}

.kiosk-brand-name {
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  font-size: clamp(28px, 4.5vh, 48px);
  line-height: 1;
  margin: 0 0 4px 0;
  background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: -0.02em;
}
.kiosk-brand-sub {
  font-size: clamp(12px, 1.4vh, 14px);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #64748b;
  margin: 0;
  font-weight: 500;
}

/* ─── Pairing instructions ──────────────────────────────────── */
.kiosk-instructions {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px;
  margin-bottom: clamp(20px, 3vh, 36px);
}
.kiosk-instruction-label {
  font-family: 'Fredoka', sans-serif;
  font-weight: 500;
  font-size: clamp(13px, 1.6vh, 16px);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--splash-primary);
  opacity: 0.9;
}
.kiosk-instruction-line {
  font-size: clamp(16px, 2.1vh, 22px);
  color: #cbd5e1;
  font-weight: 400;
  max-width: 680px;
}
.kiosk-instruction-line strong {
  color: #ffffff; font-weight: 600;
}

/* ─── Code tiles (the hero) ─────────────────────────────────── */
.kiosk-code-row {
  display: flex; gap: clamp(10px, 1.4vw, 18px);
  margin-bottom: clamp(20px, 3vh, 40px);
  perspective: 1200px;
}
.kiosk-code-tile {
  position: relative;
  width: clamp(80px, 9vw, 140px);
  height: clamp(112px, 13vw, 196px);
  border-radius: 18px;
  background:
    linear-gradient(160deg,
      rgba(255,255,255,0.09) 0%,
      rgba(255,255,255,0.02) 50%,
      rgba(0,0,0,0.2) 100%);
  border: 1.5px solid rgba(255,255,255,0.08);
  box-shadow:
    0 24px 48px rgba(0,0,0,0.5),
    0 2px 0 rgba(255,255,255,0.05) inset,
    0 -2px 0 rgba(0,0,0,0.3) inset;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  animation: tile-pop 600ms cubic-bezier(0.22, 1, 0.36, 1) both,
             tile-bob 4s ease-in-out infinite;
}
@keyframes tile-pop {
  from { opacity: 0; transform: translateY(24px) rotateX(8deg); }
  to   { opacity: 1; transform: translateY(0)    rotateX(0); }
}
@keyframes tile-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-5px); }
}
.kiosk-code-char {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700;
  font-size: clamp(52px, 7vw, 100px);
  background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 60%, var(--splash-primary) 140%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 2px 20px rgba(0,0,0,0.4);
  line-height: 1;
  z-index: 2;
}
.kiosk-code-glow {
  position: absolute; inset: 0;
  background:
    radial-gradient(60% 40% at 50% 100%, var(--splash-primary), transparent 70%);
  opacity: 0.35;
  z-index: 1;
  animation: tile-glow 3s ease-in-out infinite;
}
@keyframes tile-glow {
  0%, 100% { opacity: 0.25; }
  50%      { opacity: 0.55; }
}

/* ─── QR hint ───────────────────────────────────────────────── */
.kiosk-qr-hint {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(8px);
  color: #94a3b8;
  font-size: 14px; font-weight: 500;
  margin-bottom: clamp(16px, 2vh, 28px);
}
.kiosk-qr-icon { width: 18px; height: 18px; color: var(--splash-accent); }

/* ─── Status row ────────────────────────────────────────────── */
.kiosk-status-row {
  display: inline-flex; align-items: center; gap: 12px;
  font-size: clamp(14px, 1.7vh, 17px);
  font-weight: 500;
  color: #cbd5e1;
  letter-spacing: 0.04em;
}
.kiosk-status-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55);
  animation: status-pulse 1.6s ease-in-out infinite;
}
@keyframes status-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); transform: scale(1); }
  50%      { box-shadow: 0 0 0 14px rgba(245, 158, 11, 0); transform: scale(1.15); }
}
.kiosk-status-dots {
  display: inline-flex; gap: 4px; margin-left: 4px;
}
.kiosk-status-dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background: #475569;
  animation: status-dot 1.4s ease-in-out infinite;
}
.kiosk-status-dots span:nth-child(1) { animation-delay: 0s; }
.kiosk-status-dots span:nth-child(2) { animation-delay: 0.2s; }
.kiosk-status-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes status-dot {
  0%, 100% { background: #475569; transform: scale(1); }
  50%      { background: var(--splash-primary); transform: scale(1.4); }
}

/* ─── Registering / Connecting pulse loader ─────────────────── */
.kiosk-pulse-loader {
  display: flex; gap: 12px;
  margin: 24px 0 20px 0;
}
.kiosk-pulse-loader > div {
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--splash-primary);
  box-shadow: 0 0 24px rgba(99, 102, 241, 0.6);
  animation: pulse-loader 1.4s ease-in-out infinite;
}
.kiosk-pulse-loader > div:nth-child(1) { animation-delay: 0s; }
.kiosk-pulse-loader > div:nth-child(2) { animation-delay: 0.2s; background: var(--splash-accent); }
.kiosk-pulse-loader > div:nth-child(3) { animation-delay: 0.4s; background: var(--splash-warm); }
@keyframes pulse-loader {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1.2); opacity: 1; }
}
.kiosk-phase-copy {
  font-family: 'Fredoka', sans-serif;
  font-size: clamp(16px, 2.1vh, 22px);
  color: #cbd5e1;
  margin: 0;
  font-weight: 500;
}
.kiosk-phase-copy strong { color: #ffffff; font-weight: 600; }

/* ─── Download progress bar (connecting mode) ───────────────── */
.kiosk-progress-wrap {
  width: clamp(240px, 34vw, 480px);
  height: 6px;
  margin-top: 18px;
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.05);
}
.kiosk-progress-bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--splash-primary, #6366f1),
    var(--splash-accent, #a855f7)
  );
  transition: width 0.35s ease-out;
}
.kiosk-progress-bar--determinate { width: 0%; }
.kiosk-progress-bar--indeterminate {
  width: 40%;
  animation: kioskProgressSlide 1.6s ease-in-out infinite;
}
@keyframes kioskProgressSlide {
  0%   { transform: translateX(-120%); }
  100% { transform: translateX(280%); }
}
.kiosk-progress-detail {
  margin: 10px 0 0 0;
  font-size: clamp(11px, 1.5vh, 13px);
  color: #94a3b8;
  font-weight: 500;
  max-width: clamp(260px, 40vw, 520px);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kiosk-progress-current {
  color: #cbd5e1;
  font-family: 'Inter', ui-monospace, sans-serif;
  font-size: 0.95em;
}
.kiosk-progress-error {
  margin: 8px 0 0 0;
  font-size: clamp(11px, 1.5vh, 13px);
  color: #fca5a5;
  font-weight: 500;
  max-width: clamp(260px, 40vw, 520px);
  text-align: center;
}

/* ─── Tech chips (bottom of stage) ──────────────────────────── */
.kiosk-tech-chips {
  position: absolute; bottom: clamp(20px, 3vh, 40px);
  left: 50%; transform: translateX(-50%);
  display: flex; flex-wrap: wrap; gap: 10px;
  justify-content: center;
  max-width: 90%;
}
.kiosk-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255,255,255,0.06);
  backdrop-filter: blur(6px);
  font-size: 12px; font-weight: 500;
  color: #94a3b8;
}
.kiosk-chip-label {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 10px;
  color: #64748b;
  font-weight: 600;
}
.kiosk-chip-value {
  color: #cbd5e1; font-weight: 500;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}
.kiosk-chip-icon { width: 12px; height: 12px; color: #10b981; }

/* ─── Portrait-orientation override ─────────────────────────── */
/* When the splash lands on a 1080×1920 portrait display (Nova
   vertical wall, hallway pillar), the code row would overflow if
   we let the tiles scale by vw. Cap them so six tiles always fit
   the narrower width with comfortable gutters. */
@media (orientation: portrait) {
  .kiosk-code-tile {
    width: clamp(72px, 12vw, 132px);
    height: clamp(100px, 17vw, 180px);
  }
  .kiosk-code-char { font-size: clamp(48px, 8.5vw, 92px); }
}
`;
