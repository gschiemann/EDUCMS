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
 * Phase 2a: cross-store search + status filter + offline-first triage sort,
 * so an HQ admin scanning 150 screens can instantly answer "what's down and
 * where?". Filtering is client-side over the already-fetched fleet and drives
 * BOTH the map and the list.
 *
 * Rendered only for a parent tenant (locations.length > 1). A leaf location
 * never mounts this — its normal Screens page is unchanged.
 *
 * Dashboard surface (not player/widget) → CSS `inset`/`gap` are fine here.
 */

import { useMemo, useState } from 'react';
import { Wifi, WifiOff, ChevronRight, Building2, MapPin, Loader2, Monitor, Search, X } from 'lucide-react';
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

type StatusFilter = 'all' | 'online' | 'offline';

export function FleetRollup({ fleet }: { fleet: FleetResponse }) {
  const { switchToTenant, switchingId } = useTenantSwitch();
  const rootId = fleet.root?.id;

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const norm = q.trim().toLowerCase();
  const filtering = statusFilter !== 'all' || norm.length > 0;

  const total = fleet.screens.length;
  const onlineCount = useMemo(() => fleet.screens.filter((s) => s.status === 'ONLINE').length, [fleet.screens]);
  const offlineCount = total - onlineCount;

  // Cross-store search + status filter — drives both the map and the list.
  const filtered = useMemo(() => {
    return fleet.screens.filter((s) => {
      const isOnline = s.status === 'ONLINE';
      if (statusFilter === 'online' && !isOnline) return false;
      if (statusFilter === 'offline' && isOnline) return false;
      if (!norm) return true;
      const store = s.sourceTenant?.name?.toLowerCase() || '';
      return s.name.toLowerCase().includes(norm) || store.includes(norm);
    });
  }, [fleet.screens, statusFilter, norm]);

  const mapScreens = useMemo(
    () =>
      filtered.map((s) => ({
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
    [filtered],
  );

  // Group filtered screens under each store. When NOT filtering, seed every
  // location so 0-screen stores still show; when filtering, only stores with
  // matching screens appear. Sort: HQ first, then most-offline first (triage),
  // then alphabetical.
  const byStore = useMemo(() => {
    const m = new Map<string, { meta: { id: string; name: string; slug: string }; screens: FleetResponse['screens'] }>();
    if (!filtering) for (const loc of fleet.locations) m.set(loc.id, { meta: loc, screens: [] });
    for (const s of filtered) {
      if (!s.sourceTenant) continue;
      if (!m.has(s.sourceTenant.id)) m.set(s.sourceTenant.id, { meta: s.sourceTenant, screens: [] });
      m.get(s.sourceTenant.id)!.screens.push(s);
    }
    return Array.from(m.values())
      .filter((e) => e.meta.id !== rootId || e.screens.length > 0)
      .sort((a, b) => {
        if (a.meta.id === rootId) return -1;
        if (b.meta.id === rootId) return 1;
        const aOff = a.screens.filter((s) => s.status !== 'ONLINE').length;
        const bOff = b.screens.filter((s) => s.status !== 'ONLINE').length;
        if (bOff !== aOff) return bOff - aOff;
        return a.meta.name.localeCompare(b.meta.name);
      });
  }, [filtered, fleet.locations, rootId, filtering]);

  const enter = (store: { id: string; slug: string }) =>
    switchToTenant({ id: store.id, slug: store.slug }, `/${store.slug}/screens`);

  const storeCount = fleet.stats.locationCount > 1 ? fleet.stats.locationCount - 1 : fleet.stats.locationCount;

  const chipBase =
    'px-3 py-1.5 text-xs font-bold rounded-lg border inline-flex items-center gap-1.5 transition-colors';
  const Chip = ({ k, label, count }: { k: StatusFilter; label: string; count: number }) => {
    const active = statusFilter === k;
    return (
      <button
        onClick={() => setStatusFilter(k)}
        className={chipBase + ' ' + (active ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}
        style={active ? { background: 'var(--brand-primary, #4f46e5)' } : undefined}
      >
        {label}
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
      </button>
    );
  };

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
          <Stat label="Online" value={onlineCount} sub={`${offlineCount} offline`} tone={offlineCount > 0 ? 'warn' : 'ok'} />
        </div>
      </div>

      {/* Search + status filter (drives map + list) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search screens or stores…"
            className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-slate-400 bg-white"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Chip k="all" label="All" count={total} />
          <Chip k="online" label="Online" count={onlineCount} />
          <Chip k="offline" label="Offline" count={offlineCount} />
        </div>
      </div>
      {filtering && (
        <div className="text-xs text-slate-500 -mt-1 px-1">
          Showing {filtered.length} of {total} screens{norm ? ` matching “${q.trim()}”` : ''}
          {statusFilter !== 'all' ? ` · ${statusFilter}` : ''}.
        </div>
      )}

      {/* All locations on the map (filtered) */}
      <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <MapPin className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} /> All locations on the map
        </h3>
        <ScreenMapClient screens={mapScreens} />
      </div>

      {/* Per-store list (filtered + triage-sorted) */}
      {byStore.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          No screens match{norm ? ` “${q.trim()}”` : ''}{statusFilter !== 'all' ? ` in “${statusFilter}”` : ''}. Try a different search or filter.
        </div>
      ) : (
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
                      {isRoot && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">HQ</span>}
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
                        <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
