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

import { useCallback, useEffect, useMemo, useState } from 'react';
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

  /** 2026-05-27 — Operator's chosen hardware model from the manifest
   *  (`hardwareModel` field on `Screen`). Drives hardware-specific UI
   *  gating: the "LED canvas not set" prompt only appears on hardware
   *  that actually drives daisy-chained LED panels. On LCD-driven
   *  boxes (goodview-ep6n, pi5, generic-android, web) the prompt is
   *  noise — they render at the WebView's native resolution.
   *  Null / 'unknown' = show the prompt (safe default — legacy state). */
  hardwareModel?: string | null;
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
  hardwareModel,
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
      style={{
        // 2026-05-26 — pairing splash root explicitly honors the LED
        // canvas (set by the pin script in layout.tsx). Top-left
        // anchored at 0,0 so daisy-chained panels see content
        // starting at the leftmost pixel of the chain. Operator:
        // "1 panel = 320×1080, 2 = 640×1080, 3 = 960×1080, ... up
        // to 6 = 1920×1080". Each chain size resolves --led-w to
        // the matching total width.
        //
        // 2026-07-03 — Rule #10 variant 3: `right`/`bottom` are DELIBERATELY
        // OMITTED, not set to 'auto'. All four of top/right/bottom/left in
        // one style object — even with right/bottom at 'auto' — makes the
        // browser's CSSOM re-serialize them into the `inset` SHORTHAND in
        // the DOM `style` attribute (`inset: 0px auto auto 0px`), which
        // collides with the player/layout.tsx Chromium-83 polyfill's
        // `[style*="inset: 0"]` selector and force-zeroes right/bottom.
        // Harmless here only because width/height already pin the box, but
        // a landmine pattern regardless — omit right/bottom so only two
        // sides ever reach the `style` attribute (never four), which can
        // never serialize to `inset`. Zero behavior change. CLAUDE.md rule #10.
        width: 'var(--led-w, 100vw)',
        height: 'var(--led-h, 100vh)',
        top: 0,
        left: 0,
      }}
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

      {/* 2026-05-26 — Diagnostic overlay. Operator: "what about
          writing text all the way across it for a test and ill send a
          pic of what the screen shows so you can pinpoint what the
          issue is and adjust it." Two layers:

          1. Always-on tiny strip at the bottom-left showing viewport
             width × height and LED canvas (--led-w × --led-h). 11px
             white-on-black, 60% opacity. So small it doesn't compete
             with the splash content but ALWAYS photographable if the
             operator points a camera at the LED. If the LED captures
             "1920x1080 LED:320x1080" in this strip, the pin script is
             working and the bug is elsewhere; if it captures only
             the aurora background and no strip, the pin didn't run.

          2. Test stripes triggered by appending `?debug=1` to the
             player URL. Renders 4 huge vertical bands across the FULL
             frame with their x-coordinate labeled — operator photo-
             graphs the LED and we instantly see what x-range the LED
             is capturing (e.g. if the LED only shows the "0-320"
             band, we know the LED is mirroring the leftmost 320 px
             of the controller's 1920 frame buffer). Also prints a
             diagonal "VENUEOS DEBUG" wordmark so the photo is
             unambiguously the debug overlay (not stale screen
             content). */}
      <KioskDiagnostics mode={mode} hardwareModel={hardwareModel} />
    </div>
  );
}

/**
 * KioskDiagnostics — debug overlay for diagnosing LED canvas-vs-
 * viewport mismatches on locked-firmware controllers (NovaStar Taurus,
 * etc.) where the WebView reports a viewport size different from what
 * the LED panel physically captures.
 *
 * - Always-on: a tiny bottom-left strip with viewport+LED dimensions
 *   so any operator photo of the kiosk contains the proof-of-state.
 * - On `?debug=1`: full-screen vertical bands at 0/480/960/1440 px
 *   labeled with their x-coordinate, so the photo unambiguously shows
 *   which slice of the frame buffer the LED is mirroring.
 *
 * Chromium-83 safe: no aspect-ratio, no :where(), no inset shorthand,
 * no backdrop-filter. Inline styles to bypass the splash CSS scaling.
 */
