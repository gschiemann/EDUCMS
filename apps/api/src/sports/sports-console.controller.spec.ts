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
 *   7. SCOPES (K12-F34 + K12-F16, one permission model): every scope ×
 *      every route, per sport — a refused action is 403 SPORTS_CONSOLE_SCOPE
 *      and the delegated method is never called; a pre-scope link is `full`
 *      and keeps exactly its original five routes.
 *   8. The volunteer duty routes forward only VALIDATED DTOs (stat policy,
 *      penalty presets, clock resets) through the command pipeline.
 *   9. Undo is this LINK's own latest action only — the actor handed to the
 *      service is the verified token's fingerprint, never caller input.
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
import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { SportsConsoleController } from './sports-console.controller';
import { SportsService } from './sports.service';
import { consoleTokenFingerprint } from './game-command';
import {
  CONSOLE_SCOPES,
  makeConsoleToken,
  verifyConsoleToken,
  verifyConsoleTokenScope,
  type ConsoleScope,
} from './sports-console-token';
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

/** Unique per-test client IPs — the pre-verify limiter keys on the client
 *  address, so sharing one across tests would share its window too. With
 *  TRUSTED_PROXY_HOPS unset the resolver clamps a short X-Forwarded-For
 *  chain to its leftmost entry, so a single-entry header IS the client. */
let ipSeq = 0;
function newIp(): string {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}
function reqFrom(ip: string = newIp()) {
  return {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  } as any;
}

function makeSportsMock(
  meta?: Partial<{
    tenantId: string;
    consoleTokenVersion: number;
    sport: string;
    status: string;
    homeTeam: string;
    awayTeam: string;
  }> | null,
) {
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
    setShotClock: jest.fn().mockResolvedValue({ ok: 'shot' }),
    setPlayClock: jest.fn().mockResolvedValue({ ok: 'play' }),
    updateStats: jest.fn().mockResolvedValue({ ok: 'stats' }),
    setPossession: jest.fn().mockResolvedValue({ ok: 'possession' }),
    setPenalties: jest.fn().mockResolvedValue({ ok: 'penalties' }),
    undoConsoleAction: jest
      .fn()
      .mockResolvedValue({ ok: true, undoOf: 'ev-1', originalType: 'SCORE' }),
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
    const methods = Object.getOwnPropertyNames(
      SportsConsoleController.prototype,
    ).sort();
    // Adding ANY method to this controller must fail here and force a
    // security review of the new route + its CSRF exemption posture.
    expect(methods).toEqual(
      [
        'authorize',
        'clock',
        'constructor',
        'cue',
        'penalties',
        'playClock',
        'possession',
        'score',
        'segment',
        'session',
        'shotClock',
        'stats',
        'throwInvalid',
        'throwRateLimited',
        'throwRejected',
        'timeout',
        'undo',
      ].sort(),
    );
  });
});

/** The command context every console route passes: a console actor, no id. */
const CONSOLE_CTX = expect.objectContaining({
  actor: expect.objectContaining({
    kind: 'console',
    ref: expect.stringMatching(/^console-link:[0-9a-f]{16}$/),
  }),
  commandId: null,
  expectedSegment: null,
});

describe('SportsConsoleController — delegation with server-resolved tenant', () => {
  it('session verifies the token and returns the public identity block', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    const out = await ctl.session(tok, reqFrom());
    expect(out).toEqual({
      ok: true,
      gameId,
      scope: 'full',
      allows: ['score', 'clock', 'segment', 'timeout', 'cue'],
      sport: 'basketball',
      status: 'LIVE',
      homeTeam: 'Home',
      awayTeam: 'Away',
    });
    expect(sports.getConsoleShareMeta).toHaveBeenCalledWith(gameId);
  });

  it('score with delta → adjustScore(tenantFromGame, gameId, dto) WITH suppressAutoFinal — going FINAL stays operator-only', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.score(tok, { team: 'home', delta: 3 }, reqFrom());
    expect(sports.adjustScore).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { team: 'home', delta: 3 },
      CONSOLE_CTX,
      { suppressAutoFinal: true },
    );
    expect(sports.setScore).not.toHaveBeenCalled();
  });

  it('K12-F10/F34: the command id rides through; the actor is the LINK, by fingerprint — never the token', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.score(
      tok,
      { team: 'away', delta: 2, commandId: 'cmd-console-0001' } as any,
      reqFrom(),
    );
    const [, , dto, ctx] = sports.adjustScore.mock.calls[0];
    expect(dto).toEqual({ team: 'away', delta: 2 });
    expect(ctx.commandId).toBe('cmd-console-0001');
    expect(ctx.actor.kind).toBe('console');
    expect(ctx.actor.ref).toMatch(/^console-link:[0-9a-f]{16}$/);
    // The token (and its MAC) must never be what we record.
    expect(JSON.stringify(ctx)).not.toContain(tok);
    expect(JSON.stringify(ctx)).not.toContain(tok.split('.')[4]);
  });

  it('score without delta → setScore (absolute typo-fix path)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.score(tok, { homeScore: 21, awayScore: 14 }, reqFrom());
    expect(sports.setScore).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { homeScore: 21, awayScore: 14 },
      CONSOLE_CTX,
    );
    expect(sports.adjustScore).not.toHaveBeenCalled();
  });

  it('clock / segment / timeout delegate with the same DTO shapes as the authed controller', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.clock(tok, { action: 'start' }, reqFrom());
    expect(sports.clockAction).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { action: 'start' },
      CONSOLE_CTX,
    );
    await ctl.clock(tok, { action: 'set', ms: 480_000 }, reqFrom());
    expect(sports.clockAction).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { action: 'set', ms: 480_000 },
      CONSOLE_CTX,
    );
    await ctl.segment(tok, { delta: 1 }, reqFrom());
    expect(sports.setSegment).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { delta: 1 },
      CONSOLE_CTX,
    );
    await ctl.timeout(tok, { team: 'away' }, reqFrom());
    expect(sports.callTimeout).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { team: 'away' },
      CONSOLE_CTX,
    );
  });

  it('cue forwards ONLY {key, cueId, team} — injection channels stripped', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await ctl.cue(
      tok,
      {
        key: 'touchdown',
        team: 'home',
        // Hostile extras a leaked-link holder might send:
        audioUrl: 'https://evil.example/blast.mp3',
        sponsorName: 'EVIL',
        sponsorLogoUrl: 'https://evil.example/logo.png',
        scorerName: 'x',
        scorerPhotoUrl: 'https://evil.example/x.png',
        target: 'BOARD',
      } as any,
      reqFrom(),
    );
    expect(sports.fireCue).toHaveBeenCalledTimes(1);
    // K12-F34: the cue is attributed to the issued link (fingerprint only).
    expect(sports.fireCue).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { key: 'touchdown', team: 'home' },
      CONSOLE_CTX,
    );
    const dto = sports.fireCue.mock.calls[0][2];
    expect(Object.keys(dto).sort()).toEqual(['key', 'team']);
  });
});

