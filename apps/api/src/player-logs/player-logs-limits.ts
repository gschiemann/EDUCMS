/**
 * How much a device's log upload may add to the IMMUTABLE audit table
 * (2026-10-03), and how a repeated upload of the same rotating log is told
 * apart from a new event.
 *
 * Before: up to 32 recovery rows per upload, each preceded by a
 * `details LIKE '%…%'` scan over every recovery row in the tenant (the only
 * index is `(tenantId, action)`), at a throttle of 6 uploads/minute — up to
 * ~192 rows and 192 table scans per device per minute. Harmless only because
 * no upload had ever been parsed (the text body parser was missing).
 *
 * Now:
 *   - Dedupe is a Redis `SET key NX EX` per event: one winner across
 *     concurrent uploads and replicas, no database read at all. Redis
 *     unavailable → the event counts as NOT seen (never a throw, never a
 *     dropped upload; the per-hour cap below still bounds the result).
 *   - At most MAX_AUDIT_ROWS_PER_UPLOAD rows per upload.
 *   - At most MAX_AUDIT_ROWS_PER_SCREEN_HOUR rows per screen per clock hour,
 *     counted in Redis (a tiny per-screen-hour counter), or in this process
 *     while Redis is unavailable so an outage cannot lift the cap.
 */

/** Rows one upload may write (recovery events plus a crash record). */
export const MAX_AUDIT_ROWS_PER_UPLOAD = 8;

/** Rows one screen may write per clock hour, across all uploads and replicas. */
export const MAX_AUDIT_ROWS_PER_SCREEN_HOUR = 24;

/**
 * How long an uploaded recovery event stays "seen". The APK uploads the last
 * 2 000 lines of a rotating log, so a marker can ride along in uploads for
 * days on a quiet screen; 30 days outlasts that comfortably. A key is one
 * short string per distinct event, and distinct events are rare.
 */
export const RECOVERY_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const HOUR_MS = 60 * 60 * 1000;
/** A bucket key outlives its hour, then expires on its own. */
const HOUR_KEY_TTL_SECONDS = 2 * 60 * 60;
/** In-process fallback entries kept before past hours are pruned. */
const MEMORY_PRUNE_AT = 5_000;

type ExecResult = Array<[Error | null, unknown]> | null;

interface DiagnosticsPipeline {
  incrby(key: string, increment: number): DiagnosticsPipeline;
  expire(key: string, seconds: number): DiagnosticsPipeline;
  exec(): Promise<ExecResult>;
}

/** The slice of ioredis this uses. */
export interface DiagnosticsRedis {
  status?: string;
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    seconds: number,
    condition: 'NX',
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  decrby(key: string, decrement: number): Promise<number>;
  multi(): DiagnosticsPipeline;
}

export function recoverySeenKey(
  tenantId: string,
  screenId: string,
  eventId: string,
): string {
  return `player-logs:seen:${tenantId}:${screenId}:${eventId}`;
}

export class DiagnosticsLimiter {
  private readonly memoryHours = new Map<string, number>();

  constructor(
    private readonly redis: () => DiagnosticsRedis | null,
    private readonly now: () => number = Date.now,
  ) {}

  private client(): DiagnosticsRedis | null {
    try {
      const client = this.redis();
      return client && client.status === 'ready' ? client : null;
    } catch {
      return null;
    }
  }

  /**
   * Claim an event as recorded. True when it is new — or when Redis cannot
   * answer (treated as not seen; the hourly cap still bounds the outcome).
   */
  async claimNew(key: string): Promise<boolean> {
    const client = this.client();
    if (!client) return true;
    try {
      const result = await client.set(
        key,
        '1',
        'EX',
        RECOVERY_SEEN_TTL_SECONDS,
        'NX',
      );
      return result !== null && result !== undefined;
    } catch {
      return true;
    }
  }

  /** Give a claim back (its row was not written). Best-effort, never throws. */
  async release(key: string): Promise<void> {
    const client = this.client();
    if (!client) return;
    try {
      await client.del(key);
    } catch {
      /* the claim expires on its own */
    }
  }

  /**
   * Reserve up to `wanted` rows of this screen's budget for the current
   * clock hour; returns how many were granted (0…wanted). Never throws.
   * Rows reserved and then not written are not handed back: a failure errs
   * toward fewer audit rows, never more.
   */
  async reserve(screenId: string, wanted: number): Promise<number> {
    if (wanted <= 0) return 0;
    const bucket = Math.floor(this.now() / HOUR_MS);
    const key = `player-logs:rows:${screenId}:${bucket}`;
    const client = this.client();
    if (client) {
      try {
        const results = await client
          .multi()
          .incrby(key, wanted)
          .expire(key, HOUR_KEY_TTL_SECONDS)
          .exec();
        const [incrError, total] = results?.[0] ?? [
          new Error('no reply'),
          null,
        ];
        if (!incrError && typeof total === 'number') {
          // INCRBY is atomic, so concurrent reservations each see their own
          // total and together never grant more than the cap.
          const granted = Math.max(
            0,
            Math.min(wanted, MAX_AUDIT_ROWS_PER_SCREEN_HOUR - (total - wanted)),
          );
          if (granted < wanted) {
            await client.decrby(key, wanted - granted).catch(() => undefined);
          }
          return granted;
        }
      } catch {
        /* fall through to this process's own count */
      }
    }
    return this.reserveInMemory(`${screenId}:${bucket}`, bucket, wanted);
  }

  private reserveInMemory(key: string, bucket: number, wanted: number): number {
    if (this.memoryHours.size > MEMORY_PRUNE_AT) {
      for (const k of this.memoryHours.keys()) {
        if (Number(k.slice(k.lastIndexOf(':') + 1)) < bucket) {
          this.memoryHours.delete(k);
        }
      }
    }
    const used = this.memoryHours.get(key) ?? 0;
    const granted = Math.max(
      0,
      Math.min(wanted, MAX_AUDIT_ROWS_PER_SCREEN_HOUR - used),
    );
    this.memoryHours.set(key, used + granted);
    return granted;
  }
}
