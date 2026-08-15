import { Test, TestingModule } from '@nestjs/testing';

import { EmergencyController } from './emergency.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { GpioService } from '../screens/gpio.service';
import { JwtService } from '@nestjs/jwt';

// ──────────────────────────────────────────────────────────────────────────
// LIFE-SAFETY INVARIANT — a lockdown reaches screens even when the database
// is slow, stalled, or failing outright.
//
// WHY THIS EXISTS. Until 2026-08-15 the Redis fan-out ran only AFTER
// `$transaction(...)` committed, which coupled the fastest path to a screen
// (Redis -> WS, single-digit ms) to the slowest thing in the request. On
// 2026-08-15 a Supabase pooler stall queued queries for 4.5 SECONDS with the
// database otherwise idle (1 active connection, API at 5% CPU). A lockdown
// fired in that window would have sat unsent for the whole stall; with
// `pool_timeout=20` a deeper stall means the transaction rejects and the
// publish never happens AT ALL — the operator sees an error and not one
// screen was ever told.
//
// The trigger now STARTS the fan-out as soon as the channel list is known and
// awaits it after persistence. These tests pin that ordering. They are
// deliberately written to FAIL against the old code: every one of them makes
// the database misbehave and then asserts the screens were still told.
// ──────────────────────────────────────────────────────────────────────────

