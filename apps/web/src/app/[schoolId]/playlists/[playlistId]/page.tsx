"use client";

/**
 * /[schoolId]/playlists/[playlistId] — the durable playlist workspace.
 *
 * The handoff's §6.8: the old detail view was `selectedId` inside the list
 * page, so refresh, Back and copy-link all lost it. This route fixes exactly
 * that. `?tab=content|publishing|delivery|activity` addresses the section, and
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
  useAuditLog, usePlaylistDelivery, usePlaylists, useRefreshWeb, useSchedules,
  useScreenGroups, useScreens, useSetPlaylistActive,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';
import {
  PlaylistWorkspace, isWorkspaceTab, type ActivityEntry, type WorkspaceTab,
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
  // Mirrors the audit endpoint's own @RequireRoles set — a read that would 403
  // must present as "not available to your role", never as an empty history.
  const canReadAudit =
    currentUser?.role === 'SUPER_ADMIN'
    || currentUser?.role === 'DISTRICT_ADMIN'
    || currentUser?.role === 'SCHOOL_ADMIN';

  // ── ?tab= is the section (§3). Read once, then kept in sync by replace. ──
  const [tab, setTabState] = useState<WorkspaceTab>('content');
  const [tabReady, setTabReady] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = new URLSearchParams(window.location.search).get('tab');
      if (isWorkspaceTab(v)) setTabState(v);
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
      // REPLACE, not push: four tabs should not become four Back presses
      // between the operator and the library.
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    } catch { /* the tab still switched */ }
  }, []);

  // ── data ──
  const playlistsQuery = usePlaylists();
  const schedulesQuery = useSchedules();
  const screensQuery = useScreens();
  const groupsQuery = useScreenGroups();
  const deliveryQuery = usePlaylistDelivery(playlistId, { enabled: tab === 'delivery' });
  const auditQuery = useAuditLog({ limit: 200, enabled: canReadAudit && tab === 'activity' });
  const setPlaylistActive = useSetPlaylistActive();
  const refreshWeb = useRefreshWeb();
  const [refreshingScreenId, setRefreshingScreenId] = useState<string | null>(null);

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
   *   • The query has not run yet (tab !== delivery) → derive, so the header's
   *     exception summary is still truthful on Content/Publishing.
   *   • The query ran and returned a payload → that is the authority.
   *   • The query ran and returned null → the READ FAILED. Say so (§22.5);
   *     never silently swap in the derivation and present it as deployment
   *     truth, and never fall back to a calm gray.
   */
  const deliveryAnswered = deliveryQuery.isFetched && deliveryQuery.data != null;
  const deliveryFailed = deliveryQuery.isFetched && deliveryQuery.data == null;
  const deliverySummary = useMemo(() => {
    if (deliveryAnswered) return summarizeDeliveryPayload(deliveryQuery.data!);
    if (deliveryFailed) return DELIVERY_UNAVAILABLE;
    return targetScreens.length > 0
      ? deriveDeliveryFromScreens(targetScreens)
      : summarizeDeliveryPayload({ latest: null, history: [] });
  }, [deliveryAnswered, deliveryFailed, deliveryQuery.data, targetScreens]);

  // ── §16 Activity: no per-target filter exists on /audit, so keep the rows
  // that name this playlist and say the feed is a recent window, not the
  // complete history.
  const activityEntries: ActivityEntry[] = useMemo(() => {
    const items = (auditQuery.data?.items as any[] | undefined) ?? [];
    return items
      .filter((it) => {
        if (it?.targetId === playlistId) return true;
        const d = it?.details;
        if (typeof d === 'string') return d.includes(playlistId);
        if (d && typeof d === 'object') return JSON.stringify(d).includes(playlistId);
        return false;
      })
      .map((it) => ({
        id: it.id,
        action: String(it.action ?? 'UNKNOWN'),
        actor: it.user?.email ?? null,
        createdAt: it.createdAt,
        detail: typeof it.details === 'string'
          ? it.details
          : it.details && typeof it.details === 'object' && typeof it.details.message === 'string'
            ? it.details.message
            : null,
      }));
  }, [auditQuery.data, playlistId]);

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
  // swapping to Delivery a frame later is the same first-guess flash the
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
      editor={
        <ClassicPlaylistsPage
          embedPlaylistId={playlistId}
          embedSection={tab === 'publishing' ? 'publishing' : 'content'}
        />
      }
      exportControl={row ? <InlineDownloadButton playlistId={row.id} playlistName={row.name} /> : null}
      ruleCount={mySchedules.length}
      targetScreens={targetScreens}
      delivery={{
        payload: deliveryQuery.data,
        loading: deliveryQuery.isLoading && tab === 'delivery',
        // "Derived" ONLY when the endpoint has not answered AND has not failed.
        // A failure is its own state (§22.5) and must not masquerade as a
        // successful derivation.
        derived: !deliveryAnswered && !deliveryFailed,
        onRetry: () => { deliveryQuery.refetch(); screensQuery.refetch(); },
      }}
      deliverySummary={deliverySummary}
      activity={{
        entries: activityEntries,
        loading: canReadAudit && auditQuery.isLoading,
        permitted: canReadAudit,
        complete: false,
      }}
      onPauseEverywhere={handlePauseEverywhere}
      pausePending={setPlaylistActive.isPending}
      onOpenClassicEditor={() => router.push(`/${schoolId}/playlists?classic=${playlistId}`)}
      onRefreshScreen={handleRefreshScreen}
      refreshingScreenId={refreshingScreenId}
      onOpenScreen={(screenId) => router.push(`/${schoolId}/screens?screen=${screenId}`)}
      isViewer={isViewer}
    />
  );
}
