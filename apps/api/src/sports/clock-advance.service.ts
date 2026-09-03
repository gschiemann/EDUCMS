import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { SportsService } from './sports.service';
import { consumeClockSweepWake } from './clock-wake';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';

/**
 * VenueOS Sports — automatic game-clock advance.
 *
 * A running game clock that hits 0:00 (countdown) or reaches the
 * segment length (count-up) should roll the scoreboard to the next
 * quarter / period on its own — the operator shouldn't have to babysit
 * it. The server never ticks the clock (it stores an anchor), so a
 * lightweight 1s sweep checks every LIVE game with a running clock and
 * advances the expired ones via SportsService.autoAdvanceExpiredClocks.
 *
 * Isolated + best-effort: the query is tiny (only LIVE, clock-running
 * games), it has an overlap guard, and any failure is caught and
 * logged — nothing else in the API is affected.
 *
 * Env:
 *   CLOCK_ADVANCE_INTERVAL_MS  default 1000 (1s)
 *   CLOCK_ADVANCE_DISABLED     set to "1" to skip (test / ops)
 */
@Injectable()
export class ClockAdvanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockAdvanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // Idle-skip (efficiency audit 2026-07-01 #3): when the last sweep found
  // ZERO live+running games, skip the DB query for the next N ticks (30s at
  // the default 1s interval) instead of hitting Postgres 86,400×/day on an
  // idle fleet. A clock-start mutation calls wakeClockSweep() to restore the
  // 1s cadence immediately; every other path self-corrects within one idle
  // window — segment lengths are minutes, so a ≤30s late first-detection
  // cannot miss an expiry that matters.
  private idleTicksLeft = 0;
  private static readonly IDLE_SWEEP_EVERY_TICKS = 30;

  constructor(
    private readonly sports: SportsService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit() {
    if (process.env.CLOCK_ADVANCE_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('ClockAdvanceService disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.CLOCK_ADVANCE_INTERVAL_MS) || 1000;
    this.logger.log(`ClockAdvanceService starting (interval=${intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Leader lease TTL for this worker — deliberately shorter than the 30 s
   * default. This is the one leased worker where failover latency is
   * user-visible in a live venue: if the leader dies mid-game, nobody rolls
   * the quarter until another replica takes the lease. 15 s bounds that; the
   * sweep itself is a tiny indexed query, so the extra heartbeat traffic is
   * a fair trade.
   */
  private static readonly LEASE_TTL_MS = 15_000;

  private async tick() {
    if (this.running) return; // overlap guard
    // Leader-leased (2026-09-02 multi-replica wave): autoAdvanceExpiredClocks
    // is a read-then-write on the game row with no compare-and-swap, and on
    // every expiry it records a HORN cue. Two replicas ticking the same
    // second means the horn fires twice in the building and the event log
    // shows two expiries for one clock. Note the wake signal (clock-wake.ts)
    // is process-local, so a start-clock mutation that lands on a FOLLOWER
    // cannot shorten the leader's idle window — worst case is the ≤30 s
    // first-detection delay the idle-skip comment above already accepts, and
    // it applies only when no game is live at all.
    const status = await leadThisTick(this.lease, LEASE.SPORTS_CLOCK_ADVANCE, {
      ttlMs: ClockAdvanceService.LEASE_TTL_MS,
    });
    if (!status.leader) return;
    if (consumeClockSweepWake()) this.idleTicksLeft = 0;
    if (this.idleTicksLeft > 0) {
      this.idleTicksLeft--;
      return;
    }
    this.running = true;
    try {
      const { found, changed } = await this.sports.autoAdvanceExpiredClocks();
      this.idleTicksLeft = found === 0 ? ClockAdvanceService.IDLE_SWEEP_EVERY_TICKS - 1 : 0;
      if (changed > 0) {
        this.logger.log(`auto-advanced ${changed} expired game clock(s)`);
      }
    } catch (e: any) {
      this.logger.warn(`clock auto-advance failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
