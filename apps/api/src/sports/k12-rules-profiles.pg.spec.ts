/**
 * K-12 launch lane A3 — the rules snapshot on REAL Postgres (K12-F01).
 *
 * The in-memory double stores whatever object it is handed; a real database
 * stores `games.rules` as JSONB and hands back a parsed copy. This suite proves
 * the snapshot survives that round trip and drives the engine: a game created
 * with a profile runs it on the next command read from the database, a game
 * with no snapshot (created before profiles) runs the classic rules, and the
 * pre-start rules switch lands in one audited command.
 *
 * OPT-IN, like k12-launch-acceptance.pg.spec.ts. Set K12_PG_DATABASE_URL to a
 * SCRATCH database with the current schema applied (migration
 * 20260927190000_sports_game_rules_profile included) — never a shared or
 * production database: this creates a tenant and games and does not delete
 * them. Without the variable every test here is skipped (CI runs it skipped).
 *
 *   K12_PG_DATABASE_URL=postgresql://localhost:5432/a3_scratch \
 *     pnpm --filter api exec jest src/sports/k12-rules-profiles.pg.spec.ts
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@cms/database';
import { SportsService } from './sports.service';

const url = process.env.K12_PG_DATABASE_URL;
const pgDescribe = url ? describe : describe.skip;

jest.setTimeout(60_000);

pgDescribe('Rules profiles on real Postgres (K12-F01)', () => {
  let prisma: PrismaClient;
  let tenantId: string;

  const makeService = () =>
    new SportsService(
      { client: prisma } as any,
      { publish: async () => undefined } as any,
      { signMessage: () => ({ eventId: 'e', signature: 's' }) } as any,
      { listActive: async () => [] } as any,
      { isEnabledAsync: async () => false } as any,
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'K12 rules-profile acceptance',
        slug: `k12-rules-${tenantId}`,
      },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('R-PG-1 the snapshot round-trips through JSONB and drives the NFHS overtime rules', async () => {
    const service = makeService();
    const g: any = await service.createGame(tenantId, {
      sport: 'basketball',
      homeTeam: 'Home',
      awayTeam: 'Away',
    });
    const stored = await prisma.game.findUnique({ where: { id: g.id } });
    expect(stored!.rulesProfile).toBe('nfhs-basketball@2026-27');
    expect(stored!.rules).toMatchObject({
      v: 1,
      profile: 'nfhs-basketball@2026-27',
    });

    await service.setSegment(tenantId, g.id, { segment: 4 });
    await service.updateStats(tenantId, g.id, { stats: { homeFouls: 5 } });
    await service.setSegment(tenantId, g.id, { segment: 5 });
    const ot = await prisma.game.findUnique({ where: { id: g.id } });
    expect({
      clock: ot!.clockMs,
      fouls: (ot!.stats as Record<string, unknown>).homeFouls,
      timeouts: (ot!.stats as Record<string, unknown>).homeTimeouts,
    }).toEqual({ clock: 240_000, fouls: 5, timeouts: 6 });
  });

  it('R-PG-2 a row with no snapshot (created before profiles) runs the classic rules', async () => {
    const service = makeService();
    const g: any = await service.createGame(tenantId, {
      sport: 'basketball',
      homeTeam: 'Home',
      awayTeam: 'Away',
    });
    // What a game created by the previous release looks like: both NULL.
    await prisma.$executeRaw`UPDATE games SET rules = NULL, rules_profile = NULL WHERE id = ${g.id}`;
    await service.setSegment(tenantId, g.id, { segment: 5 });
    const row = await prisma.game.findUnique({ where: { id: g.id } });
    expect(row!.rules).toBeNull();
    expect(row!.clockMs).toBe(8 * 60_000);
  });

  it('R-PG-3 the pre-start switch lands in one audited command; a live game refuses it', async () => {
    const service = makeService();
    const g: any = await service.createGame(tenantId, {
      sport: 'volleyball',
      homeTeam: 'Home',
      awayTeam: 'Away',
    });
    await service.setRulesProfile(tenantId, g.id, {
      rulesProfile: 'uil-volleyball-junior-high@2026-27',
    });
    const row = await prisma.game.findUnique({ where: { id: g.id } });
    expect(row!.rulesProfile).toBe('uil-volleyball-junior-high@2026-27');
    expect((row!.rules as Record<string, any>).setFormat).toMatchObject({
      bestOf: 3,
      cap: 30,
    });
    expect(
      await prisma.auditLog.count({
        where: { targetId: g.id, action: 'SPORTS_GAME_RULES_SET' },
      }),
    ).toBe(1);
    await service.setStatus(tenantId, g.id, { status: 'LIVE' });
    await expect(
      service.setRulesProfile(tenantId, g.id, {
        rulesProfile: 'nfhs-volleyball-varsity@2026-27',
      }),
    ).rejects.toMatchObject({ response: { code: 'RULES_LOCKED' } });
  });
});
