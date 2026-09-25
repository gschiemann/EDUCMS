"use client";

/**
 * /[schoolId]/playlists/[playlistId] — the durable playlist workspace.
 *
 * The handoff's §6.8: the old detail view was `selectedId` inside the list
 * page, so refresh, Back and copy-link all lost it. This route fixes exactly
 * that. `?tab=content|screens|schedule` addresses the section, and
 * a tab change is a history REPLACE — flipping between tabs should not fill
 * the operator's Back button with four steps before they reach the library.
 *
 * Data layer only: presentation lives in components/playlists/v1/, and Content
 * + Publishing mount the preserved classic editor (see PlaylistWorkspace's
 * header for why).
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import {
  usePlaylistDelivery, usePlaylists, useRefreshWeb, useSchedules,
  useScreenGroups, useScreens, useSetPlaylistActive, useSetPlaylistSync,
  useSetPlaylistScreenActive, useRemovePlaylistScreen,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';
import { apiFetch } from '@/lib/api-client';
import type { VideoOptimization } from '@/hooks/use-video-optimization';
import {
  PlaylistWorkspace, resolveWorkspaceTab, type WorkspaceTab,
} from '@/components/playlists/v1/PlaylistWorkspace';
import { AddScreensDialog } from '@/components/playlists/v1/PlaylistDialogs';
import {
  buildPlaylistRow, deriveDeliveryFromScreens, describeScreenConflicts, findScreenConflicts,
  pauseEverywhereCopy, resolveTargetScreenIds,
  summarizeDelivery, summarizeDeliveryPayload, overlayCurrentScreenHealth, DELIVERY_UNAVAILABLE,
  type OpsGroupRef, type OpsScheduleRef, type OpsScreenRef,
} from '@/components/playlists/v1/playlistOps';

/** The editor is the classic page; lazy so the library never pays for it. */
const ClassicPlaylistsPage = dynamic(() => import('../ClassicPlaylistsPage'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--brand-primary, #6366f1)' }} />
    </div>
  ),
});
const InlineDownloadButton = dynamic(
  () => import('../ClassicPlaylistsPage').then((m) => m.InlineDownloadButton),
  { ssr: false, loading: () => null },
);

