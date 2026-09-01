"use client";

import { useEffect, useState } from 'react';
import { X, Download, Share2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/lib/store';

/**
 * "Add to Home Screen" prompt banner for mobile users (Phase 1 of
 * MOBILE_APP_ROADMAP.md). Shows ONCE per user-agent / install state:
 *
 *   • Android Chrome / Edge — listens for the standardized
 *     `beforeinstallprompt` event and pops a one-tap "Install" button
 *     that wires through to `promptEvent.prompt()`.
 *   • iOS Safari — no install event exists (Apple's choice). Surfaces
 *     a banner with the manual "tap the share button, then Add to
 *     Home Screen" instructions plus an animated arrow toward the
 *     iOS share affordance.
 *
 * Dismissed state persists in localStorage so we don't nag.
 * Auto-hides when `display-mode: standalone` (i.e. already installed
 * + opened from the home-screen icon).
 */
type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'edu_install_prompt_dismissed_at';
const REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
/**
 * "Don't show again" (M03) — permanent, and stored separately from the
 * 14-day snooze so the snooze's expiry can never resurrect a banner the
 * operator explicitly retired.
 */
const NEVER_KEY = 'edu_install_prompt_never';

export function InstallPromptBanner() {
  const isMobile = useIsMobile();
  const overlayOpenCount = useAppStore((s) => s.overlayOpenCount);
  const [deferredPrompt, setDeferredPrompt] = useState<PromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  // Track whether the user has actually interacted enough for the prompt
  // to be welcome. Showing it on the very first page-load feels spammy;
  // wait until they've been browsing for ~12s before surfacing.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Already installed? Bail.
    const mql = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mql.matches || (window.navigator as any).standalone === true);

    // iOS detection — Safari is the only iOS browser that handles
    // Add-to-Home-Screen, and the install API doesn't exist on iOS.
    const ua = window.navigator.userAgent;
    const iosLike = /iPhone|iPad|iPod/i.test(ua) && !/Android/i.test(ua);
    setIsIos(iosLike);

    // Has the user told us to stop reminding? Reset after 14 days so
    // a user who dismissed long ago gets one more chance — they may
    // have decided to install since then.
    try {
      if (localStorage.getItem(NEVER_KEY) === '1') {
        setDismissed(true);
      } else {
        const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) || '0');
        setDismissed(dismissedAt > 0 && Date.now() - dismissedAt < REMIND_AFTER_MS);
      }
    } catch {
      setDismissed(false);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as PromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // Listen for install completion so we can hide the banner once
    // the user actually adds the app.
    const onInstalled = () => setIsStandalone(true);
    window.addEventListener('appinstalled', onInstalled);

    const t = setTimeout(() => setReady(true), 12_000);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
    setDismissed(true);
  };

  const dismissForever = () => {
    try { localStorage.setItem(NEVER_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        // Don't write the dismissed-at — `appinstalled` will hide the
        // banner via setIsStandalone(true).
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    }
  };

  // Hide criteria: not mobile, already installed, user dismissed,
  // not "warmed up" yet, OR neither Android-install-prompt nor iOS-Safari.
  if (!isMobile || isStandalone || dismissed || !ready) return null;
  if (!deferredPrompt && !isIos) return null;
  // …and never while an overlay owns the screen. This banner sits at z-[70],
  // ABOVE the More sheet's z-[61] and above every bottom-anchored modal, so a
  // sheet opening under it left an install nag floating over the operator's
  // navigation. §6.2 requires the More sheet to "clear the global tab bar and
  // any install banner"; the tab bar already obeys the shared overlay lock,
  // and now so does this.
  if (overlayOpenCount > 0) return null;

  return (
    <div
      // Sits ABOVE the MobileTabBar (which is z-60). Slides up from
      // bottom so it feels like a snackbar, not a modal.
      className="md:hidden fixed bottom-20 inset-x-3 z-[70] rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700 p-4 pb-4 animate-in slide-in-from-bottom-4 fade-in duration-300"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={dismiss}
        // Touch target HIG (2026-05-23 launch audit P2 #9): bumped from
        // 28×28 (w-7 h-7) to 44×44 (min-h/min-w-[44px]). On a phone the
        // small X was easy to miss-tap into the banner content below it.
        className="absolute top-1 right-1 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        aria-label="Dismiss install prompt"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-11">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
          <Download className="w-5 h-5 text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          {/* M03 copy, verbatim from the mobile design package. The previous
              two variants each promised push — "lets us send safety push
              alerts" / "can send push alerts" — for a capability §2.2 lists
              under WHAT DOES NOT EXIST NOW ("Web Push subscription and
              background-notification delivery"). On a life-safety product
              that is the worst possible thing to overpromise: an operator who
              installs on that sentence believes their phone will wake them
              for a lockdown, and nothing will. §M03: "Do not mention push
              alerts, offline emergency operation or background delivery until
              those capabilities exist and are verified." */}
          <p className="text-sm font-bold leading-tight mb-0.5">Install VenueOS</p>
          {deferredPrompt ? (
            <p className="text-[12px] text-slate-300 leading-snug">
              Open VenueOS from your Home Screen for faster access and a full-screen workspace.
            </p>
          ) : (
            <p className="text-[12px] text-slate-300 leading-snug">
              Open VenueOS from your Home Screen for faster access and a full-screen workspace. Tap{' '}
              <Share2 className="w-3 h-3 inline -translate-y-0.5" aria-hidden /> in Safari&apos;s toolbar, then{' '}
              <strong>Add to Home Screen</strong>.
            </p>
          )}
        </div>
      </div>
      {/* M03 actions: Install (or platform instructions) · Not now · Don't
          show again. "Not now" reminds in 14 days; "Don't show again" is
          permanent — the old banner offered only the ambiguous X. */}
      <div className="mt-3 flex items-center gap-2">
        {deferredPrompt && (
          <button
            type="button"
            onClick={install}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
          >
            <Download className="w-4 h-4" />
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-bold transition-colors"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={dismissForever}
          className="shrink-0 min-h-[44px] px-3 rounded-xl text-[12px] font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  );
}
