/**
 * THE UNTOUCHED UPDATE CHECK FOLLOWS A WINDOW ARMED IN THE DATABASE — over real HTTP.
 *
 * player-ota.controller.ts is not edited by this feature: it still calls
 * `isFieldCandidateTarget(screen.id, screen.tenantId)` and friends with their
 * default arguments. The window reaches it through FieldWindowGateMiddleware,
 * bound by FieldBuildsModule to the update check and the field download. This
 * boots the REAL controller and the REAL module in a Nest app and sends real
 * requests through supertest, with no PLAYER_APK_FIELD_* variable set — so an
 * offer can only come from the database row. Only the database, the device
 * verifier and the storage read are doubles.
 */
import 'reflect-metadata';
import request from 'supertest';
import { Controller, Get, Global, Logger, Module, Param, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PlayerOtaController } from '../player-ota/player-ota.controller';
import * as field from '../player-ota/field-candidate';
import { FIELD_CANDIDATE_RELEASES } from '../player-ota/field-candidate-releases';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { verifyDeviceForScreen } from '../screens/device-auth';
import { FieldBuildsModule } from './field-builds.module';
import { FieldBuildsService } from './field-builds.service';
import { FieldWindowGateMiddleware, GATE_READ_BUDGET_MS } from './field-window-gate.middleware';

jest.mock('../screens/device-auth', () => ({ verifyDeviceForScreen: jest.fn() }));

const SCREEN = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f01';
const OTHER_SCREEN = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f02';
const TENANT = '1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e01';
const CANDIDATE = '1.1.42-field.1';
const RELEASE = FIELD_CANDIDATE_RELEASES[CANDIDATE];

/** A route the middleware must never touch — the manifest poll's shape. */
@Controller('api/v1/screens')
class ManifestStubController {
  @Get(':id/manifest')
  manifest(@Param('id') id: string) {
    return { id };
  }
}

const saved = { ...process.env };
const realFetch = global.fetch;
let app: INestApplication | undefined;
let windowRow: any;
let screenRow: any;
let prisma: any;
/** Ended, unhandled windows (the expiry release) and the FIELD_BUILD_PUSH rows it reads. */
let endedRows: any[];
let pushRows: any[];

function liveWindow(patch: Record<string, unknown> = {}) {
  return {
    id: 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0',
    candidate: CANDIDATE,
    candidateSha256: RELEASE.sha256,
    tenantIds: [TENANT],
    screenIds: [SCREEN],
    allScreens: false,
    armedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
    armedByUserId: 'super-1',
    armedByEmail: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelledByEmail: null,
    note: null,
    ...patch,
  };
}

async function boot() {
  prisma = {
    client: {
      // What the table "returns" for the newest open window (the query filters
      // cancelled and expired rows, so a test models that by setting null).
      fieldBuildWindow: {
        findFirst: jest.fn(async () => windowRow),
        findMany: jest.fn(async () => endedRows),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      screen: {
        findFirst: jest.fn(async () => screenRow),
        updateMany: jest.fn(async (args: any) => {
          // A push cancel guarded on the push's identity (screen-commands.ts) clears it.
          const guard = args?.where?.forceApkUpdatePendingAt;
          if (guard && args?.data?.forceApkUpdatePendingAt === null) {
            const current = screenRow?.forceApkUpdatePendingAt;
            if (!current || new Date(current).getTime() !== new Date(guard).getTime()) return { count: 0 };
            screenRow = { ...screenRow, forceApkUpdatePendingAt: null };
          }
          return { count: 1 };
        }),
      },
      auditLog: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => pushRows),
        create: jest.fn(async (args: any) => args.data),
      },
      $transaction: jest.fn(async (fn: (tx: any) => unknown) => fn(prisma.client)),
    },
  };
  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: { publish: jest.fn(), sismember: jest.fn(async () => false), publisher: null } },
      { provide: JwtService, useValue: {} },
    ],
    exports: [PrismaService, RedisService, JwtService],
  })
  class FakeInfraModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [FakeInfraModule, FieldBuildsModule],
    controllers: [PlayerOtaController, ManifestStubController],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  // Behind Railway the request arrives as https; the field offer requires it.
  nest.set('trust proxy', true);
  await nest.init();
  app = nest;
  return { http: nest.getHttpServer(), svc: moduleRef.get(FieldBuildsService) };
}

