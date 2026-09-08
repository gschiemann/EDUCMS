import {
  assertRequiredSecretsAtBoot,
  BOOT_REQUIRED_SECRETS,
  RETIRED_ENV_VARS,
  warnRetiredEnvVars,
  warnIneffectiveDbTlsSettings,
} from './required-secret';

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

/**
 * Retired OTA env vars (removed 2026-05-15). A leftover value is inert, but
 * indistinguishable from a live setting to whoever reads the Railway variable
 * list next — so it is announced at boot. It must never be able to BREAK one.
 */
describe('warnRetiredEnvVars', () => {
  const warn = jest.fn();
  beforeEach(() => warn.mockReset());

  it('is silent when no retired var is set', () => {
    expect(warnRetiredEnvVars({}, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('names every retired var that is still set', () => {
    const env = Object.fromEntries(RETIRED_ENV_VARS.map((v) => [v.name, 'stale']));
    expect(warnRetiredEnvVars(env, warn).sort()).toEqual(RETIRED_ENV_VARS.map((v) => v.name).sort());
    expect(warn).toHaveBeenCalledTimes(RETIRED_ENV_VARS.length);
  });

  it('ignores empty / whitespace-only values (an unset var in Railway reads as "")', () => {
    expect(warnRetiredEnvVars({ PLAYER_APK_SHA256: '   ' }, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still covers the three vars CLAUDE.md names', () => {
    expect(RETIRED_ENV_VARS.map((v) => v.name).sort()).toEqual([
      'PLAYER_APK_LATEST_VERSION_CODE',
      'PLAYER_APK_LATEST_VERSION_NAME',
      'PLAYER_APK_SHA256',
    ]);
  });

  it('never throws — a retired variable must not be able to break a boot', () => {
    expect(() => warnRetiredEnvVars({ PLAYER_APK_SHA256: 'x' }, warn)).not.toThrow();
  });
});

/**
 * Database TLS. Prisma 5.x IGNORES libpq's `sslmode=verify-full` /
 * `sslrootcert` — proven on production's own base image against a deliberately
 * wrong root CA, which connected anyway (packages/database/certs/README.md).
 * A URL asking for verification that spelling gets none, so we say so at boot.
 */
describe('warnIneffectiveDbTlsSettings', () => {
  const warn = jest.fn();
  beforeEach(() => warn.mockReset());
  const CA = '/etc/ssl/venueos/supabase-prod-ca-2021.crt';
  const base = 'postgresql://u:p@db.example.com:5432/postgres';

  it('is silent for plain sslmode=require (encrypted, honestly unverified)', () => {
    expect(warnIneffectiveDbTlsSettings({ DATABASE_URL: `${base}?sslmode=require` }, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('flags sslmode=verify-full — the spelling Prisma discards', () => {
    const env = { DATABASE_URL: `${base}?sslmode=verify-full&sslrootcert=${CA}` };
    expect(warnIneffectiveDbTlsSettings(env, warn)).toEqual(['DATABASE_URL']);
    expect(warn.mock.calls[0][0]).toMatch(/NOT AUTHENTICATED/);
  });

  it('flags sslmode=verify-ca too', () => {
    expect(
      warnIneffectiveDbTlsSettings({ DATABASE_URL: `${base}?sslmode=verify-ca` }, warn),
    ).toEqual(['DATABASE_URL']);
  });

  it('flags a bare sslrootcert even without an sslmode', () => {
    expect(
      warnIneffectiveDbTlsSettings({ DATABASE_URL: `${base}?sslrootcert=${CA}` }, warn),
    ).toEqual(['DATABASE_URL']);
  });

  it('is SILENT for the spelling that actually verifies', () => {
    const env = { DATABASE_URL: `${base}?sslmode=require&sslaccept=strict&sslcert=${CA}` };
    expect(warnIneffectiveDbTlsSettings(env, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not nag when sslaccept=strict is present alongside the libpq spelling', () => {
    const env = { DATABASE_URL: `${base}?sslmode=verify-full&sslaccept=strict&sslcert=${CA}` };
    expect(warnIneffectiveDbTlsSettings(env, warn)).toEqual([]);
  });

  it('checks DIRECT_URL as well — it is what `migrate deploy` uses at boot', () => {
    const env = {
      DATABASE_URL: `${base}?sslmode=require&sslaccept=strict&sslcert=${CA}`,
      DIRECT_URL: `${base}?sslmode=verify-full`,
    };
    expect(warnIneffectiveDbTlsSettings(env, warn)).toEqual(['DIRECT_URL']);
  });

  it('never echoes the credentials it parsed past', () => {
    const env = { DATABASE_URL: 'postgresql://admin:sup3r-s3cret@db:5432/postgres?sslmode=verify-full' };
    warnIneffectiveDbTlsSettings(env, warn);
    expect(warn).toHaveBeenCalled();
    for (const [msg] of warn.mock.calls) {
      expect(msg).not.toContain('sup3r-s3cret');
      expect(msg).not.toContain('admin');
    }
  });

  it('tolerates an unset, empty, or query-less URL without throwing', () => {
    expect(() => warnIneffectiveDbTlsSettings({}, warn)).not.toThrow();
    expect(warnIneffectiveDbTlsSettings({ DATABASE_URL: '' }, warn)).toEqual([]);
    expect(warnIneffectiveDbTlsSettings({ DATABASE_URL: base }, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
