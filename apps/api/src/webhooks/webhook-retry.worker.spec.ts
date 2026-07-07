import { WebhookRetryWorker } from './webhook-retry.worker';

/**
 * Reclaim + claim-lease hardening.
 *
 * P1-5 (2026-05-28) made every delivery a durable row with a backoff retry.
 * The reclaim (2026-07-04) re-arms rows stranded PENDING + next_retry_at NULL by
 * a mid-drain pod crash — otherwise the claim's own `next_retry_at IS NOT NULL`
 * filter makes them invisible forever, INCLUDING emergency.triggered.
 *
 * The 2026-07-07 lease/heartbeat hardening closes the bug where the reclaim
 * mistook a merely-SLOW worker (alive but its DB write stalled by a pgbouncer
 * blip / GC pause / a large in-flight batch) for a CRASHED one and re-claimed a
 * delivery it was still sending → the SAME webhook fired TWICE. The claim stamps
 * `updated_at = NOW()` (the lease) and the worker refreshes it every
 * WEBHOOK_RETRY_HEARTBEAT_MS while sending; the reclaim only re-arms rows whose
 * lease is older than a threshold ≥ 4× the heartbeat.
 *
 * The row-level SQL correctness needs a Postgres to exercise for real. These
 * tests use a compact in-memory table (`FakeDeliveries`) that interprets the
 * three exact statements the worker emits (reclaim / claim / heartbeat) against
 * a controllable clock, so the crashed-vs-slow distinction, the exactly-once
 * redelivery, and the completed-never-reclaimed invariants are all proven
 * behaviorally — plus the two mock-level properties (reclaim runs first;
 * a reclaim failure never aborts the drain).
 */

// ── In-memory model of the webhook_deliveries table ────────────────────────
type Row = {
  id: string;
  webhook_id: string;
  event: string;
  body: string;
  signed_timestamp: bigint;
  attempts: number;
  status: string; // PENDING | DELIVERED | FAILED
  next_retry_at: number | null; // epoch ms, null = not scheduled / in-flight
  updated_at: number; // epoch ms — the lease
};

/** The real WebhookDispatchService backoff schedule, mirrored for the fake. */
function nextRetryDelayMs(attempts: number): number | null {
  const backoff = [5_000, 30_000, 120_000];
  const idx = attempts - 1;
  return idx >= 0 && idx < backoff.length ? backoff[idx] : null;
}

class FakeDeliveries {
  now = 1_000_000; // controllable clock (epoch ms)
  rows: Row[] = [];

  seed(partial: Partial<Row> & { id: string }): Row {
    const row: Row = {
      webhook_id: 'wh1',
      event: 'emergency.triggered',
      body: '{"event":"emergency.triggered"}',
      signed_timestamp: BigInt(1),
      attempts: 0,
      status: 'PENDING',
      next_retry_at: null,
      updated_at: this.now,
      ...partial,
    };
    this.rows.push(row);
    return row;
  }

  get(id: string): Row {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error(`no row ${id}`);
    return r;
  }

  /** Interprets $executeRawUnsafe — either the reclaim or the heartbeat. */
  async execRaw(sql: string, ...params: unknown[]): Promise<number> {
    if (/SET "next_retry_at" = NOW\(\)/.test(sql)) {
      // RECLAIM: PENDING + next_retry_at NULL + lease older than threshold.
      const m = sql.match(/INTERVAL '1 millisecond' \* (\d+)/);
      if (!m) throw new Error('reclaim SQL missing threshold');
      const threshold = Number(m[1]);
      let n = 0;
      for (const r of this.rows) {
        if (
          r.status === 'PENDING' &&
          r.next_retry_at === null &&
          r.updated_at < this.now - threshold
        ) {
          r.next_retry_at = this.now;
          n += 1;
        }
      }
      return n;
    }
    if (/SET "updated_at" = NOW\(\)/.test(sql)) {
      // HEARTBEAT: bump the lease for the given in-flight ids.
      const ids = params as string[];
      let n = 0;
      for (const r of this.rows) {
        if (ids.includes(r.id) && r.status === 'PENDING' && r.next_retry_at === null) {
          r.updated_at = this.now;
          n += 1;
        }
      }
      return n;
    }
    return 0;
  }

