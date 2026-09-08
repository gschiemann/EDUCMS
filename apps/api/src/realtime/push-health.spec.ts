/**
 * push-health.spec.ts — the coalesced `lastPushConnectedAt` write (P0-7 #3).
 *
 * ── WHAT IT IS PROVING ───────────────────────────────────────────────────
 * MEASURED: an API restart under 1,000 screens produced 951 WebSocket
 * re-authentications inside ~20 s (`P0-7-load-test.md` §5.8), and every one
 * called `stampPushConnected(..., { force: true })`. `force` makes no
 * difference on a cold process — the debounce map starts empty — so that was
 * 951 separate write transactions against `screens`, on a
 * `connection_limit=10` pool, in the same seconds as 1,607 rev polls and
 * 1,198 manifest fetches. 31 % of all requests failed in that window.
 *
 * The write now batches. These cases pin the three properties that make the
 * batching safe rather than merely cheaper:
 *   1. it collapses a fleet-wide reconnect to ONE statement per tenant;
 *   2. it stays TENANT-SCOPED BY CONSTRUCTION (TEN-001) — every statement
 *      still carries its own tenant predicate, so a screen can only be
 *      stamped inside the tenant its caller authenticated for;
 *   3. it is bounded, non-throwing, and never holds the process open.
 */

import {
  stampPushConnected,
  __flushPushHealthNow,
  __resetPushHealthDebounce,
} from './push-health';

interface Call {
  where: { tenantId: string; id: { in: string[] } };
  data: { lastPushConnectedAt: Date };
}

function fakePrisma() {
  const calls: Call[] = [];
  return {
    calls,
    screen: {
      updateMany: (args: Call) => {
        calls.push(args);
        return Promise.resolve({ count: args.where.id.in.length });
      },
    },
  };
}

beforeEach(() => __resetPushHealthDebounce());
afterEach(() => __resetPushHealthDebounce());

describe('stampPushConnected — coalescing', () => {
  it('collapses a 1,000-screen / 40-tenant reconnect into 40 statements', async () => {
    // The measured shape of the restart herd, at the ratio that produced it.
    const db = fakePrisma();
    for (let i = 0; i < 1_000; i++) {
      stampPushConnected(db, `scr_${i}`, `tenant_${i % 40}`, { force: true });
    }
    await __flushPushHealthNow();

    expect(db.calls).toHaveLength(40);
    const stamped = db.calls.flatMap((c) => c.where.id.in);
    expect(new Set(stamped).size).toBe(1_000); // nothing dropped
  });

  it('writes nothing at all until the batch flushes', () => {
    const db = fakePrisma();
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    expect(db.calls).toHaveLength(0);
  });

  it('keeps every statement tenant-scoped, and never mixes tenants', async () => {
    // TEN-001. The whole point of `updateMany` here is that the tenant
    // predicate is structural — a batching bug must not be able to stamp a
    // screen from a tenant the caller never authenticated for.
    const db = fakePrisma();
    stampPushConnected(db, 'scr_a1', 'tenant_a', { force: true });
    stampPushConnected(db, 'scr_b1', 'tenant_b', { force: true });
    stampPushConnected(db, 'scr_a2', 'tenant_a', { force: true });
    await __flushPushHealthNow();

    expect(db.calls).toHaveLength(2);
    const byTenant = new Map(db.calls.map((c) => [c.where.tenantId, c.where.id.in.sort()]));
    expect(byTenant.get('tenant_a')).toEqual(['scr_a1', 'scr_a2']);
    expect(byTenant.get('tenant_b')).toEqual(['scr_b1']);
    for (const c of db.calls) expect(typeof c.where.tenantId).toBe('string');
  });

  it('de-duplicates a screen that reconnects twice inside one window', async () => {
    const db = fakePrisma();
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    await __flushPushHealthNow();
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].where.id.in).toEqual(['scr_1']);
  });

  it('still writes a real timestamp', async () => {
    const db = fakePrisma();
    const before = Date.now();
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    await __flushPushHealthNow();
    const at = db.calls[0].data.lastPushConnectedAt;
    expect(at).toBeInstanceOf(Date);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    // The reader grades this column at ~10-minute freshness
    // (display.service.ts), so sub-second batching is invisible to it.
    expect(Date.now() - at.getTime()).toBeLessThan(10 * 60_000);
  });
});

describe('stampPushConnected — debounce, still', () => {
  it('drops a non-forced repeat inside the debounce window', async () => {
    const db = fakePrisma();
    stampPushConnected(db, 'scr_1', 'tenant_a'); // heartbeat
    stampPushConnected(db, 'scr_1', 'tenant_a'); // heartbeat, 15 s later
    await __flushPushHealthNow();
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].where.id.in).toEqual(['scr_1']);
  });

  it('lets a FORCED caller through the debounce', async () => {
    // A real reconnect must always be recorded — that is what distinguishes
    // AUTH_OK / SSE-open from a keepalive.
    const db = fakePrisma();
    stampPushConnected(db, 'scr_1', 'tenant_a');
    await __flushPushHealthNow();
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    await __flushPushHealthNow();
    expect(db.calls).toHaveLength(2);
  });
});

describe('stampPushConnected — it may never break its caller', () => {
  it('swallows a client that throws', async () => {
    const db = {
      screen: {
        updateMany: () => {
          throw new Error('pool timeout');
        },
      },
    };
    expect(() => stampPushConnected(db, 'scr_1', 'tenant_a', { force: true })).not.toThrow();
    await expect(__flushPushHealthNow()).resolves.toBeUndefined();
  });

  it('swallows a rejected write', async () => {
    const db = { screen: { updateMany: () => Promise.reject(new Error('deadlock')) } };
    stampPushConnected(db, 'scr_1', 'tenant_a', { force: true });
    await expect(__flushPushHealthNow()).resolves.toBeUndefined();
  });

  it('is a no-op without a client, a screen id or a tenant id', async () => {
    const db = fakePrisma();
    expect(() => stampPushConnected(null, 'scr_1', 'tenant_a', { force: true })).not.toThrow();
    stampPushConnected(db, '', 'tenant_a', { force: true });
    stampPushConnected(db, 'scr_1', '', { force: true });
    await __flushPushHealthNow();
    expect(db.calls).toHaveLength(0);
  });

  it('flushes rather than growing without bound', async () => {
    // MAX_PENDING is 2,000 — twice the measured herd. Past it the batch
    // flushes immediately instead of accumulating, so a pathological caller
    // cannot turn a telemetry stamp into unbounded process state.
    const db = fakePrisma();
    for (let i = 0; i < 2_500; i++) {
      stampPushConnected(db, `scr_${i}`, `tenant_${i % 40}`, { force: true });
    }
    // The immediate flush already fired without anyone awaiting a timer.
    await Promise.resolve();
    expect(db.calls.length).toBeGreaterThan(0);
    await __flushPushHealthNow();
    const stamped = new Set(db.calls.flatMap((c) => c.where.id.in));
    expect(stamped.size).toBe(2_500);
  });
});
