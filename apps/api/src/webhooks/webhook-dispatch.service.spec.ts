/**
 * Audit P1-5 (2026-05-28) — outbound webhook retry queue.
 *
 * Before this, WebhookDispatchService POSTed once and gave up; a receiver
 * down for 8s during a lockdown lost `emergency.triggered` permanently.
 *
 * Pinned behaviors:
 *   1. A FAILED first delivery (non-2xx) schedules a retry: the delivery
 *      row stays PENDING, attempts=1, nextRetryAt is set to now+backoff[0].
 *   2. A SUCCESSFUL delivery flips the row to DELIVERED, clears nextRetryAt.
 *   3. After WEBHOOK_MAX_ATTEMPTS failed attempts the row flips to FAILED
 *      (permanently — nextRetryAt cleared, no further retry scheduled).
 *   4. The backoff schedule is 5s / 30s / 120s for the 3 retries; the 4th
 *      "attempt slot" returns null (give up).
 *   5. WebhookRetryWorker claims a due row, re-POSTs, and on success marks
 *      it DELIVERED.
 *   6. WebhookRetryWorker gives up (FAILED) when the parent webhook was
 *      deleted / deactivated between attempts.
 */

import { Logger } from '@nestjs/common';

// SSRF (Audit task #58): attemptDelivery now POSTs through safeFetchPost, NOT
// global fetch — it re-resolves + connect-pins the destination on every send,
// so a rebinding webhook url can't reach an internal/metadata IP at delivery
// time. Mock the module here; the dedicated webhook-dispatch.ssrf.spec.ts
// exercises the REAL safeFetchPost against internal-IP URLs.
jest.mock('../branding/safe-fetch', () => {
  class SsrfError extends Error {
    constructor(msg: string) { super(msg); this.name = 'SsrfError'; }
  }
  return { safeFetchPost: jest.fn(), SsrfError };
});

import {
  WebhookDispatchService,
  WEBHOOK_RETRY_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
} from './webhook-dispatch.service';
import { WebhookRetryWorker } from './webhook-retry.worker';
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { safeFetchPost, SsrfError } from '../branding/safe-fetch';

const postMock = safeFetchPost as unknown as jest.Mock;

// Silence the service's warn logs during the expected-failure cases.
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined as any);
});
afterAll(() => jest.restoreAllMocks());

