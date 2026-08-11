/**
 * VenueOS Sports — schedule game mode (Inputs-wave SCHED, 2026-08-10).
 *
 * Exercises arm/disarm persistence + validation, the claim-by-write sweep
 * (query shape, push flow, SCREEN_IN_USE skip, savedState capture), the
 * FINAL revert (scoping, prevGameId restore, suppressAutoFinal non-fire,
 * pending-push cancel, Show-Control slice-4 scene clear), and the
 * scheduledAt parse contract (both the zone-less legacy form and the
 * zoned ISO form the client now sends). Same in-memory Prisma fake shape
 * as sports.service.spec.ts — no DB required.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SportsService } from './sports.service';

// ── in-memory Prisma fake (sports.service.spec.ts pattern) ─────

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
  // Strictly-increasing createdAt: the auto-push flow appends several
  // AUTO_PUSH events within one millisecond, and `orderBy createdAt desc`
  // over tied timestamps would return the OLDEST (stable sort keeps
  // insertion order) — the exact flake the real DB never has.
  const base = Date.now();
  return {
    rows,
    findFirst: async ({ where }: any = {}) => {
      // Honor `orderBy createdAt desc` for the latest-wins reads.
      const hit = rows.filter((r) => matches(r, where || {}));
      if (hit.length === 0) return null;
      return hit.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where || {})),
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(base + seq), updatedAt: new Date(base + seq), ...defaults, ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: any) => {
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((d) => rows.push({ id: `id-${++seq}`, createdAt: new Date(base + seq), updatedAt: new Date(base + seq), ...defaults, ...d }));
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
  const auditLog = makeTable();
  const rosterPlayer = makeTable();
  const template = makeTable();
  const client: any = { game, gameEvent, screen, auditLog, rosterPlayer, template };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  // Emulate the claim statement: null every due autoPushAt, return the
  // claimed (id, tenant_id) pairs — exactly what the real UPDATE …
  // RETURNING does. Also captures the SQL text for the shape assertion.
  const rawCalls: string[] = [];
  client.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ..._vals: unknown[]) => {
    rawCalls.push(Array.isArray(strings) ? strings.join('?') : String(strings));
    const now = Date.now();
    const due = game.rows.filter(
      (g) => g.autoPushAt instanceof Date && g.autoPushAt.getTime() <= now,
    );
    due.forEach((g) => (g.autoPushAt = null));
    return due.map((g) => ({ id: g.id, tenant_id: g.tenantId }));
  });
  const prisma = { client };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer = { signMessage: jest.fn(() => ({ eventId: 'e', signature: 's' })) };
  const sponsorsService = { listActive: jest.fn().mockResolvedValue([]) };
  const flags = { isEnabledAsync: jest.fn().mockResolvedValue(false) };
  const service = new SportsService(
    prisma as any,
    redis as any,
    signer as any,
    sponsorsService as any,
    flags as any,
  );
  return { service, game, gameEvent, screen, auditLog, redis, signer, rawCalls };
}

const KICKOFF = () => new Date(Date.now() + 60 * 60_000); // an hour out

async function newGame(service: SportsService, opts: { sport?: string; scheduledAt?: string | null } = {}) {
  return service.createGame(TENANT, {
    sport: opts.sport ?? 'football',
    homeTeam: 'Home',
    awayTeam: 'Away',
    scheduledAt: opts.scheduledAt,
  });
}

function seedScreen(screen: ReturnType<typeof makeTable>, id: string, extra: Record<string, any> = {}) {
  screen.rows.push({
    id,
    name: id,
    status: 'ONLINE',
    tenantId: TENANT,
    activeBoardGameId: null,
    activeBoardSurface: null,
    ...extra,
  });
}

// ── scheduledAt parsing — both wire forms ──────────────────────

describe('SportsService — scheduledAt parse (both forms)', () => {
  it('accepts the zoned ISO form the client now sends (exact instant)', async () => {
    const { service } = setup();
    const g: any = await newGame(service, { scheduledAt: '2026-08-21T19:00:00.000Z' });
    expect(new Date(g.scheduledAt).toISOString()).toBe('2026-08-21T19:00:00.000Z');
  });

  it('still accepts the legacy zone-less form (server-zone parse)', async () => {
    const { service } = setup();
    const g: any = await newGame(service, { scheduledAt: '2026-08-21T19:00' });
    // A hand-rolled/old client stays legal: parsed as the SERVER's local
    // 19:00 — the same instant `new Date` yields for the bare string.
    expect(g.scheduledAt).toEqual(new Date('2026-08-21T19:00'));
  });
});

// ── arm / disarm ───────────────────────────────────────────────

describe('SportsService — auto-push arm/disarm', () => {
  it('arms: autoPushAt = scheduledAt − 10 minutes, AUTO_PUSH event + AuditLog row', async () => {
    const { service, game, gameEvent, screen, auditLog } = setup();
    const kickoff = KICKOFF();
    const g: any = await newGame(service, { scheduledAt: kickoff.toISOString() });
    seedScreen(screen, 's1');

    const res: any = await service.setAutoPush(
      TENANT, g.id, { armed: true, screenIds: ['s1'], surface: 'BOARD' }, 'user-1',
    );
    expect(res.armed).toBe(true);
    expect(res.screenIds).toEqual(['s1']);
    expect(res.surface).toBe('BOARD');
    expect(res.leadMs).toBe(10 * 60_000);
    const row = game.rows.find((r) => r.id === g.id);
    expect(row.autoPushAt.getTime()).toBe(new Date(g.scheduledAt).getTime() - 10 * 60_000);
    const ev = gameEvent.rows.find((e) => e.type === 'AUTO_PUSH');
    expect(ev.payload).toMatchObject({ armed: true, screenIds: ['s1'], surface: 'BOARD' });
    const audit = auditLog.rows.find((a) => a.action === 'SPORTS_AUTO_PUSH_ARMED');
    expect(audit).toBeTruthy();
    expect(audit.userId).toBe('user-1');
    expect(JSON.parse(audit.details).screenIds).toEqual(['s1']);
  });

  it('400s arming without a game time, without screens, or with only foreign screens', async () => {
    const { service, screen } = setup();
    const dated: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    const undated: any = await newGame(service);
    seedScreen(screen, 's1');
    screen.rows.push({ id: 'sX', name: 'foreign', status: 'ONLINE', tenantId: 'other', activeBoardGameId: null, activeBoardSurface: null });

    await expect(
      service.setAutoPush(TENANT, undated.id, { armed: true, screenIds: ['s1'] }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.setAutoPush(TENANT, dated.id, { armed: true, screenIds: [] }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.setAutoPush(TENANT, dated.id, { armed: true, screenIds: ['sX'] }),
    ).rejects.toThrow(BadRequestException);
    // Tenant-scoped like every game mutation.
    await expect(
      service.setAutoPush('other-tenant', dated.id, { armed: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('disarms: autoPushAt nulled + DISARMED AuditLog row', async () => {
    const { service, game, auditLog, screen } = setup();
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    await service.setAutoPush(TENANT, g.id, { armed: true, screenIds: ['s1'] }, 'user-1');

    const res: any = await service.setAutoPush(TENANT, g.id, { armed: false }, 'user-1');
    expect(res.armed).toBe(false);
    expect(game.rows.find((r) => r.id === g.id).autoPushAt).toBeNull();
    expect(auditLog.rows.some((a) => a.action === 'SPORTS_AUTO_PUSH_DISARMED')).toBe(true);
  });

  it('re-times the pending fire when scheduledAt changes while armed; clearing it clears the fire', async () => {
    const { service, game, screen } = setup();
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    await service.setAutoPush(TENANT, g.id, { armed: true, screenIds: ['s1'] });

    const moved = new Date(Date.now() + 2 * 60 * 60_000);
    await service.updateGameDetails(TENANT, g.id, { scheduledAt: moved.toISOString() });
    let row = game.rows.find((r) => r.id === g.id);
    expect(row.autoPushAt.getTime()).toBe(moved.getTime() - 10 * 60_000);

    await service.updateGameDetails(TENANT, g.id, { scheduledAt: null });
    row = game.rows.find((r) => r.id === g.id);
    expect(row.autoPushAt).toBeNull();
  });
});

// ── the sweep — claim + push ───────────────────────────────────

describe('SportsService — sweepDueAutoPushes', () => {
  it('claims with the atomic UPDATE … SET auto_push_at = NULL … RETURNING shape', async () => {
    const { service, rawCalls } = setup();
    await service.sweepDueAutoPushes();
    expect(rawCalls).toHaveLength(1);
    const sql = rawCalls[0].replace(/\s+/g, ' ');
    expect(sql).toContain('UPDATE "games"');
    expect(sql).toContain('SET "auto_push_at" = NULL');
    expect(sql).toContain('"auto_push_at" IS NOT NULL');
    expect(sql).toContain('"auto_push_at" <= NOW()');
    expect(sql).toContain('RETURNING "id", "tenant_id"');
  });

  it('pushes a due game: screens claimed, savedState + pushedAt persisted, audit + SYNC nudge', async () => {
    const { service, game, gameEvent, screen, auditLog, redis } = setup();
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    // s2 already shows THIS game on the ribbon (manual early push) — its
    // pre-push pointer must be captured, not clobbered blindly.
    seedScreen(screen, 's2', { activeBoardGameId: g.id, activeBoardSurface: 'RIBBON' });
    await service.setAutoPush(TENANT, g.id, { armed: true, screenIds: ['s1', 's2'] });
    // Make the fire time due NOW.
    game.rows.find((r) => r.id === g.id).autoPushAt = new Date(Date.now() - 1000);
    redis.publish.mockClear();

    const res = await service.sweepDueAutoPushes();
    expect(res).toEqual({ found: 1, pushed: 1, blocked: 0 });
    // Claim consumed the fire time; screens now show the board.
    expect(game.rows.find((r) => r.id === g.id).autoPushAt).toBeNull();
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBe(g.id);
    expect(screen.rows.find((s) => s.id === 's1').activeBoardSurface).toBe('BOARD');
    // The fresh latest-wins record carries savedState + pushedAt.
    const latest = [...gameEvent.rows].filter((e) => e.type === 'AUTO_PUSH').pop();
    expect(latest.payload.pushedAt).toBeTruthy();
    expect(latest.payload.savedState).toEqual([
      { screenId: 's1', prevGameId: null, prevSurface: null },
      { screenId: 's2', prevGameId: g.id, prevSurface: 'RIBBON' },
    ]);
    expect(auditLog.rows.some((a) => a.action === 'SPORTS_AUTO_PUSHED' && a.userId === null)).toBe(true);
    // Players got the signed SYNC nudge on the tenant channel.
    expect(redis.publish).toHaveBeenCalledWith(`tenant:${TENANT}`, expect.anything());
  });

  it('SCREEN_IN_USE: skips the game (never force), audits BLOCKED, and the pass survives', async () => {
    const { service, game, gameEvent, screen, auditLog } = setup();
    const other: any = await newGame(service);
    const blockedGame: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    const okGame: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    // s1 is owned by ANOTHER game → conflict for blockedGame.
    seedScreen(screen, 's1', { activeBoardGameId: other.id, activeBoardSurface: 'BOARD' });
    seedScreen(screen, 's2');
    await service.setAutoPush(TENANT, blockedGame.id, { armed: true, screenIds: ['s1'] });
    await service.setAutoPush(TENANT, okGame.id, { armed: true, screenIds: ['s2'] });
    game.rows.find((r) => r.id === blockedGame.id).autoPushAt = new Date(Date.now() - 1000);
    game.rows.find((r) => r.id === okGame.id).autoPushAt = new Date(Date.now() - 1000);

    const res = await service.sweepDueAutoPushes();
    expect(res.found).toBe(2);
    expect(res.blocked).toBe(1);
    expect(res.pushed).toBe(1);
    // The conflicting screen was NOT stolen.
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBe(other.id);
    // The other claimed game still went up (fail-open per game).
    expect(screen.rows.find((s) => s.id === 's2').activeBoardGameId).toBe(okGame.id);
    const blockedAudit = auditLog.rows.find((a) => a.action === 'SPORTS_AUTO_PUSH_BLOCKED');
    expect(blockedAudit.targetId).toBe(blockedGame.id);
    expect(JSON.parse(blockedAudit.details).screenIds).toEqual(['s1']);
    // No pushedAt/savedState was recorded for the blocked game — FINAL
    // must not "revert" a push that never happened.
    const blockedLatest = [...gameEvent.rows]
      .filter((e) => e.gameId === blockedGame.id && e.type === 'AUTO_PUSH')
      .pop();
    expect(blockedLatest.payload.pushedAt).toBeUndefined();
  });

  it('skips a game that went FINAL between claim and push', async () => {
    const { service, game, screen } = setup();
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    await service.setAutoPush(TENANT, g.id, { armed: true, screenIds: ['s1'] });
    const row = game.rows.find((r) => r.id === g.id);
    row.autoPushAt = new Date(Date.now() - 1000);
    row.status = 'FINAL';

    const res = await service.sweepDueAutoPushes();
    expect(res).toEqual({ found: 1, pushed: 0, blocked: 0 });
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBeNull();
  });
});

// ── auto-revert at FINAL ───────────────────────────────────────

describe('SportsService — onGameFinal revert', () => {
  /** Arm + fire the sweep so the game has a REAL completed push. */
  async function armAndPush(ctx: ReturnType<typeof setup>, g: any, screenIds: string[]) {
    await ctx.service.setAutoPush(TENANT, g.id, { armed: true, screenIds });
    ctx.game.rows.find((r) => r.id === g.id).autoPushAt = new Date(Date.now() - 1000);
    await ctx.service.sweepDueAutoPushes();
  }

  it('setStatus FINAL reverts EXACTLY the pushed screens and disarms', async () => {
    const ctx = setup();
    const { service, screen, auditLog } = ctx;
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    seedScreen(screen, 's2');
    // s3 was pushed MANUALLY (not part of the armed set) — the revert must
    // never touch it.
    seedScreen(screen, 's3', { activeBoardGameId: g.id, activeBoardSurface: 'BOARD' });
    await armAndPush(ctx, g, ['s1', 's2']);

    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBeNull();
    expect(screen.rows.find((s) => s.id === 's2').activeBoardGameId).toBeNull();
    expect(screen.rows.find((s) => s.id === 's3').activeBoardGameId).toBe(g.id); // untouched
    const audit = auditLog.rows.find((a) => a.action === 'SPORTS_AUTO_REVERTED');
    expect(JSON.parse(audit.details).screenIds).toEqual(['s1', 's2']);
    const cfg: any = await service.getAutoPush(TENANT, g.id);
    expect(cfg.armed).toBe(false);
  });

  it('restores a screen whose pre-push pointer was a DIFFERENT unfinished game (and not a FINAL one)', async () => {
    const ctx = setup();
    const { service, game, gameEvent, screen } = ctx;
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    const prevLive: any = await newGame(service);
    const prevFinal: any = await newGame(service);
    game.rows.find((r) => r.id === prevFinal.id).status = 'FINAL';
    seedScreen(screen, 's1', { activeBoardGameId: g.id, activeBoardSurface: 'BOARD' });
    seedScreen(screen, 's2', { activeBoardGameId: g.id, activeBoardSurface: 'BOARD' });
    // Fabricate the completed-push config directly (the force/takeover
    // shape): saved pointers name another live game and a finished one.
    gameEvent.rows.push({
      id: 'ev-pushed',
      gameId: g.id,
      type: 'AUTO_PUSH',
      createdAt: new Date(),
      payload: {
        armed: true,
        screenIds: ['s1', 's2'],
        surface: 'BOARD',
        pushedAt: new Date().toISOString(),
        savedState: [
          { screenId: 's1', prevGameId: prevLive.id, prevSurface: 'RIBBON' },
          { screenId: 's2', prevGameId: prevFinal.id, prevSurface: 'BOARD' },
        ],
      },
    });

    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    // s1 → put back on the still-live previous game, same surface.
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBe(prevLive.id);
    expect(screen.rows.find((s) => s.id === 's1').activeBoardSurface).toBe('RIBBON');
    // s2's previous game is FINAL → stays cleared.
    expect(screen.rows.find((s) => s.id === 's2').activeBoardGameId).toBeNull();
  });

  it('FINAL before the fire time cancels the pending push instead of firing it later', async () => {
    const ctx = setup();
    const { service, game, screen } = ctx;
    const g: any = await newGame(service, { scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    await service.setAutoPush(TENANT, g.id, { armed: true, screenIds: ['s1'] });

    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(game.rows.find((r) => r.id === g.id).autoPushAt).toBeNull();
    const cfg: any = await service.getAutoPush(TENANT, g.id);
    expect(cfg.armed).toBe(false);
    // Even if the claim were to run now, nothing is due.
    const res = await service.sweepDueAutoPushes();
    expect(res.found).toBe(0);
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBeNull();
  });

  it('clears an ACTIVE recalled scene at FINAL (Show-Control slice 4)', async () => {
    const ctx = setup();
    const { service, gameEvent } = ctx;
    const g: any = await newGame(service);
    gameEvent.rows.push({
      id: 'ev-scene',
      gameId: g.id,
      type: 'SCENE',
      createdAt: new Date(),
      payload: { templateId: 'tmpl-x', expiresAt: Date.now() + 60_000, holdMode: 'held' },
    });

    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    const latestScene = [...gameEvent.rows].filter((e) => e.type === 'SCENE').pop();
    expect(latestScene.payload).toEqual({ kind: 'clear' });
  });

  it('applySetWin FINAL (volleyball set majority) reverts; a suppressAutoFinal hold does NOT', async () => {
    const ctx = setup();
    const { service, game, screen } = ctx;
    const g: any = await newGame(service, { sport: 'volleyball', scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    await armAndPush(ctx, g, ['s1']);
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBe(g.id);
    // Two sets already won; 24-10 in the third — one rally from the match.
    const row = game.rows.find((r) => r.id === g.id);
    row.status = 'LIVE';
    row.stats = { homeSets: 2, awaySets: 0 };
    row.homeScore = 24;
    row.awayScore = 10;

    // Scorekeeper share-link path: the match-point rally lands but FINAL is
    // held — the game stays LIVE and the board stays UP.
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 }, undefined, {
      suppressAutoFinal: true,
    });
    expect(game.rows.find((r) => r.id === g.id).status).toBe('LIVE');
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBe(g.id);

    // The operator ends it — NOW the revert fires (via setStatus's hook).
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBeNull();
  });

  it('applySetWin auto-FINAL (no hold) reverts through its own hook', async () => {
    const ctx = setup();
    const { service, game, screen } = ctx;
    const g: any = await newGame(service, { sport: 'volleyball', scheduledAt: KICKOFF().toISOString() });
    seedScreen(screen, 's1');
    await armAndPush(ctx, g, ['s1']);
    const row = game.rows.find((r) => r.id === g.id);
    row.status = 'LIVE';
    row.stats = { homeSets: 2, awaySets: 0 };
    row.homeScore = 24;
    row.awayScore = 10;

    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    expect(game.rows.find((r) => r.id === g.id).status).toBe('FINAL');
    expect(screen.rows.find((s) => s.id === 's1').activeBoardGameId).toBeNull();
    const cfg: any = await service.getAutoPush(TENANT, g.id);
    expect(cfg.armed).toBe(false);
  });
});
