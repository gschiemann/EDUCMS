/**
 * The body parser for `POST /api/v1/player-logs/:screenId` (2026-10-03).
 *
 * The Android player posts its rotating log as `text/plain; charset=utf-8`
 * (LogFileOps.java). The API used to mount only JSON and form parsers, and on
 * Express 5 a body no parser claims is left `undefined` — so every upload
 * arrived empty and nothing was ever stored (the "persistent diagnostics" the
 * renderer-recovery work depends on). This mounts a text parser for exactly
 * that route.
 *
 * ORDER: call it BEFORE the global `json()` / `urlencoded()` in main.ts, like
 * the telemetry and webhook mounts there. Whichever parser reads the stream
 * first wins (body-parser skips a request whose body is already consumed), and
 * a path-scoped parser placed after a global one would never run.
 *
 * Exported as a function so main.ts and the HTTP spec mount the SAME thing —
 * the spec drives a real request through it instead of handing the handler a
 * pre-parsed string.
 */
import { text } from 'express';

/** The upload route, with or without a trailing slash; the id segment is one path segment. */
export const PLAYER_LOGS_ROUTE = /^\/api\/v1\/player-logs\/[^/]+\/?$/;

/**
 * The parser's ceiling. Equal to the handler's own MAX_BODY_BYTES (1 MB); the
 * APK sends at most 512 000 bytes. A larger body is refused by the parser
 * (413) before it is buffered, never read in full and then rejected.
 */
export const PLAYER_LOGS_BODY_LIMIT = '1mb';

/** Anything with Express's `use(path, handler)` — the Nest app or an Express app. */
export interface MiddlewareHost {
  use(path: RegExp, handler: ReturnType<typeof text>): unknown;
}

export function mountPlayerLogsBodyParser(app: MiddlewareHost): void {
  app.use(
    PLAYER_LOGS_ROUTE,
    text({ type: 'text/plain', limit: PLAYER_LOGS_BODY_LIMIT }),
  );
}