function KioskDiagnostics({
  mode,
  hardwareModel,
}: {
  mode: Mode;
  /** 2026-05-27 — when set to an LCD-driven model the "LED canvas not
   *  set" banner is suppressed (irrelevant for non-LED hardware). When
   *  null / 'unknown' the banner shows (legacy / safe default). */
  hardwareModel?: string | null;
}) {
  const [debugOn, setDebugOn] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupW, setSetupW] = useState<string>('');
  const [setupH, setSetupH] = useState<string>('');
  // 2026-05-27 — Operator-dismissible LED banner. Stored under
  // edu_dismiss_led_banner so a one-time tap survives reloads.
  // ⚠️ HYDRATION (2026-08-30 deepest audit): NEVER initialize state from
  // localStorage/window in a component in the boot tree — the server
  // renders one tree (false) and a dismissed-banner client renders another
  // (true), React throws the whole server tree away, and every kiosk paid
  // that on every boot. Initialize to the SERVER value; hydrate the real
  // one a frame later in the effect below.
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('edu_dismiss_led_banner') === '1') setBannerDismissed(true);
    } catch { /* storage unavailable — banner stays visible, safe default */ }
  }, []);
  // 2026-06-16 — the "LED canvas not set" banner is ONLY meaningful on
  // hardware that drives a multi-panel LED canvas (the player IS the LED
  // controller and needs the panel count to size the canvas): NovaStar
  // Taurus and the Goodview ECBox LED-ribbon box. Every other model —
  // EP6N / Pi / generic-Android / web — renders at native resolution, AND
  // an unpaired or unknown screen (hardwareModel null) is a plain display
  // too, so the banner is just noise there. This was previously inverted
  // ("show unless a known LCD"), which put the LED prompt on standard TVs
  // and the pairing screen (operator: "why are we showing this LED poster
  // menu on a standard screen"). Source of truth for the ids:
  // packages/api-types/src/hardware-models.ts.
  const isLedCanvasHardware = !!hardwareModel && [
    'novastar-taurus',
    'goodview-ecbox3576',
  ].includes(hardwareModel);
  const showLedBanner = isLedCanvasHardware && !bannerDismissed;
  const [dims, setDims] = useState<{
    vw: number; vh: number; ledW: string; ledH: string; narrow: boolean; cfg: boolean;
  } | null>(null);

  // 2026-05-26 — operator: "how much fucking time do you need to get
  // this to work right". The orange banner was useless because the
  // operator can't navigate to "Info → Resize for LED" from the
  // splash itself. Clicking the banner now opens this inline setup
  // form. They type W + H + tap Apply. We write localStorage edu_
  // canvasW / edu_canvasH AND append the params to the URL so a
  // reload picks them up via the pin script. No dashboard trip
  // required.
  const applyCanvasSetup = useCallback(() => {
    const w = parseInt(setupW, 10);
    const h = parseInt(setupH, 10);
    if (!w || !h || w < 32 || h < 32 || w > 8192 || h > 8192) {
      // Don't accept obviously bad values. Inline error feedback
      // would be nicer but operator's in a hurry; reject silently
      // + leave fields in place so they can correct.
      return;
    }
    try {
      // 1. Persist to localStorage — the pin script reads this on
      //    every subsequent load even when URL params are absent.
      localStorage.setItem('edu_canvasW', String(w));
      localStorage.setItem('edu_canvasH', String(h));
      // 2. Append to current URL so a reload picks them up
      //    immediately + so the operator can SEE the params if they
      //    inspect the URL (debugging aid).
      const url = new URL(window.location.href);
      url.searchParams.set('canvasW', String(w));
      url.searchParams.set('canvasH', String(h));
      window.location.replace(url.toString());
    } catch {
      // localStorage / URL APIs not available — extremely rare, just
      // reload with the URL params.
      window.location.search = `?canvasW=${w}&canvasH=${h}`;
    }
  }, [setupW, setupH]);

  useEffect(() => {
    // Pull debug=1 from the URL once on mount. SSR-safe.
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      setDebugOn(params.get('debug') === '1');
    } catch {}

    const measure = () => {
      const root = document.documentElement;
      const style = window.getComputedStyle(root);
      setDims({
        vw: window.innerWidth || 0,
        vh: window.innerHeight || 0,
        ledW: style.getPropertyValue('--led-w').trim() || '—',
        ledH: style.getPropertyValue('--led-h').trim() || '—',
        narrow: root.hasAttribute('data-led-narrow'),
        // 2026-05-26 — track whether the operator has configured the
        // LED canvas (via "Resize for LED"). When false, we use the
        // WebView viewport as a fallback — fine for landscape kiosks
        // but won't render correctly for narrow LEDs.
        cfg: root.getAttribute('data-led-cfg') === '1',
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (!dims) return null;

  return (
    <>
      {/* Always-on tiny dimension strip. position:fixed so it bypasses
          the .kiosk-splash containing block + sits at the bottom-left
          regardless of the splash's data-led-narrow re-layout. */}
      <div
        style={{
          position: 'fixed',
          left: 4,
          bottom: 4,
          zIndex: 999999,
          padding: '2px 5px',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontSize: 10,
          fontFamily: 'monospace',
          lineHeight: 1.2,
          opacity: 0.65,
          borderRadius: 2,
          pointerEvents: 'none',
          letterSpacing: 0,
        }}
        aria-hidden="true"
      >
        VP {dims.vw}×{dims.vh}{' '}
        LED {dims.ledW || '—'}×{dims.ledH || '—'}{' '}
        {dims.narrow ? 'N' : '·'} · cfg{dims.cfg ? '✓' : '✗'} · {mode[0]?.toUpperCase()}
      </div>

      {/* 2026-05-26 — "configure LED" prompt. When the LED canvas
          isn't configured (cfg=false) the player is rendering against
          the WebView viewport (usually 1920×1080 on a Taurus). If the
          LED's visible region is smaller than that, splash content
          falls off the edge. This banner tells the operator to run
          "Resize for LED" + how to do it. Pairing/registering only;
          plays alongside the always-on tiny strip below.
          2026-05-27 — Gated on (a) hardware actually drives an LED
          canvas (not an LCD-direct box like the Goodview EP6N) and
          (b) operator hasn't dismissed it (X button). */}
      {!dims.cfg && !setupOpen && showLedBanner && (
        <div
          style={{
            position: 'fixed',
            top: 8,
            left: 8,
            zIndex: 999997,
            display: 'flex',
            alignItems: 'stretch',
            background: 'rgba(251,146,60,0.97)',
            color: '#1f1300',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
            lineHeight: 1.3,
            borderRadius: 6,
            maxWidth: 280,
            fontWeight: 700,
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            border: '2px solid #c2410c',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setSetupOpen(true);
              if (!setupW) setSetupW('320');
              if (!setupH) setSetupH('1080');
            }}
            style={{
              padding: '8px 12px',
              background: 'transparent',
              color: '#1f1300',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.3,
              border: 'none',
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              flex: 1,
            }}
          >
            ⚠️ LED CANVAS NOT SET<br />
            <span style={{ fontWeight: 600, fontSize: 11 }}>
              Tap to set how many panels you have
            </span>
          </button>
          {/* 2026-05-27 — Dismiss button. Operator's screen is an LCD-direct
              install, the banner doesn't apply, but the hardware model
              isn't set on the Screen row yet. One tap silences the
              banner; persists across reloads. The persistent fix is to
              set the hardware model in dashboard → Screens → this screen. */}
          <button
            type="button"
            aria-label="Dismiss LED canvas banner"
            onClick={() => {
              try { localStorage.setItem('edu_dismiss_led_banner', '1'); } catch {}
              setBannerDismissed(true);
            }}
            style={{
              padding: '8px 10px',
              background: 'transparent',
              color: '#1f1300',
              fontSize: 16,
              fontWeight: 700,
              border: 'none',
              borderLeft: '2px solid rgba(0,0,0,0.18)',
              cursor: 'pointer',
              lineHeight: 1,
              alignSelf: 'stretch',
              minWidth: 32,
            }}
            title="Dismiss — set the hardware model in dashboard to permanently hide"
          >
            ×
          </button>
        </div>
      )}

      {/* Inline canvas-setup form. Opens when the orange banner is
          tapped. The PRIMARY flow is now "how many panels do you
          have" — one tap = canvas configured. Custom W/H form is
          a fold-out for non-standard LEDs. Operator: "i have 3
          screens connected together... 1 panel = 320×1080, 2 = 640
          ×1080, 3 = 960×1080... all the way up until 6 screens at
          1920×1080". */}
      {!dims.cfg && setupOpen && (
        <div
          style={{
            position: 'fixed',
            top: 8,
            left: 8,
            right: 8,
            maxWidth: 380,
            zIndex: 999997,
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.98)',
            color: '#0f172a',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
            borderRadius: 10,
            border: '2px solid #c2410c',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          <div
            style={{
              fontWeight: 800,
              marginBottom: 6,
              color: '#9a3412',
              fontSize: 13,
            }}
          >
            How many LED panels are daisy-chained?
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#475569',
              marginBottom: 10,
              lineHeight: 1.4,
            }}
          >
            Each panel is 320×1080. Tap how many you have to set the
            total canvas — the splash + your content will scale to fit
            the entire chain.
          </div>
          {/* N-PANEL PRIMARY PICKER — 1..6 grid. One tap fills both
              W (= 320 × N) and H (= 1080). */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 6,
              marginBottom: 10,
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const w = 320 * n;
              const h = 1080;
              const isActive = setupW === String(w) && setupH === String(h);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setSetupW(String(w));
                    setSetupH(String(h));
                  }}
                  style={{
                    padding: '12px 4px',
                    fontSize: 18,
                    fontWeight: 800,
                    background: isActive ? '#c2410c' : '#f1f5f9',
                    color: isActive ? 'white' : '#475569',
                    border: isActive ? '2px solid #c2410c' : '1px solid #cbd5e1',
                    borderRadius: 6,
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                  title={`${n} panel${n === 1 ? '' : 's'} = ${w}×${h}`}
                >
                  {n}
                  <span style={{ display: 'block', fontSize: 9, fontWeight: 700, marginTop: 4, opacity: 0.85 }}>
                    {w}px
                  </span>
                </button>
              );
            })}
          </div>
          {/* Custom dimensions fold-out (for non-standard LEDs). */}
          <details style={{ marginBottom: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: '#64748b', fontWeight: 700, userSelect: 'none' }}>
              Non-standard panel? Set custom width × height
            </summary>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <label style={{ flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#475569',
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    marginBottom: 4,
                  }}
                >
                  Width (px)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={32}
                  max={8192}
                  value={setupW}
                  onChange={(e) => setSetupW(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 16,
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: 'white',
                    color: '#0f172a',
                  }}
                />
              </label>
              <label style={{ flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#475569',
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    marginBottom: 4,
                  }}
                >
                  Height (px)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={32}
                  max={8192}
                  value={setupH}
                  onChange={(e) => setSetupH(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 16,
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: 'white',
                    color: '#0f172a',
                  }}
                />
              </label>
            </div>
          </details>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
            Selected: <strong style={{ color: '#0f172a' }}>{setupW || '—'} × {setupH || '—'} px</strong>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 700,
                background: 'white',
                color: '#475569',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCanvasSetup}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 800,
                background: '#c2410c',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Apply &amp; reload
            </button>
          </div>
        </div>
      )}

      {/* ?debug=1 — giant vertical test stripes across the frame
          buffer. Each labeled with its x-range so the LED photo
          tells us exactly which x-slice is captured. Black tag in
          the center of each band so it photographs cleanly even
          against the saturated band color. */}
      {debugOn && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 999998,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          {[
            { x: 0,    w: 480, color: '#ef4444', label: '0–480' },
            { x: 480,  w: 480, color: '#22c55e', label: '480–960' },
            { x: 960,  w: 480, color: '#3b82f6', label: '960–1440' },
            { x: 1440, w: 480, color: '#eab308', label: '1440–1920' },
          ].map((band) => (
            <div
              key={band.x}
              style={{
                position: 'absolute',
                top: 0,
                left: band.x,
                width: band.w,
                height: '100%',
                background: band.color,
                opacity: 0.85,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000',
                fontFamily: 'monospace',
                fontSize: 36,
                fontWeight: 900,
                textShadow: '0 0 6px rgba(255,255,255,0.9)',
              }}
            >
              {band.label}
            </div>
          ))}
          {/* Diagonal wordmark proves the overlay IS what's being
              photographed (not a stale frame). */}
          <div
            style={{
              position: 'absolute',
              top: '40%',
              left: 0,
              width: '100%',
              textAlign: 'center',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 64,
              fontWeight: 900,
              textShadow: '0 0 12px rgba(0,0,0,0.9)',
              letterSpacing: 4,
            }}
          >
            VENUEOS DEBUG
          </div>
          {/* Big readable summary at the bottom — viewport + LED + flags. */}
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 0,
              width: '100%',
              textAlign: 'center',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 22,
              fontWeight: 700,
              textShadow: '0 0 8px rgba(0,0,0,0.95)',
            }}
          >
            VP {dims.vw}×{dims.vh} · LED {dims.ledW}×{dims.ledH} · narrow={dims.narrow ? 'YES' : 'no'} · mode={mode}
          </div>
        </div>
      )}
    </>
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
     self-contained in this inline style block. (Do NOT write a
     literal open-style tag inside this CSS text: React SSR escapes
     it as a CSS hex escape in the serialized HTML, the client JSX
     keeps the raw token, and the text mismatch fails hydration on
     every boot.) */
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

