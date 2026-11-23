/**
 * The body parser for `POST /api/v1/screens/:id/game-state` (2026-11-23, SDW-02).
 *
 * A real scoreboard snapshot body is 311-579 bytes (measurements in
 * `game-state.ts`), and every accepted one is signed and published on the
 * Redis bus that also carries alerts, so the route has its own 16 KB parser
 * (`GAME_STATE_MAX_BODY_BYTES`) ahead of the global 5 MB JSON one, which the
 * bug reporter needs.
 *
 * ORDER: call it BEFORE the global `json()` / `urlencoded()` in main.ts, like
 * the telemetry, play-log and player-logs mounts there. Whichever parser reads
 * the stream first wins, so a larger body is refused here before it is
 * buffered and never reaches the global parser.
 *
 * STATUS: body-parser reports an oversize body as a plain error carrying
 * `status: 413`. Nest hands that to the global `AllExceptionsFilter`, which
 * answers 500 for anything that is not an `HttpException`, so the refusal is
 * re-raised here as a 413 `HttpException` with the route's own code.
 *
 * Exported as a function so main.ts and the HTTP spec mount the SAME thing.
 */
import { json, type NextFunction, type Request, type Response } from 'express';
import { GAME_STATE_MAX_BODY_BYTES, gameStateBodyTooLarge } from './game-state';

/**
 * The route, with or without a trailing slash; the id is one path segment.
 * Case-insensitive because Express routing is, so a differently cased path
 * that reaches the handler is also bounded here.
 */
export const GAME_STATE_ROUTE = /^\/api\/v1\/screens\/[^/]+\/game-state\/?$/i;

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

/** Anything with Express's `use(path, handler)` — the Nest app or an Express app. */
export interface GameStateMiddlewareHost {
  use(path: RegExp, handler: Middleware): unknown;
}

function isTooLarge(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { type?: unknown }).type === 'entity.too.large'
  );
}

export function mountGameStateBodyParser(app: GameStateMiddlewareHost): void {
  const parse = json({ limit: GAME_STATE_MAX_BODY_BYTES });
  app.use(GAME_STATE_ROUTE, (req, res, next) => {
    parse(req, res, (err?: unknown) => {
      if (isTooLarge(err)) {
        next(gameStateBodyTooLarge());
        return;
      }
      next(err as Error | undefined);
    });
  });
}
