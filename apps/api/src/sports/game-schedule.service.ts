import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SportsService } from './sports.service';
import { consumeScheduleSweepWake } from './game-schedule-wake';

/**
 * VenueOS Sports — schedule game mode (Inputs-wave SCHED, 2026-08-10).
 *
 * An operator who armed a game's auto-push shouldn't have to be at a
 * keyboard at kickoff minus ten: this sweep finds games whose
 * `autoPushAt` has arrived and puts their board on the selected screens
 * via SportsService.sweepDueAutoPushes. The claim is a single atomic
 * UPDATE … SET auto_push_at = NULL … RETURNING (webhook-retry pattern),
 * so two replicas can never double-fire the same game.
 *
 * Isolated + best-effort, modeled on ClockAdvanceService: the query is
 * tiny (an indexed auto_push_at <= NOW() scan), it has an overlap guard,
 * and any failure is caught and logged — nothing else in the API is
 * affected. A per-game push failure inside the sweep is likewise
 * fail-open (one bad game never kills the pass).
 *
 * Env:
 *   GAME_SCHEDULE_INTERVAL_MS  default 15000 (15s)
 *   GAME_SCHEDULE_DISABLED     set to "1" to skip (test / ops)
 */
@Injectable()
export class GameScheduleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameScheduleService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // Idle-skip (same efficiency discipline as ClockAdvanceService): when the
  // last sweep found ZERO due games, skip the DB query for the next N ticks
  // (60s at the default 15s interval) instead of hitting Postgres on an idle
  // fleet. Arming (and a scheduledAt edit while armed) calls
  // wakeScheduleSweep() to restore the cadence immediately; every other path
  // self-corrects within one idle window — the push lead is 10 minutes, so a
  // ≤60s late first-detection cannot miss a kickoff that matters.
  private idleTicksLeft = 0;
  private static readonly IDLE_SWEEP_EVERY_TICKS = 4;

  constructor(private readonly sports: SportsService) {}

  onModuleInit() {
    if (process.env.GAME_SCHEDULE_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('GameScheduleService disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.GAME_SCHEDULE_INTERVAL_MS) || 15_000;
    this.logger.log(`GameScheduleService starting (interval=${intervalMs}ms)`);
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

  /** Run one sweep pass. Public so tests can drive it directly. */
  async tick(): Promise<void> {
    if (this.running) return; // overlap guard
    if (consumeScheduleSweepWake()) this.idleTicksLeft = 0;
    if (this.idleTicksLeft > 0) {
      this.idleTicksLeft--;
      return;
    }
    this.running = true;
    try {
      const { found, pushed, blocked } = await this.sports.sweepDueAutoPushes();
      this.idleTicksLeft = found === 0 ? GameScheduleService.IDLE_SWEEP_EVERY_TICKS - 1 : 0;
      if (pushed > 0 || blocked > 0) {
        this.logger.log(`auto-pushed ${pushed} game board(s)${blocked ? `, ${blocked} blocked (screen in use)` : ''}`);
      }
    } catch (e: any) {
      this.logger.warn(`game schedule sweep failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
