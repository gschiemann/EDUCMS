/**
 * SEC-010 (2026-09-05) — refresh-token rotation + reuse detection.
 *
 * The audit's pass condition was "redesign long-lived browser bearer
 * storage". Moving the credential into an HttpOnly cookie is only half of
 * that; the other half is making a STOLEN cookie worth little. These tests
 * pin the properties that do it:
 *
 *   • every successful presentation ROTATES (the presented row is spent and
 *     a successor is minted in the same family);
 *   • presenting a spent row REVOKES THE WHOLE FAMILY — so a thief who uses
 *     the cookie destroys the session rather than quietly riding it, and the
 *     victim's next request tells them something happened;
 *   • two concurrent presentations of the same row leave nobody holding a
 *     live token (the family burns, and the winner's successor burns with it);
 *   • a successor never outlives the family ceiling (30d from the original
 *     credential check), so rotation cannot extend a session forever;
 *   • only the sha256 hash is stored — a database dump contains no live
 *     credential.
 */
import { SessionRefreshService, hashRefreshSecret } from './session-refresh.service';

type Row = {
  id: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  generation: number;
  origIat: number;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
};

/** Minimal in-memory stand-in for the one Prisma model this service uses.
 *  Real enough to exercise the compare-and-set: `updateMany` only matches
 *  rows that still satisfy the where-clause at write time. */
function makeStore() {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: any): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
    if (where.familyId !== undefined && row.familyId !== where.familyId) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.usedAt === null && row.usedAt !== null) return false;
    if (where.revokedAt === null && row.revokedAt !== null) return false;
    return true;
  };
  const client = {
    sessionRefreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const row: Row = {
          id: `r${++seq}`,
          familyId: data.familyId,
          userId: data.userId,
          tokenHash: data.tokenHash,
          generation: data.generation ?? 0,
          origIat: data.origIat,
          expiresAt: data.expiresAt,
          usedAt: null,
          revokedAt: null,
          userAgent: data.userAgent ?? null,
          ipAddress: data.ipAddress ?? null,
        };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = rows.filter((r) => match(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return { count: hits.length };
      }),
      // Only ever called by the hourly housekeeping prune, which deletes on
      // `expiresAt < now`. Modelled just faithfully enough to prove it
      // removes ONLY rows past their family ceiling.
      deleteMany: jest.fn(async ({ where }: any) => {
        const cut = where?.expiresAt?.lt as Date | undefined;
        if (!cut) return { count: 0 };
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].expiresAt.getTime() < cut.getTime()) {
            rows.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      }),
    },
  };
  return { rows, prisma: { client } as any };
}

const NOW_SEC = () => Math.floor(Date.now() / 1000);

describe('SessionRefreshService — rotation', () => {
  it('issues a family and stores only the HASH of the secret', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = await svc.issueFamily('u1', NOW_SEC());
    expect(issued).not.toBeNull();

    const token = issued!.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(rows).toHaveLength(1);
    // The credential itself must not be anywhere in the row.
    const serialized = JSON.stringify(rows[0]);
    const secret = token.split('.')[1];
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(token);
    expect(rows[0].tokenHash).toBe(hashRefreshSecret(secret));
  });

  it('rotates: the presented row is spent and a successor is minted in the same family', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = (await svc.issueFamily('u1', NOW_SEC()))!;

    const first = await svc.rotate(issued.token);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.token).not.toBe(issued.token);
    expect(rows).toHaveLength(2);
    expect(rows[0].usedAt).toBeInstanceOf(Date); // spent
    expect(rows[1].usedAt).toBeNull(); // successor, unspent
    expect(rows[1].familyId).toBe(rows[0].familyId);
    expect(rows[1].generation).toBe(1);
    expect(first.userId).toBe('u1');
  });

  it('the successor never outlives the family ceiling', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    // Logged in 29 days ago: the family has one day left, not another 30.
    const origIat = NOW_SEC() - 29 * 24 * 60 * 60;
    const issued = (await svc.issueFamily('u1', origIat))!;
    const rotated = await svc.rotate(issued.token);
    expect(rotated.ok).toBe(true);
    expect(rows[1].expiresAt.getTime()).toBe(rows[0].expiresAt.getTime());
    // ~1 day of life left, never 30.
    const daysLeft = (rows[1].expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeLessThan(1.01);
  });

  it('refuses to open a family for a session already past its 30-day window', async () => {
    const { prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = await svc.issueFamily('u1', NOW_SEC() - 31 * 24 * 60 * 60);
    expect(issued).toBeNull();
  });
});

