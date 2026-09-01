'use client';

import { useCallback, useState } from 'react';
import { speakEmergencyIfEnabled } from '@/lib/emergency-voice';

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
 * SILENT BY DEFAULT (2026-09-01, mobile design package §M17 / §15 / §21 wave 0).
 *
 * This used to speak EVERY announcement unconditionally, on top of the
 * assertive live region below — so a screen-reader user heard each message
 * twice (once in their own voice, once in the browser's), and a sighted
 * operator's device announced "Holding lockdown alert…" out loud whether or
 * not that was safe where they were standing.
 *
 * The live region is the ADA Title II / Section 504 mechanism and is
 * unchanged. Speech is now an explicit per-browser opt-in — see
 * @/lib/emergency-voice for the full reasoning and the fail-closed read.
 */
const speak = speakEmergencyIfEnabled;

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
