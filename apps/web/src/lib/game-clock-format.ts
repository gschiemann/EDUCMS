/**
 * VenueOS Sports — THE game-clock formatter (Phase-2 Domain CLOCK,
 * 2026-08-09). One function, three surfaces: the operator console
 * (`[schoolId]/sports/[gameId]`), the scoreboard (`board/[gameId]`)
 * and the ribbon (`ribbon/[gameId]`). Before this module each page
 * carried its own copy — the console CEILed while board/ribbon
 * FLOORed, so the operator and the crowd could read different seconds
 * for the same instant. The console's math is the reference; the
 * public surfaces converge on it.
 *
 * Broadcast semantics (operator bug 046d73aa, 2026-05-27): a COUNTDOWN
 * clock shows what REMAINS, so seconds round UP — "0:01" holds until
 * the true zero, and "0:00" only ever means expired. Floor is the
 * elapsed-time convention, the wrong question for a clock counting
 * toward zero; ceil is what every Daktronics All Sport / shot clock
 * has done forever, and it keeps the game clock's final tick aligned
 * with the shot clock's (which already ceils). Count-up clocks ride
 * the same math on purpose — cross-surface parity beats per-type
 * rounding, and the console has always displayed count-up this way.
 *
 * Tenths mode (`showTenths`, final minute of a countdown): keeps the
 * pre-existing TRUNCATION behavior — whole seconds and tenths both
 * floor ("59.94" reads 59.9), matching real shot-clock displays.
 * At or above 60s the MM:SS ceil branch applies even in tenths mode.
 *
 * Constraints: pure math — no React, no DOM, no network. Ships to
 * Chromium 83 (NovaStar Taurus): String.padStart (Chrome 57+) is the
 * newest runtime API used.
 */
export function formatGameClock(ms: number, showTenths = false): string {
  const safe = Math.max(0, ms);
  if (showTenths && safe < 60_000) {
    const s = Math.floor(safe / 1000);
    const tenths = Math.floor((safe % 1000) / 100);
    return `${s}.${tenths}`;
  }
  // The console's ceil math, verbatim — the parity reference.
  const totalSec = Math.ceil(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
