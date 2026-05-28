import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

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
    const { method, url, ip } = req;

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
            resource: url,
            status: 'SUCCESS',
          }),
        );
      }),
    );
  }
}
