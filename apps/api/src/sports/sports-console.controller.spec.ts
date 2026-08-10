/**
 * Phase-2 Domain SHARE — the PUBLIC scorekeeper console controller.
 *
 * What this spec pins down, in threat-model order:
 *   1. THE ALLOWLIST IS CLOSED — the controller's method surface is pinned
 *      exactly (a route added without updating this spec fails CI).
 *   2. Every allowlisted action delegates to the SAME SportsService method
 *      the authed controller uses, with the tenant resolved SERVER-side
 *      from the token's game — never from the caller.
 *   3. The cue body is hard-filtered: audioUrl / sponsor* / scorer* /
 *      target never reach fireCue from this surface.
 *   4. Revocation is live: a token minted at version N 401s the moment the
 *      game row says N+1, and the delegated method is never called.
 *   5. Shape garbage (including real FEED tokens) is rejected BEFORE any
 *      DB read; a missing game and a bad token are the same 401 (no
 *      game-existence oracle).
 *   6. The per-game rate limit fires (in-memory fallback path — redis
 *      publisher null).
 *
 * Direct `new SportsConsoleController(...)` — guards aren't evaluated on
 * direct method invocation (same rationale as sports-board-etag.spec.ts),
 * which is exactly right here: this controller HAS no guards; the token
 * gate inside each handler is the thing under test.
 *
 * Plus: SportsService.mintConsoleShare / revokeConsoleShare (the authed
 * mint/revoke pair's engine) — AuditLog on both, token never logged,
 * tenant scoping, version increment.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { SportsConsoleController } from './sports-console.controller';
import { SportsService } from './sports.service';
import { makeConsoleToken, verifyConsoleToken } from './sports-console-token';
import { makeFeedToken } from './sports-feed-token';
import { _resetIngestRateLimitMemoryForTests } from '../security/ingest-rate-limit';

beforeEach(() => {
  _resetIngestRateLimitMemoryForTests();
});

beforeAll(() => {
  process.env.SPORTS_CONSOLE_SECRET =
    'test_console_secret_0123456789abcdef0123456789abcdef';
  process.env.SPORTS_FEED_SECRET =
    'test_feed_secret_0123456789abcdef0123456789abcdef';
});

const TENANT = 'tenant-1';

/** Unique per-test game ids — the ingest-rate-limit in-memory fallback is
 *  module-scoped, so sharing an id across tests would share its window. */
let gameSeq = 0;
function newGameId(): string {
  gameSeq += 1;
  return `11111111-2222-4333-8444-${String(gameSeq).padStart(12, '0')}`;
}

function makeSportsMock(meta?: Partial<{
  tenantId: string;
  consoleTokenVersion: number;
  sport: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
}> | null) {
  const resolved =
    meta === null
      ? null
      : {
          tenantId: TENANT,
          consoleTokenVersion: 0,
          sport: 'basketball',
          status: 'LIVE',
          homeTeam: 'Home',
          awayTeam: 'Away',
          ...(meta || {}),
        };
  return {
    getConsoleShareMeta: jest.fn().mockResolvedValue(resolved),
    adjustScore: jest.fn().mockResolvedValue({ ok: 'adjust' }),
    setScore: jest.fn().mockResolvedValue({ ok: 'set' }),
    clockAction: jest.fn().mockResolvedValue({ ok: 'clock' }),
    setSegment: jest.fn().mockResolvedValue({ ok: 'segment' }),
    callTimeout: jest.fn().mockResolvedValue({ ok: 'timeout' }),
    fireCue: jest.fn().mockResolvedValue({ ok: 'cue' }),
  };
}

function makeController(sports: ReturnType<typeof makeSportsMock>) {
  // publisher null → checkIngestLimit uses its in-memory fallback.
  return new SportsConsoleController(sports as any, { publisher: null } as any);
}

async function expectHttpError(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toMatchObject({ status });
  await p.catch((e) => expect(e).toBeInstanceOf(HttpException));
}

describe('SportsConsoleController — allowlist surface', () => {
  it('the route surface is EXACTLY the delegated allowlist (closed set)', () => {
    const methods = Object.getOwnPropertyNames(SportsConsoleController.prototype).sort();
    // Adding ANY method to this controller must fail here and force a
    // security review of the new route + its CSRF exemption posture.
    expect(methods).toEqual(
      ['authorize', 'clock', 'constructor', 'cue', 'score', 'segment', 'session', 'throwInvalid', 'timeout'].sort(),
    );
  });
});

