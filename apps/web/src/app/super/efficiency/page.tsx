"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, CheckCircle2, TrendingUp, Database, Zap, Activity } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';

interface RouteRow {
  route: string;
  bytes: number;
  requests: number;
  avgLatencyMs: number;
}

interface SlowQuery {
  model: string;
  action: string;
  durationMs: number;
  ts: number;
}

interface EfficiencyData {
  window: { minutes: number; from: string | null; to: string | null };
  requests: {
    total: number;
    bytes: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  topRoutesByBytes: RouteRow[];
  topRoutesByRequests: RouteRow[];
  slowQueries: SlowQuery[];
  egress: {
    rollingBytes: number;
    rollingGb: number;
    budgetGb: number;
    usedPct: number;
    cacheHitRatioPct: number | null;
    note?: string;
  };
  anomaly: {
    currentHourBytes: number;
    baselineAvgBytes: number;
    ratio: number | null;
    triggered: boolean;
  };
  efficiency: {
    score: number;
    worstOffenders: string[];
  };
  banner: { active: boolean; message: string | null };
  meta: { budgetGb: number; slowQueryThresholdMs: number; note: string };
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
    score >= 60 ? 'bg-amber-100 text-amber-800 border-amber-200' :
    'bg-rose-100 text-rose-800 border-rose-200';
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold border ${color}`}>
      {score}/100
    </span>
  );
}

function EgressBar({ usedPct, budgetGb }: { usedPct: number; budgetGb: number }) {
  const clamp = Math.min(100, Math.max(0, usedPct));
  const color =
    clamp >= 90 ? 'bg-rose-500' :
    clamp >= 70 ? 'bg-amber-500' :
    clamp >= 50 ? 'bg-yellow-400' :
    'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{usedPct.toFixed(1)}% used</span>
        <span>{budgetGb} GB budget</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${clamp}%` }} />
      </div>
    </div>
  );
}

