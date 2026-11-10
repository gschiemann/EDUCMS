import { z } from 'zod';

/**
 * play-log.policy.ts — the pure half of the device play log (2026-11-09,
 * player stability gap 7). No Nest, no Prisma, no network: the controller
 * owns the I/O, this owns every decision, and each one is a unit test.
 *
 * WHAT A ROW IS. One playlist item the web player actually put on the glass:
 * the item / playlist / asset ids, when it started on the player's
 * server-corrected clock, how long it was shown (measured on the player's
 * monotonic clock), and whether it ran to its end. Ids and times only —
 * never content text, never anything a person typed.
 *
 * WHAT IS NOT A ROW. Emergency alerts and drills. The audit log is the record
 * of truth for an alert (who, from where, override id), with the interruption
 * ledger (`screen_events` emergency-start / -clear) and the paint proof beside
 * it. A content item an alert cut short IS a row, with `completed: false`.
 */

/** Hard ceiling on the JSON body, in bytes. Mirrored by the route-scoped
 *  parser in main.ts; this is the in-handler backstop. 200 entries of ~170
 *  bytes is ~34 KB. */
export const PLAY_LOG_MAX_BODY_BYTES = 64 * 1024;

/** Entries one batch may carry. The player sends at most PLAY_LOG_BATCH (200). */
export const PLAY_LOG_MAX_ENTRIES = 200;

/** An entry older than this is refused (counted, not stored). The player's
 *  durable queue holds ~2,000 entries, which an offline week can outrun. */
export const PLAY_LOG_MAX_AGE_MS = 14 * 86_400_000;

/** An entry that starts further in the future than this is refused: the
 *  player's clock is server-corrected, so this is a broken clock, not skew. */
export const PLAY_LOG_MAX_FUTURE_MS = 5 * 60_000;

/** A single entry's shown duration is capped at one day. The player splits a
 *  long-running item into 15-minute segments, so a real one is far shorter. */
export const PLAY_LOG_MAX_SHOWN_MS = 86_400_000;

/** One accepted batch per screen per this spacing. The player sends every
 *  10 minutes and drains a backlog every 90 s, so this is never reached by a
 *  healthy screen; it bounds a looping or hostile one with zero DB work. */
export const PLAY_LOG_MIN_ACCEPT_INTERVAL_MS = 20_000;

/** How long the player stands down when the kill switch is on. */
export const PLAY_LOG_STOP_RETRY_MS = 6 * 3_600_000;

/** Ids are opaque device-reported strings: bounded, and limited to the
 *  characters our ids (uuid / cuid / manifest keys) actually use. */
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

export const playLogEntrySchema = z.strictObject({
  /** Start, ms since epoch, on the player's server-corrected clock. */
  startedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  shownMs: z.number().int().min(0).max(PLAY_LOG_MAX_SHOWN_MS),
  completed: z.boolean(),
  playlistId: idSchema,
  itemId: idSchema,
  assetId: idSchema.nullable(),
});

export const playLogBatchSchema = z.strictObject({
  entries: z.array(playLogEntrySchema).max(PLAY_LOG_MAX_ENTRIES),
});

export type PlayLogEntryInput = z.infer<typeof playLogEntrySchema>;

export interface PlayLogRow {
  screenId: string;
  tenantId: string;
  startedAt: Date;
  playlistItemId: string;
  playlistId: string;
  assetId: string | null;
  shownMs: number;
  completed: boolean;
}

/** The kill switch: `PLAY_LOG_DISABLED=1` → accept-and-discard + tell the
 *  player to stand down. Anything else (unset, 0, typo) = the log runs. */
export function playLogDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAY_LOG_DISABLED === '1';
}

/**
 * Turn a validated batch into rows. The screen and tenant come from the
 * device credential's LIVE screen row — never from the body, which carries no
 * such field (the strict schema refuses one). Entries outside the time window
 * are counted as rejected; duplicates inside the batch collapse to one (the
 * database's ON CONFLICT handles duplicates across batches).
 */
