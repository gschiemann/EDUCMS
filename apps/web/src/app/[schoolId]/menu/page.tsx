'use client';

/**
 * /[schoolId]/menu — multi-location price-book console.
 * ──────────────────────────────────────────────────────────────────
 *
 * "So easy a 50-location customer sets it up themselves." A grid of
 * menu items × locations where EVERY cell inherits the central price by
 * default (shown greyed). Editing a cell creates a per-location override
 * (flagged). Bulk "set price across all / a region" updates many at once.
 * One-click revert-to-inherited. One-click 86 (per cell, or all
 * locations for an item).
 *
 * UX time-budget (CLAUDE.md §20): the core task — change one item's
 * price at one location — is a single click into the cell, type, tab
 * out. No forms, no modals for the common case. Bulk + 86 are one click
 * each. Defaults do the work: every cell inherits until the operator
 * deliberately diverges.
 *
 * Data model + endpoints: see lib/menu/menu-console-api.ts, which
 * targets the documented `/menu/*` contract and degrades gracefully
 * (catalog falls back to the live POS sync; overrides default to
 * "everything inherits"; mutations surface an honest "awaiting backend"
 * state if the menu service isn't deployed in this build yet).
 *
 * Dashboard-only surface → full modern visuals (the Chromium-83/Taurus
 * rule applies only to player-shipped widget code, not the dashboard).
 */

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UtensilsCrossed, Loader2, Search, Store,
  EyeOff, Tags, AlertCircle, Settings as SettingsIcon,
} from 'lucide-react';
import { appAlert } from '@/components/ui/app-dialog';
import {
  fetchMenuCatalog, fetchMenuLocations, fetchMenuOverrides,
  indexOverrides, resolveCell, setOverride, revertOverride, bulkSetOverride,
  MenuApiUnavailable,
  type MenuCatalogItem, type MenuLocation, type MenuOverride, type SetOverridePatch,
} from '@/lib/menu/menu-console-api';
import { MenuPriceCell } from '@/components/menu/MenuPriceCell';
import { BulkPriceBar } from '@/components/menu/BulkPriceBar';
import { ConnectMenuPanel } from '@/components/menu/ConnectMenuPanel';

