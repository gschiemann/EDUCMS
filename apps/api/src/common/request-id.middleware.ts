import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

/**
 * Request / correlation id (Foundry Standard Article 22). One id per HTTP request, end to end:
 * taken from an inbound `x-request-id` when it is well-formed (so a client or an upstream proxy can
 * correlate its own logs), otherwise a fresh UUID v4. It is echoed in the response header, carried
 * in error bodies as `requestId` (next to the Sentry `traceId`), tagged on the Sentry scope as
 * `request_id`, and included in the central error / mutation log lines.
 *
 * The id is an opaque correlation string: it carries no user, tenant or credential data, and an
 * inbound value is accepted only if it matches the strict pattern below (no log-injection, no
 * unbounded header echo). Dependency-free; installed first in main.ts so even a body-parser
 * rejection carries one.
 */
export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export interface RequestWithId extends Request {
  requestId?: string;
}

export function resolveRequestId(inbound: unknown): string {
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  return typeof candidate === 'string' && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req.headers?.[REQUEST_ID_HEADER]);
  (req as RequestWithId).requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  try {
    // The isolation scope is per-request under the Sentry SDK's http instrumentation; with Sentry
    // disabled this is a harmless no-op.
    Sentry.getIsolationScope().setTag('request_id', id);
  } catch {
    /* observability must never fail a request */
  }
  next();
}
