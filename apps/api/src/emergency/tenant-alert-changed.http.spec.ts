/**
 * EMG-01 review round 1 (2026-11-21) — the 409 ALERT_CHANGED OVER REAL HTTP.
 *
 * emergency.alert-identity.spec.ts calls `clearEmergency()` directly, which
 * skips what only exists at the HTTP layer: the production global
 * AllExceptionsFilter (main.ts), which reduces every error to
 * `{ error, code, message }`. The review proved that a plain
 * ConflictException lost `currentAlert` there, so the dashboard and /panic
 * could never say WHICH alert replaced the one the operator meant to end.
 *
 * Here the REAL EmergencyController is booted with the REAL RbacGuard, the
 * production global filter exactly as main.ts registers it, and a stand-in
 * for JwtAuthGuard, over the stateful in-memory store of
 * emergency.targeting.world.ts — the same rows the real manifest reads.
 */
import 'reflect-metadata';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { GpioService } from '../screens/gpio.service';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import {
  invalidateTenantState,
  resetManifestCacheForTests,
} from '../screens/manifest-hot-cache';
import { resetEmergencyRevForTests } from '../screens/emergency-rev';
import { EmergencyController } from './emergency.controller';
import {
  TenantAlertChangedConflict,
  TenantAlertChangedConflictFilter,
  alertChangedWireBody,
} from './tenant-alert-changed.filter';
import {
  alertChangedBody,
  CLEAR_REFUSED_ACTION,
} from './tenant-alert-identity';
import {
  DISTRICT,
  OTHER,
  SCHOOL,
  SCHOOL_IDS,
  SIBLING,
  delegatedStaff,
  emergencyMap,
  makeWorld,
  only,
  schoolAdmin,
} from './emergency.targeting.world';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const live = (type: string) =>
  ({
    scopeType: 'tenant',
    scopeId: SCHOOL,
    overridePayload: { type, severity: 'CRITICAL' },
  }) as any;

/** Stands in for JwtAuthGuard: the school admin. RbacGuard stays REAL. */
class TestSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().user = {
      ...schoolAdmin.user,
      schoolId: SCHOOL,
    };
    return true;
  }
}

async function boot(
  w: ReturnType<typeof makeWorld>,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [EmergencyController],
    providers: [
      { provide: PrismaService, useValue: { client: w.client } },
      { provide: RedisService, useValue: w.redis },
      {
        provide: WebsocketSignerService,
        useValue: {
          signMessage: (type: string, payload: any) => ({
            type,
            payload,
            signature: 'sig',
            timestamp: Date.now(),
          }),
        },
      },
      { provide: WebhookDispatchService, useValue: { dispatch: jest.fn() } },
      {
        provide: GpioService,
        useValue: {
          driveStatusLampForEmergency: jest.fn(() =>
            Promise.resolve({ touched: 0 }),
          ),
        },
      },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new TestSessionGuard())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  // Exactly as main.ts registers it.
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-alert-changed-http');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER])
    invalidateTenantState(id);
});

describe('the all-clear handler carries the ALERT_CHANGED filter, and only it', () => {
  it('EmergencyController.clearEmergency', () => {
    expect(
      Reflect.getMetadata(
        EXCEPTION_FILTERS_METADATA,
        // Read for its decorator metadata only; never called.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        EmergencyController.prototype.clearEmergency,
      ),
    ).toEqual([TenantAlertChangedConflictFilter]);
  });

  it('the wire body is named primitives only, nested and flat', () => {
    const body = alertChangedBody(
      SCHOOL,
      {
        emergencyStatus: 'CRITICAL',
        emergencyType: 'LOCKDOWN',
        emergencyIsDrill: false,
        emergencyAlertId: 'ov-lockdown',
        emergencyTriggeredAt: new Date('2026-11-21T10:00:00.000Z'),
        // Anything else on the row never reaches the wire.
        ...({ emergencyPlaylistId: 'pl-secret' } as any),
      },
      'ov-hold',
    );
    expect(new TenantAlertChangedConflict(body).getStatus()).toBe(409);
    const wire = alertChangedWireBody(body, 'rid-1');
    expect(wire).toEqual({
      error: true,
      code: 'ALERT_CHANGED',
      message: expect.stringContaining('A newer LOCKDOWN alert is active'),
      requestedAlertId: 'ov-hold',
      currentAlert: {
        alertId: 'ov-lockdown',
        scopeType: 'tenant',
        scopeId: SCHOOL,
        type: 'LOCKDOWN',
        severity: 'CRITICAL',
        isDrill: false,
        triggeredAt: '2026-11-21T10:00:00.000Z',
      },
      currentAlertId: 'ov-lockdown',
      currentAlertType: 'LOCKDOWN',
      currentAlertSeverity: 'CRITICAL',
      currentAlertIsDrill: false,
      currentAlertTriggeredAt: '2026-11-21T10:00:00.000Z',
      requestId: 'rid-1',
    });
    expect(JSON.stringify(wire)).not.toContain('pl-secret');
  });
});

describe('POST /api/v1/emergency/:overrideId/all-clear — over real HTTP', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('a stale id: 409 with the NEWER alert on the wire, and the Lockdown stays on every screen', async () => {
    const w = makeWorld();
    const hold: any = await w.emergency.triggerEmergency(
      live('hold'),
      schoolAdmin,
    );
    const lockdown: any = await w.emergency.triggerEmergency(
      live('lockdown'),
      delegatedStaff,
    );
    app = await boot(w);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/emergency/${hold.overrideId}/all-clear`)
      .send({ scopeType: 'tenant', scopeId: SCHOOL });

    expect(res.status).toBe(409);
    // What the browser receives — the review's failing case.
    expect(res.body).toMatchObject({
      error: true,
      code: 'ALERT_CHANGED',
      requestedAlertId: hold.overrideId,
      currentAlert: {
        alertId: lockdown.overrideId,
        scopeType: 'tenant',
        scopeId: SCHOOL,
        type: 'LOCKDOWN',
        isDrill: false,
      },
      currentAlertId: lockdown.overrideId,
      currentAlertType: 'LOCKDOWN',
      currentAlertIsDrill: false,
    });
    expect(typeof res.body.currentAlertTriggeredAt).toBe('string');
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyType: 'LOCKDOWN',
      emergencyAlertId: lockdown.overrideId,
    });
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect(
      w.auditLogs.filter((a) => a.action === CLEAR_REFUSED_ACTION),
    ).toHaveLength(1);
  });

  it('the matching id: 200, cleared', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('hold'), schoolAdmin);
    const lockdown: any = await w.emergency.triggerEmergency(
      live('lockdown'),
      delegatedStaff,
    );
    app = await boot(w);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/emergency/${lockdown.overrideId}/all-clear`)
      .send({ scopeType: 'tenant', scopeId: SCHOOL });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyStatus: 'INACTIVE',
      emergencyAlertId: null,
    });
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('another error from the same handler keeps the global envelope (no extra fields)', async () => {
    const w = makeWorld();
    app = await boot(w);
    // A school admin aiming at a tenant that is not theirs: 403 from the scope gate.
    const res = await request(app.getHttpServer())
      .post('/api/v1/emergency/ov-x/all-clear')
      .send({ scopeType: 'tenant', scopeId: OTHER });
    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'message']);
  });
});
