import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

// ─── Tenant Status ──────────────────────────────────────────────
export function useTenantStatus() {
  return useQuery({
    queryKey: ['tenant-status'],
    queryFn: () => apiFetch('/tenants'),
    // 30s poll — emergency overrides are pushed via signed WebSocket
    // messages (the load-bearing path). This poll is a FALLBACK for the
    // rare case a client loses WS. 5s was overkill and was hammering the
    // API on every page because this hook mounts in the global shell.
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

// ─── Screen Groups ──────────────────────────────────────────────

export function useScreenGroups() {
  return useQuery({
    queryKey: ['screen-groups'],
    queryFn: () => apiFetch('/screen-groups'),
    // The Screens page renders screen status from the nested
    // `group.screens[]` (not from /screens), so this query drives the
    // ONLINE/OFFLINE pills in the grouped list. 10s cadence + REFETCH
    // IN BACKGROUND so a tab that's not the active focus (user walked
    // over to the actual screen to turn it off) still flips the pill
    // without requiring a hard refresh or window-focus event. staleTime
    // 0 so every interval hits the network — fleet state changes fast.
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });
}

export function useCreateScreenGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiFetch('/screen-groups', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['screen-groups'] }),
  });
}

export function useDeleteScreenGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/screen-groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useAssignScreens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, screenIds }: { groupId: string; screenIds: string[] }) =>
      apiFetch(`/screen-groups/${groupId}/screens`, {
        method: 'PUT',
        body: JSON.stringify({ screenIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

// ─── Screens (individual devices) ───────────────────────────────

export function useScreens() {
  return useQuery({
    queryKey: ['screens'],
    queryFn: () => apiFetch('/screens'),
    // Auto-refresh so a screen coming back online flips from OFFLINE to
    // ONLINE in the dashboard without a manual reload. 15s balances
    // freshness with backend load; screens page + dashboard both render
    // within this single query, so there's no duplicate polling.
    // Also refetch on window focus so switching back to the tab updates
    // immediately instead of showing stale state.
    // Near-real-time fleet status: dashboard polls every 10s so the
    // admin sees state changes within ~10s of them happening on the
    // wire (API-side staleness threshold is 45s). Combined worst case:
    // device dies → server marks OFFLINE on next list call → dashboard
    // picks it up within 10s = ~55s total lag.
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });
}

export function useCreateScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; location?: string; screenGroupId?: string }) =>
      apiFetch('/screens', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useUpdateScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; location?: string; screenGroupId?: string | null }) =>
      apiFetch(`/screens/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useDeleteScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/screens/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}


// ─── Playlists ──────────────────────────────────────────────────

export function usePlaylists() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: () => apiFetch('/playlists'),
  });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: ['playlists', id],
    queryFn: () => apiFetch(`/playlists/${id}`),
    enabled: !!id,
  });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; templateId?: string }) =>
      apiFetch('/playlists', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });
}

export function useReorderPlaylistItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, items }: {
      playlistId: string;
      items: Array<{ assetId: string; durationMs: number; sequenceOrder: number; daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null; transitionType?: string | null }>;
    }) =>
      apiFetch(`/playlists/${playlistId}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['playlists', vars.playlistId] });
      // Immediately refetch the playlists list after save to ensure reopened
      // playlist shows saved items. invalidateQueries alone doesn't guarantee
      // a refetch if the query is not actively subscribed.
      qc.refetchQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/playlists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });
}

/**
 * Flip every schedule attached to a playlist on or off. Powers the
 * on/off toggle on the playlist card — one click = all the playlist's
 * schedules switch at once. Server returns `{ count, active }`.
 */
