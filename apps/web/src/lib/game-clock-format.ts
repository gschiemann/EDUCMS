/**
 * VenueOS Sports — THE game-clock formatter (Phase-2 Domain CLOCK,
 * 2026-08-09). One function, every surface: the operator console
 * (`[schoolId]/sports/[gameId]`), the scoreboard (`board/[gameId]`), the
 * ribbon (`ribbon/[gameId]`), the scorebug and the volunteer pad. Before
 * the 2026-08-09 pass each page carried its own copy — the console CEILed
 * while board/ribbon FLOORed, so the operator and the crowd could read
 * different seconds for the same instant.
 *
 * K12-F17 (2026-09-27): the implementation now lives in the shared clock
 * contract (packages/api-types/src/sports-clock.ts — `formatClockReading`,
 * used by the API's celebration snapshot too), and the TENTHS decision is
 * the sport's (`formatSportClock`: final minute of a countdown whose boards
 * show tenths — basketball, hockey, water polo). Surfaces should call
 * `formatSportClock(def, ms)`; this module keeps the old import path.
 *
 * Broadcast semantics (operator bug 046d73aa, 2026-05-27): a COUNTDOWN
 * clock shows what REMAINS, so seconds round UP — "0:01" holds until
 * the true zero, and "0:00" only ever means expired. Tenths mode keeps
 * TRUNCATION ("59.94" reads 59.9), matching real shot-clock displays.
 */
import { formatClockReading } from '@cms/api-types';

export { formatSportClock } from '@cms/api-types';

export function formatGameClock(ms: number, showTenths = false): string {
  return formatClockReading(ms, showTenths);
}

/** Below this a shot / play clock shows tenths ("4.3"). */
export const SHOT_CLOCK_TENTHS_AT_MS = 5000;

/**
 * THE digits of a shot clock or a football play clock — what the /board
 * route and the scorebug paint, and (K12-F17, 2026-09-27) every sport
 * widget too, so a widget board can never read a different second from the
 * board: whole seconds rounding UP ("24", "6"), and tenths in the final five
 * seconds ("4.3", "0.0"). Callers decide whether the clock is shown at all
 * (`shotClockDisplayLen`, the play clock's `off` flag).
 */
export function formatShotClockReading(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  return safe <= SHOT_CLOCK_TENTHS_AT_MS ? (safe / 1000).toFixed(1) : String(Math.ceil(safe / 1000));
}
