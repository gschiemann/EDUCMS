/**
 * Puts the request's audit actor into AsyncLocalStorage for the life of the
 * handler, so the Prisma middleware in `audit-actor.ts` can stamp
 * `AuditLog.apiKeyId` without any of the 195 audit writers knowing.
 * ACC-06 follow-up, 2026-08-03.
 *
 * ORDERING. Nest runs guards BEFORE interceptors, so `req.user` is already
 * populated by `JwtAuthGuard` when this runs. The guard's own
 * `API_KEY_REQUEST` / `API_KEY_REQUEST_DENIED` rows are written inside the
 * guard and stamp the column directly — they do not depend on this.
 *
 * COST. For a human or device request this is a no-op that returns
 * `next.handle()` untouched: no AsyncLocalStorage frame is entered at all, so
 * the overwhelming majority of traffic pays nothing.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { auditActorFields, runWithAuditActor } from './audit-actor';

@Injectable()
export class AuditActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP carries a request-scoped actor; WS/RPC contexts have no
    // `req.user` to read and must fall straight through.
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const actor = auditActorFields(req);
    // Nothing to carry for a human/device/anonymous request.
    if (!actor.apiKeyId) return next.handle();

    // The route handler runs on SUBSCRIPTION, so the subscribe call — not the
    // `next.handle()` call — is what has to happen inside the ALS frame.
    //
    // `runWithAuditActor` (i.e. `als.run`) and NOT `enterWith`: under HTTP
    // keep-alive `enterWith` mutates the socket's store and leaks this
    // request's key into the NEXT request on the same connection, attributing
    // an action to the wrong credential. See audit-actor.ts.
    return new Observable((subscriber) =>
      runWithAuditActor(actor, () => next.handle().subscribe(subscriber)),
    );
  }
}
