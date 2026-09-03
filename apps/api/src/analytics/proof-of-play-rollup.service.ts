import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';

/**
 * ProofOfPlayRollupService — hourly aggregate for the proof-of-play report.
 *
 * WHY (efficiency/scale audit 2026-09-02, finding L4): `ProofOfPlaySampler`
 * writes one row per ONLINE screen every 10 minutes. At 1,000 screens that is
 * 144,000 rows/day — ~13M inside the 90-day retention window, and every
 * report query aggregates across all of them. Retention alone cannot fix
 * that, because retention is the very thing that would delete the numbers a
 * customer-facing report still shows.
 *
 * WHAT: one row per (tenant, screen, playlist, hour) with a sample COUNT.
 * The report needs exactly three things — samples grouped by playlist,
 * samples grouped by screen, and the total — and all three are sums over
 * this table, so NO number the report shows today is lost or approximated.
 * The reduction is ~6× in rows (a screen normally shows one playlist for a
 * whole hour) and far more than that in bytes scanned per report.
 *
 * ── THE THREE INVARIANTS (do not weaken) ────────────────────────────────
 *
 * 1. ONLY COMPLETE HOURS ARE ROLLED UP. The current hour is still
 *    accumulating; aggregating it would freeze a partial count. The read
 *    path stitches `rollup for [windowStart, watermark)` to `raw for
 *    [watermark, now]`, so the two ranges are disjoint and their union is
 *    the whole window — the report is EXACT, not an estimate.
 *
 * 2. THE WATERMARK IS EXPLICIT AND TRANSACTIONAL. `playback_rollup_state`
 *    holds one row: the instant through which every hour has been fully
 *    aggregated. It advances in the SAME transaction that writes an hour's
 *    rows, so it can never point past a partially-written hour — including
 *    when a lease is lost or the pod dies mid-tick. It is a real row rather
 *    than `max(hour_start)` because an hour with zero samples (an idle
 *    fleet) writes no rows, and a derived watermark would stall there
 *    forever.
 *
 * 3. RAW RETENTION FOLLOWS THE WATERMARK, NEVER THE CLOCK ALONE. The raw
 *    purge cuts at `min(policy cutoff, watermark)` — see
 *    `ProofOfPlaySampler.purgeCutoff`. If this service is stopped, behind, or
 *    its migration has not been applied, the watermark does not move and raw
 *    rows are kept. Shortening `PROOF_OF_PLAY_RETENTION_DAYS` to 14 is safe
 *    only because of this interlock; do not remove it.
 *
 * Writes are idempotent: `ON CONFLICT … DO UPDATE SET samples =
 * EXCLUDED.samples` (assignment, never `+`), so re-running an hour after a
 * crash produces the same numbers.
 *
 * Env:
 *   PROOF_OF_PLAY_ROLLUP_DISABLED         "1" to skip (test / ops)
 *   PROOF_OF_PLAY_ROLLUP_INTERVAL_MS      default 600000 (10 min)
 *   PROOF_OF_PLAY_ROLLUP_MAX_HOURS        hours aggregated per tick, default 72
 *   PROOF_OF_PLAY_ROLLUP_RETENTION_DAYS   default 400 (covers the report's
 *                                         365-day maximum window; ≤0 disables)
 */

export const HOUR_MS = 3_600_000;

/** Raw-sample retention once the rollup exists. Clamped by the watermark. */
export const DEFAULT_RAW_RETENTION_DAYS = 14;
/** Pre-rollup retention — still the cutoff on installs with no aggregate yet. */
export const LEGACY_RAW_RETENTION_DAYS = 90;
/** Aggregate retention. 400d covers the report's 365-day maximum window. */
export const DEFAULT_ROLLUP_RETENTION_DAYS = 400;

const STATE_ROW_ID = 'singleton';

/** Floor a timestamp to the top of its UTC hour. */
export function hourFloor(ms: number): Date {
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS);
}

/**
 * The minimal Prisma surface this module uses. Declared structurally so the
 * helpers stay callable from the sampler and the controller (and from specs
 * with a hand-rolled stub) without pulling in the generated client type or
 * reaching for `any`.
 */
export interface RollupCapableClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $transaction<T>(fn: (tx: RollupCapableClient) => Promise<T>): Promise<T>;
}

/**
 * The instant through which every hour is fully aggregated, or null when
 * nothing has been rolled up yet (fresh install, or migration unapplied).
 *
 * Raw samples at or after this instant are NOT in the aggregate; samples
 * before it are. That single fact is what makes both the report stitch and
 * the retention interlock correct.
 *
 * Throws when the state table is missing — callers decide what that means
 * (the purge treats it as "nothing is rolled up", the report as "read raw").
 */
