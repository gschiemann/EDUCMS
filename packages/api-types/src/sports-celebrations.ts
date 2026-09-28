/**
 * VenueOS Sports — AUTOMATIC CELEBRATIONS (K-12 sports launch program, lane
 * A4, 2026-09-27). Register row K12-F36 of the Codex readiness audit: "tie
 * auto-celebration to a scoring event and shared settings".
 *
 * THE BUGS this closes. The engine celebrated a DIFFERENCE between two score
 * readings: any upward change of the score columns — a typo corrected from 10
 * to 13 as much as a real three-pointer — fired the sport's cue. Whether it
 * fired at all was cached per server process, so after the table switched it
 * off one replica could keep celebrating. And an operator's named cue
 * silenced EVERY automatic cue of that team for ten seconds, including a
 * second, separate score.
 *
 * THE MODEL.
 *  - A celebration fires from a SCORING PLAY: a scoring tap (+3), a scoring
 *    report from a machine feed or a scoreboard console. A typed correction of
 *    the score is not a play (it can be marked one explicitly), and an undo is
 *    never one — an undo withdraws the cue its play fired.
 *  - One play fires at most one cue, and the cue names the play it belongs to
 *    (the scoring event's id), so a replayed command cannot fire it twice.
 *  - The table's SETTINGS decide: automatic celebrations on or off, which of
 *    the sport's automatic cues fire, and a cooldown between two of them. They
 *    are stored with the game and read fresh inside every scoring command, so
 *    every server replica applies the same settings.
 *  - A named cue the operator fires for a team narrates that team's NEXT play
 *    (its automatic cue stays quiet) — once; a later play celebrates again.
 *    A named cue fired just AFTER a play's automatic cue replaces it.
 *
 * Pure: shared by the API (which decides) and the console (which shows the
 * settings), safe on Chromium 83 players.
 */
import type { SportCelebration, SportDefinition } from './sports';

/** The table's automatic-celebration settings for one game. */
export interface CelebrationSettings {
  /** A scoring play fires its celebration by itself. */
  auto: boolean;
  /** The sport's automatic celebrations that stay quiet (keys). Every other
   *  one fires — so a celebration added to the sport later is on. */
  off: string[];
  /** Seconds that must pass after one automatic celebration before the next
   *  may fire. 0 = none: two scores seconds apart both celebrate. */
  cooldownSec: number;
}

/** The cooldowns the table can pick, seconds. */
export const CELEBRATION_COOLDOWN_OPTIONS_SEC: readonly number[] = Object.freeze([0, 10, 30, 60]);

/** A game whose table never changed anything: on, every cue, no cooldown —
 *  exactly what the engine did before the settings existed. */
export const DEFAULT_CELEBRATION_SETTINGS: Readonly<CelebrationSettings> = Object.freeze({
  auto: true,
  off: [],
  cooldownSec: 0,
});

/** How long a named cue waits to narrate its team's next scoring play. */
export const CELEBRATION_NARRATION_WINDOW_MS = 10_000;

/** A scoring play: which side scored, and how many points the play was worth. */
export interface ScoringPlay {
  team: 'home' | 'away';
  points: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The celebrations of a sport a scoring play can fire by itself. */
export function autoCelebrations(def: SportDefinition | null | undefined): SportCelebration[] {
  return (def?.celebrations ?? []).filter((c) => Array.isArray(c.autoPoints) && c.autoPoints.length > 0);
}

/**
 * Read stored settings (the latest AUTO_CELEBRATE event payload). `enabled`
 * is the name the on/off switch has always been stored under. Anything
 * missing or malformed reads as the default — never an error.
 */
export function parseCelebrationSettings(raw: unknown): CelebrationSettings {
  const p = isRecord(raw) ? raw : {};
  const off = Array.isArray(p.off)
    ? [...new Set(p.off.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 64))].slice(0, 32)
    : [];
  const cd = Number(p.cooldownSec);
  return {
    auto: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_CELEBRATION_SETTINGS.auto,
    off,
    cooldownSec: CELEBRATION_COOLDOWN_OPTIONS_SEC.includes(cd) ? cd : 0,
  };
}

/** Settings as stored (the AUTO_CELEBRATE payload shape). */
export function celebrationSettingsPayload(s: CelebrationSettings): Record<string, unknown> {
  return { enabled: s.auto, off: s.off, cooldownSec: s.cooldownSec };
}

/**
 * The celebration a scoring play fires under the table's settings: the
 * sport's automatic cue whose point values include the play's (a touchdown
 * for 6, a three for 3, a goal for 1), unless the table switched it — or
 * automatic celebrations — off. Null = the play stays quiet.
 */
export function celebrationForPlay(
  def: SportDefinition | null | undefined,
  points: number,
  settings: CelebrationSettings,
): SportCelebration | null {
  if (!settings.auto || !Number.isInteger(points) || points <= 0) return null;
  const cue = autoCelebrations(def).find((c) => c.autoPoints!.includes(points));
  if (!cue || settings.off.includes(cue.key)) return null;
  return cue;
}

/**
 * The scoring plays recorded on a GameEvent payload: its `plays` list, or —
 * for a quick-button SCORE event written before plays were recorded — its
 * team and the points the tap actually applied.
 */
export function scoringPlaysOf(payload: unknown): ScoringPlay[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.plays)) {
    return payload.plays.flatMap((p) =>
      isRecord(p) && (p.team === 'home' || p.team === 'away') && Number.isInteger(p.points) && (p.points as number) > 0
        ? [{ team: p.team, points: p.points as number }]
        : [],
    );
  }
  const applied = Number(payload.appliedDelta);
  if ((payload.team === 'home' || payload.team === 'away') && Number.isInteger(applied) && applied > 0) {
    return [{ team: payload.team, points: applied }];
  }
  return [];
}
