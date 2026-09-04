/**
 * VenueOS Sports — public board ETag/304 + per-request serverTime (Trust
 * wave, 2026-08-06).
 *
 * Proves the four load-bearing behaviours of the conditional board poll:
 *   1. The etag is content-derived and STABLE — identical across cache hits
 *      AND across cache refills of unchanged data, because the volatile
 *      per-request `serverTime` is excluded from the hashed body (the
 *      manifest-ETag rule). A baked-in clock would rotate the tag every
 *      fill and kill every 304.
 *   2. The etag CHANGES when the content changes (score write → explicit
 *      invalidate + new hash), so a poller holding the old tag gets a 200.
 *   3. `serverTime` in the body is per-REQUEST fresh (raw Date.now(), NOT
 *      the value baked into the 1s cache) — even on cache hits, and without
 *      mutating the shared cached object. Raw Date.now() is the invariant,
 *      not a shortcut: serverTime must share Game.clockUpdatedAt's clock
 *      domain (see the CLOCK-DOMAIN INVARIANT note on getBoardWithMeta).
 *   4. The controller speaks RFC-9110 conditional GET: matching
 *      If-None-Match → empty 304; otherwise 200 + ETag + X-Server-Time +
 *      Cache-Control on every response; unknown id still 404s. Tags are
 *      minted WEAK (`W/"…"` — §8.8.3: serverTime varies per request within
 *      one tag) and compared weakly (§13.1.2).
 *
 * Mocked-prisma pattern copied from sports.service.spec.ts; the controller
 * is `new`ed directly (guards aren't evaluated on direct method invocation
 * — same rationale as sponsor-impression.spec.ts).
 */
import { NotFoundException } from '@nestjs/common';
import { SportsService } from './sports.service';
import { SportsBoardController } from './sports-board.controller';

// ── in-memory Prisma fake (trimmed copy of sports.service.spec.ts) ────

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('gte' in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ('lt' in v) return Number(row[k]) < Number(v.lt);
      return false;
    }
    return row[k] === v;
  });
}

function applyData(row: any, data: any) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as any)) {
      row[k] = (row[k] ?? 0) + (v as any).increment;
    } else {
      row[k] = v;
    }
  }
}

function makeTable(defaults: Record<string, any> = {}) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = rows.filter((r) => matches(r, where || {}));
      if (orderBy) {
        const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
        out = out.slice().sort((a, b) => {
          for (const clause of clauses) {
            for (const [k, dir] of Object.entries(clause)) {
              const av = a[k], bv = b[k];
              let cmp = 0;
              if (av instanceof Date || bv instanceof Date) cmp = new Date(av).getTime() - new Date(bv).getTime();
              else if (av < bv) cmp = -1;
              else if (av > bv) cmp = 1;
              if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
            }
          }
          return 0;
        });
      }
      if (typeof skip === 'number') out = out.slice(skip);
      if (typeof take === 'number') out = out.slice(0, take);
      return out;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where || {})).length,
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: any) => {
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((d) =>
        rows.push({ id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...d }),
      );
      return { count: arr.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('Row not found');
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

const TENANT = 'tenant-1';

function setup() {
  const game = makeTable({ homeScore: 0, awayScore: 0 });
  const gameEvent = makeTable();
  const screen = makeTable();
  const sponsor = makeTable();
  const rosterPlayer = makeTable();
  const customCue = makeTable();
  const auditLog = makeTable();
  const template = makeTable();
  const client: any = { game, gameEvent, screen, sponsor, rosterPlayer, customCue, auditLog, template };
  // Simple pass-through $transaction — no failure paths are exercised here.
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  const prisma = { client };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer = { signMessage: jest.fn(() => ({ eventId: 'e', signature: 's' })) };
  const sponsorsService = { listActive: jest.fn().mockResolvedValue([]) };
  const flags = { isEnabledAsync: jest.fn().mockResolvedValue(false) };
  // Advancing fake replica clock — serverTime now comes from raw Date.now()
  // (the clock-domain invariant: it must match Game.clockUpdatedAt's
  // domain). Each call is distinct, so "fresh per request" stays
  // distinguishable from "baked into the cache". The 100ms step keeps two
  // consecutive getBoardWithMeta calls (a handful of Date.now() reads each)
  // comfortably inside the 1s board-cache TTL, so cache-hit assertions
  // still exercise the hit path. Restored in afterEach.
  let tick = Date.now();
  const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => (tick += 100));
  const service = new SportsService(
    prisma as any,
    redis as any,
    signer as any,
    sponsorsService as any,
    flags as any,
  );
  // SEC-007 — the controller now also mints beacon capabilities, which needs
  // Prisma to resolve the game's tenant before trusting a device credential.
  const controller = new SportsBoardController(service, redis as any, prisma as any);
  return { service, controller, dateNowSpy, game };
}

afterEach(() => {
  jest.restoreAllMocks();
});

async function newGame(service: SportsService) {
  return service.createGame(TENANT, { sport: 'football', homeTeam: 'Home', awayTeam: 'Away' });
}

/** Minimal Express Response double for the passthrough @Res pattern. */
function mkRes() {
  return { setHeader: jest.fn(), status: jest.fn() };
}

function headerValue(res: ReturnType<typeof mkRes>, name: string): string | undefined {
  const call = res.setHeader.mock.calls.find(([k]: any[]) => k === name);
  return call?.[1];
}

// ── service: etag + serverTime semantics ───────────────────────────────

describe('SportsService — getBoardWithMeta (ETag + per-request serverTime)', () => {
  it('etag is stable across cache hits AND across a refill of unchanged data', async () => {
    const { service } = setup();
    const g = await newGame(service);

    const a = await service.getBoardWithMeta(g.id);
    const b = await service.getBoardWithMeta(g.id); // cache hit
    expect(a.etag).toMatch(/^W\/"[0-9a-f]{16}"$/); // WEAK, quoted per RFC 9110 §8.8.3
    expect(b.etag).toBe(a.etag);

    // Force a refill (as if the 1s TTL lapsed): the freshly-built payload
    // bakes a NEW serverTime, but the hash excludes it — same content, same
    // tag. This is the assertion that keeps 304s alive across cache cycles.
    (service as any).boardCache.delete(g.id);
    const c = await service.getBoardWithMeta(g.id);
    expect(c.etag).toBe(a.etag);
  });

  it('etag changes after a score write (invalidation + changed content)', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const before = await service.getBoardWithMeta(g.id);

    // Within the same tick the 1s TTL cannot lapse — so this also proves the
    // write path explicitly invalidates the cache (stale-hit would repeat
    // the old etag AND the old score).
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 7 });
    const after = await service.getBoardWithMeta(g.id);
    expect(after.payload.homeScore).toBe(7);
    expect(after.etag).not.toBe(before.etag);
  });

  it('serverTime in the body is fresh per call even on cache hits, without mutating the cached object', async () => {
    const { service } = setup();
    const g = await newGame(service);

    const a = await service.getBoardWithMeta(g.id);
    const b = await service.getBoardWithMeta(g.id); // cache hit — same etag
    expect(b.etag).toBe(a.etag);
    // The advancing Date.now mock steps 100ms per call — each response
    // carries its OWN raw-replica-clock sample, not the one baked at
    // cache fill (clock-domain invariant: same domain as clockUpdatedAt).
    expect(typeof a.payload.serverTime).toBe('number');
    expect(b.payload.serverTime).toBeGreaterThan(a.payload.serverTime);

    // Spread, not mutation: the shared cached payload keeps its original
    // baked-in serverTime (the Date.now() sample from getBoardFresh).
    const cached = (service as any).boardCache.get(g.id).payload;
    expect(cached.serverTime).not.toBe(b.payload.serverTime);
  });

  it('getBoard (legacy delegate) still returns the payload with fresh serverTime', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const meta = await service.getBoardWithMeta(g.id);
    const board: any = await service.getBoard(g.id);
    expect(board.id).toBe(g.id);
    expect(board.homeTeam).toBe('Home');
    expect(board.serverTime).toBeGreaterThan(meta.payload.serverTime);
  });
});

