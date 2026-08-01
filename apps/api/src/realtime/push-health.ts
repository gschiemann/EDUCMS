/**
 * Push-channel health stamp (2026-07-31 poll-only-dongle incident).
 *
 * A kiosk whose WS AND SSE tiers are dead (corporate proxy, WebView config)
 * still works — every life-safety flow has an HTTP polling backstop — but
 * push commands (refresh-web, instant all-clear delivery) silently no-op
 * for it, and nothing surfaced that. `Screen.lastPushConnectedAt` is the
 * server-visible truth: fresh (< ~10 min) means a live push channel exists
 * for the screen right now.
 *
 * Call sites: WS gateway AUTH_OK (forced) + HEARTBEAT (debounced), SSE
 * register (forced) + keepalive tick (debounced). All fire-and-forget —
 * a telemetry write must never break an auth handshake or a keepalive
 * sweep, so every failure path is swallowed.
 *
 * The debounce map is process-local; multi-replica just means each replica
 * debounces its own connections, which only makes stamps slightly MORE
 * frequent — never stale. The column is in SCREEN_TELEMETRY_ONLY_FIELDS so
 * these writes never bust the manifest hot cache.
 */

const lastStampAt = new Map<string, number>();
const STAMP_DEBOUNCE_MS = 60_000;
const MAX_TRACKED = 5_000;

export function stampPushConnected(
  prismaClient: any,
  screenId: string | undefined | null,
  // Authenticated tenant scope from the same verified context that produced
  // the screenId (gateway ctx / SSE client). Structurally tenant-scopes the
  // write (TEN-001 gate) — an unpaired/no-tenant channel has nothing to stamp.
  tenantId: string | undefined | null,
  opts?: { force?: boolean },
): void {
  if (!screenId || !tenantId) return;
  try {
    const now = Date.now();
    const prev = lastStampAt.get(screenId) ?? 0;
    if (!opts?.force && now - prev < STAMP_DEBOUNCE_MS) return;
    lastStampAt.set(screenId, now);
    if (lastStampAt.size > MAX_TRACKED) {
      const oldest = lastStampAt.keys().next().value;
      if (oldest !== undefined) lastStampAt.delete(oldest);
    }
    // updateMany + tenantId: tenant-scoped by construction, and a 0-row
    // match (screen deleted / rebound mid-flight) is a silent no-op.
    const p = prismaClient?.screen?.updateMany?.({
      where: { id: screenId, tenantId },
      data: { lastPushConnectedAt: new Date() },
    });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* telemetry must never break the caller */
  }
}

/** Test hook — reset the debounce state between cases. */
export function __resetPushHealthDebounce(): void {
  lastStampAt.clear();
}
