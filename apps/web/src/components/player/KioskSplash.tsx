'use client';

/**
 * KioskSplash — the screens you see on a paired/pairing/registering
 * kiosk before content actually loads. Replaces the previous
 * "rounded rectangle + spinner on dark background" placeholder that
 * the user reasonably called "kinda lame".
 *
 * Two modes, one visual language:
 *   • `mode='registering'`  — quick handshake with the API, branded
 *                             loader
 *   • `mode='pairing'`      — show the 6-character pairing code as
 *                             the hero, big enough to read from the
 *                             far end of a cafeteria
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

import { useEffect, useMemo, useState } from 'react';
import { Wifi, QrCode, MonitorPlay } from 'lucide-react';

type Mode = 'registering' | 'pairing';

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

/**
 * Operator-facing playlist summary surfaced on the `stopped` mode.
 * Populated from the manifest the player already fetched — one row
 * per scheduled playlist. Omitting the array renders an empty-state
 * "no playlists scheduled" card.
 */
export interface StoppedPlaylistSummary {
  id: string;
  name: string;
  itemCount: number;
  totalBytes: number;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  isTemplate: boolean;
}

export interface KioskSplashProps {
  mode: Mode;
  brandName?: string | null;
  brandLogoUrl?: string | null;
  pairingCode?: string | null;
  screenName?: string | null;
  /** Resolution string for the tech-chip row, e.g. "1920×1080". */
  resolution?: string | null;
  /** APK version chip on the splash — operator (2026-04-27): "we
   *  showed the apk version on the actual splash screen now... nothing
   *  looks like it changed at all." Pass the player BuildConfig
   *  versionName when known (passed by the APK as ?v= on the URL). */
  apkVersion?: string | null;
  /** Manager APK version chip on the splash, rendered next to the
   *  Player chip so the operator can verify both components are at
   *  the expected version without going to the dashboard. Empty
   *  string / null = "Manager not installed". Pass the value the
   *  APK reports as ?mv= (v1.0.13+ Player). */
  managerVersion?: string | null;
  /** Optional: when the kiosk knows its dashboard URL, we show a QR
   *  pointing to /pair?code=... so an admin can scan from their phone
   *  instead of typing. Pass the fully qualified URL. */
  pairDeepLinkUrl?: string | null;
  // ─── OTA upgrade banners ──────────────────────────────────────
  // Operator (2026-04-28): "screen paired screen should be our
  // main screen with all the info" + "show progress of the
  // upgrade...also why doesnt it say upgrade available? that
  // should be on the pairing splash aswell". Moved from the
  // post-pair click-overlay (where it was hidden behind a tap)
  // to the splash itself so any operator standing in front of a
  // kiosk can see update state at a glance.

  /** Active OTA — set the moment the operator (or dashboard) kicks
   *  off an update. Splash renders an indigo banner with stage emoji
   *  + label (Sending signal → Downloading → Installing → Restart).
   *  Auto-clears 8 minutes after startedAt. Pass null/undefined when
   *  no OTA is in flight. */
  otaProgress?: { startedAt: number; bridgeAvailable?: boolean } | null;

  /** Latest published APK versionName from /api/v1/player/latest-version.
   *  When this is strictly newer than apkVersion, the splash renders an
   *  amber "Update available" banner with an Install Now button (only
   *  rendered if onInstallUpdate is also provided). Omit / null when
   *  not yet fetched. */
  latestApkVersion?: string | null;

  /** Click handler for the "Install now" button on the Update Available
   *  banner. Typically wraps EduCmsNative.checkForUpdates() + sets
   *  otaProgress to non-null. Omit to render the banner without a
   *  button (e.g. on pairing mode where there's no tenant context yet). */
  onInstallUpdate?: () => void;

  // ─── Orientation picker (pairing mode only) ───
  // Operator (2026-05-25): "i would think i pick the orientation from
  // the player during the pairing menu... still keep the ability to
  // change from dashboard but being able to change during setup seems
  // easiest". Three buttons (Landscape / Portrait / Auto) on the
  // pairing splash; the picker calls onOrientationChange immediately
  // so the screen visibly rotates as the operator decides, AND the
  // player route persists the choice to /screens/:id/orientation
  // right after pairing completes.

  /** Current orientation selection. Drives the active-button highlight
   *  in the picker. Defaults to LANDSCAPE if undefined. */
  orientation?: 'LANDSCAPE' | 'PORTRAIT' | 'AUTO' | null;
  /** Click handler — fires immediately on button tap so the kiosk
   *  visibly rotates during setup. */
  onOrientationChange?: (value: 'LANDSCAPE' | 'PORTRAIT' | 'AUTO') => void;
}