  /** Interprets $queryRawUnsafe — the claim. Returns the claimed rows. */
  async queryRaw(sql: string): Promise<
    Array<Pick<Row, 'id' | 'webhook_id' | 'event' | 'body' | 'signed_timestamp' | 'attempts'>>
  > {
    const lim = sql.match(/LIMIT (\d+)/);
    const limit = lim ? Number(lim[1]) : 50;
    const due = this.rows
      .filter(
        (r) => r.status === 'PENDING' && r.next_retry_at !== null && r.next_retry_at <= this.now,
      )
      .sort((a, b) => (a.next_retry_at as number) - (b.next_retry_at as number))
      .slice(0, limit);
    for (const r of due) {
      r.attempts += 1;
      r.next_retry_at = null;
      r.updated_at = this.now;
    }
    return due.map((r) => ({
      id: r.id,
      webhook_id: r.webhook_id,
      event: r.event,
      body: r.body,
      signed_timestamp: r.signed_timestamp,
      attempts: r.attempts,
    }));
  }
}

/**
 * Wire a worker to a FakeDeliveries table. Each delivery-row POST is recorded in
 * `sends` (so we can assert exactly-once); the worker always calls
 * `applyOutcome(deliveryRowId, …)` exactly once immediately after each real POST,
 * so it is the faithful 1:1 record of "was this delivery sent to the receiver."
 * `applyOutcome` also mutates the fake row the same way the real
 * WebhookDispatchService does (DELIVERED on ok, else re-arm/FAIL by the backoff
 * schedule).
 */
function makeWorker(opts?: { deliverOk?: boolean }) {
  const db = new FakeDeliveries();
  const sends: string[] = []; // delivery-row ids POSTed, in order

  const prisma = {
    client: {
      $executeRawUnsafe: jest.fn((sql: string, ...p: unknown[]) => db.execRaw(sql, ...p)),
      $queryRawUnsafe: jest.fn((sql: string) => db.queryRaw(sql)),
      tenantWebhook: {
        findMany: jest.fn(async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? [];
          return ids.map((id) => ({
            id,
            url: 'https://receiver.example/hook',
            signingSecret: 'sek',
            isActive: true,
          }));
        }),
      },
      webhookDelivery: {
        update: jest.fn(async ({ where, data }: any) => {
          const r = db.get(where.id);
          r.status = data.status ?? r.status;
          if (data.nextRetryAt !== undefined) {
            r.next_retry_at = data.nextRetryAt === null ? null : (data.nextRetryAt as Date).getTime();
          }
          return {};
        }),
      },
    },
  } as any;

  const deliverOk = opts?.deliverOk ?? true;
  const dispatch = {
    attemptDelivery: jest.fn(async () => ({
      ok: deliverOk,
      status: deliverOk ? 200 : 500,
      errorMessage: deliverOk ? null : 'HTTP 500',
    })),
    applyOutcome: jest.fn(async (deliveryRowId: string, attempts: number, outcome: any) => {
      sends.push(deliveryRowId); // one POST → one applyOutcome in the worker path
      const r = db.get(deliveryRowId);
      if (outcome.ok) {
        r.status = 'DELIVERED';
        r.next_retry_at = null;
      } else {
        const delay = nextRetryDelayMs(attempts);
        if (delay === null) {
          r.status = 'FAILED';
          r.next_retry_at = null;
        } else {
          r.status = 'PENDING';
          r.next_retry_at = db.now + delay;
        }
      }
      r.updated_at = db.now;
    }),
  } as any;

  const worker = new WebhookRetryWorker(prisma, dispatch);
  return { worker, prisma, dispatch, db, sends };
}