export default function EfficiencyPage() {
  const router = useRouter();
  const user = useAppStore(s => s.user);
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<EfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<EfficiencyData>('/super/efficiency');
      setData(result);
      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load efficiency data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && user?.role === 'SUPER_ADMIN') {
      void load();
    }
  }, [mounted, user?.role]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user || user.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white rounded-2xl border border-slate-200 shadow p-8 text-center max-w-sm">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-extrabold text-slate-900">Owner-only area</h1>
          <p className="text-sm text-slate-500 mt-1">Efficiency monitoring is restricted to platform owners.</p>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Activity className="w-6 h-6 text-indigo-600" />
              Efficiency Monitor
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Per-route bytes, latency, slow queries, egress budget — rolling 60-minute window
              {lastRefresh && ` · last updated ${lastRefresh.toLocaleTimeString()}`}
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg disabled:opacity-50 hover:bg-indigo-700 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            Refresh
          </button>
        </div>

        {/* Alert banner */}
        {data?.banner?.active && data.banner.message && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-800">Efficiency Alert</p>
              <p className="text-sm text-rose-700 mt-0.5">{data.banner.message}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm text-rose-700 font-medium">{error}</p>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          </div>
        )}

        {data && (
          <>
            {/* Score + summary row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Efficiency Score</p>
                <div className="mt-2">
                  <ScoreBadge score={data.efficiency.score} />
                </div>
                {data.efficiency.worstOffenders.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {data.efficiency.worstOffenders.map((o, i) => (
                      <li key={i} className="text-xs text-rose-600">• {o}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Requests ({data.window.minutes}m)</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">{fmtNum(data.requests.total)}</p>
                <p className="text-xs text-slate-500 mt-1">{fmtBytes(data.requests.bytes)} served</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Latency</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">{data.requests.p95LatencyMs}ms</p>
                <p className="text-xs text-slate-500 mt-1">p95 · p50: {data.requests.p50LatencyMs}ms</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cache Hit Ratio</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">
                  {data.egress.cacheHitRatioPct !== null ? `${data.egress.cacheHitRatioPct}%` : 'N/A'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {data.egress.note ?? 'Asset/proxy requests with conditional headers'}
                </p>
              </div>
            </div>

            {/* Egress card */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-bold text-slate-900">Egress Budget</h2>
                {data.anomaly.triggered && (
                  <span className="ml-auto text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                    Anomaly: {data.anomaly.ratio}x baseline
                  </span>
                )}
              </div>
              <EgressBar usedPct={data.egress.usedPct} budgetGb={data.egress.budgetGb} />
              <div className="flex gap-6 mt-3 text-sm">
                <div>
                  <span className="text-slate-500">Rolling total: </span>
                  <span className="font-semibold text-slate-900">{data.egress.rollingGb} GB</span>
                </div>
                <div>
                  <span className="text-slate-500">Budget: </span>
                  <span className="font-semibold text-slate-900">{data.egress.budgetGb} GB</span>
                </div>
                {data.anomaly.ratio !== null && (
                  <div>
                    <span className="text-slate-500">This hour vs baseline: </span>
                    <span className={`font-semibold ${data.anomaly.triggered ? 'text-rose-600' : 'text-slate-900'}`}>
                      {data.anomaly.ratio}x
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Thresholds: 50% (info) · 70% (warning) · 90% (critical). Anomaly fires at &gt;3x trailing hourly baseline.
                Set EGRESS_BUDGET_GB env var to change budget (default: 250 GB = Supabase Pro).
              </p>
            </div>

            {/* Top routes by bytes + by requests */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 mb-3">Top Routes — Bytes Served</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left border-b border-slate-100">
                        <th className="pb-2 font-medium">Route</th>
                        <th className="pb-2 font-medium text-right">Bytes</th>
                        <th className="pb-2 font-medium text-right">Reqs</th>
                        <th className="pb-2 font-medium text-right">Avg ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topRoutesByBytes.length === 0 && (
                        <tr><td colSpan={4} className="py-4 text-center text-slate-400">No data yet</td></tr>
                      )}
                      {data.topRoutesByBytes.map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-1.5 font-mono text-slate-700 truncate max-w-[180px]" title={r.route}>{r.route}</td>
                          <td className="py-1.5 text-right font-semibold text-slate-900">{fmtBytes(r.bytes)}</td>
                          <td className="py-1.5 text-right text-slate-600">{fmtNum(r.requests)}</td>
                          <td className="py-1.5 text-right text-slate-600">{r.avgLatencyMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 mb-3">Top Routes — Request Count</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left border-b border-slate-100">
                        <th className="pb-2 font-medium">Route</th>
                        <th className="pb-2 font-medium text-right">Reqs</th>
                        <th className="pb-2 font-medium text-right">Bytes</th>
                        <th className="pb-2 font-medium text-right">Avg ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topRoutesByRequests.length === 0 && (
                        <tr><td colSpan={4} className="py-4 text-center text-slate-400">No data yet</td></tr>
                      )}
                      {data.topRoutesByRequests.map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-1.5 font-mono text-slate-700 truncate max-w-[180px]" title={r.route}>{r.route}</td>
                          <td className="py-1.5 text-right font-semibold text-slate-900">{fmtNum(r.requests)}</td>
                          <td className="py-1.5 text-right text-slate-600">{fmtBytes(r.bytes)}</td>
                          <td className="py-1.5 text-right text-slate-600">{r.avgLatencyMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Slow queries */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-violet-500" />
                <h2 className="text-sm font-bold text-slate-900">Slow Queries</h2>
                <span className="text-xs text-slate-400">
                  (threshold: {data.meta.slowQueryThresholdMs}ms — set SLOW_QUERY_THRESHOLD_MS to change)
                </span>
              </div>
              {data.slowQueries.length === 0 ? (
                <div className="flex items-center gap-2 text-emerald-600 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  No slow queries — all queries within threshold
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left border-b border-slate-100">
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">Action</th>
                        <th className="pb-2 font-medium text-right">Duration</th>
                        <th className="pb-2 font-medium text-right">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.slowQueries.map((q, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-1.5 font-mono text-slate-700">{q.model}</td>
                          <td className="py-1.5 font-mono text-slate-600">{q.action}</td>
                          <td className={`py-1.5 text-right font-semibold ${q.durationMs > 1000 ? 'text-rose-600' : q.durationMs > 500 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {q.durationMs}ms
                          </td>
                          <td className="py-1.5 text-right text-slate-400">
                            {new Date(q.ts).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Meta note */}
            <p className="text-xs text-slate-400 pb-4">
              {data.meta.note}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
