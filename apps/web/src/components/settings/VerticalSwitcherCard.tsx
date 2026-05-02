"use client";

/**
 * VerticalSwitcherCard — settings card to change a tenant's industry
 * vertical post-signup. Calls PATCH /api/v1/tenants/me which we
 * already had for super-admin operations; it's exposed in settings
 * here so a tenant admin can self-service when they realize they
 * picked the wrong vertical at signup OR when they pivot business
 * focus.
 *
 * Restricted to DISTRICT_ADMIN + SUPER_ADMIN at the API level.
 *
 * 2026-05-03 — VenueOS rebrand. After switching vertical the page
 * reloads so all useTenantCopy() consumers re-render with the new
 * vertical's strings (sidebar, switcher, settings labels, default
 * emergency types, template library filter).
 */

import { useState } from 'react';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { apiFetch } from '@/lib/api-client';
import {
  VERTICALS,
  VERTICAL_LABELS,
  isVertical,
  type Vertical,
} from '@cms/api-types';

export function VerticalSwitcherCard() {
  const user = useUIStore((s) => s.user);
  const role = user?.role || '';
  const isAdmin = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN';
  const currentVertical: Vertical = isVertical((user as any)?.tenantVertical)
    ? ((user as any).tenantVertical as Vertical)
    : 'K12';
  const [pending, setPending] = useState<Vertical | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  const switchTo = async (next: Vertical) => {
    if (next === currentVertical) return;
    setPending(next);
    setError(null);
    try {
      const res = await apiFetch('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ vertical: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.message || `Switch failed (${res.status})`);
      }
      // Reload so every useTenantCopy() consumer re-resolves. Could be
      // smarter (re-fetch /me + push into store) but the full reload
      // guarantees no stale state across the dashboard chrome.
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || 'Switch failed.');
      setPending(null);
    }
  };

  const currentLabel = VERTICAL_LABELS[currentVertical];

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <ArrowRightLeft className="w-5 h-5 text-indigo-500" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-800">Industry vertical</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Currently <span className="font-semibold text-slate-800">{currentLabel.emoji} {currentLabel.singular}</span> — drives template library, terminology, and default emergency types.
          </p>
        </div>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {VERTICALS.map((v) => {
          const labels = VERTICAL_LABELS[v];
          const isActive = v === currentVertical;
          const isPending = pending === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => switchTo(v)}
              disabled={isActive || pending !== null}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                isActive
                  ? 'border-indigo-500 bg-indigo-50/40 cursor-default'
                  : pending !== null
                    ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                    : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xl" aria-hidden>{labels.emoji}</span>
                <span className="text-sm font-bold text-slate-800">{labels.singular}</span>
                {isActive && (
                  <span className="ml-auto text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Active</span>
                )}
                {isPending && (
                  <Loader2 className="ml-auto w-3.5 h-3.5 text-indigo-500 animate-spin" />
                )}
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">{labels.tagline}</p>
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mx-5 mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}
      <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 text-[11px] text-slate-500">
        Switching reloads the dashboard. Existing screens, playlists, and assets stay — only the vertical-aware UI strings + template library filter change.
      </div>
    </section>
  );
}
