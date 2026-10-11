import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { LicenseService } from '../license/license.service';
import { billingStateOf, cardBillingReady, isBillingGateExemptPath, READ_ONLY_METHODS } from './trial-policy';

/**
 * BILLING READ-ONLY GATE (2026-10-11, self-serve trial → paid).
 *
 * WHAT IT DOES — the whole definition (the rules are trial-policy.ts):
 *   When an organisation's free trial ended more than TRIAL_GRACE_DAYS ago
 *   with no card (`locked`), or its card subscription was cancelled
 *   (`cancelled`), a signed-in PERSON can still SEE everything (every GET) but
 *   CHANGES answer 402 BILLING_READ_ONLY with a plain sentence and a pointer to
 *   Settings → Billing.
 *
 * WHAT IT NEVER DOES:
 *   - stop a screen playing. Device principals (`kind: 'device'`) are not gated:
 *     manifest, heartbeat, cache, render-proof all carry on with the content
 *     the screen was last given;
 *   - stop an emergency. /emergency and /panic-content are exempt for people
 *     too — a lockdown fires whatever the bill says;
 *   - block the way out: /billing (add a card), /license, /auth (sign in, out,
 *     setup), /users/me, /bugs, health and CSRF are exempt;
 *   - touch a SUPER_ADMIN, an INVOICE / PURCHASE_ORDER / COMP organisation, a
 *     legacy no-license pilot, or ANY organisation while card billing is not
 *     live on the deploy (nobody could pay, so nobody is locked out);
 *   - overlap the owner's suspension (OrgSuspensionInterceptor) — a SUSPENDED
 *     licence is its own state and never reaches `readOnly` here.
 *
 * FAILS OPEN. A failed lookup lets the request through — a billing control
 * must never be what takes the dashboard down. Cached per tenant for
 * CACHE_TTL_MS in this process (one cheap query per tenant per window).
 */
const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 5_000;

@Injectable()
export class BillingReadOnlyGate {
  private readonly logger = new Logger('BillingReadOnlyGate');
  private readonly cache = new Map<string, { readOnly: boolean; at: number }>();

  constructor(private readonly license: LicenseService) {}

  async isReadOnly(tenantId: string, now = Date.now()): Promise<boolean> {
    if (!cardBillingReady()) return false;
    const hit = this.cache.get(tenantId);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.readOnly;
    try {
      const { governing } = await this.license.orgAccount(tenantId);
      const { readOnly } = billingStateOf(governing as any, new Date(now), true);
      if (this.cache.size >= CACHE_MAX) this.cache.clear();
      this.cache.set(tenantId, { readOnly, at: now });
      return readOnly;
    } catch (e: any) {
      this.logger.warn(`billing gate lookup failed for tenant ${tenantId} — letting the request through: ${e?.message ?? e}`);
      return false;
    }
  }

  invalidate(): void {
    this.cache.clear();
  }
}

@Injectable()
export class BillingReadOnlyInterceptor implements NestInterceptor {
  constructor(private readonly gate: BillingReadOnlyGate) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user || !user.tenantId) return next.handle();
    if (user.kind === 'device') return next.handle();
    if (user.role === 'SUPER_ADMIN') return next.handle();
    if (READ_ONLY_METHODS.has(String(req.method || 'GET').toUpperCase())) return next.handle();
    const path: string = req.originalUrl || req.url || '';
    if (isBillingGateExemptPath(path)) return next.handle();
    return from(this.gate.isReadOnly(String(user.tenantId))).pipe(
      mergeMap((readOnly) => {
        if (readOnly) {
          throw new HttpException(
            {
              code: 'BILLING_READ_ONLY',
              message:
                'Your account is view-only until a payment method is added (Settings → Billing). Your screens keep playing and emergency alerts still work.',
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
        return next.handle();
      }),
    );
  }
}