/* ─── SHORT-VIEWPORT OVERRIDE (field install, 2026-08-25) ────────
   THE PHOTO: a brand-new 2160×3840 Goodview, pre-pairing, reported
   "VP 720x405" in its own debug strip (this whole block lives inside
   a JS template literal, so no backticks and no dollar-brace here) —
   and the operator's picture
   showed "ORIENTATION / Landscape Portrait Auto" sitting ON TOP of
   the "MANAGER v1.0.23" chip and the "Waiting for pairing" line.

   THE CAUSE, and it is not the orientation bug next to it: at a 4K
   panel's devicePixelRatio the CSS viewport is only ~405px TALL, and
   the pairing column (brand lockup + instructions + 6 code tiles + QR
   hint + orientation picker + status row) is far taller than that.
   .kiosk-stage is justify-content:center with no overflow handling,
   so the excess spills EQUALLY off the top and the bottom — straight
   over .kiosk-tech-chips, which is position:absolute + bottom and
   therefore cannot be pushed out of the way.

   That is byte-for-byte the same failure the 2026-05-26 round-2 fix
   solved for the 320x1080 Taurus poster — but that fix was gated on
   a max-width:480px media query, i.e. on a NARROW viewport. A viewport
   that is short but WIDE (720×405) matched nothing and kept the
   centred, overflowing, overlap-producing layout.

   THE FIX: top-anchor + scroll (so overflow goes one direction and
   stays reachable), trim the vertical furniture, and — the part that
   actually kills the overlap — put the tech chips back IN FLOW so
   nothing can ever be painted on top of them.

   Taurus rules apply here (this file ships to the player): physical
   long-hand sides only, no inset shorthand, and NO new gap on a flex
   container — spacing below is per-child margin. */
