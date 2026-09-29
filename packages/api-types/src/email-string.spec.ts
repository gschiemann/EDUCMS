import { EmailString, LoginInputSchema } from './index';

/**
 * Login looked the typed email up exactly as typed, and accounts are stored
 * lowercase — so "Grant.Hale@e-arc.com" was an unknown account at login while
 * password reset for the same address worked (2026-09-29, a customer who reset
 * his password twice and never got in). The shape every credential endpoint
 * shares now normalizes, then validates.
 */
describe('EmailString normalizes before it validates', () => {
  it.each([
    ['Grant.Hale@e-arc.com', 'grant.hale@e-arc.com'],
    ['GRANT.HALE@E-ARC.COM', 'grant.hale@e-arc.com'],
    ['  grant.hale@e-arc.com  ', 'grant.hale@e-arc.com'],
    ['\tGrant.Hale@e-arc.com\n', 'grant.hale@e-arc.com'],
    ['grant.hale@e-arc.com', 'grant.hale@e-arc.com'],
  ])('%j -> %j', (input, expected) => {
    expect(EmailString.parse(input)).toBe(expected);
  });

  it('still rejects what is not an email, and still bounds the length', () => {
    expect(EmailString.safeParse('not an email').success).toBe(false);
    expect(EmailString.safeParse('a@b').success).toBe(false);
    expect(EmailString.safeParse(`${'a'.repeat(250)}@e-arc.com`).success).toBe(false);
    expect(EmailString.safeParse('').success).toBe(false);
  });
});

describe('LoginInputSchema', () => {
  it('hands the login the normalized address and leaves the password exactly as typed', () => {
    const out = LoginInputSchema.parse({ email: ' Grant.Hale@e-arc.com ', password: '  Mixed Case pass  ' });
    expect(out.email).toBe('grant.hale@e-arc.com');
    expect(out.password).toBe('  Mixed Case pass  ');
  });
});
