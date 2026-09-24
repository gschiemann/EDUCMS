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

  it('GYM vertical: evacuate+weather+medical wired → content OK (never graded on K12 lockdown)', async () => {
    // 2026-08-30 operator bug: a gym dashboard warned "can't run a lockdown".
    const { prisma, redis, wsSigner } = makeMocks({
      tenant: {
        vertical: 'GYM',
        // A gym is graded only once someone turned alerts on (2026-09-24).
        emergencyEnabled: true,
        panicEvacuatePlaylistId: 'pl4',
        panicWeatherPlaylistId: 'pl5',
        panicMedicalPlaylistId: 'pl6',
      },
    });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const content = r.items.find((i) => i.key === 'content')!;
    expect(content.status).toBe('ok');
    expect(content.detail).toContain('3 of 3');
    expect(r.verdict).toBe('READY');
  });

  it('GYM vertical: nothing wired → anchor copy says Fire / Evacuate, not Lockdown', async () => {
    const { prisma, redis, wsSigner } = makeMocks({
      tenant: { vertical: 'GYM', emergencyEnabled: true },
    });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const content = r.items.find((i) => i.key === 'content')!;
    expect(content.status).toBe('missing');
    expect(content.fixHint).toContain('Start with Fire / Evacuate');
    expect(content.fixHint).not.toContain('Lockdown');
  });

  // ── Enablement (2026-09-24) ─────────────────────────────────────────
  // Greg: "why are we showing an alert that we cant play emergency content
  // but i havent even enabled it?" OFF is not "not ready" — it is not graded.
  it('GYM vertical, alerts never turned on → DISABLED with no checks, and nothing is probed', async () => {
    const { prisma, redis, wsSigner } = makeMocks({
      tenant: { vertical: 'GYM' },
    });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    expect(r.verdict).toBe('DISABLED');
    expect(r.enabled).toBe(false);
    expect(r.locked).toBe(false);
    expect(r.items).toEqual([]);
    expect(prisma.client.screen.count).not.toHaveBeenCalled();
    expect(prisma.client.$queryRaw).not.toHaveBeenCalled();
    expect(redis.publisher.ping).not.toHaveBeenCalled();
  });

  it('GYM vertical, explicitly OFF → DISABLED; K-12 with a stored false is still graded (the lock wins)', async () => {
    const off = makeMocks({
      tenant: {
        vertical: 'GYM',
        emergencyEnabled: false,
        panicEvacuatePlaylistId: 'pl4',
        panicWeatherPlaylistId: 'pl5',
        panicMedicalPlaylistId: 'pl6',
      },
    });
    const offSvc = new EmergencyReadinessService(
      off.prisma,
      off.redis,
      off.wsSigner,
    );
    const offReport = await offSvc.compute('t1');
    expect(offReport.verdict).toBe('DISABLED');

    const k12 = makeMocks({
      tenant: { vertical: 'K12', emergencyEnabled: false },
    });
    const k12Svc = new EmergencyReadinessService(
      k12.prisma,
      k12.redis,
      k12.wsSigner,
    );
    const r = await k12Svc.compute('t1');
    expect(r.verdict).toBe('NOT_CONFIGURED');
    expect(r.enabled).toBe(true);
    expect(r.locked).toBe(true);
  });

  it('a graded report says so: enabled true, and locked mirrors the vertical', async () => {
    const { prisma, redis, wsSigner } = makeMocks();
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    expect(r.enabled).toBe(true);
    // The default mock tenant stores no vertical → graded as K12 (on), but an
    // unstated industry never LOCKS the toggle, and the report says so.
    expect(r.locked).toBe(false);
    expect(r.verticalStated).toBe(false);
  });

  it('a stated K-12 school is locked and stated', async () => {
    const { prisma, redis, wsSigner } = makeMocks({ tenant: { vertical: 'K12' } });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    expect(r.locked).toBe(true);
    expect(r.verticalStated).toBe(true);
  });

  it('lockdown-only wiring → content WARN naming the missing types', async () => {
    const { prisma, redis, wsSigner } = makeMocks({
      tenant: { panicLockdownPlaylistId: 'pl1' },
    });
    const svc = new EmergencyReadinessService(prisma, redis, wsSigner);
    const r = await svc.compute('t1');
    const content = r.items.find((i) => i.key === 'content')!;
    expect(content.status).toBe('warn');
    expect(content.fixHint).toMatch(/Fire \/ Evacuate/);
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
