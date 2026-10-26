/**
 * Custom message — what the operator sees (2026-10-26).
 *
 * The owner, on site: "Info and Critical is all we need for message types."
 * The wire has always had three severities (`INFO | WARN | CRITICAL`, the
 * `BroadcastSeverity` enum) and the API keeps accepting all three — a client,
 * an integration or a row written before today still says `WARN`. The UI shows
 * TWO: Info and Critical. This module is the one place that maps the wire to
 * the display, so a stored `WARN` row never shows up as a third kind of
 * message anywhere an operator reads it.
 *
 * The mapping follows what the PLAYER has always done with the three values
 * (`apps/web/src/app/player/emergencySurface.ts`): INFO and WARN are drawn as
 * a banner at the top of the screen, CRITICAL takes the whole screen. So
 * `WARN` reads as **Info** — nothing about how it is drawn changes.
 *
 * Fail-safe toward over-alerting, like the player: an unknown value is read
 * as Critical (the player's `pushedEmergencyFromPayload` does the same for a
 * severity it does not recognise).
 *
 * PURE — no I/O. Shared by the dashboard card, /panic and the API's audit
 * rows so they cannot disagree.
 */

/** The two kinds of custom message an operator can send. */
export const CUSTOM_MESSAGE_SEVERITIES = ['INFO', 'CRITICAL'] as const;
export type CustomMessageSeverity = (typeof CUSTOM_MESSAGE_SEVERITIES)[number];

/** The kind of custom message a stored / received severity displays as. */
export function customMessageSeverity(severity: string | null | undefined): CustomMessageSeverity {
  const v = String(severity ?? '').trim().toUpperCase();
  return v === 'INFO' || v === 'WARN' ? 'INFO' : 'CRITICAL';
}

/** True for a message that is drawn as a top banner (content keeps playing below it). */
export function isBannerSeverity(severity: string | null | undefined): boolean {
  return customMessageSeverity(severity) === 'INFO';
}

/**
 * The most screens ONE custom message may be aimed at by id. The picker lets
 * an operator choose specific screens; the cap keeps one request (and the
 * one audit row that names every target) bounded.
 */
export const CUSTOM_MESSAGE_MAX_SCREENS = 200;