export function useSetPlaylistActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiFetch(`/playlists/${id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

// ─── Schedules ──────────────────────────────────────────────────

export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: () => apiFetch('/schedules'),
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      playlistId: string;
      screenGroupId?: string;
      screenId?: string;
      startTime: string;
      endTime?: string;
      daysOfWeek?: string;
      timeStart?: string;
      timeEnd?: string;
      priority?: number;
      mode?: 'append' | 'replace';
      // Pass `false` to save as a draft (not live). Default is true.
      // Used by the "Save" button in the Publish modal so operators can
      // stage a schedule without flipping any screens.
      isActive?: boolean;
    }) => apiFetch('/schedules', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; screenGroupId?: string; screenId?: string; daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null; priority?: number }) =>
      apiFetch(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useToggleSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/schedules/${id}/toggle`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

// ─── Assets ─────────────────────────────────────────────────────

export function useAssets() {
  return useQuery({
    queryKey: ['assets'],
    queryFn: () => apiFetch('/assets'),
  });
}

export function useRequestPresignedUrl() {
  return useMutation({
    mutationFn: (data: { filename: string; contentType: string; size: number }) =>
      apiFetch<{ url: string; assetId: string }>('/assets/presign', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useApproveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${id}/approve`, { method: 'PUT' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['assets', 'pending'] });
    },
  });
}

export function useRejectAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiFetch(`/assets/${id}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ reason: reason || '' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['assets', 'pending'] });
    },
  });
}

/**
 * Pending-review queue — lists every asset in PENDING_APPROVAL status
 * for the current tenant. Admin-only route. Polled every 30s so a
 * freshly-uploaded contributor asset shows up in the reviewer's queue
 * without a manual refresh.
 */
