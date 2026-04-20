"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Crown, ExternalLink } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useTenantStatus } from '@/hooks/use-api';

/**
 * Persistent amber bar that reminds the viewer they're in SUPER_ADMIN
 * "god mode" — i.e. they can see and mutate data across every tenant
 * on the platform. Without this it's too easy to forget the owner
 * account has cross-tenant visibility and confuse someone else's data
 * for your own (which is exactly the bug that led to this banner).
 *
 * Renders nothing for any non-SUPER_ADMIN role. Hydration-safe: waits
 * one client tick before reading role from the store so an SSR→CSR
 * mismatch doesn't flash the banner for regular admins.
 */
export function SuperAdminBanner() {
  const user = useAppStore((s) => s.user);
  const { data: tenant } = useTenantStatus();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || user?.role !== 'SUPER_ADMIN') return null;

  const tenantName = tenant?.name || user?.tenantSlug || user?.tenantId || 'unknown tenant';

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-amber-500 text-amber-950 border-b border-amber-700/30 px-4 py-1.5 flex items-center justify-between gap-4 text-[11px] font-bold tracking-wide"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Crown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="uppercase">Super Admin Mode</span>
        <span className="text-amber-900/70 font-semibold">·</span>
        <span className="truncate font-semibold normal-case">
          viewing <span className="font-bold">{tenantName}</span>
        </span>
      </div>
      <Link
        href="/super"
        className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/10 hover:bg-amber-950/20 text-amber-950 text-[10px] font-bold uppercase tracking-wider transition-colors"
      >
        Owner Console
        <ExternalLink className="w-3 h-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