export async function rollupWatermark(client: RollupCapableClient): Promise<Date | null> {
  const rows = await client.$queryRawUnsafe<Array<{ rolled_through: Date | null }>>(
    'SELECT "rolled_through" FROM "playback_rollup_state" WHERE "id" = $1 LIMIT 1',
    STATE_ROW_ID,
  );
  const value = rows?.[0]?.rolled_through ?? null;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface RolledRow {
  tenant_id: string;
  screen_id: string;
  playlist_id: string;
  samples: number;
}

@Injectable()
export class ProofOfPlayRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProofOfPlayRollupService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;
  /**
   * Consecutive failed passes. A single failure is a pool blip; a run of them
   * is a broken rollup, and the only symptom otherwise is an aggregate that
   * quietly stays empty while the retention interlock holds raw data forever
   * (2026-09-03: that ran for 51 minutes in production on one warn line).
   */
  private consecutiveFailures = 0;
  static readonly FAILURE_ESCALATION = 3;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.PROOF_OF_PLAY_ROLLUP_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('ProofOfPlayRollupService disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.PROOF_OF_PLAY_ROLLUP_INTERVAL_MS) || 600_000;
    // 2 min after boot: late enough for the pool to warm, early enough that a
    // deploy which shortened raw retention starts building the aggregate the
    // purge is interlocked against before the first purge runs (90 s).
    this.firstRun = setTimeout(() => void this.tick(), 120_000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.firstRun.unref?.();
    this.timer.unref?.();
    this.logger.log(`ProofOfPlayRollupService starting (interval=${intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.firstRun) {
      clearTimeout(this.firstRun);
      this.firstRun = null;
    }
  }

  /**
   * One rollup pass. Public so ops and tests can drive it without the timer.
   * Returns how many hours were aggregated and how many rows were written.
   */
  async tick(now = Date.now()): Promise<{ hours: number; rows: number }> {
    if (this.running) return { hours: 0, rows: 0 }; // overlap guard
    const status = await leadThisTick(this.lease, LEASE.PROOF_OF_PLAY_ROLLUP);
    if (!status.leader) return { hours: 0, rows: 0 };
    this.running = true;
    try {
      const client = this.prisma.client as unknown as RollupCapableClient;
      const start = await this.startHour(client, now);
      if (!start) return { hours: 0, rows: 0 };

      const maxHours = Math.max(
        1,
        Math.floor(Number(process.env.PROOF_OF_PLAY_ROLLUP_MAX_HOURS) || 72),
      );
      // Never touch the hour still in progress (invariant 1).
      const lastCompleteHourStart = hourFloor(now).getTime() - HOUR_MS;

      let hours = 0;
      let rows = 0;
      for (let h = start.getTime(); h <= lastCompleteHourStart && hours < maxHours; h += HOUR_MS) {
        // A lost lease must not keep writing under someone else's term.
        // Idempotent writes make a raced hour harmless anyway (invariant 3
        // of the class comment) — this just stops the pass early and cleanly.
        if (this.lease && !this.lease.holdsFence(LEASE.PROOF_OF_PLAY_ROLLUP, status.fence)) {
          this.logger.warn('rollup stood down mid-pass — lease no longer held');
          break;
        }
        rows += await this.rollHour(client, new Date(h));
        hours += 1;
      }

      if (hours > 0) {
        this.logger.log(`proof-of-play rollup: aggregated ${hours} hour(s) into ${rows} row(s)`);
      }
      await this.purgeRollup(client, now);
      this.consecutiveFailures = 0;
      return { hours, rows };
    } catch (e) {
      // Best-effort, exactly like the sampler: a missing table (migration not
      // yet applied) or a pool blip must never crash the API. The purge
      // interlock means a failing rollup costs disk, never data.
      this.consecutiveFailures += 1;
      const detail = e instanceof Error ? e.message : String(e);
      if (this.consecutiveFailures >= ProofOfPlayRollupService.FAILURE_ESCALATION) {
        this.logger.error(
          `proof-of-play rollup has failed ${this.consecutiveFailures} passes in a row — ` +
            `the aggregate is not advancing and raw retention is pinned to the stale ` +
            `watermark: ${detail}`,
        );
      } else {
        this.logger.warn(`proof-of-play rollup failed: ${detail}`);
      }
      return { hours: 0, rows: 0 };
    } finally {
      this.running = false;
    }
  }

  /**
   * The first hour this pass should aggregate: the watermark when one exists,
   * otherwise the hour of the oldest raw sample. Returns null when there is
   * nothing to do at all.
   */
  private async startHour(client: RollupCapableClient, now: number): Promise<Date | null> {
    const watermark = await rollupWatermark(client);
    if (watermark) return hourFloor(watermark.getTime());

    const oldest = await client.$queryRawUnsafe<Array<{ oldest: Date | null }>>(
      'SELECT MIN("sampled_at") AS oldest FROM "playback_samples"',
    );
    const raw = oldest?.[0]?.oldest ?? null;
    if (!raw) {
      // No samples at all. Plant the watermark at the current hour so the
      // first real pass has a floor and never re-scans empty history.
      await this.setWatermark(client, hourFloor(now));
      return null;
    }
    const date = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : hourFloor(date.getTime());
  }

  /**
   * Aggregate exactly one complete hour and advance the watermark past it, in
   * ONE transaction (invariant 2). Returns the number of aggregate rows.
   */
  private async rollHour(client: RollupCapableClient, hourStart: Date): Promise<number> {
    const hourEnd = new Date(hourStart.getTime() + HOUR_MS);
    const grouped = await client.$queryRawUnsafe<RolledRow[]>(
      `
      SELECT "tenant_id", "screen_id", "playlist_id", COUNT(*)::int AS samples
        FROM "playback_samples"
       WHERE "sampled_at" >= $1 AND "sampled_at" < $2
       GROUP BY "tenant_id", "screen_id", "playlist_id"
      `,
      hourStart,
      hourEnd,
    );

    await client.$transaction(async (tx) => {
      // Chunked so a very large fleet cannot blow Postgres's parameter
      // ceiling. Still one transaction, so the hour is all-or-nothing and the
      // watermark below can never outrun a partial write.
      const CHUNK = 500;
      for (let i = 0; i < grouped.length; i += CHUNK) {
        const chunk = grouped.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const tuples = chunk.map((row, idx) => {
          const base = idx * 5;
          values.push(row.tenant_id, row.screen_id, row.playlist_id, hourStart, row.samples);
          // `id` is generated BY POSTGRES here, not by Prisma. The model's
          // `@default(uuid())` is a CLIENT-side default: it applies to
          // `prisma.playbackSampleHour.create(...)` and to nothing that goes
          // through `$executeRawUnsafe`, and the column carries no database
          // default. Omitting it made every rollup pass throw
          // `null value in column "id" violates not-null constraint`, which
          // the tick's catch turned into one warn line — so the aggregate
          // stayed empty for 51 minutes in production while every unit test
          // passed against a mocked client. Found by checking the table, not
          // the suite.
          return `(gen_random_uuid(), $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        });
        await tx.$executeRawUnsafe(
          `
          INSERT INTO "playback_sample_hours"
                 ("id", "tenant_id", "screen_id", "playlist_id", "hour_start", "samples")
          VALUES ${tuples.join(', ')}
          ON CONFLICT ("tenant_id", "screen_id", "playlist_id", "hour_start")
          DO UPDATE SET "samples" = EXCLUDED."samples"
          `,
          ...values,
        );
      }
      await this.setWatermark(tx, hourEnd);
    });

    return grouped.length;
  }

  /** Upsert the single watermark row. */
  private async setWatermark(client: RollupCapableClient, at: Date): Promise<void> {
    await client.$executeRawUnsafe(
      `
      INSERT INTO "playback_rollup_state" ("id", "rolled_through", "updated_at")
      VALUES ($1, $2, NOW())
      ON CONFLICT ("id")
      DO UPDATE SET "rolled_through" = EXCLUDED."rolled_through", "updated_at" = NOW()
      `,
      STATE_ROW_ID,
      at,
    );
  }

  /** Aggregate retention. Small table, cheap indexed delete, never throws. */
  private async purgeRollup(client: RollupCapableClient, now: number): Promise<void> {
    const raw = process.env.PROOF_OF_PLAY_ROLLUP_RETENTION_DAYS;
    const days = raw === undefined ? DEFAULT_ROLLUP_RETENTION_DAYS : Number(raw);
    if (!Number.isFinite(days) || days <= 0) return;
    const cutoff = new Date(now - days * 86_400_000);
    try {
      const deleted = await client.$executeRawUnsafe(
        'DELETE FROM "playback_sample_hours" WHERE "hour_start" < $1',
        cutoff,
      );
      if (deleted > 0) {
        this.logger.log(`proof-of-play rollup retention: purged ${deleted} hour row(s)`);
      }
    } catch (e) {
      this.logger.warn(
        `proof-of-play rollup retention failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