export function toPlayLogRows(
  entries: PlayLogEntryInput[],
  identity: { screenId: string; tenantId: string },
  nowMs: number,
): { rows: PlayLogRow[]; rejected: number } {
  const rows: PlayLogRow[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const e of entries) {
    if (e.startedAt < nowMs - PLAY_LOG_MAX_AGE_MS || e.startedAt > nowMs + PLAY_LOG_MAX_FUTURE_MS) {
      rejected += 1;
      continue;
    }
    const key = `${e.startedAt}|${e.itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      screenId: identity.screenId,
      tenantId: identity.tenantId,
      startedAt: new Date(e.startedAt),
      playlistItemId: e.itemId,
      playlistId: e.playlistId,
      assetId: e.assetId,
      shownMs: e.shownMs,
      completed: e.completed,
    });
  }
  return { rows, rejected };
}

/** Per-screen accept floor (in-memory, per replica — same shape as the
 *  refresh-ack floor in telemetry.controller.ts). */
export class PlayLogAcceptFloor {
  private readonly last = new Map<string, number>();
  constructor(private readonly intervalMs = PLAY_LOG_MIN_ACCEPT_INTERVAL_MS, private readonly maxKeys = 50_000) {}

  accept(screenId: string, nowMs: number): boolean {
    const prev = this.last.get(screenId);
    if (prev !== undefined && nowMs - prev < this.intervalMs) return false;
    this.last.delete(screenId);
    this.last.set(screenId, nowMs);
    if (this.last.size > this.maxKeys) {
      const oldest = this.last.keys().next().value;
      if (oldest !== undefined) this.last.delete(oldest);
    }
    return true;
  }
}

// ── Read side ────────────────────────────────────────────────────────────

/** Longest range one read may cover. */
export const PLAY_LOG_READ_MAX_RANGE_MS = 31 * 86_400_000;
/** Rows one JSON read returns; one CSV export returns up to PLAY_LOG_CSV_MAX. */
export const PLAY_LOG_READ_DEFAULT_LIMIT = 1_000;
export const PLAY_LOG_READ_MAX_LIMIT = 5_000;
export const PLAY_LOG_CSV_MAX = 50_000;

export type PlayLogQuery =
  | {
      ok: true;
      screenId: string | null;
      assetId: string | null;
      from: Date;
      to: Date;
      limit: number;
      csv: boolean;
    }
  | { ok: false; code: string; message: string };

function parseTime(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate a read. A screen or an asset is required (a whole-tenant scan is
 * what the proof-of-play report is for); the range defaults to the last 24 h
 * and may not exceed 31 days.
 */
export function parsePlayLogQuery(
  q: { screenId?: string; assetId?: string; from?: string; to?: string; limit?: string; format?: string },
  nowMs: number,
): PlayLogQuery {
  const id = (v: string | undefined) => (v && idSchema.safeParse(v).success ? v : null);
  const screenId = id(q.screenId);
  const assetId = id(q.assetId);
  if ((q.screenId && !screenId) || (q.assetId && !assetId)) {
    return { ok: false, code: 'PLAY_LOG_BAD_ID', message: 'screenId / assetId is not a valid id.' };
  }
  if (!screenId && !assetId) {
    return { ok: false, code: 'PLAY_LOG_SCOPE_REQUIRED', message: 'Pass screenId or assetId.' };
  }
  const to = parseTime(q.to) ?? nowMs;
  const from = parseTime(q.from) ?? to - 86_400_000;
  if ((q.from && parseTime(q.from) === null) || (q.to && parseTime(q.to) === null)) {
    return { ok: false, code: 'PLAY_LOG_BAD_TIME', message: 'from / to must be an ISO time or epoch ms.' };
  }
  if (from >= to) return { ok: false, code: 'PLAY_LOG_BAD_RANGE', message: 'from must be before to.' };
  if (to - from > PLAY_LOG_READ_MAX_RANGE_MS) {
    return { ok: false, code: 'PLAY_LOG_RANGE_TOO_LONG', message: 'The range may cover at most 31 days.' };
  }
  const csv = q.format === 'csv';
  const max = csv ? PLAY_LOG_CSV_MAX : PLAY_LOG_READ_MAX_LIMIT;
  const asked = parseInt(q.limit || '', 10);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, max) : csv ? max : PLAY_LOG_READ_DEFAULT_LIMIT;
  return { ok: true, screenId, assetId, from: new Date(from), to: new Date(to), limit, csv };
}

// ── Retention ────────────────────────────────────────────────────────────

export const DEFAULT_PLAY_LOG_RETENTION_DAYS = 30;

/** The cutoff for the retention sweep, or null when retention is disabled
 *  (`PLAY_LOG_RETENTION_DAYS` ≤ 0 or not a number). */
export function playLogRetentionCutoff(env: NodeJS.ProcessEnv, nowMs: number): Date | null {
  const raw = env.PLAY_LOG_RETENTION_DAYS;
  const days = raw === undefined || raw === '' ? DEFAULT_PLAY_LOG_RETENTION_DAYS : Number(raw);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(nowMs - days * 86_400_000);
}
