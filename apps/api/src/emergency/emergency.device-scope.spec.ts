/**
 * Regression tests for DT-03 / DT-10 on `GET /api/v1/emergency/status`.
 *
 * DT-03: the handler scoped on `req.user.tenantId`, which for a device was a
 * claim inside a multi-month token. An unpaired / re-homed / dumpstered
 * screen therefore kept reading its FORMER tenant's active EmergencyMessage
 * rows — text, media URLs, the panic playlist id — plus
 * `Tenant.emergencyStatus`. The global DeviceIdentityInterceptor now
 * re-derives that field from the live Screen row; this file pins the
 * handler's half of the contract.
 *
 * DT-10: the handler applied NO per-scope filter, so a device could read
 * `device:`-scoped messages addressed to OTHER rooms in the same tenant —
 * exactly the isolation the sibling `/emergency/messages` handler documents
 * itself as enforcing.
 */

import { EmergencyController } from './emergency.controller';

function harness(rows: any[] = []) {
  const prisma: any = {
    client: {
      emergencyMessage: { findMany: jest.fn().mockResolvedValue(rows) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          emergencyStatus: 'CRITICAL', // the SEVERITY — the incident type lives in emergencyType
          emergencyPlaylistId: 'pl-panic',
        }),
      },
    },
  };
  const controller = new EmergencyController(
    { publish: jest.fn() } as any,
    prisma,
    { signMessage: jest.fn() } as any,
    { dispatch: jest.fn() } as any,
    {} as any,
    {} as any,
  );
  return { controller, prisma };
}

const whereOf = (prisma: any) => prisma.client.emergencyMessage.findMany.mock.calls[0][0].where;

describe('GET /emergency/status — device principals', () => {
  it('DT-10: filters to the scopes THIS device belongs to', async () => {
    const { controller, prisma } = harness();
    await controller.status(
      {
        user: {
          kind: 'device',
          sub: 'screen-A',
          tenantId: 'tenant-1',
          screenGroupId: 'group-9',
        },
      } as any,
      undefined as any,
    );
    const where = whereOf(prisma);
    expect(where.tenantId).toBe('tenant-1');
    expect(where.AND).toEqual([
      {
        OR: [
          { scopeType: 'tenant', scopeId: 'tenant-1' },
          { scopeType: 'device', scopeId: 'screen-A' },
          { scopeType: 'group', scopeId: 'group-9' },
        ],
      },
    ]);
  });

  it('DT-10: a device with no group does not claim group scope', async () => {
    const { controller, prisma } = harness();
    await controller.status(
      { user: { kind: 'device', sub: 'screen-A', tenantId: 'tenant-1' } } as any,
      undefined as any,
    );
    const scopes = whereOf(prisma).AND[0].OR;
    expect(scopes).toHaveLength(2);
    expect(scopes.some((s: any) => s.scopeType === 'group')).toBe(false);
  });

  it('DT-03: a device with no live tenant (unpaired / dumpstered) reads NOTHING', async () => {
    // The interceptor leaves tenantId undefined for an unpaired screen; the
    // handler must then refuse rather than fall through to some other key.
    const { controller, prisma } = harness();
    const res = await controller.status(
      { user: { kind: 'device', sub: 'screen-A' } } as any,
      undefined as any,
    );
    expect(res).toEqual({ active: [], tenantId: null });
    expect(prisma.client.emergencyMessage.findMany).not.toHaveBeenCalled();
  });

  it('DT-03: a device can NEVER use the SUPER_ADMIN cross-tenant query escape', async () => {
    // `?tenantId=` is honoured only for a SUPER_ADMIN user session. A device
    // principal carries no role, but must not be able to acquire one via a
    // forged `role` claim either — the device branch is checked first.
    const { controller, prisma } = harness();
    await controller.status(
      { user: { kind: 'device', sub: 'screen-A', tenantId: 'tenant-1', role: 'SUPER_ADMIN' } } as any,
      'tenant-VICTIM',
    );
    expect(whereOf(prisma).tenantId).toBe('tenant-1');
  });

  it('leaves the user-session path untouched (no device scope filter)', async () => {
    const { controller, prisma } = harness();
    await controller.status(
      { user: { kind: 'user', role: 'SCHOOL_ADMIN', tenantId: 'tenant-1', id: 'u1' } } as any,
      undefined as any,
    );
    expect(whereOf(prisma).AND).toBeUndefined();
  });

  it('still honours an explicit SUPER_ADMIN tenantId override', async () => {
    const { controller, prisma } = harness();
    await controller.status(
      { user: { kind: 'user', role: 'SUPER_ADMIN', tenantId: 'tenant-1', id: 'u1' } } as any,
      'tenant-other',
    );
    expect(whereOf(prisma).tenantId).toBe('tenant-other');
  });
});