describe('SessionRefreshService — reuse detection', () => {
  it('a REPLAYED token revokes the whole family', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = (await svc.issueFamily('u1', NOW_SEC()))!;

    const first = await svc.rotate(issued.token);
    expect(first.ok).toBe(true);

    // The attacker (or a duplicated tab) presents the ORIGINAL again.
    const replay = await svc.rotate(issued.token);
    expect(replay).toEqual({ ok: false, reason: 'reused' });

    // Every generation is dead — including the successor the legitimate
    // client is holding. That is the point: theft ends the session loudly.
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);

    if (first.ok) {
      const afterBurn = await svc.rotate(first.token);
      expect(afterBurn.ok).toBe(false);
      expect(afterBurn).toEqual({ ok: false, reason: 'revoked' });
    }
  });

  it('two concurrent presentations of the same row leave NOBODY holding a live token', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = (await svc.issueFamily('u1', NOW_SEC()))!;

    const [a, b] = await Promise.all([svc.rotate(issued.token), svc.rotate(issued.token)]);
    // Neither caller may walk away with a usable token: one lost the
    // compare-and-set (graded a replay, burning the family), and the other
    // re-reads its own row after inserting the successor and finds the burn.
    expect([a, b].filter((r) => r.ok)).toHaveLength(0);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('an unknown secret inside a LIVE family is treated as a replay, not a shrug', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = (await svc.issueFamily('u1', NOW_SEC()))!;
    const familyId = issued.token.split('.')[0];

    const forged = `${familyId}.${'A'.repeat(43)}`;
    const res = await svc.rotate(forged);
    expect(res).toEqual({ ok: false, reason: 'reused' });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('a malformed token spends no database round trip', async () => {
    const { prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const res = await svc.rotate('not-a-token');
    expect(res).toEqual({ ok: false, reason: 'malformed' });
    expect(prisma.client.sessionRefreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('an expired row is refused as expired, not as an attack', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = (await svc.issueFamily('u1', NOW_SEC()))!;
    rows[0].expiresAt = new Date(Date.now() - 1000);
    const res = await svc.rotate(issued.token);
    expect(res).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('SessionRefreshService — revocation', () => {
  it('logout revokes the family WITHOUT grading an already-spent token as an attack', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    const issued = (await svc.issueFamily('u1', NOW_SEC()))!;
    await svc.rotate(issued.token); // the cookie in the browser is now gen 1

    // Signing out while holding the SPENT gen-0 copy (a second tab, a stale
    // in-flight response) must still be a clean logout.
    const ok = await svc.revokeByPresentedToken(issued.token);
    expect(ok).toBe(true);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('revokeAllForUser kills every live family for one account', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    await svc.issueFamily('u1', NOW_SEC());
    await svc.issueFamily('u1', NOW_SEC());
    await svc.issueFamily('u2', NOW_SEC());

    await svc.revokeAllForUser('u1', 'password-change');
    expect(rows.filter((r) => r.userId === 'u1').every((r) => r.revokedAt !== null)).toBe(true);
    expect(rows.filter((r) => r.userId === 'u2').every((r) => r.revokedAt === null)).toBe(true);
  });
});

/**
 * One row is written per rotation, so without housekeeping this table grows
 * forever. The prune is deliberately the same shape as
 * `RedisService.pruneExpiredMirrorRows`: fire-and-forget, hourly-gated per
 * process, and structurally unable to affect the credential path.
 */
describe('SessionRefreshService — expired-row housekeeping', () => {
  it('deletes rows past the family ceiling and leaves LIVE ones alone', async () => {
    const { rows, prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);

    // A dead family, written directly so it can predate the prune gate.
    rows.push({
      id: 'dead',
      familyId: 'old',
      userId: 'u0',
      tokenHash: 'h',
      generation: 0,
      origIat: NOW_SEC() - 40 * 86400,
      expiresAt: new Date(Date.now() - 86400_000),
      usedAt: null,
      revokedAt: null,
      userAgent: null,
      ipAddress: null,
    });

    await svc.issueFamily('u1', NOW_SEC());
    await new Promise((r) => setImmediate(r)); // the prune is fire-and-forget

    expect(rows.find((r) => r.id === 'dead')).toBeUndefined();
    expect(rows.filter((r) => r.userId === 'u1')).toHaveLength(1);
  });

  it('runs at most ONCE an hour per process, however many logins land', async () => {
    const { prisma } = makeStore();
    const svc = new SessionRefreshService(prisma);
    for (let i = 0; i < 5; i += 1) await svc.issueFamily(`u${i}`, NOW_SEC());
    await new Promise((r) => setImmediate(r));
    expect(prisma.client.sessionRefreshToken.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('a prune that is not even AVAILABLE cannot fail the login it rides along with', async () => {
    // A stale generated client (one that predates this model) would make the
    // call throw SYNCHRONOUSLY. Housekeeping must never break the credential
    // path — that would turn a cosmetic problem into an outage.
    const { prisma } = makeStore();
    delete (prisma.client.sessionRefreshToken as any).deleteMany;
    const svc = new SessionRefreshService(prisma);
    await expect(svc.issueFamily('u1', NOW_SEC())).resolves.not.toBeNull();
  });

  it('a REJECTED prune is swallowed too (a failure only defers cleanup)', async () => {
    const { prisma } = makeStore();
    (prisma.client.sessionRefreshToken as any).deleteMany = jest.fn(async () => {
      throw new Error('db down');
    });
    const svc = new SessionRefreshService(prisma);
    await expect(svc.issueFamily('u1', NOW_SEC())).resolves.not.toBeNull();
    await new Promise((r) => setImmediate(r));
  });
});
