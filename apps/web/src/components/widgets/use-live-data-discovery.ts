"use client";
import { useEffect, useSyncExternalStore } from "react";

import { fetchLiveDataStatus, LIVE_DATA_FAMILIES, type LiveDataStatus } from "@/lib/live-data/live-data-client";
import { liveDataDiscoveryVersion, setEnabledLiveDataFamilies, subscribeLiveDataDiscovery } from "./widget-discovery";

/** Apply a `/status` answer to widget discovery. Exported for tests. */
export function applyLiveDataStatus(status: LiveDataStatus | null): void {
  if (!status) return; // unknown is not "off" — keep whatever we knew
  setEnabledLiveDataFamilies(LIVE_DATA_FAMILIES.filter((f) => status[f]?.enabled === true));
}

/**
 * Builder-only: ask the API once which paid data families this deploy has
 * keys for, and re-render when the picker's visible set changes. Returns a
 * version number to use as a memo dependency.
 */
export function useLiveDataDiscovery(): number {
  useEffect(() => {
    let cancelled = false;
    void fetchLiveDataStatus().then((s) => {
      if (!cancelled) applyLiveDataStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return useSyncExternalStore(subscribeLiveDataDiscovery, liveDataDiscoveryVersion, liveDataDiscoveryVersion);
}
