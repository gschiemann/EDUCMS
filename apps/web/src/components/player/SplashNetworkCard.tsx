'use client';

/**
 * SplashNetworkCard — what the boot surfaces show when this screen has no
 * network, or has one that cannot reach VenueOS (2026-10-26, on-site test:
 * "the splash screen doesnt tell me the network is disconnected at all").
 *
 * It takes the place of the "Connecting to your CMS…" loader (and of the
 * pairing block), never of content, and never over an alert — page.tsx only
 * passes it in when no alert is up. The state is decided by
 * `app/player/networkStatus.ts`; this file only draws it.
 *
 * Remote first (player rule 15): the one button is PARKED on mount and again
 * whenever the surface that owned the remote goes away (the Back menu), with
 * a highlight that does not depend on the ROM's default focus ring; OK presses
 * it; touch works too. It never takes focus from an element that has it.
 *
 * Chromium 83 (Taurus): no `inset` shorthand, no flex `gap` (spacing is
 * per-child margin), no backdrop blur — the card is opaque by design.
 *
 * ⚠️ ITS CSS GOES THROUGH `sceneCss()`. The repo's flattened Tailwind
 * preflight resets h2 / p / button at ID-level specificity, which beats a
 * plain class rule in a runtime <style> tag: the first cut of this card
 * rendered a 16px title, an uncentred badge and an unstyled button. The
 * narrow-LED rules are anchored on `html[...]` (left unboosted — <html> has
 * no ancestor for the booster) and carry `!important` instead.
 */

import { useEffect, useRef } from 'react';
import { CloudOff, Wifi, WifiOff } from 'lucide-react';
import { sceneCss } from '@/components/widgets/scene-css';

export type SplashNetworkProblem = 'offline' | 'unreachable';

export interface SplashNetworkCardProps {
  problem: SplashNetworkProblem;
  /**
   * Opens VenueOS's own Network screen (APK ≥ 1.1.53, `openNetworkScreen`).
   * Absent on an older APK or in a browser: `hint` is shown instead.
   */
  onOpenSettings?: () => void;
  /** The instruction for a screen that cannot open the Network screen itself. */
  hint?: string | null;
  /** Park the remote's focus on the button. False while another surface owns the remote. */
  parkFocus?: boolean;
}

const COPY: Record<SplashNetworkProblem, { title: string; tone: string }> = {
  offline: { title: 'No network connection', tone: 'offline' },
  unreachable: { title: "Connected, but can't reach VenueOS", tone: 'unreachable' },
};

export function SplashNetworkCard({ problem, onOpenSettings, hint, parkFocus = true }: SplashNetworkCardProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hasButton = typeof onOpenSettings === 'function';

  useEffect(() => {
    if (!parkFocus || !hasButton) return;
    const button = buttonRef.current;
    if (!button || typeof document === 'undefined') return;
    const active = document.activeElement;
    // Only an UNPARKED remote is parked: never take focus from a control that has it.
    if (active && active !== document.body && active !== document.documentElement && active !== button) return;
    try {
      button.focus({ preventScroll: true });
    } catch {
      try { button.focus(); } catch { /* not focusable right now */ }
    }
  }, [parkFocus, hasButton, problem]);

  const copy = COPY[problem];
  const Icon = problem === 'offline' ? WifiOff : CloudOff;

  return (
    <section
      className="kiosk-net-card"
      data-edu-network-card={problem}
      data-tone={copy.tone}
      aria-labelledby="kiosk-net-title"
    >
      <style>{sceneCss(NETWORK_CARD_CSS)}</style>
      <div className="kiosk-net-glow" aria-hidden="true" />
      <div className="kiosk-net-badge" aria-hidden="true">
        <span className="kiosk-net-ring" />
        <span className="kiosk-net-ring kiosk-net-ring-late" />
        <span className="kiosk-net-tile">
          <Icon className="kiosk-net-icon" />
        </span>
      </div>
      <h2 id="kiosk-net-title" className="kiosk-net-title">{copy.title}</h2>
      <p className="kiosk-net-body">
        {problem === 'offline' ? (
          <>
            This screen isn&apos;t connected to <span className="kiosk-net-nowrap">Wi-Fi</span> or Ethernet.
          </>
        ) : (
          <>Check this network&apos;s internet connection.</>
        )}
      </p>
      {hasButton ? (
        <button
          ref={buttonRef}
          type="button"
          className="kiosk-net-button"
          data-edu-network-open=""
          onClick={onOpenSettings}
        >
          <Wifi className="kiosk-net-button-icon" aria-hidden="true" />
          <span>Open network settings</span>
        </button>
      ) : hint ? (
        <p className="kiosk-net-hint" data-edu-network-hint="">{hint}</p>
      ) : null}
      <p className="kiosk-net-foot">This screen reconnects by itself as soon as the network is back.</p>
    </section>
  );
}