@media (max-height: 560px) {
  .kiosk-stage {
    justify-content: flex-start !important;
    overflow-y: auto !important;
    padding: 2vh 3vw !important;
  }
  /* The brand lockup is the cheapest height to give back — the
     pairing code is what the operator is actually here to read. */
  .kiosk-brand { margin-bottom: 1.5vh !important; }
  .kiosk-logo-ring {
    width: clamp(40px, 11vh, 72px) !important;
    height: clamp(40px, 11vh, 72px) !important;
    margin-bottom: 4px !important;
  }
  .kiosk-brand-name { font-size: clamp(14px, 4.5vh, 22px) !important; }
  .kiosk-instruction-label { font-size: clamp(8px, 2.4vh, 11px) !important; }
  .kiosk-instruction-line { font-size: clamp(10px, 3vh, 14px) !important; }
  .kiosk-code-tile {
    width: clamp(44px, 7vw, 88px) !important;
    height: clamp(58px, 22vh, 116px) !important;
  }
  .kiosk-code-char { font-size: clamp(30px, 14vh, 64px) !important; }
  .kiosk-instructions { margin-bottom: 1vh !important; }
  .kiosk-orient-row { margin-bottom: 1.5vh !important; }
  .kiosk-orient-btn { padding: 5px 12px !important; }
  .kiosk-qr-hint { margin-bottom: 1vh !important; }
  /* ⚠️ THE OVERLAP FIX. Absolute + bottom-anchored is what let the
     overflowing column land on top of these. In flow they are simply
     the last row of the column and can never be covered. */
  .kiosk-tech-chips {
    position: static !important;
    transform: none !important;
    left: auto !important;
    bottom: auto !important;
    margin-top: 0.8vh !important;
    max-width: 100% !important;
  }
  .kiosk-chip { padding: 4px 9px !important; font-size: 10px !important; }
}

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
   comfortably with hero text above + status footer below.

   2026-05-26 round 2 — operator on player v1.0.71 reports the
   splash isn't visible at all on a 320x1080 Taurus. Root cause:
   .kiosk-stage is justify-content: center (vertical-center). When
   the stacked content exceeds 1080px the overflow lands BOTH at
   top AND bottom of the viewport — including the brand row at
   the top, which is what the operator looks for to confirm the
   splash is live. Fix: switch to justify-content: flex-start on
   ultra-narrow + add overflow-y: auto so anything that still
   overflows is at least scrollable. Also tightened logo + brand
   sizing so the whole pairing UI fits in 1080px without scroll on
   the common Taurus dimensions. */