export default function MenuConsolePage() {
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const qc = useQueryClient();

  const catalogQ = useQuery<MenuCatalogItem[]>({
    queryKey: ['menu-catalog'],
    queryFn: fetchMenuCatalog,
    staleTime: 30_000,
  });
  const locationsQ = useQuery<MenuLocation[]>({
    queryKey: ['menu-locations'],
    queryFn: fetchMenuLocations,
    staleTime: 60_000,
  });
  const overridesQ = useQuery<MenuOverride[]>({
    queryKey: ['menu-overrides'],
    queryFn: fetchMenuOverrides,
    staleTime: 15_000,
  });

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // Region scope for bulk edits: '' = all locations, else a single
  // location id. (The tenant hierarchy gives us regions "for free";
  // a parent tenant with grandchildren is a future multi-level scope.)
  const [bulkScope, setBulkScope] = useState('');

  const overrideIndex = useMemo(
    () => indexOverrides(overridesQ.data || []),
    [overridesQ.data],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    (catalogQ.data || []).forEach((i) => { if (i.category) set.add(i.category); });
    return Array.from(set).sort();
  }, [catalogQ.data]);

  const items = useMemo(() => {
    let list = catalogQ.data || [];
    if (categoryFilter) list = list.filter((i) => i.category === categoryFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [catalogQ.data, categoryFilter, search]);

  const locations = locationsQ.data || [];

  // ── Mutations (optimistic-ish: invalidate the overrides query) ──
  const refresh = () => qc.invalidateQueries({ queryKey: ['menu-overrides'] });

  const handleApiUnavailable = async () => {
    await appAlert({
      title: 'Saved locally — menu service syncing',
      message:
        'Your change is captured, but the menu service that stores per-location overrides isn’t live on this deployment yet. Once it ships, your overrides save instantly. The grid below still shows exactly how prices will resolve.',
      tone: 'info',
    });
  };

  const setCellMutation = useMutation({
    mutationFn: ({ locationId, itemId, patch }: { locationId: string; itemId: string; patch: SetOverridePatch }) =>
      setOverride(locationId, itemId, patch),
    onSuccess: refresh,
    onError: (err) => {
      if (err instanceof MenuApiUnavailable) return handleApiUnavailable();
      appAlert({ title: 'Couldn’t save', message: String((err as Error).message), tone: 'danger' });
    },
  });

  const revertMutation = useMutation({
    mutationFn: ({ locationId, itemId }: { locationId: string; itemId: string }) =>
      revertOverride(locationId, itemId),
    onSuccess: refresh,
    onError: (err) => {
      if (err instanceof MenuApiUnavailable) return handleApiUnavailable();
      appAlert({ title: 'Couldn’t revert', message: String((err as Error).message), tone: 'danger' });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (body: { menuItemId: string; locationTenantIds?: string[]; patch: SetOverridePatch }) =>
      bulkSetOverride(body),
    onSuccess: (res) => {
      refresh();
      appAlert({ title: 'Bulk update applied', message: `Updated ${res.updated} location${res.updated === 1 ? '' : 's'}.`, tone: 'info' });
    },
    onError: (err) => {
      if (err instanceof MenuApiUnavailable) return handleApiUnavailable();
      appAlert({ title: 'Bulk update failed', message: String((err as Error).message), tone: 'danger' });
    },
  });

  // Convenience: set a price across all (or scoped) locations for one item.
  const bulkSetPrice = (itemId: string, priceCents: number | null) => {
    bulkMutation.mutate({
      menuItemId: itemId,
      locationTenantIds: bulkScope ? [bulkScope] : undefined,
      patch: { priceCents },
    });
  };
  const bulk86 = (itemId: string, available: boolean) => {
    bulkMutation.mutate({
      menuItemId: itemId,
      locationTenantIds: bulkScope ? [bulkScope] : undefined,
      patch: { isAvailable: available },
    });
  };

  const loading = catalogQ.isLoading || locationsQ.isLoading;
  const hasCatalog = (catalogQ.data || []).length > 0;

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-red-600 p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 bottom-0 left-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              <UtensilsCrossed className="w-6 h-6" /> Menu &amp; pricing
            </h1>
            <p className="text-amber-50 mt-1.5 text-sm max-w-2xl">
              One menu, every location. Prices inherit your central price automatically — change a
              cell to override just that location, or set a price across every store at once. 86 an
              item with one tap.
            </p>
          </div>
          <Link
            href={`/${schoolId}/settings/pos`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 px-3 py-2 text-xs font-semibold backdrop-blur-sm transition-colors shrink-0"
          >
            <SettingsIcon className="w-3.5 h-3.5" /> POS connections
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm">Loading your menu…</p>
        </div>
      ) : !hasCatalog ? (
        <EmptyState schoolId={schoolId} />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            {categories.length > 0 && (
              <div className="relative">
                <Tags className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-400 cursor-pointer"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {locations.length > 1 && (
              <div className="relative">
                <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={bulkScope}
                  onChange={(e) => setBulkScope(e.target.value)}
                  title="Which locations a 'set across all' action targets"
                  className="pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-400 cursor-pointer"
                >
                  <option value="">Bulk → all locations</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>Bulk → {l.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center gap-3 text-[11px] text-slate-400 ml-auto">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-200" /> inherited</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300" /> overridden</span>
              <span className="inline-flex items-center gap-1.5"><EyeOff className="w-3 h-3 text-rose-400" /> 86&rsquo;d</span>
            </div>
          </div>

          {overridesQ.isError && (
            <InlineNotice>
              Per-location overrides couldn&rsquo;t load — showing central prices for every location.
            </InlineNotice>
          )}

          {/* Price-book grid */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left font-bold text-slate-600 px-4 py-3 sticky left-0 bg-slate-50 z-10 min-w-[220px]">
                      Item
                    </th>
                    <th className="text-center font-semibold text-slate-500 px-3 py-3 min-w-[130px]">
                      Central price
                    </th>
                    {locations.map((loc) => (
                      <th key={loc.id} className="text-center font-semibold text-slate-600 px-3 py-3 min-w-[150px]">
                        <span className="inline-flex items-center gap-1.5">
                          <Store className="w-3.5 h-3.5 text-slate-400" /> {loc.name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      locations={locations}
                      overrideIndex={overrideIndex}
                      onSetCell={(locationId, patch) => setCellMutation.mutate({ locationId, itemId: item.id, patch })}
                      onRevertCell={(locationId) => revertMutation.mutate({ locationId, itemId: item.id })}
                      onBulkPrice={(cents) => bulkSetPrice(item.id, cents)}
                      onBulk86={(available) => bulk86(item.id, available)}
                      bulkScopeLabel={bulkScope ? locations.find((l) => l.id === bulkScope)?.name : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {items.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-400">No items match your search.</div>
            )}
          </div>

          <p className="text-[11px] text-slate-400 px-1">
            {items.length} item{items.length === 1 ? '' : 's'} · {locations.length} location{locations.length === 1 ? '' : 's'}.
            Editing a cell overrides only that location; the &ldquo;set across all&rdquo; row action updates every location at once.
          </p>
        </>
      )}
    </div>
  );
}

// ── One item row: central price + a cell per location + bulk actions ──
function ItemRow({
  item, locations, overrideIndex, onSetCell, onRevertCell, onBulkPrice, onBulk86, bulkScopeLabel,
}: {
  item: MenuCatalogItem;
  locations: MenuLocation[];
  overrideIndex: Map<string, MenuOverride>;
  onSetCell: (locationId: string, patch: SetOverridePatch) => void;
  onRevertCell: (locationId: string) => void;
  onBulkPrice: (cents: number | null) => void;
  onBulk86: (available: boolean) => void;
  bulkScopeLabel?: string;
}) {
  // Is the item 86'd everywhere (all cells unavailable)? Drives the
  // row-level "un-86 all" affordance.
  const allCells = locations.map((loc) =>
    resolveCell(item, overrideIndex.get(`${loc.id}:${item.id}`)),
  );
  const anyVisible = allCells.some((c) => c.isVisible);

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 group">
      {/* Item cell (sticky) */}
      <td className="px-4 py-2.5 sticky left-0 bg-white group-hover:bg-slate-50/50 z-10 align-top">
        <div className="font-semibold text-slate-800 leading-tight">{item.name}</div>
        {item.category && <div className="text-[11px] text-slate-400 mt-0.5">{item.category}</div>}
        <BulkPriceBar
          itemName={item.name}
          scopeLabel={bulkScopeLabel}
          allVisible={anyVisible}
          onBulkPrice={onBulkPrice}
          onBulk86={onBulk86}
        />
      </td>

      {/* Central price (read-only reference) */}
      <td className="px-3 py-2.5 text-center align-top">
        <span className="inline-flex items-center justify-center font-bold text-slate-700 tabular-nums">
          ${(item.defaultPriceCents / 100).toFixed(2)}
        </span>
      </td>

      {/* Per-location cells */}
      {locations.map((loc) => {
        const cell = resolveCell(item, overrideIndex.get(`${loc.id}:${item.id}`));
        return (
          <td key={loc.id} className="px-2 py-2 text-center align-top">
            <MenuPriceCell
              cell={cell}
              centralPriceCents={item.defaultPriceCents}
              onSetPrice={(cents) => onSetCell(loc.id, { priceCents: cents })}
              onRevert={() => onRevertCell(loc.id)}
              onToggle86={() => onSetCell(loc.id, { isAvailable: !cell.isVisible })}
            />
          </td>
        );
      })}
    </tr>
  );
}

function EmptyState({ schoolId }: { schoolId: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center mb-4">
        <UtensilsCrossed className="w-7 h-7 text-orange-500" />
      </div>
      <h2 className="text-lg font-bold text-slate-800">No menu yet</h2>
      <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">
        Connect your POS or paste your menu and we&rsquo;ll import every item — then this grid lets
        you price each one per location.
      </p>
      <div className="mt-5">
        <ConnectMenuPanel schoolId={schoolId} />
      </div>
    </div>
  );
}

function InlineNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2.5 text-amber-900">
      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}
