"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Building2, ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import { useAccessibleTenants } from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

export function SchoolSwitcher() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || '';
  const activeTenant = useAppStore((s) => s.activeTenant);
  const { data } = useAccessibleTenants();
  const ref = useRef<HTMLDivElement>(null);

  // Shared switch flow — same hook the Settings → schools list now uses.
  // Keeps JWT swap + Zustand update + qc.clear() + navigate in one place
  // so branding repaint behavior is identical across surfaces.
  const { switchToTenant, switchingId, error: switchError } = useTenantSwitch();

  const tenants = useMemo(() => data?.tenants ?? [], [data]);
  const current = tenants.find((t) => t.slug === activeTenant || t.id === activeTenant);
  const copy = useTenantCopy();

  // Group child Locations under their Primary parent so the switcher reads as
  // a hierarchy (Primary → its Locations) instead of a flat jumble. Roots =
  // accounts with no parentId (true org-roots) OR a child whose parent isn't
  // in the accessible set (orphan — shown standalone so it's never hidden).
  const orderedTenants = useMemo(() => {
    const known = new Set(tenants.map((t) => t.id));
    const childrenByParent = new Map<string, typeof tenants>();
    for (const t of tenants) {
      if (t.parentId && known.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) || [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      }
    }
    const roots = tenants
      .filter((t) => !t.parentId || !known.has(t.parentId))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const out: Array<{ t: (typeof tenants)[number]; depth: number }> = [];
    for (const r of roots) {
      out.push({ t: r, depth: 0 });
      const kids = (childrenByParent.get(r.id) || [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const k of kids) out.push({ t: k, depth: 1 });
    }
    return out;
  }, [tenants]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const switchTo = async (slug: string) => {
    const tenant = tenants.find((t) => t.slug === slug || t.id === slug);
    if (!tenant) return;
    // Preserve the current sub-path on switch (so a tenant-switch from
    // /lincoln/screens lands on /roosevelt/screens, not the dashboard).
    const parts = pathname.split('/').filter(Boolean);
    let destination: string | undefined;
    if (parts.length > 0) {
      parts[0] = tenant.slug;
      destination = '/' + parts.join('/');
    }
    const result = await switchToTenant({ id: tenant.id, slug: tenant.slug }, destination);
    if (result.ok) setOpen(false);
  };

  // If the user only has one accessible tenant, render a non-interactive label.
  if (tenants.length <= 1) {
    const label = current?.name ?? tenants[0]?.name ?? activeTenant ?? '';
    if (!label) return null;
    return (
      <div className="flex items-center gap-2 px-3 h-9 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold">
        <Building2 className="w-3.5 h-3.5 text-slate-400" />
        <span className="truncate max-w-[180px]">{label}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold"
      >
        <Building2 className="w-3.5 h-3.5 text-slate-400" />
        <span className="truncate max-w-[180px]">{current?.name ?? `Select ${copy.orgSingular.toLowerCase()}`}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 left-auto top-11 w-[280px] max-w-[calc(100vw-1rem)] bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 max-h-[360px] overflow-y-auto">
          {switchError && (
            <div className="px-3 py-2 mb-1 text-[10px] font-medium text-red-700 bg-red-50 border-b border-red-100">
              {switchError}
            </div>
          )}
          {orderedTenants.map(({ t, depth }) => {
            const isActive = t.slug === activeTenant || t.id === activeTenant;
            const isOrgRoot = !t.parentId;
            const isChild = depth > 0;
            const isSwitching = switchingId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => switchTo(t.slug)}
                disabled={!!switchingId}
                className={`w-full flex items-center justify-between gap-2 py-2 pr-3 text-left text-xs transition-colors disabled:opacity-60 disabled:cursor-wait ${
                  isChild ? 'pl-8' : 'pl-3'
                } ${isActive ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'} ${
                  isOrgRoot ? 'border-t border-slate-100 first:border-t-0' : ''
                }`}
              >
                <span className="truncate flex items-center gap-2">
                  {/* Child Location nested under its Primary — tree connector. */}
                  {isChild && <span className="text-slate-300" aria-hidden="true">└</span>}
                  {/* Org-root (top-level account) badge — universal "Primary"
                      across every vertical (copy.groupSingular). Everything
                      under it is a "Location". */}
                  {isOrgRoot && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{copy.groupSingular}</span>}
                  <span className="truncate">{t.name}</span>
                </span>
                {isSwitching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isActive ? (
                  <Check className="w-3.5 h-3.5" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
