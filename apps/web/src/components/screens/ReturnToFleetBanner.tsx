"use client";

/**
 * ReturnToFleetBanner — shown on a CHILD location's Screens page when the
 * signed-in user also has access to its parent ("Corporate"). One click
 * switches back up to the parent and lands on the fleet roll-up. Self-
 * contained (own hooks) so the Screens page only needs a single mount line.
 *
 * Renders nothing for a top-level tenant or when the user can't reach the
 * parent — so it's safe to mount unconditionally.
 */

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Building2 } from 'lucide-react';
import { useAccessibleTenants } from '@/hooks/use-api';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';

export function ReturnToFleetBanner() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const { data } = useAccessibleTenants();
  const { switchToTenant, switchingId } = useTenantSwitch();

  const list = data?.tenants || [];
  const current = useMemo(() => list.find((t) => t.slug === schoolId) || null, [list, schoolId]);
  const parent = useMemo(() => {
    if (!current?.parentId) return null;
    return list.find((t) => t.id === current.parentId) || null;
  }, [list, current]);

  if (!parent) return null;

  return (
    <button
      onClick={() => switchToTenant({ id: parent.id, slug: parent.slug }, `/${parent.slug}/dashboard`)}
      disabled={switchingId === parent.id}
      className="w-full flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-bold transition-colors disabled:opacity-60"
      style={{
        borderColor: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 25%, transparent)',
        background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 6%, white)',
        color: 'var(--brand-primary, #4f46e5)',
      }}
    >
      <ArrowLeft className="w-4 h-4 shrink-0" />
      <span className="truncate">
        You&rsquo;re in <strong>{current?.name || schoolId}</strong>
      </span>
      <span className="opacity-40">·</span>
      <span className="inline-flex items-center gap-1 shrink-0">
        <Building2 className="w-3.5 h-3.5" /> Return to {parent.name} fleet
      </span>
    </button>
  );
}
