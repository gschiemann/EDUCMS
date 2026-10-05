import {
  setupEmailChallengeHash,
  setupEmailVerificationMode,
  setupEmailVerificationRequired,
} from './setup-email-verification';

describe('setupEmailVerificationMode', () => {
  it.each([
    [undefined, 'auto'],
    ['', 'auto'],
    ['auto', 'auto'],
    ['nonsense', 'auto'],
    ['required', 'required'],
    ['ON', 'required'],
    ['1', 'required'],
    ['off', 'off'],
    ['False', 'off'],
    ['0', 'off'],
  ])('%p reads as %p', (raw, mode) => {
    expect(setupEmailVerificationMode(raw as string | undefined)).toBe(mode);
  });
});

describe('setupEmailVerificationRequired', () => {
  it('auto follows whether mail can reach an arbitrary inbox', () => {
    expect(setupEmailVerificationRequired({ deliverable: true, mode: 'auto' })).toBe(true);
    // On the shared sender only the Resend account owner receives mail —
    // requiring a code there would make setup impossible for everyone else.
    expect(setupEmailVerificationRequired({ deliverable: false, mode: 'auto' })).toBe(false);
  });
  it('required and off ignore deliverability', () => {
    expect(setupEmailVerificationRequired({ deliverable: false, mode: 'required' })).toBe(true);
    expect(setupEmailVerificationRequired({ deliverable: true, mode: 'off' })).toBe(false);
  });
});

describe('setupEmailChallengeHash', () => {
  it('is stable, and tied to BOTH the account and the address', () => {
    const a = setupEmailChallengeHash('u1', 'dana@riotcolor.com');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(setupEmailChallengeHash('u1', '  Dana@RiotColor.com ')).toBe(a);
    expect(setupEmailChallengeHash('u2', 'dana@riotcolor.com')).not.toBe(a);
    expect(setupEmailChallengeHash('u1', 'other@riotcolor.com')).not.toBe(a);
  });
});
