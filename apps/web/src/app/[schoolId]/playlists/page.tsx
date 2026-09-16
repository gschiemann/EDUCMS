"use client";

/**
 * /[schoolId]/playlists — Playlists Operations v1, with the classic page one
 * click away (2026-08-31).
 *
 * Design contract: scratch/design/playlists-page/PLAYLISTS-V1-DESIGN-HANDOFF.md
 * + playlists-operations-v1.png. This file is the SWITCHER and the data layer;
 * every pixel of the default surface lives in `components/playlists/v1/`, and
 * the previous 3.3k-line page is preserved as ./ClassicPlaylistsPage.tsx.
 *
 * ── Three rules this file exists to keep ─────────────────────────────
 *
 * 1. NEVER PAINT THE WRONG VARIANT FIRST. The operator, hours before this
 *    shipped, about the dashboard's own rollback toggle: "everytime i click on
 *    the dashboard, i see the old classic dashboard for about .5 seconds and
 *    then the new one loads." The stored preference is read BEFORE either
 *    surface renders; until then a quiet skeleton holds the space.
 *
 * 2. THE COMMON PATH PAYS FOR ONE SURFACE. The classic page loads via
 *    next/dynamic, so an operator on v1 never downloads it. Fleet-wide
 *    rollback is the ONE constant below.
 *
 * 3. GRACEFUL DEGRADATION IS NOT OPTIONAL. `GET /playlists/summary` and
 *    `GET /playlists/:id/delivery` are landing separately. When the summary
 *    endpoint is absent the identical row model is derived here from the full
 *    playlists payload — same UI, heavier read. When the delivery endpoint is
 *    absent the Delivery column is derived from each screen's OWN reported
 *    state (one screens read for the whole page — never one request per row,
 *    §26), and the workspace's Delivery tab says so out loud.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { VERTICAL_LABELS, normalizeVertical } from '@cms/api-types';
import {
  useCreatePlaylist, useDeletePlaylist, useFleet, usePlaylists, usePlaylistSummary,
  useReorderPlaylistItems, useSchedules, useScreenGroups, useScreens, useTemplates,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';
import { PlaylistCreateWizard } from '@/components/playlists/PlaylistCreateWizard';
import { PublishToLocationsModal } from '@/components/playlists/PublishToLocationsModal';
import {
  canWriteToUsbFolder,
  downloadBundleAsZip,
  fetchUsbBundle,
  writeBundleToUsbFolder,
} from '@/lib/usb-export';
import { PlaylistLibraryV1 } from '@/components/playlists/v1/PlaylistLibraryV1';
import type { TemplateLookupEntry } from '@/components/playlists/PlaylistPreviewThumb';
import {
  buildPlaylistRow, removePlaylistCopy,
  type OpsGroupRef, type OpsScheduleRef, type OpsScreenRef, type PlaylistSummaryRow,
} from '@/components/playlists/v1/playlistOps';

/**
 * FLEET-WIDE ROLLBACK: flip this one constant to 'classic' and every operator
 * who has not made their own choice lands on the previous page. Nothing else
 * changes; no code is removed.
 */
const PLAYLISTS_VIEW_DEFAULT: 'v1' | 'classic' = 'v1';
const VIEW_PREF_KEY = 'venueos_playlists_view';

/**
 * The classic page is ~3.3k lines and pulls dnd-kit, the asset picker and the
 * publish sheet with it. Lazy so the default path never downloads it.
 * `ssr: false` because it reads window on mount (the ?newPlaylist= and
 * ?publishPlaylist= handoffs).
 */
const ClassicPlaylistsPage = dynamic(() => import('./ClassicPlaylistsPage'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-primary, #6366f1)' }} />
    </div>
  ),
});

