"use client";

/**
 * FleetRollup — the HQ ("Corporate") top-level roll-up of every child
 * location's screens onto ONE map + a per-store list. Consumes
 * GET /screens/fleet (self + direct children, read-only).
 *
 * Manager-console pattern (Google MCC / AWS Orgs / NinjaOne): the overview
 * spans the whole chain, but every ACTION happens in the owning store's
 * isolated context. Clicking a store (or any of its screens) switches the
 * active tenant INTO that store via useTenantSwitch and deep-links to its
 * /screens page — children stay sealed from each other; only the read spans.
 *
 * Rendered only for a parent tenant (locations.length > 1). A leaf location
 * never mounts this — its normal Screens page is unchanged.
 *
 * Dashboard surface (not player/widget) → CSS `inset`/`gap` are fine here.
 */

import { useMemo } from 'react';
import { Wifi, WifiOff, ChevronRight, Building2, MapPin, Loader2, Monitor } from 'lucide-react';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import type { FleetResponse } from '@/hooks/use-api';

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-2xl font-black ${tone === 'warn' ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function FleetRollup({ fleet }: { fleet: FleetResponse }) {
  const { switchToTenant, switchingId } = useTenantSwitch();
  const rootId = fleet.root?.id;

  // Map wants the same shape the per-tenant Fleet map uses; the API already
  // hydrated effective coords (screen pin → building address fallback).
  const mapScreens = useMemo(
    () =>
      fleet.screens.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        latitude: s.effectiveLatitude,
        longitude: s.effectiveLongitude,
        address: s.effectiveAddress,
        geoSource: s.geoSource,
        lastPingAt: s.lastPingAt,
        lastCacheReport: s.lastCacheReport,
      })),
    [fleet.screens],
  );

  // Group screens under each store, preserving HQ-first then alphabetical.
  // Drop the root if it owns no screens of its own (Corporate is the lens).
  const byStore = useMemo(() => {
    const m = new Map<string, { meta: { id: string; name: string; slug: string }; screens: FleetResponse['screens'] }>();
    for (const loc of fleet.locations) m.set(loc.id, { meta: loc, screens: [] });
    for (const s of fleet.screens) {
      if (!s.sourceTenant) continue;
      const e = m.get(s.sourceTenant.id);
      if (e) e.screens.push(s);
    }
    return Array.from(m.values())
      .filter((e) => e.meta.id !== rootId || e.screens.length > 0)
      .sort((a, b) =>
        a.meta.id === rootId ? -1 : b.meta.id === rootId ? 1 : a.meta.name.localeCompare(b.meta.name),
      );
  }, [fleet.locations, fleet.screens, rootId]);

  const enter = (store: { id: string; slug: string }) =>
    switchToTenant({ id: store.id, slug: store.slug }, `/${store.slug}/screens`);

  const { total, online, offline, locationCount } = fleet.stats;
  const storeCount = locationCount > 1 ? locationCount - 1 : locationCount;

  return (
    <div className="space-y-4">
      {/* Header + stats strip */}
      <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-5 h-5" style={{ color: 'var(--brand-primary, #4f46e5)' }} />
          <h2 className="text-base font-black text-slate-800">{fleet.root?.name || 'Corporate'} — fleet overview</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Locations" value={storeCount} sub={storeCount === 1 ? 'store' : 'stores'} />
          <Stat label="Screens" value={total} sub="across the fleet" />
          <Stat label="Online" value={online} sub={`${offline} offline`} tone={offline > 0 ? 'warn' : 'ok'} />
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Read-only HQ view across every location. <strong className="text-slate-700">Click a store to manage its screens</strong> — you&rsquo;ll
          switch into that location&rsquo;s own dashboard, where every action stays scoped to that store.
        </p>
      </div>

      {/* All locations on the map */}
      <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <MapPin className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} /> All locations on the map
        </h3>
        <ScreenMapClient screens={mapScreens} />
      </div>

      {/* Per-store list */}
      <div className="space-y-3">
        {byStore.map(({ meta, screens }) => {
          const on = screens.filter((s) => s.status === 'ONLINE').length;
          const off = screens.length - on;
          const isRoot = meta.id === rootId;
          const switching = switchingId === meta.id;
          return (
            <div key={meta.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <button
                onClick={() => enter(meta)}
                disabled={switching}
                className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-left disabled:opacity-60"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black shrink-0"
                  style={{ background: 'var(--brand-primary, #4f46e5)' }}
                >
                  {meta.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 truncate">
                    {meta.name}
                    {isRoot && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">HQ</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <Monitor className="w-3 h-3" /> {screens.length} screen{screens.length === 1 ? '' : 's'}
                    {screens.length > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-emerald-600 inline-flex items-center gap-0.5">
                          <Wifi className="w-3 h-3" />
                          {on}
                        </span>
                        {off > 0 && (
                          <span className="text-rose-500 inline-flex items-center gap-0.5">
                            <WifiOff className="w-3 h-3" />
                            {off}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {switching ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                ) : (
                  <span className="text-xs font-bold text-slate-400 inline-flex items-center gap-1 shrink-0">
                    Manage <ChevronRight className="w-4 h-4" />
                  </span>
                )}
              </button>
              {screens.length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                  {screens.map((s) => (
                    <span
                      key={s.id}
                      className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                        s.status === 'ONLINE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${s.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      />
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