const updateCheck = (http: any, fingerprint = 'fake-fp') =>
  request(http)
    .post('/api/v1/player/update-check')
    .set('Authorization', 'Bearer device-token')
    .set('X-Forwarded-Proto', 'https')
    .send({ fingerprint, versionCode: 10129, versionName: '1.1.29', abi: 'armeabi-v7a' });

beforeEach(() => {
  // The ordinary (stable) path asks GitHub for releases: answer "none", never the network.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
  for (const k of Object.keys(process.env)) if (k.startsWith('PLAYER_APK_FIELD_')) delete process.env[k];
  process.env.DEVICE_SECRET_KEY = 'fake-test-device-key';
  field.setActiveFieldWindow(null);
  windowRow = liveWindow();
  endedRows = [];
  pushRows = [];
  screenRow = {
    id: SCREEN,
    tenantId: TENANT,
    name: 'Bench 1',
    status: 'ONLINE',
    playerVersionCode: 10129,
    forceApkUpdatePendingAt: new Date(),
    tenant: { autoUpdatePlayerEnabled: false, canaryFleetPercent: 100 },
  };
  jest.mocked(verifyDeviceForScreen).mockResolvedValue({ ok: true } as any);
  jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.from('test-only-apk-bytes'));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
  field.setActiveFieldWindow(null);
  process.env = { ...saved };
  global.fetch = realFetch;
});