/**
 * Sizes are viewport-height clamps, like the rest of KioskSplash: the same
 * proportions on a 1080p TV, a 4K panel at device-pixel-ratio 1 and a 720p
 * box. Every clamp() follows a plain px value — a WebView older than
 * Chromium 79 drops the clamp and keeps the 1080p size. The narrow-LED canvas
 * override at the bottom sizes from `--led-w`.
 * (This text is a JS template literal: no backticks, no dollar-brace.)
 */
const NETWORK_CARD_CSS = `
.kiosk-net-card {
  --net-tone: #f43f5e;
  --net-tone-bright: #fda4af;
  --net-tone-soft: rgba(244, 63, 94, 0.16);
  --net-tone-glow: rgba(244, 63, 94, 0.30);
  position: relative;
  box-sizing: border-box;
  /* 92%: a gutter on a portrait panel, where the flattened preflight zeroes
     the stage's own padding; 92vh caps it on landscape. */
  width: 92%;
  max-width: 92vh;
  margin: 10px auto 0 auto;
  margin: clamp(4px, 1vh, 24px) auto 0 auto;
  padding: 46px 50px 40px;
  padding: clamp(18px, 4.2vh, 96px) clamp(18px, 4.6vh, 104px) clamp(16px, 3.6vh, 80px);
  border-radius: 34px;
  border-radius: clamp(18px, 3.2vh, 64px);
  background: #0d1129;
  background: linear-gradient(180deg, #151b3d 0%, #0d1129 58%, #0a0d20 100%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow:
    0 2.6vh 7vh rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  color: #f8fafc;
  text-align: center;
  overflow: hidden;
  animation: kiosk-net-in 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.kiosk-net-card[data-tone="unreachable"] {
  --net-tone: #f59e0b;
  --net-tone-bright: #fcd34d;
  --net-tone-soft: rgba(245, 158, 11, 0.16);
  --net-tone-glow: rgba(245, 158, 11, 0.28);
}
/* A thin lit edge in the state's colour — reads as "status", not decoration. */
.kiosk-net-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 12%;
  width: 76%;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, var(--net-tone) 50%, rgba(0, 0, 0, 0) 100%);
  opacity: 0.9;
}
.kiosk-net-glow {
  position: absolute;
  top: -22vh;
  left: 50%;
  width: 60vh;
  height: 44vh;
  margin-left: -30vh;
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--net-tone-glow), rgba(0, 0, 0, 0));
  pointer-events: none;
}
@keyframes kiosk-net-in {
  from { opacity: 0; transform: translateY(1.6vh) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.kiosk-net-badge {
  position: relative;
  width: 104px;
  height: 104px;
  width: clamp(48px, 9.6vh, 200px);
  height: clamp(48px, 9.6vh, 200px);
  margin: 0 auto 26px auto;
  margin: 0 auto clamp(10px, 2.4vh, 52px) auto;
}
.kiosk-net-ring,
.kiosk-net-tile {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-sizing: border-box;
}
.kiosk-net-ring {
  display: block;
  border: 2px solid var(--net-tone);
  opacity: 0;
  animation: kiosk-net-ring 2.8s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
}
.kiosk-net-ring-late { animation-delay: 1.4s; }
@keyframes kiosk-net-ring {
  0%   { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(1.65); opacity: 0; }
}
.kiosk-net-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1630;
  background: radial-gradient(circle at 50% 35%, var(--net-tone-soft), rgba(10, 13, 32, 0.9) 78%);
  border: 1.5px solid var(--net-tone-soft);
  box-shadow: 0 0 4vh var(--net-tone-glow), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.kiosk-net-icon {
  width: 46%;
  height: 46%;
  color: var(--net-tone-bright);
}

.kiosk-net-title {
  position: relative;
  margin: 0 0 15px 0;
  margin: 0 0 clamp(6px, 1.4vh, 30px) 0;
  font-family: var(--font-fredoka, 'Fredoka'), 'Inter', ui-sans-serif, system-ui, sans-serif;
  font-weight: 700;
  font-size: 56px;
  font-size: clamp(22px, 5.2vh, 112px);
  line-height: 1.08;
  letter-spacing: -0.015em;
  color: #ffffff;
}
.kiosk-net-body {
  position: relative;
  margin: 0 auto;
  max-width: 34em;
  font-family: var(--font-inter, 'Inter'), ui-sans-serif, system-ui, sans-serif;
  font-weight: 500;
  font-size: 28px;
  font-size: clamp(14px, 2.6vh, 56px);
  line-height: 1.35;
  color: #cbd5e1;
}
.kiosk-net-nowrap { white-space: nowrap; }

/* The one control. White when focused — the TV idiom, and visible on any
   ROM: OEM WebViews strip the default focus ring, and Chromium 83 has no
   :focus-visible, so plain :focus carries the highlight. */
.kiosk-net-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 36px 0 0 0;
  margin: clamp(14px, 3.4vh, 72px) 0 0 0;
  padding: 20px 48px;
  padding: clamp(10px, 1.9vh, 40px) clamp(20px, 4.4vh, 96px);
  min-height: 76px;
  min-height: clamp(44px, 7vh, 150px);
  border: 0;
  border-radius: 999px;
  background: var(--splash-primary, #6366f1);
  color: #ffffff;
  font-family: var(--font-inter, 'Inter'), ui-sans-serif, system-ui, sans-serif;
  font-weight: 700;
  font-size: 28px;
  font-size: clamp(15px, 2.6vh, 56px);
  line-height: 1.1;
  letter-spacing: 0.005em;
  cursor: pointer;
  outline: none;
  box-shadow: 0 1.4vh 3.6vh rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
  -webkit-tap-highlight-color: transparent;
}
.kiosk-net-button:focus {
  background: #ffffff;
  color: #0b1022;
  transform: scale(1.06);
  box-shadow:
    0 0 0 6px rgba(255, 255, 255, 0.28),
    0 0 6vh rgba(255, 255, 255, 0.22),
    0 1.8vh 4.6vh rgba(0, 0, 0, 0.55);
}
.kiosk-net-button:active { transform: scale(0.98); }
.kiosk-net-button-icon {
  width: 1.15em;
  height: 1.15em;
  margin-right: 0.55em;
  flex-shrink: 0;
}

.kiosk-net-hint {
  position: relative;
  margin: 34px auto 0 auto;
  margin: clamp(14px, 3.2vh, 68px) auto 0 auto;
  padding: 18px 28px;
  padding: clamp(10px, 1.6vh, 34px) clamp(14px, 2.6vh, 56px);
  max-width: 34em;
  border-radius: 20px;
  border-radius: clamp(12px, 1.8vh, 36px);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  font-family: var(--font-inter, 'Inter'), ui-sans-serif, system-ui, sans-serif;
  font-weight: 600;
  font-size: 26px;
  font-size: clamp(14px, 2.4vh, 52px);
  line-height: 1.35;
  color: #f1f5f9;
}
.kiosk-net-foot {
  position: relative;
  margin: 28px 0 0 0;
  margin: clamp(12px, 2.6vh, 56px) 0 0 0;
  font-family: var(--font-inter, 'Inter'), ui-sans-serif, system-ui, sans-serif;
  font-weight: 500;
  font-size: 18px;
  font-size: clamp(11px, 1.7vh, 36px);
  line-height: 1.35;
  color: #94a3b8;
}

/* A short viewport (a 4K panel at a high pixel ratio reports ~720×405). */
@media (max-height: 560px) {
  .kiosk-net-card { padding: 14px 16px 12px; border-radius: 16px; }
  .kiosk-net-badge { width: 40px; height: 40px; margin-bottom: 8px; }
  .kiosk-net-title { font-size: 20px; margin-bottom: 4px; }
  .kiosk-net-body { font-size: 13px; }
  .kiosk-net-button { margin-top: 10px; min-height: 38px; padding: 8px 18px; font-size: 14px; }
  .kiosk-net-hint { margin-top: 10px; font-size: 13px; padding: 8px 12px; }
  .kiosk-net-foot { margin-top: 8px; font-size: 11px; }
}

/* A phone-width browser. */
@media (max-width: 480px) {
  .kiosk-net-title { font-size: 7vw; }
  .kiosk-net-body { font-size: 4.2vw; }
  .kiosk-net-button { font-size: 4.2vw; }
  .kiosk-net-hint { font-size: 3.8vw; }
  .kiosk-net-foot { font-size: 3.2vw; }
}

/* A narrow LED canvas: the CSS viewport is the controller's whole frame
   buffer, the glass is the --led-w column (KioskSplash's same override).
   Anchored on html, so sceneCss leaves these alone; !important does the
   work the booster does above. */
html[data-led-narrow] .kiosk-net-card {
  width: 100% !important;
  max-width: 100% !important;
  padding: 7% 6% 6% !important;
  border-radius: calc(var(--led-w, 320px) * 0.05) !important;
}
html[data-led-narrow] .kiosk-net-glow { display: none !important; }
html[data-led-narrow] .kiosk-net-badge {
  width: calc(var(--led-w, 320px) * 0.2) !important;
  height: calc(var(--led-w, 320px) * 0.2) !important;
  margin-bottom: 4% !important;
}
html[data-led-narrow] .kiosk-net-title { font-size: calc(var(--led-w, 320px) * 0.082) !important; }
html[data-led-narrow] .kiosk-net-body { font-size: calc(var(--led-w, 320px) * 0.05) !important; }
html[data-led-narrow] .kiosk-net-button {
  margin-top: 6% !important;
  min-height: 0 !important;
  padding: 3% 7% !important;
  font-size: calc(var(--led-w, 320px) * 0.05) !important;
}
html[data-led-narrow] .kiosk-net-hint { font-size: calc(var(--led-w, 320px) * 0.045) !important; }
html[data-led-narrow] .kiosk-net-foot { font-size: calc(var(--led-w, 320px) * 0.036) !important; }
`;
