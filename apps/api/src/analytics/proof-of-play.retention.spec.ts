/**
 * Efficiency audit 2026-07-20 — proof-of-play retention + replica safety.
 *
 * playback_samples had grown to 38% of the database with no retention
 * anywhere; the sampler also ran an unguarded setInterval on EVERY
 * replica (a 2-replica deploy would silently double-count all airtime).
 * These specs pin the purge window, the disabled switch, and the
 * xact-advisory-lock skip paths for both the purge and the sample write.
 */
import { ProofOfPlaySampler } from './proof-of-play.sampler';

type Tx = {
  $queryRaw: jest.Mock;
  playbackSample: { deleteMany: jest.Mock; createMany: jest.Mock };
};

function makePrisma(opts: { locked?: boolean; deleted?: number } = {}) {
  const tx: Tx = {
    $queryRaw: jest.fn(async () => [{ locked: opts.locked ?? true }]),
    playbackSample: {
      deleteMany: jest.fn(async () => ({ count: opts.deleted ?? 3 })),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const client = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    playbackSample: tx.playbackSample,
    screen: { findMany: jest.fn(async () => []) },
    schedule: { findMany: jest.fn(async () => []) },
  };
  return { prisma: { client } as any, tx, client };
}

describe('ProofOfPlaySampler retention purge', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.PROOF_OF_PLAY_RETENTION_DAYS;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('purges rows older than the default 90-day window', async () => {
    const { prisma, tx } = makePrisma({ deleted: 42 });
    const sampler = new ProofOfPlaySampler(prisma);
    const before = Date.now();
    const deleted = await sampler.purgeTick();
    expect(deleted).toBe(42);
    const arg = tx.playbackSample.deleteMany.mock.calls[0][0];
    const cutoff: Date = arg.where.sampledAt.lt;
    const expected = before - 90 * 86_400_000;
    // Cutoff within a second of "now - 90d".
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1_000);
  });

  it('honors PROOF_OF_PLAY_RETENTION_DAYS and disables at <= 0', async () => {
    const { prisma, tx } = makePrisma();
    process.env.PROOF_OF_PLAY_RETENTION_DAYS = '30';
    const sampler = new ProofOfPlaySampler(prisma);
    await sampler.purgeTick();
    const cutoff: Date = tx.playbackSample.deleteMany.mock.calls[0][0].where.sampledAt.lt;
    expect(Math.abs(cutoff.getTime() - (Date.now() - 30 * 86_400_000))).toBeLessThan(1_000);

    process.env.PROOF_OF_PLAY_RETENTION_DAYS = '0';
    tx.playbackSample.deleteMany.mockClear();
    await sampler.purgeTick();
    expect(tx.playbackSample.deleteMany).not.toHaveBeenCalled();
  });

  it('skips the sweep when another replica holds the advisory lock', async () => {
    const { prisma, tx } = makePrisma({ locked: false });
    const sampler = new ProofOfPlaySampler(prisma);
    const deleted = await sampler.purgeTick();
    expect(deleted).toBe(0);
    expect(tx.playbackSample.deleteMany).not.toHaveBeenCalled();
  });

  it('a DB error is swallowed (best-effort) and returns 0', async () => {
    const { prisma, client } = makePrisma();
    client.$transaction.mockRejectedValueOnce(new Error('pool blip'));
    const sampler = new ProofOfPlaySampler(prisma);
    await expect(sampler.purgeTick()).resolves.toBe(0);
  });
});

describe('ProofOfPlaySampler replica-safe sample write', () => {
  function makeTickPrisma(locked: boolean) {
    const { prisma, tx, client } = makePrisma({ locked });
    client.screen.findMany = jest.fn(async () => [
      { id: 's1', tenantId: 't1', screenGroupId: null },
    ]);
    client.schedule.findMany = jest.fn(async () => [
      { tenantId: 't1', playlistId: 'p1', screenId: 's1', screenGroupId: null, priority: 1 },
    ]);
    return { prisma, tx };
  }

  it('writes samples when the xact advisory lock is acquired', async () => {
    const { prisma, tx } = makeTickPrisma(true);
    const sampler = new ProofOfPlaySampler(prisma);
    await (sampler as any).tick();
    expect(tx.playbackSample.createMany).toHaveBeenCalledTimes(1);
    const rows = tx.playbackSample.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ tenantId: 't1', screenId: 's1', playlistId: 'p1' });
  });

  it('skips the write when another replica holds the lock (no double-count)', async () => {
    const { prisma, tx } = makeTickPrisma(false);
    const sampler = new ProofOfPlaySampler(prisma);
    await (sampler as any).tick();
    expect(tx.playbackSample.createMany).not.toHaveBeenCalled();
  });
});