export function usePendingAssets(enabled: boolean = true) {
  return useQuery({
    queryKey: ['assets', 'pending'],
    queryFn: () => apiFetch<any[]>('/assets/pending'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    // Off-switch so non-admin tabs (CONTRIBUTOR / RESTRICTED_VIEWER)
    // don't fire a recurring 403 every 30s when the sidebar wants a
    // badge count — keep the query dormant until we know the caller
    // can see the pending queue at all.
    enabled,
  });
}

export function useAddWebUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { url: string; name?: string; folderId?: string | null }) =>
      apiFetch('/assets/url', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useMoveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      apiFetch(`/assets/${id}/move`, { method: 'PUT', body: JSON.stringify({ folderId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

// ─── Asset Folders ──────────────────────────────────────────────

export function useAssetFolders() {
  return useQuery({
    queryKey: ['asset-folders'],
    queryFn: () => apiFetch('/assets/folders'),
  });
}

export function useCreateAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; parentId?: string }) =>
      apiFetch('/assets/folders', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-folders'] }),
  });
}

export function useRenameAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch(`/assets/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-folders'] }),
  });
}

export function useDeleteAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/folders/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-folders'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

// ─── Templates ─────────────────────────────────────────────────

export function useTemplates(category?: string) {
  return useQuery({
    queryKey: ['templates', category],
    queryFn: () => apiFetch(`/templates${category ? `?category=${category}` : ''}`),
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: () => apiFetch(`/templates/${id}`),
    enabled: !!id,
  });
}

export function useSystemPresets() {
  return useQuery({
    queryKey: ['templates', 'system-presets'],
    queryFn: () => apiFetch('/templates/system/presets'),
  });
}

export function useWidgetTypes() {
  return useQuery({
    queryKey: ['templates', 'widget-types'],
    queryFn: () => apiFetch('/templates/widget-types'),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      category?: string;
      orientation?: string;
      screenWidth?: number;
      screenHeight?: number;
      zones?: Array<{
        name: string;
        widgetType: string;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex?: number;
        sortOrder?: number;
        defaultConfig?: any;
      }>;
    }) => apiFetch('/templates', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useCreateFromPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ presetId, name }: { presetId: string; name?: string }) =>
      apiFetch(`/templates/from-preset/${presetId}`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDuplicateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      apiFetch(`/templates/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: {
      id: string;
      name?: string;
      description?: string;
      category?: string;
      orientation?: string;
      screenWidth?: number;
      screenHeight?: number;
      status?: string;
      bgColor?: string | null;
      bgImage?: string | null;
      bgGradient?: string | null;
    }) => apiFetch(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateTemplateZones() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, zones }: {
      id: string;
      zones: Array<{
        name: string;
        widgetType: string;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex?: number;
        sortOrder?: number;
        defaultConfig?: any;
      }>;
    }) => apiFetch(`/templates/${id}/zones`, { method: 'PUT', body: JSON.stringify({ zones }) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// ─── Users ──────────────────────────────────────────────────────

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; password: string; role: string }) =>
      apiFetch('/users', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      apiFetch('/invites', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// Admin-sets-password path: create a user directly, skip the email invite.
export function useCreateUserDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role: string; password: string }) =>
      apiFetch('/users', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiFetch(`/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ─── Tenants ──────────────────────────────────────────────────────

export function useTenant() {
  return useQuery({
    queryKey: ['tenant'],
    queryFn: () => apiFetch('/tenants'),
  });
}

// ─── Accessible Tenants (Multi-school Switcher) ───────────────
export function useAccessibleTenants() {
  return useQuery<{ current: string; tenants: Array<{ id: string; name: string; slug: string; parentId: string | null }> }>({
    queryKey: ['tenants', 'accessible'],
    queryFn: () => apiFetch('/tenants/accessible'),
    staleTime: 60_000,
  });
}

// ─── Notifications ────────────────────────────────────────────
export function useNotifications() {
  return useQuery<{ items: Array<any>; unreadCount: number }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/notifications?limit=20'),
    // Light-weight polling per CLAUDE.md guidance: 30s, also refetch on window focus
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ─── Audit Log ────────────────────────────────────────────────
export function useAuditLog(params: { from?: string; to?: string; actorId?: string; action?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.actorId) qs.set('actorId', params.actorId);
  if (params.action) qs.set('action', params.action);
  qs.set('limit', String(params.limit ?? 50));
  qs.set('offset', String(params.offset ?? 0));
  return useQuery<{ items: any[]; total: number; limit: number; offset: number }>({
    queryKey: ['audit', params],
    queryFn: () => apiFetch(`/audit?${qs.toString()}`),
  });
}

export function useUpdateTenantPanicSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      panicLockdownPlaylistId?: string | null;
      panicWeatherPlaylistId?: string | null;
      panicEvacuatePlaylistId?: string | null;
    }) => apiFetch('/tenants/panic-settings', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant'] }),
  });
}

// ─── Panic content (emergency assets, protected from /playlists) ───
export type PanicKind = 'lockdown' | 'weather' | 'evacuate' | 'hold' | 'secure' | 'medical' | 'default';
// Per-orientation variants. Each panic-kind bucket now carries an
// independent playlist for portrait vs landscape so a tenant with both
// a 4K vertical wall and standard 1920×1080 hallway screens gets each
// orientation's emergency media rendered natively. Defaults to
// landscape so every existing caller keeps the old behavior.
export type PanicOrientation = 'landscape' | 'portrait';
export type PanicAssetItem = {
  id: string;
  assetId: string;
  durationMs: number;
  sequenceOrder: number;
  asset: { id: string; fileUrl: string; mimeType: string; originalName?: string | null; fileSize?: number | null };
};
export type PanicBucket = {
  kind: PanicKind;
  orientation?: PanicOrientation;
  label: string;
  playlistId: string;
  items: PanicAssetItem[];
};
export function usePanicContent(kind: PanicKind, orientation: PanicOrientation = 'landscape') {
  return useQuery<PanicBucket>({
    queryKey: ['panic-content', kind, orientation],
    queryFn: () => apiFetch(`/panic-content/${kind}/assets?orientation=${orientation}`),
  });
}
export function useAddPanicAsset(kind: PanicKind, orientation: PanicOrientation = 'landscape') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { assetId: string; durationMs?: number }) =>
      apiFetch(`/panic-content/${kind}/assets?orientation=${orientation}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['panic-content', kind, orientation] }),
  });
}
export function useRemovePanicAsset(kind: PanicKind, orientation: PanicOrientation = 'landscape') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/panic-content/${kind}/assets/${itemId}?orientation=${orientation}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['panic-content', kind, orientation] }),
  });
}

// ─── Sprint 8 — fleet map view ───
export function useUpdateScreenLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; address?: string | null; latitude?: number | null; longitude?: number | null; photoUrl?: string | null }) =>
      apiFetch(`/screens/${id}/location`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['screens'] }),
  });
}

// ─── Push an OTA APK update check to kiosks ───
// Publishes a signed CHECK_FOR_UPDATES WebSocket message that the
// Android shell relays to its native OtaUpdateWorker. Pass a screenId
// to target a single kiosk, or omit it to fan out to every screen in
// the tenant. Requires APK ≥ 1.0.6 on the receiving side; older APKs
// ignore the event and update on their next 6h periodic poll.
export function useForceApkUpdate() {
  return useMutation({
    mutationFn: async (args: { screenId?: string | null } = {}) => {
      const path = args.screenId
        ? `/screens/${args.screenId}/force-update`
        : `/screens/force-update`;
      return apiFetch(path, { method: 'POST' });
    },
  });
}

