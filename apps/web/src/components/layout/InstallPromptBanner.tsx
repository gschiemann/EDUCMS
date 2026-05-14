"use client";

import { useEffect, useState } from 'react';
import { X, Download, Share2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

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

export function InstallPromptBanner() {
  const isMobile = useIsMobile();
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
      const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) || '0');
      if (dismissedAt > 0 && Date.now() - dismissedAt < REMIND_AFTER_MS) {
        setDismissed(true);
      } else {
        setDismissed(false);
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
        className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        aria-label="Dismiss install prompt"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-7">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
          <Download className="w-5 h-5 text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight mb-0.5">Install Venue OS on this phone</p>
          {deferredPrompt ? (
            <p className="text-[12px] text-slate-300 leading-snug">
              Get the dashboard as an icon on your home screen — opens full-screen, faster, and lets us send safety push alerts.
            </p>
          ) : (
            <p className="text-[12px] text-slate-300 leading-snug">
              Tap <Share2 className="w-3 h-3 inline -translate-y-0.5" aria-hidden /> in Safari's toolbar, then <strong>Add to Home Screen</strong>. The dashboard runs full-screen and can send push alerts.
            </p>
          )}
        </div>
      </div>
      {deferredPrompt && (
        <button
          type="button"
          onClick={install}
          className="mt-3 w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
        >
          <Download className="w-4 h-4" />
          Install
        </button>
      )}
    </div>
  );
}