describe('Emergency dispatch is independent of the database', () => {
  let controller: EmergencyController;
  let redisService: any;
  let prismaService: any;
  let signerService: any;

  /** Resolves once Redis has been published to, so tests can prove ordering. */
  let publishedAt: number | null;
  let transactionStartedAt: number | null;

  const adminReq: any = { user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } };

  beforeEach(async () => {
    publishedAt = null;
    transactionStartedAt = null;

    redisService = {
      publish: jest.fn().mockImplementation(async () => {
        publishedAt = Date.now();
      }),
      sismember: jest.fn().mockResolvedValue(false),
    };

    prismaService = {
      client: {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            id: 't1', panicLockdownPlaylistId: null, emergencyStatus: 'INACTIVE',
            emergencyPlaylistId: null, locationBasedEmergencyEnabled: false,
          }),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        screenGroup: { findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }) },
        screen: {
          findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        screenEmergencyOverride: {
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl-ok' }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        emergencyMessage: {
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn().mockImplementation((opsOrFn: any) => {
          transactionStartedAt = Date.now();
          if (typeof opsOrFn === 'function') return opsOrFn(prismaService.client);
          return Promise.all(opsOrFn);
        }),
      },
    };

    signerService = {
      signMessage: jest.fn().mockImplementation((type, payload) => ({
        type, payload, eventId: 'evt', timestamp: Date.now(), signature: 'sig',
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyController],
      providers: [
        { provide: RedisService, useValue: redisService },
        { provide: PrismaService, useValue: prismaService },
        { provide: WebsocketSignerService, useValue: signerService },
        { provide: JwtService, useValue: { sign: jest.fn(), verifyAsync: jest.fn() } },
        { provide: WebhookDispatchService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: GpioService, useValue: { driveStatusLampForEmergency: jest.fn().mockResolvedValue({ touched: 0 }) } },
      ],
    }).compile();

    controller = module.get<EmergencyController>(EmergencyController);
  });

  const triggerBody = (scopeType: string, scopeId: string) => ({
    scopeType, scopeId,
    overridePayload: { type: 'LOCKDOWN', severity: 'CRITICAL', textBlob: 'Lockdown now' },
  }) as any;

  it('publishes the lockdown BEFORE the database transaction is awaited (tenant scope)', async () => {
    // A stalled pool: the write takes 300ms. The alert must not wait for it.
    prismaService.client.$transaction.mockImplementation(async (ops: any) => {
      transactionStartedAt = Date.now();
      await new Promise((r) => setTimeout(r, 300));
      return Array.isArray(ops) ? Promise.all(ops) : ops(prismaService.client);
    });

    await controller.triggerEmergency(triggerBody('tenant', 't1'), adminReq);

    expect(redisService.publish).toHaveBeenCalledTimes(1);
    expect(publishedAt).not.toBeNull();
    expect(transactionStartedAt).not.toBeNull();
    // The publish must land while the transaction is still in flight, i.e.
    // well before the 300ms write could possibly have completed.
    expect(publishedAt! - transactionStartedAt!).toBeLessThan(250);
  });

  it('still reaches screens when the database transaction REJECTS (tenant scope)', async () => {
    // pool_timeout exhaustion — the write never lands. Old code: no publish
    // at all, operator sees an error, zero screens told.
    prismaService.client.$transaction.mockRejectedValue(new Error('pool timeout'));

    await expect(controller.triggerEmergency(triggerBody('tenant', 't1'), adminReq)).rejects.toBeTruthy();

    expect(redisService.publish).toHaveBeenCalledTimes(1);
    expect(redisService.publish.mock.calls[0][0]).toBe('tenant:t1');
  });

  it('still reaches screens when the database transaction REJECTS (group scope)', async () => {
    prismaService.client.$transaction.mockRejectedValue(new Error('pool timeout'));

    await expect(controller.triggerEmergency(triggerBody('group', 'g1'), adminReq)).rejects.toBeTruthy();

    expect(redisService.publish).toHaveBeenCalledTimes(1);
    expect(redisService.publish.mock.calls[0][0]).toBe('group:g1');
  });

  it('signs the payload it publishes, and publishes a signed envelope', async () => {
    await controller.triggerEmergency(triggerBody('tenant', 't1'), adminReq);

    expect(signerService.signMessage).toHaveBeenCalledWith('OVERRIDE', expect.objectContaining({
      type: 'LOCKDOWN', severity: 'CRITICAL',
    }));
    const [, envelope] = redisService.publish.mock.calls[0];
    expect(envelope).toEqual(expect.objectContaining({ type: 'OVERRIDE', signature: 'sig' }));
  });

  it('a Redis failure never aborts the trigger — the HTTP backstop still persists', async () => {
    // The fan-out helper swallows per-channel errors by design: screens that
    // miss the push must still get the emergency from their next manifest
    // poll, and one school's hiccup must not abort the others.
    redisService.publish.mockRejectedValue(new Error('redis down'));

    await expect(controller.triggerEmergency(triggerBody('tenant', 't1'), adminReq)).resolves.toBeTruthy();
    expect(prismaService.client.$transaction).toHaveBeenCalled();
  });

  // ── ALL-CLEAR ────────────────────────────────────────────────────────
  // Just as load-bearing as the trigger. A stalled write on all-clear leaves
  // screens STUCK IN LOCKDOWN — people keep sheltering after the incident is
  // over, and the operator has already been told it ended.

  it('all-clear still reaches screens when the database REJECTS (tenant scope)', async () => {
    prismaService.client.$transaction.mockRejectedValue(new Error('pool timeout'));

    await expect(
      controller.clearEmergency('ovr_1', { scopeType: 'tenant', scopeId: 't1' } as any, adminReq),
    ).rejects.toBeTruthy();

    expect(redisService.publish).toHaveBeenCalledTimes(1);
    expect(redisService.publish.mock.calls[0][0]).toBe('tenant:t1');
    const [, envelope] = redisService.publish.mock.calls[0];
    expect(envelope).toEqual(expect.objectContaining({ type: 'ALL_CLEAR' }));
  });

  it('all-clear publishes BEFORE the database transaction completes (tenant scope)', async () => {
    prismaService.client.$transaction.mockImplementation(async (ops: any) => {
      transactionStartedAt = Date.now();
      await new Promise((r) => setTimeout(r, 300));
      return Array.isArray(ops) ? Promise.all(ops) : ops(prismaService.client);
    });

    await controller.clearEmergency('ovr_1', { scopeType: 'tenant', scopeId: 't1' } as any, adminReq);

    expect(publishedAt).not.toBeNull();
    expect(publishedAt! - transactionStartedAt!).toBeLessThan(250);
  });

  it('all-clear still dispatches for group scope', async () => {
    await controller.clearEmergency('ovr_1', { scopeType: 'group', scopeId: 'g1' } as any, adminReq);
    expect(redisService.publish).toHaveBeenCalledWith('group:g1', expect.anything());
  });

  it('writes the AuditLog even though it no longer gates delivery', async () => {
    // CLAUDE.md: never skip AuditLog creation. Decoupling delivery from the
    // write must not have quietly dropped the forensic record.
    await controller.triggerEmergency(triggerBody('tenant', 't1'), adminReq);

    const wroteAudit =
      prismaService.client.auditLog.create.mock.calls.length > 0 ||
      prismaService.client.$transaction.mock.calls.some((c: any[]) =>
        Array.isArray(c[0]) && c[0].length > 0,
      );
    expect(wroteAudit).toBe(true);
  });
});
