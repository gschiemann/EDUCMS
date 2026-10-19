/**
 * Basic Android settings for ONE screen (2026-10-18) —
 * `GET` / `PUT /screens/:id/device-settings`.
 *
 * Fetched only while the section is mounted (the screen's drawer is open).
 * It refreshes on its own ONLY while a saved value is still on its way to the
 * screen or waiting there, and only while the tab is visible (the mobile
 * performance standard: never poll a backgrounded tab — react-query's
 * `refetchIntervalInBackground` stays false).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEVICE_SETTING_KEYS,
  deviceSettingState,
  type DeviceSettingsPatch,
  type DeviceSettingsView,
} from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';

export type DeviceSettingsSaveResult = DeviceSettingsView & { changed: string[] };

const key = (screenId: string | undefined) => ['device-settings', screenId] as const;

/** Is any stored value still on its way to the screen, or waiting there? */
export function deviceSettingsInFlight(view: DeviceSettingsView | undefined): boolean {
  if (!view) return false;
  return DEVICE_SETTING_KEYS.some((k) => {
    const s = deviceSettingState(k, view.desired[k], view.report);
    return s.kind === 'sending' || s.kind === 'waiting';
  });
}

/** While something is in flight, check every 20 s (visible tab only). */
export const DEVICE_SETTINGS_REFRESH_MS = 20_000;

export function useDeviceSettings(screenId: string | undefined, enabled = true) {
  return useQuery<DeviceSettingsView>({
    queryKey: key(screenId),
    queryFn: () => apiFetch<DeviceSettingsView>(`/screens/${screenId}/device-settings`),
    enabled: !!screenId && enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: (q) => (deviceSettingsInFlight(q.state.data) ? DEVICE_SETTINGS_REFRESH_MS : false),
  });
}

export function useUpdateDeviceSettings(screenId: string) {
  const qc = useQueryClient();
  return useMutation<DeviceSettingsSaveResult, Error, DeviceSettingsPatch>({
    mutationFn: (patch) =>
      apiFetch<DeviceSettingsSaveResult>(`/screens/${screenId}/device-settings`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: (view) => {
      qc.setQueryData(key(screenId), view);
    },
  });
}