describe('SportsConsoleController — delegation with server-resolved tenant', () => {
  it('session verifies the token and returns the public identity block', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    const out = await ctl.session(tok);
    expect(out).toEqual({
      ok: true,
      gameId,
      sport: 'basketball',
      status: 'LIVE',
      homeTeam: 'Home',
      awayTeam: 'Away',
    });
    expect(sports.getConsoleShareMeta).toHaveBeenCalledWith(gameId);
  });

  it('score with delta → adjustScore(tenantFromGame, gameId, dto)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.score(tok, { team: 'home', delta: 3 });
    expect(sports.adjustScore).toHaveBeenCalledWith(TENANT, gameId, { team: 'home', delta: 3 });
    expect(sports.setScore).not.toHaveBeenCalled();
  });

  it('score without delta → setScore (absolute typo-fix path)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.score(tok, { homeScore: 21, awayScore: 14 });
    expect(sports.setScore).toHaveBeenCalledWith(TENANT, gameId, { homeScore: 21, awayScore: 14 });
    expect(sports.adjustScore).not.toHaveBeenCalled();
  });

  it('clock / segment / timeout delegate with the same DTO shapes as the authed controller', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.clock(tok, { action: 'start' });
    expect(sports.clockAction).toHaveBeenCalledWith(TENANT, gameId, { action: 'start' });
    await ctl.clock(tok, { action: 'set', ms: 480_000 });
    expect(sports.clockAction).toHaveBeenCalledWith(TENANT, gameId, { action: 'set', ms: 480_000 });
    await ctl.segment(tok, { delta: 1 });
    expect(sports.setSegment).toHaveBeenCalledWith(TENANT, gameId, { delta: 1 });
    await ctl.timeout(tok, { team: 'away' });
    expect(sports.callTimeout).toHaveBeenCalledWith(TENANT, gameId, { team: 'away' });
  });

  it('cue forwards ONLY {key, cueId, team} — injection channels stripped', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.cue(tok, {
      key: 'touchdown',
      team: 'home',
      // Hostile extras a leaked-link holder might send:
      audioUrl: 'https://evil.example/blast.mp3',
      sponsorName: 'EVIL',
      sponsorLogoUrl: 'https://evil.example/logo.png',
      scorerName: 'x',
      scorerPhotoUrl: 'https://evil.example/x.png',
      target: 'BOARD',
    } as any);
    expect(sports.fireCue).toHaveBeenCalledTimes(1);
    expect(sports.fireCue).toHaveBeenCalledWith(TENANT, gameId, { key: 'touchdown', team: 'home' });
    const dto = sports.fireCue.mock.calls[0][2];
    expect(Object.keys(dto).sort()).toEqual(['key', 'team']);
  });
});

describe('SportsConsoleController — token gate', () => {
  it('a token minted at v0 401s once the game row says v1, and nothing delegates', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ consoleTokenVersion: 1 });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await expectHttpError(ctl.score(tok, { team: 'home', delta: 2 }), 401);
    expect(sports.adjustScore).not.toHaveBeenCalled();
    expect(sports.setScore).not.toHaveBeenCalled();
  });

  it('shape garbage (and real FEED tokens) 401 BEFORE any DB read', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    for (const bad of [
      'garbage',
      makeFeedToken(gameId), // bare feed token
      makeFeedToken(gameId, { version: 0, ttlSeconds: 3600 }), // structured feed token
    ]) {
      await expectHttpError(ctl.score(bad, { team: 'home', delta: 1 }), 401);
    }
    expect(sports.getConsoleShareMeta).not.toHaveBeenCalled();
    expect(sports.adjustScore).not.toHaveBeenCalled();
  });

  it('a well-shaped token for a MISSING game gets the same 401 (no existence oracle)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock(null);
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await expectHttpError(ctl.session(tok), 401);
    expect(sports.getConsoleShareMeta).toHaveBeenCalledWith(gameId);
  });

  it('a tampered MAC 401s even at the right version', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    const parts = tok.split('.');
    parts[4] = (parts[4][0] === 'f' ? 'e' : 'f') + parts[4].slice(1);
    await expectHttpError(ctl.clock(parts.join('.'), { action: 'start' }), 401);
    expect(sports.clockAction).not.toHaveBeenCalled();
  });
});

