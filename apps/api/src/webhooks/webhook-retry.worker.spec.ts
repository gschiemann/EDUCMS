import { WebhookRetryWorker } from './webhook-retry.worker';

/**
 * Reclaim hardening (2026-07-04). The claim sets `next_retry_at = NULL` to hold
 * a row out of the due set while it's attempted; if the pod dies before
 * applyOutcome, the row is stranded PENDING + next_retry_at NULL — invisible to
 * every future claim (which filters `next_retry_at IS NOT NULL`) and never
 * redelivered, INCLUDING emergency.triggered. drainOnce now re-arms those
 * stranded rows first.
 *
 * The reclaim's row-level correctness lives in raw SQL (needs a real Postgres to
 * exercise); these unit tests lock in the two properties a mock CAN prove: the
 * reclaim runs BEFORE the claim, and a reclaim failure never aborts the drain.
 */
function makeWorker() {
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
  const worker = new WebhookRetryWorker(prisma, dispatch);
  return { worker, prisma, dispatch, order, execCalls };
}

describe('WebhookRetryWorker — stranded-delivery reclaim', () => {
  it('reclaims stranded in-flight deliveries BEFORE claiming due rows, targeting exactly the PENDING+next_retry_at-NULL limbo', async () => {
    const { worker, order, execCalls } = makeWorker();

    await worker.tick();

    // Reclaim must run first so a just-re-armed row is claimable this cycle.
    expect(order).toEqual(['reclaim', 'claim']);

    // The reclaim targets exactly the stranded state and re-arms it to NOW().
    const sql = execCalls[0];
    expect(sql).toMatch(/UPDATE "webhook_deliveries"/);
    expect(sql).toMatch(/SET "next_retry_at" = NOW\(\)/);
    expect(sql).toMatch(/"status" = 'PENDING'/);
    expect(sql).toMatch(/"next_retry_at" IS NULL/);
    // Only rows idle past the threshold — never a row a healthy replica is
    // actively working (its updated_at is recent).
    expect(sql).toMatch(/"updated_at" < NOW\(\)/);
  });

  it('a reclaim failure does NOT abort the normal drain (best-effort hardening)', async () => {
    const { worker, prisma } = makeWorker();
    // Simulate the reclaim UPDATE throwing (e.g. a transient pool blip).
    prisma.client.$executeRawUnsafe.mockRejectedValueOnce(new Error('boom'));

    const res = await worker.tick();

    // The claim/drain still ran despite the reclaim throwing.
    expect(prisma.client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ claimed: 0, delivered: 0, failed: 0 });
  });
});
