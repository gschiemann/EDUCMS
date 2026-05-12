"use client";

/**
 * useTenantSwitch — single source of truth for "active tenant just changed."
 *
 * Why this hook exists (2026-05-11):
 *
 * Operator hit a bug: clicking a child school in /settings kept the
 * DISTRICT'S branding on the child's dashboard, but switching to that
 * same child from the top-right toolbar dropdown correctly painted the
 * child's branding (or default if the child has no `TenantBranding`
 * row yet).
 *
 * Root cause: two switch paths, only one of them re-issued the JWT.
 *
 *   - Top-right SchoolSwitcher: POST /tenants/switch → new JWT → update
 *     Zustand activeTenant → qc.clear() → router.push(). BrandStyleInjector
 *     sees the dep change, /branding/me re-runs under the new JWT, the
 *     palette repaints correctly. ✓
 *   - Settings → click child card: bare <Link href={`/${slug}/dashboard`}>.
 *     The URL changes, the JWT does not. /branding/me still answers as
 *     the parent tenant. Palette stays on the district's brand. ✗
 *
 * Both paths now route through this hook so the JWT swap, store update,
 * cache wipe, and navigation always happen together. Adding a third
 * surface that switches tenants? Use this hook — don't replicate the
 * dance inline.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';

// Mirrors the key SchoolSwitcher used to own. Centralized here so future
// reads (e.g. last-school redirect on login) have one canonical location.
const LS_LAST_SCHOOL_KEY = 'edu_cms_last_school';

interface SwitchTarget {
  id: string;
  slug: string;
}

interface SwitchResult {
  ok: boolean;
  /** Set if the API call or navigation threw. */
  error?: string;
}

export function useTenantSwitch() {
  const router = useRouter();
  const qc = useQueryClient();
  const login = useAppStore((s) => s.login);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);

  // Track which tenant is mid-switch so call sites can show a per-row
  // spinner. Multiple components can mount this hook independently —
  // that's fine, the active call is per-instance.
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchToTenant = useCallback(
    async (
      tenant: SwitchTarget,
      destinationPath?: string,
    ): Promise<SwitchResult> => {
      setSwitchingId(tenant.id);
      setError(null);
      try {
        // 1. Re-issue the JWT with the new tenantId claim. Every
        //    subsequent apiFetch is then scoped to the new tenant —
        //    including the very next /branding/me that BrandStyleInjector
        //    will fire when it sees the dep array change.
        const res: any = await apiFetch('/tenants/switch', {
          method: 'POST',
          body: JSON.stringify({ tenantId: tenant.id }),
        });

        // 2. Persist the new token + user. login() writes through to
        //    localStorage so a page refresh survives the switch.
        login(res.access_token, res.user);

        // 3. Flip the in-memory active-tenant slug. BrandStyleInjector
        //    has [tenantId, activeTenant, user] in its dep array; this
        //    is what triggers the brand repaint without a full reload.
        setActiveTenant(tenant.slug);

        // 4. Mirror to LS so login → last-active-school redirect works.
        if (typeof window !== 'undefined') {
          try { localStorage.setItem(LS_LAST_SCHOOL_KEY, tenant.slug); } catch {}
        }

        // 5. Wipe React Query cache — every cached query was scoped to
        //    the previous JWT's tenantId claim. Without this, screens /
        //    playlists / branding-context all stay on the old tenant
        //    until each query's staleTime expires.
        qc.clear();

        // 6. Finally navigate. Default destination is the new tenant's
        //    dashboard but the caller can override (e.g. swap only the
        //    first path segment so you stay on /screens after a switch).
        router.push(destinationPath || `/${tenant.slug}/dashboard`);

        return { ok: true };
      } catch (e: any) {
        const msg = e?.message || 'Failed to switch.';
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setSwitchingId(null);
      }
    },
    [login, setActiveTenant, qc, router],
  );

  return {
    switchToTenant,
    /** Id of the tenant currently mid-switch, or null. */
    switchingId,
    /** Last error message, or null. */
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
