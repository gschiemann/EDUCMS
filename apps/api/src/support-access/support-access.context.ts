/**
 * The request-scoped support-access frame (2026-10-11).
 *
 * WHY A STATIC HELPER AND NOT A CONSTRUCTOR DEPENDENCY. The cross-tenant
 * resolvers a SUPER_ADMIN used to pass through by role live in controllers
 * that ~70 spec files construct by hand (`new EmergencyController(redis,
 * prisma, signer, …)`). Adding a parameter to each constructor is a 70-file
 * blast radius for a security change that has to land cleanly. Instead the
 * global SupportAccessInterceptor puts the service into an AsyncLocalStorage
 * frame for the life of every SUPER_ADMIN request, and each resolver calls
 * `assertSupportReach(req.user, owningTenantId)` — one import, no DI.
 *
 * OUTSIDE A FRAME (a unit spec that builds a controller by hand, with no
 * interceptor) the helper is a no-op. In the running app the frame is ALWAYS
 * present: `SupportAccessModule` is @Global and registers the interceptor as
 * APP_INTERCEPTOR, and `support-access.module.spec.ts` pins both facts, plus
 * `app.module` importing it. The decision itself is never cached in the frame
 * — every call goes through `SupportAccessService.assertReach`.
 *
 * ALWAYS `run`, never `enterWith` — see audit-actor.ts for the keep-alive trap.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Principal, ReachDecision, SupportAccessService } from './support-access.service';

export interface SupportAccessFrame {
  service: SupportAccessService;
  /** The decision for the request's ACTIVE workspace tenant (null = exempt route, not evaluated). */
  workspace: ReachDecision | null;
}

const storage = new AsyncLocalStorage<SupportAccessFrame>();

export function runWithSupportAccess<T>(frame: SupportAccessFrame, fn: () => T): T {
  return storage.run(frame, fn);
}

export function currentSupportAccessFrame(): SupportAccessFrame | null {
  return storage.getStore() ?? null;
}

/**
 * The one call every "SUPER_ADMIN is cross-tenant by design" resolver makes
 * once it knows which tenant's data the request is about. Throws 403
 * SUPPORT_ACCESS_REQUIRED for a SUPER_ADMIN with no reach; a no-op for every
 * other principal and outside a request frame.
 */
export async function assertSupportReach(user: Principal | null | undefined, tenantId: string | null | undefined): Promise<void> {
  if (!user || user.role !== 'SUPER_ADMIN' || user.kind === 'device' || user.kind === 'api-key') return;
  if (!tenantId) return;
  const frame = currentSupportAccessFrame();
  if (!frame) return;
  await frame.service.assertReach(user, tenantId);
}

/**
 * `reach` as a boolean, for list routes that would otherwise leave the tenant
 * filter open for a SUPER_ADMIN. Outside a frame: `true` (see header).
 */
export async function hasSupportReach(user: Principal | null | undefined, tenantId: string | null | undefined): Promise<boolean> {
  try {
    await assertSupportReach(user, tenantId);
    return true;
  } catch {
    return false;
  }
}
