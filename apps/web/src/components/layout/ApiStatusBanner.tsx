"use client";

import { useEffect, useReducer } from 'react';
import { CloudOff, Wifi } from 'lucide-react';
import { subscribeApiStatus } from '@/lib/api-client';
import {
  apiBannerReducer,
  initialApiBannerState,
  RECOVERED_HOLD_MS,
  TROUBLE_STALE_MS,
} from '@/lib/api-status-banner-machine';

/**
 * "Connection trouble — reconnecting…" (operator-trust wave).
 *
 * `apiFetch` has always retried network errors / 502-503-504 on a 1s-3s-7s
 * backoff and announced every attempt through `subscribeApiStatus` — with no
 * subscriber. So a Railway cold start or a weak signal looked, to the
 * operator, like the app was simply broken: clicks did nothing, toggles
 * snapped back, no explanation anywhere. This is that missing subscriber.
 *
 * States (see api-status-banner-machine.ts — pure + unit-tested):
 *   trouble   → slim amber bar, held while retries continue
 *   recovered → brief green "Back online", self-dismisses after 2.5s
 *   idle      → renders nothing at all
 *
 * Constraints honored:
 *   • NO backdrop-blur / heavy blur — this mounts in the persistent
 *     dashboard chrome and `backdrop-filter` re-samples the page on every
 *     repaint (CLAUDE.md mobile-perf standard #3). Solid backgrounds only.
 *   • `pointer-events-none` on the fixed wrapper so the bar can never
 *     swallow a tap meant for the page; the pill itself re-enables them so
 *     it stays selectable/readable.
 *   • `role="status"` + `aria-live="polite"` — announced, never interrupting.
 *   • Safe-area aware so it clears the iPhone notch.
 *   • The entrance animation is `motion-safe:`-gated, so it's off entirely
 *     under `prefers-reduced-motion`.
 *   • No poller — it's a passive subscriber plus one dismissal timer.
 */
export function ApiStatusBanner() {
  const [state, dispatch] = useReducer(apiBannerReducer, initialApiBannerState);

  useEffect(
    () => subscribeApiStatus(({ status }) => dispatch({ type: 'api-status', status })),
    [],
  );

  // One timer, re-armed on every accepted transition (nonce). 'recovered'
  // auto-dismisses; 'trouble' stands down quietly if the bus goes silent so
  // we never leave a banner claiming to reconnect when nothing is trying.
  const { phase, nonce } = state;
  useEffect(() => {
    if (phase === 'idle') return;
    const t = setTimeout(
      () => dispatch({ type: phase === 'recovered' ? 'recovered-elapsed' : 'trouble-elapsed' }),
      phase === 'recovered' ? RECOVERED_HOLD_MS : TROUBLE_STALE_MS,
    );
    return () => clearTimeout(t);
  }, [phase, nonce]);

  if (phase === 'idle') return null;

  const recovered = phase === 'recovered';

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[58] flex justify-center px-3 pointer-events-none"
      style={{ paddingTop: 'max(8px, env(safe-area-inset-top, 0px))' }}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 shadow-[0_6px_20px_rgba(15,23,42,0.18)] border text-[12px] font-bold motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 ${
          recovered
            ? 'bg-emerald-600 border-emerald-700 text-white'
            : 'bg-amber-500 border-amber-600 text-amber-950'
        }`}
      >
        {recovered ? (
          <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <CloudOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{recovered ? 'Back online' : 'Connection trouble — reconnecting…'}</span>
      </div>
    </div>
  );
}
