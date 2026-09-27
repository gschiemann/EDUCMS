/**
 * K12 launch acceptance — the concurrency guarantees against REAL Postgres.
 *
 * The in-memory double (sports-prisma-fake.ts) models compare-and-swap
 * filters, unique keys and rollback, but not row locks or READ COMMITTED's
 * re-check of a blocked UPDATE — the two things these guarantees rest on in
 * production. This suite runs the same properties on a real database:
 *   - simultaneous score taps never lose an update (K12-F12)
 *   - one command id sent twice at once applies once (K12-F10)
 *   - two claims on one free screen: exactly one wins (K12-F35 / K12-24)
 *   - two appliers of one season roll-up: applied once (K12-F39)
 *   - two games rolling up the same athlete at once: nothing lost (K12-F39)
 * Where a race needs both sides to READ before either WRITES, a barrier
 * wraps the transaction client (`racing`), so the race is forced rather than
 * left to scheduling luck.
 *
 * OPT-IN. Set K12_PG_DATABASE_URL to a SCRATCH database with the current
 * schema applied — never a shared or production database: this creates a
 * tenant, games, screens and audit rows and does not delete them. Without the
 * variable every test here is skipped (CI runs it skipped).
 *
 *   K12_PG_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/k12_mig \
 *     pnpm --filter api exec jest src/sports/k12-launch-acceptance.pg.spec.ts
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@cms/database';
import { SportsService } from './sports.service';
import { STAT_ROLLUP_STATE, applyGameStatRollup, deriveSeason } from './sports-stats.service';

const url = process.env.K12_PG_DATABASE_URL;
const pgDescribe = url ? describe : describe.skip;

jest.setTimeout(60_000);

/** Resolves for everyone once `n` parties have arrived. */
function barrier(n: number) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  return async () => {
    arrived += 1;
    if (arrived === n) open();
    await gate;
  };
}

/**
 * A client whose interactive transactions pause after `model.method` returns,
 * until `wait` releases — so two transactions both READ before either WRITES.
 */
function racing(prisma: PrismaClient, model: string, method: string, wait: () => Promise<void>) {
  return new Proxy(prisma as any, {
    get(target, prop) {
      if (prop !== '$transaction') return target[prop];
      return (fn: (tx: any) => Promise<unknown>, opts?: unknown) =>
        target.$transaction(
          (tx: any) =>
            fn(
              new Proxy(tx, {
                get(t, p) {
                  if (p !== model) return t[p];
                  const delegate = t[p];
                  return new Proxy(delegate, {
                    get(d, m) {
                      if (m !== method) return d[m];
                      return async (args: unknown) => {
                        const out = await d[m](args);
                        await wait();
                        return out;
                      };
                    },
                  });
                },
              }),
            ),
          opts,
        );
    },
  });
}

