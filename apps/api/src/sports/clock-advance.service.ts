import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SportsService } from './sports.service';

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

  constructor(private readonly sports: SportsService) {}

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

  private async tick() {
    if (this.running) return; // overlap guard
    this.running = true;
    try {
      const changed = await this.sports.autoAdvanceExpiredClocks();
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
