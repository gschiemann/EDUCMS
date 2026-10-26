/**
 * Screens down vs. quiet (2026-10-24) — which offline screens belong on the
 * dashboard's red "Screens down" card. Pure; tested in
 * `__tests__/screenAttention.test.ts`.
 *
 * The verdict comes from the API (`GET /screens/attention`, the same
 * intended-downtime facts the alert emails use: on/off schedule, remote
 * power-off, standby, update window, restarting). Until it answers — or if it
 * cannot — the screen row alone still decides the one thing it can: a screen
 * silent 30+ days, never connected, or a phone-browser test screen is quiet.
 * Everything else offline is DOWN: a missing verdict never hides an outage.
 */

export type AttentionBucket = 'down' | 'resting' | 'dormant';

export interface AttentionEntry {
  id: string;
  name: string;
  tenantId?: string | null;
  location?: string | null;
  groupName?: string | null;
  lastSeenAt: string | null;
  reason: string | null;
}

export interface ScreenAttentionPayload {
  generatedAt?: string;
  down: AttentionEntry[];
  resting: AttentionEntry[];
  dormant: AttentionEntry[];
}

/** The fields of a `/screens` list row this module reads. */
export interface ScreenRowLike {
  id: string;
  name?: string | null;
  status?: string | null;
  lastPingAt?: string | null;
  location?: string | null;
  screenGroup?: { name?: string | null } | null;
  hardwareModel?: string | null;
  osInfo?: string | null;
  playerVersion?: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
export const DORMANT_MS = 30 * DAY;
export const TEST_SCREEN_DORMANT_MS = DAY;

/** Same rule as the API's `isBrowserTestScreen` (screen-attention-policy.ts). */
export function isBrowserTestScreen(s: ScreenRowLike): boolean {
  if (s.playerVersion) return false;
  const hw = String(s.hardwareModel ?? '').trim().toLowerCase();
  if (hw && hw !== 'web') return false;
  const os = String(s.osInfo ?? '').trim().toLowerCase();
  return os === 'ios' || os === 'ipados' || os === 'macos' || os === 'mac os' || os === 'mac os x';
}

/** The dormant reason the row alone proves, or null. */
export function dormantFromRow(s: ScreenRowLike, nowMs: number): string | null {
  const last = s.lastPingAt ? Date.parse(s.lastPingAt) : NaN;
  if (!Number.isFinite(last)) return 'never-connected';
  const silent = nowMs - last;
  if (silent > DORMANT_MS) return 'not-seen-30-days';
  if (isBrowserTestScreen(s) && silent > TEST_SCREEN_DORMANT_MS) return 'test-screen';
  return null;
}

/** Offline by the list's own reading (ONLINE / PENDING / REVOKED are not). */
export function isOfflineRow(s: ScreenRowLike): boolean {
  return !!s.status && s.status !== 'ONLINE' && s.status !== 'PENDING' && s.status !== 'REVOKED';
}

export interface SortedAttention {
  down: AttentionEntry[];
  resting: AttentionEntry[];
  dormant: AttentionEntry[];
}

function entryOf(s: ScreenRowLike, reason: string | null): AttentionEntry {
  return {
    id: s.id,
    name: s.name || '',
    location: s.location ?? null,
    groupName: s.screenGroup?.name ?? null,
    lastSeenAt: s.lastPingAt ?? null,
    reason,
  };
}

/**
 * Sort the list's offline screens. `attention` is the server's verdict (may be
 * missing, stale or partial): a screen it names keeps the server's bucket; a
 * screen it does not name (it just went offline, or the read failed) is judged
 * from its own row.
 */
export function sortOfflineScreens(
  screens: readonly ScreenRowLike[] | null | undefined,
  attention: ScreenAttentionPayload | null | undefined,
  nowMs: number,
): SortedAttention {
  const verdict = new Map<string, { bucket: AttentionBucket; reason: string | null }>();
  for (const b of ['down', 'resting', 'dormant'] as const) {
    for (const e of attention?.[b] ?? []) verdict.set(e.id, { bucket: b, reason: e.reason ?? null });
  }
  const out: SortedAttention = { down: [], resting: [], dormant: [] };
  for (const s of screens ?? []) {
    if (!isOfflineRow(s)) continue;
    const v = verdict.get(s.id);
    if (v) {
      out[v.bucket].push(entryOf(s, v.reason));
      continue;
    }
    const dormant = dormantFromRow(s, nowMs);
    if (dormant) out.dormant.push(entryOf(s, dormant));
    else out.down.push(entryOf(s, null));
  }
  // Longest-silent first in the red card: the oldest outage is the one to act on.
  const ms = (e: AttentionEntry) => (e.lastSeenAt ? Date.parse(e.lastSeenAt) : 0);
  out.down.sort((a, b) => ms(a) - ms(b));
  out.dormant.sort((a, b) => ms(b) - ms(a));
  return out;
}

/** A stable key for "which screens are offline right now" (refetch the verdict when it changes). */
export function offlineKey(screens: readonly ScreenRowLike[] | null | undefined): string {
  return (screens ?? [])
    .filter(isOfflineRow)
    .map((s) => s.id)
    .sort()
    .join(',');
}
