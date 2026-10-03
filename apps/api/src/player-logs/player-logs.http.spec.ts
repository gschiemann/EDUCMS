/**
 * The diagnostics upload OVER REAL HTTP (2026-10-03).
 *
 * The APK posts its log as `Content-Type: text/plain; charset=utf-8`
 * (LogFileOps.java). The controller spec hands the handler a body that is
 * already a string, which skips the one layer that was broken: with only the
 * global JSON and form parsers mounted, Express 5 left a text/plain body
 * `undefined`, so every upload in production was stored as empty — no
 * PLAYER_RECOVERY_EVENT and no PLAYER_DIAGNOSTICS_CRASH row was ever written.
 *
 * This boots the real controller in a Nest app wired like main.ts (rawBody,
 * the route-scoped parser, then the global json/urlencoded) and sends real
 * requests through supertest. Only the device verifier and the stores are
 * doubles.
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { json, urlencoded } from 'express';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PlayerLogsController } from './player-logs.controller';
import { mountPlayerLogsBodyParser } from './player-logs-body';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { verifyDeviceForScreen } from '../screens/device-auth';

jest.mock('../screens/device-auth', () => ({
  verifyDeviceForScreen: jest.fn(),
}));
const verify = jest.mocked(verifyDeviceForScreen);

const SCREEN = '00000000-0000-4000-8000-0000000000aa';
const TENANT = '00000000-0000-4000-8000-0000000000bb';
const MARKER =
  '2026-09-29T17:35:00.000Z [ERROR] RendererRecovery: PLAYER_RENDERER_TERMINATED slot=primary didCrash=false failures=1 retryMs=2000';

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function boot(opts: { withRouteParser: boolean }) {
  const create = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve(args.data),
  );
  const moduleRef = await Test.createTestingModule({
    controllers: [PlayerLogsController],
    providers: [
      {
        provide: PrismaService,
        useValue: { client: { auditLog: { create } } },
      },
      { provide: RedisService, useValue: { publisher: null } },
    ],
  }).compile();
  // main.ts: NestFactory.create(AppModule, { rawBody: true }), then the
  // route-scoped mounts, then the global parsers.
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  if (opts.withRouteParser) mountPlayerLogsBodyParser(app);
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));
  await app.init();
  const http = app.getHttpServer() as Parameters<typeof request>[0];
  return { http, create };
}

function upload(http: Parameters<typeof request>[0], body: string) {
  return request(http)
    .post(`/api/v1/player-logs/${SCREEN}`)
    .set('Authorization', 'Bearer device-token')
    .set('Content-Type', 'text/plain; charset=utf-8')
    .send(body);
}

beforeEach(() => {
  verify.mockReset();
  verify.mockResolvedValue({
    ok: true,
    sub: SCREEN,
    tenantId: TENANT,
  } as never);
});

it('WITHOUT the route parser (the wiring before this fix) a text/plain upload arrives empty and nothing is stored', async () => {
  const { http, create } = await boot({ withRouteParser: false });
  const res = await upload(http, `routine line\n${MARKER}`);
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ stored: true, rows: 0 });
  expect(create).not.toHaveBeenCalled();
});

it('with the route parser the same upload is parsed and its recovery event is stored', async () => {
  const { http, create } = await boot({ withRouteParser: true });
  const res = await upload(http, `routine line\n${MARKER}`);
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ stored: true, rows: 1 });
  expect(create).toHaveBeenCalledTimes(1);
  const data = create.mock.calls[0][0].data;
  expect(data).toMatchObject({
    tenantId: TENANT,
    targetId: SCREEN,
    action: 'PLAYER_RECOVERY_EVENT',
  });
  const details = JSON.parse(String(data.details)) as { log: string };
  expect(details.log).toBe(MARKER);
});

it('a JVM crash in the parsed body writes the crash record', async () => {
  const { http, create } = await boot({ withRouteParser: true });
  const res = await upload(
    http,
    '2026-09-29T17:40:00.000Z [CRASH] UncaughtException: FATAL EXCEPTION: main\njava.lang.IllegalStateException: boom',
  );
  expect(res.body).toEqual({ stored: true, rows: 1 });
  expect(create.mock.calls[0][0].data).toMatchObject({
    action: 'PLAYER_DIAGNOSTICS_CRASH',
  });
});

it('a body over 1 MB is refused by the parser before the handler or the verifier runs', async () => {
  const { http, create } = await boot({ withRouteParser: true });
  const res = await upload(http, 'x'.repeat(1_048_577));
  expect(res.status).toBe(413);
  expect(verify).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it('main.ts mounts the route parser BEFORE the global JSON parser', () => {
  const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
  const mount = main.indexOf('mountPlayerLogsBodyParser(app)');
  const globalJson = main.indexOf("expressBody.json({ limit: '5mb' })");
  expect(mount).toBeGreaterThan(-1);
  expect(globalJson).toBeGreaterThan(-1);
  expect(mount).toBeLessThan(globalJson);
});