// ── controller: RFC-9110 conditional GET ───────────────────────────────

describe('SportsBoardController — GET board/:id conditional poll', () => {
  it('no If-None-Match → 200 payload + ETag + X-Server-Time + Cache-Control (back-compat)', async () => {
    const { controller, service } = setup();
    const g = await newGame(service);
    const res = mkRes();

    const body: any = await controller.board(g.id, undefined, res as any);
    expect(body.id).toBe(g.id);
    expect(body.serverTime).toEqual(expect.any(Number)); // deployed boards read the body
    expect(headerValue(res, 'ETag')).toMatch(/^W\/"[0-9a-f]{16}"$/);
    expect(headerValue(res, 'X-Server-Time')).toMatch(/^\d+$/);
    expect(headerValue(res, 'Cache-Control')).toBe('no-cache');
    expect(res.status).not.toHaveBeenCalled(); // default 200
  });

  it('matching If-None-Match → 304, empty body, headers still present', async () => {
    const { controller, service } = setup();
    const g = await newGame(service);
    const first = mkRes();
    await controller.board(g.id, undefined, first as any);
    const etag = headerValue(first, 'ETag')!;

    const res = mkRes();
    const body = await controller.board(g.id, etag, res as any);
    expect(body).toBeUndefined(); // passthrough @Res + no return value = empty body
    expect(res.status).toHaveBeenCalledWith(304);
    // A 304 still refreshes the board's clock skew + revalidation state.
    expect(headerValue(res, 'ETag')).toBe(etag);
    expect(headerValue(res, 'X-Server-Time')).toMatch(/^\d+$/);
    expect(headerValue(res, 'Cache-Control')).toBe('no-cache');

    // RFC 9110 §13.1.2 — weak comparison + list form must also match: a
    // client still holding the STRONG form of the same opaque tag (a
    // pre-weak-mint deploy, or a proxy that stripped the prefix) must
    // revalidate to a 304 too.
    const strongForm = etag.replace(/^W\//, '');
    const weak = mkRes();
    expect(await controller.board(g.id, `"zzz", ${strongForm}`, weak as any)).toBeUndefined();
    expect(weak.status).toHaveBeenCalledWith(304);
  });

  it('non-matching If-None-Match → 200 with the full payload', async () => {
    const { controller, service } = setup();
    const g = await newGame(service);
    const res = mkRes();
    const body: any = await controller.board(g.id, '"0123456789abcdef"', res as any);
    expect(body.id).toBe(g.id);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('stale tag after a score write → 200 with the new score, new etag', async () => {
    const { controller, service } = setup();
    const g = await newGame(service);
    const first = mkRes();
    await controller.board(g.id, undefined, first as any);
    const staleTag = headerValue(first, 'ETag')!;

    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 });
    const res = mkRes();
    const body: any = await controller.board(g.id, staleTag, res as any);
    expect(res.status).not.toHaveBeenCalled(); // NOT a 304 — content moved
    expect(body.awayScore).toBe(3);
    expect(headerValue(res, 'ETag')).not.toBe(staleTag);
  });

  it('unknown game id → NotFoundException, no headers set (404 contract unchanged)', async () => {
    const { controller } = setup();
    const res = mkRes();
    await expect(controller.board('no-such-game', undefined, res as any)).rejects.toThrow(
      NotFoundException,
    );
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
