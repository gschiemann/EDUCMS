import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';

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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['screen-groups'] });
      const prev = qc.getQueryData<any>(['screen-groups']);
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((g: any) => g?.id !== id);
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['screen-groups'], ctx.prev);
    },
    onSettled: () => {
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
    // Optimistic update — rename / move-to-group / location edit
    // commit instantly. Rollback on server error.
    onMutate: async ({ id, ...patch }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups  = qc.getQueryData<any>(['screen-groups']);
      qc.setQueryData<any>(['screens'], (old: any) => {
        const apply = (s: any) => (s?.id === id ? { ...s, ...patch } : s);
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens)
            ? g.screens.map((s: any) => (s?.id === id ? { ...s, ...patch } : s))
            : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups  !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
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
    // Optimistic delete — operator (2026-04-27): "i delete something
    // and count to like 3 or 4 before it deletes." Yank the screen
    // from cache the moment they click; rollback on server error;
    // background-invalidate as truth on settle.
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups  = qc.getQueryData<any>(['screen-groups']);
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (!old) return old;
        if (Array.isArray(old)) return old.filter((s: any) => s?.id !== id);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.filter((s: any) => s?.id !== id) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.filter((s: any) => s?.id !== id) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups  !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
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
    // Keep playlist list fresh for 30s — navigating Templates → Playlists
    // → back was retriggering a network fetch on every remount, making
    // the page feel sluggish. Mutations still invalidate explicitly so
    // edits show up instantly.
    staleTime: 30_000,
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['playlists'] });
      const prev = qc.getQueryData<any>(['playlists']);
      qc.setQueryData<any>(['playlists'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((p: any) => p?.id !== id);
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['playlists'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });
}

/**
 * Flip every schedule attached to a playlist on or off. Powers the
 * on/off toggle on the playlist card — one click = all the playlist's
 * schedules switch at once. Server returns `{ count, active }`.
 *
 * Optimistic: flip the schedules attached to this playlist locally
 * the moment the operator toggles, so the UI updates instantly.
 * Rollback on error.
 */
export function useSetPlaylistActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiFetch(`/playlists/${id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      }),
    onMutate: async ({ id, active }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['schedules'] }),
        qc.cancelQueries({ queryKey: ['playlists'] }),
      ]);
      const prevSchedules = qc.getQueryData<any>(['schedules']);
      const prevPlaylists = qc.getQueryData<any>(['playlists']);
      qc.setQueryData<any>(['schedules'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((s: any) => (s?.playlistId === id ? { ...s, isActive: active } : s));
      });
      // Some playlist views render an aggregate `isActive` based on attached
      // schedules; nudge it on the playlist row too.
      qc.setQueryData<any>(['playlists'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) => (p?.id === id ? { ...p, isActive: active } : p));
      });
      return { prevSchedules, prevPlaylists };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prevSchedules !== undefined) qc.setQueryData(['schedules'], ctx.prevSchedules);
      if (ctx?.prevPlaylists !== undefined) qc.setQueryData(['playlists'], ctx.prevPlaylists);
    },
    onSettled: () => {
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
    staleTime: 30_000,
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<any>(['schedules']);
      qc.setQueryData<any>(['schedules'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((s: any) => (s?.id === id ? { ...s, isActive: !s.isActive } : s));
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['schedules'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/schedules/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<any>(['schedules']);
      qc.setQueryData<any>(['schedules'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((s: any) => s?.id !== id);
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['schedules'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

// ─── Assets ─────────────────────────────────────────────────────

export function useAssets() {
  return useQuery({
    queryKey: ['assets'],
    queryFn: () => apiFetch('/assets'),
    staleTime: 30_000,
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['assets', 'pending'] });
      const prev = qc.getQueryData<any[]>(['assets', 'pending']);
      qc.setQueryData<any[]>(['assets', 'pending'], (old: any) =>
        Array.isArray(old) ? old.filter((a: any) => a?.id !== id) : old,
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['assets', 'pending'], ctx.prev);
    },
    onSettled: () => {
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
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['assets', 'pending'] });
      const prev = qc.getQueryData<any[]>(['assets', 'pending']);
      qc.setQueryData<any[]>(['assets', 'pending'], (old: any) =>
        Array.isArray(old) ? old.filter((a: any) => a?.id !== id) : old,
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['assets', 'pending'], ctx.prev);
    },
    onSettled: () => {
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['assets'] });
      const prev = qc.getQueryData<any>(['assets']);
      qc.setQueryData<any>(['assets'], (old: any) => {
        if (Array.isArray(old)) return old.filter((a: any) => a?.id !== id);
        if (Array.isArray(old?.assets)) return { ...old, assets: old.assets.filter((a: any) => a?.id !== id) };
        return old;
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['assets'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useMoveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      apiFetch(`/assets/${id}/move`, { method: 'PUT', body: JSON.stringify({ folderId }) }),
    onMutate: async ({ id, folderId }) => {
      await qc.cancelQueries({ queryKey: ['assets'] });
      const prev = qc.getQueryData<any>(['assets']);
      qc.setQueryData<any>(['assets'], (old: any) => {
        const apply = (a: any) => (a?.id === id ? { ...a, folderId } : a);
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.assets)) return { ...old, assets: old.assets.map(apply) };
        return old;
      });
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['assets'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

// ─── Asset Folders ──────────────────────────────────────────────

export function useAssetFolders() {
  return useQuery({
    queryKey: ['asset-folders'],
    queryFn: () => apiFetch('/assets/folders'),
    staleTime: 60_000,
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
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: ['asset-folders'] });
      const prev = qc.getQueryData<any>(['asset-folders']);
      qc.setQueryData<any>(['asset-folders'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((f: any) => (f?.id === id ? { ...f, name } : f));
      });
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['asset-folders'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['asset-folders'] }),
  });
}

export function useDeleteAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/folders/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['asset-folders'] });
      const prev = qc.getQueryData<any>(['asset-folders']);
      qc.setQueryData<any>(['asset-folders'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((f: any) => f?.id !== id);
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['asset-folders'], ctx.prev);
    },
    onSettled: () => {
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
    staleTime: 60_000,
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: () => apiFetch(`/templates/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useTemplateBackdrops() {
  return useQuery<Array<{ id: string; name: string; bgColor: string | null; bgGradient: string | null; bgImage: string | null }>>({
    queryKey: ['template-backdrops'],
    queryFn: () => apiFetch('/templates/backdrops'),
    staleTime: 5 * 60 * 1000, // 5 min — backdrops rarely change
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
    onMutate: async (id) => {
      // Templates are cached under multiple keys (root list + per-category
      // filtered list). Snapshot + patch every cache that's currently set.
      await qc.cancelQueries({ queryKey: ['templates'] });
      const snapshots = qc.getQueriesData<any>({ queryKey: ['templates'] });
      for (const [key, val] of snapshots) {
        if (Array.isArray(val)) {
          qc.setQueryData(key, val.filter((t: any) => t?.id !== id));
        }
      }
      return { snapshots };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, val] of ctx.snapshots) qc.setQueryData(key, val);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// ─── Users ──────────────────────────────────────────────────────

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
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
    onMutate: async ({ id, role }) => {
      await qc.cancelQueries({ queryKey: ['users'] });
      const prev = qc.getQueryData<any>(['users']);
      qc.setQueryData<any>(['users'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((u: any) => (u?.id === id ? { ...u, role } : u));
      });
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['users'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['users'] });
      const prev = qc.getQueryData<any>(['users']);
      qc.setQueryData<any>(['users'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((u: any) => u?.id !== id);
      });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['users'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
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

// ─── Auto-update player (OTA gating, 2026-04-27) ─────────────────
//
// When OFF (default), paired Android players DO NOT auto-update
// even when a newer APK is published. Admins push individual
// screens manually. When ON, kiosks pull updates on their 6h
// cadence — same as pre-2026 behavior. Per-screen Push override
// (forceApkUpdatePendingAt) works regardless of the flag.
export function useAutoUpdatePlayerConfig() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ['auto-update-player-config'],
    queryFn: () => apiFetch('/tenants/me/auto-update-player'),
  });
}
export function useToggleAutoUpdatePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/auto-update-player', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: ['auto-update-player-config'] });
      const prev = qc.getQueryData<any>(['auto-update-player-config']);
      qc.setQueryData(['auto-update-player-config'], { enabled });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['auto-update-player-config'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['auto-update-player-config'] }),
  });
}

