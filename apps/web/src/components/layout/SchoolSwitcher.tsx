"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronsUpDown, Check } from 'lucide-react';
import { useAccessibleTenants } from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';

const LS_KEY = 'edu_cms_last_school';

export function SchoolSwitcher() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname() || '';
  const activeTenant = useAppStore((s) => s.activeTenant);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);
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

  const switchTo = (slug: string) => {
    setActiveTenant(slug);
    if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, slug);
    // Swap first path segment with the new slug.
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      router.push(`/${slug}/dashboard`);
    } else {
      parts[0] = slug;
      router.push('/' + parts.join('/'));
    }
    setOpen(false);
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
          {tenants.map((t) => {
            const isActive = t.slug === activeTenant || t.id === activeTenant;
            const isDistrict = !t.parentId;
            return (
              <button
                key={t.id}
                onClick={() => switchTo(t.slug)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                } ${isDistrict ? 'border-b border-slate-100' : ''}`}
              >
                <span className="truncate flex items-center gap-2">
                  {isDistrict && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">District</span>}
                  {t.name}
                </span>
                {isActive && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
