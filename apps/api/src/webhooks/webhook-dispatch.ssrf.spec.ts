/**
 * Webhook delivery SSRF + body-exfil proof (Audit task #58 / 35-SSRF).
 * ──────────────────────────────────────────────────────────────────────
 *
 * Before this fix, WebhookDispatchService.attemptDelivery did a raw
 * `fetch(row.url)` with NO SSRF guard and reflected the receiver's response
 * body into operator-visible fields (lastError / lastDeliveryError). A
 * DISTRICT_ADMIN could point a webhook at http://169.254.169.254/… and read
 * cloud-internal metadata back through GET /webhooks.
 *
 * These tests use the REAL safeFetchPost (NOT a mock) to prove:
 *   1. attemptDelivery REJECTS an internal-IP destination — the outcome is
 *      not-ok and carries a GENERIC refusal message, never the resolved IP.
 *   2. The outcome never contains any upstream response body / IP — anti-exfil.
 *   3. A bad-scheme / bad-port destination is likewise refused.
 *
 * We do NOT hit the network: every URL here is a private/loopback/metadata
 * literal that safeFetchPost rejects BEFORE opening a socket, so the test is
 * hermetic and fast.
 */
import { Logger } from '@nestjs/common';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
});
afterAll(() => jest.restoreAllMocks());

function makeSvc() {
  // attemptDelivery does no DB writes, so an empty client is fine.
  return new WebhookDispatchService({ client: {} } as PrismaService);
}

const INTERNAL_TARGETS: Array<[string, string]> = [
  ['AWS/GCP IMDS', 'http://169.254.169.254/latest/meta-data/'],
  ['IPv4 loopback', 'http://127.0.0.1:8080/internal'],
  ['private 10/8', 'http://10.0.0.5/secret'],
  ['private 192.168/16', 'http://192.168.1.1/admin'],
  ['private 172.16/12', 'http://172.16.0.1/'],
  ['IPv6 loopback', 'http://[::1]:9000/'],
  ['CGNAT 100.64/10', 'http://100.64.0.1/'],
];

describe('WebhookDispatchService.attemptDelivery — SSRF defense (real safeFetchPost)', () => {
  it.each(INTERNAL_TARGETS)(
    'refuses an internal destination (%s) without leaking the IP',
    async (_label, url) => {
      const svc = makeSvc();
      const out = await svc.attemptDelivery(
        { id: 'wh1', url, signingSecret: 'whsec_test' },
        '{"event":"emergency.triggered"}',
        'emergency.triggered',
        1717000000000,
      );
      // Delivery failed (refused at the SSRF gate, never reached the host).
      expect(out.ok).toBe(false);
      expect(out.status).toBeNull();
      // Generic refusal — NOT the resolved private IP, NOT a stack trace.
      expect(out.errorMessage).toBe('destination refused (not publicly reachable)');
      // Anti-exfil: nothing IP-shaped or internal-pathy leaks into the
      // operator-visible field.
      expect(out.errorMessage).not.toMatch(/169\.254|127\.0|10\.0|192\.168|172\.16|::1|100\.64|meta-data|private range/);
    },
  );

  it('refuses a non-http(s) scheme (file://) the same generic way', async () => {
    const svc = makeSvc();
    const out = await svc.attemptDelivery(
      { id: 'wh1', url: 'file:///etc/passwd', signingSecret: 's' },
      '{}',
      'emergency.triggered',
      1,
    );
    expect(out.ok).toBe(false);
    expect(out.errorMessage).toBe('destination refused (not publicly reachable)');
  });

  it('refuses a disallowed port (non 80/443)', async () => {
    const svc = makeSvc();
    const out = await svc.attemptDelivery(
      { id: 'wh1', url: 'http://example.com:22/', signingSecret: 's' },
      '{}',
      'emergency.triggered',
      1,
    );
    expect(out.ok).toBe(false);
    expect(out.errorMessage).toBe('destination refused (not publicly reachable)');
  });
});