// K12-F34 — the link's scope is the permission, per route.
describe('SportsConsoleController — link scopes', () => {
  async function refused(p: Promise<unknown>) {
    await expect(p).rejects.toMatchObject({ status: 403 });
    await p.catch((e: any) =>
      expect(e.getResponse()).toMatchObject({ code: 'SPORTS_CONSOLE_SCOPE' }),
    );
  }

  it('a SCORER link scores, calls timeouts and celebrates, but cannot run the clock or change the period', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'scorer' });
    await ctl.score(tok, { team: 'home', delta: 2 }, reqFrom());
    await ctl.timeout(tok, { team: 'home' }, reqFrom());
    await ctl.cue(tok, { key: 'dunk' }, reqFrom());
    await refused(ctl.clock(tok, { action: 'start' }, reqFrom()));
    await refused(ctl.segment(tok, { delta: 1 }, reqFrom()));
    expect(sports.adjustScore).toHaveBeenCalledTimes(1);
    expect(sports.callTimeout).toHaveBeenCalledTimes(1);
    expect(sports.fireCue).toHaveBeenCalledTimes(1);
    expect(sports.clockAction).not.toHaveBeenCalled();
    expect(sports.setSegment).not.toHaveBeenCalled();
  });

  it('a TIMER link runs the clock and the period, but cannot touch the score', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'timer' });
    await ctl.clock(tok, { action: 'start' }, reqFrom());
    await ctl.segment(tok, { delta: 1 }, reqFrom());
    await refused(ctl.score(tok, { homeScore: 99 }, reqFrom()));
    await refused(ctl.cue(tok, { key: 'dunk' }, reqFrom()));
    expect(sports.clockAction).toHaveBeenCalledTimes(1);
    expect(sports.setSegment).toHaveBeenCalledTimes(1);
    expect(sports.setScore).not.toHaveBeenCalled();
    expect(sports.fireCue).not.toHaveBeenCalled();
  });

  it('a PRESENTATION link fires cues and nothing else', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'presentation' });
    await ctl.cue(tok, { key: 'dunk' }, reqFrom());
    await refused(ctl.score(tok, { team: 'home', delta: 1 }, reqFrom()));
    await refused(ctl.timeout(tok, { team: 'home' }, reqFrom()));
    expect(sports.fireCue).toHaveBeenCalledTimes(1);
    expect(sports.adjustScore).not.toHaveBeenCalled();
    expect(sports.callTimeout).not.toHaveBeenCalled();
  });

  it('session tells the pad what the link may do', async () => {
    const gameId = newGameId();
    const ctl = makeController(makeSportsMock());
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'timer' });
    const out = await ctl.session(tok, reqFrom());
    expect(out).toMatchObject({
      scope: 'timer',
      allows: ['clock', 'segment', 'timeout'],
    });
  });
});

