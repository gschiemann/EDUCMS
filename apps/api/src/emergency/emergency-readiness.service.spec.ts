import { EmergencyReadinessService } from './emergency-readiness.service';

/**
 * EmergencyReadinessService — derivation matrix. The service is read-only
 * (no trigger-path coupling to test); what matters is that every observed
 * state folds into the honest verdict/copy, and that every query is
 * tenant-scoped (asserted explicitly — the TEN-001 class).
 */

function makeMocks(overrides: Partial<Record<string, any>> = {}) {
  const calls: Record<string, any[]> = { where: [] };
  const prisma = {
    client: {
      tenant: {
        findFirst: jest.fn(async (args: any) => {
          calls.where.push(args.where);
          return overrides.tenant ?? {
            panicLockdownPlaylistId: 'pl1',
            panicSecurePlaylistId: 'pl2',
            panicHoldPlaylistId: 'pl3',
            panicEvacuatePlaylistId: 'pl4',
            panicWeatherPlaylistId: 'pl5',
            panicMedicalPlaylistId: 'pl6',
          };
        }),
      },
      screen: {
        count: jest.fn(async (args: any) => {
          calls.where.push(args.where);
          // total, online, cacheFresh — in call order
          const seq = overrides.screenCounts ?? [4, 4, 4];
          return seq[(prisma.client.screen.count as jest.Mock).mock.calls.length - 1];
        }),
      },
      user: {
        count: jest.fn(async (args: any) => {
          calls.where.push(args.where);
          return overrides.staff ?? 3;
        }),
      },
      auditLog: {
        findFirst: jest.fn(async (args: any) => {
          calls.where.push(args.where);
          return 'lastTrigger' in overrides
            ? overrides.lastTrigger
            : { createdAt: new Date(Date.now() - 10 * 86_400_000) };
        }),
      },
      $queryRaw: overrides.dbFails
        ? jest.fn(async () => { throw new Error('db down'); })
        : jest.fn(async () => 1),
    },
  } as any;
  const redis = {
    publisher: overrides.redisState === 'none'
      ? null
      : {
          status: 'ready',
          ping: overrides.redisState === 'fail'
            ? jest.fn(async () => { throw new Error('no pong'); })
            : jest.fn(async () => 'PONG'),
        },
  } as any;
  const wsSigner = {
    signMessage: overrides.signerThrows
      ? jest.fn(() => { throw new Error('no key'); })
      : jest.fn(() => ({ signature: 'sig' })),
  } as any;
  return { prisma, redis, wsSigner, calls };
}

describe('EmergencyReadinessService', () => {
  it('fully wired + healthy fleet + recent exercise → READY, score 100', async () => {
    const { prisma, redis, wsSigner } = makeMocks();
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    expect(r.verdict).toBe('READY');
    expect(r.score).toBe(100);
    expect(r.items).toHaveLength(5);
    expect(r.items.every((i) => i.status === 'ok')).toBe(true);
  });

  it('nothing configured → NOT_CONFIGURED with actionable hints', async () => {
    const { prisma, redis, wsSigner } = makeMocks({
      tenant: {},
      screenCounts: [0, 0, 0],
      staff: 0,
      lastTrigger: null,
      redisState: 'none',
    });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    expect(r.verdict).toBe('NOT_CONFIGURED');
    const content = r.items.find((i) => i.key === 'content')!;
    expect(content.status).toBe('missing');
    expect(content.fixHint).toMatch(/Lockdown/);
    expect(r.items.find((i) => i.key === 'screens')!.fixHint).toMatch(/Pair a screen/);
    expect(r.items.find((i) => i.key === 'staff')!.status).toBe('missing');
  });

  it('lockdown-only wiring → content WARN naming the missing types', async () => {
    const { prisma, redis, wsSigner } = makeMocks({
      tenant: { panicLockdownPlaylistId: 'pl1' },
    });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const content = r.items.find((i) => i.key === 'content')!;
    expect(content.status).toBe('warn');
    expect(content.fixHint).toMatch(/Evacuate/);
    expect(r.verdict).toBe('NEEDS_ATTENTION');
  });

  it('redis fallback → delivery WARN with the polling-backstop copy, never NOT_CONFIGURED', async () => {
    const { prisma, redis, wsSigner } = makeMocks({ redisState: 'none' });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const delivery = r.items.find((i) => i.key === 'delivery')!;
    expect(delivery.status).toBe('warn');
    expect(delivery.detail).toMatch(/polling/i);
    expect(r.verdict).toBe('NEEDS_ATTENTION');
  });

  it('signer failure → delivery MISSING → NOT_CONFIGURED (platform fault copy)', async () => {
    const { prisma, redis, wsSigner } = makeMocks({ signerThrows: true });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const delivery = r.items.find((i) => i.key === 'delivery')!;
    expect(delivery.status).toBe('missing');
    expect(delivery.fixHint).toMatch(/support/i);
    expect(r.verdict).toBe('NOT_CONFIGURED');
  });

  it('stale exercise (>90d) and never-exercised both WARN with drill nudge', async () => {
    const old = makeMocks({ lastTrigger: { createdAt: new Date(Date.now() - 120 * 86_400_000) } });
    const never = makeMocks({ lastTrigger: null });
    const rOld = await new EmergencyReadinessService(old.prisma, old.redis, old.wsSigner).compute('t1');
    const rNever = await new EmergencyReadinessService(never.prisma, never.redis, never.wsSigner).compute('t1');
    expect(rOld.items.find((i) => i.key === 'exercise')!.status).toBe('warn');
    expect(rNever.items.find((i) => i.key === 'exercise')!.detail).toMatch(/never/i);
    expect(rNever.items.find((i) => i.key === 'exercise')!.fixHint).toMatch(/test alert/i);
  });

  it('partial fleet (some offline / stale cache) → screens WARN with honest counts', async () => {
    const { prisma, redis, wsSigner } = makeMocks({ screenCounts: [5, 3, 2] });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const screens = r.items.find((i) => i.key === 'screens')!;
    expect(screens.status).toBe('warn');
    expect(screens.detail).toBe('3 of 5 screens online; 2 confirmed fetching content.');
  });

  it('TENANT ISOLATION: every query carries the tenantId', async () => {
    const { prisma, redis, wsSigner, calls } = makeMocks();
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    await svc.compute('tenant-xyz');
    expect(calls.where.length).toBeGreaterThanOrEqual(6);
    for (const w of calls.where) {
      expect(JSON.stringify(w)).toContain('tenant-xyz');
    }
  });
});
