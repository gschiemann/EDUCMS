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

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, MapPin, Monitor, MoreVertical, Plus, RefreshCw, Search, Wifi, X, List as ListIcon, Map as MapIcon, Info,
} from 'lucide-react';
import {
  useCreateScreenGroup, useDeleteScreenGroup, useForceApkUpdate, useRefreshWeb,
  useUpdateScreenGroup, useUploadFloorPlan,
} from '@/hooks/use-api';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { useParams } from 'next/navigation';
import { appConfirm } from '@/components/ui/app-dialog';
import { useApkPushState } from '@/components/screens/ScreenSettingsMenu';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import {
  buildScreenOps, matchesFilter, matchesQuery, msOf, syncStatusFor, UNGROUPED_ID,
  type FilterKey, type OpsGroup, type OpsPlaylist,
  type OpsRow, type OpsSchedule, type OpsScreen,
} from './screenOps';
import { ExpectedThumb } from './ExpectedThumb';
import { ScreenDetailDrawer, type DrawerTab } from './ScreenDetailDrawer';
import { AddScreensToGroupDialog } from './AddScreensToGroupDialog';

/**
 * "Full settings" — the SAME popover the classic Screens page has always shown
 * off its gear button (LED canvas, console profile, sync trim, orientation,
 * display + power, first-boot setup, device details, APK push).
 *
 * It used to be unreachable from here: the page swapped itself for the whole
 * 3.2k-line classic surface and deep-linked into it, which is what the operator
 * hit on 2026-09-01 — *"it reverts the entire screen back to the classic
 * layout … just a fucking mess"*. Now it mounts in place, anchored to the row.
 *
 * Lazy because it drags the display-capability world with it and most sessions
 * never open it — the same reason the drawer lazy-loads its two heavy panels.
 * The classic page imports the same module, so the build keeps ONE copy.
 */

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
  groups: Array<{
    id: string; name: string; address?: string | null; syncMode?: string | null;
    /**
     * 2026-09-16 — server-derived: ANY screen in this group is frame-locked by
     * the playlist it is playing. A group no longer HOLDS the setting (it can
     * hold several playlists), so this is a summary used only to offer the
     * calibration wizard, never a control.
     */
    syncActive?: boolean | null;
  }>;
  schedules: OpsSchedule[];
  playlists: OpsPlaylist[];
  deployedSha: string | null;
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
   * The device-first "Connect a screen" how-to. Opened from the (i) beside
   * Pair screen, in a dialog (2026-09-14) — Pair screen is the one prominent
   * control on the page; the instructions are a reference, not chrome.
   */
  connectSlot?: React.ReactNode;
  /** Opens the pair modal; a group id pre-selects that group (ported from classic, 2026-09-14). */
  onPairScreen: (groupId?: string) => void;
  /** Per-screen address picker (the page owns the modal). */
  onSetScreenLocation?: (screen: { id: string; name: string; address?: string | null }) => void;
  onSetGroupLocation: (group: { id: string; name: string; address?: string | null }) => void;
  onOpenDisplaySchedule: (target: { kind: 'screen' | 'group'; id: string; name: string }) => void;
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


/**
 * Group header rows wear a soft wash of the brand colour (2026-09-14, Greg:
 * "there is no separation between one group and the other — use the branded
 * color to highlight the groups but keep it soft"). 7% over white stays quiet
 * on any brand; the hairline above is the same colour at 22%.
 */
const GROUP_ROW_STYLE = {
  background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 7%, white)',
  boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--brand-primary, #4f46e5) 22%, white)',
} as const;
/**
 * Each group is its own card (2026-09-14, Greg, after the wash: "still more
 * separation between groups — I think we separate them completely"). The wash
 * above is the card's header bar; the group's screens are the card's own
 * table. `overflow-hidden` is safe here: every menu is an AnchoredMenu portal.
 */
