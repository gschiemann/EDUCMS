import { HttpException, HttpStatus } from '@nestjs/common';

export interface PoolTenant { id: string; parentId: string | null; allocatedSeats: number | null; name?: string; slug?: string; archivedAt?: Date | null; license?: any; depth: number }

/** Breadth-first tenant traversal, bounded and cycle-safe. Never assumes a three-level tree. */
export async function customerTree(client: any, rootId: string): Promise<PoolTenant[]> {
  const root = await client.tenant.findUnique({ where: { id: rootId }, include: { license: true } });
  if (!root) throw new HttpException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' }, 404);
  const rows: PoolTenant[] = [{ ...root, allocatedSeats: root.allocatedSeats ?? null, depth: 0 }];
  const seen = new Set([rootId]);
  let frontier = [rootId];
  while (frontier.length) {
    const children = await client.tenant.findMany({ where: { parentId: { in: frontier } }, include: { license: true }, orderBy: { name: 'asc' } });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id) || rows.length >= 10_000) throw new HttpException({ code: 'CUSTOMER_TREE_INVALID', message: 'Organization hierarchy is cyclic or exceeds the supported size.' }, 409);
      seen.add(child.id);
      const parent = rows.find((r) => r.id === child.parentId)!;
      rows.push({ ...child, allocatedSeats: child.allocatedSeats ?? null, depth: parent.depth + 1 });
      frontier.push(child.id);
    }
  }
  return rows;
}

export async function poolUsage(client: any, tree: PoolTenant[]) {
  const screens = await client.screen.groupBy({ by: ['tenantId'], where: { tenantId: { in: tree.map((t) => t.id) }, pairedAt: { not: null } }, _count: { _all: true } });
  const used = new Map<string, number>(screens.map((s: any) => [s.tenantId, s._count._all]));
  const consumed = tree.reduce((n, t) => n + Math.max(t.allocatedSeats ?? 0, used.get(t.id) ?? 0), 0);
  return { used, consumed };
}

/** Reservations and usage must fit together; unallocated locations may consume only unreserved seats. */
export function assertPoolCapacity(tree: PoolTenant[], used: Map<string, number>, limit: number, pairingTenantId?: string) {
  const target = pairingTenantId ? tree.find((t) => t.id === pairingTenantId) : null;
  if (pairingTenantId && !target) throw new HttpException({ code: 'CUSTOMER_LOCATION_NOT_FOUND', message: 'Location not found in this organization.' }, 404);
  if (target?.allocatedSeats != null && (used.get(target.id) ?? 0) >= target.allocatedSeats) {
    throw new HttpException({ code: 'LOCATION_ALLOCATION_EXHAUSTED', message: 'This location has used its allocated screens. Ask your administrator to allocate more.' }, HttpStatus.PAYMENT_REQUIRED);
  }
  const consumed = tree.reduce((n, t) => n + Math.max(t.allocatedSeats ?? 0, (used.get(t.id) ?? 0) + (t.id === pairingTenantId ? 1 : 0)), 0);
  if (consumed > limit) throw new HttpException({ code: 'CUSTOMER_POOL_EXHAUSTED', message: 'The corporate pool cannot cover these screen reservations and paired screens.', seatLimit: limit, committedSeats: consumed }, pairingTenantId ? 402 : 409);
}
