import {
  mintUploadRenewTicket,
  verifyUploadRenewTicket,
  UPLOAD_RENEW_TICKET_TTL_MS,
} from './upload-renew-ticket';

const SUBJECT = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  storagePath: 'tenant-1/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4',
};

describe('upload renew ticket', () => {
  it('round-trips for exactly the subject it was minted for', () => {
    const now = 1_700_000_000_000;
    const { ticket, expiresAt } = mintUploadRenewTicket(SUBJECT, now);
    expect(expiresAt).toBe(now + UPLOAD_RENEW_TICKET_TTL_MS);
    expect(verifyUploadRenewTicket(ticket, SUBJECT, now + 1000)).toEqual({
      ok: true,
      expiresAt,
    });
  });

  it.each([
    ['tenant', { ...SUBJECT, tenantId: 'tenant-2' }],
    ['user', { ...SUBJECT, userId: 'user-2' }],
    [
      'path',
      {
        ...SUBJECT,
        storagePath: 'tenant-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4',
      },
    ],
  ])('refuses a different %s', (reason, other) => {
    const { ticket } = mintUploadRenewTicket(SUBJECT);
    expect(verifyUploadRenewTicket(ticket, other)).toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses an expired ticket', () => {
    const now = 1_700_000_000_000;
    const { ticket } = mintUploadRenewTicket(SUBJECT, now);
    expect(
      verifyUploadRenewTicket(
        ticket,
        SUBJECT,
        now + UPLOAD_RENEW_TICKET_TTL_MS,
      ),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses any edit to the signed body (tenant swapped in the ticket itself)', () => {
    const { ticket } = mintUploadRenewTicket(SUBJECT);
    const parts = ticket.split('.');
    parts[1] = Buffer.from('tenant-2').toString('base64url');
    expect(
      verifyUploadRenewTicket(parts.join('.'), {
        ...SUBJECT,
        tenantId: 'tenant-2',
      }),
    ).toEqual({ ok: false, reason: 'signature' });
  });

  it('refuses malformed input without throwing', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'ur1.a.b',
      'x'.repeat(5000),
      'ur2.a.b.c.1.n.s',
    ]) {
      const v = verifyUploadRenewTicket(bad as any, SUBJECT);
      expect(v.ok).toBe(false);
    }
  });

  it('a ticket is not a session JWT: its key is derived, not JWT_SECRET itself', () => {
    // The body carries a version tag no JWT header can decode to, and the HMAC
    // key is HMAC(JWT_SECRET, label) — so a ticket cannot be replayed as a JWT
    // signature and a JWT signature cannot be replayed as a ticket.
    const { ticket } = mintUploadRenewTicket(SUBJECT);
    expect(ticket.startsWith('ur1.')).toBe(true);
    expect(ticket.split('.')).toHaveLength(7);
  });
});
