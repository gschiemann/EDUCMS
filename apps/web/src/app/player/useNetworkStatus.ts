'use client';

/**
 * Browser glue for `networkStatus.ts` (2026-10-26): one monitor per page, the
 * bounded reachability probe, and the hook the boot surfaces read.
 *
 * ONE monitor for the whole page, so the registering → pairing → connecting
 * hand-offs keep what they already know (no "checking" flash, no extra probe)
 * and the player's control-plane answers (`noteNetworkAnswer` in page.tsx's
 * `noteControlPlaneSuccess`) reach it from outside React.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { createNetworkMonitor, PROBE_TIMEOUT_MS, type NetworkMonitor, type NetworkStatus } from './networkStatus';

/**
 * One bounded GET of `url`: true when ANY HTTP answer came back.
 *
 * `no-cors` on purpose: the question is "does the network path to VenueOS
 * work", not "is the API healthy". An opaque answer — even the edge's own 502
 * page, which carries no CORS header — proves the path, and a sick API must
 * never read as "check this network's internet connection". Transport
 * failures (no link, DNS, TLS, connect, the deadline) reject.
 *
 * The deadline is our own timer: `AbortSignal.timeout` is Chromium 103+ and
 * the Taurus floor is 83. The body is never read.
 */
export async function probeReachability(
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  if (signal?.aborted) return false;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const abort = () => {
    try { ctl?.abort(); } catch { /* already settled */ }
  };
  signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, timeoutMs);
  try {
    const init: RequestInit = { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit' };
    if (ctl) init.signal = ctl.signal;
    await fetch(url, init);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

let monitor: NetworkMonitor | null = null;
let probeUrl: (() => string | null) | null = null;

function getMonitor(): NetworkMonitor | null {
  if (typeof window === 'undefined') return null;
  if (monitor) return monitor;
  const m = createNetworkMonitor({
    readLink: () => {
      try { return navigator.onLine !== false; } catch { return true; }
    },
    watchLink: (onChange) => {
      const up = () => onChange(true);
      const down = () => onChange(false);
      window.addEventListener('online', up);
      window.addEventListener('offline', down);
      return () => {
        window.removeEventListener('online', up);
        window.removeEventListener('offline', down);
      };
    },
    probe: (signal) => {
      let url: string | null = null;
      try { url = probeUrl ? probeUrl() : null; } catch { url = null; }
      return url ? probeReachability(url, signal) : Promise.resolve(false);
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  monitor = m;
  // Field diagnostics, like `__eduRealtime`: what the splash thinks, and why.
  try {
    (window as unknown as { __eduNetwork?: unknown }).__eduNetwork = {
      status: () => m.getStatus(),
      state: () => ({ ...m.getState(), watching: m.watching() }),
    };
  } catch { /* diagnostics only */ }
  return m;
}

const subscribe = (listener: () => void): (() => void) => getMonitor()?.subscribe(listener) ?? (() => {});
const getSnapshot = (): NetworkStatus => getMonitor()?.getStatus() ?? 'checking';
// The server cannot know; the first client pass renders the same, then the truth.
const getServerSnapshot = (): NetworkStatus => 'checking';

/**
 * The network status for the boot surfaces. `active` = a boot surface that
 * shows it is on the glass: only then does the monitor watch the link and
 * probe. False on content, and while any alert is up.
 *
 * `healthUrl` must be stable (a module-level function): it is read at probe
 * time, so a gateway switch moves the probe with the rest of the control plane.
 */
export function useNetworkStatus(active: boolean, healthUrl: () => string | null): NetworkStatus {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    probeUrl = healthUrl;
  }, [healthUrl]);
  useEffect(() => {
    if (!active) return undefined;
    return getMonitor()?.demand();
  }, [active]);
  return status;
}

/** A control-plane request got an HTTP answer (any status): VenueOS is reachable. */
export function noteNetworkAnswer(): void {
  try { getMonitor()?.noteAnswer(); } catch { /* never breaks a request */ }
}

/** A control-plane request failed before any answer: a reason to look, not a verdict. */
export function noteNetworkNoAnswer(): void {
  try { getMonitor()?.noteNoAnswer(); } catch { /* never breaks a request */ }
}

/** Test seam: forget the page's monitor. */
export function resetNetworkMonitorForTests(): void {
  monitor = null;
  probeUrl = null;
}