describe('SportsConsoleController — token gate', () => {
  it('a token minted at v0 401s once the game row says v1, and nothing delegates', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ consoleTokenVersion: 1 });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await expectHttpError(
      ctl.score(tok, { team: 'home', delta: 2 }, reqFrom()),
      401,
    );
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
      await expectHttpError(
        ctl.score(bad, { team: 'home', delta: 1 }, reqFrom()),
        401,
      );
    }
    expect(sports.getConsoleShareMeta).not.toHaveBeenCalled();
    expect(sports.adjustScore).not.toHaveBeenCalled();
  });

  it('a well-shaped token for a MISSING game gets the same 401 (no existence oracle)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock(null);
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await expectHttpError(ctl.session(tok, reqFrom()), 401);
    expect(sports.getConsoleShareMeta).toHaveBeenCalledWith(gameId);
  });

  it('a tampered MAC 401s even at the right version', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    const parts = tok.split('.');
    parts[4] = (parts[4][0] === 'f' ? 'e' : 'f') + parts[4].slice(1);
    await expectHttpError(
      ctl.clock(parts.join('.'), { action: 'start' }, reqFrom()),
      401,
    );
    expect(sports.clockAction).not.toHaveBeenCalled();
  });
});

// ── K12-F34 + K12-F16 — one scope model, every scope × every route ──────

type RouteName =
  | 'score'
  | 'clock'
  | 'segment'
  | 'timeout'
  | 'cue'
  | 'stats'
  | 'possession'
  | 'penalties'
  | 'shotClock'
  | 'playClock';

/** Each route, called with a benign body valid for `sport`; 'ok' or the status. */
async function tryEveryRoute(
  ctl: SportsConsoleController,
  tok: string,
  sport: string,
) {
  const attempt = async (p: () => Promise<unknown>) => {
    try {
      await p();
      return 'ok';
    } catch (e: any) {
      return e?.status ?? 'error';
    }
  };
  const statsBody: Record<string, Record<string, number | string>> = {
    basketball: { homeFouls: 1 },
    football: { homeTimeouts: 2 },
    hockey: { homeShots: 3 },
    volleyball: { serving: 'home' },
    baseball: { balls: 1 },
  };
  const penaltyBody: Record<string, { lenSec: number; label: string }> = {
    hockey: { lenSec: 120, label: 'Minor' },
  };
  const out: Record<RouteName, string | number> = {
    score: await attempt(() =>
      ctl.score(tok, { team: 'home', delta: 1 }, reqFrom()),
    ),
    clock: await attempt(() => ctl.clock(tok, { action: 'start' }, reqFrom())),
    segment: await attempt(() => ctl.segment(tok, { delta: 1 }, reqFrom())),
    timeout: await attempt(() => ctl.timeout(tok, { team: 'home' }, reqFrom())),
    cue: await attempt(() => ctl.cue(tok, { key: 'goal' }, reqFrom())),
    stats: await attempt(() =>
      ctl.stats(
        tok,
        { stats: statsBody[sport] ?? { homeFouls: 1 } },
        reqFrom(),
      ),
    ),
    possession: await attempt(() =>
      ctl.possession(tok, { team: 'away' }, reqFrom()),
    ),
    penalties: await attempt(() =>
      ctl.penalties(
        tok,
        {
          action: 'add',
          team: 'home',
          ...(penaltyBody[sport] ?? { lenSec: 120, label: 'Minor' }),
        },
        reqFrom(),
      ),
    ),
    shotClock: await attempt(() =>
      ctl.shotClock(tok, { action: 'start' }, reqFrom()),
    ),
    playClock: await attempt(() =>
      ctl.playClock(tok, { action: 'start' }, reqFrom()),
    ),
  };
  return out;
}

const O = 'ok';
const X = 403;