// ─── License + billing (Sprint 7E) ───
export type LicenseSummary = {
  tier: string;
  seatLimit: number;
  seatsUsed: number;
  seatsAvailable: number;
  status: string;
  expiresAt: string | null;
  isPilot: boolean;
  atLimit: boolean;
};
export function useLicense() {
  return useQuery<LicenseSummary>({
    queryKey: ['license'],
    queryFn: () => apiFetch('/license/me'),
  });
}
// ─── Owner-only (SUPER_ADMIN) license management ───
export type SuperTenantRow = {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  parentId: string | null;
  createdAt: string;
  tier: string;
  status: string;
  billingMode: string;
  seatLimit: number;
  seatsUsed: number;
  atLimit: boolean;
  monthlyPriceCents: number | null;
  expiresAt: string | null;
  notes: string | null;
};
export function useSuperTenants() {
  return useQuery<SuperTenantRow[]>({
    queryKey: ['super', 'tenants'],
    queryFn: () => apiFetch('/super/tenants'),
  });
}
export function useUpsertLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, ...body }: any) =>
      apiFetch(`/super/tenants/${tenantId}/license`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super', 'tenants'] }),
  });
}
export function useCompSeats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, seatLimit, tier, notes }: { tenantId: string; seatLimit: number; tier?: string; notes?: string }) =>
      apiFetch(`/super/tenants/${tenantId}/comp`, { method: 'POST', body: JSON.stringify({ seatLimit, tier, notes }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super', 'tenants'] }),
  });
}

// ─── USB sneakernet ingest (Sprint 7B) ───
export function useUsbIngestConfig() {
  return useQuery<{ enabled: boolean; hasKey: boolean; keyRotatedAt: string | null }>({
    queryKey: ['usb-ingest-config'],
    queryFn: () => apiFetch('/tenants/me/usb-ingest'),
  });
}
export function useToggleUsbIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/usb-ingest', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usb-ingest-config'] }),
  });
}
export function useRotateUsbIngestKey() {
  const qc = useQueryClient();
  return useMutation<{ key: string; rotatedAt: string; warning: string }, Error, void>({
    mutationFn: () => apiFetch('/tenants/me/usb-ingest/rotate-key', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usb-ingest-config'] }),
  });
}
export function useUsbIngestEvents() {
  return useQuery<Array<any>>({
    queryKey: ['usb-ingest-events'],
    queryFn: () => apiFetch('/tenants/me/usb-ingest/events'),
  });
}

// ─── Submissions (Sprint 1.5 — submit-for-review workflow) ───
export interface SubmissionRow {
  id: string;
  tenantId: string;
  submittedById: string;
  submittedBy?: { id: string; email: string };
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  reviewerNote: string | null;
  notifyUserIds: string[];
  assetIds: string[];
  playlistIds: string[];
  scheduleIds: string[];
  decidedAt: string | null;
  decidedById: string | null;
  decidedBy?: { id: string; email: string } | null;
  createdAt: string;
}

export function useSubmissions(opts?: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; mine?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.mine)   params.set('mine', '1');
  const qs = params.toString();
  return useQuery<SubmissionRow[]>({
    queryKey: ['submissions', opts?.status || null, !!opts?.mine],
    queryFn: () => apiFetch(`/submissions${qs ? `?${qs}` : ''}`),
  });
}

export function useSubmission(id: string) {
  return useQuery<SubmissionRow & { assets: any[]; playlists: any[]; schedules: any[] }>({
    queryKey: ['submissions', id],
    queryFn: () => apiFetch(`/submissions/${id}`),
    enabled: !!id,
  });
}

export function useCreateSubmission() {
  const qc = useQueryClient();
  return useMutation<
    SubmissionRow,
    Error,
    { note?: string; notifyUserIds?: string[]; assetIds?: string[]; playlistIds?: string[]; scheduleIds?: string[] }
  >({
    mutationFn: (body) => apiFetch('/submissions', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['submissions'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useDecideSubmission() {
  const qc = useQueryClient();
  return useMutation<
    SubmissionRow,
    Error,
    { id: string; decision: 'approve' | 'reject'; reviewerNote?: string }
  >({
    mutationFn: ({ id, decision, reviewerNote }) =>
      apiFetch(`/submissions/${id}/${decision}`, { method: 'POST', body: JSON.stringify({ reviewerNote }) }),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['submissions'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}
