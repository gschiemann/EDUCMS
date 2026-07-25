import { ForbiddenException } from '@nestjs/common';
import { AppRole } from '@cms/database';

/**
 * Resolve the caller's tenant scope, REJECTING a token that carries none.
 *
 * Why this exists (2026-07-25 audit): a device JWT (`kind:'device'`) has no
 * `tenantId`. Handlers that passed `req.user.tenantId` straight into a Prisma
 * `where` were not "scoped to nothing" — Prisma DROPS an `undefined` filter, so
 * `where: { tenantId: undefined }` matches EVERY TENANT. Anyone able to mint a
 * tenant-less device token could therefore read (and in the notifications case
 * destructively mutate) every tenant's rows. The bug is invisible at the call
 * site because the code *looks* scoped.
 *
 * Returns `null` ONLY for SUPER_ADMIN, who is legitimately cross-tenant — the
 * same contract as EmergencyController.resolveScopeTenant /
 * ScreenEmergencyController.requireTenantId, which this generalises.
 *
 * Callers MUST treat a `null` return as "no tenant filter, super-admin only"
 * and anything else as a hard scope.
 */
export function requireTenantId(req: any): string | null {
  const tenantId = req?.user?.tenantId;
  if (typeof tenantId === 'string' && tenantId.trim().length > 0) return tenantId;
  if (req?.user?.role === AppRole.SUPER_ADMIN) return null;
  throw new ForbiddenException('Token missing tenantId');
}

/**
 * Strict variant for handlers that are ALWAYS tenant-scoped (per-user rows like
 * notifications). SUPER_ADMIN reaches these only after switching into a tenant,
 * which stamps their session with that tenantId — so a null here is a bug, not
 * a cross-tenant operation.
 */
export function requireTenantIdStrict(req: any): string {
  const id = requireTenantId(req);
  if (!id) throw new ForbiddenException('Token missing tenantId');
  return id;
}
