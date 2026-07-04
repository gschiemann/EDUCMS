/**
 * Sports-stats-race regression (2026-07-03, verified data race).
 *
 * THE BUG: `ingestCtsSnapshot` (the ~5Hz CTS bridge feed) and
 * `updateStats` (the operator's stat-tray PATCH) both used to do an
 * UNGUARDED whole-blob read-modify-write on `Game.stats` — read the
 * current JSON, splice in a change, write the whole blob back. Two
 * writers racing on the same row each read the SAME pre-write snapshot;
 * whichever commits LAST wins with a value that doesn't include the
 * other writer's edit, silently erasing it. Same pattern in
 * `ingestSwimTimingSnapshot`, `applySetWin`, `setSegment`.
 *
 * THE FIX: every one of those methods now reads the game FRESH inside a
 * `Serializable` Prisma transaction (`SportsService.withStatsTx`,
 * private helper added next to `owned()`), wrapped in `withDbRetry` —
 * the EXACT pattern already proven for the seat-claim race in
 * `apps/api/src/screens/screens.controller.ts`'s `pair()` (see the
 * P2-B comment there, and `screens.pair-retry.spec.ts` for the sibling
 * test shape this file mirrors). Under SERIALIZABLE, two concurrent
 * transactions whose read/write sets conflict cause Postgres to abort
 * one with a 40001 (Prisma surfaces this as P2034); `withDbRetry`
 * classifies P2034 as transient and re-runs the WHOLE transaction
 * thunk — including the fresh read — so the loser of the race merges
 * on top of the winner's committed write instead of clobbering it.
 *
 * These tests use a `$transaction` mock that can be told to throw a
 * P2034 on its Nth call (to simulate "this transaction lost the SSI
 * race") and otherwise actually invokes the callback against a live
 * in-memory `game` table — so a real re-read really does see whatever
 * the other write already committed, exactly like Postgres would
 * re-present fresh row state to a retried serializable transaction.
 */

import { NotFoundException } from '@nestjs/common';
import { SportsService } from './sports.service';

// ── in-memory `game` table (minimal — only what these tests touch) ─────────

function makeGameTable(seed: Record<string, any>) {
  const rows: Record<string, any>[] = [{ ...seed }];
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findFirst: async ({ where }: any) =>
      rows.find((r) => r.id === where.id && (!where.tenantId || r.tenantId === where.tenantId)) ?? null,
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('Row not found');
      for (const [k, v] of Object.entries(data)) {
        row[k] = v;
      }
      return { ...row };
    },
  };
}

function p2034Error(): Error & { code: string } {
  const e = new Error(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
  ) as Error & { code: string };
  e.code = 'P2034';
  return e;
}

const TENANT = 'tenant-1';
const GAME_ID = 'game-1';

/**
 * Builds a SportsService wired to the in-memory `game` table plus a
 * controllable `$transaction`. `conflictOnCallIndexes` is a set of
 * 0-based $transaction call indexes that should throw P2034 instead of
 * running the callback — simulating "this attempt lost the SERIALIZABLE
 * race" — every other call actually invokes the callback against the
 * live table (a real re-read, real write).
 */
function setup(conflictOnCallIndexes: number[] = []) {
  const game = makeGameTable({
    id: GAME_ID,
    tenantId: TENANT,
    sport: 'water_polo',
    homeScore: 0,
    awayScore: 0,
    segment: 1,
    clockMs: 8 * 60_000,
    clockRunning: false,
    clockUpdatedAt: new Date(),
    stats: {},
    status: 'LIVE',
  });
  const gameEvent = {
    rows: [] as any[],
    create: async ({ data }: any) => {
      const row = { id: `ev-${gameEvent.rows.length + 1}`, createdAt: new Date(), ...data };
      gameEvent.rows.push(row);
      return row;
    },
    findFirst: async ({ where }: any = {}) => {
      const hits = gameEvent.rows.filter(
        (r) => (!where?.gameId || r.gameId === where.gameId) && (!where?.type || r.type === where.type),
      );
      return hits.length ? hits[hits.length - 1] : null;
    },
    findMany: async () => [],
  };
  const auditLog = { rows: [] as any[], create: async ({ data }: any) => {
    auditLog.rows.push(data);
    return data;
  } };

  let txCallIndex = -1;
  const client: any = { game, gameEvent, auditLog };
  client.$transaction = async (fn: (tx: unknown) => unknown, _opts?: unknown) => {
    txCallIndex += 1;
    if (conflictOnCallIndexes.includes(txCallIndex)) {
      throw p2034Error();
    }
    return fn(client);
  };

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
  return { service, game, gameEvent, auditLog, txCallCount: () => txCallIndex + 1 };
}

// ════════════════════════════════════════════════════════════════════════════

