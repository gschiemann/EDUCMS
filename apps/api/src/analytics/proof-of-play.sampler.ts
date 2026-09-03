import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import {
  DEFAULT_RAW_RETENTION_DAYS,
  LEGACY_RAW_RETENTION_DAYS,
  RollupCapableClient,
  rollupWatermark,
} from './proof-of-play-rollup.service';

/**
 * ProofOfPlaySampler — proof-of-play analytics.
 *
 * Every ~10 minutes it snapshots what every ONLINE screen is
 * effectively showing: for each online screen we resolve the active
 * schedule (the highest-priority schedule whose date window contains
 * "now", screen-pinned beating group-pinned on a tie) and write one
 * PlaybackSample row { tenantId, screenId, playlistId }.
 *
 * The dashboard aggregates these into display-time reports — "playlist
 * X was live on N screens for M hours; sponsor asset A had M hours of
 * display." Each sample represents one interval (default 10 min) of
 * that playlist being live on that screen.
 *
 * This is a SAMPLING design (not a per-frame player beacon): it needs
 * ZERO player-side changes and never touches the load-bearing manifest
 * or render path. Accuracy is interval-grained — the industry norm for
 * proof-of-display reporting.
 *
 * Fully isolated + best-effort: any failure here (a pool blip, or even
 * a missing playback_samples table before the migration is applied) is
 * caught and logged — nothing else in the API is affected.
 *
 * Env:
 *   PROOF_OF_PLAY_SAMPLE_INTERVAL_MS  default 600000 (10 min)
 *   PROOF_OF_PLAY_DISABLED            set to "1" to skip (test / ops)
 *
 * v1 LIMITATION: a schedule's day-of-week / time-of-day window is not
 * yet applied here — only its date window (startTime/endTime) and
 * isActive flag. An always-on estimate is used; day/time refinement is
 * a tracked follow-up.
 */
