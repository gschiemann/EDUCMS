"use client";

/**
 * /[schoolId]/playlists — Playlists Operations v1 (2026-08-31).
 *
 * Design contract: scratch/design/playlists-page/PLAYLISTS-V1-DESIGN-HANDOFF.md
 * + playlists-operations-v1.png. This file is the data layer; every pixel of
 * the surface lives in `components/playlists/v1/`.
 *
 * THE CLASSIC LIBRARY IS GONE (2026-09-24). This route used to be a switcher:
 * a per-user "Classic view" preference (localStorage `venueos_playlists_view`)
 * and a one-visit `?classic=<id>` deep link could swap the whole page for the
 * pre-v1 library in ./ClassicPlaylistsPage.tsx. Greg, on seeing the footer
 * link three weeks after v1 shipped: "why is a classic view option still
 * showing...dump that shit, no more classic view". Both entry points are
 * removed and the stored preference is never read again — an operator who had
 * chosen classic simply lands on v1. ClassicPlaylistsPage.tsx itself stays,
 * because the v1 workspace still MOUNTS its editor for the Content and
 * Schedule tabs (see [playlistId]/page.tsx); the page-level library it also
 * carries is unreachable now.
 *
 * ── The rule this file exists to keep ────────────────────────────────
 *
 * GRACEFUL DEGRADATION IS NOT OPTIONAL. `GET /playlists/summary` and
 *    `GET /playlists/:id/delivery` are landing separately. When the summary
 *    endpoint is absent the identical row model is derived here from the full
 *    playlists payload — same UI, heavier read. When the delivery endpoint is
 *    absent the Delivery column is derived from each screen's OWN reported
 *    state (one screens read for the whole page — never one request per row,
 *    §26), and the workspace's Delivery tab says so out loud.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { normalizeVertical } from '@cms/api-types';
import {
  useCreatePlaylist, useDeletePlaylist, useFleet, usePlaylists, usePlaylistSummary,
  useReorderPlaylistItems, useSchedules, useScreenGroups, useScreens, useSetPlaylistActive,
  useTemplates,
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
  buildPlaylistRow, pauseEverywhereCopy, removePlaylistCopy,
  type OpsGroupRef, type OpsScheduleRef, type OpsScreenRef, type PlaylistSummaryRow,
} from '@/components/playlists/v1/playlistOps';

export default function PlaylistsPage() {
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const schoolId = params?.schoolId || '';
  const currentUser = useUIStore((s) => s.user);
  const token = useUIStore((s) => s.token);
  const isViewer = currentUser?.role === 'RESTRICTED_VIEWER';
  const isContributor = currentUser?.role === 'CONTRIBUTOR';
  const canFleetPublish = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'DISTRICT_ADMIN';

  // ── §5: the ?newPlaylist=1 contract ──────────────────────────────
  // The dashboard and the Assets page both link here with it (Assets also
  // stashes the picked asset ids in sessionStorage). Read once on mount and
  // stripped, so a refresh does not re-open the wizard.
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
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // §5 — Templates' "Put on a screen" express lane (?publishPlaylist=<id>).
  // v1 sends it straight to that playlist's Publishing tab, which is the same
  // destination with a durable URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const wantId = sp.get('publishPlaylist');
    if (!wantId) return;
    sp.delete('publishPlaylist');
    const qs = sp.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    router.push(`/${schoolId}/playlists/${wantId}?tab=schedule`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── data (all existing endpoints; the two new ones degrade to null) ──
  const playlistsQuery = usePlaylists();
  const schedulesQuery = useSchedules();
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const templatesQuery = useTemplates();
  const summaryQuery = usePlaylistSummary();
  const fleetQuery = useFleet({ enabled: canFleetPublish });
  const deletePlaylist = useDeletePlaylist();
  const createPlaylist = useCreatePlaylist();
  const saveItems = useReorderPlaylistItems();

  const isHQ = (fleetQuery.data?.locations?.length ?? 0) > 1;
  const vertical = normalizeVertical((fleetQuery.data?.root as { vertical?: string | null } | null)?.vertical);

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

  // Hooks stay ABOVE the render below and never behind an early return.
  // (This page used to carry a skeleton + classic-view return gate, and a hook
  // placed under it threw "Rendered more hooks than during the previous
  // render" the moment the preference resolved. The gate is gone; the rule
  // remains.)
  /**
   * Stop / start a playlist from the library row (2026-09-16). Greg: "let me
   * stop the playlist right from the main menu here".
   *
   * STOPPING CONFIRMS, starting does not — the same asymmetry the workspace's
   * Pause everywhere uses, and for the same reason: disabling every rule takes
   * content off physical screens and the operator deserves the blast radius
   * first (§19.2), while starting only restores what was already published.
   * The copy comes from the shared helper so both surfaces say the same thing.
   */
  const setPlaylistActive = useSetPlaylistActive();
  const handleSetActive = useCallback(async (row: PlaylistSummaryRow, next: boolean) => {
    if (!next) {
      // The rule COUNT, the same way the workspace derives it — the row model
      // carries reach, not the number of publishing rules behind it.
      const ruleCount = schedules.filter((sc) => sc.playlistId === row.id).length;
      const copy = pauseEverywhereCopy(row.name, row.reach, ruleCount);
      const ok = await appConfirm({
        title: copy.title,
        message: copy.message,
        confirmLabel: copy.confirmLabel,
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      await setPlaylistActive.mutateAsync({ id: row.id, active: next });
    } catch (err: any) {
      await appAlert({
        title: next ? "Couldn't start this playlist" : "Couldn't stop this playlist",
        message: err?.message || 'The server rejected the request. Refresh and try again.',
        tone: 'danger',
      });
    }
  }, [setPlaylistActive, schedules]);

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
        onSetActive={(row, next) => { void handleSetActive(row, next); }}
        isViewer={isViewer}
        isContributor={isContributor}
        isHQ={isHQ}
        creatorOptions={creatorOptions}
        screenOptions={screenOptions}
        groupOptions={groupOptions}
        groupOfScreen={groupOfScreen}
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
        // So Step 3 can warn before a new playlist takes a screen another one
        // is already on at the same time.
        playlists={playlists}
        allSchedules={schedules}
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