pgDescribe('K12 acceptance on real Postgres', () => {
  let prisma: PrismaClient;
  let tenantId: string;

  const makeService = (client: unknown) =>
    new SportsService(
      { client } as any,
      { publish: async () => undefined } as any,
      { signMessage: () => ({ eventId: 'e', signature: 's' }) } as any,
      { listActive: async () => [] } as any,
      { isEnabledAsync: async () => true } as any,
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    tenantId = randomUUID();
    await prisma.tenant.create({
      data: { id: tenantId, name: 'K12 real-Postgres acceptance', slug: `k12-pg-${tenantId}` },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // A scorekeeper-link actor: attributed, and needs no user row (the audit
  // trail's user_id is a foreign key to a real user).
  const LINK = { actor: { kind: 'console' as const, ref: 'console-link:0123456789abcdef' } };

  const newGame = (sport = 'basketball') =>
    makeService(prisma).createGame(tenantId, { sport, homeTeam: 'Home', awayTeam: 'Away' }) as Promise<any>;

  it('K12-F12: simultaneous score taps never lose an update', async () => {
    const service = makeService(prisma);
    const g = await newGame();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => service.adjustScore(tenantId, g.id, { team: 'home', delta: 1 }, LINK)),
    );
    const applied = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) {
      // Under extreme contention a tap may give up (409 GAME_BUSY, safe to
      // retry) — it is never silently lost.
      if (r.status === 'rejected') expect((r.reason as any).getResponse?.()).toMatchObject({ code: 'GAME_BUSY' });
    }
    expect(applied).toBeGreaterThan(0);
    const row = await prisma.game.findUnique({ where: { id: g.id } });
    expect(row!.homeScore).toBe(applied);
    expect(await prisma.gameEvent.count({ where: { gameId: g.id, type: 'SCORE' } })).toBe(applied);
  });

  it('K12-F10: one command id sent twice at the same moment applies once', async () => {
    const service = makeService(prisma);
    const g = await newGame();
    const ctx = { ...LINK, commandId: `cmd-pg-${randomUUID()}` };
    const [a, b] = await Promise.all([
      service.adjustScore(tenantId, g.id, { team: 'home', delta: 2 }, ctx),
      service.adjustScore(tenantId, g.id, { team: 'home', delta: 2 }, ctx),
    ]);
    expect((a as any).homeScore).toBe(2);
    expect((b as any).homeScore).toBe(2);
    const row = await prisma.game.findUnique({ where: { id: g.id } });
    expect(row!.homeScore).toBe(2);
    expect(await prisma.gameCommand.count({ where: { gameId: g.id, commandId: ctx.commandId } })).toBe(1);
  });

  it('K12-F35 / K12-24: two claims on one free screen — exactly one wins, the other sees who', async () => {
    const a = await newGame();
    const b = await newGame('volleyball');
    const screen = await prisma.screen.create({
      data: { tenantId, name: 'PG Gym Board', deviceFingerprint: `fp-${randomUUID()}` },
    });
    const service = makeService(racing(prisma, 'screen', 'findMany', barrier(2)));
    const results = await Promise.allSettled([
      service.showOnScreens(tenantId, a.id, [screen.id]),
      service.showOnScreens(tenantId, b.id, [screen.id]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    const owner = (await prisma.screen.findUnique({ where: { id: screen.id } }))!.activeBoardGameId;
    expect([a.id, b.id]).toContain(owner);
    expect(lost.reason.getResponse()).toMatchObject({
      code: 'SCREEN_IN_USE',
      conflicts: [{ screenId: screen.id, ownerGameId: owner }],
    });
    expect(
      await prisma.auditLog.count({ where: { tenantId, action: 'SPORTS_SCREENS_SHOWN', targetId: { in: [a.id, b.id] } } }),
    ).toBe(1);
  });

  /** A FINAL game whose roster credits `personId` with `pts` points, and its queued roll-up. */
  async function finalGameWithJob(personId: string, pts: string) {
    const g = await newGame();
    await prisma.game.update({ where: { id: g.id }, data: { status: 'FINAL', version: 1 } });
    await prisma.rosterPlayer.create({
      data: { tenantId, gameId: g.id, team: 'home', name: 'Sam', personId, stats: { PTS: pts } },
    });
    await prisma.gameStatRollup.create({
      data: { gameId: g.id, tenantId, state: STAT_ROLLUP_STATE.PENDING, targetRevision: 1, contribution: [] },
    });
    return g;
  }
  const newPerson = () =>
    prisma.sportsPerson.create({
      data: { tenantId, fullName: 'Sam Pg', normalizedKey: `sam pg ${randomUUID()}` },
    });

  it('K12-F39: two appliers of one roll-up (hook + sweep on two replicas) apply it once', async () => {
    const person = await newPerson();
    const g = await finalGameWithJob(person.id, '24');
    const client = racing(prisma, 'gameStatRollup', 'findFirst', barrier(2));
    const results = await Promise.all([
      applyGameStatRollup(client, tenantId, g.id),
      applyGameStatRollup(client, tenantId, g.id),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    const season = await prisma.playerSeasonStat.findMany({ where: { personId: person.id, statKey: 'PTS' } });
    expect(season).toHaveLength(1);
    expect(season[0]).toMatchObject({ statValue: 24, gamesPlayed: 1 });
    const job = await prisma.gameStatRollup.findUnique({ where: { gameId: g.id } });
    expect(job).toMatchObject({ state: 'APPLIED', appliedRevision: 1 });
  });

  it('K12-F39: two games rolling up the same athlete at once lose nothing', async () => {
    const person = await newPerson();
    const g1 = await finalGameWithJob(person.id, '20');
    const g2 = await finalGameWithJob(person.id, '15');
    // Both read their box scores before either touches the season row.
    const client = racing(prisma, 'rosterPlayer', 'findMany', barrier(2));
    const results = await Promise.allSettled([
      applyGameStatRollup(client, tenantId, g1.id),
      applyGameStatRollup(client, tenantId, g2.id),
    ]);
    for (const r of results) expect(r.status).toBe('fulfilled');
    const season = await prisma.playerSeasonStat.findMany({
      where: { personId: person.id, statKey: 'PTS', season: deriveSeason(g1) },
    });
    expect(season).toHaveLength(1);
    expect(season[0]).toMatchObject({ statValue: 35, gamesPlayed: 2, displayValue: '35' });
    const career = await prisma.playerCareerStat.findMany({ where: { personId: person.id, statKey: 'PTS' } });
    expect(career[0]).toMatchObject({ statValue: 35, gamesPlayed: 2 });
  });
});
