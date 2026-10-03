"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAccessibleTenants, useTenant } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { canonicalTenantPath, type TenantUrlIdentity } from '@/lib/tenant-url';

/**
 * Keeps the signed-in organization's own URL on its current label after a
 * rename (see `canonicalTenantPath` for the rule and why it is this narrow).
 *
 * `useTenant()` is GET /tenants — the TOKEN's tenant, not the URL's — and
 * `useAccessibleTenants()` is the same list the account switcher already holds
 * (same query key, so this mounts no extra request and no poller). A URL whose
 * first segment names another tenant in that list is somewhere the user is
 * allowed to be and is never touched.
 */
export function TenantUrlCanonicalizer() {
  const router = useRouter();
  const pathname = usePathname();
  const tenantId = useUIStore((state) => state.user?.tenantId);
  const setActiveTenant = useUIStore((state) => state.setActiveTenant);
  const { data } = useTenant();
  const { data: accessible } = useAccessibleTenants();
  useEffect(() => {
    if (!pathname) return;
    const tenant = data as TenantUrlIdentity | undefined;
    const destination = canonicalTenantPath(
      pathname + window.location.search + window.location.hash,
      tenant,
      tenantId,
      accessible?.tenants,
    );
    if (!destination || !tenant?.slug) return;
    setActiveTenant(tenant.slug);
    try { localStorage.setItem('edu_cms_last_school', tenant.slug); } catch { /* storage unavailable */ }
    router.replace(destination, { scroll: false });
  }, [data, accessible, pathname, tenantId, setActiveTenant, router]);
  return null;
}
