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
 *
 * ── P0-7 finding #3 (2026-09-05): COALESCED, because a restart is a herd ──
 *
 * Measured: an API restart under 1,000 screens produced 951 WS
 * re-authentications inside ~20 s, and each one called this helper with
 * `force: true`. Forced or not makes no difference on a cold process — the
 * debounce map starts empty — so that was 951 SEPARATE write transactions
 * against `screens`, on a `connection_limit=10` pool, in the same seconds as
 * 1,607 emergency-revision polls and 1,198 manifest fetches. 31 % of all
 * requests failed in that window.
 *
 * The write is now COALESCED: stamps accumulate for up to `FLUSH_INTERVAL_MS`
 * and flush as ONE `updateMany` per tenant. A 1,000-screen / 40-tenant fleet
 * reconnecting turns 951 write transactions into ~40. The signal is unchanged
 * — `lastPushConnectedAt` is graded at ~10-minute freshness, so a sub-second
 * batching delay is invisible to every reader — and the write stays
 * TENANT-SCOPED BY CONSTRUCTION (TEN-001): the batch is grouped by tenant and
 * each `updateMany` still carries its `tenantId` predicate, so a screen can
 * only ever be stamped inside the tenant the caller was authenticated for.
 */

/** Debounce window for non-forced callers (HEARTBEAT, SSE keepalive). */
const STAMP_DEBOUNCE_MS = 60_000;
/** How long a stamp may wait to be batched with its neighbours. */
const FLUSH_INTERVAL_MS = 1_000;
const MAX_TRACKED = 5_000;
/**
 * Hard bound on the pending batch. Above this the batch flushes immediately
 * rather than growing — a stamp must never be able to hold unbounded state,
 * and a 1,000-screen fleet reconnect is exactly the shape that would try.
 */
const MAX_PENDING = 2_000;

const lastStampAt = new Map<string, number>();

/** tenantId → the screen ids waiting to be stamped for that tenant. */
const pending = new Map<string, Set<string>>();
let pendingCount = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** The client to flush with. Every caller passes the same singleton. */
let flushClient: any = null;

function pendingSize(): number {
  return pendingCount;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, FLUSH_INTERVAL_MS);
  // Never hold the process open for a telemetry write.
  (flushTimer as any).unref?.();
}

async function flushPending(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.entries()];
  pending.clear();
  pendingCount = 0;
  const client = flushClient;
  if (!client) return;
  const at = new Date();
  for (const [tenantId, ids] of batch) {
    try {
      // updateMany + tenantId: tenant-scoped by construction, and a 0-row
      // match (screen deleted / rebound mid-flight) is a silent no-op.
      const p = client?.screen?.updateMany?.({
        where: { tenantId, id: { in: [...ids] } },
        data: { lastPushConnectedAt: at },
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* telemetry must never break the caller */
    }
  }
}

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

    flushClient = prismaClient;
    let ids = pending.get(tenantId);
    if (!ids) {
      ids = new Set();
      pending.set(tenantId, ids);
    }
    if (!ids.has(screenId)) {
      ids.add(screenId);
      pendingCount += 1;
    }
    if (pendingSize() >= MAX_PENDING) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      void flushPending();
      return;
    }
    scheduleFlush();
  } catch {
    /* telemetry must never break the caller */
  }
}

/** Test hook — flush the pending batch synchronously. */
export async function __flushPushHealthNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushPending();
}

/** Test hook — reset the debounce state between cases. */
export function __resetPushHealthDebounce(): void {
  lastStampAt.clear();
  pending.clear();
  pendingCount = 0;
  flushClient = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
