"use client";

import { useEffect } from 'react';
import { useUIStore, takeMigratedLegacyToken } from '@/store/ui-store';
import {
  adoptRememberedSession,
  hasRememberMarker,
  refreshRememberedSession,
} from '@/lib/session-client';
import { clog } from '@/lib/client-logger';

/**
 * SEC-010 (2026-09-05) — the cold-start half of the remembered session.
 *
 * Before this change, "Keep me logged in" worked because a 30-day JWT was
 * already in localStorage when the bundle evaluated. It was instant, and it
 * was the finding. Now the durable credential is an HttpOnly cookie, so the
 * answer to "am I still signed in?" costs exactly ONE round trip on a cold
 * start — and only when the remember marker says a cookie might exist.
 *
 * Two jobs, both one-shot, neither on a timer (CLAUDE.md mobile-perf
 * standard — a backgrounded phone must not run pollers, and this component
 * sits in the always-mounted provider tree):
 *
 *   1. RESTORE. No token in this tab + remember marker set ⇒ ask
 *      /api/session/refresh once. Success populates the store; failure clears
 *      `authRestoring` and lets `AuthExpirationGuard` do its normal eject.
 *
 *   2. MIGRATE. A pre-SEC-010 remembered token was found in localStorage and
 *      adopted into this tab (see `bootstrapAuth`). Trade it for a cookie so
 *      the upgrade does not quietly downgrade anyone to a per-tab session,
 *      and so the long-lived bearer stops being persisted at rest.
 */
export function SessionRestorer() {
  useEffect(() => {
    let cancelled = false;

    // The PLAYER is explicitly out of scope for SEC-010 — device credentials
    // have their own lifecycle and their own single token store (CLAUDE.md
    // player rules 1-3). This component is inert there anyway (no remember
    // marker on a kiosk), but bail explicitly so it can never become a new
    // writer on that surface.
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/player')) return;

    // Job 2 first — it is synchronous state left by module init, and doing it
    // here (rather than in the store) keeps the network out of bootstrap.
    const legacy = takeMigratedLegacyToken();
    if (legacy) {
      void adoptRememberedSession(legacy).then((ok) => {
        clog.info('auth', 'Migrated remembered session to HttpOnly cookie', { ok });
      });
    }

    const { token, authRestoring, setAuthRestoring } = useUIStore.getState();
    if (token || !authRestoring) {
      // Nothing to restore. Make sure the flag cannot latch on.
      if (authRestoring) setAuthRestoring(false);
      return;
    }
    if (!hasRememberMarker()) {
      setAuthRestoring(false);
      return;
    }

    void refreshRememberedSession().then((res) => {
      if (cancelled) return;
      if (res?.access_token && res.user) {
        clog.info('auth', 'Restored remembered session from HttpOnly cookie', {
          userId: res.user?.id,
        });
        // `login` re-affirms the remember marker and clears `authRestoring`.
        useUIStore.getState().login(res.access_token, res.user, true);
      } else {
        useUIStore.getState().setAuthRestoring(false);
      }
    });

    return () => {
      cancelled = true;
    };
    // Mount-only on purpose: this is a boot decision, not a subscription.
  }, []);

  return null;
}
