import { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
// TYPE-ONLY (2026-09-21 passkey wave). use-api is imported by most of the
// dashboard, so the WebAuthn package must never become a runtime dependency
// of this module — only `@/lib/passkeys` and the two UI surfaces import it
// for real.
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { apiFetch } from '@/lib/api-client';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import {
  getGameOpQueue,
  isNetworkFailure,
  type GameOp,
  type GameOpKind,
} from '@/lib/game-op-queue';
import { conciergeUrlReferenceBody } from '@/lib/concierge-designer-assets';
import {
  findSport,
  effectiveEmergencyEnabled,
  emergencyEnablementLocked,
  effectiveMfaEnforced,
} from '@cms/api-types';
import type {
  ConciergeReference,
  ConciergeMessage,
  ConciergeTurnResponse,
  DisplayActionType as ApiDisplayActionType,
} from '@cms/api-types';

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
    // 2026-06-16 mobile-perf: do NOT poll while the tab/app is backgrounded —
    // it's pure main-thread + battery drain on a phone the operator isn't even
    // looking at, and a poll landing as they tap back in queues the tap. WS is
    // the load-bearing emergency path; on return we re-check immediately via
    // refetchOnWindowFocus (cheap, one call) instead of polling in the dark.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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
    // 2026-06-16 mobile-perf: stop polling a backgrounded tab (drain + tap-
    // queue jank on mobile). The documented "pill flips while the tab isn't
    // focused" intent is preserved by refetchOnWindowFocus — on return we
    // refetch immediately; while visible the 10s interval still runs.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });
}

export function useCreateScreenGroup() {
  const qc = useQueryClient();
  return useMutation({
    // address / latitude / longitude (2026-09-14): the New group form takes an
    // optional address so a group lands on the fleet map from day one.
    mutationFn: (data: { name: string; description?: string; address?: string | null; latitude?: number | null; longitude?: number | null }) =>
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

export function useUpdateScreenGroup() {
  const qc = useQueryClient();
  return useMutation({
    // syncMode (2026-07-28): 'locked' = frame-locked multi-screen sync for
    // every screen in the group; 'off'/null = normal free-run playback.
    mutationFn: ({ id, name, description, syncMode, address, latitude, longitude }: { id: string; name?: string; description?: string; syncMode?: 'off' | 'locked' | null; address?: string | null; latitude?: number | null; longitude?: number | null }) =>
      apiFetch(`/screen-groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          description,
          ...(syncMode !== undefined ? { syncMode } : {}),
          // 2026-08-30 — group address (fleet map: screen > group > tenant).
          // Empty string clears server-side; coords ride only when sent.
          ...(address !== undefined ? { address: address ?? '' } : {}),
          ...(latitude !== undefined ? { latitude } : {}),
          ...(longitude !== undefined ? { longitude } : {}),
        }),
      }),
    // Optimistic rename so the new name shows instantly (the operator is
    // typing it — don't make them wait on the round-trip). Same for the
    // sync toggle — the switch must flip under the finger.
    onMutate: async ({ id, name, syncMode }) => {
      await qc.cancelQueries({ queryKey: ['screen-groups'] });
      const prev = qc.getQueryData<any>(['screen-groups']);
      if (name !== undefined || syncMode !== undefined) {
        qc.setQueryData<any>(['screen-groups'], (old: any) =>
          Array.isArray(old)
            ? old.map((g: any) =>
                g?.id === id
                  ? {
                      ...g,
                      ...(name !== undefined ? { name } : {}),
                      ...(syncMode !== undefined ? { syncMode } : {}),
                    }
                  : g,
              )
            : old,
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['screen-groups'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
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
    // 2026-06-16 mobile-perf: no background-tab polling (see useScreenGroups).
    // Visible = 10s live fleet status; backgrounded = paused; on return =
    // immediate refetch via refetchOnWindowFocus.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });
}

/** 2026-05-24 — flip a kiosk between LANDSCAPE / PORTRAIT / AUTO.
 *  Hits the dedicated PUT /screens/:id/orientation endpoint so the
 *  signed WS broadcast + AuditLog write fire alongside the DB update.
 *  Optimistic so the dropdown reflects the choice instantly. */
export function useSetScreenOrientation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orientation, reason }: { id: string; orientation: 'LANDSCAPE' | 'PORTRAIT' | 'AUTO'; reason?: string }) =>
      apiFetch(`/screens/${id}/orientation`, {
        method: 'PUT',
        body: JSON.stringify({ orientation, reason }),
      }),
    // 2026-05-26 — patch BOTH caches. /screens page reads from
    // useScreenGroups (grouped card view), and the original hook only
    // touched ['screens'] so the dropdown change never lit up
    // optimistically. Same fix class as useSetScreenCanvas.
    onMutate: async ({ id, orientation }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups = qc.getQueryData<any>(['screen-groups']);
      const apply = (s: any) => (s?.id === id ? { ...s, orientation } : s);
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.map(apply) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * 2026-05-26 — per-screen LED canvas dims (canvasW × canvasH).
 *
 * Operator picks N panels (1-6 × 320 = canvasW) on the dashboard;
 * server persists + signed-WS broadcasts (CANVAS_CHANGE); player
 * applies live within ~150ms. Null clears the override (defaults
 * back to the controller's native viewport).
 */
export function useSetScreenCanvas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, canvasW, canvasH, repeats, reason }: {
      id: string;
      canvasW: number | null;
      canvasH: number | null;
      repeats?: number;
      reason?: string;
    }) =>
      apiFetch(`/screens/${id}/canvas`, {
        method: 'PUT',
        body: JSON.stringify({ canvasW, canvasH, repeats, reason }),
      }),
    // 2026-05-26 — patch BOTH ['screens'] AND ['screen-groups'] caches.
    // The dashboard's /screens page reads from useScreenGroups (the
    // grouped card view, screens nested under group.screens), so the
    // original screens-only optimistic update never lit up the button.
    // Operator: "i click 1 but it doesnt switch from off". Same fix
    // class as the orientation hook below.
    onMutate: async ({ id, canvasW, canvasH, repeats }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups = qc.getQueryData<any>(['screen-groups']);
      const apply = (s: any) =>
        s?.id === id ? { ...s, canvasW, canvasH, ...(repeats !== undefined ? { repeats } : {}) } : s;
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.map(apply) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * 2026-07-28 — frame-locked sync: per-screen latency trim (±ms).
 * The AVR-lip-sync-style knob for mixed display models: nudge until two
 * side-by-side screens align. Null clears back to 0. Patches BOTH caches
 * (screens + screen-groups) — same fix class as canvas/orientation.
 */
export function useSetScreenSyncOffset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, syncOffsetMs }: { id: string; syncOffsetMs: number | null }) =>
      apiFetch(`/screens/${id}/sync-offset`, {
        method: 'PUT',
        body: JSON.stringify({ syncOffsetMs }),
      }),
    onMutate: async ({ id, syncOffsetMs }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups = qc.getQueryData<any>(['screen-groups']);
      const apply = (s: any) => (s?.id === id ? { ...s, syncOffsetMs } : s);
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.map(apply) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * 2026-07-28 (tier-3) — camera auto-calibration: arm/disarm the synced
 * flash pattern on every screen of a group (signed per-device fan-out;
 * players auto-expire after durationSec regardless).
 */
export function useCalibrateFlash() {
  return useMutation({
    mutationFn: ({ groupId, on, durationSec }: { groupId: string; on: boolean; durationSec?: number }) =>
      apiFetch(`/screen-groups/${groupId}/calibrate-flash`, {
        method: 'POST',
        body: JSON.stringify({ on, durationSec }),
      }),
  });
}

// ─── Display control (volume / brightness / blank / reboot) ─────────────
//
// 2026-08-13 — the dashboard half of the vendor-neutral display-control
// layer. The player probes what it can actually do (DisplayCapabilityProbe)
// and reports a verdict onto Screen.displayCapabilities; the dashboard
// gates every control on that verdict (see components/screens/
// display-capabilities.ts) and pushes immediate actions through the
// endpoint below.
//
// CACHE SHAPE, deliberately: this is a PUSH, like useRefreshWeb — no
// optimistic write into ['screens'] / ['screen-groups']. The API validates
// the action against the reported capability, signs a WS message and
// audit-logs it; it does NOT hand back a new screen row. Writing a
// speculative `displayState` into either cache would be inventing device
// truth we don't have (the exact lie the APK-push row was rewritten to
// stop telling). The panel instead shows what it SENT, labelled as sent.
// If the API later starts echoing observed device state onto the screen
// row, add the both-caches optimistic patch used by useSetScreenOrientation
// — patching only ['screens'] reproduces the documented LED-canvas
// "I click it but nothing changes" bug, because /screens renders from
// useScreenGroups.

// CONTRACT C1 (lead, 2026-08-13): the action enum is SCREAMING_CASE and
// `packages/api-types/src/display-control.ts` is authoritative. This hook
// previously declared its own lowercase union ('volume' | 'blank' | …),
// which the API's `z.enum(DISPLAY_ACTIONS)` rejected — every control in the
// panel 400'd, 100% of the time. Import the contract; never restate it.
export type DisplayActionType = ApiDisplayActionType;

/**
 * How long a single display-control POST may hang before we abort it.
 *
 * apiFetch retries only on a network TypeError, so a socket that is OPEN but
 * never answers (wedged pod) never settles — the panel's `busy` flag would
 * stay set forever and, since Wake is the recovery control for Blank, a
 * screen the operator just blanked would be unrecoverable from the
 * dashboard until a page reload. An AbortError is not a TypeError, so this
 * fails fast without triggering a retry storm.
 */
export const DISPLAY_CONTROL_TIMEOUT_MS = 12_000;

export interface DisplayControlArgs {
  screenId: string;
  /** SCREAMING_CASE — SET_VOLUME / SET_BRIGHTNESS / BLANK / WAKE / REBOOT. */
  action: ApiDisplayActionType;
  /** 0..100 — required for SET_VOLUME / SET_BRIGHTNESS, ignored otherwise. */
  percent?: number;
  /** Dead-man revert: device restores prior state after this many ms. */
  revertAfterMs?: number;
}

/**
 * What POST /screens/:id/display-control hands back (ApplyActionResult in
 * apps/api/src/display/display.service.ts).
 *
 * `delivered` is the load-bearing field and it is NOT implied by `success`.
 * The API returns success:true the moment it has validated and audited the
 * action; `delivered` is true ONLY when the message provably left the
 * process toward the screen. With Redis down — a supported deploy state —
 * the fan-out reaches only screens socketed to THIS replica, so
 * `{success:true, delivered:false, deliveryReason:'redis_unavailable'}` is a
 * FAILURE for the operator: nothing changed on the glass, and there is no
 * manifest backstop for immediate actions the way there is for schedules.
 * Typed here so a caller cannot quietly ignore it.
 *
 * 2026-08-25 — `delivered` now grades PER SCREEN, not just per server. It was
 * derived from the Redis fan-out alone, which is a fact about the API: a panel
 * living on the HTTP-poll tier (venue proxy blocking WS/SSE) receives no
 * DISPLAY_CONTROL frame at all and still got `delivered:true`. It now also
 * requires a fresh `Screen.lastPushConnectedAt`, and the new
 * `'no_push_socket'` reason distinguishes "this one screen has no live
 * connection" from "the server's transport is down". A UI MUST render those
 * two differently — the first is an explanation, the second is an outage.
 */
export interface DisplayControlResult {
  success: true;
  action: ApiDisplayActionType;
  mechanism: string;
  percent: number | null;
  clamped: boolean;
  revertAfterMs: number | null;
  actionId: string;
  /**
   * True only when the command provably left the API toward the screen AND
   * this screen had a live push channel to receive it.
   */
  delivered: boolean;
  /**
   * Why `delivered` is false; null when it is true.
   *   'redis_unavailable' — the fan-out is down (server-side outage)
   *   'publish_failed'    — the publish threw (server-side outage)
   *   'no_push_socket'    — this SCREEN has no live WS/SSE channel. Not an
   *                         outage; an explanation. Nothing is queued —
   *                         display actions are immediate-only.
   */
  deliveryReason: string | null;
}

export function useDisplayControl() {
  return useMutation<DisplayControlResult, Error, DisplayControlArgs>({
    mutationFn: async ({ screenId, action, percent, revertAfterMs }: DisplayControlArgs) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DISPLAY_CONTROL_TIMEOUT_MS);
      try {
        return await apiFetch<DisplayControlResult>(`/screens/${screenId}/display-control`, {
          method: 'POST',
          signal: ac.signal,
          body: JSON.stringify({
            action,
            ...(percent !== undefined ? { percent } : {}),
            ...(revertAfterMs !== undefined ? { revertAfterMs } : {}),
          }),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export interface DisplaySchedule {
  id: string;
  tenantId?: string;
  screenId?: string | null;
  screenGroupId?: string | null;
  /**
   * CONTRACT C2 — `Int[]`, 0 = Sunday … 6 = Saturday, straight off the
   * Prisma row (schema.prisma `DisplaySchedule.daysOfWeek Int[]`). It is
   * NOT a comma-joined label string and it is never null: the API's
   * `.min(1)` refuses an empty set. Typed loosely as `unknown[]`-tolerant
   * at the call site via `parseDays()` so a legacy/hand-seeded row can't
   * throw during render the way `String.replace` on a number[] did.
   */
  daysOfWeek: number[];
  /** 'HH:MM' — when the screen wakes. */
  onTime: string;
  /** 'HH:MM' — when the screen blanks. */
  offTime: string;
  /** IANA zone; the DEVICE honors this, not its own locale. */
  timezone: string;
  isActive: boolean;
}

export type DisplayScheduleTarget = { screenId: string } | { screenGroupId: string };

function displayScheduleQs(target: DisplayScheduleTarget): string {
  return 'screenId' in target
    ? `screenId=${encodeURIComponent(target.screenId)}`
    : `screenGroupId=${encodeURIComponent(target.screenGroupId)}`;
}

/**
 * Schedules for ONE screen or ONE group. Only mounted while the schedule
 * modal is open (`enabled`), so a closed editor costs nothing. No polling:
 * a schedule only changes when this operator changes it, and the on-device
 * AlarmManager — not this query — is what actually fires it.
 */
/**
 * EVERY display (on/off) schedule of the session tenant — the Overview's uptime
 * card subtracts scheduled sleep from the expected-on denominator (2026-09-14).
 * One small list, refreshed with the dashboard's own cadence.
 */
export function useAllDisplaySchedules(enabled = true) {
  return useQuery<DisplaySchedule[]>({
    queryKey: ['display-schedules', 'all'],
    queryFn: () => apiFetch('/display-schedules'),
    enabled,
    staleTime: 60_000,
  });
}

export function useDisplaySchedules(target: DisplayScheduleTarget | null) {
  return useQuery<DisplaySchedule[]>({
    queryKey: [
      'display-schedules',
      target && 'screenId' in target ? target.screenId : null,
      target && 'screenGroupId' in target ? target.screenGroupId : null,
    ],
    queryFn: () => apiFetch(`/display-schedules?${displayScheduleQs(target!)}`),
    enabled: !!target,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export interface DisplayScheduleInput {
  screenId?: string;
  screenGroupId?: string;
  /** 0 = Sunday … 6 = Saturday. At least one — see contract C2. */
  daysOfWeek: number[];
  onTime: string;
  offTime: string;
  timezone: string;
  isActive?: boolean;
}

export function useCreateDisplaySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DisplayScheduleInput) =>
      apiFetch('/display-schedules', { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['display-schedules'] }),
  });
}

export function useUpdateDisplaySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<DisplayScheduleInput> & { id: string }) =>
      apiFetch(`/display-schedules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['display-schedules'] }),
  });
}

export function useDeleteDisplaySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/display-schedules/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['display-schedules'] }),
  });
}

/**
 * 2026-07-28 (tier-2) — fleet-learned sync-trim presets. Aggregate
 * (hardware model → median operator trim) across the whole platform; the
 * trim row offers it as a one-tap starting point for untrimmed screens
 * of a known model. Cached hard — it moves at fleet speed, not UI speed.
 */
export function useSyncTrimSuggestions(enabled: boolean) {
  return useQuery<{ suggestions: Array<{ hardwareModel: string; medianTrimMs: number; sampleCount: number }> }>({
    queryKey: ['sync-trim-suggestions'],
    queryFn: () => apiFetch('/screens/sync-trim-suggestions'),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/**
 * 2026-05-27 — read-only player-hardware catalog. Drives the per-screen
 * Hardware panel's model dropdown + capability chips. The catalog is a
 * build-time constant on the API side; cache aggressively here so
 * navigating between screens doesn't re-fetch.
 */
export interface HardwareCatalogEntry {
  id: string;
  name: string;
  productPageUrl?: string | null;
  socOs: string;
  recommendedVerticals: string[];
  caps: {
    serialPorts: number;
    rs485: boolean;
    gpioIn: number;
    gpioOut: number;
    hdmiIn: boolean;
    hdmiOut: boolean;
    rj45In: boolean;
    rj45Out: boolean;
    powerOutVolts: number | null;
    npuTops: number;
    cpuCores: number;
    ramGb: number;
    storageGb: number;
    decode4k: boolean;
    fanless: boolean;
    duty247Rated: boolean;
    chromiumMin: number;
  };
}

export interface HardwareCatalogResponse {
  models: HardwareCatalogEntry[];
  generatedAt: string;
}

export function useHardwareCatalog() {
  return useQuery<HardwareCatalogResponse>({
    queryKey: ['hardware-catalog'],
    queryFn: () => apiFetch('/hardware/catalog'),
    // The catalog is a build-time constant. Refetch only on deploy
    // restart (generatedAt changes) — every dashboard page would
    // otherwise re-fetch the static catalog on every focus.
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 1 day
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

/**
 * 2026-08-24 — one screen's full (bounded) device inventory: vendor control
 * packages, vendor Settings keys, serial nodes, admin/device-owner state.
 * Fetched LAZILY (`enabled` = the Device details drawer is open) — this is
 * exactly the data the manifest path refuses to carry, so the dashboard
 * only pulls it when an operator actually looks.
 */
export function useScreenDeviceInventory(screenId: string, enabled: boolean) {
  return useQuery<{ screenId: string; reportedAt: string | null; report: any | null }>({
    queryKey: ['screen-device-inventory', screenId],
    queryFn: () => apiFetch(`/screens/${screenId}/device-inventory`),
    enabled: enabled && !!screenId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 2026-05-27 — update a single screen's hardwareModel column. Reuses
 * the existing PUT /screens/:id endpoint (it accepts the field). Same
 * optimistic-update pattern as the orientation / canvas hooks so the
 * dropdown reflects the choice instantly.
 */
export function useSetScreenHardwareModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hardwareModel }: { id: string; hardwareModel: string | null }) =>
      apiFetch(`/screens/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ hardwareModel }),
      }),
    onMutate: async ({ id, hardwareModel }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups = qc.getQueryData<any>(['screen-groups']);
      const apply = (s: any) => (s?.id === id ? { ...s, hardwareModel } : s);
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.map(apply) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * 2026-06-01 — set which scoreboard console drives a screen. Persists to
 * `Screen.config.consoleProfile` (allow-listed server-side); the manifest
 * surfaces it and CtsBridge picks the serial settings + default tty +
 * decoder. `null` clears it (back to the 'cts-gen6' default). Mirrors
 * useSetScreenHardwareModel's optimistic-update + invalidate pattern, but
 * writes the nested config key (so we merge `config.consoleProfile`
 * optimistically without clobbering sibling config like `wiring`).
 */
export function useSetScreenConsoleProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, consoleProfile }: { id: string; consoleProfile: string | null }) =>
      apiFetch(`/screens/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ config: { consoleProfile } }),
      }),
    onMutate: async ({ id, consoleProfile }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups = qc.getQueryData<any>(['screen-groups']);
      const apply = (s: any) =>
        s?.id === id
          ? { ...s, config: { ...(s.config && typeof s.config === 'object' ? s.config : {}), consoleProfile } }
          : s;
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.map(apply) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * Double-sided displays (2026-09-16) — add a second side to a display.
 *
 * One face = one `Screen` row, so the new side appears in every picker, every
 * schedule, every fleet view and every emergency fan-out with no special
 * cases. It starts in MIRROR mode: a brand-new back panel shows the front's
 * content immediately rather than sitting black waiting to be assigned.
 */
/**
 * The sides of one display, and whether the hardware even has a second one.
 *
 * `enabled` gates it to surfaces the operator is actually looking at — this
 * is a drawer panel, never a poller (mobile-perf standard: nothing new runs
 * in the always-mounted chrome).
 */
export function useScreenFaces(screenId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['screen-faces', screenId],
    queryFn: () => apiFetch(`/screens/${screenId}/faces`),
    enabled: enabled && !!screenId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateScreenFace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; contentMode?: 'MIRROR' | 'OWN' }) =>
      apiFetch(`/screens/${id}/faces`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      // A new Screen row lands in both fleet caches.
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * "Same on both sides" vs "different per side".
 *
 * MIRROR means the face resolves the PRIMARY's schedules — so no schedule row
 * is ever written for a mirroring side, and none could be. OWN gives the side
 * its own schedules. This is a property of the DISPLAY, not of any one
 * playlist, which is why every surface that offers it says so.
 *
 * Optimistic across both caches, like the orientation / canvas hooks: the
 * operator flips a segmented control and the sides must redraw at once.
 */
export function useSetScreenFaceMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode, reason }: { id: string; mode: 'MIRROR' | 'OWN'; reason?: string }) =>
      apiFetch(`/screens/${id}/face-content`, {
        method: 'PUT',
        body: JSON.stringify({ mode, reason }),
      }),
    onMutate: async ({ id, mode }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['screens'] }),
        qc.cancelQueries({ queryKey: ['screen-groups'] }),
      ]);
      const prevScreens = qc.getQueryData<any>(['screens']);
      const prevGroups = qc.getQueryData<any>(['screen-groups']);
      const apply = (s: any) => (s?.id === id ? { ...s, faceContentMode: mode } : s);
      qc.setQueryData<any>(['screens'], (old: any) => {
        if (Array.isArray(old)) return old.map(apply);
        if (Array.isArray(old?.screens)) return { ...old, screens: old.screens.map(apply) };
        return old;
      });
      qc.setQueryData<any>(['screen-groups'], (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => ({
          ...g,
          screens: Array.isArray(g?.screens) ? g.screens.map(apply) : g?.screens,
        }));
      });
      return { prevScreens, prevGroups };
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prevScreens !== undefined) qc.setQueryData(['screens'], ctx.prevScreens);
      if (ctx?.prevGroups !== undefined) qc.setQueryData(['screen-groups'], ctx.prevGroups);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
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

