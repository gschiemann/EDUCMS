"use client";

/**
 * ScreenOperationsV3 — the Calm Operations v3 Screens surface.
 *
 * Design contract: scratch/design/screens-menu/SCREEN-OPERATIONS-V3-DESIGN-HANDOFF.md
 * + screen-operations-v3-calm.png. Where the handoff corrects the mock, the
 * handoff wins — emergency readiness carries a LOCATION denominator, the
 * drawer says "Reported content" not "On screen", there is an "All" filter
 * chip, and every colour is a brand token rather than the mock's purple.
 *
 * "Calm at rest, unmistakable when action is required": healthy groups start
 * collapsed, one dominant status per row, and every advanced diagnostic waits
 * behind the drawer. This component draws; it never counts, grades or words —
 * all of that is `screenOps.ts`, so the strip, the chips, the table and the
 * drawer are four drawings of ONE derivation.
 *
 * Presentational + interaction only: the page owns the queries and hands the
 * payloads down, which is also what lets the verification harness render the
 * real component against staged data on a production build.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Info, Layers, List as ListIcon, Loader2, Map as MapIcon, MapPin, Monitor,
  MoreVertical, Plus, RefreshCw, Search, ShieldCheck, Wifi, WifiOff, X,
} from 'lucide-react';
import {
  useCreateScreenGroup, useDeleteScreenGroup, useRefreshWeb, useUpdateScreenGroup,
} from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import {
  buildScreenOps, matchesFilter, matchesQuery, msOf, UNGROUPED_ID,
  type AssuranceItem, type FilterKey, type OpsGroup, type OpsPlaylist,
  type OpsRow, type OpsSchedule, type OpsScreen, type ReadinessInput,
} from './screenOps';
import { ScreenDetailDrawer, type DrawerTab } from './ScreenDetailDrawer';

/** Fresher than this and an online row shows a wall clock, not an age (§8). */
const FRESH_CONTACT_MS = 2 * 60_000;

export type ScreensViewMode = 'list' | 'map' | 'floor';

function statusToneClasses(tone: string) {
  switch (tone) {
    case 'bad':
      return 'text-rose-600';
    case 'warn':
      return 'text-amber-600';
    case 'ok':
      return 'text-emerald-600';
    case 'neutral':
      return 'text-sky-600';
    default:
      return 'text-slate-500';
  }
}

function StatusIcon({ tone }: { tone: string }) {
  const cls = `w-4 h-4 shrink-0 ${statusToneClasses(tone)}`;
  if (tone === 'bad') return <AlertCircle className={cls} aria-hidden />;
  if (tone === 'warn') return <AlertTriangle className={cls} aria-hidden />;
  if (tone === 'ok') return <CheckCircle2 className={cls} aria-hidden />;
  if (tone === 'neutral') return <Monitor className={cls} aria-hidden />;
  return <Clock className={cls} aria-hidden />;
}

function assuranceIcon(item: AssuranceItem) {
  const tone =
    item.state === 'bad' ? 'text-rose-600'
      : item.state === 'warn' ? 'text-amber-600'
        : item.state === 'ok' ? 'text-emerald-600' : 'text-slate-400';
  const cls = `w-4 h-4 shrink-0 ${tone}`;
  switch (item.key) {
    case 'screens':
      return <Monitor className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />;
    case 'content':
      return <CheckCircle2 className={cls} aria-hidden />;
    case 'online':
      return item.state === 'bad'
        ? <WifiOff className={cls} aria-hidden />
        : <Wifi className={cls} aria-hidden />;
    case 'action':
      return <AlertCircle className={cls} aria-hidden />;
    default:
      return <ShieldCheck className={cls} aria-hidden />;
  }
}

/** Full human datetime for a tooltip. */
function fullDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