describe('SportsConsoleController — every scope × every route (K12-F34 + K12-F16)', () => {
  // The whole matrix, per sport. A 403 is the scope gate refusing; the
  // delegated service method is never reached (asserted per case below).
  const MATRIX: Record<
    string,
    Record<ConsoleScope, Record<RouteName, string | number>>
  > = {
    basketball: {
      full: {
        score: O,
        clock: O,
        segment: O,
        timeout: O,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      table: {
        score: O,
        clock: O,
        segment: O,
        timeout: O,
        cue: O,
        stats: O,
        possession: O,
        penalties: X,
        shotClock: O,
        playClock: X,
      },
      scorer: {
        score: O,
        clock: X,
        segment: X,
        timeout: O,
        cue: O,
        stats: O,
        possession: O,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      timer: {
        score: X,
        clock: O,
        segment: O,
        timeout: O,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      shot: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: O,
        playClock: X,
      },
      presentation: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
    },
    football: {
      full: {
        score: O,
        clock: O,
        segment: O,
        timeout: O,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      table: {
        score: O,
        clock: O,
        segment: O,
        timeout: O,
        cue: O,
        stats: O,
        possession: O,
        penalties: X,
        shotClock: X,
        playClock: O,
      },
      scorer: {
        score: O,
        clock: X,
        segment: X,
        timeout: O,
        cue: O,
        stats: O,
        possession: O,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      timer: {
        score: X,
        clock: O,
        segment: O,
        timeout: O,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      shot: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: O,
      },
      presentation: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
    },
    hockey: {
      full: {
        score: O,
        clock: O,
        segment: O,
        timeout: X,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      table: {
        score: O,
        clock: O,
        segment: O,
        timeout: X,
        cue: O,
        stats: O,
        possession: X,
        penalties: O,
        shotClock: X,
        playClock: X,
      },
      scorer: {
        score: O,
        clock: X,
        segment: X,
        timeout: X,
        cue: O,
        stats: O,
        possession: X,
        penalties: O,
        shotClock: X,
        playClock: X,
      },
      timer: {
        score: X,
        clock: O,
        segment: O,
        timeout: X,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      shot: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      presentation: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
    },
    volleyball: {
      full: {
        score: O,
        clock: X,
        segment: O,
        timeout: X,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      table: {
        score: O,
        clock: X,
        segment: O,
        timeout: X,
        cue: O,
        stats: O,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      scorer: {
        score: O,
        clock: X,
        segment: O,
        timeout: X,
        cue: O,
        stats: O,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      timer: {
        score: X,
        clock: X,
        segment: O,
        timeout: X,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      shot: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: X,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
      presentation: {
        score: X,
        clock: X,
        segment: X,
        timeout: X,
        cue: O,
        stats: X,
        possession: X,
        penalties: X,
        shotClock: X,
        playClock: X,
      },
    },
  };

  for (const [sport, perScope] of Object.entries(MATRIX)) {
    for (const scope of CONSOLE_SCOPES) {
      it(`${sport} · ${scope}: exactly its routes, every other route 403 SPORTS_CONSOLE_SCOPE and never delegated`, async () => {
        const gameId = newGameId();
        const sports = makeSportsMock({ sport });
        const ctl = makeController(sports);
        const tok = makeConsoleToken(gameId, { version: 0, scope });
        const got = await tryEveryRoute(ctl, tok, sport);
        expect({ sport, scope, ...got }).toEqual({
          sport,
          scope,
          ...perScope[scope],
        });
        // A refused route never reaches the service; an allowed one reaches
        // exactly its own method, once.
        const delegate: Record<RouteName, jest.Mock[]> = {
          score: [sports.adjustScore, sports.setScore],
          clock: [sports.clockAction],
          segment: [sports.setSegment],
          timeout: [sports.callTimeout],
          cue: [sports.fireCue],
          stats: [sports.updateStats],
          possession: [sports.setPossession],
          penalties: [sports.setPenalties],
          shotClock: [sports.setShotClock],
          playClock: [sports.setPlayClock],
        };
        for (const [route, mocks] of Object.entries(delegate) as Array<
          [RouteName, jest.Mock[]]
        >) {
          const calls = mocks.reduce((n, m) => n + m.mock.calls.length, 0);
          expect({ route, calls }).toEqual({
            route,
            calls: perScope[scope][route] === O ? 1 : 0,
          });
        }
      });
    }
  }

  it('the 403 names the refused action and the scope — never 401 (which the pad reads as revoked)', async () => {
    const gameId = newGameId();
    const ctl = makeController(makeSportsMock({ sport: 'basketball' }));
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'timer' });
    const err = await ctl
      .score(tok, { team: 'home', delta: 3 }, reqFrom())
      .catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.getResponse()).toMatchObject({
      code: 'SPORTS_CONSOLE_SCOPE',
      scope: 'timer',
      action: 'score',
    });
  });

  it('a pre-scope link (minted with no scope) is full: its original five routes, never the new duties', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ sport: 'basketball' });
    const ctl = makeController(sports);
    const legacy = makeConsoleToken(gameId, { version: 0 });
    expect(verifyConsoleTokenScope(gameId, legacy, 0)).toBe('full');
    expect(await tryEveryRoute(ctl, legacy, 'basketball')).toEqual(
      MATRIX.basketball.full,
    );
  });

  it('a revoked scoped link is 401 (revoked), never 403 (not permitted)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({
      sport: 'basketball',
      consoleTokenVersion: 1,
    });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'timer' });
    await expectHttpError(
      ctl.score(tok, { team: 'home', delta: 2 }, reqFrom()),
      401,
    );
    await expectHttpError(ctl.clock(tok, { action: 'start' }, reqFrom()), 401);
    await expectHttpError(
      ctl.undo(tok, { undoOf: 'cmd-0123456789' }, reqFrom()),
      401,
    );
    expect(sports.clockAction).not.toHaveBeenCalled();
    expect(sports.undoConsoleAction).not.toHaveBeenCalled();
  });

  it('a tampered scope is refused: a scope added as text, or an edited MAC, is 401', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ sport: 'basketball' });
    const ctl = makeController(sports);
    const parts = makeConsoleToken(gameId, {
      version: 0,
      scope: 'timer',
    }).split('.');
    // A readable 6th field (the retired B1 shape) is not even token-shaped.
    const relabelled = [...parts.slice(0, 4), 'table', parts[4]].join('.');
    await expectHttpError(
      ctl.score(relabelled, { team: 'home', delta: 2 }, reqFrom()),
      401,
    );
    // A one-character edit of the MAC never lands on another scope.
    const edited = [
      ...parts.slice(0, 4),
      (parts[4][0] === 'a' ? 'b' : 'a') + parts[4].slice(1),
    ].join('.');
    await expectHttpError(
      ctl.stats(edited, { stats: { homeFouls: 1 } }, reqFrom()),
      401,
    );
    expect(sports.adjustScore).not.toHaveBeenCalled();
    expect(sports.updateStats).not.toHaveBeenCalled();
    // The 6-part shape was refused before any DB read; the edited MAC after one.
    expect(sports.getConsoleShareMeta).toHaveBeenCalledTimes(1);
  });

  it('session reports the scope and what it may do IN THIS SPORT (the pad renders exactly this)', async () => {
    const gameId = newGameId();
    const ctl = makeController(makeSportsMock({ sport: 'football' }));
    expect(
      await ctl.session(
        makeConsoleToken(gameId, { version: 0, scope: 'shot' }),
        reqFrom(),
      ),
    ).toMatchObject({
      scope: 'shot',
      allows: ['playClock'],
    });
    expect(
      await ctl.session(
        makeConsoleToken(gameId, { version: 0, scope: 'table' }),
        reqFrom(),
      ),
    ).toMatchObject({
      scope: 'table',
      allows: [
        'score',
        'clock',
        'segment',
        'timeout',
        'cue',
        'stats',
        'possession',
        'playClock',
      ],
    });
  });

  it('baseball (no game clock): the scorer owns the inning counter, and nobody runs a clock', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ sport: 'baseball' });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'scorer' });
    await ctl.segment(tok, { delta: 1 }, reqFrom());
    expect(sports.setSegment).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { delta: 1 },
      CONSOLE_CTX,
    );
    await expectHttpError(ctl.clock(tok, { action: 'start' }, reqFrom()), 403);
  });
});

