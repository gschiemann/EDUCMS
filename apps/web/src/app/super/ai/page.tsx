"use client";

/**
 * /super/ai — AI models & usage (2026-09-22).
 *
 * Greg: "models get upgraded every month from every AI vendor so we need to be built so that it
 * auto upgrades our models without code changes … make sure its dynamic", and "we need to build in
 * a limiter so customers only get so much usage included with a $25 per mo per screen cost".
 *
 * The API does both (ai-model-catalog.ts + the daily vendor-feed sync; the dollar-metered
 * allowance). This page is where an owner SEES it and, when they want to, steers it:
 *   - which model every job runs on right now, and what it costs;
 *   - this month's AI spend per organisation against its included allowance;
 *   - what the last daily sync found (new versions adopted, price moves, models it could not place);
 *   - two levers, no deploy: which tier board DESIGN runs on, and a pin per tier.
 *
 * All reads are on demand (mount + the Refresh button) — no polling (mobile perf standard).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Cpu, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';

type Provider = 'anthropic' | 'openai' | 'google';
type Tier = 'standard' | 'balanced' | 'premium';

interface TierRow {
  tier: Tier;
  family: string;
  ceilingOutputPer1M: number;
  pinned: string | null;
  model: { id: string; label: string; status: string; inputPer1M: number; outputPer1M: number };
  fallback: { id: string; label: string } | null;
}

interface CatalogModelRow {
  provider: Provider;
  id: string;
  label: string;
  family: string | null;
  releasedAt: string | null;
  inputPer1M: number;
  outputPer1M: number;
  status: string;
  retiresAt: string | null;
  source: 'seed' | 'feed';
}

interface SyncReport {
  at: string;
  adopted: Array<{ provider: Provider; tier: Tier; from: string; to: string }>;
  priceChanges: Array<{ provider: Provider; id: string; from: [number, number]; to: [number, number] }>;
  added: string[];
  unassigned: string[];
  disagreements: Array<{ provider: Provider; id: string; openrouter: [number, number]; litellm: [number, number] }>;
  errors: string[];
}

interface CatalogResponse {
  version: number;
  updatedAt: string | null;
  tiers: Array<{ provider: Provider; tiers: TierRow[] }>;
  platformJobs: { fast: Tier; design: Tier };
  jobEffort: { fast: string; design: string };
  models: CatalogModelRow[];
  lastSync: SyncReport | null;
  allowance: { perScreenUsd: number; floorUsd: number };
}

interface UsageResponse {
  month: string;
  resetAt: string;
  totalPlatformUsd: number;
  totalOwnKeyUsd: number;
  orgs: Array<{
    orgTenantId: string;
    name: string;
    platformUsd: number;
    ownKeyUsd: number;
    calls: number;
    screens: number;
    includedUsd: number;
  }>;
}

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
const TIER_LABEL: Record<Tier, string> = { standard: 'Standard', balanced: 'Balanced', premium: 'Premium' };

function usd(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
}

function price(inp: number, out: number): string {
  return `$${inp} / $${out}`;
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'unverified'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200';
  const label = status === 'active' ? 'verified' : status === 'unverified' ? 'not yet tested' : status;
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${tone}`}>{label}</span>;
}

function SpendBar({ used, included }: { used: number; included: number }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const color = pct >= 100 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="w-32" title={`${pct}% of the included allowance`}>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">{pct}%</div>
    </div>
  );
}

export default function SuperAiPage() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, u] = await Promise.all([
        apiFetch<CatalogResponse>('/super/ai/catalog'),
        apiFetch<UsageResponse>('/super/ai/usage'),
      ]);
      setCatalog(c);
      setUsage(u);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the AI catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mounted && user?.role === 'SUPER_ADMIN') void load();
  }, [mounted, user?.role, load]);

  const modelsByProvider = useMemo(() => {
    const out: Record<Provider, CatalogModelRow[]> = { anthropic: [], openai: [], google: [] };
    for (const m of catalog?.models || []) out[m.provider]?.push(m);
    return out;
  }, [catalog]);

  const saveSettings = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setNotice(null);
    try {
      await apiFetch('/super/ai/catalog/settings', { method: 'PUT', body: JSON.stringify(body) });
      setNotice('Saved. Every server picks this up within 5 minutes — no deploy.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    setNotice(null);
    setError(null);
    try {
      const report = await apiFetch<SyncReport>('/super/ai/catalog/sync', { method: 'POST' });
      const moved = report.adopted.length;
      setNotice(
        moved
          ? `Checked the vendors: ${moved} tier${moved === 1 ? '' : 's'} moved to a newer model.`
          : 'Checked the vendors: every tier is already on the newest model that passed its test.',
      );
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'The vendor check failed — nothing was changed.');
    } finally {
      setBusy(null);
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user || user.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow p-8 text-center max-w-sm">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-extrabold text-slate-900">Owner-only area</h1>
          <p className="text-sm text-slate-500 mt-1">AI models and spend are restricted to platform owners.</p>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const anthropicTiers = catalog?.tiers.find((t) => t.provider === 'anthropic')?.tiers || [];
  const jobModel = (tier: Tier | undefined) => anthropicTiers.find((t) => t.tier === tier)?.model;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button
              onClick={() => router.push('/super')}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Owner control panel
            </button>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Cpu className="w-6 h-6 text-indigo-600" /> AI models &amp; usage
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Models upgrade themselves: every day we check the vendors, test any newer version on our key, and switch
              over when it passes. Usage is metered in real dollars, so a cheaper model means more included AI for
              every customer.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void syncNow()}
              disabled={busy !== null}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-800 text-sm font-bold rounded-lg disabled:opacity-50 hover:bg-slate-50"
            >
              {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-indigo-600" />}
              Check for new models now
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg disabled:opacity-50 hover:bg-indigo-700"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
        </header>

        {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
        {notice && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">{notice}</div>}

        {loading && !catalog && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          </div>
        )}

        {catalog && (
          <>
            {/* ── Our key: what each job runs on ─────────────────────────── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">On our key (Anthropic)</h2>
              <div className="grid sm:grid-cols-2 gap-4 mt-3">
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Chat, menu reading, captions, short copy</div>
                  <div className="text-lg font-extrabold text-slate-900 mt-1">{jobModel(catalog.platformJobs.fast)?.label ?? '—'}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {TIER_LABEL[catalog.platformJobs.fast]} tier ·{' '}
                    {jobModel(catalog.platformJobs.fast) &&
                      price(jobModel(catalog.platformJobs.fast)!.inputPer1M, jobModel(catalog.platformJobs.fast)!.outputPer1M)}{' '}
                    per 1M tokens (in / out)
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Board design</div>
                  <div className="text-lg font-extrabold text-slate-900 mt-1">{jobModel(catalog.platformJobs.design)?.label ?? '—'}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {jobModel(catalog.platformJobs.design) &&
                      price(jobModel(catalog.platformJobs.design)!.inputPer1M, jobModel(catalog.platformJobs.design)!.outputPer1M)}{' '}
                    per 1M tokens (in / out)
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                    Design runs on
                    <select
                      value={catalog.platformJobs.design}
                      disabled={busy !== null}
                      onChange={(e) => void saveSettings('design', { platformJobs: { design: e.target.value } })}
                      className="border border-slate-200 rounded-md px-2 py-1 text-xs font-bold text-slate-800 bg-white"
                    >
                      {(['standard', 'balanced', 'premium'] as Tier[]).map((t) => (
                        <option key={t} value={t}>
                          {TIER_LABEL[t]} — {jobModel(t)?.label ?? t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Included AI: <span className="font-bold tabular-nums">${catalog.allowance.perScreenUsd}</span> per paired
                screen per month, never less than <span className="font-bold tabular-nums">${catalog.allowance.floorUsd}</span> per
                organisation, shared across its locations. Customers on their own AI key are unlimited — they pay their
                provider.
              </p>
            </section>

            {/* ── This month's spend ─────────────────────────────────────── */}
            {usage && (
              <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">AI spend — {usage.month}</h2>
                  <div className="text-xs text-slate-500 tabular-nums">
                    Our key <span className="font-bold text-slate-800">{usd(usage.totalPlatformUsd)}</span> · customers&apos; own keys{' '}
                    <span className="font-bold text-slate-800">{usd(usage.totalOwnKeyUsd)}</span>
                  </div>
                </div>
                {usage.orgs.length === 0 ? (
                  <p className="text-sm text-slate-500 mt-3">No AI used yet this month.</p>
                ) : (
                  <div className="overflow-x-auto mt-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-100">
                          <th className="py-2 pr-3 font-bold">Organisation</th>
                          <th className="py-2 pr-3 font-bold text-right">Screens</th>
                          <th className="py-2 pr-3 font-bold text-right">Included</th>
                          <th className="py-2 pr-3 font-bold text-right">Used (our key)</th>
                          <th className="py-2 pr-3 font-bold"> </th>
                          <th className="py-2 pr-3 font-bold text-right">Own key</th>
                          <th className="py-2 font-bold text-right">Calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.orgs.map((o) => (
                          <tr key={o.orgTenantId} className="border-b border-slate-50">
                            <td className="py-2 pr-3 font-semibold text-slate-800">{o.name}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{o.screens}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{usd(o.includedUsd)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums font-bold">{usd(o.platformUsd)}</td>
                            <td className="py-2 pr-3">
                              <SpendBar used={o.platformUsd} included={o.includedUsd} />
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{usd(o.ownKeyUsd)}</td>
                            <td className="py-2 text-right tabular-nums text-slate-500">{o.calls}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* ── Tiers per vendor (what customers with their own key get) ── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">Tiers by vendor</h2>
              <p className="text-xs text-slate-500 mt-1">
                Each tier is the newest version in its family that passed its test and fits the price envelope. A pin
                overrides that until you clear it.
              </p>
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3 font-bold">Vendor</th>
                      <th className="py-2 pr-3 font-bold">Tier</th>
                      <th className="py-2 pr-3 font-bold">Model today</th>
                      <th className="py-2 pr-3 font-bold text-right">$ / 1M in · out</th>
                      <th className="py-2 pr-3 font-bold">If it fails</th>
                      <th className="py-2 font-bold">Pin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.tiers.flatMap((p) =>
                      p.tiers.map((t) => (
                        <tr key={`${p.provider}-${t.tier}`} className="border-b border-slate-50 align-middle">
                          <td className="py-2 pr-3 font-semibold text-slate-800">{PROVIDER_LABEL[p.provider]}</td>
                          <td className="py-2 pr-3">{TIER_LABEL[t.tier]}</td>
                          <td className="py-2 pr-3">
                            <span className="font-bold text-slate-900">{t.model.label}</span>{' '}
                            <StatusChip status={t.model.status} />
                            {t.pinned && (
                              <span className="ml-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
                                pinned
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{price(t.model.inputPer1M, t.model.outputPer1M)}</td>
                          <td className="py-2 pr-3 text-slate-500">{t.fallback?.label ?? '—'}</td>
                          <td className="py-2">
                            <select
                              aria-label={`Pin the ${PROVIDER_LABEL[p.provider]} ${TIER_LABEL[t.tier]} tier`}
                              value={t.pinned ?? ''}
                              disabled={busy !== null}
                              onChange={(e) =>
                                void saveSettings(`pin-${p.provider}-${t.tier}`, {
                                  pins: { [p.provider]: { [t.tier]: e.target.value || null } },
                                })
                              }
                              className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white max-w-[12rem]"
                            >
                              <option value="">Automatic (newest)</option>
                              {modelsByProvider[p.provider]
                                .filter((m) => m.status !== 'failed' && m.status !== 'retired')
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.label}
                                  </option>
                                ))}
                            </select>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Last daily check ─────────────────────────────────────── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">Last vendor check</h2>
              {!catalog.lastSync ? (
                <p className="text-sm text-slate-500 mt-2">
                  Not run yet on this database — the first automatic check runs a few minutes after the server starts, or
                  use “Check for new models now”.
                </p>
              ) : (
                <div className="mt-2 space-y-2 text-xs text-slate-700">
                  <div className="text-slate-500">{new Date(catalog.lastSync.at).toLocaleString()}</div>
                  <div>
                    <span className="font-bold">Upgrades:</span>{' '}
                    {catalog.lastSync.adopted.length
                      ? catalog.lastSync.adopted
                          .map((a) => `${PROVIDER_LABEL[a.provider]} ${TIER_LABEL[a.tier]}: ${a.from} → ${a.to}`)
                          .join(' · ')
                      : 'none — every tier was already on its newest model'}
                  </div>
                  <div>
                    <span className="font-bold">Price changes:</span>{' '}
                    {catalog.lastSync.priceChanges.length
                      ? catalog.lastSync.priceChanges
                          .map((c) => `${c.id} ${price(c.from[0], c.from[1])} → ${price(c.to[0], c.to[1])}`)
                          .join(' · ')
                      : 'none'}
                  </div>
                  {catalog.lastSync.unassigned.length > 0 && (
                    <div>
                      <span className="font-bold">New models we could not place in a tier:</span>{' '}
                      {catalog.lastSync.unassigned.slice(0, 12).join(', ')}
                      {catalog.lastSync.unassigned.length > 12 ? ` +${catalog.lastSync.unassigned.length - 12} more` : ''}
                    </div>
                  )}
                  {catalog.lastSync.errors.length > 0 && (
                    <div className="text-rose-700">
                      <span className="font-bold">Problems:</span> {catalog.lastSync.errors.slice(0, 5).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
