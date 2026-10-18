import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../realtime/redis.service';
import {
  LEDGER_DEDUP_MS,
  LEDGER_KIND_LIST,
  countsAsInterruption,
  isDrillRow,
  ledgerDedupKey,
  ledgerRow,
  summarizeLedger,
  type LedgerEventInput,
  type LedgerRowData,
  type LedgerSummary,
} from './screen-events';

/** Rows one bulk write inserts per statement. */
const BULK_CHUNK = 1_000;
/** Most rows one bulk write (a tenant-wide push, a district alert) may insert. */
export const LEDGER_BULK_MAX_ROWS = 10_000;
/** Newest rows the window read returns (the summary always covers the whole window). */
export const LEDGER_WINDOW_LIST_MAX = 200;
/** In-process dedup keys kept before expired ones are pruned. */
const MEMORY_PRUNE_AT = 5_000;

export interface ScreenLedgerEventView {
  id: string;
  at: string;
  kind: string;
  cause: string | null;
  source: string | null;
  sessionId: string | null;
  versionCode: number | null;
  /** Counts toward `summary.interruptions`. */
  interruption: boolean;
  /** An emergency drill row (left out of `interruptions`). */
  drill: boolean;
  detail: unknown;
}

export interface ScreenLedgerWindow {
  hours: number;
  since: string;
  summary: LedgerSummary;
  events: ScreenLedgerEventView[];
  /** More rows exist in the window than `events` lists (the summary still counts them all). */
  truncated: boolean;
}

/**
 * Writes and reads the interruption ledger (screen-events.ts has the
 * vocabulary and every rule). Two properties are the whole contract:
 *
 *   1. NOTHING HERE THROWS. `record` / `recordMany` swallow every failure and
 *      answer how many rows they wrote — a ledger row describes an action,
 *      it never decides one.
 *   2. A REPORTING LOOP CANNOT FLOOD A SCREEN. `record` claims the event's
 *      identity first — `${screen}:${kind}:${session or cause}` for 60 s by
 *      default, an identity key (a session, a process, a build) for a day — in
 *      Redis (`SET NX PX`: one winner across replicas), and in this process
 *      as well, so a Redis outage still leaves every replica bounded.
 *
 * `recordMany` is for ONE event that reaches many screens (a tenant-wide
 * push, a district alert): its rows carry the event's own id, so they skip
 * the per-row claim and go out as chunked createMany statements.
 */
