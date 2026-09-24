'use client';

/**
 * EmergencyReadinessCard — the computed "are we actually ready for a
 * drill?" score, rendered where emergency gets configured (2026-08-24,
 * trust-first UX wave 4).
 *
 * Why it exists: emergency vendors' own users report "difficult having
 * confidence in your alert setup" — config lives in one place, delivery
 * health in another, and nobody adds it up. This card adds it up: content
 * wiring, delivery chain, screen readiness, trigger-capable staff, and
 * when the system was last actually exercised, each with a one-line fix.
 * READ-ONLY — it observes; the controls to fix things live right below it
 * on the same page (the unified-emergency-page contract).
 *
 * No polling: readiness is computed fresh on mount and on the explicit
 * Re-check button. A settings page must not tick in the background
 * (mobile-perf standard).
 */

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, ShieldOff, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

export type ReadinessStatus = 'ok' | 'warn' | 'missing';
export interface ReadinessItem {
  key: string;
  status: ReadinessStatus;
  label: string;
  detail: string;
  fixHint: string;
}
export interface ReadinessReport {
  /** DISABLED (2026-09-24): the capability is off, nothing was graded. */
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED' | 'DISABLED';
  enabled?: boolean;
  locked?: boolean;
  score: number;
  items: ReadinessItem[];
  computedAt: string;
}

/**
 * The readiness query, shared (2026-09-02). The Settings Emergency page needs
 * the SAME report this card renders — for the index attention dot and the
 * context rail — and two components computing readiness two ways is exactly
 * how a settings page ends up disagreeing with itself. One query key, one
 * request, one answer.
 *
 * Still no polling (mobile-perf standard): fresh on mount and on Re-check.
 */
export function useEmergencyReadiness(options?: { enabled?: boolean }) {
  return useQuery<ReadinessReport>({
    queryKey: ['emergency-readiness'],
    queryFn: () => apiFetch<ReadinessReport>('/emergency/readiness'),
    staleTime: 60_000,
    refetchInterval: false,
    enabled: options?.enabled ?? true,
  });
}

const VERDICT_META = {
  READY: {
    icon: ShieldCheck,
    wrap: 'bg-emerald-50 border-emerald-200',
    ink: 'text-emerald-900',
    sub: 'text-emerald-700',
    title: 'Ready for a drill',
    blurb: 'Content, delivery, screens, and staff all check out.',
  },
  NEEDS_ATTENTION: {
    icon: ShieldAlert,
    wrap: 'bg-amber-50 border-amber-200',
    ink: 'text-amber-900',
    sub: 'text-amber-700',
    title: 'Ready, with gaps',
    blurb: 'An alert would deliver today — close the items below before you need them.',
  },
  NOT_CONFIGURED: {
    icon: ShieldOff,
    wrap: 'bg-rose-50 border-rose-200',
    ink: 'text-rose-900',
    sub: 'text-rose-700',
    title: 'Not ready',
    blurb: 'A critical piece is missing — an alert would not reach your screens correctly.',
  },
  // OFF is not "not ready" (2026-09-24): nothing is graded while the
  // capability is off, so this reads calm, never red. The page normally
  // gates this card on the capability being on; this is the honest answer if
  // a report arrives anyway.
  DISABLED: {
    icon: ShieldOff,
    wrap: 'bg-slate-50 border-slate-200',
    ink: 'text-slate-800',
    sub: 'text-slate-500',
    title: 'Emergency alerts are off',
    blurb: 'Nothing is graded while alerts are off. Turn them on to set up alert types and their content.',
  },
} as const;

const STATUS_ICON: Record<ReadinessStatus, { Icon: typeof CheckCircle2; cls: string }> = {
  ok: { Icon: CheckCircle2, cls: 'text-emerald-500' },
  warn: { Icon: AlertTriangle, cls: 'text-amber-500' },
  missing: { Icon: XCircle, cls: 'text-rose-500' },
};

export function EmergencyReadinessCard() {
  const { data, isLoading, isError, refetch, isRefetching } = useEmergencyReadiness();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center gap-3 text-sm font-semibold text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking emergency readiness…
      </div>
    );
  }
  if (isError || !data) {
    // The check itself failing IS readiness information — never hide it.
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-rose-700">
          Couldn&apos;t compute readiness — the check itself failed, which usually means the API is unreachable.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-white border border-rose-200 rounded-lg px-3 py-2 hover:bg-rose-100"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const meta = VERDICT_META[data.verdict];
  const VerdictIcon = meta.icon;
  // No score and no checklist for a capability that is off — there is
  // nothing to add up.
  const off = data.verdict === 'DISABLED';

  return (
    <section aria-label="Emergency readiness" className={`rounded-xl border shadow-sm ${meta.wrap}`}>
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
            <VerdictIcon className={`w-5 h-5 ${meta.ink}`} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className={`text-sm font-bold ${meta.ink}`}>{meta.title}</div>
            <div className={`text-xs ${meta.sub}`}>{meta.blurb}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!off && (
            <div className={`text-right ${meta.ink}`}>
              <div className="text-xl font-black tabular-nums leading-none">{data.score}</div>
              <div className={`text-[10px] font-bold uppercase tracking-wide ${meta.sub}`}>Readiness</div>
            </div>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            aria-label="Re-check readiness"
            title="Re-check readiness"
            className={`min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center rounded-lg border bg-white/70 px-2.5 py-2 ${meta.ink} border-current/20 hover:bg-white disabled:opacity-50`}
          >
            {isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {!off && (
      <ul className="bg-white/60 rounded-b-xl divide-y divide-slate-100/80 px-4">
        {data.items.map((item) => {
          const { Icon, cls } = STATUS_ICON[item.status];
          return (
            <li key={item.key} className="py-2.5 flex items-start gap-2.5">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cls}`} aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <span className="font-bold text-slate-800">{item.label}:</span>{' '}
                <span className="text-slate-600">{item.detail}</span>
                {item.fixHint ? (
                  <span className="text-slate-500"> {item.fixHint}</span>
                ) : null}
              </div>
              <span className="sr-only">{item.status === 'ok' ? 'OK' : item.status === 'warn' ? 'Needs attention' : 'Missing'}</span>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}