describe('SportsService — Game.stats race (sports-stats-race fix, 2026-07-03)', () => {
  it('BEFORE-style interleave, closed: operator updateStats + CTS ingest both land, neither clobbers the other', async () => {
    // Simulate the exact interleave the bug report describes: the CTS
    // feed's transaction is the one that "started first" (call index 0)
    // but loses the SERIALIZABLE race against the operator's write that
    // commits in between — Postgres aborts the CTS side with a 40001
    // (P2034) and `withDbRetry` re-runs it. On the retry, the CTS
    // transaction re-reads the game FRESH — which now includes the
    // operator's already-committed `homeShots` — and its own merge
    // preserves it instead of overwriting it with the stale pre-race
    // value.
    const { service, game } = setup([0]);

    const ctsPromise = service.ingestCtsSnapshot(
      GAME_ID,
      { homeTimeoutsRemaining: 2 },
      { tenantId: null, source: 'cts-bridge' },
    );
    // The operator's PATCH "wins" the race conceptually — it's the write
    // that lands while the CTS transaction (call index 0) is aborted.
    await service.updateStats(TENANT, GAME_ID, { stats: { homeShots: 5 } });
    const ctsResult = await ctsPromise;

    expect(ctsResult).toMatchObject({ ok: true, accepted: true });

    // BOTH writers' edits must be present in the final row — this is the
    // lost-update anomaly the fix closes. Before the fix, the CTS
    // transaction was a single unguarded `game.update` that would have
    // been built from a stale pre-operator-write read and clobbered
    // `homeShots` back to undefined.
    const finalStats = game.rows[0].stats as Record<string, unknown>;
    expect(finalStats.homeShots).toBe(5); // operator's edit survived
    expect(finalStats.homeTimeouts).toBe(2); // CTS's edit survived too
  });

  it('ingestCtsSnapshot retries the WHOLE transaction (fresh read + fresh merge) on a P2034, not just the write', async () => {
    // Pre-seed a stat the operator already set BEFORE the CTS ingest
    // starts, so we can prove the RETRY attempt re-reads it (a naive
    // "retry just the write" implementation would not re-run the read).
    const { service, game, txCallCount } = setup([0]);
    game.rows[0].stats = { homeShots: 7 };

    const result = await service.ingestCtsSnapshot(
      GAME_ID,
      { homeTimeoutsRemaining: 1 },
      { tenantId: null, source: 'cts-bridge' },
    );

    expect(result).toMatchObject({ ok: true, accepted: true });
    // $transaction was invoked twice: the aborted attempt + the retry.
    expect(txCallCount()).toBe(2);
    // The retry's merge started from the FRESH read (homeShots: 7 still
    // there) and layered the CTS field on top — not a stale blank blob.
    const finalStats = game.rows[0].stats as Record<string, unknown>;
    expect(finalStats.homeShots).toBe(7);
    expect(finalStats.homeTimeouts).toBe(1);
  });

  it('updateStats retries the WHOLE transaction on a P2034 and the operator write still lands', async () => {
    const { service, game, txCallCount } = setup([0]);
    game.rows[0].stats = { homeTimeouts: 3 }; // e.g. CTS already wrote this

    const updated = await service.updateStats(TENANT, GAME_ID, {
      stats: { homeShots: 9 },
    });

    expect(txCallCount()).toBe(2); // aborted attempt + retry
    expect((updated.stats as Record<string, unknown>).homeShots).toBe(9);
    // The concurrent writer's field (present at the time of the RETRY's
    // fresh read) is preserved — not stomped by a stale pre-race merge.
    expect((updated.stats as Record<string, unknown>).homeTimeouts).toBe(3);
  });

  it('a non-transient error (e.g. NotFoundException) is NOT retried — thrown immediately', async () => {
    const { service, txCallCount } = setup([]);

    await expect(
      service.updateStats(TENANT, 'does-not-exist', { stats: { homeShots: 1 } }),
    ).rejects.toThrow(NotFoundException);
    // owned() 404s BEFORE the transaction even opens — zero tx attempts.
    expect(txCallCount()).toBe(0);
  });

  it('ingestSwimTimingSnapshot folds the audit-cadence marker into the SAME write (no second unguarded RMW)', async () => {
    // Regression for the bonus fix: the old code did the main stats
    // write, then a SEPARATE unguarded game.update to stamp the audit
    // marker a few lines later — a second race window on the same blob.
    const { service, game, txCallCount } = setup([]);
    game.rows[0].sport = 'swimming';
    game.rows[0].stats = { homeShots: 42 }; // an unrelated field that must survive

    await service.ingestSwimTimingSnapshot(
      GAME_ID,
      {
        lanes: { 1: { place: 1, display: '23.45', blank: false } },
        eventHeat: { event: 1, heat: 1 },
      } as any,
      { tenantId: null, source: 'swim-timing-feed' },
    );

    // Exactly one $transaction call for the whole ingest — main write +
    // audit-cadence marker are ONE merged write, not two sequential RMWs.
    expect(txCallCount()).toBe(1);
    const finalStats = game.rows[0].stats as Record<string, unknown>;
    expect(finalStats.homeShots).toBe(42); // untouched field survives
    expect(finalStats.results).toBeDefined();
  });

  it('setSegment merges segment-reset stats against a fresh read inside the same transaction', async () => {
    const { service, game, txCallCount } = setup([0]);
    // Concurrent write already landed before the retry's fresh read.
    game.rows[0].stats = { homeShots: 11 };

    const updated = await service.setSegment(TENANT, GAME_ID, { delta: 1 });

    expect(txCallCount()).toBe(2);
    expect(updated.segment).toBe(2);
    expect((updated.stats as Record<string, unknown>).homeShots).toBe(11);
  });
});
