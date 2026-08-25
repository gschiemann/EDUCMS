'use client';

import { useCallback, useState } from 'react';

/**
 * Shared screen-reader live region for the DESKTOP emergency surfaces
 * (Emergency Broadcast console + Emergency Trigger modal).
 *
 * A11y / life-safety (P1-9, 2026-05-28): the mobile /panic page already
 * announces its hold → trigger → result lifecycle through a
 * `role="status" aria-live="assertive" aria-atomic` sr-only region plus a
 * best-effort Web Speech utterance. The desktop console did NOT — a blind
 * admin triggering a lockdown from a laptop got zero spoken confirmation
 * that the alert fired (or failed). axe misses this (a missing live region
 * is "best-practice", not critical/serious), so it slipped the CI gate.
 * This extracts the exact panic-page pattern into one component both
 * desktop surfaces reuse — no duplication, identical behavior.
 *
 * ADA Title II / Section 504: the operator MUST get equivalent feedback
 * regardless of whether they can see the screen.
 *
 * Usage:
 *   const { announce, region } = useEmergencyAnnouncer();
 *   // call announce('Holding lockdown alert…') on each state transition
 *   // render {region} as the first child of the surface
 */

/**
 * Best-effort spoken announcement via the Web Speech API. Mirrors the
 * panic-page `announce()` helper. Speech is a bonus on top of the
 * aria-live region — older WebViews or browsers with TTS disabled throw
 * or no-op, and we swallow that so the SR user still gets the live region
 * and the sighted operator still sees the on-screen state.
 */
function speak(text: string) {
  try {
    const w = typeof window !== 'undefined' ? (window as unknown as {
      speechSynthesis?: {
        cancel?: () => void;
        speak: (u: unknown) => void;
      };
      SpeechSynthesisUtterance?: new (t: string) => {
        rate: number;
        volume: number;
        lang: string;
      };
    }) : null;
    if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function') {
      // Cancel any in-flight utterance so successive phase changes don't
      // queue up and overlap.
      w.speechSynthesis.cancel?.();
      const u = new w.SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.volume = 1.0;
      // i18n (X7, 2026-08-25): callers now pass catalog-resolved text, so the
      // utterance must follow <html lang> (kept in sync with the operator's
      // locale by I18nProvider) or a Spanish/Chinese message is read out by
      // an English voice. Falls back to the previous 'en-US' when unset.
      u.lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US';
      w.speechSynthesis.speak(u);
    }
  } catch {
    // No-op — SR users still get the aria-live region; sighted operators
    // still see the on-screen state. Speech is bonus.
  }
}

/**
 * The bare live region element. role="status" + aria-live="assertive" +
 * aria-atomic="true" makes a screen reader speak the entire message on
 * each change. Visible operators never see it (sr-only).
 */
export function EmergencyLiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

/**
 * Hook that owns the announcement string + a stable `announce(text)` that
 * both updates the live region AND fires best-effort speech. Returns the
 * rendered region so the caller can drop it as the first child of the
 * surface.
 */
export function useEmergencyAnnouncer() {
  const [message, setMessage] = useState('');

  const announce = useCallback((text: string) => {
    setMessage(text);
    speak(text);
  }, []);

  return {
    announce,
    region: <EmergencyLiveRegion message={message} />,
  };
}
