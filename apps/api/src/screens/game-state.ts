import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

/**
 * game-state.ts — the bounds on `POST /api/v1/screens/:id/game-state`
 * (SDW-02, 2026-11-23).
 *
 * The route carries a scoreboard console's decoded snapshot from the bridge in
 * the player page (`apps/web/src/components/player/CtsBridge.tsx`, legacy mode:
 * `?cts=1` with no game bound) to the players of the SAME screen, as a signed
 * `GAME_STATE` message on `device:<id>`. Every accepted request is signed and
 * published on the Redis bus that also carries alerts, so the route admits only
 * what the bridge really sends, at the rate it really sends it, and publishes
 * only the parsed copy — never the raw body.
 *
 * ── MEASURED (2026-11-23) ───────────────────────────────────────────────
 *   • Size. `JSON.stringify({ source, snapshot })` is 311–420 bytes for the
 *     three real CTS console captures in `@cms/scoreboard-cts`, 353 / 444 / 400
 *     bytes for a full Daktronics football / basketball / baseball state, and
 *     579 bytes for the largest CTS snapshot the decoders build (three
 *     exclusions a side, three-digit scores). 16 KB is ~28× the largest.
 *   • Rate. The bridge posts latest-wins at most every 200 ms (5 Hz, at most
 *     300 a minute per screen). The first bridge build (2026-05-26) used 125 ms
 *     (8 Hz, 480 a minute). The handler's own per-screen floor admits 16 Hz.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────
 * Two producers post here: the CTS decoders (`CtsFullSnapshot`) and the
 * Daktronics decoder (`DaktronicsSnapshot`), both in `@cms/scoreboard-cts`.
 * Every field either one has ever sent is listed below with its type and a
 * bound, including the first build's string shot clocks. Every one of them
 * has always sent `clock`, `period`, `homeScore` and `awayScore`, so those are
 * required. Keys not listed are DROPPED from the published copy rather than
 * refused: the consumers (`CtsScoreboard`, `CtsRibbonWidgets`, `cts-fields`)
 * read only the listed fields, and a bridge build that adds a field keeps its
 * scoreboard live instead of losing every frame to a 400. A field that is
 * listed but has the wrong type or is out of bounds is a 400.
 *
 * Numbers may be `null`: a decoder that ever produced NaN would serialise it
 * as `null`, and the consumers already default a non-number field.
 */

/** Hard ceiling on the JSON body, in bytes. Mirrored by the route-scoped body
 *  parser in `main.ts`, which refuses a larger body before it is parsed; this
 *  constant is the in-handler backstop for a request that declares its length. */
export const GAME_STATE_MAX_BODY_BYTES = 16 * 1024;

/**
 * The 413 for a body over `GAME_STATE_MAX_BODY_BYTES`. One helper, so the
 * route parser (`game-state-body.ts`) and the handler's `Content-Length`
 * backstop answer the same code, and the message is derived from the limit
 * rather than typed beside it.
 */
