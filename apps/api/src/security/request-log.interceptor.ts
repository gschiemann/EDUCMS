import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { clientIpFromRequest } from './client-ip';

/**
 * RequestLogInterceptor — structured stdout request log for mutating
 * HTTP calls. This is an OPERATIONAL log, NOT the audit safeguard.
 *
 * History (P0-4, 2026-05-28): this class used to be named
 * `AuditInterceptor` and carried a comment claiming privileged actions
 * were shipped to an "immutable log shipper (e.g. FluentBit -> S3/
 * CloudWatch)". No such shipper exists anywhere in this repo or its
 * deploy config — the only sink was `logger.log()` to stdout, which on
 * Railway is an ephemeral, rotated buffer. Anyone reading the old name
 * + comment reasonably concluded "every POST/PUT/DELETE is audited";
 * they were not. That is the exact safeguard-theater pattern the
 * 2026-05-21 `verifyMessage()` incident burned us on.
 *
 * The REAL, durable audit trail is the `AuditLog` table, written by the
 * domain code on each privileged action (emergency trigger/all-clear,
 * auth login/logout, AI key set/rotate/revoke, Stripe→License, super
 * license ops, submission approve/reject, template create/update/
 * delete/import, sponsor CRUD, asset/playlist/schedule/screen/branding/
 * tenant/user/GPIO/POS/streaming/SSO/USB/floor-plan mutations, …).
 * Grep `auditLog.create` to see the coverage.
 *
 * This interceptor's only job now is a one-line structured stdout
 * breadcrumb for live tailing / Sentry breadcrumbs. It deliberately
 * does NOT pretend to be the audit log, and it never writes to the DB
 * (a per-request DB write on every mutation would double-write the
 * domain audit rows and add a write-amp tax on the hot path). If a NEW
 * privileged mutation route is added, the obligation is to write an
 * `AuditLog` row in that route's controller/service — not to lean on
 * this breadcrumb.
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  // Channel name kept human-readable; explicitly NOT "AuditLog" so a
  // log reader can't mistake these stdout lines for the audit table.
  private readonly logger = new Logger('RequestLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method } = req;

    // SDE-05 (2026-08-04) — log the PATH, never the query string.
    //
    // This breadcrumb recorded the full URL, so any credential a caller puts
    // in a query parameter was copied verbatim into the operational log. That
    // is live today on the sports feed routes, which carry their token as a
    // query param.
    //
    // Uses `originalUrl || url` rather than `req.path` deliberately: under some
    // Nest middleware mount modes `req.path` becomes relative to the mount
    // point and loses the `/api/v1/...` prefix, which would silently degrade
    // this record. csrf.middleware.ts:200-206 documents that and uses exactly
    // this expression.
    //
    // No "safe query key" allowlist: that is a second policy with its own
    // drift risk, and nothing consumes the query half of this breadcrumb. The
    // durable forensic record is the AuditLog row written by domain code with
    // structured fields (see this class's doc) — it never parses URLs, so
    // nothing about incident forensics changes here.
    const resourcePath = String(
      (req as any).originalUrl || (req as any).url || (req as any).path || '',
    )
      .split('?')[0]
      // Phase-2 SHARE (refuter P2, 2026-08-10) — the scorekeeper console is
      // the one route family whose credential rides in the PATH itself
      // (/sports/console/<token>/…), so the query-strip above doesn't cover
      // it: without this, every pad tap copies a live game-control token
      // into stdout — the same leak class SDE-05 closed for feed tokens.
      .replace(/(\/sports\/console\/)[^/]+/, '$1:token');
    // Real client IP behind Railway's multi-hop proxy — NOT req.ip, which
    // resolves to a rotating internal hop (see client-ip.ts, 2026-07-07).
    const ip = clientIpFromRequest(req);

    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    if (!isMutation) {
      return next.handle();
    }

    const userId = (req as any).user?.id || 'anonymous';
    const timestamp = new Date().toISOString();

    return next.handle().pipe(
      tap(() => {
        // Operational breadcrumb only — NOT a durable audit record.
        // The durable record is the AuditLog row written by the
        // route's domain code (see class doc).
        this.logger.log(
          JSON.stringify({
            eventType: 'HTTP_MUTATION',
            timestamp,
            actorId: userId,
            ipAddress: ip,
            method,
            resource: resourcePath,
            status: 'SUCCESS',
          }),
        );
      }),
    );
  }
}