describe('WebhookDispatchService — retry scheduling (P1-5)', () => {
  describe('nextRetryDelayMs / backoff schedule', () => {
    it('uses 5s / 30s / 120s for the 3 retries, null after that', () => {
      expect(WEBHOOK_RETRY_BACKOFF_MS).toEqual([5_000, 30_000, 120_000]);
      // attempts=1 → first retry uses backoff[0]; etc.
      expect(WebhookDispatchService.nextRetryDelayMs(1)).toBe(5_000);
      expect(WebhookDispatchService.nextRetryDelayMs(2)).toBe(30_000);
      expect(WebhookDispatchService.nextRetryDelayMs(3)).toBe(120_000);
      // The 4th attempt slot exhausts retries — caller marks FAILED.
      expect(WebhookDispatchService.nextRetryDelayMs(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
      expect(WebhookDispatchService.nextRetryDelayMs(99)).toBeNull();
    });
  });

  describe('applyOutcome', () => {
    function makeSvc() {
      const updates: Array<{ where: any; data: any }> = [];
      const prisma: any = {
        client: {
          webhookDelivery: {
            update: jest.fn(async (args: any) => {
              updates.push(args);
              return { id: args.where.id, ...args.data };
            }),
          },
        },
      };
      const svc = new WebhookDispatchService(prisma as PrismaService);
      return { svc, updates };
    }

    it('a failed first attempt keeps the row PENDING and schedules a retry', async () => {
      const { svc, updates } = makeSvc();
      const before = Date.now();
      await svc.applyOutcome('dlv1', 1, {
        ok: false,
        status: 503,
        errorMessage: '503 Service Unavailable',
      });
      expect(updates).toHaveLength(1);
      const data = updates[0].data;
      expect(data.status).toBe('PENDING');
      expect(data.attempts).toBe(1);
      expect(data.lastStatusCode).toBe(503);
      expect(data.lastError).toContain('503');
      // nextRetryAt ≈ now + 5s (backoff[0]).
      const eta = (data.nextRetryAt as Date).getTime();
      expect(eta).toBeGreaterThanOrEqual(before + 5_000 - 50);
      expect(eta).toBeLessThanOrEqual(Date.now() + 5_000 + 50);
    });

    it('a successful attempt flips the row to DELIVERED and clears retry', async () => {
      const { svc, updates } = makeSvc();
      await svc.applyOutcome('dlv1', 2, { ok: true, status: 200, errorMessage: null });
      const data = updates[0].data;
      expect(data.status).toBe('DELIVERED');
      expect(data.attempts).toBe(2);
      expect(data.nextRetryAt).toBeNull();
      expect(data.lastError).toBeNull();
    });

    it('after the max attempts a failure is marked permanently FAILED', async () => {
      const { svc, updates } = makeSvc();
      await svc.applyOutcome('dlv1', WEBHOOK_MAX_ATTEMPTS, {
        ok: false,
        status: null,
        errorMessage: 'request timed out after 8s',
      });
      const data = updates[0].data;
      expect(data.status).toBe('FAILED');
      expect(data.attempts).toBe(WEBHOOK_MAX_ATTEMPTS);
      expect(data.nextRetryAt).toBeNull();
      expect(data.lastError).toContain('timed out');
    });
  });

  describe('attemptDelivery — wire format', () => {
    beforeEach(() => postMock.mockReset());

    it('signs with the persisted timestamp so retries reproduce the same signature', async () => {
      postMock.mockResolvedValue({ status: 200 });
      const prisma: any = { client: {} };
      const svc = new WebhookDispatchService(prisma as PrismaService);
      const out = await svc.attemptDelivery(
        { id: 'wh1', url: 'https://example.test/hook', signingSecret: 'whsec_abc' },
        '{"event":"emergency.triggered"}',
        'emergency.triggered',
        1717000000000,
      );
      expect(out.ok).toBe(true);
      expect(out.status).toBe(200);
      // SSRF: the POST went through safeFetchPost (NOT global fetch).
      const [url, init] = postMock.mock.calls[0];
      expect(url).toBe('https://example.test/hook');
      // Same input timestamp + body → deterministic signature header.
      expect(init.headers['X-VenueOS-Timestamp']).toBe('1717000000000');
      expect(init.headers['X-VenueOS-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      // The signed body is forwarded verbatim so the receiver can verify.
      expect(init.body).toBe('{"event":"emergency.triggered"}');
    });

    it('a non-2xx response is reported as not-ok WITHOUT leaking the response body', async () => {
      // safeFetchPost only returns a status — there is no upstream body to
      // reflect. The recorded errorMessage must be a generic status string,
      // never the receiver's response text (anti-exfil, Audit 35-SSRF).
      postMock.mockResolvedValue({ status: 500 });
      const svc = new WebhookDispatchService({ client: {} } as PrismaService);
      const out = await svc.attemptDelivery(
        { id: 'wh1', url: 'https://example.test/hook', signingSecret: 's' },
        '{}',
        'emergency.triggered',
        1,
      );
      expect(out.ok).toBe(false);
      expect(out.status).toBe(500);
      expect(out.errorMessage).toBe('HTTP 500');
    });

    it('an SSRF rejection is recorded as a generic refusal, not the resolved IP', async () => {
      // safeFetchPost throws SsrfError when the url resolves to a private /
      // metadata IP. The outcome must NOT echo that IP back to the operator.
      postMock.mockRejectedValue(
        new SsrfError('DNS for evil.test resolved to private range (169.254.169.254)'),
      );
      const svc = new WebhookDispatchService({ client: {} } as PrismaService);
      const out = await svc.attemptDelivery(
        { id: 'wh1', url: 'http://evil.test/hook', signingSecret: 's' },
        '{}',
        'emergency.triggered',
        1,
      );
      expect(out.ok).toBe(false);
      expect(out.status).toBeNull();
      expect(out.errorMessage).toBe('destination refused (not publicly reachable)');
      // Critical: the private IP must not leak into the operator-visible field.
      expect(out.errorMessage).not.toMatch(/169\.254|private range/);
    });
  });
});

describe('WebhookRetryWorker — claim + redeliver (P1-5)', () => {
  beforeEach(() => postMock.mockReset());

  function makeWorker(opts: {
    claimed: Array<any>;
    webhooks: Array<any>;
  }) {
    const deliveryUpdates: Array<{ where: any; data: any }> = [];
    const prisma: any = {
      client: {
        // The atomic claim query.
        $queryRawUnsafe: jest.fn(async () => opts.claimed),
        tenantWebhook: {
          findMany: jest.fn(async () => opts.webhooks),
        },
        webhookDelivery: {
          update: jest.fn(async (args: any) => {
            deliveryUpdates.push(args);
            return { id: args.where.id, ...args.data };
          }),
        },
      },
    };
    const dispatch = new WebhookDispatchService(prisma as PrismaService);
    const worker = new WebhookRetryWorker(prisma as PrismaService, dispatch);
    return { worker, prisma, deliveryUpdates };
  }

  it('re-POSTs a claimed due row and marks it DELIVERED on a 2xx', async () => {
    postMock.mockResolvedValue({ status: 200 });
    const { worker, prisma, deliveryUpdates } = makeWorker({
      claimed: [
        {
          id: 'dlv1',
          webhook_id: 'wh1',
          event: 'emergency.triggered',
          body: '{"event":"emergency.triggered"}',
          signed_timestamp: BigInt(1717000000000),
          attempts: 1, // post-claim increment
        },
      ],
      webhooks: [{ id: 'wh1', url: 'https://example.test/hook', signingSecret: 's', isActive: true }],
    });

    const res = await worker.tick();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    // The delivery row was flipped to DELIVERED.
    const final = deliveryUpdates.find((u) => u.where.id === 'dlv1');
    expect(final?.data.status).toBe('DELIVERED');
    expect(prisma.client.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('reschedules a still-failing row that has retries left (stays PENDING)', async () => {
    postMock.mockResolvedValue({ status: 502 });
    const { worker, deliveryUpdates } = makeWorker({
      claimed: [
        {
          id: 'dlv1',
          webhook_id: 'wh1',
          event: 'emergency.triggered',
          body: '{}',
          signed_timestamp: BigInt(1),
          attempts: 2, // 2 of MAX done → still has the 120s retry left
        },
      ],
      webhooks: [{ id: 'wh1', url: 'https://example.test/hook', signingSecret: 's', isActive: true }],
    });

    const res = await worker.tick();
    expect(res.delivered).toBe(0);
    expect(res.failed).toBe(0); // not permanent yet
    const final = deliveryUpdates.find((u) => u.where.id === 'dlv1');
    expect(final?.data.status).toBe('PENDING');
    expect(final?.data.nextRetryAt).toBeInstanceOf(Date);
  });

  it('marks a row FAILED once attempts are exhausted', async () => {
    postMock.mockResolvedValue({ status: 500 });
    const { worker, deliveryUpdates } = makeWorker({
      claimed: [
        {
          id: 'dlv1',
          webhook_id: 'wh1',
          event: 'emergency.triggered',
          body: '{}',
          signed_timestamp: BigInt(1),
          attempts: WEBHOOK_MAX_ATTEMPTS, // final attempt just happened
        },
      ],
      webhooks: [{ id: 'wh1', url: 'https://example.test/hook', signingSecret: 's', isActive: true }],
    });

    const res = await worker.tick();
    expect(res.failed).toBe(1);
    const final = deliveryUpdates.find((u) => u.where.id === 'dlv1');
    expect(final?.data.status).toBe('FAILED');
    expect(final?.data.nextRetryAt).toBeNull();
  });

  it('gives up (FAILED) when the parent webhook was deactivated between attempts', async () => {
    const { worker, deliveryUpdates } = makeWorker({
      claimed: [
        {
          id: 'dlv1',
          webhook_id: 'wh1',
          event: 'emergency.triggered',
          body: '{}',
          signed_timestamp: BigInt(1),
          attempts: 1,
        },
      ],
      webhooks: [{ id: 'wh1', url: 'https://example.test/hook', signingSecret: 's', isActive: false }],
    });

    const res = await worker.tick();
    expect(postMock).not.toHaveBeenCalled(); // no POST to a dead webhook
    expect(res.failed).toBe(1);
    const final = deliveryUpdates.find((u) => u.where.id === 'dlv1');
    expect(final?.data.status).toBe('FAILED');
    expect(final?.data.lastError).toMatch(/removed or deactivated/);
  });

  it('no-ops when nothing is due', async () => {
    const { worker, prisma } = makeWorker({ claimed: [], webhooks: [] });
    const res = await worker.tick();
    expect(res).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(prisma.client.tenantWebhook.findMany).not.toHaveBeenCalled();
  });
});