export function gameStateBodyTooLarge(): HttpException {
  const kb = GAME_STATE_MAX_BODY_BYTES / 1024;
  const limit = Number.isInteger(kb)
    ? `${kb} KB`
    : `${GAME_STATE_MAX_BODY_BYTES} bytes`;
  return new HttpException(
    {
      code: 'SCREEN_GAME_STATE_BODY_TOO_LARGE',
      message: `Body exceeds ${limit}`,
    },
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}

/**
 * Per-address ceiling, per 60 s, for the route's `@Throttle`.
 *
 * The route is keyed on the CLIENT ADDRESS (it is deliberately not in
 * `DEVICE_THROTTLE_ROUTES`): a device-keyed bucket moves the key off the
 * address, so it cannot be an address ceiling, and its 300/min per-device
 * clamp is exactly the bridge's 5 Hz maximum, with a 60 s block on the next
 * request. 1200 is 4 bridges at their maximum rate behind one venue address
 * (2.5 of the 8 Hz first build), the same number the bound-console route
 * (`ScoreboardConsoleDeviceController#snapshot`) gives the same bridge.
 */
export const GAME_STATE_ADDRESS_LIMIT_PER_MIN = 1200;

/** The bridge's own posting cadence (CtsBridge.tsx `POST_THROTTLE_MS`). */
export const GAME_STATE_BRIDGE_MIN_INTERVAL_MS = 200;
/** The first bridge build's cadence (2026-05-26). */
export const GAME_STATE_FIRST_BRIDGE_MIN_INTERVAL_MS = 125;

/** Longest accepted display string. Real ones are at most 8 characters (an
 *  8-cell CTS channel line, an 8-character Daktronics field). */
export const GAME_STATE_MAX_TEXT = 32;
/** Most exclusions a side. Real decoders produce at most 3. */
export const GAME_STATE_MAX_EXCLUSIONS = 8;
/** Largest magnitude for a counter (score, period, timeouts, fouls, …). */
export const GAME_STATE_MAX_COUNT = 1_000_000;
/** Longest accepted `source` label (`cts`, `daktronics`). */
export const GAME_STATE_MAX_SOURCE = 32;

const text = z.string().max(GAME_STATE_MAX_TEXT);
const count = z
  .number()
  .finite()
  .min(-GAME_STATE_MAX_COUNT)
  .max(GAME_STATE_MAX_COUNT)
  .nullable();
const millis = z
  .number()
  .finite()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const side = z.enum(['home', 'away']).nullable();

/** The first bridge build posted a display string; later ones post the
 *  structured clock. Both are accepted. */
const shotClock = z.union([
  text,
  z.object({ raw: text, ms: millis, running: z.boolean() }),
]);

const exclusions = z
  .array(z.object({ playerJersey: count, secondsRemaining: count }))
  .max(GAME_STATE_MAX_EXCLUSIONS);

const football = z
  .object({
    down: text,
    toGo: count,
    ballOn: count,
    possession: side,
    playClock: text,
  })
  .partial();

const basketball = z
  .object({
    homeTeamFouls: count,
    guestTeamFouls: count,
    homeBonus: z.boolean(),
    homeDoubleBonus: z.boolean(),
    guestBonus: z.boolean(),
    guestDoubleBonus: z.boolean(),
    possession: side,
    shotClock: text,
  })
  .partial();

const baseball = z
  .object({
    balls: count,
    strikes: count,
    outs: count,
    atBat: side,
    homeHits: count,
    awayHits: count,
    homeErrors: count,
    awayErrors: count,
    batterNumber: count,
  })
  .partial();

export const gameStateSnapshotSchema = z.object({
  // Sent by every producer since the first bridge build.
  clock: text,
  period: count,
  homeScore: count,
  awayScore: count,
  // CTS (`CtsFullSnapshot`).
  homeShotClock: shotClock.optional(),
  awayShotClock: shotClock.optional(),
  homeExclusions: exclusions.optional(),
  awayExclusions: exclusions.optional(),
  // Both producers.
  homeTimeoutsRemaining: count.optional(),
  awayTimeoutsRemaining: count.optional(),
  horn: z.boolean().optional(),
  receivedAt: millis.optional(),
  // Daktronics (`DaktronicsSnapshot`). `sport` is a bounded label rather than
  // an enum so a newly supported sport does not turn every frame into a 400.
  sport: text.optional(),
  clockStopped: z.boolean().optional(),
  clockRunning: z.boolean().optional(),
  clockIsZero: z.boolean().optional(),
  football: football.optional(),
  basketball: basketball.optional(),
  baseball: baseball.optional(),
});

export type GameStateSnapshot = z.infer<typeof gameStateSnapshotSchema>;

export type GameStateParse =
  | { ok: true; source: string; snapshot: GameStateSnapshot }
  | {
      ok: false;
      code:
        | 'SCREEN_GAME_STATE_SNAPSHOT_REQUIRED'
        | 'SCREEN_GAME_STATE_SNAPSHOT_INVALID';
      message: string;
    };

/**
 * Parse a request body. A missing or non-object `snapshot` keeps the route's
 * original 400 code; a snapshot of the wrong shape gets its own. The returned
 * snapshot is a fresh object holding only the listed fields.
 */
export function parseGameStateBody(body: unknown): GameStateParse {
  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const snapshot = b?.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {
      ok: false,
      code: 'SCREEN_GAME_STATE_SNAPSHOT_REQUIRED',
      message: 'snapshot is required',
    };
  }
  const source = b?.source;
  if (
    source !== undefined &&
    (typeof source !== 'string' || source.length > GAME_STATE_MAX_SOURCE)
  ) {
    return {
      ok: false,
      code: 'SCREEN_GAME_STATE_SNAPSHOT_INVALID',
      message: 'source must be a short string',
    };
  }
  const parsed = gameStateSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'SCREEN_GAME_STATE_SNAPSHOT_INVALID',
      message: 'snapshot failed validation',
    };
  }
  return {
    ok: true,
    source: typeof source === 'string' ? source : 'cts',
    snapshot: parsed.data,
  };
}
