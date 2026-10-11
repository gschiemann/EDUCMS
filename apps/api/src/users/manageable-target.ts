import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { assertCallerCanAssignRole } from '../auth/role-assignment';
import { assertSupportReach } from '../support-access/support-access.context';

/**
 * THE ONE GATE for "may this caller act ON this account?" — extracted
 * 2026-10-10 from `UsersController.loadManageableTarget` (unchanged) so the
 * account-administration routes (change email, setup links) answer that
 * question with the SAME code the lifecycle routes do. The full rationale is
 * on `UsersController.loadManageableTarget`, which now delegates here:
 *
 *   1. the row exists and is not soft-deleted;
 *   2. SELF is refused unless the route opts in (`allowSelf`);
 *   3. TENANT SUBTREE — SUPER_ADMIN everywhere; DISTRICT_ADMIN its own tenant
 *      plus any tenant whose `parentId` is its tenant; everyone else its own
 *      tenant only;
 *   4. RANK — strictly below the caller (`assertCallerCanAssignRole`), last,
 *      so a cross-tenant probe cannot learn a stranger's role from the error.
 *
 * `notFoundOnScopeMiss` answers rule 3 with 404 instead of 403, for routes
 * whose ids get guessed rather than read off a list.
 */
export interface ManageableTarget {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  status: string;
}

export async function loadManageableTarget(
  client: any,
  req: any,
  id: string,
  opts: { allowSelf?: boolean; notFoundOnScopeMiss?: boolean } = {},
): Promise<ManageableTarget> {
  const callerRole: string = req?.user?.role;
  const callerTenantId: string = req?.user?.tenantId;
  const callerId: string = req?.user?.id;

  // ten-ok: resolve-then-verify — the tenant subtree is asserted a few lines
  // below (403/404 on miss) and SUPER_ADMIN is cross-tenant by design, so the
  // lookup cannot be pre-scoped to the caller's tenant without breaking the
  // district→school reach this endpoint family needs.
  const target = await client.user.findFirst({
    where: { id, deletedAt: null } as any,
    select: { id: true, email: true, role: true, tenantId: true, status: true } as any,
  });
  if (!target) {
    throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
  }

  const isSelf = !!callerId && (target as any).id === callerId;
  if (isSelf && !opts.allowSelf) {
    throw new HttpException(
      { code: 'USER_CANNOT_ACT_ON_SELF', message: 'You cannot do that to your own account.' },
      HttpStatus.BAD_REQUEST,
    );
  }

  if (callerRole !== AppRole.SUPER_ADMIN && (target as any).tenantId !== callerTenantId) {
    let inSubtree = false;
    if (callerRole === AppRole.DISTRICT_ADMIN && (target as any).tenantId) {
      const t = await client.tenant.findUnique({
        where: { id: (target as any).tenantId },
        select: { parentId: true } as any,
      });
      inSubtree = !!t && (t as any).parentId === callerTenantId;
    }
    if (!inSubtree) {
      if (opts.notFoundOnScopeMiss) {
        throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
      }
      throw new ForbiddenException({ code: 'USER_NOT_IN_TENANT', message: 'Target user is not in your tenant.' });
    }
  }

  // SUPPORT ACCESS (2026-10-11): a super admin manages a customer's account only under a grant.
  await assertSupportReach(req?.user, (target as any).tenantId);

  if (!isSelf) assertCallerCanAssignRole(callerRole, (target as any).role);

  return target as any;
}

/**
 * The tenants an admin may administer accounts in, for LIST/BULK routes that
 * have no single target id: SUPER_ADMIN and DISTRICT_ADMIN reach the tenant
 * they are working in plus its direct children (the district → school /
 * corporate → location shape `loadManageableTarget` grants), everyone else
 * their own tenant only. Rank is still checked per account by the caller.
 */
export async function manageableTenantIds(client: any, req: any): Promise<string[]> {
  const callerRole: string = req?.user?.role;
  const callerTenantId: string | undefined = req?.user?.tenantId;
  if (!callerTenantId) return [];
  if (callerRole !== AppRole.SUPER_ADMIN && callerRole !== AppRole.DISTRICT_ADMIN) return [callerTenantId];
  // ten-ok: the children of the caller's OWN tenant — this IS the scope being computed
  const children = await client.tenant.findMany({
    where: { parentId: callerTenantId } as any,
    select: { id: true },
  });
  return [callerTenantId, ...children.map((c: { id: string }) => c.id)];
}
