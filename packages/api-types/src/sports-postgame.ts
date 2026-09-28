/**
 * VenueOS Sports — THE POSTGAME HOLD (K-12 sports launch program, lane A4,
 * 2026-09-27). Register row K12-F37 of the Codex readiness audit: "let the
 * final result remain visible before returning to signage".
 *
 * Schedule game mode puts a game's board on the screens the table picked and
 * gives them back to their schedule after the game. It used to give them back
 * THE MOMENT the game went final — the final board, and the winning cue, were
 * cut just as the crowd looked up for the result. Now the screens keep the
 * final result for a HOLD the table sets per game (the schedule-game-mode
 * card), then return to what each one showed before. The table can return
 * them early ("Return screens now"); a correction during the hold (the game
 * reopened) keeps the board up and starts a fresh hold when the corrected
 * game ends. Emergency content is untouched: the screen's manifest serves an
 * alert before any scoreboard, hold or not.
 *
 * Shared by the API (which schedules the return) and the console (which
 * offers the choices), so the two can never offer different holds.
 */

/** The hold a game gets when the table never picked one, in minutes. */
export const POSTGAME_HOLD_DEFAULT_MINUTES = 10;

/** The holds the table can pick, in minutes. 0 = return right away (the old
 *  behaviour, still available). */
export const POSTGAME_HOLD_OPTIONS_MINUTES: readonly number[] = Object.freeze([0, 2, 5, 10, 15, 30, 60]);

/** A hold the table asked for, or null when it is not one of the options. */
export function cleanPostgameHoldMinutes(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && POSTGAME_HOLD_OPTIONS_MINUTES.includes(n) ? n : null;
}

/** The hold a game runs, in minutes: its own pick, else the default. */
export function postgameHoldMinutes(stored: unknown): number {
  return cleanPostgameHoldMinutes(stored) ?? POSTGAME_HOLD_DEFAULT_MINUTES;
}