export default function PlaylistsPage() {
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const schoolId = params?.schoolId || '';
  const currentUser = useUIStore((s) => s.user);
  const token = useUIStore((s) => s.token);
  const isViewer = currentUser?.role === 'RESTRICTED_VIEWER';
  const isContributor = currentUser?.role === 'CONTRIBUTOR';
  const canFleetPublish = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'DISTRICT_ADMIN';

  // ── which surface? (decide before painting either) ───────────────
  const [viewPref, setViewPref] = useState<'v1' | 'classic'>(PLAYLISTS_VIEW_DEFAULT);
  const [prefLoaded, setPrefLoaded] = useState(false);
  /** A one-visit hop into classic (a `?classic=` deep link), never persisted. */
  const [classicOnce, setClassicOnce] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_PREF_KEY);
      if (v === 'classic' || v === 'v1') setViewPref(v);
    } catch { /* storage unavailable — the default stands */ }
    setPrefLoaded(true);
  }, []);
  const setView = (v: 'v1' | 'classic') => {
    setViewPref(v);
    setClassicOnce(null);
    try { localStorage.setItem(VIEW_PREF_KEY, v); } catch { /* ignore */ }
  };
  const showClassic = viewPref === 'classic' || classicOnce !== null;

  // A `?classic=<id>` deep link — a ONE-VISIT hop into
  // the classic page, deep-linked at the playlist the operator was looking at,
  // for the handful of things it still owns exclusively. Never persisted, so
  // the next visit lands back on v1. Read before the surface decision is used,
  // and stripped so a refresh does not re-trigger it.
  useEffect(() => {
    if (!prefLoaded || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const want = sp.get('classic');
    if (!want) return;
    sp.delete('classic');
    const qs = sp.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    setClassicOnce(want);
  }, [prefLoaded]);

  // ── §5: the ?newPlaylist=1 contract must keep working on BOTH surfaces ──
  // The dashboard and the Assets page both link here with it (Assets also
  // stashes the picked asset ids in sessionStorage). The classic page runs its
  // own copy of this effect; this one covers the v1 library. Reading it here
  // while the classic surface is showing would consume the param before the
  // classic page mounts, so it is gated on `!showClassic` — and on
  // `prefLoaded`, so the gate is evaluated against a settled decision.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingAssetIds, setPendingAssetIds] = useState<string[] | undefined>(undefined);
  // Export to USB reports itself here — there is no imperative toast in this
  // app, and a bundle can take a while to build and write.
  const [usbExport, setUsbExport] = useState<
    { state: 'busy' | 'done' | 'error'; label: string; done?: number; total?: number } | null
  >(null);
  const [publishToLocationsOpen, setPublishToLocationsOpen] = useState(false);
  // Which row opened the sheet — it used to open with no playlist chosen.
  const [publishToLocationsId, setPublishToLocationsId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!prefLoaded || showClassic) return;
    if (typeof window === 'undefined') return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const wants = sp.get('newPlaylist') === '1';
      const raw = sessionStorage.getItem('edu_new_playlist_assets');
      if (!wants && !raw) return;
      let ids: string[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === 'string');
        } catch { /* malformed stash — open a blank wizard */ }
      }
      sessionStorage.removeItem('edu_new_playlist_assets');
      if (wants) {
        sp.delete('newPlaylist');
        const qs = sp.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
      if (ids.length > 0) setPendingAssetIds(ids);
      setWizardOpen(true);
    } catch { /* the library still renders */ }
    // Runs once the decision has settled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefLoaded, showClassic]);

  // §5 — Templates' "Put on a screen" express lane (?publishPlaylist=<id>).
  // v1 sends it straight to that playlist's Publishing tab, which is the same
  // destination with a durable URL.
  useEffect(() => {
    if (!prefLoaded || showClassic || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const wantId = sp.get('publishPlaylist');
    if (!wantId) return;
    sp.delete('publishPlaylist');
    const qs = sp.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    router.push(`/${schoolId}/playlists/${wantId}?tab=schedule`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefLoaded, showClassic]);

  // ── data (all existing endpoints; the two new ones degrade to null) ──
  const playlistsQuery = usePlaylists();
  const schedulesQuery = useSchedules();
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const templatesQuery = useTemplates();
  const summaryQuery = usePlaylistSummary({ enabled: !showClassic });
  const fleetQuery = useFleet({ enabled: canFleetPublish && !showClassic });
  const deletePlaylist = useDeletePlaylist();
  const createPlaylist = useCreatePlaylist();
  const saveItems = useReorderPlaylistItems();

  const isHQ = (fleetQuery.data?.locations?.length ?? 0) > 1;
  const vertical = normalizeVertical((fleetQuery.data?.root as { vertical?: string | null } | null)?.vertical);
  const locationNoun = VERTICAL_LABELS[vertical].plural.toLowerCase();

  const playlists = useMemo(() => ((playlistsQuery.data as any[] | undefined) ?? []), [playlistsQuery.data]);
  const schedules = useMemo(() => ((schedulesQuery.data as OpsScheduleRef[] | undefined) ?? []), [schedulesQuery.data]);
  const screens = useMemo(() => ((screensQuery.data as OpsScreenRef[] | undefined) ?? []), [screensQuery.data]);
  const groups = useMemo(() => ((groupsQuery.data as OpsGroupRef[] | undefined) ?? []), [groupsQuery.data]);

  const templateLookup = useMemo(() => {
    const out: Record<string, TemplateLookupEntry | undefined> = {};
    for (const t of ((templatesQuery.data as any[] | undefined) ?? [])) {
      out[t.id] = {
        zones: t.zones ?? [],
        screenWidth: t.screenWidth ?? 1920,
        screenHeight: t.screenHeight ?? 1080,
        bgImage: t.bgImage ?? null,
        bgGradient: t.bgGradient ?? null,
        bgColor: t.bgColor ?? null,
      };
    }
    return out;
  }, [templatesQuery.data]);

  /**
   * The row model. When `GET /playlists/summary` answers, its fields win for
   * everything it owns; the client still resolves reach, targets and delivery
   * because the summary contract carries no per-target evidence. When it does
   * NOT answer, every field is derived — identical UI, heavier read.
   */
  const rows: PlaylistSummaryRow[] = useMemo(() => {
    const now = new Date();
    const apiById = new Map(
      (summaryQuery.data?.playlists ?? []).map((r) => [r.id, r] as const),
    );
    return playlists.map((pl) => {
      const assetNames = ((pl.items as any[]) ?? [])
        .map((it) => it?.asset?.originalName)
        .filter((n: unknown): n is string => typeof n === 'string');
      const row = buildPlaylistRow({ playlist: pl, schedules, screens, groups, now, assetNames });
      const api = apiById.get(pl.id);
      if (!api) return row;
      // Server-owned fields override the derivation. Delivery, reach and the
      // target list stay client-resolved — the summary contract has no
      // per-target evidence, and a delivery claim must never be inferred from
      // a field that was not measured.
      return {
        ...row,
        name: api.name ?? row.name,
        kind: api.kind ?? row.kind,
        itemCount: api.itemCount ?? row.itemCount,
        durationMs: api.durationMs ?? row.durationMs,
        thumbnailUrl: api.thumbnailUrl ?? row.thumbnailUrl,
        templateSummary: api.templateSummary ?? row.templateSummary,
        creatorSummary: api.creatorSummary ?? row.creatorSummary,
        scheduleState: api.scheduleState ?? row.scheduleState,
        statusLabel: api.scheduleState ?? row.statusLabel,
        reviewState: api.reviewState ?? row.reviewState,
        scheduleSummary: api.scheduleSummary ?? row.scheduleSummary,
        updatedAt: api.updatedAt ?? row.updatedAt,
        sourceOwnership: api.sourceOwnership ?? row.sourceOwnership,
      };
    });
  }, [playlists, schedules, screens, groups, summaryQuery.data]);

  /**
   * Export to USB. This used to be `openWorkspace(id)` under the label
   * "Export for offline use" — it opened a page and exported nothing. It now
   * builds the signed, player-readable bundle and writes it where the operator
   * points, falling back to a .zip on browsers with no directory picker.
   */
  const runUsbExport = useCallback(async (id: string) => {
    const name = rows.find((r) => r.id === id)?.name ?? 'Playlist';
    setUsbExport({ state: 'busy', label: `Building ${name}…` });
    try {
      const buf = await fetchUsbBundle({ token, playlistId: id, playlistName: name });
      if (!canWriteToUsbFolder()) {
        downloadBundleAsZip(buf, name, new Date());
        setUsbExport({ state: 'done', label: `${name} downloaded — extract it onto the USB stick` });
        return;
      }
      const written = await writeBundleToUsbFolder(buf, (done, total) =>
        setUsbExport({ state: 'busy', label: `Writing ${name} to USB`, done, total }),
      );
      setUsbExport({ state: 'done', label: `Wrote ${written} files to the USB stick` });
    } catch (e) {
      // Dismissing the folder picker is a change of mind, not a failure.
      if ((e as { name?: string } | null)?.name === 'AbortError') { setUsbExport(null); return; }
      setUsbExport({ state: 'error', label: (e as Error)?.message || 'Export failed' });
    }
  }, [rows, token]);

  const rawById = useMemo(
    () => new Map<string, unknown>(playlists.map((p) => [p.id, p])),
    [playlists],
  );
  const groupOfScreen = useMemo(
    () => new Map(screens.map((s) => [s.id, s.screenGroupId ?? null])),
    [screens],
  );
  const creatorOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.creatorSummary).filter((c): c is string => !!c))).sort(),
    [rows],
  );
  const screenOptions = useMemo(
    () => screens.map((s) => ({ id: s.id, name: s.name || s.id })).sort((a, b) => a.name.localeCompare(b.name)),
    [screens],
  );
  const groupOptions = useMemo(
    () => groups.map((g) => ({ id: g.id, name: g.name || g.id })).sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  );

  const openWorkspace = useCallback(
    (id: string, tab?: string) => router.push(`/${schoolId}/playlists/${id}${tab ? `?tab=${tab}` : ''}`),
    [router, schoolId],
  );

  /**
   * §20 — removal. A playlist that is still publishing somewhere is BLOCKED
   * with "Review publishing" as the way out; the safe path is resolving usage.
   * When the API lands its 409 (`code: 'PLAYLIST_PUBLISHED'`), that answer wins
   * over the client's own reach estimate — the server sees copies at child
   * locations that this tenant's payload does not.
   *
   * There is no Trash UI anywhere on this surface: the backend deletes
   * permanently, and a restore we cannot honour must never be promised (§20.3).
   */
  const handleRemove = useCallback(async (row: PlaylistSummaryRow) => {
    const ruleCount = schedules.filter((s) => s.playlistId === row.id).length;
    const decision = removePlaylistCopy(row, ruleCount);
    if (decision.blocked) {
      const review = await appConfirm({
        title: decision.title,
        message: decision.message,
        confirmLabel: decision.primaryLabel ?? 'Review publishing',
        cancelLabel: 'Cancel',
        tone: 'warn',
      });
      if (review) openWorkspace(row.id, 'schedule');
      return;
    }
    const ok = await appConfirm({
      title: decision.title,
      message: decision.message,
      confirmLabel: decision.confirmLabel,
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deletePlaylist.mutateAsync(row.id);
    } catch (err: any) {
      if (err?.code === 'PLAYLIST_PUBLISHED') {
        const reach = err?.body?.reach ?? {};
        const bits = [
          reach.rules != null ? `${reach.rules} rules` : null,
          reach.screens != null ? `${reach.screens} screens` : null,
          reach.locations != null ? `${reach.locations} locations` : null,
        ].filter(Boolean).join(' · ');
        const review = await appConfirm({
          title: `“${row.name}” is currently published`,
          message: `${bits || 'It is still publishing.'}\n\nResolve or reassign its publishing rules before removing it.`,
          confirmLabel: 'Review publishing',
          cancelLabel: 'Cancel',
          tone: 'warn',
        });
        if (review) openWorkspace(row.id, 'schedule');
        return;
      }
      await appAlert({
        title: "Couldn't remove playlist",
        message: err?.message || 'The server rejected the request. Refresh and try again.',
        tone: 'danger',
      });
    }
  }, [schedules, deletePlaylist, openWorkspace]);

  /** §8.4 — Duplicate. Creates a real copy (name, template, ordered items). */
  const handleDuplicate = useCallback(async (id: string) => {
    const source = playlists.find((p) => p.id === id);
    if (!source) return;
    try {
      const created: any = await createPlaylist.mutateAsync({
        name: `${source.name} (copy)`,
        templateId: source.templateId ?? undefined,
      } as any);
      const items = (source.items as any[]) ?? [];
      if (created?.id && items.length > 0) {
        await saveItems.mutateAsync({
          playlistId: created.id,
          items: items.map((it, i) => ({
            assetId: it.assetId || it.asset?.id,
            durationMs: it.durationMs || 10_000,
            sequenceOrder: i,
            daysOfWeek: it.daysOfWeek || null,
            timeStart: it.timeStart || null,
            timeEnd: it.timeEnd || null,
            transitionType: it.transitionType || null,
            muted: it.asset?.mimeType?.startsWith('video/') ? (it.muted === false ? false : true) : true,
          })),
        } as any);
      }
      if (created?.id) openWorkspace(created.id);
    } catch (err: any) {
      await appAlert({
        title: "Couldn't duplicate playlist",
        message: err?.message || 'The copy was not created. Try again.',
        tone: 'danger',
      });
    }
  }, [playlists, createPlaylist, saveItems, openWorkspace]);

  // ── the decision gate: never guess which surface to paint ──────────
  if (!prefLoaded) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-9 w-40 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-11 w-full rounded-xl bg-slate-100 animate-pulse" />
        <div className="h-[420px] w-full rounded-2xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  if (showClassic) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setView('v1')}
            className="text-[12px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            Back to the new Playlists
          </button>
        </div>
        <ClassicPlaylistsPage initialPlaylistId={classicOnce ?? undefined} />
      </div>
    );
  }

  return (
    <>
      <PlaylistLibraryV1
        rows={rows}
        rawById={rawById}
        templateLookup={templateLookup}
        loading={playlistsQuery.isLoading}
        error={playlistsQuery.isError}
        onRetry={() => {
          playlistsQuery.refetch();
          screensQuery.refetch();
          schedulesQuery.refetch();
        }}
        onOpen={(id) => openWorkspace(id)}
        onReviewDelivery={(id) => openWorkspace(id, 'screens')}
        onNew={() => setWizardOpen(true)}
        onDuplicate={handleDuplicate}
        onExport={(id) => { void runUsbExport(id); }}
        onRemove={handleRemove}
        onPublishToLocations={isHQ ? (id: string) => { setPublishToLocationsId(id); setPublishToLocationsOpen(true); } : undefined}
        onSubmitForReview={(id) => openWorkspace(id)}
        onSwitchClassic={() => setView('classic')}
        isViewer={isViewer}
        isContributor={isContributor}
        isHQ={isHQ}
        creatorOptions={creatorOptions}
        screenOptions={screenOptions}
        groupOptions={groupOptions}
        groupOfScreen={groupOfScreen}
        locationNoun={locationNoun}
        // The list never fires a per-row delivery request (§26). Until a
        // batched summary carries delivery, every cell is the client-side
        // rollup of each target screen's own reported state.
        deliveryDerived
      />

      {/* §5 — the five-step wizard, unchanged, mounted on the v1 surface so
          the ?newPlaylist=1 contract keeps landing somewhere real. */}
      <PlaylistCreateWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setPendingAssetIds(undefined); }}
        onCreated={(pl) => {
          setWizardOpen(false);
          setPendingAssetIds(undefined);
          openWorkspace(pl.id);
        }}
        initialAssetIds={pendingAssetIds}
      />

      {/* Keyed by playlist: the modal returns null AFTER its hooks, so it stays
          mounted between opens and its `useState(initialPlaylistId ?? '')`
          would only ever take the FIRST row's id. Remounting per playlist is
          what makes the preselection hold on the second open. */}
      {usbExport && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-[120] flex items-center gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-lg ${
            usbExport.state === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : usbExport.state === 'done'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-700'
          }`}
        >
          {usbExport.state === 'busy' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          <span>
            {usbExport.label}
            {usbExport.total ? ` — ${usbExport.done}/${usbExport.total}` : ''}
          </span>
          {usbExport.state !== 'busy' && (
            <button
              type="button"
              onClick={() => setUsbExport(null)}
              aria-label="Dismiss export status"
              className="opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <PublishToLocationsModal
        key={publishToLocationsId ?? 'none'}
        open={publishToLocationsOpen}
        onClose={() => setPublishToLocationsOpen(false)}
        initialPlaylistId={publishToLocationsId}
      />
    </>
  );
}
