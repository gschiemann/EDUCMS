"use client";

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { API_URL } from '@/lib/api-url';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { refreshRememberedSessionWithOutcome } from '@/lib/session-client';
import { hasPanicMarker, panicStatus } from '@/lib/panic-device-client';
import { createPanicAuth, type PanicAuth, type PanicAuthState, type PanicUser } from '@/lib/panic-auth';

/**
 * /panic's credential, resolved in the background from the first frame
 * (2026-11-14). The rules live in `@/lib/panic-auth`; this hook only wires
 * them to the store and the network.
 *
 * `/users/me` is the session check because EVERY authenticated role can reach
 * it and it answers with the LIVE role + canTriggerPanic (2026-06-09: an
 * admin-only endpoint turned a delegated staffer's valid session into a bogus
 * "signed out"). Bounded at 6 s so a hung API can never hold the check open.
 */
const VERIFY_TIMEOUT_MS = 6000;

export function usePanicAuth(): { state: PanicAuthState; auth: PanicAuth } {
  const [state, setState] = useState<PanicAuthState>({ status: 'resolving' });
  const authRef = useRef<PanicAuth | null>(null);
  if (!authRef.current) {
    authRef.current = createPanicAuth({
      readSession: () => {
        const s = useAppStore.getState();
        return { token: s.token, user: (s.user as PanicUser | null) ?? null };
      },
      adoptSession: (token, user) => {
        // Remembered: it came back from the HttpOnly cookie, so keep it so.
        useAppStore.getState().login(token, user, true);
      },
      verify: (token) =>
        fetchWithTimeout(`${API_URL}/users/me`, { headers: { Authorization: `Bearer ${token}` } }, VERIFY_TIMEOUT_MS),
      refresh: () => refreshRememberedSessionWithOutcome(),
      // 2026-11-14 — this phone's panic credential, tried FIRST on a cold start.
      hasDeviceMarker: () => hasPanicMarker(),
      deviceStatus: async () => {
        const r = await panicStatus();
        return r.ok ? { ok: true as const, body: r.body as any } : { ok: false as const, outcome: r.outcome };
      },
      onChange: setState,
    });
  }
  const auth = authRef.current;

  // One pass on mount. Single-flight, so StrictMode's double effect is one pass.
  useEffect(() => {
    void auth.resolve();
  }, [auth]);

  // A session another component put in the store (SessionRestorer's cold-start
  // restore, finishing first) is adopted rather than ignored.
  const storeToken = useAppStore((s) => s.token);
  const storeUser = useAppStore((s) => s.user);
  useEffect(() => {
    auth.noteSession(storeToken, (storeUser as PanicUser | null) ?? null);
  }, [auth, storeToken, storeUser]);

  return { state, auth };
}
