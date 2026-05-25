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
 *
 * 2026-05-03 (later) — operator feedback: "the industry selection at
 * the top of the settings is overkill, we don't need big giant
 * buttons for each industry... eventually we won't have any of these,
 * you will pick your industry during sign up but i like that i can
 * switch and test for right now." Compressed to a one-line pill +
 * dropdown popover. Same logic + RoleGate.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, ArrowRightLeft, ChevronDown, Check } from 'lucide-react';
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
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isAdmin) return null;

  const switchTo = async (next: Vertical) => {
    if (next === currentVertical) {
      setOpen(false);
      return;
    }
    setPending(next);
    setError(null);
    try {
      // 2026-05-25 bug fix #1: previously this treated apiFetch's
      // return value as a Response (`res.ok` + `res.json()`). apiFetch
      // returns the PARSED JSON body and throws on non-2xx, so the
      // `if (!res.ok)` branch was ALWAYS hit and the switcher silently
      // failed with "Switch failed" on every successful call.
      await apiFetch('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ vertical: next }),
      });

      // 2026-05-25 bug fix #2 (operator: "switch industry still says
      // the old one after reload"): the JWT in sessionStorage carries
      // an `edu_cms_user` cached copy with the OLD tenantVertical
      // (login.ts:138 stamps it on the user object at sign-in time).
      // window.location.reload() re-hydrates from that cache, so the
      // page came back showing the prior industry every time. Merge
      // the new vertical into the cached user record BEFORE reloading
      // so the next render sees the fresh value. Same-tab session +
      // cross-tab backup both have to be updated.
      try {
        const USER_KEY = 'edu_cms_user';
        const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        const ls = typeof localStorage !== 'undefined' ? localStorage : null;
        const raw = ss?.getItem(USER_KEY) || ls?.getItem(USER_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.tenantVertical = next;
          const updated = JSON.stringify(parsed);
          ss?.setItem(USER_KEY, updated);
          if (ls?.getItem(USER_KEY)) ls.setItem(USER_KEY, updated);
        }
        // Also push directly into the Zustand store so any consumer
        // that reads from useUIStore between this line and the reload
        // (e.g. quick re-renders in the same JS tick) gets the new
        // value too.
        const current = useUIStore.getState().user;
        if (current) {
          useUIStore.setState({ user: { ...current, tenantVertical: next } });
        }
      } catch {
        // Storage write failure (private mode / quota) is non-fatal —
        // the reload below will still re-fetch fresh data on the next
        // /users/me call path. Worst case the operator sees the old
        // vertical for one more reload until the cache clears.
      }

      // Reload so every useTenantCopy() consumer re-resolves with the
      // freshly-cached value. Could be smarter (in-place store push +
      // skip reload) but the full reload guarantees no stale state
      // across the dashboard chrome.
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || 'Switch failed.');
      setPending(null);
    }
  };

  const currentLabel = VERTICAL_LABELS[currentVertical];

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
      <ArrowRightLeft className="w-4 h-4 text-indigo-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-700">Industry:</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-700">
            <span aria-hidden>{currentLabel.emoji}</span>
            <span>{currentLabel.singular}</span>
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">Switch industry context — testing only.</p>
      </div>
      <div className="relative shrink-0" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={pending !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {pending !== null ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <span>Switch</span>
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 z-30 w-64 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
          >
            <ul className="py-1 max-h-72 overflow-y-auto">
              {VERTICALS.map((v) => {
                const labels = VERTICAL_LABELS[v];
                const isActive = v === currentVertical;
                const isPending = pending === v;
                return (
                  <li key={v}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => switchTo(v)}
                      disabled={isActive || pending !== null}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                        isActive
                          ? 'bg-indigo-50/60 text-indigo-700 cursor-default'
                          : pending !== null
                            ? 'text-slate-400 cursor-not-allowed'
                            : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span aria-hidden className="text-base">{labels.emoji}</span>
                      <span className="flex-1 font-semibold truncate">{labels.singular}</span>
                      {isActive && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                      {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      {error && (
        <div className="absolute mt-12 right-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
          {error}
        </div>
      )}
    </section>
  );
}