export function KioskSplash({
  mode,
  brandName,
  brandLogoUrl,
  pairingCode,
  screenName,
  resolution,
  apkVersion,
  managerVersion,
  pairDeepLinkUrl,
  otaProgress,
  latestApkVersion,
  onInstallUpdate,
  orientation,
  onOrientationChange,
}: KioskSplashProps) {
  const activeOrientation = orientation || 'LANDSCAPE';
  const displayName = brandName && brandName.trim() ? brandName : 'VenueOS';

  // ─── OTA banner state ────────────────────────────────────────
  // Tick every 5s while otaProgress is active so the stage label
  // advances based on elapsed time (15s sending → 60s download →
  // 150s install → 300s restart timeout).
  const [, setOtaTick] = useState(0);
  useEffect(() => {
    if (!otaProgress) return;
    const t = setInterval(() => setOtaTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, [otaProgress]);

  // 2026-05-04 — `isBehind` removed. The dark-blue KioskSplash no
  // longer renders an "Update available" banner; that's the white
  // connected-splash's job (player/page.tsx). KioskSplash still
  // renders the in-progress banner via otaStage below — version
  // comparison isn't needed for that.
  // Reference apkVersion + latestApkVersion + onInstallUpdate so the
  // unused-prop lint doesn't fire when callers still pass them.
  void apkVersion;
  void latestApkVersion;
  void onInstallUpdate;

  // Active stage during an OTA — derived from elapsed time.
  const otaStage = useMemo(() => {
    if (!otaProgress) return null;
    const elapsed = Date.now() - otaProgress.startedAt;
    if (elapsed < 15_000)  return { emoji: '📡', label: 'Sending update signal…' };
    if (elapsed < 60_000)  return { emoji: '⬇️', label: 'Downloading new player…' };
    if (elapsed < 150_000) return { emoji: '⚙️', label: 'Installing… (Android prompt may show)' };
    if (elapsed < 300_000) return { emoji: '🔄', label: 'Restarting + reporting back…' };
    return { emoji: '⏱', label: 'No response after 5 minutes — retry on next reboot' };
  }, [otaProgress]);

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
      className="fixed top-0 right-0 bottom-0 left-0 overflow-hidden kiosk-splash"
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

        {/* ── OTA in-progress banner (shared across all splash modes) ──
            2026-05-04 — operator: "the upgrade available is showing
            on the connecting screen and not on the connected screen".
            Removed the "Update available" branch from KioskSplash
            (this dark-blue boot/registering/pairing splash). The
            white connected-splash already has its own Update banner
            inside the SCROLL-BODY (see player/page.tsx ~line 3878);
            duplicating it on the boot splash made the operator think
            the update prompt belonged to the wrong phase.
            Kept the Update IN PROGRESS branch — operators need to
            see "Installing v1.0.44…" no matter which splash phase
            they happen to be on when the OTA fires. */}
        {otaProgress && otaStage ? (
          <div className="kiosk-ota-banner kiosk-ota-banner--progress">
            <span className="kiosk-ota-emoji">{otaStage.emoji}</span>
            <div className="kiosk-ota-text">
              <div className="kiosk-ota-title">Update in progress</div>
              <div className="kiosk-ota-sub">{otaStage.label}</div>
            </div>
          </div>
        ) : null}

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

            {/* Orientation picker — operator (2026-05-25): set portrait
                vs landscape RIGHT HERE on the kiosk during pairing.
                Calls onOrientationChange immediately so the screen
                visibly rotates as the operator decides. After pairing
                completes the player route persists the choice via
                PUT /screens/:id/orientation. Dashboard control still
                works for changes-after-install. */}
            {onOrientationChange && (
              <div className="kiosk-orient-row" role="group" aria-label="Screen orientation">
                <span className="kiosk-orient-label">Orientation</span>
                <div className="kiosk-orient-buttons">
                  {(['LANDSCAPE', 'PORTRAIT', 'AUTO'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onOrientationChange(v)}
                      className={`kiosk-orient-btn ${activeOrientation === v ? 'kiosk-orient-btn-active' : ''}`}
                      aria-pressed={activeOrientation === v}
                    >
                      {v === 'LANDSCAPE' ? 'Landscape' : v === 'PORTRAIT' ? 'Portrait' : 'Auto'}
                    </button>
                  ))}
                </div>
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
            <p className="kiosk-phase-copy">Connecting to your CMS&hellip;</p>
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
          {apkVersion && (
            <span className="kiosk-chip" title="Player APK version reported by the device">
              <span className="kiosk-chip-label">Player</span>
              <span className="kiosk-chip-value">v{apkVersion}</span>
            </span>
          )}
          {/* Manager chip — operator (2026-04-28): "show the manager
              version on the main player splash screen as well". Two
              states: installed → green chip with version, missing →
              amber chip so it's instantly obvious Manager isn't on
              this kiosk yet (and OTA updates will need a sideload or
              prompt to recover). */}
          {managerVersion ? (
            <span className="kiosk-chip" title="Manager APK version reported by the device">
              <span className="kiosk-chip-label">Manager</span>
              <span className="kiosk-chip-value">v{managerVersion}</span>
            </span>
          ) : managerVersion === '' ? (
            // Empty string is the explicit "Manager not installed"
            // signal Player v1.0.19+ sends. Show a warning chip so
            // operator knows OTA isn't fully wired up.
            <span className="kiosk-chip kiosk-chip-warn" title="Manager APK not installed — OTA install requires manual confirmation per update">
              <span className="kiosk-chip-label">Manager</span>
              <span className="kiosk-chip-value">missing</span>
            </span>
          ) : null}
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
  /* 2026-05-13 — DON'T rely on Tailwind utility classes for layout.
     The Player WebView on a Taurus controller was failing to load
     the global Tailwind CSS bundle (cert / cache / CDN reach — root
     cause varied per Taurus model), and the splash root was using
     "fixed top-0 right-0 bottom-0 left-0" Tailwind classes for positioning. With Tailwind
     missing, the splash collapsed to inline-flow / zero height and
     the body's bg-slate-50 (#f8fafc) showed through as a "white"
     screen. Operator (2026-05-13) lost an evening to this.

     Solution: declare position + inset + size INLINE here so the
     splash works even if Tailwind fails to load. Layout is now
     self-contained in this <style> block. */
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  z-index: 0;
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
/* 2026-05-13 — every 'inset: <value>' rule below ALSO declares
   top/right/bottom/left long-hand. NovaStar Taurus controllers ship
   Chromium 83 which doesn't support the inset shorthand (Chrome 87+).
   Without the long-hand fallback the absolute children fall back to
   top/left/right/bottom: auto — they collapse to content size at
   the top-left of their containing block, and the operator saw
   "Connecting to your CMS..." pinned at top-left of the LED instead
   of centered. */
.kiosk-base {
  position: absolute; inset: 0; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background:
    radial-gradient(1400px 800px at 15% 20%, rgba(99, 102, 241, 0.18), transparent 60%),
    radial-gradient(1100px 700px at 85% 80%, rgba(168, 85, 247, 0.15), transparent 60%),
    linear-gradient(135deg, #0a0a1a 0%, #111024 40%, #0a0a1a 100%);
}
.kiosk-aurora {
  position: absolute; inset: -20%; top: -20%; right: -20%; bottom: -20%; left: -20%; z-index: 1;
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
  position: absolute; inset: 0; top: 0; right: 0; bottom: 0; left: 0; z-index: 3;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ─── Stage ─────────────────────────────────────────────────── */
.kiosk-stage {
  position: absolute; inset: 0; top: 0; right: 0; bottom: 0; left: 0; z-index: 10;
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
  position: absolute; inset: -8px; top: -8px; right: -8px; bottom: -8px; left: -8px;
  border-radius: 50%;
  border: 2px solid var(--splash-primary);
  opacity: 0.5;
  animation: logo-pulse 2.8s ease-in-out infinite;
}
.kiosk-logo-tile {
  position: absolute; inset: 0; top: 0; right: 0; bottom: 0; left: 0;
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
  position: absolute; inset: 0; top: 0; right: 0; bottom: 0; left: 0;
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

/* Orientation picker (pairing splash, 2026-05-25). Per CLAUDE.md
   rule #10 + the Taurus Safety CI gate, no flex spacing-shorthand
   on player-shipped CSS — Chromium 83 (NovaStar Taurus / some
   Goodview ROMs) silently drops it. Spacing comes from per-child
   margin on adjacent siblings instead. Modern engines compute
   the same visual result; zero regression. */
.kiosk-orient-row {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 20px;
}
.kiosk-orient-label {
  font-size: clamp(11px, 1.3vh, 13px);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
  /* Margin instead of parent-level flex spacing (Taurus rule). */
  margin-bottom: 10px;
}
.kiosk-orient-buttons {
  display: inline-flex;
  padding: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
}
/* Adjacent-sibling spacing — CSS 2.1 selector, works everywhere
   including Chromium 83 (no flex-spacing-shorthand required). */
.kiosk-orient-btn + .kiosk-orient-btn {
  margin-left: 8px;
}
.kiosk-orient-btn {
  appearance: none;
  font: inherit;
  border: 0;
  cursor: pointer;
  background: transparent;
  color: #cbd5e1;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: clamp(13px, 1.5vh, 15px);
  font-weight: 500;
  letter-spacing: 0.03em;
  transition: background 120ms ease, color 120ms ease, transform 80ms ease;
}
.kiosk-orient-btn:hover {
  color: #f8fafc;
  background: rgba(99, 102, 241, 0.18);
}
.kiosk-orient-btn:active {
  transform: scale(0.97);
}
.kiosk-orient-btn-active {
  background: #6366f1;
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
}
.kiosk-orient-btn-active:hover {
  background: #4f46e5;
  color: #ffffff;
}

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

/* ─── Registering pulse loader ──────────────────────────────── */
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
/* Warning variant — Manager-missing chip uses this so the operator
   instantly sees Manager isn't installed without reading the value. */
.kiosk-chip-warn {
  background: rgba(120, 53, 15, 0.45);
  border-color: rgba(245, 158, 11, 0.35);
  color: #fde68a;
}
.kiosk-chip-warn .kiosk-chip-label { color: #fbbf24; }
.kiosk-chip-warn .kiosk-chip-value { color: #fef3c7; }

/* ─── OTA banner (Update available / Update in progress) ────── */
.kiosk-ota-banner {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 22px;
  border-radius: 18px;
  margin-bottom: clamp(20px, 3vh, 36px);
  max-width: min(680px, 92vw);
  width: max-content;
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.32);
  animation: ota-slide-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes ota-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.kiosk-ota-banner--progress {
  background: rgba(99, 102, 241, 0.18);
  border: 1px solid rgba(165, 180, 252, 0.45);
  color: #e0e7ff;
}
.kiosk-ota-banner--available {
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(251, 191, 36, 0.45);
  color: #fef3c7;
}
.kiosk-ota-emoji {
  font-size: 36px;
  line-height: 1;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));
}
.kiosk-ota-text {
  display: flex; flex-direction: column; gap: 2px;
  text-align: left;
  min-width: 0;
}
.kiosk-ota-title {
  font-family: 'Fredoka', 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(14px, 1.8vh, 17px);
  letter-spacing: 0.02em;
}
.kiosk-ota-banner--progress .kiosk-ota-title { color: #ffffff; }
.kiosk-ota-banner--available .kiosk-ota-title { color: #fffbeb; }
.kiosk-ota-sub {
  font-size: clamp(12px, 1.5vh, 14px);
  font-weight: 500;
  opacity: 0.92;
}
.kiosk-ota-sub strong {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700;
}
.kiosk-ota-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 18px;
  border-radius: 12px;
  border: 0;
  background: #f59e0b;
  color: #422006;
  font-family: 'Inter', sans-serif;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(245, 158, 11, 0.35);
  transition: transform 0.15s, background 0.15s;
}
.kiosk-ota-btn:hover { background: #fbbf24; transform: translateY(-1px); }
.kiosk-ota-btn:active { transform: translateY(0); }
.kiosk-ota-btn-icon { width: 14px; height: 14px; }

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

/* ─── Ultra-narrow portrait tower (Nova Taurus LED poster) ──────
   Operator 2026-05-13: deploying to a single 320×1080 LED poster.
   Six horizontal code tiles can't fit in ~280px of usable width
   even at 32px tile width — they'd touch and read as one blob.
   Below 480px viewport width the code row stacks VERTICALLY: each
   tile is full-width, 1/8 of the viewport height, so six fit
   comfortably with hero text above + status footer below. */
@media (max-width: 480px) {
  /* 2026-05-13 — targets the actual class names defined in this
     file (kiosk-stage, kiosk-brand-name, etc.) — not "kiosk-frame"
     which doesn't exist. Earlier version was a no-op. */
  .kiosk-stage { padding: 4vw 2vw !important; gap: 2vh !important; }
  .kiosk-instructions { font-size: 4vw !important; }
  .kiosk-instruction-label { font-size: 3vw !important; }
  .kiosk-instruction-line { font-size: 4vw !important; }
  .kiosk-code-row {
    flex-direction: column !important;
    gap: 1.5vh !important;
    width: 90% !important;
  }
  .kiosk-code-tile {
    width: 100% !important;
    height: 10vh !important;
    min-height: 60px !important;
    max-height: 110px !important;
  }
  .kiosk-code-char { font-size: 6.5vh !important; }
  .kiosk-qr-hint { font-size: 3vw !important; }
  /* Brand row + status footer compress so the pairing code dominates. */
  .kiosk-brand-name { font-size: 4.5vw !important; }
  .kiosk-status-row { font-size: 2.8vw !important; gap: 1vw !important; flex-wrap: wrap; }
}
`;
