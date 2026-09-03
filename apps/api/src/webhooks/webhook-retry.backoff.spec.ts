import {
  WebhookRetryWorker,
  WEBHOOK_POLL_BASE_MS_DEFAULT,
  WEBHOOK_POLL_IDLE_CEILING_MS,
} from './webhook-retry.worker';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idle backoff — 2026-09-02 efficiency audit.
 *
 * VERIFIED, with a caveat: the worker really did poll on a flat 5 s
 * `setInterval` (17,280 ticks/day/replica) against a queue that is empty
 * essentially always. What the audit did NOT account for is the 2026-08-15
 * idle gate, which had already cut an empty tick from two unconditional
 * UPDATEs to ONE read-only existence probe. So the remaining waste was
 * 17,280 pointless SELECTs/day/replica, not 35k writes.
 *
 * The fix: exponential idle backoff 5 s → 60 s, snapping back to 5 s the
 * moment work appears — either because a tick claimed something or because
 * WebhookDispatchService signalled that a delivery was just armed for retry.
 * The ceiling is a hard 60 s in code so a retry can never be parked for
 * minutes, no matter what the env says.
 */

type Claimed = { claimed: number; delivered: number; failed: number };

function makeWorker(opts: { hasWork: () => boolean; claimsWork?: boolean }) {
  const probes: number[] = []; // wall-clock (fake) times of each probe
  let claimSeq = 0;
  const prisma = {
    client: {
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (/SELECT 1 AS one/.test(sql)) {
          probes.push(Date.now());
          return opts.hasWork() ? [{ one: 1 }] : [];
        }
        if (!opts.claimsWork) return []; // the claim finds nothing
        claimSeq += 1;
        return [
          {
            id: `d${claimSeq}`,
            webhook_id: 'wh1',
            event: 'emergency.triggered',
            body: '{}',
            signed_timestamp: BigInt(1),
            attempts: 1,
          },
        ];
      }),
      $executeRawUnsafe: jest.fn(async () => 0),
      tenantWebhook: {
        findMany: jest.fn(async () => [
          { id: 'wh1', url: 'https://receiver.example/hook', signingSecret: 'sek', isActive: true },
        ]),
      },
      webhookDelivery: { update: jest.fn(async () => ({})) },
    },
  } as unknown as PrismaService;

  let listener: (() => void) | null = null;
  const dispatch = {
    onRetryScheduled: jest.fn((l: () => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
    attemptDelivery: jest.fn(async () => ({ ok: true, status: 200, errorMessage: null })),
    applyOutcome: jest.fn(async () => undefined),
  } as unknown as WebhookDispatchService;

  const worker = new WebhookRetryWorker(prisma, dispatch);
  return {
    worker,
    probes,
    dispatch,
    signalRetryEnqueued: () => listener?.(),
  };
}

/** Start the worker for real (onModuleInit early-returns under NODE_ENV=test). */
function startOutsideTestEnv(worker: WebhookRetryWorker) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    worker.onModuleInit();
  } finally {
    process.env.NODE_ENV = prev;
  }
}

describe('WebhookRetryWorker.nextPollDelayMs — the backoff curve', () => {
  const base = WEBHOOK_POLL_BASE_MS_DEFAULT;
  const ceiling = WEBHOOK_POLL_IDLE_CEILING_MS;

  it('doubles while idle and stops at the 60s ceiling', () => {
    const seen: number[] = [];
    let d = base;
    for (let i = 0; i < 6; i++) {
      d = WebhookRetryWorker.nextPollDelayMs(d, false, base, ceiling);
      seen.push(d);
    }
    expect(seen).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });

  it('snaps straight back to the base cadence the moment a tick does work', () => {
    expect(WebhookRetryWorker.nextPollDelayMs(60_000, true, base, ceiling)).toBe(base);
  });

  it('never returns more than 60s even from an absurd starting delay', () => {
    expect(WebhookRetryWorker.nextPollDelayMs(10 * 60_000, false, base, ceiling)).toBe(60_000);
  });
});

