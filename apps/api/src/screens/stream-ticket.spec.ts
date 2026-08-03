/**
 * Regression tests for the SSE stream ticket (DT-08).
 *
 * The finding: a 180-day fleet credential travelled in `?token=` on the SSE
 * URL, landing in Railway/Vercel HTTP access logs, on-path proxy logs and
 * Android WebView history. `EventSource` cannot set headers, so the fix is a
 * short-lived, single-scope bearer ticket minted at an authenticated POST.
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { mintStreamTicket, verifyStreamTicket, STREAM_TICKET_TTL_MS } from './stream-ticket';

describe('stream tickets', () => {
  it('round-trips screenId and credential epoch', () => {
    const { ticket } = mintStreamTicket('screen-1', 7);
    const res = verifyStreamTicket(ticket);
    expect(res).toMatchObject({ ok: true, screenId: 'screen-1', credentialEpoch: 7 });
  });

  it('expires in 60 seconds — stale before anyone reads the log line', () => {
    const now = Date.now();
    const { ticket, expiresAt } = mintStreamTicket('screen-1', 0, now);
    expect(expiresAt - now).toBe(STREAM_TICKET_TTL_MS);
    expect(verifyStreamTicket(ticket, now + STREAM_TICKET_TTL_MS - 1).ok).toBe(true);
    expect(verifyStreamTicket(ticket, now + STREAM_TICKET_TTL_MS)).toMatchObject({
      ok: false,
      reason: 'ticket_expired',
    });
  });

  it('refuses a ticket whose screenId was tampered with', () => {
    const { ticket } = mintStreamTicket('screen-1', 0);
    const forged = ticket.replace('screen-1', 'screen-2');
    expect(verifyStreamTicket(forged)).toMatchObject({ ok: false, reason: 'ticket_signature' });
  });

  it('refuses a ticket whose epoch was tampered with', () => {
    // The epoch is what ties a ticket to the screen's live credential, so a
    // revoke also kills tickets already in flight. It must be signed.
    const { ticket } = mintStreamTicket('screen-1', 3);
    const parts = ticket.split('.');
    parts[2] = '99';
    expect(verifyStreamTicket(parts.join('.'))).toMatchObject({ ok: false, reason: 'ticket_signature' });
  });

  it('refuses a ticket whose expiry was extended', () => {
    const { ticket } = mintStreamTicket('screen-1', 0);
    const parts = ticket.split('.');
    parts[3] = String(Number(parts[3]) + 86_400_000);
    expect(verifyStreamTicket(parts.join('.'))).toMatchObject({ ok: false, reason: 'ticket_signature' });
  });

  it('is unique per mint (nonce), so a log-harvested ticket is not a template', () => {
    const a = mintStreamTicket('screen-1', 0).ticket;
    const b = mintStreamTicket('screen-1', 0).ticket;
    expect(a).not.toBe(b);
  });

  it('rejects junk without throwing', () => {
    for (const junk of [undefined, null, '', 'x', 'a.b.c', 'a.b.c.d.e.f.g', 'x'.repeat(600)]) {
      expect(verifyStreamTicket(junk as any).ok).toBe(false);
    }
  });
});
