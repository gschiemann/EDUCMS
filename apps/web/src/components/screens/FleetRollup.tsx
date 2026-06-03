"use client";

/**
 * FleetRollup — the HQ ("Corporate") top-level command center: every child
 * location's screens on ONE map next to a State → Location tree. Consumes
 * GET /screens/fleet (self + direct children, read-only).
 *
 * Manager-console pattern (Google MCC / AWS Orgs / NinjaOne): the overview
 * spans the whole chain, but every ACTION happens in the owning store's
 * isolated context. "Manage this location" switches the active tenant INTO
 * that store via useTenantSwitch and deep-links to its /screens page.
 *
 * 2026-06-03 — rolled the flat 50-location list up into a State → Location
 * tree (operator: "the location list is crazy long … roll these up to State,
 * then location chevrons"). One list (the tree), not a list + a duplicate
 * "Manage" cards strip. Click a location to expand it inline: its screen
 * statuses + a Manage button, right there — no separate cards section. The map
 * renders beside the tree with its own rail hidden (renderSidebar={false}).
 *
 * Rendered only for a parent tenant (locations.length > 1). A leaf location
 * never mounts this — its normal Screens page is unchanged.
 *
 * Dashboard surface (not player/widget) → CSS `inset`/`gap` are fine here.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Building2, Loader2, Search, X } from 'lucide-react';
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

/** Best-effort US state from a "Street, City, ST ZIP" address. Falls back to
 *  "Other" so unparseable rows still group somewhere. */
function parseState(addr?: string | null): string {
  if (!addr) return 'Other';
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return 'Other';
  const last = parts[parts.length - 1]; // "NY" or "NY 10001"
  const tok = last.split(/\s+/)[0] || '';
  if (tok.length === 2 && /^[A-Za-z]{2}$/.test(tok)) return tok.toUpperCase();
  return last || 'Other';
}

type StatusFilter = 'all' | 'online' | 'offline';

