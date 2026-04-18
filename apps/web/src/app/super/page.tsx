"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Crown, Building2, AlertCircle, Plus } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useSuperTenants, useCompSeats, useUpsertLicense, type SuperTenantRow } from '@/hooks/use-api';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';

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

  // Group tenants by vertical for the overview.
  const byVertical = (tenants ?? []).reduce((acc: Record<string, SuperTenantRow[]>, t) => {
    (acc[t.vertical] ??= []).push(t); return acc;
  }, {});

  const totalSeats = (tenants ?? []).reduce((n, t) => n + t.seatsUsed, 0);
  const totalTenants = tenants?.length ?? 0;
  const monthlyMrrCents = (tenants ?? []).reduce((n, t) => n + (t.monthlyPriceCents ?? 0) * (t.seatsUsed || 0), 0);

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
          <div className="flex items-center gap-3">
            <Stat label="Tenants" value={String(totalTenants)} />
            <Stat label="Paired screens" value={String(totalSeats)} />
            <Stat label="Approx MRR" value={`$${(monthlyMrrCents / 100).toFixed(0)}`} accent />
          </div>
        </header>

        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
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
                      <th className="text-left px-4 py-2 font-bold">Tenant</th>
                      <th className="text-left px-4 py-2 font-bold">Tier</th>
                      <th className="text-left px-4 py-2 font-bold">Status</th>
                      <th className="text-left px-4 py-2 font-bold">Seats</th>
                      <th className="text-left px-4 py-2 font-bold">Billing</th>
                      <th className="text-left px-4 py-2 font-bold">Expires</th>
                      <th className="text-right px-4 py-2 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(t => (
                      <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
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
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`px-4 py-2.5 rounded-xl border ${accent ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'} shadow-sm`}>
      <div className={`text-lg font-extrabold ${accent ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{label}</div>
    </div>
  );
}