describe('WebhookRetryWorker — idle polling', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    jest.useRealTimers();
  });

  it('an always-empty queue backs off 5→10→20→40→60s instead of probing every 5s', async () => {
    jest.useFakeTimers();
    const { worker, probes } = makeWorker({ hasWork: () => false });
    const t0 = Date.now();
    startOutsideTestEnv(worker);

    // 2 minutes of wall time. A flat 5s interval would be 24 probes.
    await jest.advanceTimersByTimeAsync(120_000);
    worker.onModuleDestroy();

    // Probes land at 5s, then +10, +20, +40 → 5 / 15 / 35 / 75s. The 5th is
    // scheduled at 135s, past the window. A flat 5s interval would have run 24.
    expect(probes.map((t) => t - t0)).toEqual([5_000, 15_000, 35_000, 75_000]);
    expect(worker.currentPollDelayMs).toBe(60_000);
  });

  it('a day of idling costs ~1.4k probes instead of 17,280', async () => {
    jest.useFakeTimers();
    const { worker, probes } = makeWorker({ hasWork: () => false });
    startOutsideTestEnv(worker);

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    worker.onModuleDestroy();

    // Ceiling 60s → 1440/day plus the four ramp-up probes.
    expect(probes.length).toBeLessThan(1_500);
    expect(probes.length).toBeGreaterThan(1_400);
  });

  it('an ENQUEUE signal resets the backoff to the 5s cadence immediately', async () => {
    jest.useFakeTimers();
    const { worker, probes, signalRetryEnqueued } = makeWorker({ hasWork: () => false });
    startOutsideTestEnv(worker);

    await jest.advanceTimersByTimeAsync(200_000); // fully backed off
    expect(worker.currentPollDelayMs).toBe(60_000);
    const before = probes.length;

    // A delivery just failed and was armed for retry.
    signalRetryEnqueued();
    expect(worker.currentPollDelayMs).toBe(5_000);

    // The next probe lands 5s later, not up to 60s later.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(probes.length).toBe(before + 1);
    worker.onModuleDestroy();
  });

  it('a queue that keeps producing CLAIMED work stays on the tight 5s cadence', async () => {
    jest.useFakeTimers();
    const { worker, probes } = makeWorker({ hasWork: () => true, claimsWork: true });
    const t0 = Date.now();
    startOutsideTestEnv(worker);

    await jest.advanceTimersByTimeAsync(20_000);
    worker.onModuleDestroy();

    expect(probes.map((t) => t - t0)).toEqual([5_000, 10_000, 15_000, 20_000]);
    expect(worker.currentPollDelayMs).toBe(5_000);
  });

  it('backs off when the probe sees work but nothing is CLAIMED (a peer replica took it)', async () => {
    jest.useFakeTimers();
    // The probe says "there is work" but the claim returns nothing — another
    // replica won the FOR UPDATE SKIP LOCKED race. Backoff follows CLAIMED
    // rows, which is the honest signal about whether THIS worker has a job.
    const { worker, probes } = makeWorker({ hasWork: () => true, claimsWork: false });
    const t0 = Date.now();
    startOutsideTestEnv(worker);
    await jest.advanceTimersByTimeAsync(20_000);
    worker.onModuleDestroy();
    expect(probes.map((t) => t - t0)).toEqual([5_000, 15_000]);
  });

  it('the idle ceiling cannot be configured above 60s', async () => {
    jest.useFakeTimers();
    process.env.WEBHOOK_RETRY_MAX_IDLE_MS = '600000'; // 10 minutes — refused
    const { worker, probes } = makeWorker({ hasWork: () => false });
    startOutsideTestEnv(worker);

    await jest.advanceTimersByTimeAsync(600_000);
    worker.onModuleDestroy();

    expect(worker.currentPollDelayMs).toBe(60_000);
    // With a 10-minute ceiling there would be ~5 probes in 600s.
    expect(probes.length).toBeGreaterThan(10);
  });

  it('onModuleDestroy stops the loop and unsubscribes from the enqueue signal', async () => {
    jest.useFakeTimers();
    const { worker, probes, signalRetryEnqueued } = makeWorker({ hasWork: () => false });
    startOutsideTestEnv(worker);
    await jest.advanceTimersByTimeAsync(10_000);
    const after = probes.length;

    worker.onModuleDestroy();
    signalRetryEnqueued(); // unsubscribed — must not resurrect the loop
    await jest.advanceTimersByTimeAsync(300_000);

    expect(probes.length).toBe(after);
  });
});

describe('WebhookDispatchService — the enqueue signal', () => {
  function makeDispatch() {
    const update = jest.fn(async () => ({}));
    const prisma = {
      client: { webhookDelivery: { update } },
    } as unknown as PrismaService;
    const svc = new WebhookDispatchService(prisma);
    const woke = jest.fn();
    const off = svc.onRetryScheduled(woke);
    return { svc, woke, off, update };
  }

  it('signals when a failed delivery is ARMED for another attempt', async () => {
    const { svc, woke } = makeDispatch();
    await svc.applyOutcome('row1', 1, { ok: false, status: 500, errorMessage: 'HTTP 500' });
    expect(woke).toHaveBeenCalledTimes(1);
  });

  it('does NOT signal on success or on a permanently-failed delivery', async () => {
    const { svc, woke } = makeDispatch();
    await svc.applyOutcome('row1', 1, { ok: true, status: 200, errorMessage: null });
    // attempts exhausted (backoff schedule has 3 steps) → FAILED, no retry
    await svc.applyOutcome('row2', 4, { ok: false, status: 500, errorMessage: 'HTTP 500' });
    expect(woke).not.toHaveBeenCalled();
  });

  it('does NOT signal when the arming write itself failed', async () => {
    const { svc, woke, update } = makeDispatch();
    update.mockRejectedValueOnce(new Error('db down'));
    await svc.applyOutcome('row1', 1, { ok: false, status: 500, errorMessage: 'HTTP 500' });
    expect(woke).not.toHaveBeenCalled();
  });

  it('a listener that throws never affects delivery bookkeeping', async () => {
    const { svc } = makeDispatch();
    svc.onRetryScheduled(() => {
      throw new Error('bad listener');
    });
    await expect(
      svc.applyOutcome('row1', 1, { ok: false, status: 500, errorMessage: 'HTTP 500' }),
    ).resolves.toBeUndefined();
  });

  it('unsubscribing stops the signal', async () => {
    const { svc, woke, off } = makeDispatch();
    off();
    await svc.applyOutcome('row1', 1, { ok: false, status: 500, errorMessage: 'HTTP 500' });
    expect(woke).not.toHaveBeenCalled();
  });
});