export default function PlaylistWorkspacePage() {
  const params = useParams<{ schoolId: string; playlistId: string }>();
  const router = useRouter();
  const schoolId = params?.schoolId || '';
  const playlistId = params?.playlistId || '';
  const currentUser = useUIStore((s) => s.user);
  const isViewer = currentUser?.role === 'RESTRICTED_VIEWER';
  // "Keep screens in sync" (2026-09-16) — moved off the screen group's ⋮ menu.
  const setPlaylistSync = useSetPlaylistSync();

  // ── ?tab= is the section (§3). Read once, then kept in sync by replace. ──
  const [tab, setTabState] = useState<WorkspaceTab>('content');
  const [tabReady, setTabReady] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = new URLSearchParams(window.location.search).get('tab');
      // `resolve`, not `is`: ?tab=publishing and ?tab=delivery are the names
      // these sections had before 2026-09-16, and a saved link must still land
      // on the section it meant rather than quietly on Content.
      const resolved = resolveWorkspaceTab(v);
      if (resolved) setTabState(resolved);
    } catch { /* malformed URL — content is the default */ }
    setTabReady(true);
  }, []);
  const setTab = useCallback((next: WorkspaceTab) => {
    setTabState(next);
    if (typeof window === 'undefined') return;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (next === 'content') sp.delete('tab'); else sp.set('tab', next);
      const qs = sp.toString();
      // REPLACE, not push: three tabs should not become three Back presses
      // between the operator and the library.
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    } catch { /* the tab still switched */ }
  }, []);

  // ── data ──
  const playlistsQuery = usePlaylists();
  const queryClient = useQueryClient();
  const schedulesQuery = useSchedules();
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const deliveryQuery = usePlaylistDelivery(playlistId, { enabled: tab === 'screens' });
  const setPlaylistActive = useSetPlaylistActive();
  const refreshWeb = useRefreshWeb();
  const setScreenActive = useSetPlaylistScreenActive();
  const removeScreen = useRemovePlaylistScreen();

  /**
   * Take one screen off this playlist. Greg, 2026-09-16: "how do i delete
   * screens out of the playlist?" — you could not. The power switch only
   * PAUSED, and the only removal was deleting a whole schedule from the
   * Schedule tab, which drops every screen in that window.
   *
   * Confirmed first: this deletes a rule and takes content off a physical
   * screen. The kebab only offers it for a screen with its own rule — one
   * reached through a group would take the whole group with it.
   */
  const handleRemoveScreen = useCallback(async (screenId: string, screenName: string) => {
    const ok = await appConfirm({
      title: `Stop playing on ${screenName}?`,
      message: `This playlist is removed from ${screenName}. Whatever that screen shows next comes from its other schedules, or it falls back to its idle screen.`,
      confirmLabel: 'Remove screen',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removeScreen.mutateAsync({ playlistId, screenId });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't remove that screen",
        message: err?.message || 'The server rejected the request. Refresh and try again.',
        tone: 'danger',
      });
    }
  }, [removeScreen, playlistId]);
  const [refreshingScreenId, setRefreshingScreenId] = useState<string | null>(null);

  /**
   * "Add screens" (Greg, 2026-09-16, pointing at the create wizard's Step 3:
   * "when i hit add screens it should pull up this menu for me to add more
   * screens to my playlist").
   *
   * It opens THAT picker — the wizard's own component — not the Publish to
   * Screens sheet this button used to reach. The sheet is a screen picker with
   * a schedule window attached, which is right for a first publish and wrong
   * for "add one more screen"; routing here through it also meant a tab switch
   * to un-hide the editor it renders inside. The dialog is portaled, so no tab
   * has to move.
   */
  const [addScreensOpen, setAddScreensOpen] = useState(false);
  const handleAddScreens = useCallback(() => setAddScreensOpen(true), []);

  const playlists = useMemo(() => ((playlistsQuery.data as any[] | undefined) ?? []), [playlistsQuery.data]);
  const schedules = useMemo(() => ((schedulesQuery.data as OpsScheduleRef[] | undefined) ?? []), [schedulesQuery.data]);
  const screens = useMemo(() => ((screensQuery.data as OpsScreenRef[] | undefined) ?? []), [screensQuery.data]);
  const groups = useMemo(() => ((groupsQuery.data as OpsGroupRef[] | undefined) ?? []), [groupsQuery.data]);

  const playlist = useMemo(() => playlists.find((p) => p.id === playlistId), [playlists, playlistId]);
  const mySchedules = useMemo(
    () => schedules.filter((s) => s.playlistId === playlistId),
    [schedules, playlistId],
  );
  const preparingMedia = mySchedules.some((s) => s.pendingMedia && !s.pendingMediaError);
  const playbackAssetIds = useMemo(() => [...new Set(((playlist?.items as any[]) ?? [])
    .map((item) => item?.asset?.id)
    .filter((id): id is string => typeof id === 'string'))].slice(0, 200), [playlist]);
  const playbackJobs = useQuery({
    queryKey: ['playlist-playback-preparation', playlistId, playbackAssetIds.join(',')],
    queryFn: () => apiFetch<{ items: Array<VideoOptimization & { assetId: string }> }>(
      `/assets/optimization?ids=${encodeURIComponent(playbackAssetIds.join(','))}`,
    ),
    enabled: preparingMedia && playbackAssetIds.length > 0,
    refetchInterval: preparingMedia ? 5_000 : false,
    retry: false,
  });
  const wasPreparing = useRef(false);
  useEffect(() => {
    if (wasPreparing.current && !preparingMedia) {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    }
    wasPreparing.current = preparingMedia;
  }, [preparingMedia, queryClient]);
  const playbackProgress = useMemo(() => {
    const jobs = playbackJobs.data?.items ?? [];
    const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running');
    // A single encoder reports a real percentage. Averaging unrelated jobs
    // would imply a precise playlist-wide percentage that we do not have.
    return active.length === 1 && typeof active[0].progress === 'number' ? active[0].progress : null;
  }, [playbackJobs.data]);

  const row = useMemo(() => {
    if (!playlist) return null;
    const assetNames = ((playlist.items as any[]) ?? [])
      .map((it) => it?.asset?.originalName)
      .filter((n: unknown): n is string => typeof n === 'string');
    return buildPlaylistRow({
      playlist, schedules: mySchedules, screens, groups, now: new Date(), assetNames,
    });
  }, [playlist, mySchedules, screens, groups]);

  const targetScreens = useMemo(() => {
    const ids = new Set(resolveTargetScreenIds(mySchedules, groups, screens));
    return screens.filter((s) => ids.has(s.id));
  }, [mySchedules, groups, screens]);

  /**
   * The Screens tab's rows. Resolved here because this is the only place that
   * holds the rules AND the groups.
   *
   * A screen's own per-screen rule is what its power switch may touch. A screen
   * reached only through a GROUP rule has no rule of its own, so the switch is
   * disabled and says which group owns it — switching that rule would take
   * every screen in the group dark, which is not what "turn this screen off"
   * means to anyone.
   */
  const screenRows = useMemo(() => {
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const own = new Map<string, { id: string; active: boolean }>();
    const via = new Map<string, { name: string; active: boolean }>();
    for (const s of mySchedules) {
      const active = s.isActive !== false;
      if (s.screenId) own.set(s.screenId, { id: s.id, active });
      if (s.screenGroupId) {
        const g = groupById.get(s.screenGroupId);
        const members = g?.screens ?? screens.filter((sc) => sc.screenGroupId === s.screenGroupId);
        for (const m of members) {
          if (m?.id) via.set(m.id, { name: g?.name || 'its group', active });
        }
      }
    }
    return targetScreens.map((s) => {
      const mine = own.get(s.id);
      const grouped = via.get(s.id);
      return {
        id: s.id,
        name: s.name || s.id,
        online: s.status === 'ONLINE',
        scheduleId: mine?.id ?? null,
        viaGroupName: mine ? null : (grouped?.name ?? null),
        active: mine?.active ?? grouped?.active ?? true,
      };
    });
  }, [targetScreens, mySchedules, groups, screens]);

  /**
   * The power button on a screen row (2026-09-19).
   *
   * Greg: "we add the group when creating the playlist so that its easy to add
   * them all at once but after its created its up to the user if the want to
   * disable a screen from a playlist". So it works on EVERY row now, including
   * the ones that are only here through a group — the server splits that group
   * rule so one screen changes and the rest keep playing.
   *
   * Switching a screen ON is a FIFTH door onto "one screen, two playlists" —
   * the four that already ask (add screens, publish, new playlist, turn a
   * playlist on) would be pointless if this one did not. Same rule, same
   * prompt, same time-awareness. What differs is how the other playlist is
   * stood down: on THIS SCREEN ONLY, through the same playlist-scoped door.
   * The older doors toggle the competitor's whole rule, which for a group rule
   * blanks it on every screen in the group — more than "Replace on 1 screen"
   * ever promised.
   *
   * Declared down here, below the data it closes over and above the early
   * return, because a hook that lands under a return is a crash, not a lint.
   */
  const handleToggleScreen = useCallback(async (screenId: string, screenName: string, next: boolean) => {
    try {
      if (next) {
        const screen = screens.find((sc) => sc.id === screenId);
        const reaches = mySchedules.filter(
          (sc) => sc.screenId === screenId
            || (!!sc.screenGroupId && sc.screenGroupId === (screen as any)?.screenGroupId),
        );
        const conflicts = findScreenConflicts({
          targetScreenIds: [screenId],
          windows: reaches.map((sc) => ({ daysOfWeek: sc.daysOfWeek, timeStart: sc.timeStart, timeEnd: sc.timeEnd })),
          excludePlaylistId: playlistId,
          playlists: playlists as any,
          schedules,
          screens,
          groups,
        });
        const prompt = describeScreenConflicts(conflicts, playlist?.name || 'this playlist', 'switch-on');
        if (prompt) {
          const ok = await appConfirm({
            title: prompt.title, message: prompt.message, tone: 'warn', confirmLabel: prompt.confirmLabel,
          });
          if (!ok) return;
          for (const c of conflicts) {
            await setScreenActive.mutateAsync({ playlistId: c.playlistId, screenId, active: false });
          }
        }
      }
      await setScreenActive.mutateAsync({ playlistId, screenId, active: next });
    } catch (err: any) {
      await appAlert({
        title: next ? `Couldn't start it on ${screenName}` : `Couldn't stop it on ${screenName}`,
        message: err?.message || 'The server rejected the request. Refresh and try again.',
        tone: 'danger',
      });
    }
  }, [setScreenActive, playlistId, playlist, playlists, schedules, screens, groups, mySchedules]);

  /**
   * Which delivery source is answering?
   *   • The query has not run yet (tab !== screens) → derive, so the header's
   *     exception summary is still truthful on Content/Publishing.
   *   • The query ran and returned a payload → that is the authority.
   *   • The query ran and returned null → the READ FAILED. Say so (§22.5);
   *     never silently swap in the derivation and present it as deployment
   *     truth, and never fall back to a calm gray.
   */
  // `data.latest != null`, not just `data != null`. The endpoint answers
  // `{latest: null, history: []}` for a playlist that has never been PUSHED —
  // which is not the same as "not on any screen". Treating that as an answer
  // is what let the Screens tab print "Not published" above a screen that was
  // listed, reachable and picture-confirmed (Greg, 2026-09-16). The table has
  // always keyed off `payload?.latest`; now the summary agrees with it.
  const deliveryAnswered =
    deliveryQuery.isFetched && deliveryQuery.data != null && (deliveryQuery.data as any)?.latest != null;
  const deliveryFailed = deliveryQuery.isFetched && deliveryQuery.data == null;
  const deliverySummary = useMemo(() => {
    if (deliveryAnswered && deliveryQuery.data?.latest) {
      return summarizeDelivery(overlayCurrentScreenHealth(deliveryQuery.data.latest.targets, targetScreens));
    }
    if (deliveryFailed) return DELIVERY_UNAVAILABLE;
    return targetScreens.length > 0
      ? deriveDeliveryFromScreens(targetScreens)
      : summarizeDeliveryPayload({ latest: null, history: [] });
  }, [deliveryAnswered, deliveryFailed, deliveryQuery.data, targetScreens]);

  /** §19.2 — exact reach in the confirmation, before anything is disabled. */
  const handlePauseEverywhere = useCallback(async () => {
    if (!row) return;
    const copy = pauseEverywhereCopy(row.name, row.reach, mySchedules.length);
    const ok = await appConfirm({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirmLabel,
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await setPlaylistActive.mutateAsync({ id: row.id, active: false });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't pause this playlist",
        message: err?.message || 'The server rejected the request. Refresh and try again.',
        tone: 'danger',
      });
    }
  }, [row, mySchedules.length, setPlaylistActive]);

  /**
   * The other direction. No confirm: starting a paused playlist restores what
   * the operator already chose, and Greg asked for one button that just does
   * it. Pausing keeps its confirmation because that TAKES content off screens.
   */
  const handleResumeEverywhere = useCallback(async () => {
    if (!row) return;
    try {
      await setPlaylistActive.mutateAsync({ id: row.id, active: true });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't start this playlist",
        message: err?.message || 'The server rejected the request. Refresh and try again.',
        tone: 'danger',
      });
    }
  }, [row, setPlaylistActive]);

  const handleRefreshScreen = useCallback(async (screenId: string) => {
    setRefreshingScreenId(screenId);
    try {
      await refreshWeb.mutateAsync({ screenId });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't reach that screen",
        message: err?.message || 'The request was not accepted. Try again in a moment.',
        tone: 'danger',
      });
    } finally {
      setRefreshingScreenId(null);
    }
  }, [refreshWeb]);

  // Hold the decision until ?tab= has been read — landing on Content and
  // swapping to Screens a frame later is the same first-guess flash the
  // dashboard rollback taught us to refuse.
  if (!tabReady) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-8 w-64 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-11 w-full max-w-md rounded-xl bg-slate-100 animate-pulse" />
        <div className="h-[420px] w-full rounded-2xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <>
    <PlaylistWorkspace
      row={row}
      playbackProgress={preparingMedia ? playbackProgress : null}
      loading={playlistsQuery.isLoading}
      notFound={!playlistsQuery.isLoading && !playlistsQuery.isError && !playlist}
      tab={tab}
      onTab={setTab}
      onBack={() => router.push(`/${schoolId}/playlists`)}
      onToggleSync={(next) => setPlaylistSync.mutate({ id: playlistId, sync: next })}
      syncPending={setPlaylistSync.isPending}
      onAddScreens={handleAddScreens}
      screenRows={screenRows}
      onToggleScreen={(screenId, screenName, next) => { void handleToggleScreen(screenId, screenName, next); }}
      onRemoveScreen={(screenId, screenName) => { void handleRemoveScreen(screenId, screenName); }}
      screenActionPending={setScreenActive.isPending || removeScreen.isPending}
      editor={
        <ClassicPlaylistsPage
          embedPlaylistId={playlistId}
          embedSection={tab === 'schedule' ? 'publishing' : 'content'}
        />
      }
      exportControl={row ? <InlineDownloadButton playlistId={row.id} playlistName={row.name} /> : null}
      ruleCount={mySchedules.length}
      targetScreens={targetScreens}
      delivery={{
        payload: deliveryQuery.data,
        loading: deliveryQuery.isLoading && tab === 'screens',
        // "Derived" ONLY when the endpoint has not answered AND has not failed.
        // A failure is its own state (§22.5) and must not masquerade as a
        // successful derivation.
        derived: !deliveryAnswered && !deliveryFailed,
        onRetry: () => { deliveryQuery.refetch(); screensQuery.refetch(); },
      }}
      deliverySummary={deliverySummary}
      onPauseEverywhere={handlePauseEverywhere}
      onResumeEverywhere={handleResumeEverywhere}
      pausePending={setPlaylistActive.isPending}
      onRefreshScreen={handleRefreshScreen}
      refreshingScreenId={refreshingScreenId}
      onOpenScreen={(screenId) => router.push(`/${schoolId}/screens?screen=${screenId}`)}
      isViewer={isViewer}
    />
    <AddScreensDialog
      open={addScreensOpen}
      onClose={() => setAddScreensOpen(false)}
      playlistId={playlistId}
      playlistName={playlist?.name ?? null}
      playlistItems={playlist?.items ?? []}
      screens={screens}
      groups={groups}
      schedules={mySchedules}
      // The conflict check needs EVERY playlist's rules, not just this one's.
      // `schedules` above stays scoped to this playlist because inheriting a
      // publish window from someone else's rule would be a silent bug.
      allSchedules={schedules}
      playlists={playlists}
      // Screens it already plays on are not offered again — adding a second
      // rule for the same screen is a duplicate, not an addition.
      alreadyScreenIds={new Set(targetScreens.map((s) => s.id))}
      onDone={() => { schedulesQuery.refetch(); screensQuery.refetch(); }}
    />
    </>
  );
}
