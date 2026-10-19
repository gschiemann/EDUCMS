import { isValidEmail } from './is-valid-email';

describe('onboarding email validation', () => {
  it.each(['owner@example.test', 'first.last+setup@location.example.test'])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(['', 'missing-at.example.test', '@example.test', 'a@@example.test', 'a@.test', 'a@test.', 'a@test', 'a b@example.test', 'a@example.test\n'])('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('rejects oversized adversarial input before parsing it', () => {
    expect(isValidEmail('!@!.' + '!.'.repeat(50_000))).toBe(false);
  });
});