describe('SportsConsoleController — volunteer duty routes (K12-F16)', () => {
  function setup(sport: string, scope: ConsoleScope = 'table') {
    const gameId = newGameId();
    const sports = makeSportsMock({ sport });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope });
    return { gameId, sports, ctl, tok };
  }

  it('every duty rides the command pipeline: the command id passes through, the actor is this link', async () => {
    const { gameId, sports, ctl, tok } = setup('basketball', 'table');
    await ctl.stats(
      tok,
      { stats: { homeFouls: 5 }, commandId: 'cmd-stats-0001' } as any,
      reqFrom(),
    );
    await ctl.possession(
      tok,
      { team: 'away', commandId: 'cmd-poss-0001' } as any,
      reqFrom(),
    );
    await ctl.shotClock(
      tok,
      { action: 'reset', value: 24, commandId: 'cmd-shot-0001' } as any,
      reqFrom(),
    );
    const fp = `console-link:${consoleTokenFingerprint(tok)}`;
    for (const [mock, id] of [
      [sports.updateStats, 'cmd-stats-0001'],
      [sports.setPossession, 'cmd-poss-0001'],
      [sports.setShotClock, 'cmd-shot-0001'],
    ] as Array<[jest.Mock, string]>) {
      const [tenant, gid, dto, ctx] = mock.mock.calls[0];
      expect(tenant).toBe(TENANT);
      expect(gid).toBe(gameId);
      expect(dto).not.toHaveProperty('commandId');
      expect(ctx).toMatchObject({
        commandId: id,
        actor: { kind: 'console', ref: fp },
      });
    }
  });

  it('stats: a valid write is forwarded as the VALIDATED object only', async () => {
    const { gameId, sports, ctl, tok } = setup('basketball', 'scorer');
    await ctl.stats(
      tok,
      { stats: { homeFouls: 5, awayTimeouts: 2 } },
      reqFrom(),
    );
    expect(sports.updateStats).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { stats: { homeFouls: 5, awayTimeouts: 2 } },
      CONSOLE_CTX,
    );
  });

  it('stats: config keys, structured arrays, free text and out-of-range values are 400 with the keys named', async () => {
    const { sports, ctl, tok } = setup('basketball', 'scorer');
    for (const stats of [
      { celebrationPack: 'v1' },
      { playerFouls: [{ team: 'home', jersey: 3, fouls: 5 }] },
      { shotClock: { len: 0, ms: 0, running: false } },
      { homeFouls: 31 },
      { homeFouls: 5, feed: { x: 1 } },
    ]) {
      await expect(ctl.stats(tok, { stats }, reqFrom())).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'SPORTS_CONSOLE_STAT_REJECTED',
        }),
      });
    }
    const wrestling = setup('wrestling', 'scorer');
    await expect(
      wrestling.ctl.stats(
        wrestling.tok,
        { stats: { weightClass: 'anything' } },
        reqFrom(),
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ rejected: ['weightClass'] }),
    });
    expect(sports.updateStats).not.toHaveBeenCalled();
    expect(wrestling.sports.updateStats).not.toHaveBeenCalled();
  });

  it('shot clock: start / stop / reset pass; configure (setup) and out-of-range resets are refused', async () => {
    const { gameId, sports, ctl, tok } = setup('basketball', 'shot');
    await ctl.shotClock(tok, { action: 'reset', value: 35 }, reqFrom());
    expect(sports.setShotClock).toHaveBeenLastCalledWith(
      TENANT,
      gameId,
      { action: 'reset', value: 35 },
      CONSOLE_CTX,
    );
    await ctl.shotClock(tok, { action: 'stop', value: 999 } as any, reqFrom());
    // a stray value on stop is dropped, never forwarded
    expect(sports.setShotClock).toHaveBeenLastCalledWith(
      TENANT,
      gameId,
      { action: 'stop' },
      CONSOLE_CTX,
    );
    await expectHttpError(
      ctl.shotClock(tok, { action: 'configure', value: 0 }, reqFrom()),
      400,
    );
    await expectHttpError(
      ctl.shotClock(tok, { action: 'reset', value: 36 }, reqFrom()),
      400,
    );
    await expectHttpError(
      ctl.shotClock(tok, { action: 'reset', value: 14.5 }, reqFrom()),
      400,
    );
    expect(sports.setShotClock).toHaveBeenCalledTimes(2);
  });

  it('play clock: the sport presets (40 / 25) and run:false pass; any other value is refused', async () => {
    const { gameId, sports, ctl, tok } = setup('football', 'shot');
    await ctl.playClock(tok, { action: 'reset', value: 40 }, reqFrom());
    expect(sports.setPlayClock).toHaveBeenLastCalledWith(
      TENANT,
      gameId,
      { action: 'reset', value: 40 },
      CONSOLE_CTX,
    );
    await ctl.playClock(
      tok,
      { action: 'reset', value: 25, run: false },
      reqFrom(),
    );
    expect(sports.setPlayClock).toHaveBeenLastCalledWith(
      TENANT,
      gameId,
      { action: 'reset', value: 25, run: false },
      CONSOLE_CTX,
    );
    await expectHttpError(
      ctl.playClock(tok, { action: 'reset', value: 30 }, reqFrom()),
      400,
    );
    await expectHttpError(
      ctl.playClock(
        tok,
        { action: 'reset', value: 25, run: 'no' } as any,
        reqFrom(),
      ),
      400,
    );
    await expectHttpError(
      ctl.playClock(tok, { action: 'pause' }, reqFrom()),
      400,
    );
    expect(sports.setPlayClock).toHaveBeenCalledTimes(2);
  });

  it('possession: home / away only', async () => {
    const { gameId, sports, ctl, tok } = setup('basketball', 'scorer');
    await ctl.possession(tok, { team: 'away' }, reqFrom());
    expect(sports.setPossession).toHaveBeenCalledWith(
      TENANT,
      gameId,
      { team: 'away' },
      CONSOLE_CTX,
    );
    await expectHttpError(
      ctl.possession(tok, { team: 'both' }, reqFrom()),
      400,
    );
  });

  it('penalties: only a sport PRESET can be added (label + length); jersey digits only; clear stays operator-only', async () => {
    const { gameId, sports, ctl, tok } = setup('hockey', 'scorer');
    await ctl.penalties(
      tok,
      {
        action: 'add',
        team: 'away',
        lenSec: 120,
        label: 'Minor',
        player: '17',
      },
      reqFrom(),
    );
    expect(sports.setPenalties).toHaveBeenLastCalledWith(
      TENANT,
      gameId,
      {
        action: 'add',
        team: 'away',
        lenSec: 120,
        label: 'Minor',
        player: '17',
      },
      CONSOLE_CTX,
    );
    // free-text label (a message channel on the public board)
    await expectHttpError(
      ctl.penalties(
        tok,
        { action: 'add', team: 'away', lenSec: 120, label: 'GO TEAM' },
        reqFrom(),
      ),
      400,
    );
    await expectHttpError(
      ctl.penalties(
        tok,
        {
          action: 'add',
          team: 'away',
          lenSec: 120,
          label: 'Minor',
          player: '1a',
        },
        reqFrom(),
      ),
      400,
    );
    await expectHttpError(
      ctl.penalties(tok, { action: 'clear' }, reqFrom()),
      400,
    );
    await ctl.penalties(
      tok,
      { action: 'remove', penaltyId: 'pen_abc_12345' },
      reqFrom(),
    );
    expect(sports.setPenalties).toHaveBeenLastCalledWith(
      TENANT,
      gameId,
      { action: 'remove', penaltyId: 'pen_abc_12345' },
      CONSOLE_CTX,
    );
    expect(sports.setPenalties).toHaveBeenCalledTimes(2);
  });

  it('penalties: the water-polo exclusion flag passes, the player NAME never does', async () => {
    const { sports, ctl, tok } = setup('water_polo', 'scorer');
    await ctl.penalties(
      tok,
      {
        action: 'add',
        team: 'home',
        lenSec: 20,
        label: 'Exclusion :20',
        player: '7',
        exclusion: true,
        playerName: 'anything a volunteer types',
      } as any,
      reqFrom(),
    );
    const dto = sports.setPenalties.mock.calls[0][2];
    expect(dto).toEqual({
      action: 'add',
      team: 'home',
      lenSec: 20,
      label: 'Exclusion :20',
      player: '7',
      exclusion: true,
    });
    expect(dto.playerName).toBeUndefined();
  });
});