// Latest published player APK version. Powers the dashboard's
// "Current vX · Latest vY" comparison on each screen card. Cached
// for 10 min — release tags don't move that fast.
export function useLatestPlayerVersion() {
  return useQuery<{ versionName: string | null; versionCode: number | null; source: string }>({
    queryKey: ['latest-player-version'],
    queryFn: () => apiFetch('/player/latest-version'),
    staleTime: 10 * 60_000,
  });
}

// ─── Location-based emergency mode (Sprint 8b toggle) ────────────
//
// When OFF, the manifest ignores every per-screen override and renders
// the tenant default panic content on every screen — the simple
// "everyone sees the same alert" workflow.
//
// When ON, the floor-plan editor and per-screen content config sections
// in the drawer become meaningful. Toggling back to OFF is reversible —
// per-screen rows stay put in case the admin flips it back on.
export function useLocationBasedEmergencyConfig() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ['location-based-emergency-config'],
    queryFn: () => apiFetch('/tenants/me/location-based-emergency'),
  });
}
export function useToggleLocationBasedEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/location-based-emergency', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['location-based-emergency-config'] });
      // Anything that branched on the flag (floor plans / screens manifest)
      // should refetch after the mode changes.
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
      qc.invalidateQueries({ queryKey: ['floor-plan'] });
      qc.invalidateQueries({ queryKey: ['screens'] });
    },
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

