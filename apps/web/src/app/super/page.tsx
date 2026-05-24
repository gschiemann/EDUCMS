"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Crown, Building2, AlertCircle, Plus, Search, X, Filter, HardDrive, Trash2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useSuperTenants, useCompSeats, useUpsertLicense, type SuperTenantRow } from '@/hooks/use-api';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import { apiFetch } from '@/lib/api-client';

/**
 * Owner-only control panel. Lists every tenant across the platform,
 * grouped by industry vertical, with quick actions to comp seats or
 * apply a paid tier. SUPER_ADMIN only — gated client-side here AND
 * server-side via @RequireRoles on /api/v1/super/*.
 */
export default function SuperPage() {
  const router = useRouter();
  const user = useAppStore(s => s.user);
  const { data: tenants, isLoading } = useSuperTenants();
  const comp = useCompSeats();
  const upsert = useUpsertLicense();
  const [actingId, setActingId] = useState<string | null>(null);

  // HIGH-3 audit fix: deny-by-default with explicit hydration tracking.
  // The previous guard `if (user && user.role !== 'SUPER_ADMIN')` would
  // render the full admin panel during the hydration window where `user`
  // was still null. Combined with the API also returning data optimistically
  // it could leak a tenant list flash to non-owners. Now we wait one tick
  // for the store to hydrate, then deny unless the user is confirmed
  // SUPER_ADMIN. The API still enforces server-side via @RequireRoles —
  // this is just defense-in-depth at the page boundary.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-extrabold text-slate-900">Owner-only area</h1>
          <p className="text-sm text-slate-500 mt-1">This control panel is restricted to platform owners.</p>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg">Go back</button>
        </div>
      </div>
    );
  }

  // Phase B closeout — multi-tenant filter. Operator (2026-05-11):
  // "let me check on a group of locations but not all of them filtered
  // in." Two filter mechanisms, composable:
  //
  //   1. Search box — substring match against name / slug / vertical.
  //      Always applied first; narrows the visible set.
  //   2. Selected-only toggle — when the operator has picked specific
  //      tenants via checkbox, flipping the toggle restricts every
  //      summary stat AND every row to that explicit pick set.
  //
  // The selection persists in component state for the session. Could
  // be persisted to localStorage later but for now operators tend to
  // open this page focused on one task — a fresh page load resetting
  // the picks is the right default.
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setShowSelectedOnly(false);
  };

  const q = searchQuery.trim().toLowerCase();
  const visibleTenants = useMemo(() => {
    return (tenants ?? []).filter((t) => {
      if (showSelectedOnly && !selectedIds.has(t.id)) return false;
      if (q) {
        const hay = `${t.name} ${t.slug} ${t.vertical}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, q, showSelectedOnly, selectedIds]);

  // Group VISIBLE tenants by vertical so the table sections respect
  // the filter. Empty verticals don't render at all.
  const byVertical = visibleTenants.reduce((acc: Record<string, SuperTenantRow[]>, t) => {
    (acc[t.vertical] ??= []).push(t); return acc;
  }, {});

  // Stats roll up off the VISIBLE set so an operator narrowing to "my
  // 3 schools in Cleveland" sees those 3 tenants' aggregate online
  // count + MRR, not the whole platform's. The full-platform numbers
  // stay one toggle-off away.
  const totalSeats = visibleTenants.reduce((n, t) => n + t.seatsUsed, 0);
  const totalTenants = visibleTenants.length;
  const monthlyMrrCents = visibleTenants.reduce((n, t) => n + (t.monthlyPriceCents ?? 0) * (t.seatsUsed || 0), 0);
  const totalAvailable = tenants?.length ?? 0;
  const filterIsActive = showSelectedOnly || q.length > 0;

  const handleComp = async (t: SuperTenantRow) => {
    const seats = await appPrompt({
      title: `Comp seats for ${t.name}`,
      message: 'How many seats? (current: ' + t.seatLimit + ')',
      defaultValue: String(Math.max(t.seatLimit, t.seatsUsed + 5)),
    });
    if (!seats) return;
    const n = parseInt(seats, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setActingId(t.id);
    comp.mutate(
      { tenantId: t.id, seatLimit: n, tier: t.tier === 'PILOT' ? 'PILOT' : t.tier },
      { onSettled: () => setActingId(null) },
    );
  };

  const handleUpgrade = async (t: SuperTenantRow, tier: string) => {
    const seats = await appPrompt({
      title: `Apply ${tier} to ${t.name}`,
      message: 'Seat limit?',
      defaultValue: '25',
    });
    if (!seats) return;
    const n = parseInt(seats, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setActingId(t.id);
    upsert.mutate(
      { tenantId: t.id, tier, seatLimit: n, billingMode: 'INVOICE', status: 'ACTIVE' },
      { onSettled: () => setActingId(null) },
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Crown className="w-6 h-6 text-amber-500" /> Owner control panel
            </h1>
            <p className="text-sm text-slate-500 mt-1">Tenants, licenses, billing health.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Stat label="Tenants" value={String(totalTenants)} />
            <Stat label="Paired screens" value={String(totalSeats)} />
            {/* Phase B closeout — fleet health rollups across every
                tenant. Sums new server-side fields. Falls back to 0
                if an older API version hasn't surfaced them yet. */}
            <Stat
              label="Online now"
              value={String(visibleTenants.reduce((n, t) => n + (t.screensOnline ?? 0), 0))}
              accent
            />
            {(() => {
              const inEmergency = visibleTenants.filter(t => t.emergencyActive).length;
              return inEmergency > 0
                ? <Stat label="In emergency" value={String(inEmergency)} tone="alert" />
                : null;
            })()}
            {(() => {
              const incidents = visibleTenants.reduce((n, t) => n + (t.openIncidents24h ?? 0), 0);
              return incidents > 0
                ? <Stat label="Incidents 24h" value={String(incidents)} tone="warn" />
                : null;
            })()}
            {(() => {
              const inCanary = visibleTenants.filter(t => (t.canaryPercent ?? 100) < 100).length;
              return inCanary > 0
                ? <Stat label="In canary" value={String(inCanary)} tone="warn" />
                : null;
            })()}
            <Stat label="Approx MRR" value={`$${(monthlyMrrCents / 100).toFixed(0)}`} accent />
          </div>
        </header>

        {/* Phase B closeout — multi-tenant filter bar. Search +
            selected-only toggle + selection pills. The whole bar
            collapses to a single search box when no selection exists,
            so the page stays clean for the common "show me everything"
            case. */}
        {!isLoading && totalAvailable > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tenants by name, slug, or vertical…"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                />
              </div>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSelectedOnly((v) => !v)}
                  className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide rounded-lg flex items-center gap-1.5 transition-colors ${
                    showSelectedOnly
                      ? 'bg-indigo-600 text-white border border-indigo-600'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                  title="Show only the tenants you have checked"
                >
                  <Filter className="w-3.5 h-3.5" />
                  {showSelectedOnly ? 'Showing selected' : 'Show selected only'}
                  <span className="bg-white/30 px-1.5 py-0.5 rounded text-[10px]">{selectedIds.size}</span>
                </button>
              )}
              {(filterIsActive || selectedIds.size > 0) && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide rounded-lg bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
              <div className="text-[11px] text-slate-400 ml-auto">
                {filterIsActive ? (
                  <>Showing <span className="font-bold text-slate-700">{visibleTenants.length}</span> of {totalAvailable}</>
                ) : (
                  <>{totalAvailable} tenants</>
                )}
              </div>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(tenants ?? [])
                  .filter((t) => selectedIds.has(t.id))
                  .map((t) => (
                    <span
                      key={t.id}
                      className="text-[11px] font-bold inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-100"
                    >
                      {t.name}
                      <button
                        type="button"
                        onClick={() => toggleSelect(t.id)}
                        className="hover:bg-indigo-100 rounded-sm p-0.5"
                        aria-label={`Remove ${t.name} from selection`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
        ) : visibleTenants.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-600">No tenants match the current filter</p>
            <button onClick={clearSelection} className="text-xs text-indigo-600 hover:underline mt-2 font-semibold">Clear filters</button>
          </div>
        ) : (
          Object.entries(byVertical).sort(([a], [b]) => a.localeCompare(b)).map(([vertical, rows]) => (
            <section key={vertical} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-500" /> {vertical} <span className="text-slate-400 font-normal">({rows.length})</span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-widest">
                    <tr>
                      {/* Phase B closeout — selection column. Header
                          checkbox toggles every tenant in THIS vertical. */}
                      <th className="text-left px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={rows.every((t) => selectedIds.has(t.id))}
                          aria-label={`Select all ${vertical} tenants`}
                          onChange={(e) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) rows.forEach((t) => next.add(t.id));
                              else rows.forEach((t) => next.delete(t.id));
                              return next;
                            });
                          }}
                          className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="text-left px-4 py-2 font-bold">Tenant</th>
                      <th className="text-left px-4 py-2 font-bold">Tier</th>
                      <th className="text-left px-4 py-2 font-bold">Status</th>
                      <th className="text-left px-4 py-2 font-bold">Seats</th>
                      {/* Phase B closeout — fleet health columns. Sit
                          right next to Seats so the operator sees
                          billing utilization + live online status
                          side-by-side. */}
                      <th className="text-left px-4 py-2 font-bold">Online</th>
                      <th className="text-left px-4 py-2 font-bold">Health</th>
                      <th className="text-left px-4 py-2 font-bold">Billing</th>
                      <th className="text-left px-4 py-2 font-bold">Expires</th>
                      <th className="text-right px-4 py-2 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(t => (
                      <tr key={t.id} className={`border-t border-slate-100 hover:bg-slate-50 ${selectedIds.has(t.id) ? 'bg-indigo-50/40' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            aria-label={`Select ${t.name}`}
                            className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-bold text-slate-800">{t.name}</div>
                          <div className="text-[11px] text-slate-400">{t.slug}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-bold text-slate-700">{t.tier}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            t.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700'
                              : t.status === 'PAST_DUE' ? 'bg-amber-50 text-amber-800'
                              : 'bg-rose-50 text-rose-700'
                          }`}>{t.status}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono">
                          <span className={t.atLimit ? 'text-rose-700 font-bold' : 'text-slate-700 font-bold'}>{t.seatsUsed}</span>
                          <span className="text-slate-400"> / {t.seatLimit}</span>
                          {t.atLimit && <span className="text-[10px] text-rose-600 font-bold ml-2">FULL</span>}
                        </td>
                        {/* Phase B closeout — Online column: live count vs
                            paired count. Green when ALL paired screens are
                            up; amber when partial; rose when none are
                            reporting. This is "fleet uptime at a glance." */}
                        <td className="px-4 py-2.5 font-mono">
                          {(() => {
                            const online = t.screensOnline ?? 0;
                            const paired = t.seatsUsed;
                            const tone = paired === 0
                              ? 'text-slate-400'
                              : online === paired
                                ? 'text-emerald-700 font-bold'
                                : online === 0
                                  ? 'text-rose-700 font-bold'
                                  : 'text-amber-700 font-bold';
                            return (
                              <span className={tone}>
                                {online}<span className="text-slate-400 font-normal"> / {paired}</span>
                              </span>
                            );
                          })()}
                        </td>
                        {/* Phase B closeout — Health column: stacks the
                            three operator-actionable signals (emergency,
                            canary, recent incidents) into a single cell of
                            tiny chips. Empty = healthy. */}
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1 items-center">
                            {t.emergencyActive && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700" title="Tenant is in an active emergency override">
                                🚨 emergency
                              </span>
                            )}
                            {(t.canaryPercent ?? 100) < 100 && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title={`Staged rollout — ${t.canaryPercent}% cohort eligible for the latest APK`}>
                                ⚙️ canary {t.canaryPercent}%
                              </span>
                            )}
                            {(t.openIncidents24h ?? 0) > 0 && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title={`${t.openIncidents24h} INFRA_EVENT notification(s) in the last 24h`}>
                                ⚠️ {t.openIncidents24h} incident{t.openIncidents24h === 1 ? '' : 's'}
                              </span>
                            )}
                            {!t.emergencyActive && (t.canaryPercent ?? 100) >= 100 && !(t.openIncidents24h ?? 0) && (
                              <span className="text-[9px] text-slate-300">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{t.billingMode}</td>
                        <td className="px-4 py-2.5 text-slate-600">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          {actingId === t.id ? (
                            <Loader2 className="w-4 h-4 animate-spin inline text-slate-400" />
                          ) : (
                            <div className="inline-flex gap-1">
                              <button onClick={() => handleComp(t)} className="px-2.5 py-1 text-[11px] font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-700">Comp seats</button>
                              <button onClick={() => handleUpgrade(t, 'STANDARD')} className="px-2.5 py-1 text-[11px] font-bold rounded bg-indigo-600 hover:bg-indigo-700 text-white">Standard</button>
                              <button onClick={() => handleUpgrade(t, 'ENTERPRISE')} className="px-2.5 py-1 text-[11px] font-bold rounded bg-violet-600 hover:bg-violet-700 text-white">Enterprise</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}

        {/* Storage Admin — added 2026-05-23 launch audit P1 #9.
            Surfaces the three POST/GET endpoints on
            /api/v1/super/storage/* so the operator never has to drop
            to curl to recover from a Supabase egress regression. */}
        <StorageAdmin />
      </div>
    </div>
  );
}

/**
 * Storage Admin panel (SUPER_ADMIN only).
 *
 * Renders three operator controls:
 *   1. Audit cache-control: GET /super/storage/cache-control-audit —
 *      samples 50 objects and reports any with missing immutable header.
 *   2. Backfill cache-control: POST /super/storage/backfill-cache-control —
 *      idempotent SQL UPDATE on storage.objects.metadata. Zero re-upload.
 *   3. Wipe all assets: POST /super/storage/wipe-all-assets — destroys
 *      every Asset row, every PlaylistItem, every Supabase storage
 *      object. Double-confirmation (browser confirm + typed sentinel
 *      string) because this is irreversible.
 */
function StorageAdmin() {
  const [auditResult, setAuditResult] = useState<any>(null);
  const [busy, setBusy] = useState<'audit' | 'backfill' | 'wipe' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = async () => {
    setBusy('audit');
    setError(null);
    try {
      const res = await apiFetch<any>('/super/storage/cache-control-audit');
      setAuditResult({ kind: 'audit', data: res });
    } catch (e: any) {
      setError(e?.message || 'Audit failed.');
    } finally {
      setBusy(null);
    }
  };

  const runBackfill = async () => {
    const ok = await appConfirm({
      title: 'Backfill Cache-Control?',
      message:
        'This patches metadata.cacheControl on every object in the assets bucket that is missing the immutable header. Zero re-upload, single SQL UPDATE. Safe to re-run.',
      confirmLabel: 'Run backfill',
    });
    if (!ok) return;
    setBusy('backfill');
    setError(null);
    try {
      const res = await apiFetch<any>('/super/storage/backfill-cache-control', { method: 'POST' });
      setAuditResult({ kind: 'backfill', data: res });
    } catch (e: any) {
      setError(e?.message || 'Backfill failed.');
    } finally {
      setBusy(null);
    }
  };

  const runWipe = async () => {
    // Two-step confirmation. Step 1: the universal "are you sure"
    // dialog. Step 2: typed sentinel string — operator must literally
    // type WIPE to proceed. Mirrors the server-side
    // { confirm: 'YES_WIPE_ALL_ASSETS' } token.
    const ok = await appConfirm({
      title: 'Wipe ALL assets across every tenant?',
      message:
        'This deletes EVERY Asset row, EVERY PlaylistItem, and EVERY object in the Supabase assets bucket. Playlists / schedules / screens stay intact (just empty). IRREVERSIBLE.',
      confirmLabel: 'Continue',
      tone: 'danger',
    });
    if (!ok) return;
    const typed = await appPrompt({
      title: 'Type WIPE to confirm',
      message: 'You are about to wipe every asset across the platform. Type the word WIPE (uppercase) to proceed.',
      placeholder: 'WIPE',
    });
    if (typed?.trim() !== 'WIPE') return;
    setBusy('wipe');
    setError(null);
    try {
      const res = await apiFetch<any>('/super/storage/wipe-all-assets', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'YES_WIPE_ALL_ASSETS' }),
      });
      setAuditResult({ kind: 'wipe', data: res });
    } catch (e: any) {
      setError(e?.message || 'Wipe failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-8 bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-slate-500" />
        <h2 className="text-sm font-extrabold text-slate-800">Storage Admin</h2>
        <span className="text-[10px] text-slate-400 ml-2">Supabase assets bucket — egress / cache control / clean slate</span>
      </div>
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={runAudit}
          disabled={busy !== null}
          className="flex flex-col items-start gap-1 p-4 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 rounded-xl text-left transition-colors disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            {busy === 'audit' ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
            <span className="text-sm font-bold text-slate-800">Audit Cache-Control</span>
          </div>
          <span className="text-[11px] text-slate-500">Sample 50 random assets and verify each one carries the immutable header.</span>
        </button>

        <button
          type="button"
          onClick={runBackfill}
          disabled={busy !== null}
          className="flex flex-col items-start gap-1 p-4 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 rounded-xl text-left transition-colors disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            {busy === 'backfill' ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <RefreshCw className="w-4 h-4 text-emerald-600" />}
            <span className="text-sm font-bold text-slate-800">Backfill Cache-Control</span>
          </div>
          <span className="text-[11px] text-slate-500">Patch storage.objects.metadata so pre-fix assets serve as immutable. Idempotent.</span>
        </button>

        <button
          type="button"
          onClick={runWipe}
          disabled={busy !== null}
          className="flex flex-col items-start gap-1 p-4 border border-rose-200 hover:border-rose-400 hover:bg-rose-50 rounded-xl text-left transition-colors disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            {busy === 'wipe' ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Trash2 className="w-4 h-4 text-rose-600" />}
            <span className="text-sm font-bold text-rose-700">Wipe ALL Assets</span>
          </div>
          <span className="text-[11px] text-rose-600/80">Irreversible. Deletes every asset + every Supabase storage object. Pre-launch clean slate.</span>
        </button>
      </div>

      {(auditResult || error) && (
        <div className="px-5 pb-5">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              <div className="font-bold mb-0.5">Action failed</div>
              <div>{error}</div>
            </div>
          )}
          {auditResult && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                {auditResult.kind === 'audit' ? 'Audit result' : auditResult.kind === 'backfill' ? 'Backfill result' : 'Wipe result'}
              </div>
              <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                {JSON.stringify(auditResult.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, accent = false, tone }: { label: string; value: string; accent?: boolean; tone?: 'warn' | 'alert' }) {
  // Phase B closeout — added `tone` for the new fleet-health pills
  // (canary, incidents, emergency). Preserves the existing `accent`
  // prop so the MRR + Online-now tiles keep their emerald look.
  const palette = tone === 'alert'
    ? { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' }
    : tone === 'warn'
      ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' }
      : accent
        ? { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' }
        : { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900' };
  return (
    <div className={`px-4 py-2.5 rounded-xl border ${palette.bg} ${palette.border} shadow-sm`}>
      <div className={`text-lg font-extrabold ${palette.text}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{label}</div>
    </div>
  );
}
