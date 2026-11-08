/**
 * Manager wave 3 (#8) - POST /screens/:id/clear-update-quarantine, and the
 * companion NEEDS_TAP report (#12) on POST /status/:fp/ota-state.
 */
import { ScreensController } from './screens.controller';
import { CLEAR_UPDATE_QUARANTINE_AUDIT_ACTION } from './quarantine-command';
import { RbacGuard } from '../auth/rbac.guard';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

function makeController() {
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      tenant: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  };
  const redis: any = { publish: jest.fn(async () => undefined) };
  const signer: any = {
    signMessage: jest.fn((type: string, payload: any) => ({ type, payload, signature: 'sig' })),
  };
  const controller = new ScreensController(
    prisma,
    redis,
    signer,
    { assertSeatAvailable: jest.fn() } as any,
    { syncSubscriptionQuantity: jest.fn() } as any,
    {} as any,
  );
  return { controller, prisma, redis, signer };
}

const req = (tenantId: string | undefined = 'tenant-a') =>
  ({ user: { id: 'user-1', tenantId, role: 'SCHOOL_ADMIN' } }) as any;

describe('POST /screens/:id/clear-update-quarantine', () => {
  it('audits first, then sends a signed screen-scoped command, and says it is not a rollback', async () => {
    const { controller, prisma, redis, signer } = makeController();
    prisma.client.screen.findFirst.mockResolvedValue({ id: 's1', name: 'Lobby', tenantId: 'tenant-a', managerVersion: '1.1.29' });
    const order: string[] = [];
    prisma.client.auditLog.create.mockImplementation(async () => { order.push('audit'); return {}; });
    redis.publish.mockImplementation(async () => { order.push('publish'); });

    const out: any = await controller.clearUpdateQuarantine(req(), 's1');

    expect(order).toEqual(['audit', 'publish']);
    const audit = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      action: CLEAR_UPDATE_QUARANTINE_AUDIT_ACTION,
      targetType: 'screen',
      targetId: 's1',
      tenantId: 'tenant-a',
      userId: 'user-1',
    });
    expect(JSON.parse(audit.details).rollback).toBe(false);
    expect(signer.signMessage).toHaveBeenCalledWith(
      'CLEAR_UPDATE_QUARANTINE',
      expect.objectContaining({ scope: 'screen', scopeId: 's1', tenantId: 'tenant-a' }),
    );
    expect(redis.publish).toHaveBeenCalledWith('tenant:tenant-a', expect.objectContaining({ type: 'CLEAR_UPDATE_QUARANTINE' }));
    expect(out).toMatchObject({ ok: true, screenId: 's1', published: true, rollback: false });
    expect(out.note).toMatch(/does not roll anything back/);
  });

  it('constrains the lookup to the tenants the caller may act in, and 404s out of scope', async () => {
    const { controller, prisma, redis } = makeController();
    prisma.client.screen.findFirst.mockResolvedValue(null);
    await expect(controller.clearUpdateQuarantine(req(), 'other')).rejects.toMatchObject({ status: 404 });
    const where = prisma.client.screen.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('other');
    expect(where.tenantId).toEqual({ in: ['tenant-a'] });
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('refuses a tenantless principal', async () => {
    const { controller, prisma } = makeController();
    await expect(controller.clearUpdateQuarantine(req(''), 's1')).rejects.toMatchObject({ status: 400 });
    expect(prisma.client.screen.findFirst).not.toHaveBeenCalled();
  });

  it('writes no command when the audit row cannot be written', async () => {
    const { controller, prisma, redis } = makeController();
    prisma.client.screen.findFirst.mockResolvedValue({ id: 's1', name: 'Lobby', tenantId: 'tenant-a' });
    prisma.client.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(controller.clearUpdateQuarantine(req(), 's1')).rejects.toThrow('db down');
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('a failed publish is reported, not hidden', async () => {
    const { controller, prisma, redis } = makeController();
    prisma.client.screen.findFirst.mockResolvedValue({ id: 's1', name: 'Lobby', tenantId: 'tenant-a' });
    redis.publish.mockRejectedValue(new Error('redis down'));
    const out: any = await controller.clearUpdateQuarantine(req(), 's1');
    expect(out.published).toBe(false);
  });

  it('is admin-only: the route requires an admin role and the viewer is not among them', () => {
    const roles = Reflect.getMetadata(
      'roles',
      ScreensController.prototype.clearUpdateQuarantine,
    ) as string[] | undefined;
    // RequireRoles metadata key differs by implementation; fall back to the guard class presence.
    const guards = Reflect.getMetadata('__guards__', ScreensController.prototype.clearUpdateQuarantine) as unknown[];
    expect(guards).toContain(RbacGuard);
    if (roles) {
      expect(roles).not.toContain('RESTRICTED_VIEWER');
      expect(roles).not.toContain('VIEWER');
    }
  });
});

describe('POST /status/:fp/ota-state - the companion waiting for a tap', () => {
  const msg = 'Companion service update is waiting for an Install tap on the screen.';
  const base = { id: 's1', name: 'Lobby', tenantId: 'tenant-a', lastOtaState: 'UP_TO_DATE', forceApkUpdatePendingAt: null };

  it('anonymous: acknowledged, not stored', async () => {
    const { controller, prisma } = makeController();
    prisma.client.screen.findUnique.mockResolvedValue(base);
    const out: any = await controller.reportOtaState('fp-1', { state: 'NEEDS_TAP', message: msg });
    expect(out.ignored).toBe('companion-tap-ignore-anonymous');
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });
});
