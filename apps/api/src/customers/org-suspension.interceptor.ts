import { CallHandler, ExecutionContext, ForbiddenException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { LicenseService } from '../license/license.service';
import { isSuspensionExemptPath } from './customer-console.policy';

/**
 * SUSPENDED ORGANISATION GATE (customer console, 2026-10-10).
 *
 * WHAT SUSPEND DOES — the whole definition lives here and in
 * LicenseService.assertSeatAvailable:
 *   1. People in the organisation (and every school / location under it)
 *      cannot use the dashboard: every API request from a SIGNED-IN PERSON
 *      (or one of the organisation's API keys) answers 403 ORG_SUSPENDED, and
 *      the web app shows the "account suspended" page.
 *   2. No new screen can be paired (assertSeatAvailable → 402 ORG_SUSPENDED).
 *
 * WHAT SUSPEND NEVER DOES:
 *   - stop a screen playing. Device principals (`kind: 'device'`) are not
 *     gated at all — manifest, heartbeat, cache, render-proof all carry on;
 *   - stop an emergency. Every /emergency and /panic-content route is exempt,
 *     for people too: a lockdown fires whatever the invoice says;
 *   - block sign-out, first-login setup, or "who am I" (/auth/*, /users/me).
 *   - touch a SUPER_ADMIN (the owner must be able to fix it).
 *
 * WHY AN INTERCEPTOR. Interceptors run after the route's guards, so
 * `req.user` is the verified principal; this file adds a check, it does not
 * change how anyone authenticates. Unauthenticated routes (no `req.user`) are
 * untouched.
 *
 * COST. One cached lookup per request: the answer per tenant is held for
 * CACHE_TTL_MS in this process. Suspend / reactivate clear this replica's
 * cache at once; another replica catches up within the TTL.
 *
 * FAILS OPEN. If the lookup itself fails (database blip) the request goes
 * through: this is a billing control, and a billing control must never be
 * what takes the dashboard down. The failure is logged.
 */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 5_000;

@Injectable()
export class OrgSuspensionGate {
  private readonly logger = new Logger('OrgSuspensionGate');
  private readonly cache = new Map<string, { suspended: boolean; at: number }>();

  constructor(private readonly license: LicenseService) {}

  async isSuspended(tenantId: string, now = Date.now()): Promise<boolean> {
    const hit = this.cache.get(tenantId);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.suspended;
    try {
      const { suspended } = await this.license.orgAccount(tenantId);
      if (this.cache.size >= CACHE_MAX) this.cache.clear();
      this.cache.set(tenantId, { suspended, at: now });
      return suspended;
    } catch (e: any) {
      this.logger.warn(`suspension lookup failed for tenant ${tenantId} — letting the request through: ${e?.message ?? e}`);
      return false;
    }
  }

  /** Suspend / reactivate call this so the change is immediate on this replica. */
  invalidate(): void {
    this.cache.clear();
  }
}

@Injectable()
export class OrgSuspensionInterceptor implements NestInterceptor {
  constructor(private readonly gate: OrgSuspensionGate) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user || !user.tenantId) return next.handle();
    if (user.kind === 'device') return next.handle();
    if (user.role === 'SUPER_ADMIN') return next.handle();
    const path: string = req.originalUrl || req.url || '';
    if (isSuspensionExemptPath(path)) return next.handle();
    return from(this.gate.isSuspended(String(user.tenantId))).pipe(
      mergeMap((suspended) => {
        if (suspended) {
          throw new ForbiddenException({
            code: 'ORG_SUSPENDED',
            message:
              'This organization is suspended. Your screens keep playing and emergency alerts still work. Contact VenueOS to reactivate it.',
          });
        }
        return next.handle();
      }),
    );
  }
}
