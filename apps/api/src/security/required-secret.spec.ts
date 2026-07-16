import { assertRequiredSecretsAtBoot, BOOT_REQUIRED_SECRETS } from './required-secret';

/**
 * S14 (launch-readiness): all load-bearing secrets are validated at BOOT, not
 * lazily on first use. A prod deploy missing DEVICE_JWT_SECRET / DEVICE_SECRET_KEY
 * must fail at startup, not pass the healthcheck then 500 every device call.
 */
describe('assertRequiredSecretsAtBoot (S14)', () => {
  const saved: Record<string, string | undefined> = {};
  const ALL = [...BOOT_REQUIRED_SECRETS, 'NODE_ENV'];

  beforeEach(() => {
    for (const k of ALL) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ALL) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setAll(val: string) {
    for (const k of BOOT_REQUIRED_SECRETS) process.env[k] = val;
  }

  it('throws in production when DEVICE_JWT_SECRET is missing (the S14 gap)', () => {
    process.env.NODE_ENV = 'production';
    setAll('x'.repeat(40));
    delete process.env.DEVICE_JWT_SECRET;
    expect(() => assertRequiredSecretsAtBoot()).toThrow(/DEVICE_JWT_SECRET/);
  });

  it('throws in production when DEVICE_SECRET_KEY is missing', () => {
    process.env.NODE_ENV = 'production';
    setAll('x'.repeat(40));
    delete process.env.DEVICE_SECRET_KEY;
    expect(() => assertRequiredSecretsAtBoot()).toThrow(/DEVICE_SECRET_KEY/);
  });

  it('passes in production when every load-bearing secret is set', () => {
    process.env.NODE_ENV = 'production';
    setAll('x'.repeat(40));
    expect(() => assertRequiredSecretsAtBoot()).not.toThrow();
  });

  it('does NOT throw in dev even when secrets are missing (warns + dev fallback)', () => {
    process.env.NODE_ENV = 'development';
    for (const k of BOOT_REQUIRED_SECRETS) delete process.env[k];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertRequiredSecretsAtBoot()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('covers exactly the four documented secrets', () => {
    expect([...BOOT_REQUIRED_SECRETS].sort()).toEqual(
      ['DEVICE_JWT_SECRET', 'DEVICE_SECRET_KEY', 'JWT_SECRET', 'SESSION_SECRET'],
    );
  });
});
