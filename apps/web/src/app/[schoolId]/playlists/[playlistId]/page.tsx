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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import {
  usePlaylistDelivery, usePlaylists, useRefreshWeb, useSchedules,
  useScreenGroups, useScreens, useSetPlaylistActive, useSetPlaylistSync,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';
import {
  PlaylistWorkspace, resolveWorkspaceTab, type WorkspaceTab,
} from '@/components/playlists/v1/PlaylistWorkspace';
import {
  buildPlaylistRow, deriveDeliveryFromScreens, pauseEverywhereCopy, resolveTargetScreenIds,
  summarizeDeliveryPayload, DELIVERY_UNAVAILABLE,
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
  const schedulesQuery = useSchedules();
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const deliveryQuery = usePlaylistDelivery(playlistId, { enabled: tab === 'screens' });
  const setPlaylistActive = useSetPlaylistActive();
  const refreshWeb = useRefreshWeb();
  const [refreshingScreenId, setRefreshingScreenId] = useState<string | null>(null);

  /**
   * "Add screens" (Greg, 2026-09-16: "i should be able to see what screens its
   * published to and add more screens easily"). One click from the Screens tab
   * into the editor's own Publish to Screens sheet.
   *
   * The tab switch is load-bearing, not cosmetic. The editor is `display:none`
   * behind Screens and the sheet renders INSIDE it, so it cannot paint until
   * the editor is the visible half. Both happen in one click, under a
   * full-screen sheet, so the operator never sees the switch.
   */
  const [publishNonce, setPublishNonce] = useState(0);
  const handleAddScreens = useCallback(() => {
    setTab('schedule');
    setPublishNonce((n) => n + 1);
  }, [setTab]);

  const playlists = useMemo(() => ((playlistsQuery.data as any[] | undefined) ?? []), [playlistsQuery.data]);
  const schedules = useMemo(() => ((schedulesQuery.data as OpsScheduleRef[] | undefined) ?? []), [schedulesQuery.data]);
  const screens = useMemo(() => ((screensQuery.data as OpsScreenRef[] | undefined) ?? []), [screensQuery.data]);
  const groups = useMemo(() => ((groupsQuery.data as OpsGroupRef[] | undefined) ?? []), [groupsQuery.data]);

  const playlist = useMemo(() => playlists.find((p) => p.id === playlistId), [playlists, playlistId]);
  const mySchedules = useMemo(
    () => schedules.filter((s) => s.playlistId === playlistId),
    [schedules, playlistId],
  );

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
    if (deliveryAnswered) return summarizeDeliveryPayload(deliveryQuery.data!);
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
    <PlaylistWorkspace
      row={row}
      loading={playlistsQuery.isLoading}
      notFound={!playlistsQuery.isLoading && !playlistsQuery.isError && !playlist}
      tab={tab}
      onTab={setTab}
      onBack={() => router.push(`/${schoolId}/playlists`)}
      onToggleSync={(next) => setPlaylistSync.mutate({ id: playlistId, sync: next })}
      syncPending={setPlaylistSync.isPending}
      onAddScreens={handleAddScreens}
      editor={
        <ClassicPlaylistsPage
          embedPlaylistId={playlistId}
          embedSection={tab === 'schedule' ? 'publishing' : 'content'}
          embedPublishNonce={publishNonce}
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
  );
}
