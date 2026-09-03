"use client";

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CredentialSetupGate } from '@/components/auth/CredentialSetupGate';
import { useAppStore } from '@/lib/store';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// 2026-05-26 — every /[schoolId]/* route was returning HTTP 500 from
// Vercel SSR (browser content still rendered, but uptime monitors,
// link-previews, and server-side renderers saw 500s). Live-audit
// agent caught it. Root cause is Next 16's strict static-generation
// behavior with `useParams()` in a `'use client'` layout — same
// family as the `/connect/square/done` `useSearchParams()` SSR
// bailout fixed in e4a2764. Force dynamic rendering so Next doesn't
// try to statically prerender authed tenant routes (they're per-
// session anyway; there's no static value to extract).
export const dynamic = 'force-dynamic';

/**
 * SchoolLayout — wraps every /[schoolId]/* page in the DashboardLayout
 * chrome (sidebar + top toolbar + mobile tab bar + notifications +
 * brand chip + etc).
 *
 * 2026-05-15 — added a `mounted` render gate around DashboardLayout
 * to kill React #418 hydration mismatches across every authenticated
 * route. Why:
 *
 *   The Zustand auth store (apps/web/src/store/ui-store.ts:72) reads
 *   sessionStorage at MODULE LOAD via bootstrapAuth(). On the server
 *   `typeof window === 'undefined'` so `initial = { token: null,
 *   user: null }`. On the client `typeof window !== 'undefined'` so
 *   `initial = bootstrapAuth()` returns the real authenticated user.
 *
 *   That difference cascades into every layout component that reads
 *   `user` from the store — sidebar header, top toolbar avatar,
 *   notifications badge, role-gated nav items, branding lookup, etc.
 *   Individual components added their own `mounted` flags as the bug
 *   surfaced (Sidebar, TopToolbar), but at least one path was still
 *   slipping through and triggering React #418 on every page load
 *   for the last 30+ commits (Prod Smoke had been red).
 *
 *   Gating ONCE at the SchoolLayout boundary is cheaper than auditing
 *   100+ child components. Server still renders the loading
 *   placeholder; client hydrates with the same placeholder; one tick
 *   later the real chrome renders. No hydration boundary on anything
 *   user-dependent.
 *
 *   Cost: one extra render tick on initial navigation (~16ms,
 *   imperceptible). The data hooks below (React Query queries
 *   inside child components) still run during SSR because we only
 *   defer the OUTPUT, not the hooks themselves — they keep
 *   pre-fetching exactly like before.
 */
export default function SchoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const setActiveTenant = useAppStore((state) => state.setActiveTenant);
  // 2026-09-03 — FIRST-LOGIN CREDENTIAL SETUP. True while this account still
  // holds the placeholder email + starter password it was provisioned with.
  const mustSetupCredentials = useAppStore((state) => !!state.user?.mustSetupCredentials);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (params?.schoolId) {
      setActiveTenant(params.schoolId as string);
    }
  }, [params?.schoolId, setActiveTenant]);

  if (!mounted) {
    // Match the SSR output exactly on first client render so React
    // doesn't try to reconcile mismatched chrome. The minimal
    // placeholder is intentionally just a colored full-viewport
    // backdrop — no text, no icons — so the SSR snapshot has zero
    // surface area for any user-data-dependent render to leak in.
    return (
      <div
        className="min-h-screen w-full bg-slate-50"
        aria-hidden
      />
    );
  }

  // FIRST-LOGIN CREDENTIAL SETUP (2026-09-03) — an account provisioned with a
  // placeholder email + starter password gets the setup screen and NOTHING
  // else. Returned INSTEAD of DashboardLayout, not layered over it: the API
  // 403s every route but /auth/complete-setup, /auth/logout and /users/me, so
  // mounting the chrome would fire a dozen requests that are all refused and
  // assemble a broken dashboard behind the form. It sits after the `mounted`
  // gate above, so the SSR/first-client paint is the same neutral backdrop as
  // ever — the dashboard is never shown, not even for a frame.
  if (mustSetupCredentials) {
    return <CredentialSetupGate />;
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