describe('SportsConsoleController — undo: this link, its latest action, once', () => {
  it('delegates to undoConsoleAction with the VERIFIED link fingerprint as the actor — never caller input', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ sport: 'basketball' });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0, scope: 'scorer' });
    await ctl.undo(
      tok,
      {
        undoOf: 'cmd-0123456789abcdef',
        actor: { kind: 'user', userId: 'admin' },
      } as any,
      reqFrom(),
    );
    expect(sports.undoConsoleAction).toHaveBeenCalledTimes(1);
    const [tenant, gid, target, ctx] = sports.undoConsoleAction.mock.calls[0];
    expect(tenant).toBe(TENANT);
    expect(gid).toBe(gameId);
    expect(target).toBe('cmd-0123456789abcdef');
    expect(ctx.actor).toEqual({
      kind: 'console',
      ref: `console-link:${consoleTokenFingerprint(tok)}`,
    });
  });

  it('every scope may undo (only ever its own action) — the service decides what it may reach', async () => {
    for (const scope of CONSOLE_SCOPES) {
      const gameId = newGameId();
      const sports = makeSportsMock({ sport: 'basketball' });
      const ctl = makeController(sports);
      await ctl.undo(
        makeConsoleToken(gameId, { version: 0, scope }),
        { undoOf: 'cmd-0123456789' },
        reqFrom(),
      );
      expect({
        scope,
        calls: sports.undoConsoleAction.mock.calls.length,
      }).toEqual({ scope, calls: 1 });
    }
  });

  it('a malformed or missing undoOf is 400 and never reaches the service', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock({ sport: 'basketball' });
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    for (const bad of [
      undefined,
      '',
      'short',
      'x'.repeat(101),
      'has space here',
      42,
      { $ne: null },
    ]) {
      await expectHttpError(
        ctl.undo(tok, { undoOf: bad } as any, reqFrom()),
        400,
      );
    }
    expect(sports.undoConsoleAction).not.toHaveBeenCalled();
  });
});

