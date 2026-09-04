"use client";

/**
 * SEC-010 (2026-09-04) — rendered per request so it can carry a CSP nonce.
 *
 * A prerendered route's inline scripts are built without a nonce, so the
 * enforced `script-src 'self' 'nonce-…'` from `src/proxy.ts` would refuse them
 * and this page would render blank. This route holds (or leads directly to) an
 * authenticated session, which is precisely what SEC-010's XSS impact is about,
 * so it is worth one render per request to bring it inside the policy. Public
 * marketing/legal/help pages and `/panic` deliberately stay prerendered and
 * report-only — see CSP_UNNONCEABLE_PREFIXES in src/lib/csp-script-policy.ts.
 *
 * `tools/check-csp-prerender.cjs` fails the build if this ever silently
 * reverts to being prerendered.
 */
export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';

export default function AssetsRedirect() {
  const router = useRouter();
  const user = useUIStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    } else {
      router.replace(`/${user.tenantSlug || user.tenantId}/assets`);
    }
  }, [user, router]);

  return null;
}