// ─── Brand Kit ──────────────────────────────────────────────────
export function useTenantBranding() {
  return useQuery<any>({
    queryKey: ['tenant-branding'],
    queryFn: () => apiFetch('/tenants/me/branding'),
    retry: false,
  });
}

/**
 * Per-template Brand Kit adopt. Distinct from `useApplyBrandToTemplates`
 * which writes to the GLOBAL TenantBranding row. This mutation writes
 * ONLY to a single template's `brandKit` JSON column — no dashboard
 * chrome repaint, no global LS cache write.
 *
 * Bug fix history: until 2026-04-27 the template builder's "Detect
 * brand" button silently re-skinned the entire CMS dashboard because
 * it was hitting /branding/adopt. Operator caught it: "you are
 * suppose to bring in colors, logos, etc TO US ON THE CUSTOM
 * TEMPLATE MAKER but what you really do is update the overall page
 * brand from the template … those are two separate things."
 *
 * Body shape mirrors /branding/adopt — pass the scrape preview
 * straight through.
 */
export function useAdoptTemplateBrandKit(templateId: string) {
  const qc = useQueryClient();
  return useMutation<{ ok: true; brandKit: any; template: { id: string; name: string } }, Error, any>({
    mutationFn: (body) =>
      apiFetch(`/branding/templates/${templateId}/adopt`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      // Invalidate ONLY the affected template — never touch the
      // tenant-branding cache (that's the global theme).
      qc.invalidateQueries({ queryKey: ['templates', templateId] });
    },
  });
}

/**
 * Clear a template's brand kit. Doesn't touch tenant branding.
 */
export function useClearTemplateBrandKit(templateId: string) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, void>({
    mutationFn: () =>
      apiFetch(`/branding/templates/${templateId}/brand-kit`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', templateId] });
    },
  });
}

