"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import { useAccessibleTenants } from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';

const LS_KEY = 'edu_cms_last_school';

export function SchoolSwitcher() {
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname() || '';
  const activeTenant = useAppStore((s) => s.activeTenant);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);
  const login = useAppStore((s) => s.login);
  const qc = useQueryClient();
  const { data } = useAccessibleTenants();
  const ref = useRef<HTMLDivElement>(null);

  const tenants = data?.tenants ?? [];
  const current = tenants.find((t) => t.slug === activeTenant || t.id === activeTenant);

  // Persist last-selected to localStorage
  useEffect(() => {
    if (activeTenant && typeof window !== 'undefined') {
      localStorage.setItem(LS_KEY, activeTenant);
    }
  }, [activeTenant]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const switchTo = async (slug: string) => {
    // Find the tenant record so we have its id for the API call. Previously
    // this function only updated the URL + client state — NEVER re-issued a
    // JWT. The caller's JWT still carried the old tenantId claim, so every
    // API query returned the PARENT tenant's data even when the user
    // "switched" to a child school. Screens, assets, playlists all came
    // from the parent. Bug: tenant isolation was visually broken for any
    // district admin with child schools.
    const tenant = tenants.find((t) => t.slug === slug || t.id === slug);
    if (!tenant) return;
    setSwitchingId(tenant.id);
    setSwitchError(null);
    try {
      const res: any = await apiFetch('/tenants/switch', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      // Re-issue token + user so every subsequent apiFetch is scoped to
      // the new tenant. login() writes to LS so a page refresh survives.
      login(res.access_token, res.user);
      setActiveTenant(tenant.slug);
      if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, tenant.slug);
      // Wipe React Query cache so every widget re-fetches under the new
      // tenant scope. Without this, stale parent-tenant data would stay
      // on screen until individual query staleTime expired.
      qc.clear();
      // Swap first path segment with the new slug.
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length === 0) {
        router.push(`/${tenant.slug}/dashboard`);
      } else {
        parts[0] = tenant.slug;
        router.push('/' + parts.join('/'));
      }
      setOpen(false);
    } catch (e: any) {
      setSwitchError(e?.message || 'Failed to switch schools.');
    } finally {
      setSwitchingId(null);
    }
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
        <span className="truncate max-w-[180px]">{current?.name ?? 'Select school'}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-[280px] bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 max-h-[360px] overflow-y-auto">
          {switchError && (
            <div className="px-3 py-2 mb-1 text-[10px] font-medium text-red-700 bg-red-50 border-b border-red-100">
              {switchError}
            </div>
          )}
          {tenants.map((t) => {
            const isActive = t.slug === activeTenant || t.id === activeTenant;
            const isDistrict = !t.parentId;
            const isSwitching = switchingId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => switchTo(t.slug)}
                disabled={!!switchingId}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors disabled:opacity-60 disabled:cursor-wait ${
                  isActive ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                } ${isDistrict ? 'border-b border-slate-100' : ''}`}
              >
                <span className="truncate flex items-center gap-2">
                  {isDistrict && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">District</span>}
                  {t.name}
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