@media (max-width: 480px) {
  /* Top-anchor + overflow-safe. Center was hiding the top portion
     of the splash when total content exceeded viewport height. */
  .kiosk-stage {
    padding: 2vh 4vw !important;
    gap: 1.6vh !important;
    justify-content: flex-start !important;
    overflow-y: auto !important;
  }
  /* Shrink the brand block so the pairing code dominates the
     1080px-tall viewport (operator's primary action). */
  .kiosk-brand { margin-bottom: 1.5vh !important; }
  .kiosk-logo-ring {
    width: clamp(72px, 8vh, 110px) !important;
    height: clamp(72px, 8vh, 110px) !important;
    margin-bottom: 8px !important;
  }
  .kiosk-brand-name { font-size: 5vw !important; }
  .kiosk-instructions { font-size: 4vw !important; }
  .kiosk-instruction-label { font-size: 3vw !important; }
  .kiosk-instruction-line { font-size: 4vw !important; }
  .kiosk-code-row {
    flex-direction: column !important;
    gap: 1vh !important;
    width: 90% !important;
  }
  .kiosk-code-tile {
    width: 100% !important;
    height: 8vh !important;
    min-height: 56px !important;
    max-height: 90px !important;
  }
  .kiosk-code-char { font-size: 5.5vh !important; }
  .kiosk-qr-hint { font-size: 3vw !important; }
  /* Status footer compresses + wraps so it always reaches the
     bottom of the visible viewport on 320×1080. */
  .kiosk-status-row { font-size: 2.8vw !important; gap: 1vw !important; flex-wrap: wrap; }
}