/**
 * One-click "apply our brand to every template I own." Invalidates
 * templates + backdrops caches so the gallery reflects the re-skin
 * the moment the mutation lands.
 */
export function useApplyBrandToTemplates() {
  const qc = useQueryClient();
  return useMutation<
    { count: number; zonesPatched: number; mode: string; message: string },
    Error,
    { mode?: 'fill-blanks' | 'override' } | void
  >({
    mutationFn: (body) =>
      apiFetch('/branding/apply-to-templates', {
        method: 'POST',
        body: JSON.stringify(body || { mode: 'fill-blanks' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template-backdrops'] });
    },
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

export function usePendingSubmissionsCount(enabled: boolean = true) {
  return useQuery<{ count: number }>({
    queryKey: ['submissions-pending-count'],
    queryFn: async () => {
      const items = await apiFetch<SubmissionRow[]>('/submissions?status=PENDING');
      return { count: Array.isArray(items) ? items.length : 0 };
    },
    enabled,
    refetchInterval: 30_000,
  });
}

// ─── Sprint 8b — Floor Plans ────────────────────────────────────

export interface FloorPlanScreen {
  id: string;
  name: string;
  floorX: number | null;
  floorY: number | null;
  status: string;
  lastPingAt: string | null;
  screenGroupId?: string | null;
  location?: string | null;
  // Per-screen emergency content config — null means "use tenant default"
  emergencyLockdownPlaylistId?: string | null;
  emergencyEvacuatePlaylistId?: string | null;
  emergencyWeatherPlaylistId?: string | null;
  emergencyHoldPlaylistId?: string | null;
  emergencySecurePlaylistId?: string | null;
  emergencyMedicalPlaylistId?: string | null;
  // Custom asset URL fallback when no playlist is set
  emergencyLockdownAssetUrl?: string | null;
  emergencyEvacuateAssetUrl?: string | null;
  emergencyWeatherAssetUrl?: string | null;
  emergencyHoldAssetUrl?: string | null;
  emergencySecureAssetUrl?: string | null;
  emergencyMedicalAssetUrl?: string | null;
  // Portrait variants
  emergencyLockdownPortraitPlaylistId?: string | null;
  emergencyEvacuatePortraitPlaylistId?: string | null;
  emergencyWeatherPortraitPlaylistId?: string | null;
  emergencyHoldPortraitPlaylistId?: string | null;
  emergencySecurePortraitPlaylistId?: string | null;
  emergencyMedicalPortraitPlaylistId?: string | null;
  emergencyLockdownPortraitAssetUrl?: string | null;
  emergencyEvacuatePortraitAssetUrl?: string | null;
  emergencyWeatherPortraitAssetUrl?: string | null;
  emergencyHoldPortraitAssetUrl?: string | null;
  emergencySecurePortraitAssetUrl?: string | null;
  emergencyMedicalPortraitAssetUrl?: string | null;
}

export interface FloorPlanZone {
  id: string;
  name: string;
  color: string;
  shape?: any;
}

export interface FloorPlan {
  id: string;
  tenantId: string;
  name: string;
  buildingLabel: string | null;
  floorLabel: string | null;
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  zones: FloorPlanZone[];
  screens: FloorPlanScreen[];
  createdAt: string;
  updatedAt: string;
}

export function useFloorPlans() {
  return useQuery<FloorPlan[]>({
    queryKey: ['floor-plans'],
    queryFn: () => apiFetch('/floor-plans'),
  });
}

export function useFloorPlan(id: string | undefined) {
  return useQuery<FloorPlan>({
    queryKey: ['floor-plan', id],
    queryFn: () => apiFetch(`/floor-plans/${id}`),
    enabled: !!id,
  });
}

/**
 * Upload a new floor plan. Multipart form because we ship the image
 * + dimensions in one request. Auto-detects image dimensions client-
 * side before posting so the operator doesn't have to type px counts.
 */
export function useUploadFloorPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; name: string; buildingLabel?: string; floorLabel?: string }) => {
      // Read the file into an Image to discover its natural dims
      const dims = await new Promise<{ widthPx: number; heightPx: number }>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(input.file);
        img.onload = () => {
          resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Could not read image dimensions'));
        };
        img.src = url;
      });
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('name', input.name);
      if (input.buildingLabel) fd.append('buildingLabel', input.buildingLabel);
      if (input.floorLabel) fd.append('floorLabel', input.floorLabel);
      fd.append('widthPx', String(dims.widthPx));
      fd.append('heightPx', String(dims.heightPx));
      // Bypass apiFetch for multipart — its default Content-Type:
      // application/json header would mangle the multipart boundary.
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/floor-plans`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Upload failed (${res.status}): ${txt || res.statusText}`);
      }
      return (await res.json()) as FloorPlan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
    },
  });
}