// ─── Playlists Operations v1 — summary + delivery ──────────────────────
//
// Both endpoints are landing separately. Neither hook may ever be REQUIRED:
// the v1 library builds the identical row model client-side from the full
// playlists payload when the summary endpoint is absent, and the Delivery
// surfaces show §22.5's "Delivery status unavailable · Retry" rather than a
// healthy gray when the delivery endpoint is absent. So both resolve to
// `null` on ANY failure instead of throwing, and neither retries a 404 into
// a spinner that never ends.

/** One row of `GET /playlists/summary` (§26). */
export interface PlaylistSummaryApiRow {
  id: string;
  name: string;
  kind: 'media' | 'template';
  itemCount: number;
  durationMs: number;
  thumbnailUrl: string | null;
  templateSummary: string | null;
  creatorSummary: string | null;
  scheduleState: 'ACTIVE' | 'SCHEDULED' | 'PAUSED' | 'UNASSIGNED';
  reviewState: string | null;
  reach: { screens: number; groups: number; locations: number };
  scheduleSummary: string;
  updatedAt: string;
  sourceOwnership: 'own' | 'hq';
}
export interface PlaylistSummaryResponse { playlists: PlaylistSummaryApiRow[]; total: number }

/**
 * The library's cheap read. `null` means "not available" — the caller derives
 * the same rows from usePlaylists() instead. Never surfaces an error state:
 * an absent endpoint is not an operator-visible failure, it is a heavier read.
 */
export function usePlaylistSummary(opts?: { enabled?: boolean }) {
  return useQuery<PlaylistSummaryResponse | null>({
    queryKey: ['playlists', 'summary'],
    queryFn: () => apiFetch('/playlists/summary').catch(() => null),
    enabled: opts?.enabled ?? true,
    retry: false,
    staleTime: 30_000,
  });
}

/** `GET /playlists/:id/delivery` — the workspace Delivery tab's source. */
export interface PlaylistDeliveryTarget {
  screenId: string;
  name: string;
  locationName: string | null;
  online: boolean;
  ackAt: number | null;
  lastProofAt: string | null;
  pushChannel: 'live' | 'stale' | 'unknown';
  state: 'acknowledged' | 'not-updated' | 'offline' | 'unknown';
}
export interface PlaylistDeliveryResponse {
  latest: null | {
    id: string;
    label: string;
    createdAt: string;
    targetCount: number;
    acknowledged: number;
    targets: PlaylistDeliveryTarget[];
  };
  history: Array<{ id: string; label: string; createdAt: string; targetCount: number; acknowledged: number }>;
}

/**
 * `null` here is NOT "nothing to report" — it is "we could not ask". The
 * Delivery tab renders §22.5's unavailable state with a Retry, and the row
 * cell falls back to the client-side derivation. Distinguishing the two is
 * the whole point: a delivery surface that cannot read must never look calm.
 */
export function usePlaylistDelivery(playlistId: string | null | undefined, opts?: { enabled?: boolean }) {
  return useQuery<PlaylistDeliveryResponse | null>({
    queryKey: ['playlists', playlistId, 'delivery'],
    queryFn: () => apiFetch(`/playlists/${playlistId}/delivery`).catch(() => null),
    enabled: !!playlistId && (opts?.enabled ?? true),
    retry: false,
    staleTime: 15_000,
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
      items: Array<{ assetId: string; durationMs: number; sequenceOrder: number; daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null; transitionType?: string | null; muted?: boolean }>;
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
/**
 * "Keep screens in sync" (2026-09-16) — `PUT /playlists/:id/sync`.
 *
 * This setting used to be the screen group's. Operator: "if i have different
 * playlists assigned to screens in the same group it doesnt make sense saying
 * to keep them in sync". Invalidates the screens reads too: whether a screen
 * is frame-locked is DERIVED from what it is playing, so the trim control and
 * the "Calibrate sync…" entry appear and disappear with this flag.
 */
export function useSetPlaylistSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sync }: { id: string; sync: boolean }) =>
      apiFetch(`/playlists/${id}/sync`, {
        method: 'PUT',
        body: JSON.stringify({ sync }),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['screens'] });
      qc.invalidateQueries({ queryKey: ['screen-groups'] });
    },
  });
}

/**
 * ONE screen in ONE playlist: on/off, or out (2026-09-19).
 *
 * Playlist-scoped, not schedule-scoped, for two reasons the server module
 * (apps/api/src/schedules/playlist-screen-rules.ts) spells out: a playlist can
 * hold several windows on one screen and they must all follow the switch, and a
 * screen that is only there through a GROUP rule has no rule of its own to
 * flip — the server splits the group rule so just that screen changes.
 *
 * No optimistic patch on purpose. A split deletes one row and creates several,
 * and guessing that shape client-side is how a row would flash "on" and snap
 * back; the refetch is one request and the button shows its pending state.
 */
