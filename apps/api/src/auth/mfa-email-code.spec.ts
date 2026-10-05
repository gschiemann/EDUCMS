import {
  MFA_EMAIL_CODE_RESET_COOLDOWN_MS,
  deviceNameFromUserAgent,
  emailCodeDeliveryConfigured,
  emailCodeEligibility,
  emailCodeHashesMatch,
  generateEmailCode,
  generateEmailCodeChallenge,
  hashClientIp,
  hashEmailCode,
  hashEmailCodeChallenge,
  isEmailCodeChallengeShape,
  lastPasswordResetAt,
  normalizeEmailCode,
} from './mfa-email-code';

describe('mfa-email-code — the pure half', () => {
  it('a code is always six digits, leading zeros kept, and they vary', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateEmailCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(450);
  });

  it('a challenge handle is 43 base64url characters, and only that shape is accepted', () => {
    const h = generateEmailCodeChallenge();
    expect(isEmailCodeChallengeShape(h)).toBe(true);
    expect(isEmailCodeChallengeShape(h + 'x')).toBe(false);
    expect(isEmailCodeChallengeShape('A'.repeat(42))).toBe(false);
    expect(isEmailCodeChallengeShape(42)).toBe(false);
    expect(hashEmailCodeChallenge(h)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the stored MAC depends on the server secret AND the row — a bare digest of six digits is never stored', () => {
    const row = hashEmailCodeChallenge(generateEmailCodeChallenge());
    const a = hashEmailCode('secret-one', row, '123456');
    expect(
      emailCodeHashesMatch(a, hashEmailCode('secret-one', row, '123456')),
    ).toBe(true);
    expect(
      emailCodeHashesMatch(a, hashEmailCode('secret-two', row, '123456')),
    ).toBe(false);
    expect(
      emailCodeHashesMatch(a, hashEmailCode('secret-one', row, '123457')),
    ).toBe(false);
    const otherRow = hashEmailCodeChallenge(generateEmailCodeChallenge());
    expect(
      emailCodeHashesMatch(a, hashEmailCode('secret-one', otherRow, '123456')),
    ).toBe(false);
    expect(emailCodeHashesMatch(a, '')).toBe(false);
    expect(emailCodeHashesMatch(a, 'zz')).toBe(false);
  });

  it.each([
    ['123456', '123456'],
    [' 123 456 ', '123456'],
    ['123-456', '123456'],
    ['012345', '012345'],
    ['12345', null],
    ['1234567', null],
    ['12a456', null],
    ['', null],
  ])('normalizeEmailCode(%j) → %j', (input, out) => {
    expect(normalizeEmailCode(input)).toBe(out);
  });

  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'an iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'an iPad'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'an Android phone'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'a Mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'a Windows PC'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 'a Chromebook'],
    ['', 'a web browser'],
  ])('deviceNameFromUserAgent(%j) → %j', (ua, name) => {
    expect(deviceNameFromUserAgent(ua)).toBe(name);
  });

  it('delivery: production needs RESEND_API_KEY; everywhere else the dev stub counts', () => {
    expect(emailCodeDeliveryConfigured({ NODE_ENV: 'production' })).toBe(false);
    expect(
      emailCodeDeliveryConfigured({
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_x',
      }),
    ).toBe(true);
    expect(emailCodeDeliveryConfigured({ NODE_ENV: 'development' })).toBe(true);
    expect(emailCodeDeliveryConfigured({ NODE_ENV: 'test' })).toBe(true);
  });

  it('eligibility: mail, a factor, and no fresh password reset — in that order', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    const base = {
      deliveryConfigured: true,
      holdsFactor: true,
      lastPasswordResetAt: null,
      now,
    };
    expect(emailCodeEligibility(base)).toBe('ok');
    expect(emailCodeEligibility({ ...base, deliveryConfigured: false })).toBe(
      'email-not-configured',
    );
    expect(emailCodeEligibility({ ...base, holdsFactor: false })).toBe(
      'no-factor',
    );
    expect(
      emailCodeEligibility({
        ...base,
        lastPasswordResetAt: new Date(now - 60_000),
      }),
    ).toBe('recent-password-reset');
    expect(
      emailCodeEligibility({
        ...base,
        lastPasswordResetAt: new Date(
          now - MFA_EMAIL_CODE_RESET_COOLDOWN_MS - 1,
        ),
      }),
    ).toBe('ok');
  });

  it('lastPasswordResetAt reads only COMPLETED resets, newest first', async () => {
    const findFirst = jest.fn(async () => ({ usedAt: new Date('2026-10-01') }));
    await expect(
      lastPasswordResetAt({ passwordResetToken: { findFirst } } as any, 'u1'),
    ).resolves.toEqual(new Date('2026-10-01'));
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', usedAt: { not: null } },
      orderBy: { usedAt: 'desc' },
      select: { usedAt: true },
    });
    await expect(
      lastPasswordResetAt({ passwordResetToken: { findFirst } } as any, ''),
    ).resolves.toBeNull();
  });

  it('the per-IP key is a digest, never the address', () => {
    const h = hashClientIp('203.0.113.7');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('203.0.113.7');
    expect(hashClientIp(null)).toBeNull();
  });
});