// ── Mock-level ordering / isolation properties (no real SQL needed) ─────────
describe('WebhookRetryWorker — reclaim runs first, error-isolated', () => {
  function makeOrderWorker() {
    const order: string[] = [];
    const execCalls: string[] = [];
    const prisma = {
      client: {
        $executeRawUnsafe: jest.fn(async (sql: string) => {
          order.push('reclaim');
          execCalls.push(sql);
          return 0;
        }),
        $queryRawUnsafe: jest.fn(async () => {
          order.push('claim');
          return []; // no due rows → drain is a no-op after the reclaim
        }),
        tenantWebhook: { findMany: jest.fn(async () => []) },
        webhookDelivery: { update: jest.fn(async () => ({})) },
      },
    } as any;
    const dispatch = { attemptDelivery: jest.fn(), applyOutcome: jest.fn() } as any;
    return { worker: new WebhookRetryWorker(prisma, dispatch), prisma, order, execCalls };
  }

  it('reclaims stranded rows BEFORE claiming due rows, targeting exactly the PENDING+next_retry_at-NULL limbo', async () => {
    const { worker, order, execCalls } = makeOrderWorker();
    await worker.tick();

    // Reclaim must run first so a just-re-armed row is claimable this cycle.
    expect(order).toEqual(['reclaim', 'claim']);

    const sql = execCalls[0];
    expect(sql).toMatch(/UPDATE "webhook_deliveries"/);
    expect(sql).toMatch(/SET "next_retry_at" = NOW\(\)/);
    expect(sql).toMatch(/"status" = 'PENDING'/);
    expect(sql).toMatch(/"next_retry_at" IS NULL/);
    // Only rows whose lease is stale — never one a healthy replica is working.
    expect(sql).toMatch(/"updated_at" < NOW\(\)/);
  });

  it('a reclaim failure does NOT abort the normal drain (best-effort hardening)', async () => {
    const { worker, prisma } = makeOrderWorker();
    prisma.client.$executeRawUnsafe.mockRejectedValueOnce(new Error('boom'));

    const res = await worker.tick();

    expect(prisma.client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ claimed: 0, delivered: 0, failed: 0 });
  });
});

// ── Reclaim threshold ≫ heartbeat (the anti-double-send margin) ─────────────
describe('WebhookRetryWorker — reclaim threshold vs heartbeat', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  async function captureReclaimThresholdMs(): Promise<number> {
    const { worker, prisma } = makeWorker();
    await worker.tick();
    const call = prisma.client.$executeRawUnsafe.mock.calls.find((c: any[]) =>
      /SET "next_retry_at" = NOW\(\)/.test(c[0]),
    );
    const m = String(call[0]).match(/INTERVAL '1 millisecond' \* (\d+)/);
    return Number(m![1]);
  }

  it('default threshold (120s) is comfortably larger than the default heartbeat (10s)', async () => {
    const threshold = await captureReclaimThresholdMs();
    expect(threshold).toBe(120_000);
    expect(threshold).toBeGreaterThanOrEqual(10_000 * 4);
  });

  it('a too-small configured reclaim is floored to ≥ 4× the heartbeat so a slow-but-alive worker survives missed beats', async () => {
    process.env.WEBHOOK_RETRY_HEARTBEAT_MS = '10000';
    process.env.WEBHOOK_RETRY_RECLAIM_MS = '5000'; // absurdly small
    const threshold = await captureReclaimThresholdMs();
    expect(threshold).toBeGreaterThanOrEqual(40_000); // 4 × 10s
  });
});

