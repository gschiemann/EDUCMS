"use client";

import { useEffect, useState } from 'react';
import { Gauge, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

// SUPER_ADMIN-only capacity early-warning card (2026-10-12). English only; never customer-facing.
// One fetch on mount, no polling (mobile-perf standard): the data changes hourly.

type Level = 'ok' | 'warn' | 'critical';

interface CapacityMetric {
  key: string;
  label: string;
  unit: 'bytes' | 'count' | 'ms';
  value: number;
  limit: number | null;
  pct: number | null;
  level: Level;
  action: string;
  link: string | null;
  sampledAt: string;
  trend: Array<[number, number]>;
  growthPerDay: number | null;
  daysToLimit: number | null;
}

interface ChecklistItem {
  label: string;
  what: string;
  link: string;
  upgrade: string;
}

interface CapacityReport {
  enabled: boolean;
  thresholds: { warnPct: number; criticalPct: number };
  metrics: CapacityMetric[];
  checklist: ChecklistItem[];
  note: string;
}

function fmt(unit: string, v: number): string {
  if (unit === 'bytes') {
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
    return `${(v / 1024 ** 2).toFixed(1)} MB`;
  }
  if (unit === 'ms') return `${v.toFixed(1)} ms`;
  return Math.round(v).toLocaleString();
}

const LEVEL_STYLE: Record<Level, { bar: string; chip: string; text: string }> = {
  ok: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', text: 'OK' },
  warn: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800 border-amber-200', text: 'WARNING' },
  critical: { bar: 'bg-rose-600', chip: 'bg-rose-100 text-rose-800 border-rose-200', text: 'CRITICAL' },
};

function Sparkline({ points, color }: { points: Array<[number, number]>; color: string }) {
  if (points.length < 2) return <span className="text-[10px] text-slate-400">no trend yet</span>;
  const w = 96;
  const h = 24;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) || 1;
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * w;
  const sy = (y: number) => h - 2 - ((y - y0) / (y1 - y0 || 1)) * (h - 4);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="7-day trend" className="flex-shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

const SPARK_COLOR: Record<Level, string> = { ok: '#10b981', warn: '#f59e0b', critical: '#e11d48' };

export function CapacityCard() {
  const [data, setData] = useState<CapacityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiFetch<CapacityReport>('/super/capacity')
      .then((r) => alive && setData(r))
      .catch((e: any) => alive && setError(e?.message ?? 'Failed to load capacity'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const limited = (data?.metrics ?? []).filter((m) => m.limit !== null);
  const tables = (data?.metrics ?? []).filter((m) => m.limit === null);
  const worst = limited.some((m) => m.level === 'critical') ? 'critical' : limited.some((m) => m.level === 'warn') ? 'warn' : 'ok';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5" data-testid="capacity-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-indigo-600" />
            Capacity
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            How close each plan limit is. Upgrade when a row turns amber (warn
            {data ? ` at ${data.thresholds.warnPct}%` : ''}), before red
            {data ? ` (${data.thresholds.criticalPct}%)` : ''}. Sampled hourly; owners are emailed on a crossing.
          </p>
        </div>
        {data && limited.length > 0 && (
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${LEVEL_STYLE[worst].chip}`}>
            {LEVEL_STYLE[worst].text}
          </span>
        )}
      </div>

      {loading && (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

      {data && !data.enabled && (
        <p className="mt-3 text-xs text-amber-700 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> Capacity sampling is switched off (CAPACITY_WATCH_DISABLED).
        </p>
      )}
      {data && data.metrics.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">No samples yet. The first hourly sample lands a few minutes after the API boots.</p>
      )}

      {limited.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {limited.map((m) => {
            const s = LEVEL_STYLE[m.level];
            const pct = Math.min(100, m.pct ?? 0);
            return (
              <li key={m.key} className="py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-semibold text-slate-800">{m.label}</p>
                    <p className="text-xs text-slate-500">
                      {fmt(m.unit, m.value)} of {m.limit !== null ? fmt(m.unit, m.limit) : '?'}
                      {m.pct !== null && <span className="font-semibold text-slate-700"> · {m.pct.toFixed(0)}%</span>}
                      {m.daysToLimit !== null && (
                        <span className="text-slate-500"> · ~{m.daysToLimit < 1 ? '<1' : Math.round(m.daysToLimit)} days to limit at the 7-day pace</span>
                      )}
                    </p>
                  </div>
                  <Sparkline points={m.trend} color={SPARK_COLOR[m.level]} />
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.chip}`}>{s.text}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${s.bar}`} style={{ width: `${pct}%` }} />
                </div>
                {m.level !== 'ok' && (
                  <p className="mt-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <span className="font-bold">Upgrade:</span> {m.action}
                    {m.link && (
                      <a href={m.link} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-indigo-600 font-semibold">
                        open <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tables.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Biggest tables</p>
          <ul className="mt-1 grid sm:grid-cols-2 gap-x-6">
            {tables.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-2 py-1 text-xs text-slate-600 border-b border-slate-100">
                <span className="font-mono truncate">{m.label.replace('Table size: ', '')}</span>
                <span className="flex items-center gap-2">
                  <Sparkline points={m.trend} color="#6366f1" />
                  <span className="font-semibold text-slate-800 w-20 text-right">{fmt(m.unit, m.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.checklist.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Check by hand (the API cannot see these)</p>
          <ul className="mt-2 space-y-2">
            {data.checklist.map((c) => (
              <li key={c.label} className="text-xs text-slate-600">
                <a href={c.link} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 inline-flex items-center gap-0.5">
                  {c.label} <ExternalLink className="w-3 h-3" />
                </a>
                <span className="block text-slate-500">{c.what}</span>
                <span className="block text-slate-700">Upgrade: {c.upgrade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && <p className="mt-3 text-[11px] text-slate-400">{data.note}</p>}
    </div>
  );
}
