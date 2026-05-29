/**
 * VenueOS Sports — sponsor impression write-path tests (P0, 2026-05-28).
 * ──────────────────────────────────────────────────────────────────────
 *
 * The proof-of-play ACCOUNTABILITY loop was double-broken: the public
 * board/ribbon POST `/sports/sponsors/:sponsorId/impression`, but the
 * controller's old class-level `@UseGuards(JwtAuthGuard, RbacGuard)` made
 * every anonymous POST 401, so `SponsorImpression` was never written and
 * the real per-game report (`gameReport`) was permanently all-zeros.
 *
 * These tests prove the two load-bearing behaviours of the fix:
 *   1. The `:sponsorId/impression` controller route accepts an ANONYMOUS
 *      POST (no req.user) and writes a `SponsorImpression` row. Like
 *      pos-webhook.spec.ts, we `new` the controller (not a TestingModule)
 *      so its method-level guards on the OTHER routes never drag
 *      JwtService/Reflector into the DI graph — guards aren't evaluated
 *      when a controller method is invoked directly.
 *   2. `recordImpression` validates server-side: it writes only when the
 *      sponsor and game resolve to the SAME tenant, so an anonymous caller
 *      cannot forge cross-tenant rows (unknown sponsor / unknown game /
 *      tenant mismatch all write nothing).
 *   3. `gameReport` then aggregates those rows into real per-surface
 *      counts with cap-compliance — the renewal-closing proof.
 */
import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RedisService } from '../realtime/redis.service';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-evil';

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      return false;
    }
    return row[k] === v;
  });
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where || {})),
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, ts: new Date(), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function setup() {
  const sponsor = makeTable();
  const game = makeTable();
  const sponsorImpression = makeTable();
  const auditLog = makeTable();
  const prisma = { client: { sponsor, game, sponsorImpression, auditLog } };
  const service = new SponsorsService(prisma as any);
  // `new` the controller directly so the method-level guards on the other
  // routes are never wired into the DI graph (mirrors pos-webhook.spec.ts).
  const controller = new SponsorsController(service);
  return { service, controller, sponsor, game, sponsorImpression };
}

/** Seed a tenant-1 sponsor + tenant-1 game that legitimately pair up. */
function seedValidPair(sponsor: ReturnType<typeof makeTable>, game: ReturnType<typeof makeTable>) {
  sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Joe Pizza', weight: 1, active: true });
  game.rows.push({ id: 'game-1', tenantId: TENANT, status: 'LIVE', startedAt: new Date(), endedAt: null });
}