/* ─── Narrow-LED canvas override (2026-05-26 round 3) ─────────────
   The two previous fix-rounds (276b361, 2c66b58) BOTH targeted only
   the (max-width: 480px) media query above. Operator on Player v1.0.71
   STILL reports the splash invisible on a 320×1080 Taurus.

   The actual root cause confirmed via Playwright probe against
   https://venue-os.app/player at 1920×1080 (Taurus controller's
   native frame buffer, NOT the 320×1080 LED): the Player APK passes
   ?w=1920&h=1080 because that's what Android reports the display
   to be; the LED panel is 320×1080 but the WebView's CSS viewport
   is the controller's 1920×1080. (max-width: 480px) NEVER MATCHES
   on this device. The splash renders centered in 1920px — brand at
   x=928, code tiles at x=495..1425 — and the LED captures only
   pixels x=0..320, which contain ONLY the aurora-gradient background.
   No text, no logo, no code tiles. That's the "purple and white but
   no text" the operator photographs.

   Fix: when the layout.tsx pin script detects a narrow LED canvas
   (effW < 600 OR effH > effW * 2) it sets data-led-narrow="1" on
   <html>. Below, we constrain the splash to render in a column at
   the LEFT edge of the viewport, sized to the LED's actual
   canvas (--led-w × --led-h). All vw/vh units inside the splash
   are recalibrated to that canvas via overrides below.

   The narrow-stack layout (same as max-width 480 path) is forced
   regardless of viewport width because the visible LED region IS
   narrow even when the CSS viewport reports wide. */
