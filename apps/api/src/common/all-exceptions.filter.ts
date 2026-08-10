import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Stable machine-readable code per HTTP status. Used as the DEFAULT `code`
 * for an HttpException whose response payload doesn't carry an explicit
 * `code`/`error` field — which is the case for every idiomatic
 * `new HttpException('some message', HttpStatus.X)` (string payload). Before
 * this map those all fell through to the catch-all 'INTERNAL_ERROR', so a
 * 401/403/404/429 body wrongly reported `code: 'INTERNAL_ERROR'` even though
 * the HTTP status was correct. An explicit `{ code }`/`{ error }` on the
 * thrown payload still wins (see catch()).
 */
const STATUS_CODE_LABELS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

function codeForStatus(status: number): string {
  return STATUS_CODE_LABELS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

/**
 * Global exception filter.
 *
 * Responsibilities:
 *  - Normalize every response to `{ error, code, message, traceId }`.
 *  - Map Prisma known errors to meaningful HTTP statuses.
 *  - Never leak stack traces to clients (especially in prod).
 *  - Capture 5xx to Sentry with route/method/user tags. Skip 4xx.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<any>();
    const res = ctx.getResponse<any>();

    // Defaults
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let expose = false; // whether to send `message` through to client

    // ── HttpException (NestJS) ──
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      // Default the machine code to the one that matches the HTTP status.
      // A string-payload HttpException (the idiomatic `throw new
      // HttpException('msg', 404)`) carries no `code`/`error` field, so
      // without this it fell through to 'INTERNAL_ERROR' — a 404/401/429
      // body that wrongly self-reported as an internal error. An explicit
      // `{ code }`/`{ error }` on the payload still overrides it below.
      code = codeForStatus(status);
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object') {
        const anyResp = resp as any;
        message = anyResp.message ?? exception.message;
        code = anyResp.code ?? anyResp.error ?? code;
      } else {
        message = exception.message;
      }
      // 2026-05-04 — operator: AI generator showed "Internal server error"
      // even when the actual cause was a 503 "AI is not configured on
      // this deployment" thrown by AiService. Reason: the previous code
      // masked ALL >=500 messages in production, including authored
      // Service/GatewayException strings that are intentionally safe
      // for client display. HttpException messages are author-vetted —
      // they never include stack traces, secrets, or DB internals — so
      // expose them at every status. The expose-only-in-dev rule still
      // applies to non-HttpException errors below (Prisma fallback,
      // bare Error) where messages CAN leak internals.
      expose = true;
    }
    // ── Prisma known-request errors ──
    else if (this.isPrismaKnownError(exception)) {
      const ex: any = exception;
      switch (ex.code) {
        case 'P2002': // unique constraint
          status = HttpStatus.CONFLICT;
          code = 'CONFLICT';
          message = 'Resource conflict (duplicate value)';
          expose = true;
          break;
        case 'P2025': // record not found
          status = HttpStatus.NOT_FOUND;
          code = 'NOT_FOUND';
          message = 'Resource not found';
          expose = true;
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          code = 'DATABASE_ERROR';
          message = 'Internal server error';
          expose = process.env.NODE_ENV !== 'production';
          if (expose) message = `Prisma error ${ex.code}: ${ex.message}`;
      }
    }
    // ── Anything else (plain Error, string, etc.) ──
    else if (exception instanceof Error) {
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
        expose = true;
      }
    }

    // ── Sentry capture for 5xx only ──
    let traceId: string | undefined;
    if (status >= 500) {
      // SDE-05 (2026-08-04) — path only, never the query string.
      //
      // This is the more durable of the two URL sinks: it writes to the log
      // AND tags the Sentry event, so a credential in a query parameter was
      // being copied into a third-party service with its own retention, and
      // kept there. The request-log interceptor is the other sink; both are
      // fixed together so neither can be "the one that still leaks".
      //
      // `originalUrl || url` rather than `req.path` — see the note in
      // request-log.interceptor.ts and csrf.middleware.ts:200-206.
      // The scorekeeper console carries its credential in the PATH
      // (/sports/console/<token>/…), so the query-strip alone doesn't cover
      // it — redact that one segment here too (same rule as the request-log
      // interceptor, so neither sink is "the one that still leaks").
      const routePath =
        (String(req?.originalUrl ?? req?.url ?? '').split('?')[0] || 'unknown').replace(
          /(\/sports\/console\/)[^/]+/,
          '$1:token',
        );
      try {
        traceId = Sentry.withScope((scope) => {
          scope.setTag('route', routePath);
          scope.setTag('method', req?.method ?? 'unknown');
          if (req?.user?.id) scope.setUser({ id: req.user.id });
          return Sentry.captureException(exception);
        });
      } catch {
        /* never let Sentry errors block response */
      }
      this.logger.error(
        `[${req?.method} ${routePath}] ${status} ${code}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: Record<string, unknown> = {
      error: true,
      code,
      message: expose ? message : 'Internal server error',
    };
    if (traceId) body.traceId = traceId;

    if (res && !res.headersSent) {
      res.status(status).json(body);
    }
  }

  private isPrismaKnownError(e: unknown): boolean {
    if (!e || typeof e !== 'object') return false;
    const name = (e as any).constructor?.name;
    return (
      name === 'PrismaClientKnownRequestError' ||
      name === 'PrismaClientValidationError' ||
      name === 'PrismaClientUnknownRequestError'
    );
  }
}
