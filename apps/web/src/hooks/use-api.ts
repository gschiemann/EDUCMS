import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

// ─── Tenant Status ──────────────────────────────────────────────
export function useTenantStatus() {
  return useQuery({
    queryKey: ['tenant-status'],
    queryFn: () => apiFetch('/tenants'),
    refetchInterval: 5000, // Poll every 5 seconds to sync emergency overrides
    refetchIntervalInBackground: true,
  });
}

// ─── Screen Groups ──────────────────────────────────────────────

export function useScreenGroups() {
  return useQuery({
    queryKey: ['screen-groups'],
    queryFn: () => apiFetch('/screen-groups'),
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
      qc.invalidateQueries({ queryKey: ['playlists'] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useRejectAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${id}/reject`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useAddWebUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { url: string; name?: string }) =>
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