// ── Behavioral proofs against the in-memory table ───────────────────────────
describe('WebhookRetryWorker — crashed vs slow (in-memory table)', () => {
  it('(a) a slow-but-alive worker that REFRESHES its lease within the window is NOT reclaimed → no double-send', async () => {
    const { worker, db } = makeWorker();
    const beat = worker['heartbeatMs']();
    const threshold = worker['reclaimThresholdMs'](beat);

    // Row claimed by an alive worker: PENDING, next_retry_at NULL (in-flight),
    // lease just stamped.
    const t0 = db.now;
    const row = db.seed({ id: 'd-slow', status: 'PENDING', next_retry_at: null, updated_at: t0 });
    worker['inFlight'].add(row.id); // this worker is actively sending it

    // Time crawls forward past the threshold, but the alive worker heartbeats
    // every `beat`, refreshing the lease each time.
    for (let elapsed = beat; elapsed <= threshold + 2 * beat; elapsed += beat) {
      db.now = t0 + elapsed;
      await worker['refreshLeases'](); // the live worker's heartbeat fires
      const reclaimed = await worker['reclaimStranded'](beat); // a peer replica's reclaim
      expect(reclaimed).toBe(0); // never reclaimed while the lease stays fresh
      expect(db.get('d-slow').next_retry_at).toBeNull(); // still in-flight, not re-armed
    }
  });

  it('(a-contrast) WITHOUT the heartbeat, the same row IS falsely reclaimed once the window elapses (the bug)', async () => {
    const { worker, db } = makeWorker();
    const beat = worker['heartbeatMs']();
    const threshold = worker['reclaimThresholdMs'](beat);

    const t0 = db.now;
    db.seed({ id: 'd-nobeat', status: 'PENDING', next_retry_at: null, updated_at: t0 });

    // No refreshLeases() calls — simulate the pre-fix worker that never bumps.
    db.now = t0 + threshold + 1;
    const reclaimed = await worker['reclaimStranded'](beat);

    expect(reclaimed).toBe(1); // stale lease → reclaimed
    expect(db.get('d-nobeat').next_retry_at).toBe(db.now); // re-armed → would double-send
  });

  it('(b) a truly-stranded delivery (lease older than threshold, no heartbeat) IS reclaimed and then delivered EXACTLY once', async () => {
    const { worker, db, sends } = makeWorker({ deliverOk: true });
    const beat = worker['heartbeatMs']();
    const threshold = worker['reclaimThresholdMs'](beat);

    // Pod crashed mid-drain: row left PENDING, next_retry_at NULL, lease stale.
    const t0 = db.now;
    db.seed({ id: 'd-stranded', status: 'PENDING', next_retry_at: null, updated_at: t0, attempts: 1 });

    // A fresh tick after the lease expires: reclaim re-arms → claim → deliver.
    db.now = t0 + threshold + 1;
    const res = await worker.tick();

    expect(res.claimed).toBe(1);
    expect(res.delivered).toBe(1);
    expect(sends).toEqual(['d-stranded']); // delivered exactly once
    expect(db.get('d-stranded').status).toBe('DELIVERED');
    expect(db.get('d-stranded').next_retry_at).toBeNull();

    // A subsequent tick must NOT re-send it (terminal row excluded everywhere).
    db.now += threshold + 1;
    const res2 = await worker.tick();
    expect(res2).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(sends).toEqual(['d-stranded']); // STILL exactly once
  });

  it('(c) a completed delivery is NEVER reclaimed — DELIVERED, FAILED, and already-scheduled rows are all excluded', async () => {
    const { worker, db } = makeWorker();
    const beat = worker['heartbeatMs']();
    const threshold = worker['reclaimThresholdMs'](beat);
    const old = db.now - threshold - 10_000; // lease well past the window for all
    const scheduledAt = db.now + 5_000;

    db.seed({ id: 'done', status: 'DELIVERED', next_retry_at: null, updated_at: old });
    db.seed({ id: 'dead', status: 'FAILED', next_retry_at: null, updated_at: old });
    // PENDING but already scheduled for a normal retry (next_retry_at set):
    db.seed({ id: 'sched', status: 'PENDING', next_retry_at: scheduledAt, updated_at: old });
    // The one genuinely-stranded row (control):
    db.seed({ id: 'limbo', status: 'PENDING', next_retry_at: null, updated_at: old });

    const reclaimed = await worker['reclaimStranded'](beat);

    expect(reclaimed).toBe(1); // ONLY 'limbo'
    expect(db.get('done').next_retry_at).toBeNull(); // untouched
    expect(db.get('dead').next_retry_at).toBeNull(); // untouched
    expect(db.get('sched').next_retry_at).toBe(scheduledAt); // schedule unchanged
    expect(db.get('limbo').next_retry_at).toBe(db.now); // re-armed
  });

  it('respects the max-retry cap — a poison delivery is not reclaimed-and-resent forever (it terminates as FAILED)', async () => {
    const { worker, db, sends } = makeWorker({ deliverOk: false });
    const beat = worker['heartbeatMs']();
    const threshold = worker['reclaimThresholdMs'](beat);

    // A row that has already exhausted its attempts (attempts = 4 = MAX): the
    // claim bumps it to 5, applyOutcome sees no backoff step left → FAILED.
    const t0 = db.now;
    db.seed({ id: 'poison', status: 'PENDING', next_retry_at: null, updated_at: t0, attempts: 4 });

    db.now = t0 + threshold + 1;
    await worker.tick(); // reclaim → claim → attempt(fail) → FAILED

    expect(db.get('poison').status).toBe('FAILED');
    expect(db.get('poison').next_retry_at).toBeNull();
    const sendsAfterFirst = sends.length;

    // Further ticks, however far the clock advances, never resurrect it.
    db.now += threshold * 10;
    await worker.tick();
    expect(db.get('poison').status).toBe('FAILED');
    expect(sends.length).toBe(sendsAfterFirst); // no further sends
  });
});