const GROUP_CARD_CLASS = 'rounded-2xl border border-slate-200 bg-white overflow-hidden';
export function ScreenOperationsV3(props: ScreenOperationsV3Props) {
  const {
    screens, groups, schedules, playlists, deployedSha,
    isLoading, isError, onRetry, canControl, viewMode, onViewMode,
    renderMap, floorSlot, connectSlot, onPairScreen, onSetScreenLocation, onSetGroupLocation, onOpenDisplaySchedule,
    onChanged, buildPreviewHref,
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
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  /** The mobile card for each row — the desktop table is `display:none` there. */
  const mobileRowRefs = useRef<Record<string, HTMLElement | null>>({});
  /** Each row's ⋮ button: the natural anchor for that row's settings popover. */
  const rowKebabRefs = useRef<Record<string, HTMLElement | null>>({});
  // Anchors for the portal menus (AnchoredMenu): the page "⋮" and each
  // group's "⋮". Rows reuse rowKebabRefs above.
  const groupKebabRefs = useRef<Record<string, HTMLElement | null>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshWeb = useRefreshWeb();
  const forceApk = useForceApkUpdate();
  const { pushState, markPushed } = useApkPushState();
  const createGroup = useCreateScreenGroup();
  const uploadFloorPlan = useUploadFloorPlan();
  // New group form (2026-09-14, Greg: "an obvious button to add another screen
  // group and to offer adding the address and floor map as an optional input").
  const [newGroupAddress, setNewGroupAddress] = useState('');
  const [newGroupGeo, setNewGroupGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [newGroupFloor, setNewGroupFloor] = useState<File | null>(null);
  const [newGroupError, setNewGroupError] = useState<string | null>(null);
  const [newGroupBusy, setNewGroupBusy] = useState(false);
  // The connect how-to (2026-09-14, Greg: "add this somewhere up top, maybe
  // just a little info circle by the Pair screen button").
  const [howToOpen, setHowToOpen] = useState(false);
  // "Add screens…" picker for a group (2026-09-14, Greg).
  const [addTo, setAddTo] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!howToOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHowToOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [howToOpen]);
  const resetNewGroup = () => {
    setNewGroupOpen(false); setNewGroupName(''); setNewGroupAddress(''); setNewGroupGeo(null); setNewGroupFloor(null); setNewGroupError(null);
  };
  const submitNewGroup = async () => {
    const name = newGroupName.trim();
    if (!name || newGroupBusy) return;
    setNewGroupBusy(true); setNewGroupError(null);
    try {
      const address = newGroupAddress.trim();
      await createGroup.mutateAsync({
        name,
        ...(address ? { address, latitude: newGroupGeo?.lat ?? null, longitude: newGroupGeo?.lng ?? null } : {}),
      });
      if (newGroupFloor) {
        try {
          await uploadFloorPlan.mutateAsync({ file: newGroupFloor, name: `${name} — floor plan`, buildingLabel: name });
        } catch (err) {
          // The group exists; only the drawing failed. Say exactly that.
          setNewGroupError(`"${name}" was created, but the floor map did not upload (${err instanceof Error ? err.message : 'upload failed'}). Add it from Floor plans.`);
          setNewGroupName(''); setNewGroupAddress(''); setNewGroupGeo(null); setNewGroupFloor(null);
          onChanged();
          return;
        }
      }
      resetNewGroup();
      onChanged();
    } catch (err) {
      setNewGroupError(err instanceof Error ? err.message : 'Could not create the group.');
    } finally {
      setNewGroupBusy(false);
    }
  };
  const updateGroup = useUpdateScreenGroup();
  const deleteGroup = useDeleteScreenGroup();

  const ops = useMemo(
    () => buildScreenOps({
      screens, schedules, playlists, deployedSha,
      selectedScreenId: selectedId, now,
    }),
    // `now` is deliberately in the deps: a new render instant is a new
    // derivation, and every age on one paint must come from one instant.
    [screens, schedules, playlists, deployedSha, selectedId, now],
  );

  // ── one-shot deep links ────────────────────────────────────────
  //
  // `?screen=<id>` is the dashboard device drawer's "Full settings" link
  // (the dashboard's former DeviceDrawer, retired 2026-09-14 — the dashboard deep-links here instead). Since 2026-09-01 every
  // per-screen setting lives on this drawer's Settings tab, so that is where
  // the link lands — there is no longer a second settings surface for it to
  // mean instead.
  //
  // The group holding the row is still force-expanded: the drawer is opened by
  // row id, and leaving the row collapsed behind it would strand the operator
  // on a list that does not show the screen they just closed.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !deepLinkScreenId) return;
    const target = screens.find((s) => s.id === deepLinkScreenId);
    if (!target) return; // wait for data
    deepLinkApplied.current = true;
    setManualExpand((m) => ({ ...m, [target.screenGroupId ?? UNGROUPED_ID]: true }));
    setSelectedId(deepLinkScreenId);
    setDrawerTab('actions');
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
    if (!rowMenu && !groupMenu) return;
    const close = (e: PointerEvent) => {
      const el = e.target as Element | null;
      // Inside an open panel: the item's own onClick owns this interaction.
      if (el?.closest?.('[data-popover-panel]')) return;
      // On a trigger: its onClick toggles, so closing here would fight it.
      if (el?.closest?.('[data-popover-trigger]')) return;
      setRowMenu(null); setGroupMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setRowMenu(null); setGroupMenu(null); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [rowMenu, groupMenu]);

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

  const removeGroup = async (g: { id: string; name: string; rows?: unknown[] }) => {
    const n = g.rows?.length ?? 0;
    const ok = await appConfirm({
      title: `Delete “${g.name}”?`,
      message: n === 0
        ? 'This group has no screens yet.'
        : `The ${n} screen${n === 1 ? '' : 's'} in this group stay paired — they simply move out of the group.`,
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (!ok) return;
    deleteGroup.mutate(g.id, { onSuccess: () => { setToast('Group deleted.'); onChanged(); } });
  };

  const brand = { background: 'var(--brand-primary, #4f46e5)' };
  const params = useParams<{ schoolId: string }>();
  const schoolSlug = params?.schoolId ?? '';

  /**
   * The group ⋮ menu, shared by groups with screens and EMPTY groups (a group
   * made with the New group button is visible from the moment it exists).
   *
   * 2026-09-16 — "Sync playback across the group" is GONE from here. Greg:
   * "if i have different playlists assigned to screens in the same group it
   * doesnt make sense saying to keep them in sync...we just need to move the
   * setting into playlist and not screen groups". The switch now lives on the
   * playlist's Screens tab. What stays is Calibrate, because calibration is a
   * measurement of PHYSICAL displays standing next to each other — a group is
   * the right scope for that — and it is offered whenever this group actually
   * has frame-locked screens, however they got that way.
   */
  const groupMenuItems = (g: { id: string; name: string; rows?: unknown[] }) => {
    const src = groups.find((x) => x.id === g.id);
    const synced = src?.syncActive === true;
    const item = 'w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left disabled:opacity-50 disabled:cursor-not-allowed';
    return (
      <>
        <button type="button" disabled={!canControl}
          onClick={() => { setGroupMenu(null); setEditingGroup(g.id); setGroupDraft(g.name); }}
          className={item}>
          Rename group
        </button>
        <button type="button" disabled={!canControl}
          onClick={() => { setGroupMenu(null); onSetGroupLocation({ id: g.id, name: g.name, address: src?.address ?? null }); }}
          className={`${item} border-t border-slate-100`}>
          Set group address
        </button>
        <button type="button" disabled={!canControl}
          onClick={() => { setGroupMenu(null); onPairScreen(g.id); }}
          className={`${item} border-t border-slate-100`}>
          Pair a screen here…
        </button>
        <button type="button" disabled={!canControl}
          onClick={() => { setGroupMenu(null); setAddTo({ id: g.id, name: g.name }); }}
          className={item}>
          Add screens…
        </button>
        <button type="button"
          onClick={() => { setGroupMenu(null); onOpenDisplaySchedule({ kind: 'group', id: g.id, name: g.name }); }}
          className={`${item} border-t border-slate-100`}>
          On/off schedule
        </button>
        {synced && schoolSlug && (
          <a href={`/${schoolSlug}/screens/sync-calibrate?groupId=${g.id}`}
            title="Point your phone camera at these screens and the wizard measures each display's true glass latency and sets the trims for you."
            className={`block ${item} border-t border-slate-100`}>
            Calibrate sync…
          </a>
        )}
        <button type="button" disabled={!canControl}
          onClick={() => { setGroupMenu(null); void removeGroup(g); }}
          className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-rose-600 hover:bg-rose-50 text-left border-t border-slate-100 disabled:opacity-50 disabled:cursor-not-allowed">
          Delete group
        </button>
      </>
    );
  };

  // Groups with no screens yet — never in `ops.groups` (those come from rows).
  // Shown only on the unfiltered list; a search or chip narrows to screens.
  const emptyGroups = filtering ? [] : groups.filter((gr) => !ops.groups.some((og) => og.id === gr.id));

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

          {/* 2026-09-14 (Greg): "adding a new group should not be hidden behind
              the 3 dots — an obvious button". A quiet secondary next to the one
              primary, Pair screen. */}
          <button
            type="button"
            onClick={() => { setNewGroupOpen(true); setNewGroupError(null); }}
            disabled={!canControl}
            title={!canControl ? 'Your role can’t create groups' : undefined}
            className="px-4 py-2.5 sm:py-2 bg-white text-slate-700 text-sm font-bold rounded-xl border border-slate-200 shadow-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" aria-hidden /> New group
          </button>

          <button
            type="button"
            onClick={() => onPairScreen()}
            disabled={!canControl}
            title={!canControl ? 'Your role can’t pair screens' : undefined}
            className="px-4 py-2.5 sm:py-2 text-white text-sm font-bold rounded-xl shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={brand}
          >
            <Wifi className="w-4 h-4" aria-hidden /> Pair screen
          </button>

          {connectSlot && (
            <button
              type="button"
              onClick={() => setHowToOpen(true)}
              aria-label="How to connect a screen"
              title="How to connect a screen"
              className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
            >
              <Info className="w-4 h-4" aria-hidden />
            </button>
          )}

        </div>
      </div>

      {/* New group — inline form under the header (§5). Name is required; the
          address (with the same geocoding picker the location modal uses) and
          a floor-map image are optional, so a group can land on the map and in
          Floor plans in the same breath it is created. */}
      {newGroupOpen && (
        <form
          className="bg-white rounded-2xl border border-slate-200 p-4 grid gap-3"
          aria-label="New group"
          onSubmit={(e) => { e.preventDefault(); void submitNewGroup(); }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Group name</span>
              <input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') resetNewGroup(); }}
                placeholder="e.g. Lobby, Cardio floor"
                aria-label="New group name"
                className="h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </label>
            <label htmlFor="new-group-address" className="grid gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Address <span className="normal-case tracking-normal font-semibold text-slate-400">(optional — puts the group on the map)</span></span>
              <AddressAutocomplete
                id="new-group-address"
                value={newGroupAddress}
                onChange={(v) => { setNewGroupAddress(v); setNewGroupGeo(null); }}
                onPick={(pick) => { setNewGroupAddress(pick.displayName); setNewGroupGeo({ lat: pick.latitude, lng: pick.longitude }); }}
                placeholder="Street address"
                ariaLabel="New group address"
                className="h-11 pl-10 pr-3.5 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300 w-full"
              />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Floor map <span className="normal-case tracking-normal font-semibold text-slate-400">(optional — a PNG or JPG of the floor plan; screens can be placed on it later)</span></span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="New group floor map"
              onChange={(e) => setNewGroupFloor(e.target.files?.[0] ?? null)}
              className="block text-sm text-slate-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:text-sm file:font-bold file:text-slate-700 hover:file:bg-slate-50"
            />
          </label>
          {newGroupError && (
            <p role="alert" className="text-sm font-semibold text-rose-600">{newGroupError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!newGroupName.trim() || newGroupBusy}
              className="h-11 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              style={brand}
            >
              {newGroupBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Creating" /> : 'Create group'}
            </button>
            <button type="button" onClick={resetNewGroup} className="h-11 px-3 text-sm font-bold text-slate-500 hover:text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* §6 assurance strip REMOVED (2026-09-14, Greg: "the top items are all
          unactionable … don't add shit just for fun"). Every count it carried is
          either a filter chip below (which actually narrows the list) or lives
          on the Overview pills with a drill-in. */}

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
            {/* A problem chip with nothing behind it is a dead button (2026-09-14,
                Greg: "make sure these filters are legit and useful"): All and
                Needs attention always show; Content behind / Push delayed /
                Offline only when they have screens to show — or while active. */}
            {ops.chips.filter((c) => c.key === 'all' || c.key === 'attention' || c.count > 0 || c.key === filter).map((chip) => {
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
          <div className={!isLoading && !isError && ops.rows.length > 0 && visibleCount > 0 ? undefined : 'bg-white rounded-2xl border border-slate-200 overflow-hidden'}>
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
                  onClick={() => onPairScreen()}
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
                {/* Desktop / tablet: one card per group, each with its own
                    semantic table (§14). 2026-09-14 (Greg), after the soft
                    brand wash: "still more separation between groups — I
                    think we separate them completely." */}
                <div className="hidden lg:block space-y-3" data-testid="screens-desktop">
                  {visibleGroups.map((g) => {
                    const expanded = isExpanded(g);
                    const contact = g.lastContactMs
                      ? new Date(g.lastContactMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
                      : '—';
                    return (
                      <section key={g.id} id={`screen-group-${g.id}`} aria-labelledby={`screen-group-${g.id}-name`} className={GROUP_CARD_CLASS}>
                        {/* ── Group bar ── */}
                        <div style={GROUP_ROW_STYLE} className="flex items-center gap-3 px-5 py-2.5">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
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
                                  <h3 id={`screen-group-${g.id}-name`} className="text-[13.5px] font-bold text-slate-800 truncate">{g.name}</h3>
                                  <span className="text-[12px] font-semibold text-slate-400 shrink-0">({g.rows.length})</span>
                                </>
                              )}
                            </div>
                            <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold shrink-0 ${
                              g.attention > 0 ? 'text-rose-600' : 'text-emerald-600'
                            }`}>
                              {g.attention > 0
                                ? <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                              {g.summary}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 shrink-0 tabular-nums">
                              <span className={`w-2 h-2 rounded-full ${g.online === g.rows.length ? 'bg-emerald-500' : g.online === 0 ? 'bg-slate-400' : 'bg-amber-500'}`} aria-hidden />
                              {contact}
                            </span>
                            {g.id !== UNGROUPED_ID ? (
                              <div className="relative inline-block shrink-0">
                                <button
                                  type="button"
                                  ref={(el) => { groupKebabRefs.current[g.id] = el; }}
                                  aria-label={`More actions for ${g.name}`}
                                  aria-expanded={groupMenu === g.id}
                                  data-popover-trigger
                                  onClick={(e) => { e.stopPropagation(); setGroupMenu(groupMenu === g.id ? null : g.id); }}
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-200/60"
                                >
                                  <MoreVertical className="w-4 h-4" aria-hidden />
                                </button>
                                <AnchoredMenu
                                  anchorRef={{ current: groupKebabRefs.current[g.id] ?? null }}
                                  open={groupMenu === g.id}
                                  width={224}
                                  ariaLabel={`Actions for ${g.name}`}
                                >
                                    {groupMenuItems({ id: g.id, name: g.name, rows: g.rows })}
                                </AnchoredMenu>
                              </div>
                            ) : (
                              <span className="w-8 shrink-0" aria-hidden />
                            )}
                        </div>

                        {/* ── Screen rows — the group's own table ── */}
                        {expanded && g.rows.length > 0 && (
                          <table className="w-full border-collapse">
                            <caption className="sr-only">
                              {g.name}: {g.rows.length} screen{g.rows.length === 1 ? '' : 's'}, worst first.
                            </caption>
                            <thead>
                              <tr className="border-t border-slate-100">
                                <th scope="col" className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-5 pt-2.5 pb-1.5 w-[26%]">Screen</th>
                                <th scope="col" className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-3 pt-2.5 pb-1.5 w-[24%] hidden xl:table-cell">Content</th>
                                <th scope="col" className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-3 pt-2.5 pb-1.5 w-[22%]">Status</th>
                                <th scope="col" className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-3 pt-2.5 pb-1.5 w-[15%]">Last contact</th>
                                <th scope="col" className="text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-5 pt-2.5 pb-1.5 w-[13%]">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                        {g.rows.map((row) => {
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
                                  <ExpectedThumb expected={row.expected} className="w-[72px] h-[42px] shrink-0" />
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
                                      ref={(el) => { rowKebabRefs.current[s.id] = el; }}
                                      aria-label={`More actions for ${s.name ?? 'this screen'}`}
                                      aria-expanded={rowMenu === s.id}
                                      data-popover-trigger
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRowMenu(rowMenu === s.id ? null : s.id);
                                      }}
                                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
                                    >
                                      <MoreVertical className="w-4 h-4" aria-hidden />
                                    </button>
                                    <AnchoredMenu
                                      anchorRef={{ current: rowKebabRefs.current[s.id] ?? null }}
                                      open={rowMenu === s.id}
                                      ariaLabel={`Actions for ${s.name ?? 'this screen'}`}
                                    >
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); setRowMenu(null); setSelectedId(s.id); setDrawerTab('overview'); }}
                                          className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left">
                                          Open details
                                        </button>
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); setRowMenu(null); setSelectedId(s.id); setDrawerTab('actions'); }}
                                          className="w-full px-3.5 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                                          Settings
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
                                    </AnchoredMenu>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                            </tbody>
                          </table>
                        )}
                      </section>
                    );
                  })}
                  {emptyGroups.map((g) => (
                    <section key={g.id} id={`screen-group-${g.id}`} aria-labelledby={`screen-group-${g.id}-name`} className={GROUP_CARD_CLASS} data-testid="empty-group">
                      <div style={GROUP_ROW_STYLE} className="flex items-center gap-3 px-5 py-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1 pl-8">
                          <Building2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                          <h3 id={`screen-group-${g.id}-name`} className="text-[13.5px] font-bold text-slate-800 truncate">{g.name}</h3>
                          <span className="text-[12px] font-semibold text-slate-400 shrink-0">(0)</span>
                        </div>
                        <span className="text-[12.5px] font-semibold text-slate-400 shrink-0">No screens yet</span>
                          {/* 2026-09-14 (Greg): "just hide pair and add screen under the dots". */}
                          <div className="inline-flex items-center gap-1">
                            <div className="relative inline-block">
                              <button
                                type="button"
                                ref={(el) => { groupKebabRefs.current[g.id] = el; }}
                                aria-label={`More actions for ${g.name}`}
                                aria-expanded={groupMenu === g.id}
                                data-popover-trigger
                                onClick={(e) => { e.stopPropagation(); setGroupMenu(groupMenu === g.id ? null : g.id); }}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-200/60"
                              >
                                <MoreVertical className="w-4 h-4" aria-hidden />
                              </button>
                              <AnchoredMenu anchorRef={{ current: groupKebabRefs.current[g.id] ?? null }} open={groupMenu === g.id} width={224} ariaLabel={`Actions for ${g.name}`}>
                                {groupMenuItems({ id: g.id, name: g.name, rows: [] })}
                              </AnchoredMenu>
                            </div>
                          </div>
                      </div>
                    </section>
                  ))}
                </div>

                {/* Mobile: cards, never a horizontally scrolling table (§12). */}
                <ul className="lg:hidden space-y-3">
                  {visibleGroups.map((g) => {
                    const expanded = isExpanded(g);
                    return (
                      <li key={g.id} className={GROUP_CARD_CLASS}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setManualExpand((m) => ({ ...m, [g.id]: !expanded }))}
                          style={GROUP_ROW_STYLE}
                          className="w-full min-h-11 px-4 py-3 flex items-center gap-2 text-left"
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
                                <li
                                  key={s.id}
                                  ref={(el) => { mobileRowRefs.current[s.id] = el; }}
                                  className="border-t border-slate-100"
                                >
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
                  {/* Empty groups sit at the list level, one card each. (Until
                      2026-09-14 they were nested inside every EXPANDED group's
                      list — invisible while groups start collapsed.) */}
                  {emptyGroups.map((g) => (
                    <li key={g.id} style={GROUP_ROW_STYLE} className={`${GROUP_CARD_CLASS} px-4 py-3 flex items-center gap-2`} data-testid="empty-group">
                      <Building2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                      <span className="text-[13.5px] font-bold text-slate-800 flex-1 min-w-0 truncate">{g.name}</span>
                      <span className="text-[11.5px] font-semibold text-slate-400">No screens yet</span>
                      <div className="relative inline-block">
                        <button
                          type="button"
                          ref={(el) => { groupKebabRefs.current[`m-${g.id}`] = el; }}
                          aria-label={`More actions for ${g.name}`}
                          aria-expanded={groupMenu === `m-${g.id}`}
                          data-popover-trigger
                          onClick={(e) => { e.stopPropagation(); setGroupMenu(groupMenu === `m-${g.id}` ? null : `m-${g.id}`); }}
                          className="w-11 h-11 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-200/60"
                        >
                          <MoreVertical className="w-4 h-4" aria-hidden />
                        </button>
                        <AnchoredMenu anchorRef={{ current: groupKebabRefs.current[`m-${g.id}`] ?? null }} open={groupMenu === `m-${g.id}`} width={224} ariaLabel={`Actions for ${g.name}`}>
                          {groupMenuItems({ id: g.id, name: g.name, rows: [] })}
                        </AnchoredMenu>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          )}

          {viewMode === 'list' && !isLoading && !isError && ops.rows.length > 0 && (
            <p className="text-[12px] font-semibold text-slate-400 px-1">
              {filtering
                ? `Showing ${visibleCount} of ${ops.totals.screens} screen${ops.totals.screens === 1 ? '' : 's'}`
                : `${ops.totals.screens} screen${ops.totals.screens === 1 ? '' : 's'} across ${ops.groups.length} group${ops.groups.length === 1 ? '' : 's'}`}
            </p>
          )}
        </>
      )}

      {addTo && (
        <AddScreensToGroupDialog
          group={addTo}
          screens={screens}
          onClose={() => setAddTo(null)}
          onAdded={(n) => { setToast(`${n} screen${n === 1 ? '' : 's'} moved to “${addTo.name}”.`); onChanged(); }}
        />
      )}

      {/* ─── How to connect a screen — the (i) beside Pair screen ─── */}
      {howToOpen && connectSlot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How to connect a screen"
          className="fixed top-0 right-0 bottom-0 left-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
        >
          <button type="button" aria-label="Close dialog" onClick={() => setHowToOpen(false)} className="absolute top-0 right-0 bottom-0 left-0 cursor-default" />
          <div className="relative w-full max-w-3xl mt-6 mb-10">
            <button
              type="button"
              onClick={() => setHowToOpen(false)}
              aria-label="Close dialog"
              className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-slate-500 hover:text-slate-800"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
            {connectSlot}
          </div>
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
          onOpenDisplaySchedule={() =>
            onOpenDisplaySchedule({ kind: 'screen', id: selectedRow.screen.id, name: selectedRow.screen.name ?? 'Screen' })}
          pushState={pushState[selectedRow.screen.id]}
          apkPending={forceApk.isPending}
          onPushApk={() => {
            const id = selectedRow.screen.id;
            const prior = (selectedRow.screen as any).playerVersion ?? null;
            forceApk.mutate({ screenId: id }, {
              onSuccess: () => {
                markPushed(id, prior);
                setToast(`Update request sent to “${selectedRow.screen.name ?? 'this screen'}”. The device installs it on its next check-in.`);
                onChanged();
              },
              onError: (e: any) => setToast(`Push failed: ${e?.message || 'unknown error'}`),
            });
          }}
          onRefreshWeb={() => {
            refreshWeb.mutate({ screenId: selectedRow.screen.id }, {
              onSuccess: () => {
                setToast(`Refresh sent to “${selectedRow.screen.name ?? 'this screen'}”. Its player page reloads in a few seconds.`);
                onChanged();
              },
              onError: (e: any) => setToast(`Couldn’t send the refresh: ${e?.message || 'unknown error'}`),
            });
          }}
          refreshWebPending={refreshWeb.isPending}
          syncActive={selectedRow.screen.syncActive === true}
          syncStatus={syncStatusFor(selectedRow.screen, screens, now)}
          onSetLocation={onSetScreenLocation
            ? () => onSetScreenLocation({ id: selectedRow.screen.id, name: selectedRow.screen.name ?? 'Screen', address: (selectedRow.screen as any).address ?? null })
            : undefined}
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