/** §8 last-contact cell: wall clock while fresh, relative age once stale. */
function lastContact(row: OpsRow, now: number): { primary: string; secondary: string; title: string } {
  const ms = msOf(row.screen.lastPingAt);
  const online = row.screen.status === 'ONLINE';
  const secondary = online ? 'Online' : row.screen.status === 'PENDING' ? 'Checking' : 'Offline';
  if (ms == null) return { primary: 'Never', secondary, title: 'This screen has never checked in.' };
  const age = now - ms;
  if (online && age >= 0 && age < FRESH_CONTACT_MS) {
    return {
      primary: new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
      secondary,
      title: fullDateTime(ms),
    };
  }
  const sec = Math.max(0, Math.floor(age / 1000));
  const primary =
    sec < 60 ? `${sec}s ago`
      : sec < 3600 ? `${Math.floor(sec / 60)}m ago`
        : sec < 86400 ? `${Math.floor(sec / 3600)}h ago`
          : `${Math.floor(sec / 86400)}d ago`;
  return { primary, secondary, title: fullDateTime(ms) };
}

export interface ScreenOperationsV3Props {
  screens: OpsScreen[];
  groups: Array<{ id: string; name: string; address?: string | null; syncMode?: string | null }>;
  schedules: OpsSchedule[];
  playlists: OpsPlaylist[];
  deployedSha: string | null;
  readiness: ReadinessInput;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /**
   * SUPER / DISTRICT / SCHOOL admin — mirrors the `@RequireRoles` set on every
   * write route this surface can reach (pair, refresh-web, screen PUT,
   * orientation, force-update, delete, and all of screen-groups CRUD).
   *
   * This is the ONLY write gate here, deliberately. There used to be a second
   * `readOnly` prop wired to `userRole === 'RESTRICTED_VIEWER'`, and most
   * controls gated on THAT — so a CONTRIBUTOR (neither admin nor viewer) saw
   * every button enabled and collected a 403 on click. No action on this
   * surface is open to CONTRIBUTOR, so there is nothing left for a
   * viewer-only gate to say.
   */
  canControl: boolean;
  viewMode: ScreensViewMode;
  onViewMode: (v: ScreensViewMode) => void;
  /**
   * Map view. Receives the SAME rows the list would show, so search and the
   * filter chip mean the same thing on both surfaces (§5).
   */
  renderMap?: (screens: OpsScreen[]) => React.ReactNode;
  floorSlot?: React.ReactNode;
  /**
   * The device-first "Connect a screen" card. Rendered UNDER the fleet, where
   * it collapses itself to a single "Connect another screen" row once anything
   * is paired — so a fleet past onboarding doesn't keep paying page height for
   * setup chrome, and a brand-new operator still gets the APK / media-player /
   * browser paths instead of only a pairing-code box.
   */
  connectSlot?: React.ReactNode;
  onPairScreen: () => void;
  onSetGroupLocation: (group: { id: string; name: string; address?: string | null }) => void;
  onOpenDisplaySchedule: (target: { kind: 'screen' | 'group'; id: string; name: string }) => void;
  onOpenFullSettings: (screenId: string) => void;
  onSwitchClassic: () => void;
  onChanged: () => void;
  /** Preview URL builder — the page holds the auth token. */
  buildPreviewHref: (screen: OpsScreen) => string;
  /** One-shot deep link: open THIS screen's drawer (`?screen=<id>`). */
  deepLinkScreenId?: string | null;
  /** One-shot deep link: preselect a filter chip (`?filter=attention`). */
  deepLinkFilter?: FilterKey | null;
  /** Pinned clock — tests and the design harness inject a fixed instant. */
  now?: number;
}

