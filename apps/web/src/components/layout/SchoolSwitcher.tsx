"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Building2, ChevronsUpDown, Check, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { useAccessibleTenants } from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

/**
 * Which edge the dropdown hangs from.
 *
 * 2026-09-03 — the mobile toolbar mounts this at the LEFT edge of the screen
 * while the desktop toolbar mounts it in the RIGHT-hand button group, and the
 * panel was hard-coded `right-0` for both. Right-anchoring a 280px panel to a
 * ~200px trigger that starts 16px from the left edge puts its left edge at
 * about -64px, so on a phone every account name was clipped off-screen (the
 * operator's screenshot showed "…anta", "…stin", "…timore"). `max-w` cannot
 * fix that: the panel fits, it is simply positioned off the viewport.
 */
export type SchoolSwitcherAlign = 'left' | 'right';

export function SchoolSwitcher({ align = 'right' }: { align?: SchoolSwitcherAlign } = {}) {
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
  // a hierarchy. Children stay COLLAPSED under a per-company expand toggle so a
  // super-admin with dozens of locations under one brand doesn't have to scroll
  // past all of them to reach the next company (operator 2026-06-03). Roots =
  // accounts with no parentId (true org-roots) OR a child whose parent isn't in
  // the accessible set (orphan — shown standalone so it's never hidden).
  const { roots, childrenByParent } = useMemo(() => {
    const known = new Set(tenants.map((t) => t.id));
    const childrenByParent = new Map<string, typeof tenants>();
    for (const t of tenants) {
      if (t.parentId && known.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) || [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      }
    }
    for (const arr of childrenByParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const roots = tenants
      .filter((t) => !t.parentId || !known.has(t.parentId))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return { roots, childrenByParent };
  }, [tenants]);

  // Which company (root) contains the active tenant — auto-expanded when the
  // menu opens so the operator sees where they currently are without hunting.
  const activeRootId = useMemo(() => {
    const act = tenants.find((t) => t.slug === activeTenant || t.id === activeTenant);
    if (!act) return null;
    return act.parentId && tenants.some((t) => t.id === act.parentId) ? act.parentId : act.id;
  }, [tenants, activeTenant]);

  // Expanded companies. Collapsed by default; auto-expand the active company
  // (and the only company, when there's just one) each time the menu opens.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (activeRootId) next.add(activeRootId);
      if (roots.length === 1) next.add(roots[0].id);
      return next;
    });
  }, [open, activeRootId, roots]);
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        <span className="truncate max-w-[100px] sm:max-w-[180px]">{label}</span>
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
        <span className="truncate max-w-[100px] sm:max-w-[180px]">{current?.name ?? `Select ${copy.orgSingular.toLowerCase()}`}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div
          className={`absolute ${
            align === 'left' ? 'left-0 right-auto' : 'right-0 left-auto'
          } top-11 w-[280px] max-w-[calc(100vw-1rem)] bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 max-h-[360px] overflow-y-auto`}
        >
          {switchError && (
            <div className="px-3 py-2 mb-1 text-[10px] font-medium text-red-700 bg-red-50 border-b border-red-100">
              {switchError}
            </div>
          )}
          {roots.map((root) => {
            const kids = childrenByParent.get(root.id) || [];
            const hasKids = kids.length > 0;
            const isExpanded = expanded.has(root.id);
            const rootActive = root.slug === activeTenant || root.id === activeTenant;
            const rootSwitching = switchingId === root.id;
            const isTrueRoot = !root.parentId;
            return (
              <div key={root.id} className="border-t border-slate-100 first:border-t-0">
                {/* Company row: chevron toggles its Locations; the name switches
                    into the company. Childless accounts get a spacer so names
                    stay aligned with the ones that have a toggle. */}
                <div className={`flex items-stretch ${rootActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  {hasKids ? (
                    <button
                      type="button"
                      onClick={() => toggleExpand(root.id)}
                      aria-label={isExpanded ? `Collapse ${root.name} locations` : `Expand ${root.name} locations`}
                      aria-expanded={isExpanded}
                      className="shrink-0 pl-2.5 pr-1 flex items-center text-slate-400 hover:text-slate-700"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="shrink-0 w-[26px]" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => switchTo(root.slug)}
                    disabled={!!switchingId}
                    className={`flex-1 min-w-0 flex items-center justify-between gap-2 py-2 pr-3 text-left text-xs transition-colors disabled:opacity-60 disabled:cursor-wait ${
                      rootActive ? 'text-indigo-700 font-bold' : 'text-slate-700'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2">
                      {/* Org-root (top-level account) badge — universal "Primary"
                          across every vertical (copy.groupSingular). */}
                      {isTrueRoot && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{copy.groupSingular}</span>
                      )}
                      <span className="truncate">{root.name}</span>
                      {hasKids && <span className="shrink-0 text-[10px] font-medium text-slate-400">({kids.length})</span>}
                    </span>
                    {rootSwitching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : rootActive ? (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    ) : null}
                  </button>
                </div>
                {/* Child Locations — only mounted when the company is expanded. */}
                {isExpanded &&
                  kids.map((k) => {
                    const kActive = k.slug === activeTenant || k.id === activeTenant;
                    const kSwitching = switchingId === k.id;
                    return (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => switchTo(k.slug)}
                        disabled={!!switchingId}
                        className={`w-full flex items-center justify-between gap-2 py-2 pr-3 pl-9 text-left text-xs transition-colors disabled:opacity-60 disabled:cursor-wait ${
                          kActive ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate flex items-center gap-2">
                          <span className="text-slate-300" aria-hidden="true">└</span>
                          <span className="truncate">{k.name}</span>
                        </span>
                        {kSwitching ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        ) : kActive ? (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