describe('SponsorsController — POST :sponsorId/impression (PUBLIC route)', () => {
  it('accepts an ANONYMOUS POST (no req.user) and writes a SponsorImpression row', async () => {
    const { controller, sponsor, game, sponsorImpression } = setup();
    seedValidPair(sponsor, game);

    // NOTE: no `@Request() req` is passed — the public board sends no auth.
    // recordImpression is fire-and-forget (void, not awaited in the
    // controller), so flush the microtask queue before asserting the write.
    const res = await controller.impression('sp1', { gameId: 'game-1', surfaceKind: 'board' });
    expect(res).toEqual({ ok: true });

    await new Promise((r) => setImmediate(r));
    expect(sponsorImpression.rows).toHaveLength(1);
    expect(sponsorImpression.rows[0]).toMatchObject({
      sponsorId: 'sp1',
      gameId: 'game-1',
      surfaceKind: 'board',
    });
  });

  it('clamps an unknown surfaceKind to "board" (never trusts the client blindly)', async () => {
    const { controller, sponsor, game, sponsorImpression } = setup();
    seedValidPair(sponsor, game);
    await controller.impression('sp1', { gameId: 'game-1', surfaceKind: 'billboard' });
    await new Promise((r) => setImmediate(r));
    // controller maps any surfaceKind not in [board,ribbon,scorebug] → 'board'
    expect(sponsorImpression.rows[0].surfaceKind).toBe('board');
  });

  it('400s when gameId is missing — bad client payload, not a silent write', async () => {
    const { controller, sponsorImpression } = setup();
    await expect(controller.impression('sp1', {})).rejects.toBeInstanceOf(HttpException);
    await expect(controller.impression('sp1', {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('per-game rate-limits the beacon: 80/10s pass, the 81st is 429 (Audit 37-infra R-1)', async () => {
    const { controller, sponsor, game } = setup();
    seedValidPair(sponsor, game);
    // 80 impressions for the same game id all succeed.
    for (let i = 0; i < 80; i++) {
      const res = await controller.impression('sp1', { gameId: 'game-1', surfaceKind: 'board' });
      expect(res).toEqual({ ok: true });
    }
    // The 81st within the same 10s window is throttled — there is NO nginx
    // layer on Railway, so this in-process limit is the only ceiling besides
    // the global 600/min/IP.
    await expect(
      controller.impression('sp1', { gameId: 'game-1', surfaceKind: 'board' }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('rate-limit is per-game — a flood on game-1 does not throttle game-2', async () => {
    const { controller, sponsor, game } = setup();
    seedValidPair(sponsor, game);
    game.rows.push({ id: 'game-2', tenantId: TENANT, status: 'LIVE', startedAt: new Date(), endedAt: null });
    for (let i = 0; i < 80; i++) {
      await controller.impression('sp1', { gameId: 'game-1' });
    }
    // game-1 is now exhausted, but game-2 has its own fresh window.
    await expect(
      controller.impression('sp1', { gameId: 'game-1' }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    const res = await controller.impression('sp1', { gameId: 'game-2' });
    expect(res).toEqual({ ok: true });
  });
});

describe('SponsorsService — recordImpression (cross-tenant hardening)', () => {
  it('writes a row for a same-tenant sponsor+game pair', async () => {
    const { service, sponsor, game, sponsorImpression } = setup();
    seedValidPair(sponsor, game);
    await service.recordImpression('sp1', 'game-1', 'ribbon');
    expect(sponsorImpression.rows).toHaveLength(1);
    expect(sponsorImpression.rows[0].surfaceKind).toBe('ribbon');
  });

  it('writes NOTHING for an unknown sponsorId', async () => {
    const { service, sponsor, game, sponsorImpression } = setup();
    seedValidPair(sponsor, game);
    await service.recordImpression('does-not-exist', 'game-1', 'board');
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('writes NOTHING for an unknown gameId', async () => {
    const { service, sponsor, game, sponsorImpression } = setup();
    seedValidPair(sponsor, game);
    await service.recordImpression('sp1', 'no-such-game', 'board');
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('writes NOTHING when the sponsor and game belong to DIFFERENT tenants (forgery)', async () => {
    const { service, sponsor, game, sponsorImpression } = setup();
    // sponsor in tenant-1, game in tenant-evil — an anonymous caller must
    // not be able to attribute one tenant's sponsor to another's game.
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Joe Pizza', weight: 1, active: true });
    game.rows.push({ id: 'victim-game', tenantId: OTHER_TENANT, status: 'LIVE', startedAt: new Date() });
    await service.recordImpression('sp1', 'victim-game', 'board');
    expect(sponsorImpression.rows).toHaveLength(0);
  });

  it('writes NOTHING for empty ids', async () => {
    const { service, sponsorImpression } = setup();
    await service.recordImpression('', 'game-1', 'board');
    await service.recordImpression('sp1', '', 'board');
    expect(sponsorImpression.rows).toHaveLength(0);
  });
});

describe('SponsorsService — gameReport aggregates real impressions', () => {
  it('counts impressions per surface and flags cap-compliance', async () => {
    const { service, sponsor, game, sponsorImpression } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Title Co', weight: 1, active: true, frequencyCapPerHour: null });
    game.rows.push({
      id: 'game-1',
      tenantId: TENANT,
      status: 'FINAL',
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(),
      updatedAt: new Date(),
    });
    // Two board looks + one ribbon look recorded during the game.
    sponsorImpression.rows.push(
      { id: 'i1', sponsorId: 'sp1', gameId: 'game-1', surfaceKind: 'board' },
      { id: 'i2', sponsorId: 'sp1', gameId: 'game-1', surfaceKind: 'board' },
      { id: 'i3', sponsorId: 'sp1', gameId: 'game-1', surfaceKind: 'ribbon' },
    );

    const report = await service.gameReport(TENANT, 'game-1');
    expect(report).not.toBeNull();
    const row = report!.sponsors.find((s) => s.sponsorId === 'sp1')!;
    expect(row.board).toBe(2);
    expect(row.ribbon).toBe(1);
    // scorebug is NOT a reported surface (FIX 3) — no per-scorebug column.
    expect((row as Record<string, unknown>).scorebug).toBeUndefined();
    expect(row.total).toBe(3);
    // uncapped sponsor → always compliant
    expect(row.capCompliant).toBe(true);
  });

  it('still counts a stray scorebug impression toward total (no surface lost) but adds no column', async () => {
    const { service, sponsor, game, sponsorImpression } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Title Co', weight: 1, active: true, frequencyCapPerHour: null });
    game.rows.push({
      id: 'game-1', tenantId: TENANT, status: 'FINAL',
      startedAt: new Date(Date.now() - 3_600_000), endedAt: new Date(), updatedAt: new Date(),
    });
    sponsorImpression.rows.push(
      { id: 'i1', sponsorId: 'sp1', gameId: 'game-1', surfaceKind: 'board' },
      { id: 'i2', sponsorId: 'sp1', gameId: 'game-1', surfaceKind: 'scorebug' },
    );
    const report = await service.gameReport(TENANT, 'game-1');
    const row = report!.sponsors.find((s) => s.sponsorId === 'sp1')!;
    expect(row.board).toBe(1);
    expect(row.ribbon).toBe(0);
    expect(row.total).toBe(2); // board + the stray scorebug, folded into total
  });

  it('returns null for a game in another tenant (tenant-scoped)', async () => {
    const { service, game } = setup();
    game.rows.push({ id: 'game-1', tenantId: OTHER_TENANT, status: 'FINAL', startedAt: new Date(), endedAt: new Date(), updatedAt: new Date() });
    expect(await service.gameReport(TENANT, 'game-1')).toBeNull();
  });
});

/**
 * RUNTIME reachability proof (CLAUDE.md rule #21 — verify, don't claim).
 *
 * The unit tests above call controller methods directly, which bypasses the
 * guard chain entirely. This block boots a REAL Nest HTTP app with the REAL
 * SponsorsController (carrying its real guard decorators) and the REAL
 * JwtAuthGuard / RbacGuard wired in, then fires actual HTTP requests with
 * NO Authorization header to prove the routing/guard layer:
 *   - `POST :sponsorId/impression` is reachable anonymously (NOT 401), and
 *   - a CRUD route (`GET /sports/sponsors`) still 401s without a token —
 *     proving the guards are wired and ONLY the impression route is exempt.
 */
describe('SponsorsController — runtime guard reachability (no auth header)', () => {
  let app: INestApplication;
  let recordImpression: jest.Mock;

  beforeAll(async () => {
    recordImpression = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [SponsorsController],
      providers: [
        // Stub service — we only need recordImpression to observe the call.
        { provide: SponsorsService, useValue: { recordImpression, list: jest.fn() } },
        // Real guards. JwtAuthGuard rejects a request with NO token before
        // it touches Redis, so the mocked deps below are never exercised on
        // the 401 path — they only need to exist so Nest can construct it.
        JwtAuthGuard,
        RbacGuard,
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: RedisService, useValue: { sismember: jest.fn(), getTokenInvalidBefore: jest.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts an anonymous POST to :sponsorId/impression (route is PUBLIC, not 401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sports/sponsors/sp1/impression')
      .send({ gameId: 'game-1', surfaceKind: 'board' });
    expect(res.status).toBe(201); // Nest default for POST; the point is: NOT 401
    expect(res.body).toEqual({ ok: true });
    expect(recordImpression).toHaveBeenCalledWith('sp1', 'game-1', 'board');
  });

  it('still 401s a guarded CRUD route (GET /sports/sponsors) with no token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/sports/sponsors');
    expect(res.status).toBe(401);
  });
});
