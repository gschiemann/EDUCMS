import type { Prisma } from '@cms/database';
import { isReservedTenantSlug } from '@cms/api-types';

export class TenantUrlClaimConflict extends Error {}

export function organizationSlug(name: string, tenantId: string): string {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '');
  return base.length >= 2 && !isReservedTenantSlug(base)
    ? base : `organization-${tenantId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8)}`;
}

export async function availableOrganizationSlug(tx: Prisma.TransactionClient, name: string, tenantId: string) {
  const base = organizationSlug(name, tenantId);
  const suffix = tenantId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
  for (let n = 0; n < 100; n += 1) {
    const tail = n === 0 ? '' : `-${suffix}${n > 1 ? `-${n}` : ''}`;
    const candidate = base.slice(0, 60 - tail.length).replace(/-+$/g, '') + tail;
    const claimed = await tx.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    // A global label availability read is not authorization. Another account
    // with the same name keeps its current URL; choose a suffix for this one.
    if (!claimed || claimed.id === tenantId) return candidate;
  }
  throw new Error('Organization URL namespace exhausted');
}
