"use client";

/**
 * ProfileHydrator — self-heals stale auth-store user data.
 *
 * Operator (2026-05-12): hard-refreshed onto the new bundle and STILL
 * saw "gschiemann" in the dashboard greeting. Root cause: their
 * sessionStorage `edu_cms_user` blob was written by the pre-fix
 * code (when the require() bug silently failed); the new bundle
 * hydrates the store FROM that stale JSON, so firstName/lastName
 * are missing in memory even though the DB row has them.
 *
 * Fix: on every dashboard mount, if the store has a user object but
 * EITHER firstName or lastName is null/undefined, fire one GET
 * /users/me. If the API returns names the store doesn't have, patch
 * the store + sessionStorage in one shot. Subsequent renders show
 * the right greeting; refresh keeps the names.
 *
 * Fires exactly once per session per logged-in user — the missing-
 * field check fails for users with names already, so the API call
 * is a no-op for healthy sessions. Total cost: one /users/me per
 * dashboard tab boot, AND only for accounts that haven't been
 * hydrated yet.
 */

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';

export function ProfileHydrator() {
  const user = useAppStore((s) => s.user);
  const userId = user?.id;
  // We check for "name field is null AND not the empty string we
  // intentionally set." Specifically: if firstName + lastName are
  // BOTH undefined on the store but the user is logged in, we
  // assume a stale-session and call /users/me to reconcile.
  const needsHydration = !!user &&
    (user.firstName === undefined || user.firstName === null) &&
    (user.lastName === undefined || user.lastName === null);

  useEffect(() => {
    if (!needsHydration || !userId) return;

    let cancelled = false;
    (async () => {
      try {
        const me: any = await apiFetch('/users/me');
        if (cancelled) return;
        // Only patch if the API actually has names (otherwise we'd
        // just keep firing /users/me forever for accounts that
        // genuinely haven't set their name yet).
        if (!me?.firstName && !me?.lastName) return;

        const cur = useAppStore.getState().user;
        if (!cur || cur.id !== me.id) return;
        const nextUser = {
          ...cur,
          firstName: me.firstName ?? null,
          lastName: me.lastName ?? null,
        };
        useAppStore.setState({ user: nextUser });
        try {
          if (typeof window !== 'undefined') {
            const ss = window.sessionStorage;
            if (ss && ss.getItem('edu_cms_user')) {
              ss.setItem('edu_cms_user', JSON.stringify(nextUser));
            }
          }
        } catch { /* sessionStorage unavailable — non-fatal */ }
        console.log('[profile-hydrate] reconciled store with /users/me — names now present');
      } catch {
        // Tolerated — a transient 401/500 just means we try next
        // time the layout mounts. Better than blocking the
        // dashboard on a profile reconcile.
      }
    })();
    return () => { cancelled = true; };
    // userId in the dep array means we re-run if the user changes
    // (e.g. account switch). needsHydration is the actual gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, needsHydration]);

  return null;
}
