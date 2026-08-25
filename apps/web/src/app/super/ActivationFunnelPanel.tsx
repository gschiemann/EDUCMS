"use client";

import { useEffect, useState } from 'react';
import { Loader2, TrendingUp, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

/**
 * Activation-funnel panel for the owner control panel (/super).
 *
 * Derived entirely from GET /api/v1/super/activation-funnel (SUPER_ADMIN
 * only) — see apps/api/src/activation-funnel/activation-funnel.service.ts
 * for the full metric definition ("activated = first content published to
 * a real screen; proven = render-proof received").
 *
 * One fetch on mount, no polling — this is a slow-moving business metric,
 * not a live-ops surface (matches the standing mobile-perf rule: don't add
 * a poller without a reason). Plain styled-div bars, no chart library.
 */

type FunnelStage = 'SIGNED_UP' | 'BOARD_CREATED' | 'SCREEN_PAIRED' | 'PUBLISHED' | 'RENDER_PROVEN';

const STAGE_LABELS: Record<FunnelStage, string> = {
  SIGNED_UP: 'Signed up',
  BOARD_CREATED: 'Board created',
  SCREEN_PAIRED: 'Screen paired',
  PUBLISHED: 'Published',
  RENDER_PROVEN: 'Render-proven',
};

const STAGE_ORDER: FunnelStage[] = ['SIGNED_UP', 'BOARD_CREATED', 'SCREEN_PAIRED', 'PUBLISHED', 'RENDER_PROVEN'];

const STAGE_BAR_COLOR: Record<FunnelStage, string> = {
  SIGNED_UP: 'bg-slate-400',
  BOARD_CREATED: 'bg-sky-500',
  SCREEN_PAIRED: 'bg-indigo-500',
  PUBLISHED: 'bg-violet-500',
  RENDER_PROVEN: 'bg-emerald-500',
};

const STAGE_BADGE: Record<FunnelStage, string> = {
  SIGNED_UP: 'bg-slate-100 text-slate-600 border-slate-200',
  BOARD_CREATED: 'bg-sky-50 text-sky-700 border-sky-200',
  SCREEN_PAIRED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PUBLISHED: 'bg-violet-50 text-violet-700 border-violet-200',
  RENDER_PROVEN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

interface FunnelTenantRow {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  signedUpAt: string;
  stage: FunnelStage;
  stageReachedAt: string;
  daysInStage: number;
}

interface RateStat {
  reached: number;
  total: number;
  pct: number | null;
}

interface FunnelResponse {
  recentTenants: FunnelTenantRow[];
  aggregate: {
    totalTenants: number;
    excludedTenants: number;
    stageCounts: Record<FunnelStage, number>;
    medianHoursToMilestone: {
      boardCreated: number | null;
      screenPaired: number | null;
      published: number | null;
      renderProven: number | null;
    };
    activationRate: { overall: RateStat; last30Days: RateStat };
  };
  excluded: { count: number; note: string };
  meta: { generatedAt: string; definition: string };
}

function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`;
}

function fmtHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function daysBadgeTone(days: number): string {
  if (days >= 30) return 'text-rose-700 font-bold';
  if (days >= 14) return 'text-amber-700 font-bold';
  return 'text-slate-600';
}

export default function ActivationFunnelPanel() {
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiFetch<FunnelResponse>('/super/activation-funnel');
        if (!cancelled) setData(result);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load activation funnel');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 text-rose-600 text-sm">
          <AlertTriangle className="w-4 h-4" />
          {error ?? 'No activation-funnel data'}
        </div>
      </section>
    );
  }

  const { aggregate, recentTenants } = data;
  const maxStageCount = Math.max(1, ...STAGE_ORDER.map((s) => aggregate.stageCounts[s] ?? 0));

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <TrendingUp className="w-4 h-4 text-indigo-600" />
        <h2 className="text-sm font-extrabold text-slate-800">Activation Funnel</h2>
        <span className="text-[10px] text-slate-400 ml-2">
          signup → board → screen paired → published → render-proven
        </span>
        <span className="ml-auto text-[10px] text-slate-400">
          {aggregate.totalTenants} tenants · {aggregate.excludedTenants} excluded
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Activation-rate stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <RateTile label="Activated (all-time)" stat={aggregate.activationRate.overall} accent />
          <RateTile label="Activated (last 30d signups)" stat={aggregate.activationRate.last30Days} />
          <HoursTile label="Median hrs → published" hours={aggregate.medianHoursToMilestone.published} />
          <HoursTile label="Median hrs → render-proven*" hours={aggregate.medianHoursToMilestone.renderProven} />
        </div>

        {/* Stage bar chart — plain styled divs, no chart library */}
        <div className="space-y-1.5">
          {STAGE_ORDER.map((stage) => {
            const count = aggregate.stageCounts[stage] ?? 0;
            const widthPct = Math.max(2, Math.round((count / maxStageCount) * 100));
            return (
              <div key={stage} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-[11px] font-semibold text-slate-600 text-right">
                  {STAGE_LABELS[stage]}
                </div>
                <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
                  <div
                    className={`h-5 rounded-md ${STAGE_BAR_COLOR[stage]} transition-all flex items-center justify-end pr-2`}
                    style={{ width: `${widthPct}%` }}
                  >
                    {count > 0 && <span className="text-[10px] font-bold text-white">{count}</span>}
                  </div>
                </div>
                <div className="w-10 shrink-0 text-[11px] text-slate-400 text-right">
                  {aggregate.totalTenants > 0 ? Math.round((count / aggregate.totalTenants) * 100) : 0}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent tenants table — worst-stuck-first */}
        <div>
          <h3 className="text-xs font-bold text-slate-700 mb-2">
            15 most recent signups — most-stuck first
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 text-left border-b border-slate-100">
                  <th className="pb-2 font-medium">Tenant</th>
                  <th className="pb-2 font-medium">Vertical</th>
                  <th className="pb-2 font-medium">Stage</th>
                  <th className="pb-2 font-medium text-right">Signed up</th>
                  <th className="pb-2 font-medium text-right">Days in stage</th>
                </tr>
              </thead>
              <tbody>
                {recentTenants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">
                      No tenants yet
                    </td>
                  </tr>
                )}
                {recentTenants.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-1.5 font-semibold text-slate-800">{t.name}</td>
                    <td className="py-1.5 text-slate-500">{t.vertical}</td>
                    <td className="py-1.5">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STAGE_BADGE[t.stage]}`}
                      >
                        {STAGE_LABELS[t.stage]}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-slate-500">
                      {new Date(t.signedUpAt).toLocaleDateString()}
                    </td>
                    <td className={`py-1.5 text-right ${daysBadgeTone(t.daysInStage)}`}>{t.daysInStage}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[10px] text-slate-400">
          {data.meta.definition} *render-proven uses the fleet&apos;s most recent proof, not a first-ever
          timestamp — {data.excluded.count} tenant(s) excluded (archived / system / demo-seed — see the
          service definition comment for the full list).
        </p>
      </div>
    </section>
  );
}

function RateTile({ label, stat, accent = false }: { label: string; stat: RateStat; accent?: boolean }) {
  return (
    <div className={`p-3 rounded-xl border ${accent ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-extrabold mt-0.5 ${accent ? 'text-emerald-700' : 'text-slate-900'}`}>
        {fmtPct(stat.pct)}
      </p>
      <p className="text-[10px] text-slate-400 mt-0.5">
        {stat.reached} / {stat.total}
      </p>
    </div>
  );
}

function HoursTile({ label, hours }: { label: string; hours: number | null }) {
  return (
    <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-extrabold mt-0.5 text-slate-900">{fmtHours(hours)}</p>
    </div>
  );
}