describe('a window in field_build_windows drives the unchanged update check', () => {
  it('offers the pinned field build to the pushed screen — with no variables set at all', async () => {
    const { http } = await boot();
    const res = await updateCheck(http).expect(201);
    expect(res.body.latest).toMatchObject({
      versionName: CANDIDATE,
      versionCode: RELEASE.versionCode,
      sha256: RELEASE.sha256,
    });
    expect(res.body.latest.apkUrl).toMatch(new RegExp(`^https://[^/]+/api/v1/player/field-apk/${RELEASE.sha256}\\?ticket=`));
    // The controller's own mandatory offer audit still ran.
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PLAYER_FIELD_APK_OFFER', targetId: SCREEN, tenantId: TENANT }) }),
    );
    expect(prisma.client.fieldBuildWindow.findFirst).toHaveBeenCalledTimes(1);
  });

  it('serves the download for that ticket, and refuses it once the window is cancelled', async () => {
    const { http, svc } = await boot();
    const offer = await updateCheck(http).expect(201);
    const path = new URL(offer.body.latest.apkUrl).pathname + new URL(offer.body.latest.apkUrl).search;
    const ok = await request(http)
      .get(path)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect((ok.body as Buffer).toString()).toBe('test-only-apk-bytes');
    // Cancelled: the newest open window is now none. (Another replica would
    // see this within the 10 s cache; here the write's own refresh is forced.)
    windowRow = null;
    await svc.refreshGateWindow(true);
    await request(http).get(path).expect(404);
    expect((await updateCheck(http).expect(201)).body).toEqual({ uptoDate: true });
  });

  it('a screen the window does not name is not a field target (the ordinary path answers it)', async () => {
    const { http } = await boot();
    screenRow = { ...screenRow, id: OTHER_SCREEN };
    const res = await updateCheck(http).expect(201);
    expect(res.body.latest?.versionName).not.toBe(CANDIDATE);
    expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
  });

  it('an expired or cancelled row falls back to the variables, exactly as before', async () => {
    process.env.PLAYER_APK_FIELD_CANDIDATE = '1.1.41-field.1';
    process.env.PLAYER_APK_FIELD_TENANT_ID = TENANT;
    process.env.PLAYER_APK_FIELD_SCREEN_IDS = SCREEN;
    process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(Date.now() + 3_600_000).toISOString();
    windowRow = null;
    const { http } = await boot();
    const res = await updateCheck(http).expect(201);
    expect(res.body.latest).toMatchObject({ versionName: '1.1.41-field.1' });
  });

  it('with the variables AND a live row, the row wins', async () => {
    process.env.PLAYER_APK_FIELD_CANDIDATE = '1.1.41-field.1';
    process.env.PLAYER_APK_FIELD_TENANT_ID = TENANT;
    process.env.PLAYER_APK_FIELD_SCREEN_IDS = SCREEN;
    process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(Date.now() + 3_600_000).toISOString();
    const { http } = await boot();
    const res = await updateCheck(http).expect(201);
    expect(res.body.latest).toMatchObject({ versionName: CANDIDATE });
  });

  it('reads the table only for the update check and the download — never on a manifest poll', async () => {
    const { http, svc } = await boot();
    const spy = jest.spyOn(svc, 'refreshGateWindow');
    await request(http).get(`/api/v1/screens/${SCREEN}/manifest`).expect(200);
    expect(spy).not.toHaveBeenCalled();
    await updateCheck(http).expect(201);
    expect(spy).toHaveBeenCalledTimes(1);
    await request(http).get(`/api/v1/player/field-apk/${RELEASE.sha256}?ticket=bad`).expect(404);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('one cached read for a burst of checks', async () => {
    const { http } = await boot();
    for (let i = 0; i < 5; i++) await updateCheck(http).expect(201);
    expect(prisma.client.fieldBuildWindow.findFirst).toHaveBeenCalledTimes(1);
  });

  it('a window that EXPIRES: its waiting push is cancelled before that screen’s update check is answered', async () => {
    const pushAt = screenRow.forceApkUpdatePendingAt as Date;
    windowRow = liveWindow({ expiresAt: new Date(Date.now() + 400) });
    const { http } = await boot();
    const decisions = jest.spyOn(Logger.prototype, 'log');
    // While the window is open the pushed screen is offered the field build.
    expect((await updateCheck(http).expect(201)).body.latest).toMatchObject({ versionName: CANDIDATE });
    // The window ends with that push still waiting (the screen never installed).
    await new Promise((r) => setTimeout(r, 500));
    windowRow = null;
    endedRows = [{ ...liveWindow(), expiresAt: new Date(Date.now() - 100), expiryHandledAt: null }];
    pushRows = [{ tenantId: TENANT, targetId: SCREEN, details: JSON.stringify({ windowId: endedRows[0].id, pushAt: pushAt.toISOString() }) }];
    decisions.mockClear();
    const res = await updateCheck(http).expect(201);
    expect(res.body).toEqual({ uptoDate: true });
    expect(screenRow.forceApkUpdatePendingAt).toBeNull();
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'FIELD_BUILD_PUSH_CANCEL', targetId: SCREEN, userId: null }) }),
    );
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'FIELD_BUILD_WINDOW_EXPIRE', tenantId: TENANT }) }),
    );
    // The controller's own verdict: it saw NO push at all — not a stable install, nothing.
    const line = decisions.mock.calls.map((c) => String(c[0])).find((l) => l.includes('[ota] decision='));
    expect(line).toMatch(/decision=uptoDate .*reason=no-force-flag/);
  });

  it('a failed read never fails the update check', async () => {
    const { http } = await boot();
    prisma.client.fieldBuildWindow.findFirst.mockRejectedValueOnce(new Error('db unavailable'));
    await updateCheck(http).expect(201);
  });
});

describe('FieldWindowGateMiddleware', () => {
  it('never holds a request longer than its budget on a slow read', async () => {
    jest.useFakeTimers();
    try {
      const svc = { refreshGateWindow: jest.fn(() => new Promise<void>(() => undefined)) };
      const mw = new FieldWindowGateMiddleware(svc as any);
      const next = jest.fn();
      const done = mw.use({}, {}, next);
      await jest.advanceTimersByTimeAsync(GATE_READ_BUDGET_MS - 1);
      expect(next).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await done;
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('calls next even when the read throws', async () => {
    const svc = { refreshGateWindow: jest.fn(async () => { throw new Error('boom'); }) };
    const next = jest.fn();
    await new FieldWindowGateMiddleware(svc as any).use({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