export function FleetRollup({ fleet }: { fleet: FleetResponse }) {
  const { switchToTenant, switchingId } = useTenantSwitch();
  const rootId = fleet.root?.id;

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());
  const [expandedLoc, setExpandedLoc] = useState<string | null>(null);
  const norm = q.trim().toLowerCase();
  const filtering = statusFilter !== 'all' || norm.length > 0;

  const total = fleet.screens.length;
  const onlineCount = useMemo(() => fleet.screens.filter((s) => s.status === 'ONLINE').length, [fleet.screens]);
  const offlineCount = total - onlineCount;

  // Cross-store search + status filter — drives both the map and the tree.
  const filtered = useMemo(() => {
    return fleet.screens.filter((s) => {
      const isOnline = s.status === 'ONLINE';
      if (statusFilter === 'online' && !isOnline) return false;
      if (statusFilter === 'offline' && isOnline) return false;
      if (!norm) return true;
      const store = s.sourceTenant?.name?.toLowerCase() || '';
      const addr = s.effectiveAddress?.toLowerCase() || '';
      return s.name.toLowerCase().includes(norm) || store.includes(norm) || addr.includes(norm);
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

  // Group filtered screens under each store (location). Skip HQ itself (root,
  // no direct screens). Each entry carries a representative address for the
  // State roll-up + the per-location detail.
  const byStore = useMemo(() => {
    const m = new Map<string, { meta: { id: string; name: string; slug: string }; address: string | null; screens: FleetResponse['screens'] }>();
    if (!filtering) for (const loc of fleet.locations) if (loc.id !== rootId) m.set(loc.id, { meta: loc, address: null, screens: [] });
    for (const s of filtered) {
      if (!s.sourceTenant || s.sourceTenant.id === rootId) continue;
      if (!m.has(s.sourceTenant.id)) m.set(s.sourceTenant.id, { meta: s.sourceTenant, address: null, screens: [] });
      const e = m.get(s.sourceTenant.id)!;
      e.screens.push(s);
      if (!e.address && s.effectiveAddress) e.address = s.effectiveAddress;
    }
    return Array.from(m.values());
  }, [filtered, fleet.locations, rootId, filtering]);

  // Roll up into State → Location.
  const tree = useMemo(() => {
    const byState = new Map<string, typeof byStore>();
    for (const e of byStore) {
      const st = parseState(e.address);
      if (!byState.has(st)) byState.set(st, []);
      byState.get(st)!.push(e);
    }
    return Array.from(byState.entries())
      .map(([state, stores]) => ({
        state,
        stores: stores.slice().sort((a, b) => a.meta.name.localeCompare(b.meta.name)),
        off: stores.reduce((n, s) => n + s.screens.filter((x) => x.status !== 'ONLINE').length, 0),
      }))
      .sort((a, b) => (a.state === 'Other' ? 1 : b.state === 'Other' ? -1 : a.state.localeCompare(b.state)));
  }, [byStore]);

  const enter = (store: { id: string; slug: string }) =>
    switchToTenant({ id: store.id, slug: store.slug }, `/${store.slug}/screens`);
  const toggleState = (s: string) =>
    setExpandedStates((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  const storeCount = fleet.stats.locationCount > 1 ? fleet.stats.locationCount - 1 : fleet.stats.locationCount;

  const chipBase = 'px-3 py-1.5 text-xs font-bold rounded-lg border inline-flex items-center gap-1.5 transition-colors';
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

      {/* Search + status filter (drives tree + map) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by location, address, or screen…"
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

      {/* Command center: State → Location tree (left) + map (right) */}
      <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4">
          {/* Tree */}
          <div className="rounded-2xl border border-slate-200 flex flex-col overflow-hidden max-h-[440px] lg:max-h-none lg:h-[600px]">
            <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Building2 className="w-3.5 h-3.5" aria-hidden /> Locations
              </span>
              <span className="text-[11px] font-mono text-slate-400">{filtering ? `${byStore.length}/${storeCount}` : storeCount}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {tree.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-slate-400">
                  No locations match{norm ? ` “${q.trim()}”` : ''}{statusFilter !== 'all' ? ` in “${statusFilter}”` : ''}.
                </div>
              ) : (
                tree.map((grp) => {
                  const open = expandedStates.has(grp.state) || filtering;
                  return (
                    <div key={grp.state} className="border-b border-slate-100 last:border-b-0">
                      {/* State row */}
                      <button
                        onClick={() => toggleState(grp.state)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
                      >
                        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                        <span className="font-bold text-slate-700 text-sm">{grp.state}</span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {grp.off > 0 && <span className="text-[10px] font-bold text-rose-500">{grp.off} down</span>}
                          <span className="text-[11px] font-medium text-slate-400">{grp.stores.length}</span>
                        </span>
                      </button>
                      {/* Locations under the state */}
                      {open &&
                        grp.stores.map((st) => {
                          const on = st.screens.filter((s) => s.status === 'ONLINE').length;
                          const off = st.screens.length - on;
                          const exp = expandedLoc === st.meta.id;
                          const switching = switchingId === st.meta.id;
                          return (
                            <div key={st.meta.id} className="border-t border-slate-50 bg-slate-50/30">
                              <button
                                onClick={() => setExpandedLoc((cur) => (cur === st.meta.id ? null : st.meta.id))}
                                className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-left transition-colors ${exp ? 'bg-indigo-50/60' : 'hover:bg-white'}`}
                              >
                                {exp ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                                <span className={`w-2 h-2 rounded-full shrink-0 ${off > 0 ? 'bg-rose-400' : 'bg-emerald-500'}`} />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs font-semibold text-slate-700 truncate">{st.meta.name}</span>
                                  {st.address && <span className="block text-[10px] text-slate-400 truncate">{st.address}</span>}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 shrink-0">{on}/{st.screens.length}</span>
                              </button>
                              {/* Inline detail — screens + Manage, right here */}
                              {exp && (
                                <div className="pl-8 pr-3 pb-3 space-y-2.5">
                                  {st.screens.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {st.screens.map((s) => (
                                        <span
                                          key={s.id}
                                          className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                                            s.status === 'ONLINE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'
                                          }`}
                                        >
                                          <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                          {s.name}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-slate-400">No screens paired yet.</div>
                                  )}
                                  <button
                                    onClick={() => enter(st.meta)}
                                    disabled={!!switchingId}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow-sm disabled:opacity-60 disabled:cursor-wait transition-opacity"
                                    style={{ background: 'var(--brand-primary, #4f46e5)' }}
                                  >
                                    {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                    Manage this location <ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Map (rail hidden — the tree is the list) */}
          <div className="rounded-2xl overflow-hidden border border-slate-200 min-h-[300px]">
            <ScreenMapClient screens={mapScreens} renderSidebar={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
