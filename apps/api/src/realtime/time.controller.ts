import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TimeSyncService } from './time-sync.service';

/**
 * 2026-07-28 — Frame-locked multi-screen sync: HTTP clock fallback.
 * Design: docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §4.
 *
 * Primary clock transport is TIME_PING/TIME_PONG over the device WebSocket
 * (lower jitter — the socket is already open). This endpoint covers players
 * whose WS is down (they still poll HTTP): same Cristian sampling, slightly
 * coarser because each sample pays TCP/TLS/HTTP overhead.
 *
 * Deliberately UNAUTHENTICATED: server time is not a secret, and skipping
 * auth removes guard latency variance from the sample (variance is exactly
 * what clock sync must minimize). No DB, no Redis on the request path — the
 * TimeSyncService offset is refreshed out-of-band. Response is tiny JSON.
 *
 * `echo` is an opaque client token (the client's local send-time) bounced
 * back so the client can compute RTT statelessly across interleaved
 * requests. Clamped to a number to keep the reflection inert.
 *
 * Throttle: generous — a fleet's screens each burst ~10 requests on lock
 * then 1/20s steady-state, and venues NAT the whole fleet behind one IP
 * (the render-proof 429 lesson, 2026-07-25: IP-keyed throttles are
 * per-SITE). 1200/min ≈ 20 rps per site bounds a flood without starving
 * a 300-screen venue.
 */
// Full path in the decorator — this app sets no global prefix; every
// controller carries its own `api/v1/...` (same as SseController).
@Controller('api/v1/realtime')
export class TimeController {
  constructor(private readonly timeSync: TimeSyncService) {}

  @Get('time')
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  getTime(@Query('echo') echo?: string) {
    const echoNum = echo !== undefined ? Number(echo) : undefined;
    return {
      serverNow: this.timeSync.now(),
      ...(Number.isFinite(echoNum) ? { echo: echoNum } : {}),
    };
  }
}
