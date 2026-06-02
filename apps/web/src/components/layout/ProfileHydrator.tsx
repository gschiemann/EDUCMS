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
 * Cost: exactly one `/users/me` per session boot per user (guarded by a
 * sessionStorage sentinel so remounts don't refire). On a transient
 * failure the sentinel isn't set, so it retries on the next mount.
 */

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';

export function ProfileHydrator() {
  const user = useAppStore((s) => s.user);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    const sentinelKey = `edu_cms_hydrated:${userId}`;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage?.getItem(sentinelKey)) return;
    } catch { /* sessionStorage unavailable — proceed without the guard */ }

    let cancelled = false;
    (async () => {
      try {
        const me: any = await apiFetch('/users/me');
        if (cancelled) return;
        const cur = useAppStore.getState().user;
        if (!cur || cur.id !== me?.id) return;

        // Mark reconciled FIRST (on a successful fetch) so we don't refire
        // this session even when nothing needed patching. A thrown fetch
        // skips this and retries next mount.
        try { window.sessionStorage?.setItem(sentinelKey, '1'); } catch { /* non-fatal */ }

        // Patch ONLY fields the server actually has AND that differ from
        // the cache — never clobber a present value with a server null.
        const patch: Record<string, unknown> = {};
        if (me.firstName != null && me.firstName !== cur.firstName) patch.firstName = me.firstName;
        if (me.lastName != null && me.lastName !== cur.lastName) patch.lastName = me.lastName;
        if (me.tenantVertical && me.tenantVertical !== (cur as any).tenantVertical) patch.tenantVertical = me.tenantVertical;
        if (me.tenantName != null && me.tenantName !== (cur as any).tenantName) patch.tenantName = me.tenantName;
        if (me.tenantSlug && me.tenantSlug !== cur.tenantSlug) patch.tenantSlug = me.tenantSlug;
        if (Object.keys(patch).length === 0) return;

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
      } catch {
        // Tolerated — a transient 401/500 just means we try again on the
        // next layout mount (the sentinel was not set on the throw path).
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return null;
}
