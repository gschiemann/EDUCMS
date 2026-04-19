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
      expose = true; // trust Nest-declared messages
      if (status >= 500) {
        expose = process.env.NODE_ENV !== 'production';
      }
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
      try {
        traceId = Sentry.withScope((scope) => {
          scope.setTag('route', req?.url ?? 'unknown');
          scope.setTag('method', req?.method ?? 'unknown');
          if (req?.user?.id) scope.setUser({ id: req.user.id });
          return Sentry.captureException(exception);
        });
      } catch {
        /* never let Sentry errors block response */
      }
      this.logger.error(
        `[${req?.method} ${req?.url}] ${status} ${code}: ${
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
