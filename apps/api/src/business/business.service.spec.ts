import { BusinessService } from './business.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CapacityWatchService } from '../capacity/capacity-watch.service';
import { BusinessController } from './business.controller';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AppRole } from '@cms/database';
import { RbacGuard } from '../auth/rbac.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';

const now = new Date('2026-10-18T00:00:00.000Z');
const cost = {
  id: 'cost',
  provider: 'Railway',
  service: 'API',
  monthlyCostCents: 1234,
  budgetCents: 1000,
  currency: 'usd',
  active: true,
  source: 'MANUAL',
  planName: null,
  nextBillAt: null,
  notes: null,
  observedAt: now,
  createdAt: now,
  updatedAt: now,
};
const actor = { userId: 'owner', tenantId: 'owner-tenant' };
function setup() {
  const tx = {
    platformCost: {
      create: jest.fn(() => Promise.resolve(cost)),
      findUnique: jest.fn(() => Promise.resolve(cost)),
      update: jest.fn(() => Promise.resolve(cost)),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
  };
  const client = {
    $transaction: jest.fn(
      (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    tenant: { findMany: jest.fn(() => Promise.resolve([])) },
    customerInvoice: { findMany: jest.fn(() => Promise.resolve([])) },
    platformCost: { findMany: jest.fn(() => Promise.resolve([cost])) },
  };
  const capacity = { getReport: jest.fn(() => Promise.resolve({ metrics: [] })) };
  const service = new BusinessService(
    { client } as unknown as PrismaService,
    capacity as unknown as CapacityWatchService,
  );
  return { tx, client, capacity, service };
}

describe('BusinessService cost ledger', () => {
  it('writes audit and cost in the same transaction with the verified actor', async () => {
    const { tx, client, service } = setup();
    await service.createCost(
      { provider: 'Railway', service: 'API', monthlyCostCents: 1234 },
      actor,
      now,
    );
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matcher.
      data: expect.objectContaining({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'BUSINESS_COST_CREATED',
        targetId: 'cost',
      }),
    });
  });
  it('propagates an audit failure so the transaction must roll back', async () => {
    const { tx, service } = setup();
    tx.auditLog.create.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      service.createCost(
        { provider: 'Railway', service: 'API', monthlyCostCents: 1234 },
        actor,
        now,
      ),
    ).rejects.toThrow('audit failed');
  });
  it('does not mutate a missing cost or audit a failed change', async () => {
    const { tx, service } = setup();
    tx.platformCost.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      service.updateCost('missing', { active: false }, actor, now),
    ).rejects.toThrow('Cost record not found');
    expect(tx.platformCost.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('reports costs honestly when revenue and capacity evidence are missing', async () => {
    const { service, capacity } = setup();
    capacity.getReport.mockRejectedValueOnce(new Error('unavailable'));
    const report = await service.report(now);
    expect(report.profit).toEqual({
      monthlyCostCents: 1234,
      estimatedMonthlyProfitCents: -1234,
      marginPercent: null,
      coverage: 'partial',
    });
    expect(report.recommendations.map((item) => item.kind)).toEqual([
      'budget',
      'capacity_unavailable',
    ]);
  });
});

describe('business server authorization', () => {
  it('requires authenticated owner role for the entire controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BusinessController)).toEqual([
      JwtAuthGuard,
      RbacGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, BusinessController)).toEqual([
      AppRole.SUPER_ADMIN,
    ]);
    for (const method of ['report', 'createCost', 'updateCost'] as const) {
      for (const role of [
        AppRole.DISTRICT_ADMIN,
        AppRole.SCHOOL_ADMIN,
        AppRole.CONTRIBUTOR,
        AppRole.RESTRICTED_VIEWER,
      ]) {
        const guard = new RbacGuard(new Reflector());
        const context = {
          getClass: () => BusinessController,
          getHandler: () => BusinessController.prototype[method],
          switchToHttp: () => ({
            getRequest: () => ({
              user: { role },
              params: {},
              body: {},
              query: {},
            }),
          }),
        };
        expect(() => guard.canActivate(context as never)).toThrow(
          ForbiddenException,
        );
      }
    }
  });
  it('does not accept mutations without an audit identity', () => {
    const { service } = setup();
    const controller = new BusinessController(service);
    expect(() => controller.createCost({}, { user: { id: 'owner' } })).toThrow(
      ForbiddenException,
    );
  });
});