describe('SportsConsoleController — rate limits (per-IP pre-verify, per-game post-verify)', () => {
  it('40/10s per game for AUTHENTICATED taps, then 429 (rotating tokens for the same game shares the window)', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const tok = makeConsoleToken(gameId, { version: 0 });
    const volunteerIp = newIp();
    for (let i = 0; i < 40; i += 1) {
      await ctl.score(tok, { team: 'home', delta: 1 }, reqFrom(volunteerIp));
    }
    // 41st call — and also prove a FRESH token for the same game doesn't
    // reset the window (the key is the embedded game id, not the token).
    const rotated = makeConsoleToken(gameId, { version: 0, ttlSeconds: 7200 });
    await expectHttpError(
      ctl.score(rotated, { team: 'home', delta: 1 }, reqFrom(volunteerIp)),
      429,
    );
    expect(sports.adjustScore).toHaveBeenCalledTimes(40);
  });

  it("garbage-MAC hammering NEVER spends the volunteer's per-game budget (the lockout the old pre-verify key allowed)", async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const attackerIp = newIp();
    // 50 well-shaped tokens with tampered MACs for the volunteer's game —
    // more than the whole 40/10s game budget. Every one 401s at the MAC
    // gate and spends only the ATTACKER's IP window.
    for (let i = 0; i < 50; i += 1) {
      const tok = makeConsoleToken(gameId, { version: 0 });
      const parts = tok.split('.');
      parts[4] = (parts[4][0] === 'f' ? 'e' : 'f') + parts[4].slice(1);
      await expectHttpError(
        ctl.score(
          parts.join('.'),
          { team: 'home', delta: 1 },
          reqFrom(attackerIp),
        ),
        401,
      );
    }
    // The legitimate volunteer's next tap still goes straight through.
    const good = makeConsoleToken(gameId, { version: 0 });
    await ctl.score(good, { team: 'home', delta: 1 }, reqFrom(newIp()));
    expect(sports.adjustScore).toHaveBeenCalledTimes(1);
  });

  it('one address hammering garbage caps at 80/10s pre-verify — the 81st is 429 with NO DB read', async () => {
    const gameId = newGameId();
    const sports = makeSportsMock();
    const ctl = makeController(sports);
    const attackerIp = newIp();
    for (let i = 0; i < 80; i += 1) {
      const tok = makeConsoleToken(gameId, { version: 0 });
      const parts = tok.split('.');
      parts[4] = (parts[4][0] === 'f' ? 'e' : 'f') + parts[4].slice(1);
      await expectHttpError(
        ctl.score(
          parts.join('.'),
          { team: 'home', delta: 1 },
          reqFrom(attackerIp),
        ),
        401,
      );
    }
    expect(sports.getConsoleShareMeta).toHaveBeenCalledTimes(80);
    const tok = makeConsoleToken(gameId, { version: 0 });
    await expectHttpError(
      ctl.score(tok, { team: 'home', delta: 1 }, reqFrom(attackerIp)),
      429,
    );
    // The capped call was rejected BEFORE the meta read.
    expect(sports.getConsoleShareMeta).toHaveBeenCalledTimes(80);
    expect(sports.adjustScore).not.toHaveBeenCalled();
  });
});

// ── SportsService mint/revoke — the authed pair's engine ────────────────