export function ScreenOperationsV3(props: ScreenOperationsV3Props) {
  const {
    screens, groups, schedules, playlists, deployedSha, readiness,
    isLoading, isError, onRetry, canControl, viewMode, onViewMode,
    renderMap, floorSlot, connectSlot, onPairScreen, onSetGroupLocation, onOpenDisplaySchedule,
    onOpenFullSettings, onSwitchClassic, onChanged, buildPreviewHref,
    deepLinkScreenId, deepLinkFilter,
  } = props;
  // One clock read per render. No timer is added: the page's existing 10s
  // fleet poll is what advances these ages (mobile-perf standard).
  const now = props.now ?? Date.now();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>(deepLinkFilter ?? 'all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
  const [manualExpand, setManualExpand] = useState<Record<string, boolean>>({});
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [groupMenu, setGroupMenu] = useState<string | null>(null);
  const [pageMenu, setPageMenu] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshWeb = useRefreshWeb();
  const createGroup = useCreateScreenGroup();
  const updateGroup = useUpdateScreenGroup();
  const deleteGroup = useDeleteScreenGroup();

  const ops = useMemo(
    () => buildScreenOps({
      screens, schedules, playlists, deployedSha, readiness,
      selectedScreenId: selectedId, now,
    }),
    // `now` is deliberately in the deps: a new render instant is a new
    // derivation, and every age on one paint must come from one instant.
    [screens, schedules, playlists, deployedSha, readiness, selectedId, now],
  );

  // ── one-shot deep links ────────────────────────────────────────
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !deepLinkScreenId) return;
    if (!screens.some((s) => s.id === deepLinkScreenId)) return; // wait for data
    deepLinkApplied.current = true;
    setSelectedId(deepLinkScreenId);
    setDrawerTab('overview');
    // Bring the row into view once the group it lives in has expanded.
    requestAnimationFrame(() => {
      rowRefs.current[deepLinkScreenId]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [deepLinkScreenId, screens]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * Close any open popover on an outside pointerdown / Escape.
   *
   * ⚠️ The containment check below is LOAD-BEARING — do not "simplify" it back
   * to a bare `close` that relies on the panels' `onPointerDown` +
   * `stopPropagation` (2026-09-01: every item under the row ⋮ menu was dead).
   *
   * Why stopPropagation cannot work here: under the App Router, React 19
   * hydrates the whole document, so React's own listener sits on `document` —
   * the SAME node as this one. `stopPropagation()` only stops an event from
   * reaching FURTHER nodes; it does not stop other listeners already attached
   * to the same node (that needs `stopImmediatePropagation`). React's listener
   * is registered first at boot, so the order was: React dispatches the
   * synthetic onPointerDown → the panel calls stopPropagation → this listener
   * runs anyway → the menu unmounts → the following `click` lands on nothing.
   * Every menu item silently did nothing, and clicking the trigger to close
   * re-opened it (pointerdown closed, click re-toggled).
   *
   * Asking "did this land inside a popover?" is immune to listener ordering
   * and to which node the framework attaches to.
   */
  useEffect(() => {
    if (!rowMenu && !groupMenu && !pageMenu) return;
    const close = (e: PointerEvent) => {
      const el = e.target as Element | null;
      // Inside an open panel: the item's own onClick owns this interaction.
      if (el?.closest?.('[data-popover-panel]')) return;
      // On a trigger: its onClick toggles, so closing here would fight it.
      if (el?.closest?.('[data-popover-trigger]')) return;
      setRowMenu(null); setGroupMenu(null); setPageMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setRowMenu(null); setGroupMenu(null); setPageMenu(false); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [rowMenu, groupMenu, pageMenu]);

  const normalized = query.trim().toLowerCase();
  const filtering = filter !== 'all' || normalized.length > 0;

  /** Filter + search applied to the derived groups, preserving their order. */
  const visibleGroups = useMemo(() => {
    if (!filtering) return ops.groups;
    return ops.groups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, normalized)) }))
      .filter((g) => g.rows.length > 0);
  }, [ops.groups, filtering, filter, normalized]);

  const visibleCount = visibleGroups.reduce((n, g) => n + g.rows.length, 0);
  const selectedRow = selectedId ? ops.rows.find((r) => r.screen.id === selectedId) ?? null : null;

  const isExpanded = (g: OpsGroup) => {
    const manual = manualExpand[g.id];
    if (manual !== undefined) return manual;
    // While filtering, everything the filter kept is worth seeing.
    if (filtering) return true;
    return ops.autoExpanded.has(g.id);
  };

  const runRowAction = (row: OpsRow) => {
    const verb = row.status.action;
    if (verb === 'Resync' || verb === 'Retry') {
      // POST /screens/:id/refresh-web — admin-only.
      if (!canControl) return;
      refreshWeb.mutate(
        { screenId: row.screen.id },
        {
          onSuccess: () => {
            setToast(`Update sent to “${row.screen.name ?? 'this screen'}”. Waiting for it to confirm.`);
            onChanged();
          },
          onError: (e: any) => setToast(`Couldn’t send the update: ${e?.message || 'unknown error'}`),
        },
      );
      return;
    }
    // Troubleshoot / Re-pair / Set up / View all open the drawer — on the tab
    // that carries the fix.
    setSelectedId(row.screen.id);
    setDrawerTab(verb === 'Re-pair' || verb === 'Set up' ? 'actions' : 'overview');
  };

  const saveGroupName = (id: string) => {
    const name = groupDraft.trim();
    if (!name) { setEditingGroup(null); return; }
    updateGroup.mutate({ id, name }, { onSuccess: () => { setEditingGroup(null); onChanged(); } });
  };

  const removeGroup = async (g: OpsGroup) => {
    const ok = await appConfirm({
      title: `Delete “${g.name}”?`,
      message: `The ${g.rows.length} screen${g.rows.length === 1 ? '' : 's'} in this group stay paired — they simply move out of the group.`,
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (!ok) return;
    deleteGroup.mutate(g.id, { onSuccess: () => { setToast('Group deleted.'); onChanged(); } });
  };

  const brand = { background: 'var(--brand-primary, #4f46e5)' };

  // ═════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* ─── Header (§5) ─────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-8 font-bold tracking-tight text-slate-900">Screens</h1>
          <p className="text-sm text-slate-500 mt-0.5">Every screen, correct content, one place</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Screen views" className="flex w-full sm:w-auto bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            {([
              ['list', 'List', ListIcon],
              ['map', 'Map', MapIcon],
              ['floor', 'Floor plans', MapPin],
            ] as const).map(([key, label, Icon]) => {
              const active = viewMode === key;
              return (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => onViewMode(key)}
                  className={`flex-1 sm:flex-none justify-center px-3 py-2 sm:py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${
                    active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden /> {label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onPairScreen}
            disabled={!canControl}
            title={!canControl ? 'Your role can’t pair screens' : undefined}
            className="px-4 py-2.5 sm:py-2 text-white text-sm font-bold rounded-xl shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={brand}
          >
            <Wifi className="w-4 h-4" aria-hidden /> Pair screen
          </button>

          {/* §5: group management lives in the overflow, not as a second
              high-emphasis header button. */}
          <div className="relative">
            <button
              type="button"
              aria-label="More screen actions"
              aria-expanded={pageMenu}
              data-popover-trigger
              onClick={(e) => { e.stopPropagation(); setPageMenu((v) => !v); }}
              className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
            >
              <MoreVertical className="w-4 h-4" aria-hidden />
            </button>
            {pageMenu && (
              <div
                // Containment only: the outside-close listener fires on
                // `pointerdown`, so stopping THAT is what keeps the menu open.
                // An onClick here would be redundant and would make a plain
                // <div> look interactive to assistive tech.
                data-popover-panel
                className="absolute right-0 top-11 z-30 w-56 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden"
              >
                <button
                  type="button"
                  disabled={!canControl}
                  onClick={() => { setPageMenu(false); setNewGroupOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-400" aria-hidden /> New group
                </button>
                <button
                  type="button"
                  onClick={() => { setPageMenu(false); onSwitchClassic(); }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-bold text-slate-500 hover:bg-slate-50 border-t border-slate-100"
                >
                  <Layers className="w-3.5 h-3.5 text-slate-400" aria-hidden /> Classic view
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Assurance strip (§6) ────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {ops.assurance.map((item, i) => (
          <div key={item.key} className="flex items-center gap-2 min-w-0">
            {i > 0 && <span className="hidden sm:block w-px h-5 bg-slate-200 mr-2" aria-hidden />}
            {assuranceIcon(item)}
            <span className="text-[13px] font-semibold text-slate-600 whitespace-nowrap" title={item.detail}>
              <span className="font-bold text-slate-900">{item.value}</span> {item.label}
            </span>
          </div>
        ))}
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 sm:ml-auto">
          <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span title="Answering, having the current content, confirming a picture, and verifying the physical panel are four separate facts. A screen can be online and still be showing yesterday’s content.">
            Online does not mean content current.
          </span>
        </p>
      </div>

      {/* Floor plans owns its whole body; search has nothing to filter there. */}
      {viewMode === 'floor' && floorSlot}

      {viewMode !== 'floor' && (
        <>
          {/* ─── Search (§7) ─────────────────────────────────── */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); }
              }}
              placeholder="Search screens, locations, groups, or models…"
              aria-label="Search screens, locations, groups, or models"
              className="w-full h-12 pl-10 pr-12 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
          </div>

          {/* ─── Filter chips (§7 — single-select, "All" always there) ── */}
          <div role="group" aria-label="Filter screens" className="flex flex-wrap gap-2">
            {ops.chips.map((chip) => {
              const active = filter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(chip.key)}
                  className={`min-h-11 sm:min-h-0 sm:h-9 px-3.5 text-[12.5px] font-bold rounded-xl border inline-flex items-center gap-2 transition-colors ${
                    active ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                  style={active ? brand : undefined}
                >
                  {chip.key === 'attention' && (
                    <AlertCircle className={`w-3.5 h-3.5 ${active ? 'text-white' : 'text-rose-500'}`} aria-hidden />
                  )}
                  {chip.label}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Map view — the same rows the list would show, as pins (§5). */}
          {viewMode === 'map' && renderMap?.(visibleGroups.flatMap((g) => g.rows.map((r) => r.screen)))}

          {/* ─── The fleet (§8) ──────────────────────────────── */}
          {viewMode === 'list' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {isLoading ? (
              // §13 — skeleton rows preserve the table geometry; never a
              // centred spinner that throws the layout away.
              <div className="divide-y divide-slate-100" aria-busy="true" aria-label="Loading screens">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[76px] px-5 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 animate-pulse" />
                    <div className="flex-1 h-4 rounded bg-slate-100 animate-pulse" />
                    <div className="w-28 h-4 rounded bg-slate-100 animate-pulse" />
                    <div className="w-20 h-8 rounded-lg bg-slate-100 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="py-16 text-center px-6">
                <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-3" aria-hidden />
                <p className="text-sm font-semibold text-slate-600">
                  Couldn’t load your screens. Check your connection and try again.
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-bold inline-flex items-center gap-1.5"
                  style={brand}
                >
                  <RefreshCw className="w-4 h-4" aria-hidden /> Retry
                </button>
              </div>
            ) : ops.rows.length === 0 ? (
              <div className="py-16 text-center px-6">
                <Monitor className="w-9 h-9 text-slate-300 mx-auto mb-3" aria-hidden />
                <h2 className="text-base font-bold text-slate-800">Connect your first screen</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Pair a player to start publishing and monitoring content.
                </p>
                <button
                  type="button"
                  onClick={onPairScreen}
                  disabled={!canControl}
                  className="mt-4 px-4 py-2.5 rounded-xl text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
                  style={brand}
                >
                  <Wifi className="w-4 h-4" aria-hidden /> Pair screen
                </button>
              </div>
            ) : visibleCount === 0 ? (
              <div className="py-16 text-center px-6">
                <Search className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden />
                <h2 className="text-base font-bold text-slate-800">No screens match</h2>
                <p className="mt-1 text-sm text-slate-500">Try another name or clear the current filter.</p>
                <button
                  type="button"
                  onClick={() => { setQuery(''); setFilter('all'); }}
                  className="mt-4 px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                {/* Desktop / tablet: semantic table (§14). */}
                <table className="hidden lg:table w-full border-collapse">
                  <caption className="sr-only">
                    Screens grouped by location, worst first. {visibleCount} shown.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 px-5 py-3 w-[26%]">Screen</th>
                      <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 py-3 w-[24%] hidden xl:table-cell">Content</th>
                      <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 py-3 w-[24%]">Status</th>
                      <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 py-3 w-[16%]">Last contact</th>
                      <th scope="col" className="text-right text-[11px] font-bold uppercase tracking-wider text-slate-400 px-5 py-3 w-[14%]">Action</th>
                    </tr>
                  </thead>
                  {visibleGroups.map((g) => {
                    const expanded = isExpanded(g);
                    const contact = g.lastContactMs
                      ? new Date(g.lastContactMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
                      : '—';
                    return (
                      <tbody key={g.id} id={`screen-group-${g.id}`} className="border-b border-slate-100 last:border-b-0">
                        {/* ── Location / group row ── */}
                        <tr className="bg-slate-50/50">
                          <th scope="colgroup" colSpan={2} className="text-left px-5 py-2.5 font-normal">
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={`screen-group-${g.id}`}
                                onClick={() => setManualExpand((m) => ({ ...m, [g.id]: !expanded }))}
                                className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-200/60 shrink-0"
                              >
                                {expanded
                                  ? <ChevronDown className="w-4 h-4" aria-hidden />
                                  : <ChevronRight className="w-4 h-4" aria-hidden />}
                                <span className="sr-only">{expanded ? 'Collapse' : 'Expand'} {g.name}</span>
                              </button>
                              {editingGroup === g.id ? (
                                <input
                                  autoFocus
                                  value={groupDraft}
                                  onChange={(e) => setGroupDraft(e.target.value)}
                                  onBlur={() => saveGroupName(g.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveGroupName(g.id);
                                    if (e.key === 'Escape') setEditingGroup(null);
                                  }}
                                  aria-label={`Rename ${g.name}`}
                                  className="px-2 py-1 rounded-lg border border-slate-300 text-[13px] font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                              ) : (
                                <>
                                  <Building2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                                  <span className="text-[13.5px] font-bold text-slate-800 truncate">{g.name}</span>
                                  <span className="text-[12px] font-semibold text-slate-400 shrink-0">({g.rows.length})</span>
                                </>
                              )}
                            </div>
                          </th>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${
                              g.attention > 0 ? 'text-rose-600' : 'text-emerald-600'
                            }`}>
                              {g.attention > 0
                                ? <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                              {g.summary}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500">
                              <span className={`w-2 h-2 rounded-full ${g.online === g.rows.length ? 'bg-emerald-500' : g.online === 0 ? 'bg-slate-400' : 'bg-amber-500'}`} aria-hidden />
                              {contact}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            {g.id !== UNGROUPED_ID && (
                              <div className="relative inline-block">
                                <button
                                  type="button"
                                  aria-label={`More actions for ${g.name}`}
                                  aria-expanded={groupMenu === g.id}
                                  data-popover-trigger
                                  onClick={(e) => { e.stopPropagation(); setGroupMenu(groupMenu === g.id ? null : g.id); }}
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-200/60"
                                >
                                  <MoreVertical className="w-4 h-4" aria-hidden />
                                </button>
                                {groupMenu === g.id && (
                                  <div
                                    data-popover-panel
                                    className="absolute right-0 top-9 z-30 w-56 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden text-left"
                                  >
                                    <button type="button" disabled={!canControl}
                                      onClick={() => { setGroupMenu(null); setEditingGroup(g.id); setGroupDraft(g.name); }}
                                      className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left disabled:opacity-50">
                                      Rename group
                                    </button>
                                    <button type="button" disabled={!canControl}
                                      onClick={() => {
                                        setGroupMenu(null);
                                        const src = groups.find((x) => x.id === g.id);
                                        onSetGroupLocation({ id: g.id, name: g.name, address: src?.address ?? null });
                                      }}
                                      className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100 disabled:opacity-50">
                                      Set group address
                                    </button>
                                    <button type="button"
                                      onClick={() => { setGroupMenu(null); onOpenDisplaySchedule({ kind: 'group', id: g.id, name: g.name }); }}
                                      className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                                      On/off schedule
                                    </button>
                                    <button type="button" disabled={!canControl}
                                      onClick={() => { setGroupMenu(null); void removeGroup(g); }}
                                      className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-rose-600 hover:bg-rose-50 text-left border-t border-slate-100 disabled:opacity-50">
                                      Delete group
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>

                        {/* ── Screen rows ── */}
                        {expanded && g.rows.map((row) => {
                          const s = row.screen;
                          const selected = selectedId === s.id;
                          const lc = lastContact(row, now);
                          const actionable = row.status.action === 'Resync' || row.status.action === 'Retry';
                          return (
                            <tr
                              key={s.id}
                              ref={(el) => { rowRefs.current[s.id] = el; }}
                              onClick={() => { setSelectedId(s.id); setDrawerTab('overview'); }}
                              className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50/70 ${selected ? 'bg-slate-50' : ''}`}
                              style={selected ? { boxShadow: 'inset 3px 0 0 0 var(--brand-primary, #4f46e5)' } : undefined}
                            >
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-3 min-w-0">
                                  <Monitor className={`w-4 h-4 shrink-0 ${s.status === 'ONLINE' ? 'text-emerald-500' : 'text-slate-400'}`} aria-hidden />
                                  <span className="min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setSelectedId(s.id); setDrawerTab('overview'); }}
                                      className="block text-[13.5px] leading-5 font-bold text-slate-900 truncate text-left hover:underline"
                                    >
                                      {s.name || 'Unnamed screen'}
                                    </button>
                                    <span className="block text-[11.5px] font-semibold text-slate-400 truncate">
                                      {s.hardwareModel || (s.osInfo ? s.osInfo : 'Screen')}
                                    </span>
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-3.5 hidden xl:table-cell">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {row.expected.thumbnailUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={row.expected.thumbnailUrl}
                                      alt=""
                                      className="w-[72px] h-[42px] object-cover rounded-md bg-slate-100 shrink-0"
                                    />
                                  ) : (
                                    <span className="w-[72px] h-[42px] rounded-md bg-slate-100 shrink-0" aria-hidden />
                                  )}
                                  <span className="min-w-0">
                                    <span className="block text-[12.5px] font-bold text-slate-700 truncate">
                                      {row.expected.name ?? 'Nothing scheduled'}
                                    </span>
                                    {row.expected.name && (
                                      <span className="block text-[11.5px] font-semibold text-slate-400 truncate">
                                        Scheduled{row.expected.viaGroup ? ' for the group' : ''}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-3.5">
                                <div className="flex items-start gap-2 min-w-0">
                                  <StatusIcon tone={row.status.tone} />
                                  <span className="min-w-0">
                                    <span className={`block text-[12.5px] font-bold leading-5 ${statusToneClasses(row.status.tone)}`}>
                                      {row.status.label}{row.status.age ? ` · ${row.status.age}` : ''}
                                    </span>
                                    {row.status.evidence && (
                                      <span className="block text-[11.5px] font-semibold text-slate-400 truncate">
                                        {row.status.evidence}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-3.5" title={lc.title}>
                                <span className="block text-[12.5px] font-semibold text-slate-600">{lc.primary}</span>
                                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-400">
                                  <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden />
                                  {lc.secondary}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); runRowAction(row); }}
                                    disabled={actionable && (!canControl || refreshWeb.isPending)}
                                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border disabled:opacity-50 ${
                                      actionable
                                        ? 'border-transparent text-white'
                                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                    style={actionable ? brand : undefined}
                                  >
                                    {row.status.action}
                                  </button>
                                  <div className="relative">
                                    <button
                                      type="button"
                                      aria-label={`More actions for ${s.name ?? 'this screen'}`}
                                      aria-expanded={rowMenu === s.id}
                                      data-popover-trigger
                                      onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === s.id ? null : s.id); }}
                                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
                                    >
                                      <MoreVertical className="w-4 h-4" aria-hidden />
                                    </button>
                                    {rowMenu === s.id && (
                                      <div
                                        data-popover-panel
                                        className="absolute right-0 top-9 z-30 w-52 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden text-left"
                                      >
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); setRowMenu(null); setSelectedId(s.id); setDrawerTab('overview'); }}
                                          className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left">
                                          Open details
                                        </button>
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); setRowMenu(null); setSelectedId(s.id); setDrawerTab('actions'); }}
                                          className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                                          Actions
                                        </button>
                                        <a
                                          href={buildPreviewHref(s)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => { e.stopPropagation(); setRowMenu(null); }}
                                          className="block w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100"
                                        >
                                          Open live preview
                                        </a>
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); setRowMenu(null); onOpenFullSettings(s.id); }}
                                          className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                                          Full settings
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    );
                  })}
                </table>

                {/* Mobile: cards, never a horizontally scrolling table (§12). */}
                <ul className="lg:hidden divide-y divide-slate-100">
                  {visibleGroups.map((g) => {
                    const expanded = isExpanded(g);
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setManualExpand((m) => ({ ...m, [g.id]: !expanded }))}
                          className="w-full min-h-11 px-4 py-3 bg-slate-50/60 flex items-center gap-2 text-left"
                        >
                          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden /> : <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />}
                          <span className="text-[13.5px] font-bold text-slate-800 flex-1 min-w-0 truncate">{g.name}</span>
                          <span className={`text-[11.5px] font-bold ${g.attention > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {g.attention > 0 ? `${g.attention} need${g.attention === 1 ? 's' : ''} action` : 'All good'}
                          </span>
                        </button>
                        {expanded && (
                          <ul>
                            {g.rows.map((row) => {
                              const s = row.screen;
                              const lc = lastContact(row, now);
                              const actionable = row.status.action === 'Resync' || row.status.action === 'Retry';
                              return (
                                <li key={s.id} className="border-t border-slate-100">
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => { setSelectedId(s.id); setDrawerTab('overview'); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(s.id); setDrawerTab('overview'); } }}
                                    className="px-4 py-3 flex items-start gap-3"
                                  >
                                    <Monitor className={`w-4 h-4 mt-0.5 shrink-0 ${s.status === 'ONLINE' ? 'text-emerald-500' : 'text-slate-400'}`} aria-hidden />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[14px] font-bold text-slate-900 truncate">{s.name || 'Unnamed screen'}</p>
                                      <p className={`mt-0.5 text-[12.5px] font-bold ${statusToneClasses(row.status.tone)}`}>
                                        {row.status.label}{row.status.age ? ` · ${row.status.age}` : ''}
                                      </p>
                                      <p className="mt-0.5 text-[11.5px] font-semibold text-slate-400 truncate">
                                        {row.expected.name ?? 'Nothing scheduled'} · {lc.primary}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); runRowAction(row); }}
                                      disabled={actionable && (!canControl || refreshWeb.isPending)}
                                      className={`min-h-11 px-3 rounded-lg text-[12px] font-bold border shrink-0 disabled:opacity-50 ${
                                        actionable ? 'border-transparent text-white' : 'border-slate-200 text-slate-600'
                                      }`}
                                      style={actionable ? brand : undefined}
                                    >
                                      {row.status.action}
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
          )}

          {viewMode === 'list' && !isLoading && !isError && connectSlot}

          {viewMode === 'list' && !isLoading && !isError && ops.rows.length > 0 && (
            <p className="text-[12px] font-semibold text-slate-400 px-1">
              {filtering
                ? `Showing ${visibleCount} of ${ops.totals.screens} screen${ops.totals.screens === 1 ? '' : 's'}`
                : `${ops.totals.screens} screen${ops.totals.screens === 1 ? '' : 's'} across ${ops.groups.length} group${ops.groups.length === 1 ? '' : 's'}`}
            </p>
          )}
        </>
      )}

      {/* New group — inline, opened from the header overflow (§5). */}
      {newGroupOpen && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-2">
          <input
            autoFocus
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setNewGroupOpen(false); setNewGroupName(''); }
              if (e.key === 'Enter' && newGroupName.trim()) {
                createGroup.mutate({ name: newGroupName.trim() }, {
                  onSuccess: () => { setNewGroupName(''); setNewGroupOpen(false); onChanged(); },
                });
              }
            }}
            placeholder="Group name — e.g. Lobby, Cardio floor"
            aria-label="New group name"
            className="flex-1 h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="button"
            disabled={!newGroupName.trim() || createGroup.isPending}
            onClick={() => createGroup.mutate({ name: newGroupName.trim() }, {
              onSuccess: () => { setNewGroupName(''); setNewGroupOpen(false); onChanged(); },
            })}
            className="h-11 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-50"
            style={brand}
          >
            {createGroup.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Creating" /> : 'Create group'}
          </button>
          <button
            type="button"
            onClick={() => { setNewGroupOpen(false); setNewGroupName(''); }}
            className="h-11 px-3 text-sm font-bold text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ─── Detail drawer (§10) ─────────────────────────────── */}
      {selectedRow && (
        <ScreenDetailDrawer
          row={selectedRow}
          placeName={selectedRow.screen.screenGroup?.name ?? 'Not in a group'}
          previewHref={buildPreviewHref(selectedRow.screen)}
          canControl={canControl}
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          now={now}
          initialTab={drawerTab}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          onOpenFullSettings={() => onOpenFullSettings(selectedRow.screen.id)}
          onOpenDisplaySchedule={() =>
            onOpenDisplaySchedule({ kind: 'screen', id: selectedRow.screen.id, name: selectedRow.screen.name ?? 'Screen' })}
        />
      )}

      {/* Command outcomes are announced, not only shown (§14). */}
      <p aria-live="polite" className="sr-only">{toast ?? ''}</p>
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 max-w-md">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden />
          <span className="text-sm font-medium">{toast}</span>
        </div>
      )}
    </div>
  );
}