@Injectable()
export class ProofOfPlaySampler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProofOfPlaySampler.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;
  private firstPurge: NodeJS.Timeout | null = null;
  private running = false;
  private purging = false;

  /** A screen counts as "online" if it pinged within this window. */
  private readonly ONLINE_WINDOW_MS = 6 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit() {
    if (process.env.PROOF_OF_PLAY_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('ProofOfPlaySampler disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.PROOF_OF_PLAY_SAMPLE_INTERVAL_MS) || 600_000;
    this.logger.log(`ProofOfPlaySampler starting (interval=${intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // First pass ~30s after boot — long enough for the DB pool to
    // warm, then a deploy starts sampling right away instead of
    // losing a whole interval (and the feature is testable in seconds
    // once the migration is applied).
    this.firstRun = setTimeout(() => void this.tick(), 30_000);
    // Retention sweep (efficiency audit 2026-07-20): once a day + once
    // shortly after boot, purge samples older than the retention window
    // so the table stops growing forever (it had reached 38% of the DB
    // with no reader). 90s boot delay keeps the first sweep off the
    // boot-critical path.
    this.purgeTimer = setInterval(() => void this.purgeTick(), 24 * 3_600_000);
    this.firstPurge = setTimeout(() => void this.purgeTick(), 90_000);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
    this.firstRun.unref?.();
    this.purgeTimer.unref?.();
    this.firstPurge.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.firstRun) {
      clearTimeout(this.firstRun);
      this.firstRun = null;
    }
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
    if (this.firstPurge) {
      clearTimeout(this.firstPurge);
      this.firstPurge = null;
    }
  }

  /**
   * Nightly retention purge, `PROOF_OF_PLAY_RETENTION_DAYS`; ≤0 disables.
   *
   * The default moved from 90 days to 14 when the hourly rollup landed
   * (`proof-of-play-rollup.service.ts`), but ONLY where the rollup is
   * actually running: see `purgeCutoff`, which clamps the cut to the rollup
   * watermark and keeps the old 90-day default on any install with no
   * aggregate. An explicitly-set value is always honoured — that is the
   * operator's call, not ours.
   *
   * Leader-leased (`proof-of-play:purge`) so only one replica sweeps, AND
   * still wrapped in the pre-existing pg_try_advisory_xact_lock, which is now
   * the backstop for DEGRADED lease mode (Redis down → every replica assumes
   * leadership). The advisory lock is xact-scoped (NOT session-scoped)
   * because session advisory locks are unreliable through pgBouncer
   * transaction pooling: the unlock can land on a different pooled connection
   * and strand the lock. The xact lock auto-releases at commit.
   */
  async purgeTick(): Promise<number> {
    if (this.purging) return 0;
    const status = await leadThisTick(this.lease, LEASE.PROOF_OF_PLAY_PURGE);
    if (!status.leader) return 0;
    this.purging = true;
    try {
      const configured = process.env.PROOF_OF_PLAY_RETENTION_DAYS;
      const days = configured === undefined ? DEFAULT_RAW_RETENTION_DAYS : Number(configured);
      if (!Number.isFinite(days) || days <= 0) return 0;
      const cutoff = await this.purgeCutoff(days, configured !== undefined);
      if (!cutoff) return 0;
      const deleted = await this.prisma.client.$transaction(async (tx: any) => {
        const rows: Array<{ locked: boolean }> =
          await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(424302) AS locked`;
        if (!rows?.[0]?.locked) return -1; // another replica is sweeping
        const res = await tx.playbackSample.deleteMany({
          where: { sampledAt: { lt: cutoff } },
        });
        return res.count as number;
      });
      if (deleted > 0) {
        this.logger.log(
          `proof-of-play retention: purged ${deleted} sample(s) older than ` +
            `${cutoff.toISOString()} (policy ${days}d, clamped to the rollup watermark)`,
        );

      }
      return Math.max(0, deleted);
    } catch (e: any) {
      // Best-effort — a missing table or pool blip must never crash the API.
      this.logger.warn(`proof-of-play retention purge failed: ${e?.message ?? e}`);
      return 0;
    } finally {
      this.purging = false;
    }
  }

  /**
   * Where the raw purge is allowed to cut — the SAFETY INTERLOCK for the
   * shortened retention window.
   *
   * Proof-of-play is a customer-facing reporting artifact: a purged raw row
   * whose hour was never rolled up is a number that silently disappears from
   * a report. Two rules therefore govern the cut:
   *
   *   - WITH an aggregate: cut at `min(policy cutoff, rollup watermark)`. A
   *     rollup that is stopped, behind, or unmigrated holds the watermark
   *     still, so raw rows are simply KEPT. Only an aggregated hour's raw
   *     detail is deletable.
   *   - WITHOUT an aggregate: the shortened DEFAULT does not apply — an
   *     install that has never run the rollup keeps the pre-rollup 90 days,
   *     because dropping to 14 would erase 76 days of reportable detail with
   *     nothing standing in for it. An EXPLICIT
   *     `PROOF_OF_PLAY_RETENTION_DAYS` is still honoured exactly: that is the
   *     operator's decision and it behaves as it always has.
   *
   * Returns null when nothing may be purged at all.
   */
  private async purgeCutoff(days: number, explicit: boolean): Promise<Date | null> {
    let watermark: Date | null = null;
    try {
      watermark = await rollupWatermark(
        this.prisma.client as unknown as RollupCapableClient,
      );
    } catch {
      // Rollup table missing / unreadable → treat as "nothing rolled up".
      watermark = null;
    }
    if (!watermark) {
      const effectiveDays = explicit ? days : LEGACY_RAW_RETENTION_DAYS;
      return new Date(Date.now() - effectiveDays * 86_400_000);
    }
    const policyCutoff = new Date(Date.now() - days * 86_400_000);
    return policyCutoff < watermark ? policyCutoff : watermark;
  }

  /** One sampling pass — snapshot every online screen's active playlist. */
  private async tick() {
    if (this.running) return; // overlap guard
    const status = await leadThisTick(this.lease, LEASE.PROOF_OF_PLAY_SAMPLE);
    if (!status.leader) return;
    this.running = true;
    try {
      const now = new Date();
      const onlineSince = new Date(now.getTime() - this.ONLINE_WINDOW_MS);

      // Two queries total, then resolve in memory — cheap at fleet scale.
      const [screens, schedules] = await Promise.all([
        this.prisma.client.screen.findMany({
          where: {
            tenantId: { not: null },
            pairedAt: { not: null },
            // Both-sided (2026-08-15): seeded demo screens carry FUTURE-DATED
            // lastPingAt so they look ONLINE in demos. Open-ended `gte`
            // counted those 34 fakes as live and fabricated proof-of-play
            // samples for screens that do not exist. A future ping is not a
            // heartbeat.
            lastPingAt: { gte: onlineSince, lte: now },
          },
          select: { id: true, tenantId: true, screenGroupId: true },
        }),
        this.prisma.client.schedule.findMany({
          where: {
            isActive: true,
            startTime: { lte: now },
            OR: [{ endTime: null }, { endTime: { gte: now } }],
          },
          select: {
            tenantId: true,
            playlistId: true,
            screenId: true,
            screenGroupId: true,
            priority: true,
          },
        }),
      ]);

      if (screens.length === 0 || schedules.length === 0) return;

      // Audit P2 (O(n²)): bucket schedules by tenant ONCE so each screen
      // scans only its own tenant's schedules. The old nested loop was
      // O(screens × ALL schedules across ALL tenants) — 10k×10k = 100M
      // iterations every 10 min. Now it's O(screens × schedules-in-that-tenant).
      const schedulesByTenant = new Map<string, typeof schedules>();
      for (const s of schedules) {
        if (!s.tenantId) continue;
        const arr = schedulesByTenant.get(s.tenantId);
        if (arr) arr.push(s);
        else schedulesByTenant.set(s.tenantId, [s]);
      }

      // Resolve each online screen's effective playlist — the
      // highest-priority schedule targeting the screen directly or via
      // its group. Screens with no active schedule are simply skipped.
      const rows: Array<{ tenantId: string; screenId: string; playlistId: string }> = [];
      for (const screen of screens) {
        if (!screen.tenantId) continue;
        const tenantSchedules = schedulesByTenant.get(screen.tenantId);
        if (!tenantSchedules) continue;
        let best: { playlistId: string; rank: number } | null = null;
        for (const s of tenantSchedules) {
          const matchesScreen = !!s.screenId && s.screenId === screen.id;
          const matchesGroup =
            !!s.screenGroupId &&
            !!screen.screenGroupId &&
            s.screenGroupId === screen.screenGroupId;
          if (!matchesScreen && !matchesGroup) continue;
          // A schedule pinned to the screen itself outranks a group
          // schedule at equal priority.
          const rank = s.priority * 2 + (matchesScreen ? 1 : 0);
          if (!best || rank > best.rank) {
            best = { playlistId: s.playlistId, rank };
          }
        }
        if (best) {
          rows.push({
            tenantId: screen.tenantId,
            screenId: screen.id,
            playlistId: best.playlistId,
          });
        }
      }

      if (rows.length > 0) {
        // Replica guard (efficiency audit 2026-07-20): every replica runs
        // this setInterval, so without a lock a 2-replica deploy would
        // silently DOUBLE-COUNT every sample. xact-scoped advisory lock
        // (pgBouncer-safe — see purgeTick) makes same-instant ticks
        // single-writer; interval drift between replicas is inherent
        // cadence jitter and acceptable for an interval-grained estimate.
        const wrote = await this.prisma.client.$transaction(async (tx: any) => {
          const locked: Array<{ locked: boolean }> =
            await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(424301) AS locked`;
          if (!locked?.[0]?.locked) return false;
          await tx.playbackSample.createMany({
            data: rows.map((r) => ({ ...r, sampledAt: now })),
          });
          return true;
        });
        if (wrote) {
          this.logger.log(`proof-of-play: wrote ${rows.length} playback sample(s)`);
        }
      }
    } catch (e: any) {
      // Best-effort — a missing table (migration not yet applied) or a
      // pool blip must never crash the API. Log and move on.
      this.logger.warn(`proof-of-play sampling failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
