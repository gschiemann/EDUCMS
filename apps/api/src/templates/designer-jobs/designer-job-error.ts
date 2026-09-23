/**
 * designer-job-error.ts — what a failed job stores, so the web shows the SAME message the sync
 * endpoint would have produced (2026-09-23).
 *
 * The sync endpoint's errors reach the browser through the global `AllExceptionsFilter`: status +
 * `{ error, code, message }`, where `code` is the thrown payload's `code` (or `error`, or a
 * per-status default) and `message` is exposed for every HttpException and masked for anything
 * else in production. The web maps that envelope (`friendlyAiError`: `AI_CAP_REACHED` / 402,
 * `MENU_BINDING_INCOMPLETE`, 429, 503 …). A job runs outside any request, so instead of
 * re-implementing that normalisation (and drifting from it), this runs the REAL filter against a
 * captured response. 5xx failures therefore also get the filter's Sentry capture + error log,
 * tagged with the job route and the operator — exactly what a failed sync request produced.
 */
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';

export interface DesignerJobError {
  code: string;
  message: string;
  status: number;
}

/** The code a stalled job fails with after its one re-queue. */
export const DESIGNER_JOB_STALLED_CODE = 'AI_DESIGN_JOB_STALLED';
/** The code a job fails with when no worker claimed it in time. */
export const DESIGNER_JOB_EXPIRED_CODE = 'AI_DESIGN_JOB_EXPIRED';

const filter = new AllExceptionsFilter();

export function designerJobErrorFor(e: unknown, ctx: { userId?: string | null } = {}): DesignerJobError {
  let status = 500;
  let body: Record<string, unknown> = {};
  const res = {
    headersSent: false,
    status(s: number) {
      status = s;
      return res;
    },
    json(b: Record<string, unknown>) {
      body = b || {};
      return res;
    },
  };
  const req = {
    method: 'JOB',
    originalUrl: '/api/v1/templates/generate-designer/jobs',
    user: ctx.userId ? { id: ctx.userId } : undefined,
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => undefined }),
  } as unknown as ArgumentsHost;
  try {
    filter.catch(e, host);
  } catch {
    // The filter never throws in practice; if it ever did, fall through to the generic envelope.
  }
  const rawMessage = body.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.map(String).join('; ')
    : typeof rawMessage === 'string' && rawMessage
      ? rawMessage
      : 'Internal server error';
  return {
    status,
    code: typeof body.code === 'string' && body.code ? body.code : 'INTERNAL_ERROR',
    message: message.slice(0, 1000),
  };
}