describe('SportsService — mintConsoleShare / revokeConsoleShare', () => {
  function makeService(gameRow: Record<string, unknown> | null) {
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const game = {
      findFirst: jest.fn(async ({ where }: any) =>
        gameRow &&
        where.id === gameRow.id &&
        where.tenantId === gameRow.tenantId
          ? gameRow
          : null,
      ),
      findUnique: jest.fn(async () => gameRow),
      update: jest.fn(async ({ data }: any) => {
        if (gameRow && data?.consoleTokenVersion?.increment) {
          (gameRow as any).consoleTokenVersion +=
            data.consoleTokenVersion.increment;
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
    // K12-F34: `audited` says whether the revocation's audit row landed.
    expect(out).toEqual({
      success: true,
      consoleTokenVersion: 1,
      audited: true,
    });
    // The pre-revocation token is now dead against the live version.
    expect(
      verifyConsoleToken(gameId, minted.token, row.consoleTokenVersion),
    ).toBe(false);
    const actions = auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain('SPORTS_CONSOLE_SHARE_REVOKED');
  });

  it('K12-F34: a scoped mint returns the scope, and its audit row records it', async () => {
    const gameId = newGameId();
    const row = {
      id: gameId,
      tenantId: TENANT,
      consoleTokenVersion: 0,
      sport: 'basketball',
    };
    const { service, auditLog } = makeService(row);
    const out = await service.mintConsoleShare(
      TENANT,
      gameId,
      'user-9',
      undefined,
      'scorer',
    );
    expect(out.scope).toBe('scorer');
    expect(verifyConsoleTokenScope(gameId, out.token, 0)).toBe('scorer');
    expect(
      JSON.parse(auditLog.create.mock.calls[0][0].data.details).scope,
    ).toBe('scorer');
  });

  it('K12-F16: a table / shot / presentation mint is a five-part link bound to that scope; the audit row records scope + fingerprint', async () => {
    for (const [sport, scope] of [
      ['basketball', 'table'],
      ['football', 'shot'],
      ['basketball', 'presentation'],
    ] as Array<[string, ConsoleScope]>) {
      const gameId = newGameId();
      const row = {
        id: gameId,
        tenantId: TENANT,
        consoleTokenVersion: 0,
        sport,
      };
      const { service, auditLog } = makeService(row);
      const out = await service.mintConsoleShare(
        TENANT,
        gameId,
        'user-9',
        undefined,
        scope,
      );
      expect(out.scope).toBe(scope);
      expect(out.token.split('.')).toHaveLength(5);
      expect(verifyConsoleTokenScope(gameId, out.token, 0)).toBe(scope);
      const details = JSON.parse(auditLog.create.mock.calls[0][0].data.details);
      expect(details).toMatchObject({
        scope,
        linkFingerprint: consoleTokenFingerprint(out.token),
      });
      expect(
        String(auditLog.create.mock.calls[0][0].data.details),
      ).not.toContain(out.token.split('.')[4]);
    }
  });

  it('K12-F16: a scope the sport has no use for is refused at mint, before any audit row (no clock operator for volleyball)', async () => {
    const gameId = newGameId();
    const row = {
      id: gameId,
      tenantId: TENANT,
      consoleTokenVersion: 0,
      sport: 'volleyball',
    };
    const { service, auditLog } = makeService(row);
    for (const scope of ['timer', 'shot'] as ConsoleScope[]) {
      const err = await service
        .mintConsoleShare(TENANT, gameId, 'u', undefined, scope)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'CONSOLE_SCOPE_NOT_FOR_SPORT',
      });
    }
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(
      (await service.mintConsoleShare(TENANT, gameId, 'u', undefined, 'scorer'))
        .scope,
    ).toBe('scorer');
    // `full`, the mint default, is always mintable.
    expect((await service.mintConsoleShare(TENANT, gameId, 'u')).scope).toBe(
      'full',
    );
  });

  it('K12-F34: no audit row, no link — a failed mint audit returns no token', async () => {
    const gameId = newGameId();
    const row = { id: gameId, tenantId: TENANT, consoleTokenVersion: 0 };
    const { service, auditLog } = makeService(row);
    auditLog.create.mockRejectedValueOnce(new Error('audit storage down'));
    await expect(
      service.mintConsoleShare(TENANT, gameId, 'user-9'),
    ).rejects.toThrow('audit storage down');
  });

  it('K12-F34: a revoke still kills the links when its audit write fails, and says so', async () => {
    const gameId = newGameId();
    const row = { id: gameId, tenantId: TENANT, consoleTokenVersion: 0 };
    const { service, auditLog } = makeService(row);
    const minted = await service.mintConsoleShare(TENANT, gameId);
    auditLog.create.mockRejectedValueOnce(new Error('audit storage down'));
    const errors = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    const out = await service.revokeConsoleShare(TENANT, gameId, 'user-9');
    expect(out).toEqual({
      success: true,
      consoleTokenVersion: 1,
      audited: false,
    });
    expect(
      verifyConsoleToken(gameId, minted.token, row.consoleTokenVersion),
    ).toBe(false);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(
        'AUDIT WRITE FAILED for SPORTS_CONSOLE_SHARE_REVOKED',
      ),
    );
  });

  it('both are tenant-scoped — a foreign tenant 404s and nothing mutates', async () => {
    const gameId = newGameId();
    const row = { id: gameId, tenantId: TENANT, consoleTokenVersion: 0 };
    const { service, auditLog, game } = makeService(row);
    await expect(
      service.mintConsoleShare('other-tenant', gameId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.revokeConsoleShare('other-tenant', gameId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(game.update).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(row.consoleTokenVersion).toBe(0);
  });
});
