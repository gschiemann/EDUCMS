import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { AppRole } from '@cms/database';
import { auditActorFields, runWithAuditActor } from '../audit/audit-actor';
import { isMutatingMethod, isSupportAccessExemptPath } from './support-access.policy';
import { runWithSupportAccess } from './support-access.context';
import { SupportAccessService, type ReachDecision } from './support-access.service';

/**
 * SUPPORT-ACCESS GATE (2026-10-11) — the workspace half of the enforcement.
 *
 * For every request by a signed-in SUPER_ADMIN PERSON (never a screen, never
 * an API key — a super admin has neither):
 *   1. if the path is exempt (customer console metadata, platform ops, auth,
 *      health, the switcher itself) → through, inside a frame with no
 *      workspace decision;
 *   2. otherwise the request's ACTIVE tenant (`req.user.tenantId`, the
 *      workspace the session is stamped with) must be reachable:
 *      internal org / the super admin's home / an active covering grant.
 *      No reach → 403 SUPPORT_ACCESS_REQUIRED and the handler never runs;
 *   3. under a GRANT, the handler runs inside an audit-actor frame carrying
 *      the grant id, so every AuditLog row any code writes during the request
 *      is stamped `supportGrantId`; a mutating request additionally writes a
 *      SUPPORT_ACCESS_ACTION row on the customer's tenant.
 *
 * The cross-tenant half — routes where a super admin names ANOTHER tenant's
 * row by id (emergency scope, a screen, a user, an SSO config …) — is the
 * `assertSupportReach()` call inside each resolver (support-access.context.ts),
 * which reads the frame this interceptor opens.
 *
 * Interceptors run after the route's guards, so `req.user` is verified here;
 * this file adds a check, it does not change how anyone authenticates. Every
 * other role is untouched: the frame is opened only for SUPER_ADMIN people.
 */
@Injectable()
export class SupportAccessInterceptor implements NestInterceptor {
  constructor(private readonly service: SupportAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user || user.kind === 'device' || user.kind === 'api-key') return next.handle();
    if (user.role !== AppRole.SUPER_ADMIN) return next.handle();

    const path: string = req.originalUrl || req.url || '';
    const exempt = isSupportAccessExemptPath(path);
    const tenantId: string | undefined = typeof user.tenantId === 'string' && user.tenantId ? user.tenantId : undefined;

    const decide = async (): Promise<ReachDecision | null> => {
      if (exempt || !tenantId) return null;
      const d = await this.service.reach(user, tenantId);
      if (!d.allowed) throw SupportAccessService.refusal();
      if (d.basis === 'grant' && d.grantId && isMutatingMethod(req.method)) {
        await this.service.recordAction(d.grantId, tenantId, user, String(req.method || 'GET').toUpperCase(), path);
      }
      return d;
    };

    return from(decide()).pipe(
      mergeMap(
        (workspace) =>
          new Observable((subscriber) => {
            const run = () => next.handle().subscribe(subscriber);
            const framed = () => runWithSupportAccess({ service: this.service, workspace }, run);
            if (workspace?.basis === 'grant' && workspace.grantId) {
              // The grant id rides the SAME ambient actor the api-key hook
              // uses, so `applyAuditActorToPrismaArgs` stamps it on every
              // AuditLog row written during this request.
              return runWithAuditActor({ ...auditActorFields(req), supportGrantId: workspace.grantId }, framed);
            }
            return framed();
          }),
      ),
    );
  }
}
