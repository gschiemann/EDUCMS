/**
 * "Screens online" — ONE definition for every dashboard surface
 * (Muse beta DEV-007, 2026-10-07).
 *
 * The server owns the rule (`apps/api/src/telemetry/online-grace.ts`:
 * not revoked, belongs to a tenant, last ping younger than
 * SCREEN_ONLINE_GRACE_MS = 100 s) and stamps it as `status: 'ONLINE'` on
 * every screen list, the readiness report and the floor plans. The web never
 * re-derives it from `lastPingAt` with its own window — that is how the
 * Dashboard, Emergency and Screens pages ended up showing three different
 * numbers. Count with these helpers.
 */

export interface ScreenWithStatus {
  status?: string | null;
}

export function isScreenOnline(screen: ScreenWithStatus | null | undefined): boolean {
  return screen?.status === 'ONLINE';
}

export function countOnlineScreens(screens: ReadonlyArray<ScreenWithStatus> | null | undefined): number {
  if (!Array.isArray(screens)) return 0;
  let n = 0;
  for (const s of screens) if (isScreenOnline(s)) n += 1;
  return n;
}