[data-led-narrow] .kiosk-splash {
  /* Anchor splash to top-left of the viewport — that's where the LED
     captures from. Width/height match the LED canvas, not the
     controller frame buffer. */
  width: var(--led-w, 100vw) !important;
  height: var(--led-h, 100vh) !important;
  left: 0 !important;
  top: 0 !important;
  right: auto !important;
  bottom: auto !important;
}
[data-led-narrow] .kiosk-stage {
  /* Stage now lives inside a --led-w wide column. Padding + gap use
     percentage of LED canvas so they scale to the actual visible
     region rather than the 1920px frame buffer. */
  padding: 2% 4% !important;
  gap: 1.6% !important;
  justify-content: flex-start !important;
  align-items: center !important;
  overflow-y: auto !important;
}
[data-led-narrow] .kiosk-brand { margin-bottom: 1.5% !important; }
[data-led-narrow] .kiosk-logo-ring {
  /* Logo sized off LED width (8% of e.g. 320 = 25.6px is too small;
     use 25% of LED width to give a presence on the poster). Width +
     height both computed off --led-w to keep it square; aspect-ratio
     CSS property is Chrome 88+ and Taurus is Chromium 83. */
  width: calc(var(--led-w, 320px) * 0.25) !important;
  height: calc(var(--led-w, 320px) * 0.25) !important;
  max-width: 110px !important;
  min-width: 56px !important;
  margin-bottom: 8px !important;
}
[data-led-narrow] .kiosk-brand-name {
  /* Brand-name needs to be visible — 12% of LED width gives ~38px on
     a 320 LED, large enough to read at 5-foot distance. Computed off
     --led-w so the size tracks the actual LED canvas instead of the
     wider viewport (which on a Taurus is 1920×1080 = far too big). */
  font-size: calc(var(--led-w, 320px) * 0.12) !important;
}
[data-led-narrow] .kiosk-brand-sub {
  font-size: calc(var(--led-w, 320px) * 0.04) !important;
}
[data-led-narrow] .kiosk-instructions {
  margin-bottom: 1.5% !important;
}
[data-led-narrow] .kiosk-instruction-label {
  font-size: calc(var(--led-w, 320px) * 0.035) !important;
}
[data-led-narrow] .kiosk-instruction-line {
  font-size: calc(var(--led-w, 320px) * 0.045) !important;
}
[data-led-narrow] .kiosk-code-row {
  flex-direction: column !important;
  gap: 1% !important;
  width: 90% !important;
}
[data-led-narrow] .kiosk-code-tile {
  width: 100% !important;
  height: calc(var(--led-h, 1080px) * 0.075) !important;
  min-height: 56px !important;
  max-height: 90px !important;
}
[data-led-narrow] .kiosk-code-char {
  font-size: calc(var(--led-h, 1080px) * 0.055) !important;
}
[data-led-narrow] .kiosk-qr-hint {
  font-size: calc(var(--led-w, 320px) * 0.035) !important;
}
[data-led-narrow] .kiosk-status-row {
  font-size: calc(var(--led-w, 320px) * 0.035) !important;
  gap: 1% !important;
  flex-wrap: wrap;
}
/* Decorative orbs are positioned via %, which off the LED canvas are
   still in their right relative positions, but at 1920px viewport
   each orb would be 280px wide — bigger than the LED. Shrink them. */
[data-led-narrow] .kiosk-orb-1,
[data-led-narrow] .kiosk-orb-2,
[data-led-narrow] .kiosk-orb-3,
[data-led-narrow] .kiosk-orb-4,
[data-led-narrow] .kiosk-orb-5 {
  /* Orbs become small accent dots, sized off LED-w. */
  width: calc(var(--led-w, 320px) * 0.4) !important;
  height: calc(var(--led-w, 320px) * 0.4) !important;
}
/* Tech-chips shrink so they fit the narrow column. */
[data-led-narrow] .kiosk-tech-chips {
  bottom: 2% !important;
  flex-wrap: wrap;
  gap: 4px !important;
  max-width: 95% !important;
}
[data-led-narrow] .kiosk-chip {
  padding: 4px 8px !important;
  font-size: calc(var(--led-w, 320px) * 0.025) !important;
}
[data-led-narrow] .kiosk-chip-label {
  font-size: calc(var(--led-w, 320px) * 0.022) !important;
}
[data-led-narrow] .kiosk-chip-value {
  font-size: calc(var(--led-w, 320px) * 0.025) !important;
}
/* Orientation picker stacks vertically + shrinks. */
[data-led-narrow] .kiosk-orient-buttons {
  flex-wrap: wrap;
  justify-content: center;
}
[data-led-narrow] .kiosk-orient-btn {
  padding: 4px 8px !important;
  font-size: calc(var(--led-w, 320px) * 0.035) !important;
}
[data-led-narrow] .kiosk-orient-label {
  font-size: calc(var(--led-w, 320px) * 0.03) !important;
}
`;
