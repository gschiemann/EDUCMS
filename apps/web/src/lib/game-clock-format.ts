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