@Injectable()
export class ScreenEventsService {
  private readonly logger = new Logger(ScreenEventsService.name);
  private readonly claimed = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** One event. True when its row was written. Never throws. */
  async record(input: LedgerEventInput, now: Date = new Date()): Promise<boolean> {
    try {
      const row = ledgerRow(input, now);
      if (!row) return false;
      const ttl = Math.max(1_000, Math.min(input.dedupMs ?? LEDGER_DEDUP_MS, 7 * 24 * 60 * 60_000));
      if (!(await this.claim(ledgerDedupKey(input), ttl, now.getTime()))) return false;
      await this.prisma.client.screenEvent.create({ data: row as any, select: { id: true } });
      return true;
    } catch (e) {
      this.logger.warn(`[screen-events] ${input?.kind ?? '?'} not recorded: ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  /** Several independent events, in order. Answers how many were written. Never throws. */
  async recordAll(inputs: ReadonlyArray<LedgerEventInput>, now: Date = new Date()): Promise<number> {
    let n = 0;
    for (const input of inputs) if (await this.record(input, now)) n++;
    return n;
  }

  /** One event on many screens (no per-row claim — the rows share the event's id). Never throws. */
  async recordMany(inputs: ReadonlyArray<LedgerEventInput>, now: Date = new Date()): Promise<number> {
    return writeLedgerRows(this.prisma, inputs, now, (msg) => this.logger.warn(msg));
  }

  /**
   * One screen's ledger over the last `hours`: the summary (exact, from one
   * grouped count and one drill count) and the newest rows.
   */
  async window(screenId: string, hours: number, nowMs: number = Date.now()): Promise<ScreenLedgerWindow> {
    const since = new Date(nowMs - hours * 60 * 60_000);
    const where = { screenId, kind: { in: LEDGER_KIND_LIST }, createdAt: { gte: since } };
    const db = this.prisma.client as any;
    const [groups, drillStarts, rows] = await Promise.all([
      db.screenEvent.groupBy({ by: ['kind', 'cause'], where, _count: { _all: true } }),
      db.screenEvent.count({
        where: { ...where, kind: 'emergency-start', detail: { path: ['drill'], equals: true } },
      }),
      db.screenEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LEDGER_WINDOW_LIST_MAX + 1,
        select: {
          id: true, kind: true, cause: true, source: true, detail: true,
          sessionId: true, versionCode: true, createdAt: true,
        },
      }),
    ]);
    const summary = summarizeLedger(
      (groups as any[]).map((g) => ({ kind: g.kind, cause: g.cause, count: g._count?._all ?? 0 })),
      Number(drillStarts) || 0,
    );
    const list = (rows as any[]).slice(0, LEDGER_WINDOW_LIST_MAX);
    return {
      hours,
      since: since.toISOString(),
      summary,
      truncated: (rows as any[]).length > LEDGER_WINDOW_LIST_MAX,
      events: list.map((r) => ({
        id: r.id,
        at: new Date(r.createdAt).toISOString(),
        kind: r.kind,
        cause: r.cause ?? null,
        source: r.source ?? null,
        sessionId: r.sessionId ?? null,
        versionCode: r.versionCode ?? null,
        interruption: countsAsInterruption(r),
        drill: isDrillRow(r),
        detail: r.detail ?? null,
      })),
    };
  }

  /** True when this event's identity is new inside its window. Redis first, this process always. */
  private async claim(key: string, ttlMs: number, nowMs: number): Promise<boolean> {
    const until = this.claimed.get(key);
    if (until !== undefined && until > nowMs) return false;
    const client = this.redis?.isConnected?.() ? this.redis.publisher : null;
    if (client) {
      try {
        const ok = await client.set(`venueos:screen-event:${key}`, '1', 'PX', ttlMs, 'NX');
        if (ok === null) {
          this.remember(key, nowMs + ttlMs, nowMs);
          return false;
        }
      } catch {
        /* Redis could not answer: this process decides, as it does with no Redis at all */
      }
    }
    this.remember(key, nowMs + ttlMs, nowMs);
    return true;
  }

  private remember(key: string, until: number, nowMs: number): void {
    if (this.claimed.size >= MEMORY_PRUNE_AT) {
      for (const [k, t] of this.claimed) if (t <= nowMs) this.claimed.delete(k);
      if (this.claimed.size >= MEMORY_PRUNE_AT) this.claimed.clear();
    }
    this.claimed.set(key, until);
  }
}

/**
 * The bulk write, usable without Nest (deployment-record.ts calls it with the
 * prisma it already holds). Chunked, capped at LEDGER_BULK_MAX_ROWS, and
 * never throws: a chunk that fails is logged and the rest still go.
 */
export async function writeLedgerRows(
  prisma: Pick<PrismaService, 'client'>,
  inputs: ReadonlyArray<LedgerEventInput>,
  now: Date = new Date(),
  warn: (msg: string) => void = (msg) => console.warn(msg),
): Promise<number> {
  let rows: LedgerRowData[];
  try {
    rows = inputs.slice(0, LEDGER_BULK_MAX_ROWS).map((i) => ledgerRow(i, now)).filter((r): r is LedgerRowData => !!r);
  } catch (e) {
    warn(`[screen-events] bulk rows not built: ${(e as Error)?.message ?? e}`);
    return 0;
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    try {
      const res = await prisma.client.screenEvent.createMany({ data: rows.slice(i, i + BULK_CHUNK) as any });
      written += typeof res?.count === 'number' ? res.count : 0;
    } catch (e) {
      warn(`[screen-events] ${rows[i]?.kind ?? '?'} bulk chunk not recorded: ${(e as Error)?.message ?? e}`);
    }
  }
  return written;
}