export function useSetPlaylistScreenActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, screenId, active }: { playlistId: string; screenId: string; active: boolean }) =>
      apiFetch(`/playlists/${playlistId}/screens/${screenId}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useRemovePlaylistScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, screenId }: { playlistId: string; screenId: string }) =>
      apiFetch(`/playlists/${playlistId}/screens/${screenId}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

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
      // 2026-05-05 — schedule-level audio override (Publish modal
      // "Mute Playback" toggle). Null/undef = honor each
      // PlaylistItem.muted. true = force every video on this
      // schedule muted. false = force every video unmuted.
      mutedOverride?: boolean | null;
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
    mutationFn: ({ id, ...data }: { id: string; screenGroupId?: string; screenId?: string; daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null; priority?: number; mutedOverride?: boolean | null }) =>
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

/**
 * The list endpoint answers in one of TWO shapes and the client must not
 * care which:
 *   - legacy  → a bare `Asset[]` (everything the server was willing to send)
 *   - paged   → `{ assets: Asset[], total: number, q?: string }`
 * `total` is the ONLY thing that proves the server counted the whole
 * library, so its absence means "unknown total", never "that's all of
 * them" (Media Library v1 handoff §22 truth rules).
 */
export interface AssetListPage {
  assets: any[];
  /** Complete-library count for the applied filter — null when unknown. */
  total: number | null;
  /** Search term the SERVER actually applied, when it echoes one back. */
  appliedQuery: string | null;
}

export function normalizeAssetList(raw: any): AssetListPage {
  if (Array.isArray(raw)) return { assets: raw, total: null, appliedQuery: null };
  const assets = Array.isArray(raw?.assets)
    ? raw.assets
    : Array.isArray(raw?.items)
    ? raw.items
    : [];
  const echoed = raw?.q ?? raw?.query ?? raw?.filter?.q;
  return {
    assets,
    total: typeof raw?.total === 'number' ? raw.total : null,
    appliedQuery: typeof echoed === 'string' ? echoed : null,
  };
}

/**
 * `useAssets()` with no argument keeps its historical contract exactly:
 * query key `['assets']`, data = whatever the endpoint returned (an array
 * today). Pass `{ take, q }` for the paginated Media Library window — that
 * variant lives under `['assets','page',…]` so the two never fight, and
 * every asset mutation below invalidates the `['assets']` PREFIX, which
 * covers both.
 */
export function useAssets(params?: { take?: number; skip?: number; q?: string }) {
  const take = params?.take;
  const skip = params?.skip;
  const q = params?.q?.trim() || undefined;
  const paged = params !== undefined;
  return useQuery({
    queryKey: paged ? ['assets', 'page', { take, skip, q }] : ['assets'],
    queryFn: () => {
      const search = new URLSearchParams();
      if (take !== undefined) search.set('take', String(take));
      if (skip !== undefined && skip > 0) search.set('skip', String(skip));
      if (q) search.set('q', q);
      const qs = search.toString();
      return apiFetch(`/assets${qs ? `?${qs}` : ''}`);
    },
    staleTime: 30_000,
    // Growing the window (Load more) or typing in search must not blank the
    // grid — keep the previous page painted while the next one lands.
    placeholderData: paged ? (prev: unknown) => prev : undefined,
  });
}

// ─── Asset usage ("where is this playing?") ──────────────────────
//
// GET /assets/:id/usage. The endpoint may not exist on an older API — a
// 404/500 here means usage is UNKNOWN, which the UI must say out loud
// instead of rendering a reassuring zero (handoff §15/§22).

export interface AssetUsagePlaylist {
  id: string;
  name: string;
  itemCount: number;
  scheduled: boolean;
  activeNow: boolean;
  screensReached: number;
}
export interface AssetUsage {
  playlists: AssetUsagePlaylist[];
  totals: { playlists: number; screensReached: number; locations: number };
  protectedEmergency: boolean;
}

export function assetUsageQueryKey(id: string) {
  return ['asset-usage', id] as const;
}

export function fetchAssetUsage(id: string): Promise<AssetUsage> {
  return apiFetch<AssetUsage>(`/assets/${id}/usage`);
}

export function useAssetUsage(assetId: string | null | undefined) {
  return useQuery({
    queryKey: assetUsageQueryKey(assetId || 'none'),
    queryFn: () => fetchAssetUsage(assetId as string),
    enabled: !!assetId,
    staleTime: 15_000,
    // One shot. A missing endpoint must degrade to "can't check" in one
    // tick, not three retries of latency before the operator learns that.
    retry: false,
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
    // 2026-06-16 mobile-perf: no focus-burst — the 30s interval keeps the
    // reviewer badge fresh while the tab is visible; firing an extra refetch
    // on every app-switch just adds tap-time contention on mobile.
    refetchOnWindowFocus: false,
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

/**
 * AI image generation (2026-06-26) — type a prompt → get a custom,
 * on-brand image saved into the asset library. POST /ai/image returns
 * the created Asset; we invalidate ['assets'] so it appears immediately.
 * Errors (no image-capable provider → AI_IMAGE_UNAVAILABLE, out of
 * credit, cap reached) surface via apiFetch's structured error (e.code /
 * e.status) so the modal can branch the same way the sparkle button does.
 */
export function useGenerateImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }) =>
      apiFetch<{ id: string; fileUrl: string; name: string; status: string; provider: string }>(
        '/ai/image',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

/**
 * Wave B / editor-crush B1 (2026-07-02) — in-editor Pexels stock-photo
 * search. GET /ai/stock-search (thin proxy over StockImageService). A
 * mutation (not a query) because the picker debounces the search input
 * itself and calls `.mutate()` on demand — a query key on free-text search
 * input would thrash the cache on every keystroke for no benefit.
 */
export interface StockSearchResult {
  url: string;
  thumbUrl?: string;
  photographer?: string;
  sourceUrl?: string;
}
export function useStockSearch() {
  return useMutation({
    mutationFn: (params: { query: string; orientation?: 'landscape' | 'portrait' }) => {
      const qs = new URLSearchParams({ q: params.query });
      if (params.orientation) qs.set('orientation', params.orientation);
      return apiFetch<{ results: StockSearchResult[]; configured: boolean }>(
        `/ai/stock-search?${qs.toString()}`,
      );
    },
  });
}

/**
 * Re-host an operator-picked Pexels photo into our own Supabase bucket
 * (durable + offline-cacheable, matches the AI-keep flow). Best-effort —
 * the caller falls back to the raw Pexels URL when `url` comes back
 * undefined (rehost failed but the photo itself still renders fine).
 */
export function useStockRehost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { url: string }) =>
      apiFetch<{ url?: string }>('/ai/stock-rehost', { method: 'POST', body: JSON.stringify(params) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

/**
 * Patch EVERY cached asset list — the legacy `Asset[]` under `['assets']`
 * and the paged `{assets,total}` under `['assets','page',…]`. Returns the
 * snapshot so a failed mutation (e.g. a 409 ASSET_IN_USE) can put the row
 * straight back.
 */
function patchAssetCaches(qc: QueryClient, fn: (assets: any[]) => any[]) {
  const prev = qc.getQueriesData({ queryKey: ['assets'] });
  qc.setQueriesData({ queryKey: ['assets'] }, (old: any) => {
    if (Array.isArray(old)) return fn(old);
    if (Array.isArray(old?.assets)) {
      const next = fn(old.assets);
      const removed = old.assets.length - next.length;
      return {
        ...old,
        assets: next,
        total: typeof old.total === 'number' ? Math.max(0, old.total - removed) : old.total,
      };
    }
    return old;
  });
  return prev;
}

function restoreAssetCaches(qc: QueryClient, prev: Array<[readonly unknown[], unknown]> | undefined) {
  (prev || []).forEach(([key, data]) => qc.setQueryData(key as any, data));
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['assets'] });
      const prev = patchAssetCaches(qc, (assets) => assets.filter((a: any) => a?.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      restoreAssetCaches(qc, ctx?.prev as any);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

/**
 * Audit P1-2 (2026-05-28) — operator-triggered alt-text regeneration.
 * The upload completion path already kicks off alt-text generation in
 * the background; this hook is for the "Generate alt text" button on
 * the asset detail panel when the background job failed or the
 * operator wants a different description.
 *
 * Returns the new altText + provider metadata. Surfaces structured
 * errors (out of credit / no AI configured) so the FE can branch on
 * the codes.
 */
export function useGenerateAltText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{
        id: string;
        altText: string;
        provider: 'openai' | 'anthropic';
        model: string;
        estCostUsd: number;
        asset: any;
      }>(`/assets/${id}/generate-alt-text`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

/**
 * Audit P1-2 (2026-05-28) — operator override of alt-text. Pass
 * `altText: null` (or '') to clear; anything longer than 160 chars is
 * rejected server-side.
 */
export function useUpdateAltText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, altText }: { id: string; altText: string | null }) =>
      apiFetch(`/assets/${id}/alt-text`, {
        method: 'PUT',
        body: JSON.stringify({ altText }),
      }),
    onMutate: async ({ id, altText }) => {
      await qc.cancelQueries({ queryKey: ['assets'] });
      const prev = patchAssetCaches(qc, (assets) =>
        assets.map((a: any) => (a?.id === id ? { ...a, altText } : a)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      restoreAssetCaches(qc, ctx?.prev as any);
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
      const prev = patchAssetCaches(qc, (assets) =>
        assets.map((a: any) => (a?.id === id ? { ...a, folderId } : a)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      restoreAssetCaches(qc, ctx?.prev as any);
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
    // `cache: 'no-store'` — the GET /templates response carries an HTTP
    // `Cache-Control: max-age=30, stale-while-revalidate=120` header. That
    // browser HTTP cache sits UNDERNEATH React Query and was serving a
    // stale list to the post-mutation refetch: after saving a new/edited
    // template the gallery showed a blank card until a hard refresh.
    // React Query (staleTime below) is already the client cache, so opt
    // this one endpoint out of the HTTP layer — invalidation now lands
    // and the new template's live thumbnail renders immediately on save.
    queryFn: () => apiFetch(`/templates${category ? `?category=${category}` : ''}`, { cache: 'no-store' }),
    staleTime: 60_000,
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: () => apiFetch(`/templates/${id}`),
    enabled: !!id,
    staleTime: 60_000,
    // overnight-review P2 (2026-07-03): the builder's C1 draft-recovery check
    // (BuilderShell isDraftNewer) compares a local draft against this row's
    // updatedAt. With staleTime 60s + global refetchOnWindowFocus:false, a
    // remount within that window could compare against a CACHED (client-stale)
    // updatedAt and offer a false "restore" prompt. Refetch on mount so the
    // check always sees live server truth. Single mount-time fetch (NOT a
    // background poll / focus storm) — mobile-perf guard is unaffected.
    refetchOnMount: 'always',
  });
}

/**
 * Per-template operational usage for the tenant's OWN templates
 * (Templates Gallery — Calm v1, §4.3 / §6.3).
 *
 * THE TRUTH RULE: "unknown" is never "zero" and never "Not in use". This
 * endpoint may not exist on the deployed API (it ships alongside this
 * surface, and a Vercel web deploy can land before the Railway API one).
 * When it 404s / 500s / times out this hook resolves to `undefined` —
 * NOT an empty map — so the gallery renders NO usage pill at all rather
 * than telling an operator a live board is idle. Never "fix" this by
 * defaulting to `{}`; that is exactly the lie the rule exists to stop.
 *
 * `activeNow` is a server claim about reach through playlists + active
 * schedules + screens. The card only says `LIVE` when the server proves
 * BOTH activeNow AND screensReached > 0 (see deriveTemplateUsage).
 */
export interface TemplateUsageEntry {
  playlists: number;
  screensReached: number;
  activeNow: boolean;
}

export function useTemplateUsageSummary() {
  return useQuery<Record<string, TemplateUsageEntry> | undefined>({
    queryKey: ['templates', 'usage-summary'],
    queryFn: async () => {
      try {
        const res: any = await apiFetch('/templates/usage-summary');
        const byTemplate = res?.byTemplate;
        // A malformed/absent payload is UNKNOWN, not "nothing is in use".
        if (!byTemplate || typeof byTemplate !== 'object') return undefined;
        return byTemplate as Record<string, TemplateUsageEntry>;
      } catch {
        // Endpoint not deployed yet, or a transient failure — degrade to
        // unknown. The gallery stays calm and simply omits usage.
        return undefined;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useTemplateBackdrops() {
  return useQuery<Array<{ id: string; name: string; bgColor: string | null; bgGradient: string | null; bgImage: string | null }>>({
    queryKey: ['template-backdrops'],
    queryFn: () => apiFetch('/templates/backdrops'),
    staleTime: 5 * 60 * 1000, // 5 min — backdrops rarely change
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
    // 2026-05-13 — gained optional screenWidth / screenHeight /
    // orientation so the "Adapt for LED" flow can pick a new canvas size
    // when duplicating. Zones inherit their %-based positions; widgets
    // self-scale to fit the new aspect via their internal useScaleToFit.
    mutationFn: ({ id, name, screenWidth, screenHeight, orientation }: {
      id: string;
      name?: string;
      screenWidth?: number;
      screenHeight?: number;
      orientation?: 'LANDSCAPE' | 'PORTRAIT';
    }) =>
      apiFetch(`/templates/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name, screenWidth, screenHeight, orientation }),
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
      /** Phase D — persist the touch toggle so the builder isn't a
       *  purely-local switch. Server clamps idleResetMs to a sane range. */
      isTouchEnabled?: boolean;
      idleResetMs?: number;
      /**
       * C2 (Wave C, 2026-07-02) — the `updatedAt` the client loaded (or
       * last successfully saved). The server compares it against the
       * row's current `updatedAt` and 409s with
       * `{code:'TEMPLATE_STALE', serverUpdatedAt}` if someone else
       * saved in between. Omit (undefined) to skip the check entirely
       * — both an older client that's never heard of this field AND
       * the explicit "Overwrite" retry after a conflict use that path,
       * so behavior for every existing caller is byte-for-byte
       * unchanged unless they opt in.
       */
      expectedUpdatedAt?: string | null;
    }) => apiFetch(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * IMAGERY wave (2026-06-28) — the one-tap "Make it an AI photo" upgrade. POST
 * /templates/:id/regenerate-image generates an on-brand AI photo (BYOK image
 * provider), persists it to the asset library, and swaps the board's bgImage.
 * Returns { bgImage, assetId }. Errors (AI_IMAGE_UNAVAILABLE for Anthropic /
 * no-image-provider, cap reached, out of credit) surface via apiFetch's
 * structured error so the builder can branch like the sparkle / image button.
 */
export function useRegenerateBoardImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) =>
      apiFetch<{ bgImage: string; assetId: string }>(
        `/templates/${id}/regenerate-image`,
        { method: 'POST', body: JSON.stringify({ prompt }) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

export function useUpdateTemplateZones() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, zones, expectedUpdatedAt }: {
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
        /** Phase D1 — JSON-serialized touch action; null clears it. */
        touchAction?: any;
        /** Phase D2.5 — null = shared across every scene. */
        sceneId?: string | null;
        /** M0-7 (2026-09-12) — the builder's per-zone lock. This PUT is a
         *  delete-all-and-recreate, so a zone the caller sends WITHOUT this
         *  field comes back unlocked; BuilderShell's two save-payload
         *  builders both send it explicitly. */
        locked?: boolean;
      }>;
      /** C2 — same staleness guard as useUpdateTemplate; see that hook's
       *  doc comment. Optional + independently omittable, since a
       *  caller could in principle want the metadata write guarded but
       *  not the zones write (BuilderShell's handleSave sends it to
       *  both — see its comment for why). */
      expectedUpdatedAt?: string | null;
    }) => apiFetch(`/templates/${id}/zones`, { method: 'PUT', body: JSON.stringify({ zones, expectedUpdatedAt }) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * C3 (Wave C, 2026-07-02) — version-history list for the builder's
 * History affordance. Light payload only (id/createdAt/byUser) — see
 * the controller's listVersions doc comment for why the full zones/
 * meta snapshot never ships here. Disabled by default (enabled: false
 * option) so mounting the History button doesn't fire a request until
 * the operator actually opens the panel.
 */
export function useTemplateVersions(id: string | undefined, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['templates', id, 'versions'],
    queryFn: () => apiFetch<Array<{ id: string; createdAt: string; byUser: { id: string; email: string } | null }>>(`/templates/${id}/versions`),
    enabled: !!id && (opts?.enabled ?? true),
    staleTime: 10_000,
  });
}

/**
 * C3 — restore a version. The server snapshots the CURRENT state
 * FIRST (never destructive — see the controller's restoreVersion doc
 * comment), then applies the old zones/meta as a normal save and
 * returns the fully-updated template (same mapTemplate() shape as
 * GET/PUT). BuilderShell re-inits the store on the response exactly
 * like its "Reload theirs" (C2) path does.
 *
 * C2 sweep follow-up (2026-07-03) — restore performs the SAME
 * destructive delete-all-zones-and-recreate + metadata overwrite as
 * update()/replaceZones(), which already send `expectedUpdatedAt`;
 * restore was left out of the original sweep. Same optional guard,
 * same backward-compat contract: omit it and the server behaves
 * exactly like before this fix.
 */
export function useRestoreTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId, expectedUpdatedAt }: { id: string; versionId: string; expectedUpdatedAt?: string | null }) =>
      apiFetch(`/templates/${id}/versions/${versionId}/restore`, { method: 'POST', body: JSON.stringify({ expectedUpdatedAt }) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.id] });
      qc.invalidateQueries({ queryKey: ['templates', vars.id, 'versions'] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    // Accepts a bare id (back-compat) OR { id, force } — force=true asks the
    // server to unlink the template from any playlists and delete anyway (the
    // gallery's "Delete anyway" confirm after a TEMPLATE_IN_USE 409).
    mutationFn: (vars: string | { id: string; force?: boolean }) => {
      const id = typeof vars === 'string' ? vars : vars.id;
      const force = typeof vars === 'string' ? false : !!vars.force;
      return apiFetch(`/templates/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    },
    onMutate: async (vars) => {
      const id = typeof vars === 'string' ? vars : vars.id;
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
    onError: (_e, _vars, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, val] of ctx.snapshots) qc.setQueryData(key, val);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// Cross-account template export / import. Export returns a portable
// JSON envelope (modelled as a mutation so the button gets isPending);
// import POSTs that envelope and the API creates a fresh tenant-owned
// template, so the gallery list is invalidated on success.
export function useExportTemplate() {
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/templates/${id}/export`),
  });
}

export function useImportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (envelope: any) =>
      apiFetch('/templates/import', { method: 'POST', body: JSON.stringify(envelope) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// ─── Touch analytics (Phase D5) ─────────────────────────────────

export interface TouchAggregateResponse {
  templateId: string;
  sinceDays: number;
  sceneId: string | null;
  total: number;
  byZone: Record<string, number>;
}

export function useTouchAggregate(templateId: string, opts?: { sinceDays?: number; sceneId?: string; enabled?: boolean }) {
  const sinceDays = opts?.sinceDays ?? 30;
  const sceneId = opts?.sceneId;
  return useQuery<TouchAggregateResponse>({
    queryKey: ['analytics', 'touch', templateId, sinceDays, sceneId || null],
    queryFn: () => {
      const qs = new URLSearchParams({ sinceDays: String(sinceDays) });
      if (sceneId) qs.set('sceneId', sceneId);
      return apiFetch<TouchAggregateResponse>(`/analytics/touch-events/template/${templateId}?${qs.toString()}`);
    },
    enabled: !!templateId && (opts?.enabled ?? true),
    staleTime: 30_000,
    retry: false,
  });
}

// ─── Proof-of-play analytics ────────────────────────────────────

export interface ProofOfPlayEntry {
  name: string;
  samples: number;
  estimatedHours: number;
}
export interface ProofOfPlayResponse {
  /** false when the playback_samples migration has not been applied. */
  ready: boolean;
  sinceDays: number;
  sampleMinutes: number;
  totalSamples: number;
  estimatedScreenHours: number;
  playlists: Array<ProofOfPlayEntry & { playlistId: string }>;
  assets: Array<ProofOfPlayEntry & { assetId: string; mimeType: string | null }>;
  screens: Array<ProofOfPlayEntry & { screenId: string }>;
}

/** Proof-of-play report — content / sponsor display time over `days`. */
export function useProofOfPlay(days: number) {
  return useQuery<ProofOfPlayResponse>({
    queryKey: ['analytics', 'proof-of-play', days],
    queryFn: () => apiFetch<ProofOfPlayResponse>(`/analytics/proof-of-play?days=${days}`),
    staleTime: 60_000,
    retry: false,
  });
}

// ─── Template AI generate (Phase D3) ────────────────────────────
//
// POST /templates/generate-touch — operator types a prompt, AI returns
// a structured template payload (sanitized server-side), the controller
// persists it, we get back the full Template + ai usage info.

export interface AiGenerateTouchResponse {
  template: any;
  ai: {
    source: 'tenant' | 'platform';
    usage: { used: number; cap: number; resetAt: string } | null;
  };
}

export function useGenerateTouchTemplate() {
  const qc = useQueryClient();
  return useMutation<
    AiGenerateTouchResponse,
    Error,
    { prompt: string; screenWidth?: number; screenHeight?: number; vertical?: string }
  >({
    mutationFn: (body) =>
      apiFetch<AiGenerateTouchResponse>('/templates/generate-touch', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

// ─── Slice 1c (2026-06-16) — 3-candidate generation ──────────────
//
// POST /templates/generate-touch/candidates → up to 3 sanitized DRAFTS
// (not persisted) so the operator picks a winner. Then
// POST /templates/create-from-candidate persists the chosen one. Serves
// both touch templates and passive (non-touch) signage via `interactive`.

/** A single AI draft. Shape mirrors the server sanitizer output. */
export interface AiTemplateCandidate {
  name: string;
  description?: string;
  zones: Array<{
    name?: string;
    widgetType: string;
    x: number;
    y: number;
    width: number;
    height: number;
    defaultConfig?: Record<string, any>;
    touchAction?: any;
    /** Multi-scene "Build a set" — the scene NAME this zone belongs to. */
    sceneRef?: string;
  }>;
  scenes?: Array<{ name: string }>;
  /** Engine boards (signage-design) carry a template-level background + the
   *  art-director's archetype/theme so create-from-candidate can persist them. */
  background?: { bgColor?: string; bgGradient?: string; bgImage?: string };
  archetype?: string;
  theme?: string;
  /** Wave 3 — the ArtDirectorSpec this candidate was built from, so chat-to-edit
   *  (refine-signage) can patch it as a delta-prompt. Present on engine candidates. */
  spec?: any;
  /** AI Designer (2026-06-29) — when set, this candidate is a full-HTML board.
   *  Carries the raw HTML so the picker can persist it via create-designer
   *  (base64). The preview renders it through the EXTERNAL_HTML srcdoc zone. */
  _designerHtml?: string;
  /** #268-1 keep-telemetry — carried from the generate batch and echoed on
   *  keep (create-designer) so the audit trail ties the KEPT board back to
   *  its generation batch + art direction. */
  _batchId?: string;
  _artDirection?: string;
  /** 2026-09-22 — the designer layout id this candidate was built as. */
  _structure?: string;
}

export interface AiGenerateCandidatesResponse {
  candidates: AiTemplateCandidate[];
  ai: {
    source: 'tenant' | 'platform';
    usage: { used: number; cap: number; resetAt: string } | null;
  };
}

export function useGenerateTouchCandidates() {
  // No list invalidation here — candidates aren't persisted until the
  // operator picks one (useCreateFromCandidate does the invalidation).
  return useMutation<
    AiGenerateCandidatesResponse,
    Error,
    {
      prompt: string;
      screenWidth?: number;
      screenHeight?: number;
      vertical?: string;
      interactive?: boolean;
      count?: number;
      /** Route through the @cms/signage-design art-director engine (Wave 2).
       *  Used for passive signage boards — grid-locked archetype + theme. */
      engine?: boolean;
      /** Wave 2a — "build a set": ONE prompt (or many newline-separated) →
       *  ONE cohesive multi-scene template (4-6 boards) that plays itself.
       *  Returns a single candidate whose scenes[] is the set. Implies engine. */
      set?: boolean;
    }
  >({
    mutationFn: (body) =>
      apiFetch<AiGenerateCandidatesResponse>('/templates/generate-touch/candidates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

// Wave 3 (2026-06-27) — CHAT-TO-EDIT. Refine an engine candidate by a
// natural-language instruction; returns a NEW candidate (same shape, with the
// updated spec) to replace it in the picker. Not persisted until "Use this".
export function useRefineSignageBoard() {
  return useMutation<
    AiGenerateCandidatesResponse,
    Error,
    {
      spec: any;
      instruction: string;
      screenWidth?: number;
      screenHeight?: number;
      vertical?: string;
    }
  >({
    mutationFn: (body) =>
      apiFetch<AiGenerateCandidatesResponse>('/templates/refine-signage', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

export function useCreateFromCandidate() {
  const qc = useQueryClient();
  return useMutation<
    { template: any },
    Error,
    {
      candidate: AiTemplateCandidate;
      screenWidth?: number;
      screenHeight?: number;
      interactive?: boolean;
      /** Engine boards carry a template-level background to persist. */
      background?: { bgColor?: string; bgGradient?: string; bgImage?: string };
    }
  >({
    mutationFn: (body) =>
      apiFetch<{ template: any }>('/templates/create-from-candidate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

// ─── AI Designer (2026-06-29) — full-HTML, designer-grade boards ──────
//
// A top model AUTHORS a COMPLETE premium HTML signage board (not a templated
// engine layout). Each candidate is the whole board as an HTML string; it
// renders through the EXTERNAL_HTML srcdoc path (ExternalHtmlWidget). The
// picker maps each into a one-zone EXTERNAL_HTML candidate for preview, then
// persists the chosen board via create-designer as base64 (the global
// SanitizationPipe strips a raw html field — base64 survives it).

/** One AI-designed board: the whole document as an HTML string. */
export interface DesignerBoardCandidate {
  name: string;
  html: string;
  screenWidth: number;
  screenHeight: number;
  taurusWarnings?: string[];
  /** #268-1 keep-telemetry — the LAYOUT this candidate was built as, in
   *  English ("Rail + cards" / "Hero + cards" / …; before 2026-09-22 an art
   *  direction); echoed back on keep so the audit trail measures first-try
   *  hit rate. */
  artDirection?: string;
  /** 2026-09-22 — the layout's stable id ("rail-cards"), which the pick grid
   *  turns into a translated label. */
  structure?: string;
}

export interface DesignerCandidatesResponse {
  candidates: DesignerBoardCandidate[];
  /** #268-1 keep-telemetry — ties this batch to the eventual keep. */
  batchId?: string;
  source?: 'tenant' | 'platform';
  usage?: { used: number; cap: number; resetAt: string } | null;
}

export function useGenerateDesignerCandidates() {
  // Not persisted until the operator picks one (useCreateDesigner invalidates).
  return useMutation<
    DesignerCandidatesResponse,
    Error,
    {
      prompt: string;
      screenWidth?: number;
      screenHeight?: number;
      vertical?: string;
      palette?: string[];
      venueName?: string;
      tagline?: string;
      logoUrl?: string;
      heroImageUrl?: string;
      content?: string;
      reference?: string;
      count?: number;
    }
  >({
    mutationFn: (body) =>
      apiFetch<DesignerCandidatesResponse>('/templates/generate-designer/candidates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

export function useCreateDesigner() {
  const qc = useQueryClient();
  // create-designer returns the created template directly (mapTemplate), so the
  // result carries `.id`. The HTML must be base64 (htmlBase64) to survive the
  // global input sanitizer untouched.
  return useMutation<
    { id: string; [k: string]: any },
    Error,
    {
      name?: string;
      htmlBase64: string;
      screenWidth?: number;
      screenHeight?: number;
      // #268-1 keep-telemetry — echoed from the generate batch so the server
      // audit row ties the keep to batch/candidate/art direction.
      batchId?: string;
      candidateIndex?: number;
      artDirection?: string;
    }
  >({
    mutationFn: (body) =>
      apiFetch<{ id: string; [k: string]: any }>('/templates/create-designer', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

// ─── Signage Concierge (2026-06-28) — conversational AI intake ──────
//
// The operator CHATS with a signage-savvy AI instead of filling a fixed
// wizard. The model asks the right next question, accepts reference URLs +
// image uploads, and fills a structured ConciergeIntake until it can
// generate the same 3 candidates as the wizard path. These mutations are
// request/response only — NO list invalidation (nothing is persisted until
// the operator hands the intake off to the existing generate flow).

/** One conversational turn. Re-send the FULL transcript + references each
 *  call (the server rebuilds the system prompt per turn, so it must "see"
 *  everything gathered so far). Errors carry err.status/err.code/err.body
 *  (see apiFetch) so the UI can map 402 cap / 503 not-configured / 422. */
export function useConciergeChat() {
  return useMutation<
    ConciergeTurnResponse,
    Error,
    {
      messages: ConciergeMessage[];
      references?: ConciergeReference[];
      vertical?: string;
      screenWidth?: number;
      screenHeight?: number;
      /** 2026-09-22 — the POS menu picked in the Concierge's card (server re-verifies it). */
      posSelection?: { connectionId: string; sections: string[] };
    }
  >({
    mutationFn: (body) =>
      apiFetch<ConciergeTurnResponse>('/templates/concierge/chat', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

/** Scrape a customer URL into a compact reference summary (name / palette /
 *  hero image). May 422 with { code: 'CONCIERGE_SCRAPE_FAILED' }.
 *
 *  2026-09-23 — sends the canvas being designed (`canvas`, the Concierge's own
 *  prop; a call may pass screenWidth/screenHeight itself), so the reference's
 *  photo is checked and sized for THAT board rather than for 3840×2160. */
export function useConciergeUrlReference(canvas?: { w: number; h: number } | null) {
  return useMutation<ConciergeReference, Error, { url: string; screenWidth?: number; screenHeight?: number }>({
    mutationFn: (vars) =>
      apiFetch<ConciergeReference>('/templates/concierge/reference/url', {
        method: 'POST',
        body: JSON.stringify(
          conciergeUrlReferenceBody(
            vars.url,
            vars.screenWidth != null && vars.screenHeight != null ? { w: vars.screenWidth, h: vars.screenHeight } : canvas,
          ),
        ),
      }),
  });
}

/** Summarize an uploaded image of a look the operator likes (vision →
 *  palette + style summary). Multipart FormData (field `file`). apiFetch
 *  auto-detects FormData and skips the JSON Content-Type so the multipart
 *  boundary survives — and still attaches err.status/code/body on a 422
 *  ({ code: 'CONCIERGE_VISION_UNAVAILABLE' }). */
export function useConciergeImageReference() {
  return useMutation<ConciergeReference, Error, File>({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiFetch<ConciergeReference>('/templates/concierge/reference/image', {
        method: 'POST',
        body: fd,
      });
    },
  });
}

// ─── App Library Concierge auto-fill (2026-07-01) ───────────────────
//
// NOT the same feature as the Signage Concierge chat above — this wires
// the Integration Concierge's /integrations/discover + /describe endpoints
// (apps/api/src/integrations/integrations.controller.ts, already live and
// SSRF-safe/rate-limited) into the App Library picker so it can float
// "we found your Instagram" suggestions instead of making the operator
// hunt down their own URLs. See docs/research/2026-06-30-app-library/
// 20-WORLDCLASS-BUILD-PLAN.md Tier 2 "Full Concierge 'Suggested for you' row".

/** Mirrors apps/api/src/integrations/discovery.service.ts ProviderCandidate
 *  (kept as a local shape here rather than importing from the API package —
 *  the web app doesn't depend on apps/api types elsewhere in this file). */
export interface ConciergeProviderCandidate {
  id: string;
  name: string;
  category: string;
  confidence: number;
  blurb: string;
  matchedSignals: string[];
  status: 'AVAILABLE' | 'COMING_SOON';
  connectHref: string | null;
  comingSoonReason?: string;
  /** The operator's own extracted link for this provider, when found —
   *  what lets the App Library pre-fill a tile instead of just naming it. */
  detectedValue?: string;
}

export interface ConciergeDiscoveryResult {
  source: 'url' | 'description';
  inputSummary: string;
  candidates: ConciergeProviderCandidate[];
  warnings: string[];
  /** Provider-agnostic own-link map keyed by App Registry id where
   *  possible (youtube / vimeo / twitch / instagram / facebook-page /
   *  google-slides / google-sheets / calendar / news-rss) — see
   *  concierge-map.ts for how the App Library resolves these to tiles. */
  ownLinks: Record<string, string>;
}

/** POST the tenant's own website to /integrations/discover. Manually
 *  triggered (not query-on-mount) via `.mutateAsync()` so the App Library
 *  panel controls exactly when the (rate-limited, 20/hr) call fires —
 *  once per panel-open at most, never per keystroke. */
export function useDiscoverIntegrations() {
  return useMutation<ConciergeDiscoveryResult, Error, { url: string }>({
    mutationFn: (body) =>
      apiFetch<ConciergeDiscoveryResult>('/integrations/discover', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

/** POST a free-text business description to /integrations/describe — the
 *  no-website-on-file fallback ("Tell us what you do"). */
export function useDescribeBusiness() {
  return useMutation<ConciergeDiscoveryResult, Error, { text: string }>({
    mutationFn: (body) =>
      apiFetch<ConciergeDiscoveryResult>('/integrations/describe', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

// ─── Template scenes (Phase D2.5) ───────────────────────────────
//
// Wraps the /templates/:id/scenes CRUD endpoints. All four mutations
// invalidate the parent template query so the builder store picks up
// the fresh scenes list on the next render.

export interface TemplateScene {
  id: string;
  templateId: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
}

export function useTemplateScenes(templateId: string) {
  return useQuery<TemplateScene[]>({
    queryKey: ['templates', templateId, 'scenes'],
    queryFn: () => apiFetch<TemplateScene[]>(`/templates/${templateId}/scenes`),
    enabled: !!templateId,
    staleTime: 30_000,
  });
}

export function useCreateScene(templateId: string) {
  const qc = useQueryClient();
  return useMutation<TemplateScene, Error, { name?: string }>({
    mutationFn: (body) =>
      apiFetch<TemplateScene>(`/templates/${templateId}/scenes`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', templateId] });
    },
  });
}

export function useUpdateScene(templateId: string) {
  const qc = useQueryClient();
  return useMutation<
    TemplateScene,
    Error,
    { sceneId: string; patch: { name?: string; sortOrder?: number; isDefault?: boolean } }
  >({
    mutationFn: ({ sceneId, patch }) =>
      apiFetch<TemplateScene>(`/templates/${templateId}/scenes/${sceneId}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', templateId] });
    },
  });
}

export function useDeleteScene(templateId: string) {
  const qc = useQueryClient();
  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: (sceneId) =>
      apiFetch<{ success: boolean }>(`/templates/${templateId}/scenes/${sceneId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', templateId] });
    },
  });
}

// ─── Users ──────────────────────────────────────────────────────

/** A row of GET /users (the Team Members list). */
export type TeamUser = {
  id: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  createdAt?: string;
  /** ACC-03 — admin-forced 2FA. Enforced in AuthService.login. */
  mfaRequired: boolean;
  /** Whether they hold ANY second factor — `mfaMethods.length > 0`. */
  mfaEnrolled: boolean;
  /**
   * 2026-09-21 — WHICH second factors this account holds. `mfaEnrolled` was
   * derived from TOTP enrollment alone, so a passkey-only user read as "not
   * set up" in the only list an admin looks at — and an admin about to reset
   * someone's second factor has to see what they are actually removing.
   *
   * OPTIONAL because an older API build does not send it; every reader must
   * fall back to the boolean rather than assume an empty array means "none".
   */
  mfaMethods?: Array<'totp' | 'passkey'>;
  /**
   * 2026-08-03 — `ACTIVE` | `DISABLED` | `INVITED`. Anything other than
   * `ACTIVE` is refused at login (`AuthService.validateUser`).
   */
  status?: string;
};

export function useUsers() {
  return useQuery<TeamUser[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch('/users'),
    staleTime: 60_000,
  });
}

/**
 * ACC-03 follow-up (2026-08-03) — force (or release) two-factor for a team
 * member.
 *
 * Turning it ON signs the target out of every device, so the policy takes
 * effect now rather than at their next natural login; they are then routed
 * through the login page's enrollment step. Rank-gated server-side: a caller
 * can only set this on someone strictly below their own role, so a 403 here
 * is a real answer to show the operator, not a bug.
 */
export function useSetUserMfaRequired() {
  const qc = useQueryClient();
  return useMutation<TeamUser, Error, { id: string; mfaRequired: boolean }>({
    mutationFn: ({ id, mfaRequired }) =>
      apiFetch(`/users/${id}/mfa-required`, {
        method: 'PUT',
        body: JSON.stringify({ mfaRequired }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}

/**
 * 2026-08-03 — cut a departing staff member off (or let them back in).
 *
 * Disable is the reversible half of "fire an employee": it flips
 * `User.status` to `DISABLED` (login refuses anything that is not `ACTIVE`)
 * AND burns every live session server-side, so an already-issued token stops
 * working immediately instead of lasting up to 30 days. Re-enabling is a
 * widening and leaves sessions alone.
 *
 * Rank-gated server-side — a caller can only act on someone strictly below
 * their own role, inside their own tenant subtree — so a 403 here is a real
 * answer to show the operator, not a bug.
 */
export function useSetUserDisabled() {
  const qc = useQueryClient();
  return useMutation<TeamUser, Error, { id: string; disabled: boolean }>({
    mutationFn: ({ id, disabled }) =>
      apiFetch(`/users/${id}/disabled`, {
        method: 'PUT',
        body: JSON.stringify({ disabled }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}

/**
 * 2026-09-21 — reset ANOTHER user's two-factor sign-in.
 *
 * The lockout lever that did not exist. `mfaTotp*: null` had one writer in the
 * whole product — `/auth/mfa/disable`, acting on the caller — so an admin who
 * lost their phone and had spent their backup codes was locked out for good
 * and support had nothing to offer.
 *
 * Carries the ACTOR'S OWN password as a step-up, so a hijacked session alone
 * cannot strip someone's second factor. NO OPTIMISTIC UPDATE: this is a
 * security write, and the row must not read "Not set up" until the server says
 * it is. A wrong password comes back 403 `USER_MFA_RESET_BAD_PASSWORD`, never
 * 401 — a 401 would make `api-client.ts` sign the operator out for a typo.
 */
export function useResetUserMfa() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; hadTotp: boolean; passkeysRemoved: number; sessionsRevoked: true },
    Error,
    { id: string; password: string; reason?: string }
  >({
    mutationFn: ({ id, password, reason }) =>
      apiFetch(`/users/${id}/mfa/reset`, {
        method: 'POST',
        body: JSON.stringify(reason ? { password, reason } : { password }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}

// 2026-05-11 — self-profile hooks. Operator: "let's say Hi Greg not
// gschiemann." Reads/writes the caller's firstName + lastName.
export type SelfProfile = {
  id: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  canTriggerPanic: boolean;
  tenantId: string;
};
export function useMe() {
  return useQuery<SelfProfile>({
    queryKey: ['users', 'me'],
    queryFn: () => apiFetch('/users/me'),
    staleTime: 30_000,
  });
}
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { firstName?: string | null; lastName?: string | null }) =>
      apiFetch('/users/me', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (updated: any) => {
      qc.setQueryData(['users', 'me'], updated);
      // 2026-05-12 — operator: "in settings under team members we
      // should see first last name" — the team list query
      // (`['users']` from useUsers) had cached the pre-update rows
      // with null names. Invalidating forces a refetch so the
      // operator's own row in their own team list updates to "Greg
      // Schiemann" immediately, not after a 60s staleTime expiry.
      qc.invalidateQueries({ queryKey: ['users'] });
      // 2026-05-12 — operator caught: "updated my profile with my
      // name but still says gschiemann on dashboard." Root cause was
      // a dynamic `require('@/store/ui-store')` here — Next.js
      // client modules use ESM, so the require returned a different
      // module instance than the one components statically imported.
      // The setState fired on the wrong store; subscribers never got
      // the update.
      //
      // Fix: use the same static import the rest of the file uses
      // (line 4). Now setState lands on THE store, the dashboard's
      // useAppStore selector sees the new user object, and the
      // "Hi {firstName}" greeting re-renders immediately.
      const cur = useUIStore.getState().user;
      if (cur && cur.id === updated.id) {
        const nextUser = {
          ...cur,
          firstName: updated.firstName ?? null,
          lastName: updated.lastName ?? null,
        };
        useUIStore.setState({ user: nextUser });
        // Persist back to sessionStorage so a page refresh doesn't
        // lose the names. The store's bootstrapAuth reads
        // sessionStorage on init; without this, the next reload
        // would re-hydrate from the OLD JSON (no firstName/lastName)
        // and the greeting would revert to email-prefix.
        try {
          if (typeof window !== 'undefined') {
            const ss = window.sessionStorage;
            if (ss && ss.getItem('edu_cms_user')) {
              ss.setItem('edu_cms_user', JSON.stringify(nextUser));
            }
          }
        } catch { /* sessionStorage unavailable — non-fatal */ }
      }
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  // 2026-05-11 — invite now accepts firstName + lastName so the
  // dashboard greets new admins by name from day one instead of
  // "Hi Pjones" from the email prefix.
  return useMutation({
    mutationFn: (data: { email: string; role: string; firstName?: string; lastName?: string }) =>
      apiFetch('/invites', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// Admin-sets-password path: create a user directly, skip the email invite.
export function useCreateUserDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role: string; password: string; firstName?: string; lastName?: string }) =>
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

// ─── Standard LED poster size (2026-09-01) ────────────────────────
// A NovaStar TB poster cannot report its own LED module size — the
// controller knows its output raster, not the pitch bolted in front of it.
// So the operator states it once per tenant and every poster inherits it
// until a screen sets its own canvas.
//
// The stock 1.86 mm poster is 320×1080. NULL on the tenant is a real value
// meaning "use that built-in default", so an org that never opens the
// settings card behaves exactly as it did before this shipped.
export const DEFAULT_POSTER_STANDARD = { w: 320, h: 1080 } as const;

export interface TenantPosterStandard {
  /** The size to USE — the tenant's own, or the built-in default. */
  w: number;
  h: number;
  /** True when the tenant has stored nothing and is riding the default. */
  isDefault: boolean;
  /** What is actually persisted (null/null = default). */
  storedW: number | null;
  storedH: number | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Reads the standard off the tenant payload the dashboard already loads —
 * no second endpoint, no second poll.
 */
export function useTenantPosterStandard(): TenantPosterStandard {
  const { data, isLoading, isError } = useTenant();
  const t = data as any;
  const storedW = typeof t?.posterStandardW === 'number' ? t.posterStandardW : null;
  const storedH = typeof t?.posterStandardH === 'number' ? t.posterStandardH : null;
  // Only a COMPLETE pair counts. A half-set row (the API refuses to write one,
  // but an older row could exist) falls back rather than pairing a custom
  // width with a default height.
  const custom = storedW !== null && storedH !== null;
  return {
    w: custom ? storedW : DEFAULT_POSTER_STANDARD.w,
    h: custom ? storedH : DEFAULT_POSTER_STANDARD.h,
    isDefault: !custom,
    storedW, storedH,
    isLoading, isError,
  };
}

/**
 * PUT /tenants/:id/poster-standard — `{ w: null, h: null }` resets to the
 * built-in default. Invalidates the tenant query (and the status poll that
 * reads the same payload) so every mounted picker re-reads the new standard.
 */
export function useSetTenantPosterStandard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ w, h }: { w: number | null; h: number | null }) => {
      // Read the id out of the cache rather than subscribing to the query —
      // this hook must not re-render its host on every tenant refetch. `me`
      // is the server-side alias for the caller's own tenant, so a mutation
      // fired before the tenant payload has landed still targets correctly.
      const id = (qc.getQueryData<any>(['tenant']) as any)?.id ?? 'me';
      return apiFetch(`/tenants/${id}/poster-standard`, {
        method: 'PUT',
        body: JSON.stringify({ w, h }),
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tenant'] });
      qc.invalidateQueries({ queryKey: ['tenant-status'] });
    },
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

// ─── Fleet roll-up (HQ → all child locations' screens) ─────────
// GET /screens/fleet — parent ("Corporate") reads self + direct children's
// screens into one map + list (read-only; actions happen by switching into
// the owning store). Gated to SUPER_ADMIN / DISTRICT_ADMIN server-side, so
// only enable the query for those roles (others would 403).
export interface FleetScreen {
  id: string;
  name: string;
  status: string;
  screenGroup: { id: string; name: string } | null;
  lastPingAt: string | null;
  lastCacheReport: any;
  // Render-proof (2026-08-24) — "reachable but NOT painting". Optional in the
  // type so a stale/cached payload from before this shipped still parses;
  // deriveRenderTrust() treats an absent verdict as UNKNOWN, never an alarm.
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  renderStaleSeconds?: number | null;
  effectiveLatitude: number | null;
  effectiveLongitude: number | null;
  effectiveAddress: string | null;
  geoSource: 'screen' | 'group' | 'tenant' | 'none';
  sourceTenant: { id: string; name: string; slug: string } | null;
  /** Fleet Command (2026-08-31) — content-current assurance inputs. */
  lastBundleSha?: string | null;
  /**
   * `Screen.lastBundleId` (2026-09-21) — the identity the player actually
   * decides to RELOAD on. Optional so a cached payload from before this
   * shipped still parses; absent falls back to the SHA comparison, which is
   * exactly the pre-2026-09-21 behaviour.
   */
  lastBundleId?: string | null;
  pendingRefreshAtMs?: number | null;
  refreshAckMs?: number | null;
  /**
   * Delivery path: an instant channel, or the ~10s check-in backstop.
   * The payload has always carried it (screens.controller `fleet()`); it was
   * only ever read through a cast, which is exactly how a field like this
   * silently goes missing.
   */
  pushChannel?: 'live' | 'stale' | 'unknown' | null;
}
/**
 * One location row in the fleet payload.
 *
 * The geo fields are the tenant's OWN address/coordinates (2026-08-31): map
 * pins used to derive position exclusively from a screen's effective geo, so
 * a location with an address but no screens paired yet could never appear on
 * the map at all. They are OPTIONAL in the type on purpose — a cached payload
 * minted before that API change still parses, and every consumer treats an
 * absent coordinate as "not locatable yet", never as 0,0.
 */
export interface FleetLocation {
  id: string;
  name: string;
  slug: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  vertical?: string | null;
  /**
   * THIS location's own branding logo — what its Network Atlas pin wears.
   * Null when the location has no branding of its own; the org logo is the
   * fallback (operator, 2026-08-31: "every school has its own icon but your
   * using the district icon for everything").
   */
  logoUrl?: string | null;
}
export interface FleetResponse {
  root: { id: string; name: string; slug: string; vertical?: string | null } | null;
  locations: FleetLocation[];
  stats: { total: number; online: number; offline: number; locationCount: number };
  screens: FleetScreen[];
}
export function useFleet(opts?: { enabled?: boolean }) {
  return useQuery<FleetResponse>({
    queryKey: ['screens', 'fleet'],
    queryFn: () => apiFetch('/screens/fleet'),
    enabled: opts?.enabled ?? true,
    // Near-real-time, same cadence as the per-tenant screen list.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ─── District command center (2026-08-24) ──────────────────────────────
// Two bounded, READ-ONLY reads that turn the district admin's dashboard from
// "the same page one school sees" into "which of my schools needs me today".
// Both are batched server-side (fixed query count regardless of school
// count) and both are DISTRICT_ADMIN / SUPER_ADMIN only, so gate `enabled`
// the same way useFleet does or every poll 403s.
//
// NEITHER POLLS. Emergency wiring and review queues change on human
// timescales, and the mobile-perf standard is explicit that a phone the
// operator isn't looking at must not run timers. Freshness comes from the
// mount/remount refetch that `staleTime` governs; the live fleet signal
// (screens up/down/painting) already rides useFleet's existing 30s interval,
// so this adds no new cadence to the page.

/** One school's emergency readiness as the district rollup reports it. */
export interface DistrictSchoolReadiness {
  tenantId: string;
  name: string;
  slug: string;
  isSelf: boolean;
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED';
  contentWired: number;
  contentTotal: number;
  lockdownWired: boolean;
  missingTypes: string[];
  screensTotal: number;
  screensOnline: number;
}
export interface DistrictReadinessResponse {
  /** Platform-global delivery chain — computed once for the whole district. */
  delivery: { key: string; status: 'ok' | 'warn' | 'missing'; label: string; detail: string; fixHint: string };
  schools: DistrictSchoolReadiness[];
  notReadyCount: number;
  computedAt: string;
}
export function useDistrictReadiness(opts?: { enabled?: boolean }) {
  return useQuery<DistrictReadinessResponse>({
    queryKey: ['emergency-readiness', 'district'],
    queryFn: () => apiFetch('/emergency/readiness/district'),
    enabled: opts?.enabled ?? true,
    staleTime: 60_000,
  });
}

/** Submissions waiting on a reviewer, per school across the district. */
export interface DistrictPendingApprovals {
  total: number;
  byTenant: Array<{ tenantId: string; pending: number }>;
}
export function useDistrictPendingApprovals(opts?: { enabled?: boolean }) {
  return useQuery<DistrictPendingApprovals>({
    queryKey: ['submissions', 'pending-counts'],
    queryFn: () => apiFetch('/submissions/pending-counts'),
    enabled: opts?.enabled ?? true,
    staleTime: 60_000,
  });
}

// ─── Deployment record + per-screen history (Fleet Command Phase 2) ────
// A "deployment" is one operator "Push update" action; the server computes
// its convergence live against the screens it targeted. Same role gate as
// the district reads above (SUPER / DISTRICT / SCHOOL admin), so `enabled`
// must be gated or the query 403s.
//
// NEITHER POLLS — same reasoning as the district block above. The deployment
// list rides mount + the page's existing 30s fleet cadence (invalidate the
// ['screens','deployments'] key after a push to force a re-read); the
// per-screen history only loads when an operator expands that screen.

/** One "Push update" action and how far it has got. */
export interface DeploymentRow {
  id: string;
  /**
   * The location this push was fired into. A push is always scoped to exactly
   * one tenant server-side, so this is what lets the fleet table say "last
   * push" PER LOCATION rather than one org-wide timestamp.
   */
  tenantId: string;
  /** Operator-facing name of what was pushed. */
  label: string;
  createdAt: string;
  /** The refresh value screens echo back to acknowledge (VALUE identity). */
  valueMs: number;
  targetCount: number;
  convergence: { converged: number; painting: number; done: boolean };
}
export interface DeploymentsResponse {
  deployments: DeploymentRow[];
}
export function useDeployments(opts?: { enabled?: boolean }) {
  return useQuery<DeploymentsResponse>({
    queryKey: ['screens', 'deployments'],
    queryFn: () => apiFetch('/screens/deployments?limit=10'),
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
  });
}

// ─── Fleet pulse history (design-mock parity, 2026-08-31) ──────────────
// The recorded online/degraded/offline series behind the dashboard's 24h
// chart and the per-location sparklines. Written every 15 min by the API's
// sampler cron, so there is nothing to poll for: a new sample lands four
// times an hour and this surface is not a live monitor. Same admin role gate
// as the district reads above — gate `enabled` or it 403s.
//
// DOES NOT POLL, by design. The mobile standard is explicit that a phone the
// operator isn't looking at must not run timers, and a 15-minute cadence read
// on a 30-second interval would be 29 wasted requests out of 30.

/** One sampler tick, summed across the fleet. */
export interface FleetPulsePoint {
  /** Epoch ms, bucketed to the minute of the tick. */
  ts: number;
  online: number;
  offline: number;
  /** Online but with no confirmed picture — "Degraded" in the chart legend. */
  notPainting: number;
  total: number;
}
export interface FleetPulseResponse {
  fleet: FleetPulsePoint[];
  /** Per-location series, keyed by tenant id — the table's sparklines. */
  locations: Record<string, Array<{ ts: number; online: number; total: number }>>;
}
export function useFleetPulse(opts?: { enabled?: boolean }) {
  return useQuery<FleetPulseResponse>({
    queryKey: ['screens', 'fleet-pulse'],
    queryFn: () => apiFetch('/screens/fleet-pulse?hours=24'),
    enabled: opts?.enabled ?? true,
    staleTime: 60_000,
  });
}

/** What happened to one screen's content delivery, newest first. */
export type ScreenEventKind =
  | 'refresh-requested'
  | 'auto-refresh-requested'
  | 'refresh-acked'
  | 'repair-required'
  | 'credential-restored';
export interface ScreenEvent {
  id: string;
  kind: ScreenEventKind;
  detail: any;
  createdAt: string;
}
export interface ScreenEventsResponse {
  events: ScreenEvent[];
}
/** Pass null to keep the query dormant (the collapsed-row case). */
export function useScreenEvents(screenId: string | null) {
  return useQuery<ScreenEventsResponse>({
    queryKey: ['screens', 'events', screenId],
    queryFn: () => apiFetch(`/screens/${screenId}/events?limit=20`),
    enabled: !!screenId,
    staleTime: 15_000,
  });
}

// ─── Phase 2c — publish a playlist to screens across child locations ───
// POST /playlists/:id/publish-to-fleet — copies the playlist (+ assets) down
// into each target child and schedules it live there. Parent/corporate only.
export interface PublishToFleetResult {
  sourcePlaylistId: string;
  totalScreens: number;
  totalLocations: number;
  perLocation: Array<{ tenantId: string; tenantName: string; playlistId: string; screensScheduled: number; isParent: boolean }>;
}
export function usePublishToFleet() {
  return useMutation<PublishToFleetResult, Error, { playlistId: string; screenIds: string[] }>({
    // PublishToLocationsModal renders the failure inline at full size, and it
    // runs inside a z-[10000] modal the toast layer sits under anyway.
    meta: { suppressGlobalError: true },
    mutationFn: ({ playlistId, screenIds }) =>
      apiFetch(`/playlists/${playlistId}/publish-to-fleet`, {
        method: 'POST',
        body: JSON.stringify({ screenIds }),
      }),
  });
}

// ─── Notifications ────────────────────────────────────────────
export function useNotifications() {
  return useQuery<{ items: Array<any>; unreadCount: number }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/notifications?limit=20'),
    // 30s poll keeps the bell/badge fresh while visible. 2026-06-16 mobile-
    // perf: dropped refetchOnWindowFocus — this hook mounts in the global
    // MobileTabBar, so a focus-burst on every app-switch re-rendered the whole
    // bottom nav right as the operator was tapping it. The 30s interval is
    // enough; the bell isn't time-critical.
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    // Fires as a SIDE EFFECT of clicking a notification (which also
    // navigates away) — not an operator intent of its own. A failed
    // mark-as-read costs the operator nothing, so don't toast about it.
    // "Mark all read" below IS an explicit click and keeps the toast.
    meta: { suppressGlobalError: true },
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
export function useAuditLog(params: {
  from?: string; to?: string; actorId?: string; action?: string; limit?: number; offset?: number;
  /**
   * The route is @RequireRoles(...ADMIN_ROLES). Callers that can be mounted by
   * a CONTRIBUTOR / RESTRICTED_VIEWER must gate on the role rather than fire a
   * request that can only 403 — and present the refusal as "not available to
   * your role", never as an empty history. Defaults true, so every existing
   * call site is unchanged.
   */
  enabled?: boolean;
}) {
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
    enabled: params.enabled ?? true,
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
    // Its only caller (screens/page.tsx handlePushApkUpdate) already renders
    // "Push failed: …" in its own toast lane — opt out so the global
    // mutation-error toast doesn't report the same failure twice.
    meta: { suppressGlobalError: true },
    mutationFn: async (args: { screenId?: string | null } = {}) => {
      const path = args.screenId
        ? `/screens/${args.screenId}/force-update`
        : `/screens/force-update`;
      return apiFetch(path, { method: 'POST' });
    },
  });
}

// ─── Refresh kiosk web bundle (Sprint 11 Phase B) ───
// Pushes a signed REFRESH_WEB message that the web player's WS handler
// turns into EduCmsNative.reload() (Android) or window.location.reload()
// (browser). Lets admins push a Vercel-deployed JS fix to running
// kiosks without sideload, power-cycle, or kiosk-side button presses.
//
// Per-screen reload is snappy (no jitter). Tenant-wide reload jitters
// over an 8-second window server-side so a fleet refresh doesn't
// stampede the API or Vercel CDN.
export function useRefreshWeb() {
  const qc = useQueryClient();
  return useMutation({
    // Same as useForceApkUpdate: handleRefreshWeb shows "Refresh failed: …"
    // in the shared toast lane, so skip the global one.
    meta: { suppressGlobalError: true },
    mutationFn: async (args: { screenId?: string | null } = {}) => {
      const path = args.screenId
        ? `/screens/${args.screenId}/refresh-web`
        : `/screens/refresh-web`;
      return apiFetch(path, { method: 'POST' });
    },
    // A push mints a Deployment row server-side (Fleet Command Phase 2) —
    // re-read the record so the convergence card shows the new push without
    // waiting for a remount. This is the manual invalidation the
    // no-polling rule trades on.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['screens', 'deployments'] });
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
  // Phase B closeout — cross-tenant fleet health rollups, populated
  // server-side by /super/tenants. Older API versions may omit them;
  // UI treats missing as 0 / 100% / false.
  screensOnline?: number;
  emergencyActive?: boolean;
  canaryPercent?: number;
  openIncidents24h?: number;
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

// ─── Org-wide "Require approval before content goes live" gate ──────
// (Appspace-parity enterprise control, 2026-06-26). OFF by default. When
// ON, a CONTRIBUTOR's publish is routed through the submit-for-review
// queue instead of going live directly. Read by any admin; flipped only
// by DISTRICT_ADMIN / SUPER_ADMIN (server-enforced).
export function useContentApprovalConfig() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ['content-approval-config'],
    queryFn: () => apiFetch('/tenants/me/content-approval'),
  });
}
export function useToggleContentApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/content-approval', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: ['content-approval-config'] });
      const prev = qc.getQueryData<any>(['content-approval-config']);
      qc.setQueryData(['content-approval-config'], { enabled });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['content-approval-config'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['content-approval-config'] }),
  });
}

// Sprint 11 Phase A — OTA maintenance window.
// Operator: "we cant have screens flashing all the time".
// Tenant configures the daily window when APK installs are allowed
// to APPLY (downloads happen anytime — no disruption). Per-push
// override checkbox bypasses the window for emergency hotfixes.
export type OtaWindowConfig = {
  start: string | null;   // "HH:MM" 24-hour, or null = unconfigured
  end: string | null;     // "HH:MM" 24-hour, or null = unconfigured
  timezone: string | null; // IANA tz name, or null = unconfigured
};
export function useOtaWindowConfig() {
  return useQuery<OtaWindowConfig>({
    queryKey: ['ota-window-config'],
    queryFn: () => apiFetch('/tenants/me/ota-window'),
  });
}
export function useUpdateOtaWindow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: OtaWindowConfig) =>
      apiFetch('/tenants/me/ota-window', { method: 'PUT', body: JSON.stringify(cfg) }),
    onMutate: async (cfg) => {
      await qc.cancelQueries({ queryKey: ['ota-window-config'] });
      const prev = qc.getQueryData<any>(['ota-window-config']);
      qc.setQueryData(['ota-window-config'], cfg);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['ota-window-config'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['ota-window-config'] }),
  });
}

// Sprint 11 Phase B — canary rollout config + mutation.
// percent < 100 means only the hash-deterministic cohort of screens
// receives the latest APK; everyone else gets uptoDate. Combined
// with the soak timer + auto-promote flag, a bad release is bounded
// to at most `percent`% of the fleet during the soak window.
export type CanaryRolloutConfig = {
  percent: number;        // 0..100, default 100 = full rollout
  setAt: string | null;   // ISO datetime when percent last lowered
  autoPromote: boolean;   // auto-bump to 100 after soak elapsed
  soakHours: number;      // 1..720
};
export function useCanaryRollout() {
  return useQuery<CanaryRolloutConfig>({
    queryKey: ['canary-rollout'],
    queryFn: () => apiFetch('/tenants/me/canary-rollout'),
  });
}
export function useUpdateCanaryRollout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: Partial<Omit<CanaryRolloutConfig, 'setAt'>>) =>
      apiFetch('/tenants/me/canary-rollout', { method: 'PUT', body: JSON.stringify(cfg) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['canary-rollout'] }),
  });
}

// Latest published player APK version. Powers the dashboard's
// "Current vX · Latest vY" comparison on each screen card. Cached
// for 10 min — release tags don't move that fast.
export function useLatestPlayerVersion() {
  return useQuery<{
    versionName: string | null;
    versionCode: number | null;
    source: string;
    /**
     * Latest published **Manager** APK version, when the API advertises one
     * (2026-09-01 — operator: "if the player is on the latest version but the
     * manager is not, there is no way to push the updated manager").
     *
     * OPTIONAL on purpose: a deploy whose API predates the field must read as
     * "unknown", never as "up to date" and never as "stale". `undefined` is the
     * only honest answer there, and every consumer treats it as such.
     */
    managerVersionName?: string | null;
  }>({
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

// ─── Emergency capability enablement (2026-09-02) ─────────────────
//
// "Is the emergency capability ON for this organization at all?" USED to
// live in browser localStorage under `emergencyEnabled:${tenantId}` — a
// per-device, per-profile answer to a life-safety question that the server
// never saw. It is now `Tenant.emergencyEnabled`, a NULLABLE column read off
// the tenant payload the dashboard already loads (no second endpoint, no
// second poll), resolved through the shared pure resolver so the API and the
// dashboard can never disagree.
//
// SCOPE: configuration only. This flag does not gate the trigger/all-clear
// path and is not in the screen manifest.
export interface EmergencyEnablement {
  /** The answer to render: the stored value, or this vertical's default. */
  enabled: boolean;
  /** What is actually persisted. null = never stated (riding the default). */
  stored: boolean | null;
  /** True when this vertical may never turn the capability off (K-12). */
  locked: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function useEmergencyEnablement(): EmergencyEnablement {
  const { data, isLoading, isError } = useTenant();
  const t = data as any;
  const stored = typeof t?.emergencyEnabled === 'boolean' ? (t.emergencyEnabled as boolean) : null;
  // The API ships the resolved answer, but resolve locally too: an older API
  // build (or a cached payload) that omits the derived fields must still get
  // the same answer rather than silently reading as "off".
  const locked =
    typeof t?.emergencyEnabledLocked === 'boolean'
      ? (t.emergencyEnabledLocked as boolean)
      : emergencyEnablementLocked(t?.vertical);
  const enabled =
    typeof t?.emergencyEnabledEffective === 'boolean'
      ? (t.emergencyEnabledEffective as boolean)
      : effectiveEmergencyEnabled(t?.vertical, stored);
  return { enabled, stored, locked, isLoading, isError };
}

/**
 * Write the flag. No optimistic success (§13.2): the mutation resolves only
 * after the tenant query has been re-read from the server, so an awaited
 * `mutateAsync()` completing genuinely means "the server confirmed this, and
 * the UI is now showing the server's own answer".
 */
export function useSetEmergencyEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/emergency-enabled', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tenant'] });
      // Turning the capability on/off changes what the readiness report is
      // grading, so re-ask rather than leaving a stale verdict on screen.
      qc.invalidateQueries({ queryKey: ['emergency-readiness'] });
    },
  });
}

// ─── Per-tenant MFA enforcement (2026-09-11) ──────────────────────────
// Greg: "i want people to have the options but for my riot accounts, leave
// it turned on, we will keep that security so just new customers."
//
// Read shape mirrors useEmergencyEnablement exactly, for the same reason:
// the editor has to tell "explicitly optional" from "never stated", and the
// resolver is SHARED with the API so the two can never disagree about
// whether an organization enforces two-factor.
export interface MfaEnforcement {
  /** The answer to render: the stored value, or the platform default. */
  enforced: boolean;
  /** What is actually persisted. null = never stated (riding the default). */
  stored: boolean | null;
  isLoading: boolean;
  isError: boolean;
}

export function useMfaEnforcement(): MfaEnforcement {
  const { data, isLoading, isError } = useTenant();
  const t = data as any;
  const stored = typeof t?.mfaEnforced === 'boolean' ? (t.mfaEnforced as boolean) : null;
  // The API ships the resolved answer, but resolve LOCALLY too, through the
  // same shared function: an older API build (or a cached payload) that omits
  // the derived field must not read as a different posture than the server's.
  const enforced =
    typeof t?.mfaEnforcedEffective === 'boolean'
      ? (t.mfaEnforcedEffective as boolean)
      : effectiveMfaEnforced(stored);
  return { enforced, stored, isLoading, isError };
}

/**
 * Write the flag. NO OPTIMISTIC SUCCESS (§13.2) — this is a security policy,
 * so the toggle must not show "on" until the server says it is on. The write
 * is SUPER_ADMIN / DISTRICT_ADMIN only, server-enforced.
 */
export function useSetMfaEnforced() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/mfa-enforced', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tenant'] });
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
//
// Canonical fetcher for the current tenant's branding row.
//
// Performance note (2026-05-26): the same route used to ping
// `/branding/me` ~8 times per navigation because every component that
// needed branding (Sidebar self-heal, BrandStyleInjector mount,
// BrandingSettingsCard, BrandingProvider, dashboard / templates pages,
// settings/branding page) ran its own raw `apiFetch`. None of them
// shared a cache. Consolidating all those reads through this hook with
// a 60s staleTime collapses the burst to a SINGLE network call per
// minute per tab.
//
// Branding changes rarely. The Adopt / Reset / Revert paths invalidate
// the key explicitly via `useInvalidateTenantBranding()` below, so
// updates surface instantly without the cache holding stale state.
//
// 2026-05-04 — endpoint was wrong (`/tenants/me/branding`); fixed to
// `/branding/me` to match Sidebar / BrandStyleInjector.
import type { TenantBranding } from '@/lib/branding';
const TENANT_BRANDING_QUERY_KEY = ['branding', 'me'] as const;

export function useTenantBranding() {
  return useQuery<TenantBranding | null>({
    queryKey: TENANT_BRANDING_QUERY_KEY,
    queryFn: () => apiFetch<TenantBranding | null>('/branding/me'),
    // 60s — branding is operator-changed via Adopt/Reset, not background
    // process; the explicit invalidator below covers writes.
    staleTime: 60_000,
    // Hold in cache for 5 minutes after the last subscriber unmounts so
    // route changes that re-mount a consumer hit the cache.
    gcTime: 5 * 60_000,
    // Self-heal: 3 attempts with backoff so a transient Supabase /
    // Redis blip doesn't strand the Sidebar / BrandStyleInjector on
    // default chrome. Mirrors the old Sidebar inline retry (600 →
    // 1500 → 4000 ms) that this hook subsumes.
    retry: 3,
    retryDelay: (attempt) => [600, 1500, 4000][attempt] ?? 4000,
  });
}

/**
 * Invalidate the shared `/branding/me` cache so every subscriber
 * (sidebar header, dashboard hero, brand-style injector, branding
 * settings card, Apply-to-templates button) refetches in unison.
 *
 * Call from any Adopt / Reset / Revert mutation. Pairs with the
 * `branding:update` window event that BrandStyleInjector still listens
 * to for live-preview repaint — the event is for sub-second visual
 * feedback; this invalidation is the authoritative refetch.
 */
export function useInvalidateTenantBranding() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: TENANT_BRANDING_QUERY_KEY });
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

export function useSubmissions(opts?: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; mine?: boolean; enabled?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.mine)   params.set('mine', '1');
  const qs = params.toString();
  return useQuery<SubmissionRow[]>({
    queryKey: ['submissions', opts?.status || null, !!opts?.mine],
    queryFn: () => apiFetch(`/submissions${qs ? `?${qs}` : ''}`),
    // Gate non-admin / pre-mount calls so the sidebar badge can fire
    // this query only when the user is actually a reviewer (CONTRIBUTOR
    // / RESTRICTED_VIEWER would otherwise 403 every refresh). Defaults
    // to enabled=true so every other callsite still works unchanged.
    enabled: opts?.enabled !== false,
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

/** Summary of an image swap — what the server did to the pins. */
export interface FloorPlanImageReplaceSummary {
  /** Placements carried across the swap. A replace never discards pins. */
  placementsKept: number;
  /** True when the new image is a different SHAPE — pins may need a nudge. */
  aspectRatioChanged: boolean;
  previousWidthPx: number;
  previousHeightPx: number;
  widthPx: number;
  heightPx: number;
}

/**
 * Read an image file's natural dimensions in the browser. Shared by the
 * upload and the replace paths so both send the server the same thing —
 * the server re-probes the header bytes anyway and overrides a wrong
 * answer, because the pin math is only as honest as these two numbers.
 */
export async function readImageDimensions(file: File): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise<{ widthPx: number; heightPx: number }>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
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
      const dims = await readImageDimensions(input.file);
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

/**
 * Swap the image on an EXISTING plan, keeping its screen pins.
 *
 * Operator: "add change so i can swap images and not just delete and
 * add" — delete-then-add detaches every pin, so re-uploading a corrected
 * drawing used to cost the operator all of their placement work. Same
 * `PUT /floor-plans/:id` the rename uses, just carrying a file: the
 * server rescales every placement into the new image's coordinate space
 * and reports back how many it kept and whether the shape changed.
 */
export function useReplaceFloorPlanImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: string; file: File }) => {
      const dims = await readImageDimensions(input.file);
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('widthPx', String(dims.widthPx));
      fd.append('heightPx', String(dims.heightPx));
      // Tells the server "this request is a swap" so a file the MIME
      // filter or the size cap dropped surfaces as an error instead of a
      // silent no-op that leaves the old drawing in place.
      fd.append('replaceImage', '1');
      // Bypass apiFetch for multipart — its default Content-Type:
      // application/json header would mangle the multipart boundary.
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/floor-plans/${input.planId}`, {
        method: 'PUT',
        body: fd,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Replace failed (${res.status}): ${txt || res.statusText}`);
      }
      return (await res.json()) as FloorPlan & { imageReplace?: FloorPlanImageReplaceSummary };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['floor-plan', vars.planId] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
      // Pin coordinates moved with the image — the screens list carries
      // floorX/floorY too.
      qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });
}

/**
 * Rename a floor plan (2026-09-14, Greg: "where do I change the name of the
 * floor plan?" — an uploaded file's name was the only name it ever had).
 * Same `PUT /floor-plans/:id` the image swap uses; sent as form fields so the
 * multipart interceptor on that route parses it the same way.
 */
export function useRenameFloorPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: string; name: string }) => {
      const fd = new FormData();
      fd.append('name', input.name);
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/floor-plans/${input.planId}`, {
        method: 'PUT',
        body: fd,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Rename failed (${res.status}): ${txt || res.statusText}`);
      }
      return (await res.json()) as FloorPlan;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['floor-plan', vars.planId] });
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
      // Deleting a plan detaches every screen placed on it.
      qc.invalidateQueries({ queryKey: ['screens'] });
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
// (2026-08-05 waste sweep: the read/trigger/clear/bulk-trigger hooks that
// lived here had ZERO call sites — the floor-plan UI drives the per-screen
// emergency endpoints through its own fetch layer. Unused mutation hooks
// against life-safety endpoints are exactly the kind of thing that must
// not lie around looking live. The API endpoints themselves are unchanged.)

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
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['floor-plans'] });
      qc.invalidateQueries({ queryKey: ['floor-plan'] });
    },
  });
}

// ─── VenueOS Sports — Sprint 13 ─────────────────────────────────
// The Sport Engine's React Query layer. Game-list + create/delete +
// the live-control mutations (score / clock / segment / status /
// stats / celebration cue). The PUBLIC board page does NOT use these
// hooks — it polls the un-authed /sports/board/:id endpoint directly.

export function useGames() {
  return useQuery({
    queryKey: ['sports-games'],
    queryFn: () => apiFetch('/sports/games'),
    refetchInterval: 15_000,
  });
}

// ─── CTS console simulator (2026-05-28) ──────────────────────────
// Pushes synthetic CTS snapshots to /sports/games/:id/cts-snapshot.
// Used by /super/cts-simulator to drive a live game end-to-end as if a
// physical Colorado Timing System Gen 6 console were on the wire. The
// authed operator path (req.user.tenantId) — guards by RBAC, hits the
// SAME ingest service the real bridge uses, so the demo exercises
// every downstream path: cleanCtsSnapshot, syncShotClockToGameClock,
// syncPenaltiesToClock, maybeAutoCelebrate, GameEvent + AuditLog
// writes, board cache invalidation, and the public /board polling
// surfaces. (Greg's "same rules apply" rule covered by T1-1.)

export type CtsSimSnapshot = {
  clockMs?: number;
  clockRunning?: boolean;
  segment?: number;
  homeScore?: number;
  awayScore?: number;
  shotClock?: { ms: number; running: boolean; len?: number; at?: string };
  homeShotClock?: { raw?: string; ms?: number; running?: boolean };
  awayShotClock?: { raw?: string; ms?: number; running?: boolean };
  homeExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
  awayExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
  homeTimeoutsRemaining?: number;
  awayTimeoutsRemaining?: number;
  horn?: boolean;
};

export function useCtsSimulator(gameId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snap: CtsSimSnapshot) =>
      apiFetch(`/sports/games/${gameId}/cts-snapshot`, {
        method: 'POST',
        body: JSON.stringify(snap),
      }),
    onSuccess: () => {
      if (gameId) qc.invalidateQueries({ queryKey: ['sports-game', gameId] });
    },
  });
}

export function useGame(id: string | undefined) {
  // ── Refuter fix C4 (2026-08-09) — queued-delta display overlay ─────
  // While score DELTAS sit in the offline op queue, the 4s background
  // refetch below overwrites the cache with server truth that EXCLUDES
  // those queued taps — without this overlay the operator's displayed
  // score visibly DROPPED below what they entered, inviting a double-tap.
  // Fix: subscribers see server data with the pending queued score deltas
  // applied on top via `select`; the CACHE itself stays pure server truth.
  // The version counter re-arms `select` (React Query re-runs it when the
  // function identity changes) whenever the queue changes; after replay
  // drains + invalidates, the deltas are zero and display converges to
  // server truth.
  const [opsVersion, setOpsVersion] = useState(0);
  useEffect(() => {
    if (!id) return;
    return getGameOpQueue(id).subscribe(() => setOpsVersion((v) => v + 1));
  }, [id]);
  const select = useCallback(
    (data: any) => {
      if (!data || !id) return data;
      const pending = getGameOpQueue(id).pendingScoreDeltas();
      if (pending.home === 0 && pending.away === 0) return data;
      return {
        ...data,
        // Same ≥0 clamp as the optimistic path + the server's increment.
        homeScore: Math.max(0, (Number(data.homeScore) || 0) + pending.home),
        awayScore: Math.max(0, (Number(data.awayScore) || 0) + pending.away),
      };
    },
    // opsVersion is the re-evaluation trigger, not a value read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, opsVersion],
  );
  return useQuery({
    queryKey: ['sports-game', id],
    queryFn: () => apiFetch(`/sports/games/${id}`),
    enabled: !!id,
    // The operator control surface mirrors live state — poll briskly
    // so a co-operator's edit shows up, but optimistic mutation
    // results below keep the local console instant.
    refetchInterval: 4_000,
    staleTime: 0,
    select,
  });
}

export function useCreateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      sport: string;
      homeTeam: string;
      awayTeam: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string;
      awayLogoUrl?: string;
      screenGroupId?: string;
      // Sprint 13 — operator-picked custom layouts per surface.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
      // Sports Wave S4-1 (P1-8) — optional kickoff date/time from the New
      // Game modal's "When is it?" field. ISO string; omitted/blank means
      // no date set (fully legal — every existing game has none).
      scheduledAt?: string | null;
      // Per-game regulation period length (water polo 7:00 HS vs 8:00
      // NCAA) — only offered when the sport publishes segmentMsOptions.
      clockSegmentMs?: number;
    }) => apiFetch('/sports/games', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-games'] }),
  });
}

export function useDeleteGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/sports/games/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-games'] }),
  });
}

/**
 * Edit a game's identity fields any time after creation — team names,
 * colors, logos, template reassignment, and (Sports Wave S4-1, P1-8) the
 * scheduled kickoff date/time. PATCHes `/sports/games/:id` (the
 * `updateGameDetails` endpoint, previously wired only server-side — the
 * New Game modal set these at create time but nothing let an operator
 * revisit them from the Setup screen). Writes the response straight into
 * both caches so the console and the game list both reflect the edit
 * immediately.
 */
export function useUpdateGameDetails(gameId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string | null;
      awayLogoUrl?: string | null;
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
      scheduledAt?: string | null;
    }) => apiFetch(`/sports/games/${gameId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: (game: any) => {
      if (game?.id) qc.setQueryData(['sports-game', game.id], game);
      qc.invalidateQueries({ queryKey: ['sports-games'] });
    },
  });
}

/**
 * Clone a game's full presentation setup (teams, colors, logos, the
 * three surface templates, the ribbon config, and the roster) into a
 * fresh SCHEDULED game. Lets an operator build one game's content and
 * run a whole week of games off it. Returns the new game so the caller
 * can jump straight into its console.
 */
export function useDuplicateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/sports/games/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-games'] }),
  });
}

// ── Trust wave Domain C (2026-08-06) — offline op replay wiring ─────
// Network-failed score/clock/segment/stats writes land in the per-game
// GameOpQueue (lib/game-op-queue.ts); this block replays them. ONE
// controller per game no matter how many components mount useGameControl
// (page.tsx ×3 + CueLaunchpad + Leaders/Ribbon panels all do): the first
// mount attaches the listeners + queue subscription, the last unmount
// tears them down. Mobile perf standard: the 5s retry timer exists ONLY
// while (queue non-empty AND document visible) — zero timers when the
// queue is empty or the tab is hidden.

type GameOpReplayController = {
  refs: number;
  onDrained: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  teardown: () => void;
};
const gameOpReplayControllers = new Map<string, GameOpReplayController>();

function makeGameOpSender(gameId: string) {
  return (op: GameOp): Promise<unknown> => {
    const path =
      op.kind === 'score'
        ? `/sports/games/${gameId}/score`
        : op.kind === 'clock'
          ? `/sports/games/${gameId}/clock`
          : op.kind === 'segment'
            ? `/sports/games/${gameId}/segment`
            : `/sports/games/${gameId}/stats`;
    return apiFetch(path, { method: 'PATCH', body: JSON.stringify(op.payload) }).catch(
      (err: unknown) => {
        // A queued op the server DEFINITIVELY rejected (4xx) can never
        // succeed on retry — resolve so replay() drops it instead of
        // wedging every op behind a poison entry forever. The REJECTED
        // banner tells the operator the board may not match.
        const status = (err as { status?: unknown } | null)?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          getGameOpQueue(gameId).noteRejection();
          return null;
        }
        throw err;
      },
    );
  };
}

function attachGameOpReplay(gameId: string, qc: QueryClient): () => void {
  if (typeof window === 'undefined') return () => {};
  let ctl = gameOpReplayControllers.get(gameId);
  if (!ctl) {
    const q = getGameOpQueue(gameId);
    const sender = makeGameOpSender(gameId);
    const clearTimer = () => {
      const c = gameOpReplayControllers.get(gameId);
      if (c && c.timer !== null) {
        clearTimeout(c.timer);
        c.timer = null;
      }
    };
    const schedule = () => {
      const c = gameOpReplayControllers.get(gameId);
      if (!c || c.timer !== null) return;
      if (q.size() === 0 || document.visibilityState !== 'visible') return;
      c.timer = setTimeout(() => {
        const cc = gameOpReplayControllers.get(gameId);
        if (cc) cc.timer = null;
        void attempt();
      }, 5_000);
    };
    const attempt = async () => {
      clearTimer();
      const c = gameOpReplayControllers.get(gameId);
      if (!c || q.size() === 0) return;
      const { sent, remaining } = await q.replay(sender);
      const after = gameOpReplayControllers.get(gameId);
      if (!after) return;
      if (remaining > 0) {
        schedule(); // partial / still failing — self-chained 5s retry
        return;
      }
      // Drained — reconcile the console to server truth (the replayed
      // deltas + anything a co-operator did while this tablet was out).
      if (sent > 0) after.onDrained();
    };
    const onOnline = () => {
      void attempt();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void attempt();
      else clearTimer(); // no timers in a hidden tab
    };
    const unsubscribe = q.subscribe(() => {
      if (q.size() === 0) clearTimer();
      else if (!q.getSnapshot().replaying) schedule();
    });
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    ctl = {
      refs: 0,
      onDrained: () => {},
      timer: null,
      teardown: () => {
        clearTimer();
        unsubscribe();
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
    gameOpReplayControllers.set(gameId, ctl);
    // Ops persisted across a mid-game console-tab reload replay right away.
    if (q.size() > 0) void attempt();
  }
  ctl.refs += 1;
  ctl.onDrained = () => {
    qc.invalidateQueries({ queryKey: ['sports-game', gameId] });
  };
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const c = gameOpReplayControllers.get(gameId);
    if (!c) return;
    c.refs -= 1;
    if (c.refs <= 0) {
      c.teardown();
      gameOpReplayControllers.delete(gameId);
    }
  };
}

/**
 * One hook for every live-control action on a game. Each call PATCHes
 * (or POSTs, for a cue) the matching endpoint and writes the updated
 * game straight into the React Query cache so the operator console
 * reacts with zero latency — the 4s poll in useGame() is just a
 * reconcile safety net behind it.
 */
export function useGameControl(gameId: string) {
  const qc = useQueryClient();
  const gameKey = ['sports-game', gameId];
  const writeBack = (game: any) => {
    if (game && game.id) qc.setQueryData(gameKey, game);
  };

  // ── P0-1 (2026-07-02 sports deep-pass audit) ──────────────────────
  // score/clock/segment/stats had NO onMutate while ~20 screens-hooks in
  // this same file do (see useDeleteScreenGroup/useUpdateScreenGroup above
  // for the canonical cancelQueries→snapshot→optimistic-write→rollback-on-
  // error shape this mirrors). Every +1 tap waited a full RTT (300-900ms on
  // venue Wi-Fi) before the scoreboard moved — "feels like the button did
  // nothing," per the shotClock mutation's own comment below (:3263-3268 in
  // the pre-audit file). Fix: apply the predictable, common-case delta to
  // the cached game the instant the operator taps; writeBack on success
  // stays authoritative and overwrites this local guess with the server's
  // real (fully rule-aware) result — auto-celebrate, set/game credit, shot-
  // clock slaving, line-score snapshots etc. all still resolve server-side
  // exactly as before. onError rolls back to the pre-tap snapshot so a
  // failed PATCH never leaves a phantom optimistic score/clock on screen.
  const snapshotGame = () => qc.getQueryData<any>(gameKey);
  // 2026-07-03 overnight-review P0 fix. onError must NOT restore ctx.prev —
  // that snapshot was captured in THIS mutation's onMutate, BEFORE any other
  // mutation ran. With no per-game serialization, two rapid taps (or two
  // operators) can be in flight at once; if the FIRST-issued one fails after
  // the SECOND already succeeded (writeBack wrote the server-confirmed score),
  // restoring the first's ctx.prev clobbers the cache back to a value that
  // predates the second — a LIVE score that visibly DECREASES after a good
  // tap. Instead, drop the failed optimistic guess by refetching server truth;
  // the 4s useGame() poll is the ultimate reconcile if the refetch itself
  // fails (offline). ctx retained in the signature for call-site stability.
  const rollback = (_ctx: { prev?: any } | undefined) => {
    void _ctx;
    qc.invalidateQueries({ queryKey: gameKey });
  };

  // ── Trust wave Domain C (2026-08-06) — failed writes must not lie ──
  // REPLAY-SAFETY TRADEOFF (decided): we only enqueue ops whose request
  // FAILED to get any response (offline / fetch TypeError / apiFetch's
  // exhausted-network-retries wrapper — see isNetworkFailure). If the
  // server responded at all (4xx/5xx) we refetch truth instead of
  // queueing: a 5xx MAY have been processed before erroring, and
  // re-sending it would double-count. The rare inverse — "server
  // processed it but the response was lost in transit" — is accepted and
  // mitigated by the SYNCED banner telling the operator to verify the
  // score against the board after a sync. Server-side dedup is
  // deliberately NOT invented here (the API belongs to another domain).
  const opQueue = getGameOpQueue(gameId);
  const settleFailure = (
    kind: GameOpKind,
    err: unknown,
    payload: Record<string, unknown>,
    ctx: { prev?: any } | undefined,
  ) => {
    if (isNetworkFailure(err)) {
      // The queue WILL apply this op on reconnect, and the
      // ConnectionBanner shows it as queued, so the console reading
      // stays honest instead of silently phantom.
      opQueue.enqueue(kind, payload);
      // Refuter fix C4 (2026-08-09): once a SCORE DELTA is queued, the
      // useGame display overlay (server truth + pending queued deltas)
      // owns showing it — so REVERSE this tap's optimistic cache
      // application, or the overlay would double-count it (cache already
      // +1, overlay +1 again → displayed score jumps ABOVE what the
      // operator entered until the next successful refetch). Subtracting
      // the delta (not restoring a snapshot) composes correctly with
      // other in-flight optimistic taps — same reasoning as rollback()'s
      // no-snapshot-restore rule. The DISPLAYED value is unchanged by
      // this handoff: cache −delta, overlay +delta. Clock/segment/stats
      // (and absolute score sets) have no overlay, so their optimistic
      // cache value remains the honest display until replay.
      if (kind === 'score' && typeof payload.delta === 'number') {
        const delta = payload.delta;
        const key = payload.team === 'away' ? 'awayScore' : 'homeScore';
        qc.setQueryData(gameKey, (old: any) => {
          if (!old) return old;
          return { ...old, [key]: Math.max(0, (Number(old[key]) || 0) - delta) };
        });
      }
      return;
    }
    // Server rejected — drop the optimistic guess (refetch truth) and
    // surface the rejection so the operator knows the board may differ.
    opQueue.noteRejection();
    rollback(ctx);
  };
  // Replay triggers ('online', visibility→visible, 5s retry while queued
  // + visible) attach once per game across all mounts of this hook.
  useEffect(() => attachGameOpReplay(gameId, qc), [gameId, qc]);

  // Refuter fix C1 (2026-08-09): networkMode 'always' on the four queueable
  // mutations (scoped HERE, not global). React Query v5's default 'online'
  // mode PAUSES a mutation while navigator.onLine is false — mutationFn
  // never runs, onError never fires, settleFailure never enqueues, and a
  // tab reload while offline silently loses every tap even as the
  // ConnectionBanner promises they're queued. With 'always' the fetch runs,
  // rejects (TypeError), onError fires, and the op lands in the queue +
  // sessionStorage — the whole point of Domain C.
  const score = useMutation({
    networkMode: 'always',
    // Operator-trust wave: the game-op queue + ConnectionBanner ALREADY
    // tell the scorekeeper a tap is queued/rejected (settleFailure below).
    // A toast per tap during a mid-game signal drop would be pure noise.
    meta: { suppressGlobalError: true },
    mutationFn: (body: { team?: string; delta?: number; homeScore?: number; awayScore?: number }) =>
      apiFetch(`/sports/games/${gameId}/score`, { method: 'PATCH', body: JSON.stringify(body) }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: gameKey });
      const prev = snapshotGame();
      if (prev) {
        qc.setQueryData(gameKey, (old: any) => {
          if (!old) return old;
          // Absolute set (operator typo-fix — no `delta`) wins outright;
          // otherwise apply the +/- delta to the tapped team, clamped at
          // 0 exactly like the server's atomic-increment + clamp.
          if (typeof body.delta === 'number') {
            const team = body.team === 'away' ? 'away' : 'home';
            const key = team === 'home' ? 'homeScore' : 'awayScore';
            const next = Math.max(0, (Number(old[key]) || 0) + body.delta);
            return { ...old, [key]: next };
          }
          const next = { ...old };
          if (typeof body.homeScore === 'number') next.homeScore = Math.max(0, body.homeScore);
          if (typeof body.awayScore === 'number') next.awayScore = Math.max(0, body.awayScore);
          return next;
        });
      }
      return { prev };
    },
    onError: (e, v, ctx) => settleFailure('score', e, v, ctx),
    onSuccess: writeBack,
  });
  const clock = useMutation({
    networkMode: 'always', // C1 — see the score mutation's note
    meta: { suppressGlobalError: true }, // see the score mutation's note
    mutationFn: (body: { action: string; ms?: number }) =>
      apiFetch(`/sports/games/${gameId}/clock`, { method: 'PATCH', body: JSON.stringify(body) }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: gameKey });
      const prev = snapshotGame();
      if (prev) {
        qc.setQueryData(gameKey, (old: any) => {
          if (!old) return old;
          const def = findSport(old.sport);
          const now = new Date();
          switch (body.action) {
            case 'start':
              // Re-anchor at the current reading (unchanged — the clock
              // wasn't running a moment ago) and let it run. Mirrors
              // clockAction's 'start' case.
              return { ...old, clockRunning: true, clockUpdatedAt: now.toISOString() };
            case 'pause': {
              // Freeze at the LIVE-projected reading, same math the
              // console's own useLiveClock ticker uses, so pausing never
              // visibly jumps the displayed time.
              if (!old.clockRunning || !def || def.clock.type === 'none') {
                return { ...old, clockRunning: false, clockUpdatedAt: now.toISOString() };
              }
              const elapsed = now.getTime() - new Date(old.clockUpdatedAt).getTime();
              const liveMs =
                def.clock.type === 'countup'
                  ? old.clockMs + elapsed
                  : Math.max(0, old.clockMs - elapsed);
              return { ...old, clockMs: liveMs, clockRunning: false, clockUpdatedAt: now.toISOString() };
            }
            case 'set':
              if (typeof body.ms !== 'number' || body.ms < 0) return old;
              return { ...old, clockMs: Math.round(body.ms), clockUpdatedAt: now.toISOString() };
            case 'reset': {
              // segmentStartMs: countdown → its configured segment length;
              // countup/none → 0. Mirrors the server's segmentStartMs,
              // including the per-game stats.clockSegmentMs override (7:00
              // HS water polo) so the optimistic reset doesn't flash 8:00.
              const override = old?.stats?.clockSegmentMs;
              const startMs =
                def && def.clock.type === 'countdown'
                  ? (typeof override === 'number' &&
                     def.clock.segmentMsOptions?.some((o: { ms: number }) => o.ms === override)
                      ? override
                      : def.clock.segmentMs ?? 0)
                  : 0;
              return { ...old, clockMs: startMs, clockRunning: false, clockUpdatedAt: now.toISOString() };
            }
            default:
              return old;
          }
        });
      }
      return { prev };
    },
    onError: (e, v, ctx) => settleFailure('clock', e, v, ctx),
    // Refuter fix C3a (2026-08-09): a SUCCESSFUL direct write of an
    // absolute (latest-wins) kind supersedes anything queued for that
    // kind — drop those entries so a later replay can't revert the
    // server to the stale queued value. Score is delta-based and is
    // deliberately NOT dropped (its queued taps still count).
    onSuccess: (game: any) => {
      opQueue.dropKind('clock');
      writeBack(game);
    },
  });
  const segment = useMutation({
    networkMode: 'always', // C1 — see the score mutation's note
    meta: { suppressGlobalError: true }, // see the score mutation's note
    mutationFn: (body: { segment?: number; delta?: number }) =>
      apiFetch(`/sports/games/${gameId}/segment`, { method: 'PATCH', body: JSON.stringify(body) }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: gameKey });
      const prev = snapshotGame();
      if (prev) {
        qc.setQueryData(gameKey, (old: any) => {
          if (!old) return old;
          const def = findSport(old.sport);
          let next = typeof body.segment === 'number' ? Math.round(body.segment) : old.segment;
          if (typeof body.delta === 'number') next = old.segment + Math.round(body.delta);
          if (def) {
            const max = def.segment.overtime ? def.segment.count + 10 : def.segment.count;
            next = Math.min(max, Math.max(1, next));
          }
          // Deliberately conservative: the server also resets the clock,
          // zeroes/credits set-and-game scores, and snapshots the line
          // score on a segment change (setSegment, sports.service.ts) —
          // real, sport-dependent rules not worth guessing client-side.
          // Bumping the visible segment number is the instant feedback
          // the operator is actually watching for; writeBack reconciles
          // everything else the moment the PATCH resolves.
          return { ...old, segment: next };
        });
      }
      return { prev };
    },
    onError: (e, v, ctx) => settleFailure('segment', e, v, ctx),
    onSuccess: (game: any) => {
      opQueue.dropKind('segment'); // C3a — see the clock mutation's note
      writeBack(game);
    },
  });
  const stats = useMutation({
    networkMode: 'always', // C1 — see the score mutation's note
    meta: { suppressGlobalError: true }, // see the score mutation's note
    mutationFn: (body: { stats: Record<string, unknown> }) =>
      apiFetch(`/sports/games/${gameId}/stats`, { method: 'PATCH', body: JSON.stringify(body) }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: gameKey });
      const prev = snapshotGame();
      if (prev) {
        qc.setQueryData(gameKey, (old: any) => {
          if (!old) return old;
          // updateStats merges dto.stats shallowly into Game.stats server-
          // side (allow-listed keys only) — mirror the shallow merge so a
          // stat chip/lane-pad save/GameScopeText commit reflects instantly.
          const oldStats = old.stats && typeof old.stats === 'object' ? old.stats : {};
          return { ...old, stats: { ...oldStats, ...(body.stats || {}) } };
        });
      }
      return { prev };
    },
    onError: (e, v, ctx) => settleFailure('stats', e, v, ctx),
    onSuccess: (game: any) => {
      opQueue.dropKind('stats'); // C3a — see the clock mutation's note
      writeBack(game);
    },
  });
  const status = useMutation({
    mutationFn: (body: { status: string }) =>
      apiFetch(`/sports/games/${gameId}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: writeBack,
  });
  const cue = useMutation({
    // key → a built-in sport celebration; cueId → an operator cue-deck
    // cue. target → which surfaces play it (BOARD / RIBBON / ALL).
    mutationFn: (body: {
      key?: string;
      cueId?: string;
      target?: string;
      // T2-6 — when true, the ribbon uses a tight 2.5s crawl strip
      // instead of the full 4500ms cinematic. Auto-set by the inline
      // cue bar when target === 'RIBBON'.
      ribbonStrip?: boolean;
      // Optional co-branding — a sound clip + a sponsor attribution.
      audioUrl?: string;
      sponsorName?: string;
      sponsorLogoUrl?: string;
      // 2026-05-27 — player attribution for the celebration.
      // Cinematic reads these and shows "SCORED BY #12 SMITH".
      scorerName?: string;
      scorerNumber?: string;
      scorerPhotoUrl?: string;
      scorerId?: string;
    }) =>
      apiFetch(`/sports/games/${gameId}/cue`, { method: 'POST', body: JSON.stringify(body) }),
  });

  // Sprint 13 — editable game details (team identity + template
  // re-assignment). Operator can swap a layout mid-game; the PATCH
  // accepts empty-string → null to clear back to "use the built-in
  // layout" for any surface.
  const details = useMutation({
    mutationFn: (body: {
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string | null;
      awayLogoUrl?: string | null;
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
    }) =>
      apiFetch(`/sports/games/${gameId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: writeBack,
  });
  const spotlight = useMutation({
    mutationFn: (body: {
      clear?: boolean;
      visible?: boolean;
      title?: string;
      photoUrl?: string;
      subtitle?: string;
      lines?: Array<{ label: string; value: string }>;
    }) =>
      apiFetch(`/sports/games/${gameId}/spotlight`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: writeBack,
  });

  const ribbon = useMutation({
    // Operator's custom ribbon messages — scroll on the stadium ribbon.
    // 2026-05-27 — invalidate after save so the SurfacePreview iframe +
    // RibbonPanel re-pull `game.ribbonMessages` within the next poll
    // window instead of waiting up to 4s on the React Query cache.
    mutationFn: (body: { messages: string[] }) =>
      apiFetch(`/sports/games/${gameId}/ribbon`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  const ribbonPresets = useMutation({
    // Which content tiles ride the stadium ribbon reel.
    mutationFn: (body: { presets: string[] }) =>
      apiFetch(`/sports/games/${gameId}/ribbon-presets`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    // Re-pull the game so the panel reflects the saved (resolved) config.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  const ribbonSpeed = useMutation({
    // How fast the ribbon reel scrolls.
    mutationFn: (body: { speed: string }) =>
      apiFetch(`/sports/games/${gameId}/ribbon-speed`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  const ribbonSlides = useMutation({
    // The operator's full-bleed ribbon image slides.
    mutationFn: (body: { slides: string[] }) =>
      apiFetch(`/sports/games/${gameId}/ribbon-slides`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  const ribbonScoreRepeat = useMutation({
    // How many times the score anchor repeats around the ribbon.
    mutationFn: (body: { repeat: string }) =>
      apiFetch(`/sports/games/${gameId}/ribbon-score`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  const shotClock = useMutation({
    // Basketball / water-polo shot clock — configure length, or start /
    // stop / reset. writeBack pushes the returned game into the cache so
    // the operator's button press flips the UI instantly instead of
    // waiting for the next poll (otherwise feels like "the button did
    // nothing").
    mutationFn: (body: { action: string; value?: number }) =>
      apiFetch(`/sports/games/${gameId}/shot-clock`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: writeBack,
  });

  const playClock = useMutation({
    // Football play clock — start / stop / reset the 40-25 countdown.
    // Same writeBack rationale as shotClock above.
    mutationFn: (body: { action: string; value?: number }) =>
      apiFetch(`/sports/games/${gameId}/play-clock`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: writeBack,
  });

  const penalties = useMutation({
    // Penalty box — add / remove / clear a timed penalty. Writes the
    // game back so the penalty popup list refreshes the instant the
    // operator taps, instead of waiting for the next poll.
    mutationFn: (body: {
      action: string;
      team?: string;
      penaltyId?: string;
      lenSec?: number;
      label?: string;
      player?: string;
      // Water polo one-tap exclusion — the server bumps the per-player
      // major-foul count + team EXCL stat in the same write as the box
      // timer (see sports.service.ts penalties 'add').
      exclusion?: boolean;
      playerName?: string;
    }) =>
      apiFetch(`/sports/games/${gameId}/penalties`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: writeBack,
  });

  const callTimeout = useMutation({
    // Timeout — atomically pauses the clock, decrements the team's
    // remaining timeouts, fires the TIMEOUT overlay CUE, and resets
    // the football play clock to 25s. Writes the game back so the
    // timeout pip counter updates instantly on the operator console.
    mutationFn: (body: { team: 'home' | 'away'; type?: 'full' | 'short' }) =>
      apiFetch(`/sports/games/${gameId}/timeout`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  // T2-4: Pregame starting-lineup choreography — fires a 'pregame-intro'
  // CUE GameEvent with the roster for the requested team. The board page's
  // existing cue-pump picks it up within 750ms and routes it to
  // CelPregameIntroWidget for a per-player cinematic scoreboard takeover.
  const firePregameIntro = useMutation({
    mutationFn: (body: {
      team?: 'home' | 'away';
      audioUrl?: string;
      slotMs?: number;
      skippable?: boolean;
    }) =>
      apiFetch(`/sports/games/${gameId}/pregame-intro`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });


  // ── T2-5: live-game text overlay ────────────────────────────────
  // Fire a penalty / review / injury / timeout-banner overlay that
  // appears on the board, ribbon, and concourse surfaces instantly.
  // Review overlays are persistent (operator must explicitly clear);
  // penalty / injury / timeout-banner auto-clear on the next clock
  // start on the server side.
  const liveOverlay = useMutation({
    mutationFn: (body: {
      kind: 'penalty' | 'review' | 'injury' | 'timeout-banner';
      payload?: Record<string, unknown>;
    }) =>
      apiFetch(`/sports/games/${gameId}/live-overlay`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    // No cache invalidation needed — the board polls independently;
    // the operator console doesn't need to reflect overlay state.
  });

  const clearLiveOverlay = useMutation({
    mutationFn: () =>
      apiFetch(`/sports/games/${gameId}/live-overlay/clear`, {
        method: 'POST',
      }),
  });
  // ────────────────────────────────────────────────────────────────

  // S1-5 (P2-EndSetMacro, 2026-07-02 sports deep-pass audit): one atomic
  // server-side call replacing EndSetMacro's four sequential client
  // mutations (set-win stat credit, score zero, cue, segment advance).
  // writeBack pushes the returned game straight into the cache — the
  // console's score/segment tiles and set/game counters update the
  // instant the operator taps, same as every other control here.
  const endSegmentMacro = useMutation({
    mutationFn: () =>
      apiFetch(`/sports/games/${gameId}/end-segment`, { method: 'POST' }),
    onSuccess: (result: any) => {
      if (result?.updated) writeBack(result.updated);
    },
  });

  // ── T3-3 Show Control — recall a full-screen GAMEDAY scene to the
  // board (Halftime Board / Starting Lineup / Sponsors / …) for holdMs,
  // then it auto-reverts server-side. The board polls independently, so
  // no cache invalidation needed; the recall response carries expiresAt
  // for the console countdown chip. ──────────────────────────────────
  const scene = useMutation({
    mutationFn: (body: { templateId: string; holdMs?: number }) =>
      apiFetch(`/sports/games/${gameId}/scene`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
  const sceneClear = useMutation({
    mutationFn: () =>
      apiFetch(`/sports/games/${gameId}/scene/clear`, { method: 'POST' }),
  });
  const sceneExtend = useMutation({
    mutationFn: (body?: { holdMs?: number }) =>
      apiFetch(`/sports/games/${gameId}/scene/extend`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
  });


  const setPossession = useMutation({
    // T2-8: Possession arrow — tap to flip between home and away.
    // Writes to Game.possession (first-class column, not a stat field).
    // Atomically: updates the column, writes a POSSESSION GameEvent for
    // the forensic trail, and an AuditLog row. Board/ribbon/scorebug
    // surfaces read Game.possession first and fall back to stats.possession
    // for backward compat.
    mutationFn: (body: { team: 'home' | 'away' }) =>
      apiFetch(`/sports/games/${gameId}/possession`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sports-game', gameId] }),
  });

  return {
    score,
    clock,
    shotClock,
    playClock,
    penalties,
    callTimeout,
    firePregameIntro,

    setPossession,
    segment,
    stats,
    status,
    cue,
    spotlight,
    ribbon,
    ribbonPresets,
    ribbonSpeed,
    ribbonSlides,
    ribbonScoreRepeat,
    details,
    liveOverlay,
    clearLiveOverlay,
    endSegmentMacro,
    scene,
    sceneClear,
    sceneExtend,
  };
}

// ─── VenueOS Sports — Sprint 13 Phase 2: Sponsorship ────────────
// Sponsor CRUD + the proof-of-play report. Sponsors rotate through
// the scoreboard banner; the report estimates spots + exposure.

export function useSponsors() {
  return useQuery({
    queryKey: ['sports-sponsors'],
    queryFn: () => apiFetch('/sports/sponsors'),
  });
}

export function useSponsorReport() {
  return useQuery({
    queryKey: ['sports-sponsor-report'],
    queryFn: () => apiFetch('/sports/sponsors/report'),
    refetchInterval: 30_000,
  });
}

/**
 * REAL per-game proof-of-play — counts the actual `SponsorImpression`
 * rows the public board/ribbon wrote during ONE game, per surface, with
 * a per-sponsor cap-compliance flag. Distinct from `useSponsorReport`
 * (the tenant-wide arithmetic ESTIMATE). This is the number a sponsor
 * sees at renewal: "your logo ran 41× on the ribbon, 28× on the board."
 */
export function useSponsorGameReport(gameId: string | undefined) {
  return useQuery({
    queryKey: ['sports-sponsor-game-report', gameId],
    queryFn: () => apiFetch(`/sports/games/${gameId}/sponsor-report`),
    enabled: !!gameId,
    refetchInterval: 30_000,
  });
}

export type SponsorInput = {
  name?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  tier?: string | null;
  weight?: number;
  active?: boolean;
  // Ad-ops scheduling — flight window + per-hour frequency cap.
  flightStartAt?: string | null;
  flightEndAt?: string | null;
  frequencyCapPerHour?: number | null;
};

export function useCreateSponsor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SponsorInput) =>
      apiFetch('/sports/sponsors', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports-sponsors'] });
      qc.invalidateQueries({ queryKey: ['sports-sponsor-report'] });
    },
  });
}

export function useUpdateSponsor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SponsorInput }) =>
      apiFetch(`/sports/sponsors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports-sponsors'] });
      qc.invalidateQueries({ queryKey: ['sports-sponsor-report'] });
    },
  });
}

export function useDeleteSponsor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/sports/sponsors/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports-sponsors'] });
      qc.invalidateQueries({ queryKey: ['sports-sponsor-report'] });
    },
  });
}

// ─── VenueOS Sports — Sprint 13 Phase 3: scoreboard-to-screen ───
// Push a game's live scoreboard onto the venue's paired screens.

export function useGameScreens(gameId: string | undefined) {
  return useQuery({
    queryKey: ['sports-game-screens', gameId],
    queryFn: () => apiFetch(`/sports/games/${gameId}/screens`),
    enabled: !!gameId,
    refetchInterval: 10_000,
  });
}

export function useShowGameOnScreens(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    // surface: 'BOARD' (full scoreboard) | 'RIBBON' (LED strip) |
    // 'SCOREBUG' (broadcast overlay) — which display the screen shows.
    mutationFn: (vars: { screenIds: string[]; surface?: string; force?: boolean }) =>
      apiFetch(`/sports/games/${gameId}/show`, {
        method: 'POST',
        body: JSON.stringify({
          screenIds: vars.screenIds,
          surface: vars.surface,
          force: vars.force,
        }),
      }),
    onSuccess: (data) => {
      if (data) qc.setQueryData(['sports-game-screens', gameId], data);
    },
  });
}

export function useHideGameFromScreens(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (screenIds?: string[]) =>
      apiFetch(`/sports/games/${gameId}/hide`, {
        method: 'POST',
        body: JSON.stringify({ screenIds: screenIds ?? null }),
      }),
    onSuccess: (data) => {
      if (data) qc.setQueryData(['sports-game-screens', gameId], data);
    },
  });
}

// ── schedule game mode (Inputs-wave SCHED) ─────────────────────
// Auto-push the board to the armed screens 10 minutes before the game
// time, auto-revert at FINAL.

export interface AutoPushConfig {
  armed: boolean;
  screenIds: string[];
  surface: string;
  /** Pending fire time (ISO) — null once fired, cancelled, or disarmed. */
  autoPushAt: string | null;
  /** Set once the sweep put the board up (ISO). */
  pushedAt: string | null;
  /** The server's baked lead (ms before scheduledAt) — drives UI copy. */
  leadMs: number;
}

export function useAutoPush(gameId: string | undefined) {
  return useQuery<AutoPushConfig>({
    queryKey: ['sports-auto-push', gameId],
    queryFn: () => apiFetch(`/sports/games/${gameId}/auto-push`),
    enabled: !!gameId,
    // Deliberately NO refetchInterval (mobile perf standard — no new
    // pollers): the armed flag only changes via this console's own
    // mutations, and the live pieces the card renders (scheduledAt,
    // autoPushAt via the game row) ride the existing useGame 4s poll.
  });
}

export function useSetAutoPush(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    // The auto-push panel already prints the server's message inline under
    // the surface picker — don't tell the scorekeeper twice mid-game.
    meta: { suppressGlobalError: true },
    mutationFn: (vars: { armed: boolean; screenIds?: string[]; surface?: string }) =>
      apiFetch(`/sports/games/${gameId}/auto-push`, {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: (data) => {
      if (data) qc.setQueryData(['sports-auto-push', gameId], data);
      // The game row carries autoPushAt (the AUTO chip on the list reads
      // it) — refresh both game caches.
      qc.invalidateQueries({ queryKey: ['sports-game', gameId] });
      qc.invalidateQueries({ queryKey: ['sports-games'] });
    },
  });
}

// ── sports roster ──────────────────────────────────────────────

export interface RosterPlayer {
  id: string;
  team: string;
  name: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  stats: Record<string, string>;
  /** Persistent athlete this appearance is linked to (season/career rollup).
   *  null = unlinked one-off. Set by the link route or auto-link at import. */
  personId?: string | null;
}

export function useGameRoster(gameId: string | undefined) {
  return useQuery({
    queryKey: ['sports-roster', gameId],
    queryFn: () => apiFetch(`/sports/games/${gameId}/roster`),
    enabled: !!gameId,
  });
}

export function useRosterMutations(gameId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['sports-roster', gameId] });

  const add = useMutation({
    mutationFn: (body: Partial<RosterPlayer>) =>
      apiFetch(`/sports/games/${gameId}/roster`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ playerId, ...body }: Partial<RosterPlayer> & { playerId: string }) =>
      apiFetch(`/sports/games/${gameId}/roster/${playerId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (playerId: string) =>
      apiFetch(`/sports/games/${gameId}/roster/${playerId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const importCsv = useMutation({
    mutationFn: (csv: string) =>
      apiFetch(`/sports/games/${gameId}/roster/import`, {
        method: 'POST',
        body: JSON.stringify({ csv }),
      }),
    onSuccess: (data) => {
      if (data) qc.setQueryData(['sports-roster', gameId], data);
    },
  });
  return { add, update, remove, importCsv };
}

// ── sports cue deck ────────────────────────────────────────────

export interface CustomCue {
  id: string;
  name: string;
  mediaUrl: string | null;
  color: string | null;
  durationMs: number;
  /** 'overlay' (board stays visible, lower band) | 'takeover' (full screen). */
  displayMode?: string;
}

export function useCues() {
  return useQuery({
    queryKey: ['sports-cues'],
    queryFn: () => apiFetch('/sports/cues'),
  });
}

export function useCueMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['sports-cues'] });
  const create = useMutation({
    mutationFn: (body: Partial<CustomCue>) =>
      apiFetch('/sports/cues', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<CustomCue> & { id: string }) =>
      apiFetch(`/sports/cues/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/sports/cues/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ── branding scrape (pull a logo + palette from a website) ─────

export function useScrapeBranding() {
  return useMutation({
    mutationFn: (url: string) =>
      apiFetch('/branding/scrape', { method: 'POST', body: JSON.stringify({ url }) }),
  });
}

// ─── 2026-05-25 Developer area: API Keys + Webhooks ────────────────

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  role: string;
  /**
   * ACC-06 follow-up (2026-08-03) — the key's least-privilege grant.
   * `null` is an UNRESTRICTED key (everything minted before scopes existed);
   * `[]` is an explicit grant of nothing. Emergency routes are refused for
   * every API key regardless.
   */
  scopes: string[] | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

/** A grantable route family, from GET /api-keys/scopes. */
export interface ApiKeyScopeFamily {
  id: string;
  label: string;
  blurb: string;
  access: readonly ('read' | 'write')[];
}

/** Response of GET /api-keys/scopes — the vocabulary THIS build enforces. */
export interface ApiKeyScopeCatalog {
  scopes: string[];
  families: ApiKeyScopeFamily[];
  defaultExpiryDays: number;
  maxExpiryDays: number;
}

export function useApiKeys() {
  return useQuery<ApiKeyRow[]>({
    queryKey: ['api-keys'],
    queryFn: () => apiFetch('/api-keys'),
  });
}

/**
 * The scope + expiry policy the API actually enforces.
 *
 * Served rather than hard-coded so the picker can never offer a scope the
 * guard does not understand, and the "expires in N days" copy can never drift
 * from `ApiKeysService`'s real default/ceiling — the exact drift that let the
 * old UI imply keys never expire.
 */
export function useApiKeyScopeCatalog() {
  return useQuery<ApiKeyScopeCatalog>({
    queryKey: ['api-keys', 'scopes'],
    queryFn: () => apiFetch('/api-keys/scopes'),
    staleTime: 5 * 60_000,
  });
}

export function useMintApiKey() {
  const qc = useQueryClient();
  return useMutation<
    { id: string; token: string; prefix: string; scopes: string[] | null },
    Error,
    { name: string; role: string; expiresAt?: string | null; scopes?: string[] | null }
  >({
    mutationFn: (body) => apiFetch('/api-keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    // handleRevoke (settings/developer) already raises a blocking
    // "Could not revoke" appAlert with the server's reason.
    meta: { suppressGlobalError: true },
    mutationFn: (id) => apiFetch(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
  lastDeliveryError: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export function useWebhooks() {
  return useQuery<WebhookRow[]>({
    queryKey: ['webhooks'],
    queryFn: () => apiFetch('/webhooks'),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation<
    { id: string; signingSecret: string },
    Error,
    { name: string; url: string; events: string[] }
  >({
    mutationFn: (body) => apiFetch('/webhooks', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (id) => apiFetch(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}

// ── Undo rail — game event log + per-event undo ───────────────

export type GameEventRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  undoable: boolean;
  nonUndoableReason?: string;
  createdAt: string;
};

/**
 * Poll the last 25 game events for the undo rail.
 * Refetches every 2 s while the component is mounted so the rail
 * stays fresh without the operator having to manually refresh.
 */
export function useGameEvents(gameId: string | undefined) {
  return useQuery<GameEventRow[]>({
    queryKey: ['sports-game-events', gameId],
    queryFn: () => apiFetch(`/sports/games/${gameId}/events?limit=25`),
    enabled: !!gameId,
    refetchInterval: 2_000,
    staleTime: 0,
  });
}

/**
 * Undo a single game event by id. On success, invalidates the
 * events list and the game so the scoreboard + rail both refresh.
 */
export function useUndoGameEvent(gameId: string) {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; undoOf: string; originalType: string }, Error, string>({
    mutationFn: (eventId: string) =>
      apiFetch(`/sports/games/${gameId}/events/${eventId}/undo`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports-game-events', gameId] });
      qc.invalidateQueries({ queryKey: ['sports-game', gameId] });
    },
  });
}

// ─── MFA / TOTP (two-factor authentication) ─────────────────────
//
// 2026-05-28 — frontend for the already-built, audited MFA backend
// (apps/api/src/auth/mfa.controller.ts). Five endpoints, all under
// /api/v1/auth/mfa — apiFetch prepends /api/v1, so the paths below are
// the controller routes minus that prefix.
//
// Contract matched against the real controller, not assumed:
//   POST /auth/mfa/enroll        (Bearer) → { secret, otpauthUrl, qrSvg, issuer, label }
//   POST /auth/mfa/verify        (Bearer) { code } → { success, backupCodes[] }
//   POST /auth/mfa/disable       (Bearer) { password } → { success }
//   POST /auth/mfa/backup-codes  (Bearer) { password } → { success, backupCodes[] }
//   POST /auth/mfa/challenge     (public) { mfaToken, code?|backupCode? } → login envelope
//
// NOTE (reported contract gap): there is NO GET endpoint that returns
// "is MFA enabled for me" — /users/me omits mfaTotpVerifiedAt and the
// login user object doesn't carry it either. The settings page therefore
// reflects enrolled-state from the actions performed in-session (enroll/
// verify → enabled; disable → disabled) and surfaces an "unknown until you
// act" affordance on a cold load. The challenge step on the LOGIN page
// uses raw fetch (no hook) because it runs pre-auth, before any token /
// QueryClient exists.

/** Response of POST /auth/mfa/enroll. */
export interface MfaEnrollResponse {
  /** base32 TOTP secret — shown ONCE for manual Authenticator entry. */
  secret: string;
  /** otpauth:// URL the client renders into a QR code. */
  otpauthUrl: string;
  /** Backend currently always null — QR rendering is the client's job. */
  qrSvg: string | null;
  issuer: string;
  label: string;
}

/** Response of POST /auth/mfa/verify and /auth/mfa/backup-codes. */
export interface MfaCodesResponse {
  success: true;
  /** 10 single-use backup codes — shown ONCE, must be saved by the user. */
  backupCodes: string[];
}

/** Response of GET /auth/mfa/status. */
export interface MfaStatusResponse {
  /** Whether TOTP MFA is enabled (verified) for the signed-in user. */
  enabled: boolean;
  /**
   * How many passkeys the user holds (2026-09-21 passkey wave). ABSENT on an
   * API that predates passkeys, which is why it is optional — read it as
   * "unknown", never as zero.
   */
  passkeyCount?: number;
}

/**
 * Is MFA enabled for the signed-in user? Lets the settings card render the
 * correct enrolled state on a cold page load (rather than inferring it only
 * from an enroll-attempt 400). Read-only GET, safe to fire on mount.
 */
export function useMfaStatus() {
  return useQuery<MfaStatusResponse, Error>({
    queryKey: ['mfa-status'],
    queryFn: () => apiFetch<MfaStatusResponse>('/auth/mfa/status'),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Begin enrollment — generate a fresh (provisional) TOTP secret + otpauth
 * URL. Login still works password-only until /verify succeeds, so an
 * abandoned enrollment can never lock the user out.
 */
export function useMfaEnroll() {
  return useMutation<MfaEnrollResponse, Error, void>({
    mutationFn: () => apiFetch<MfaEnrollResponse>('/auth/mfa/enroll', { method: 'POST' }),
  });
}

/**
 * Confirm the user can read codes from their Authenticator. On success
 * the secret flips to verified and 10 backup codes are minted + returned
 * ONCE.
 */
export function useMfaVerify() {
  return useMutation<MfaCodesResponse, Error, { code: string }>({
    mutationFn: (body) =>
      apiFetch<MfaCodesResponse>('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

/**
 * Disable MFA. Requires password re-auth so a stolen session alone can't
 * strip the second factor.
 */
export function useMfaDisable() {
  return useMutation<{ success: true }, Error, { password: string }>({
    mutationFn: (body) =>
      apiFetch<{ success: true }>('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

// ── Passkeys / WebAuthn (2026-09-21) ────────────────────────────────────
//
// Operator: "can we add pass key to our security? im sick of the damn auth
// app". Management endpoints are authenticated, so they go through apiFetch
// exactly like the TOTP ones above. The two PUBLIC halves — the second factor
// at login and the passwordless sign-in — deliberately do NOT live here: they
// run pre-auth, before any token or QueryClient exists, so the login page
// calls them with plain `fetch` the same way it already calls
// /auth/mfa/challenge.

/** One enrolled passkey, as GET /auth/passkeys returns it. */
export interface PasskeySummary {
  id: string;
  /** Operator-chosen name. Null when they never set one. */
  label: string | null;
  createdAt: string;
  /** Null until the passkey has actually signed someone in. */
  lastUsedAt: string | null;
  /** e.g. ['internal','hybrid'] — how the authenticator is reachable. */
  transports: string[];
}

/** Response of GET /auth/passkeys. */
export interface PasskeyListResponse {
  passkeys: PasskeySummary[];
  /** Server-enforced ceiling; the UI hides "Add" once the list reaches it. */
  max: number;
}

/** Response of POST /auth/passkeys/register/verify. */
export interface PasskeyRegisterVerifyResponse {
  passkey: PasskeySummary;
  /**
   * Present ONCE, and only for a user who had no recovery codes at all —
   * enrolling a passkey can make a passkey the only factor, and an account
   * with no recovery path is a lockout waiting to happen. Show them with the
   * same "save these now" treatment MfaCard gives TOTP codes.
   */
  backupCodes?: string[];
}

/** The signed-in user's passkeys. Read-only GET, safe to fire on mount. */
export function usePasskeys() {
  return useQuery<PasskeyListResponse, Error>({
    queryKey: ['passkeys'],
    queryFn: () => apiFetch<PasskeyListResponse>('/auth/passkeys'),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Step 1 of enrollment — trade the account password for creation options.
 * The password is required by the API: a stolen session alone must not be
 * able to bolt a NEW permanent credential onto the account.
 *
 * Errors worth handling at the callsite: 401 (wrong password), 409
 * PASSKEY_PASSWORD_REQUIRED (SSO user with no password), 409 PASSKEY_LIMIT,
 * 400 PASSKEY_ORIGIN_NOT_ALLOWED.
 */
export function usePasskeyRegisterOptions() {
  return useMutation<
    { options: PublicKeyCredentialCreationOptionsJSON },
    Error,
    { password: string }
  >({
    mutationFn: (body) =>
      apiFetch<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        '/auth/passkeys/register/options',
        { method: 'POST', body: JSON.stringify(body) },
      ),
  });
}

/** Step 2 — hand the authenticator's attestation back for verification. */
export function usePasskeyRegisterVerify() {
  const qc = useQueryClient();
  return useMutation<
    PasskeyRegisterVerifyResponse,
    Error,
    { response: RegistrationResponseJSON; label?: string }
  >({
    mutationFn: (body) =>
      apiFetch<PasskeyRegisterVerifyResponse>('/auth/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['passkeys'] });
      // The security page's rail reads passkeyCount off the MFA status.
      qc.invalidateQueries({ queryKey: ['mfa-status'] });
    },
  });
}

/** Rename a passkey. No password: a label is not a credential. */
export function usePasskeyRename() {
  const qc = useQueryClient();
  return useMutation<{ passkey: PasskeySummary }, Error, { id: string; label: string }>({
    mutationFn: ({ id, label }) =>
      apiFetch<{ passkey: PasskeySummary }>(`/auth/passkeys/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['passkeys'] }); },
  });
}

/**
 * Remove a passkey. Password re-auth for the same reason disabling TOTP needs
 * it. 409 PASSKEY_LAST_FACTOR means MFA is required on this account and this
 * was the last thing satisfying it — the caller must say so rather than
 * reporting a generic failure.
 */
export function usePasskeyDelete() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { id: string; password: string }>({
    mutationFn: ({ id, password }) =>
      apiFetch<{ ok: true }>(`/auth/passkeys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['passkeys'] });
      qc.invalidateQueries({ queryKey: ['mfa-status'] });
    },
  });
}

/** Response of POST /auth/change-password. */
export interface ChangePasswordResponse {
  success: true;
  /**
   * Replacement session token. The server revokes EVERY live token for the
   * user and pins this one past the cut, so the caller stays signed in while
   * every other device is signed out. The client must swap its stored token
   * for this or its very next request 401s.
   */
  access_token: string;
  /**
   * `false` means the password DID change but the revocation store was
   * unreachable — other sessions may still be alive. Surface it; do not
   * report a clean containment we did not achieve.
   */
  sessionsRevoked: boolean;
}

/**
 * ACC-02 (2026-08-01) — authenticated password change.
 *
 * Re-verifies the current password (a stolen session alone must not be able
 * to rotate the credential), then kills every other session. Shipped with no
 * UI at all until 2026-08-03: a user who suspected their session was
 * compromised had no in-product way to lock it down.
 */
export function useChangePassword() {
  return useMutation<ChangePasswordResponse, Error, { currentPassword: string; newPassword: string }>({
    // ChangePasswordCard renders the failure inline next to the fields (it
    // owns the whole "wrong current password" flow) — no second report.
    meta: { suppressGlobalError: true },
    mutationFn: (body) =>
      apiFetch<ChangePasswordResponse>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

/**
 * Regenerate the 10 backup codes (invalidates any unused ones). Requires
 * password re-auth.
 */
export function useMfaRegenerateBackupCodes() {
  return useMutation<MfaCodesResponse, Error, { password: string }>({
    mutationFn: (body) =>
      apiFetch<MfaCodesResponse>('/auth/mfa/backup-codes', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

// ─── AI Designer background jobs (2026-09-23) ──────────────────────────
//
// `generate-designer/candidates` is ONE synchronous request that already runs
// minutes. iOS Safari drops a backgrounded fetch, a deploy kills it, and there
// was no progress, no cancel and no resume. A generation is now a job the API
// persists and runs on its own (apps/api/src/templates/designer-jobs/): the
// page STARTS it, POLLS it while the tab is visible, can CANCEL it, and
// Regenerate replays it server-side (`…/again`). Shapes mirror the controller's
// return types (DesignerJobStarted / DesignerJobView).

export type DesignerJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** The pipeline's last reported stage (apps/api/src/ai/designer-generation-hooks.ts). */
export interface DesignerJobProgress {
  stage: string;
  /** 1-based candidate the stage applies to; absent = the whole batch. */
  candidate?: number;
  of?: number;
  message?: string;
  updatedAt: string;
}

/** The envelope the sync endpoint's error would have carried: status + { code, message }. */
export interface DesignerJobError {
  code: string;
  message: string;
  status: number;
}

/** Exactly the body `generate-designer/candidates` returns. */
export interface DesignerJobResult {
  candidates: DesignerBoardCandidate[];
  designer: true;
  batchId?: string;
  ai?: { source: 'tenant' | 'platform'; usage: { used: number; cap: number; resetAt: string } | null };
  /** Set when every row of the boards is bound to a POS menu. */
  boundTo?: { providerId: string; providerName: string; itemCount: number };
}

export interface DesignerJob {
  id: string;
  status: DesignerJobStatus;
  progress: DesignerJobProgress | null;
  /** Only when status === 'done'. */
  result?: DesignerJobResult;
  /** Only when status === 'failed'. */
  error?: DesignerJobError;
  createdAt: string;
  finishedAt: string | null;
}

export interface DesignerJobStarted {
  jobId: string;
  status: DesignerJobStatus;
}

/** How often a queued/running job is polled while the tab is visible. */
export const DESIGNER_JOB_POLL_MS = 2_000;

export function designerJobIsActive(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * POST /templates/generate-designer/jobs → 202 { jobId, status }. The body is
 * the generate-designer/candidates body plus a client-generated
 * `idempotencyKey`: apiFetch re-sends a POST after a network error, and the
 * same key returns the job it already started instead of a second paid batch.
 */
export function useStartDesignerJob() {
  return useMutation<
    DesignerJobStarted,
    Error,
    { prompt: string; idempotencyKey?: string } & Record<string, unknown>
  >({
    mutationFn: (body) =>
      apiFetch<DesignerJobStarted>('/templates/generate-designer/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

/**
 * GET /templates/generate-designer/jobs/:id. Polls every 2 s ONLY while the
 * job is queued/running and the tab is visible (refetchIntervalInBackground
 * stays false — mobile-perf standard), and refetches the moment the operator
 * returns to the tab (an iOS app switch) — while the job is active only, so a
 * finished job's result (~120 KB of HTML per board) is never re-downloaded on
 * focus. Opted in on THIS hook only; the global focus default stays false.
 */
export function useDesignerJob(jobId: string | null | undefined) {
  return useQuery<DesignerJob>({
    queryKey: ['designer-job', jobId],
    queryFn: () =>
      apiFetch<DesignerJob>(`/templates/generate-designer/jobs/${encodeURIComponent(String(jobId))}`),
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) =>
      !query.state.data || designerJobIsActive(query.state.data.status) ? DESIGNER_JOB_POLL_MS : false,
    refetchOnWindowFocus: (query) => designerJobIsActive(query.state.data?.status),
    // A job that does not exist (pruned after 7 days, another account's id)
    // will not start existing on a retry.
    retry: (count, err) => (err as { status?: number } | null)?.status !== 404 && count < 3,
  });
}

/**
 * POST …/jobs/:id/cancel → the job as it now is: `cancelled`, or its final
 * state unchanged when it had already finished. Written straight into the
 * job's query so the page reacts to it exactly as it does to a poll.
 */
export function useCancelDesignerJob() {
  const qc = useQueryClient();
  return useMutation<DesignerJob, Error, string>({
    mutationFn: (jobId) =>
      apiFetch<DesignerJob>(`/templates/generate-designer/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      }),
    onSuccess: (job) => {
      if (job?.id) qc.setQueryData(['designer-job', job.id], job);
    },
  });
}

/**
 * POST …/jobs/:id/again → 202 { jobId, status }: the server-side Regenerate.
 * A NEW job from the request the old one persisted (re-validated on the
 * server), so a regenerate keeps the brand, content source, bindings and
 * generator no matter what the page still remembers.
 */
export function useRegenerateDesignerJob() {
  return useMutation<DesignerJobStarted, Error, { jobId: string; idempotencyKey?: string }>({
    mutationFn: ({ jobId, idempotencyKey }) =>
      apiFetch<DesignerJobStarted>(`/templates/generate-designer/jobs/${encodeURIComponent(jobId)}/again`, {
        method: 'POST',
        body: JSON.stringify(idempotencyKey ? { idempotencyKey } : {}),
      }),
  });
}