export function useDeleteFloorPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/floor-plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
    },
  });
}

/** Place a screen on a plan at px coords (drag-drop save). */
export function usePlaceScreenOnFloor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, screenId, floorX, floorY }: { planId: string; screenId: string; floorX: number; floorY: number }) =>
      apiFetch(`/floor-plans/${planId}/screens/${screenId}`, {
        method: 'PUT',
        body: JSON.stringify({ floorX, floorY }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['floor-plan', vars.planId] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
      qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });
}

export function useDetachScreenFromFloor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, screenId }: { planId: string; screenId: string }) =>
      apiFetch(`/floor-plans/${planId}/screens/${screenId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['floor-plan', vars.planId] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
      qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });
}

// ─── Sprint 8b — Per-screen emergency override ──────────────────

export interface ScreenEmergencyOverrideRow {
  id: string;
  screenId: string;
  tenantId: string;
  type: string;
  severity: string;
  scopeNote: string | null;
  playlistId: string | null;
  textBlob: string | null;
  mediaUrl: string | null;
  floorPlanId: string | null;
  floorZoneId: string | null;
  scenarioId: string | null;
  triggeredByUserId: string;
  triggeredAt: string;
  expiresAt: string | null;
}

export interface ScreenEmergencyTriggerInput {
  type: string;
  severity?: string;
  scopeNote?: string;
  playlistId?: string;
  textBlob?: string;
  mediaUrl?: string;
  expiresAt?: string;
  floorPlanId?: string;
  floorZoneId?: string;
  scenarioId?: string;
}

export function useScreenEmergencyOverride(screenId: string | undefined) {
  return useQuery<ScreenEmergencyOverrideRow | null>({
    queryKey: ['screen-emergency-override', screenId],
    queryFn: () => apiFetch(`/emergency/screens/${screenId}/override`),
    enabled: !!screenId,
    // 5min — was 30s, but this hook is called once per pin on the floor
    // plan (50 pins × 30s = 100 GETs/min just for override status).
    // Real triggers come through the signed WS pub/sub, NOT polling;
    // the poll is purely a fallback when WS is offline. 5min is plenty.
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

/** Trigger emergency on a single screen. */
export function useTriggerScreenEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ screenId, override }: { screenId: string; override: ScreenEmergencyTriggerInput }) =>
      apiFetch(`/emergency/screens/${screenId}/trigger`, {
        method: 'POST',
        body: JSON.stringify(override),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['screen-emergency-override', vars.screenId] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
    },
  });
}

/** Clear a single screen's emergency override. */
export function useClearScreenEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (screenId: string) =>
      apiFetch(`/emergency/screens/${screenId}/all-clear`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (_, screenId) => {
      qc.invalidateQueries({ queryKey: ['screen-emergency-override', screenId] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
    },
  });
}

/**
 * Per-screen emergency content config — declarative, NOT a manual
 * trigger. Operator picks which playlist plays on this screen for
 * each of the 6 emergency types. Null = use tenant default.
 */
export interface ScreenEmergencyContent {
  lockdownPlaylistId?: string | null;
  evacuatePlaylistId?: string | null;
  weatherPlaylistId?: string | null;
  holdPlaylistId?: string | null;
  securePlaylistId?: string | null;
  medicalPlaylistId?: string | null;
  lockdownAssetUrl?: string | null;
  evacuateAssetUrl?: string | null;
  weatherAssetUrl?: string | null;
  holdAssetUrl?: string | null;
  secureAssetUrl?: string | null;
  medicalAssetUrl?: string | null;
  lockdownPortraitPlaylistId?: string | null;
  evacuatePortraitPlaylistId?: string | null;
  weatherPortraitPlaylistId?: string | null;
  holdPortraitPlaylistId?: string | null;
  securePortraitPlaylistId?: string | null;
  medicalPortraitPlaylistId?: string | null;
  lockdownPortraitAssetUrl?: string | null;
  evacuatePortraitAssetUrl?: string | null;
  weatherPortraitAssetUrl?: string | null;
  holdPortraitAssetUrl?: string | null;
  securePortraitAssetUrl?: string | null;
  medicalPortraitAssetUrl?: string | null;
}

export function useUpdateScreenEmergencyContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ screenId, patch }: { screenId: string; patch: ScreenEmergencyContent }) =>
      apiFetch<any>(`/screens/${screenId}/emergency-content`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    // Operator reported: "i uploaded an asset and it took but still says
    // tenant default." Root cause: the drawer's `screen` prop comes from
    // the floor-plan query cache, and the mutation only invalidated
    // (queueing a refetch) — so there was a visible window where the
    // drawer was rendering with stale data even though the DB had the
    // new value. Fix: use the API response (which contains every
    // emergency_*_playlist_id / asset_url field for the just-updated
    // screen) to PATCH the cached floor-plan AND screens list directly.
    // Refetches still happen via invalidate as a safety net.
    onSuccess: (response, vars) => {
      // 1. Patch every floor-plan cache that contains this screen.
      //    Floor-plan query keys look like ['floor-plan', planId].
      const floorPlanCaches = qc.getQueriesData<any>({ queryKey: ['floor-plan'] });
      for (const [key, cached] of floorPlanCaches) {
        if (!cached || !Array.isArray(cached.screens)) continue;
        const idx = cached.screens.findIndex((s: any) => s?.id === vars.screenId);
        if (idx < 0) continue;
        const next = {
          ...cached,
          screens: cached.screens.map((s: any) =>
            s.id === vars.screenId ? { ...s, ...(response || {}) } : s,
          ),
        };
        qc.setQueryData(key, next);
      }
      // 2. Patch the floor-plans LIST cache too, so list-tile screen
      //    counts / pin states reflect the change without a refetch.
      const listCaches = qc.getQueriesData<any>({ queryKey: ['floor-plans'] });
      for (const [key, cached] of listCaches) {
        if (!Array.isArray(cached)) continue;
        const next = cached.map((plan: any) => {
          if (!plan || !Array.isArray(plan.screens)) return plan;
          if (!plan.screens.some((s: any) => s?.id === vars.screenId)) return plan;
          return {
            ...plan,
            screens: plan.screens.map((s: any) =>
              s.id === vars.screenId ? { ...s, ...(response || {}) } : s,
            ),
          };
        });
        qc.setQueryData(key, next);
      }
      // 3. Invalidate as a safety net — if any cache layer disagreed
      //    with our optimistic patch, the next render reconciles.
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
      qc.invalidateQueries({ queryKey: ['floor-plan'] });
      qc.invalidateQueries({ queryKey: ['screen-emergency-override', vars.screenId] });
    },
  });
}

/** Bulk trigger across many screens (lasso / scenario). */
export function useBulkTriggerScreenEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { screenIds: string[]; override: ScreenEmergencyTriggerInput }) =>
      apiFetch('/emergency/screens/bulk-trigger', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
    },
  });
}
