"use client";

/**
 * ProfileHydrator — self-heals a stale cached auth-store user.
 *
 * The store hydrates the logged-in `user` from a sessionStorage blob
 * (`edu_cms_user`) written at login. That blob can go STALE in two ways:
 *
 *   1. It was written by an older bundle that didn't carry a field yet
 *      (the 2026-05-12 case: firstName/lastName missing → greeting showed
 *      the email prefix).
 *   2. It carries an out-of-date `tenantVertical` — either written before
 *      the vertical field existed, or before an admin changed the
 *      tenant's industry. Result: the dashboard renders the WRONG
 *      industry (a gym shows as "school") until the user manually logs
 *      out and back in. (2026-06-01 — operator hit exactly this.)
 *
 * Fix: once per session per user, reconcile the cached blob against the
 * server (`GET /users/me`, which now returns the live tenant identity).
 * Patch the store + sessionStorage for any field the server has that the
 * cache got wrong — names AND tenant vertical / name / slug. No manual
 * re-login required; the UI corrects itself on the next dashboard mount.
 *
 * Cost: one `/users/me` per session boot per user (guarded by a
 * sessionStorage sentinel so remounts don't refire). On a transient
 * failure the sentinel isn't set, so it retries on the next mount.
 *
 * 2026-10-11 — Muse beta DEV-005 / S-01: once per session was not enough.
 * An admin changed the industry in one session and every OTHER open session
 * kept the old industry and module set until logout. It now ALSO re-checks
 * on window focus, on visibility return and on navigation — at most once per
 * WORKSPACE_RECHECK_MIN_MS (60 s), and never while the page is hidden (no
 * timers, no polling: mobile-perf rule 1). `/users/me` carries
 * `workspaceConfigVersion`; when it moves, the workspace-config queries
 * (`['tenant']` & co.) are re-read so module gates follow immediately.
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';
import {
  profilePatch,
  shouldRecheckWorkspace,
  workspaceConfigChanged,
  WORKSPACE_CONFIG_QUERY_KEYS,
} from '@/lib/workspace-config-refresh';

function isVisible(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState !== 'hidden';
}

export function ProfileHydrator() {
  const user = useAppStore((s) => s.user);
  const userId = user?.id;
  const pathname = usePathname();
  const qc = useQueryClient();
  const lastCheckedAt = useRef(0);
  const inFlight = useRef(false);
  const lastVersion = useRef<string | null>(null);

  const reconcile = useCallback(async (id: string): Promise<boolean> => {
    inFlight.current = true;
    lastCheckedAt.current = Date.now();
    try {
      const me: any = await apiFetch('/users/me');
      const cur = useAppStore.getState().user;
      if (!cur || cur.id !== me?.id || cur.id !== id) return true;

      // Workspace config fingerprint: the first sighting is the baseline;
      // a later difference means another session changed the setup.
      const version = typeof me.workspaceConfigVersion === 'string' ? me.workspaceConfigVersion : null;
      const changed = workspaceConfigChanged(lastVersion.current, version);
      if (version) lastVersion.current = version;

      const patch = profilePatch(cur as any, me);
      if (Object.keys(patch).length > 0) {
        const nextUser = { ...cur, ...patch };
        useAppStore.setState({ user: nextUser });
        try {
          if (typeof window !== 'undefined') {
            const ss = window.sessionStorage;
            if (ss && ss.getItem('edu_cms_user')) {
              ss.setItem('edu_cms_user', JSON.stringify(nextUser));
            }
          }
        } catch { /* sessionStorage unavailable — non-fatal */ }
        // eslint-disable-next-line no-console
        console.log('[profile-hydrate] reconciled cached session with /users/me:', Object.keys(patch).join(', '));
      }
      if (changed || 'tenantVertical' in patch) {
        await Promise.all(
          WORKSPACE_CONFIG_QUERY_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
        );
      }
      return true;
    } catch {
      // Tolerated — a transient 401/500 just means we try again on the
      // next trigger (boot sentinel not set; the 60 s gate still applies).
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [qc]);

  // Boot: once per session per user (sentinel), exactly as before.
  useEffect(() => {
    if (!userId) return;
    const sentinelKey = `edu_cms_hydrated:${userId}`;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage?.getItem(sentinelKey)) return;
    } catch { /* sessionStorage unavailable — proceed without the guard */ }
    let cancelled = false;
    void reconcile(userId).then((ok) => {
      if (cancelled || !ok) return;
      try { window.sessionStorage?.setItem(sentinelKey, '1'); } catch { /* non-fatal */ }
    });
    return () => { cancelled = true; };
  }, [userId, reconcile]);

  // Bounded re-check: focus, visibility return, navigation. ≥ 60 s apart,
  // never while hidden, never overlapping.
  const maybeRecheck = useCallback(() => {
    if (!userId) return;
    if (!shouldRecheckWorkspace({
      now: Date.now(),
      lastCheckedAt: lastCheckedAt.current,
      visible: isVisible(),
      inFlight: inFlight.current,
    })) return;
    void reconcile(userId);
  }, [userId, reconcile]);

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;
    const onVisibility = () => { if (isVisible()) maybeRecheck(); };
    window.addEventListener('focus', maybeRecheck);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', maybeRecheck);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, maybeRecheck]);

  // Navigation is a trigger too (same 60 s gate). The first render is the
  // boot path above, which stamps lastCheckedAt, so this is a no-op then.
  useEffect(() => {
    maybeRecheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