describe('SportsConsoleController — per-game rate limit', () => {
  it('40/10s per game, then 429 (rotating tokens for the same game shares the window)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    for (let i = 0; i < 40; i += 1) {
      await ctl.score(tok, { team: 'home', delta: 1 });
    }
    // 41st call — and also prove a FRESH token for the same game doesn't
    // reset the window (the key is the embedded game id, not the token).
    const rotated = makeConsoleToken(gameId, { version: 0, ttlSeconds: 7200 });
    await expectHttpError(ctl.score(rotated, { team: 'home', delta: 1 }), 429);
    expect(sports.adjustScore).toHaveBeenCalledTimes(40);
  });
});

// ── SportsService mint/revoke — the authed pair's engine ────────────────

describe('SportsService — mintConsoleShare / revokeConsoleShare', () => {
  function makeService(gameRow: Record<string, unknown> | null) {
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const game = {
      findFirst: jest.fn(async ({ where }: any) =>
        gameRow && where.id === gameRow.id && where.tenantId === gameRow.tenantId ? gameRow : null,
      ),
      findUnique: jest.fn(async () => gameRow),
      update: jest.fn(async ({ data }: any) => {
        if (gameRow && data?.consoleTokenVersion?.increment) {
          (gameRow as any).consoleTokenVersion += data.consoleTokenVersion.increment;
        }
        return gameRow;
      }),
    };
    const prisma = { client: { game, auditLog } };
    const service = new SportsService(
      prisma as any,
      { publish: jest.fn() } as any,
      { signMessage: jest.fn(() => ({ eventId: 'e', signature: 's' })) } as any,
      { listActive: jest.fn().mockResolvedValue([]) } as any,
      { isEnabledAsync: jest.fn().mockResolvedValue(false) } as any,
    );
    return { service, auditLog, game };
  }

  it('mint returns a live token + audits WITHOUT logging the token itself', async () => {
    const gameId = newGameId();
    const row = { id: gameId, tenantId: TENANT, consoleTokenVersion: 0 };
    const { service, auditLog } = makeService(row);
    const out = await service.mintConsoleShare(TENANT, gameId, 'user-9');
    expect(out.success).toBe(true);
    expect(verifyConsoleToken(gameId, out.token, 0)).toBe(true);
    expect(out.tokenTtlSeconds).toBe(24 * 3600);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
    const audit = auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('SPORTS_CONSOLE_SHARE_MINTED');
    expect(audit.userId).toBe('user-9');
    expect(audit.targetId).toBe(gameId);
    // The credential must never land in the (readable) audit trail.
    expect(String(audit.details)).not.toContain(out.token);
    expect(String(audit.details)).not.toContain(out.token.split('.')[4]);
  });

  it('revoke bumps the version (killing v0 tokens) + audits', async () => {
    const gameId = newGameId();
    const row = { id: gameId, tenantId: TENANT, consoleTokenVersion: 0 };
    const { service, auditLog } = makeService(row);
    const minted = await service.mintConsoleShare(TENANT, gameId);
    const out = await service.revokeConsoleShare(TENANT, gameId, 'user-9');
    expect(out).toEqual({ success: true, consoleTokenVersion: 1 });
    // The pre-revocation token is now dead against the live version.
    expect(verifyConsoleToken(gameId, minted.token, row.consoleTokenVersion)).toBe(false);
    const actions = auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain('SPORTS_CONSOLE_SHARE_REVOKED');
  });

  it('both are tenant-scoped — a foreign tenant 404s and nothing mutates', async () => {
    const gameId = newGameId();
    const row = { id: gameId, tenantId: TENANT, consoleTokenVersion: 0 };
    const { service, auditLog, game } = makeService(row);
    await expect(service.mintConsoleShare('other-tenant', gameId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.revokeConsoleShare('other-tenant', gameId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(game.update).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(row.consoleTokenVersion).toBe(0);
  });
});
