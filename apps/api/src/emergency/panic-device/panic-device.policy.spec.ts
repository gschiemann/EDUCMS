/**
 * Panic phones (2026-11-14) — the pure rules. Who may hold one, when it is
 * refused, what the credential looks like, and the kill switch.
 */
import {
  ENROLL_FRESH_LOGIN_SEC,
  MAX_ACTIVE_DEVICES_PER_USER,
  deviceLabelFromUserAgent,
  eligibilityRefusal,
  enrollmentRefusal,
  hasPanicAuthority,
  hashPanicCredential,
  isPanicCredentialShape,
  mintPanicCredential,
  panicDeviceAuditFields,
  panicDevicesDisabled,
} from './panic-device.policy';

const teacher = { id: 'u1', tenantId: 't1', role: 'CONTRIBUTOR', status: 'ACTIVE', deletedAt: null, canTriggerPanic: true };
const org = { id: 't1', archivedAt: null };
const device = { tenantId: 't1' };

describe('hasPanicAuthority — exactly the trigger route’s own rule', () => {
  it.each([
    [{ role: 'SUPER_ADMIN' }, true],
    [{ role: 'DISTRICT_ADMIN' }, true],
    [{ role: 'SCHOOL_ADMIN' }, true],
    [{ role: 'CONTRIBUTOR', canTriggerPanic: true }, true],
    [{ role: 'CONTRIBUTOR', canTriggerPanic: false }, false],
    [{ role: 'CONTRIBUTOR' }, false],
    // RESTRICTED_VIEWER is never admitted, flag or not (rbac.guard.ts).
    [{ role: 'RESTRICTED_VIEWER', canTriggerPanic: true }, false],
    [null, false],
  ])('%j → %s', (user, expected) => {
    expect(hasPanicAuthority(user as any)).toBe(expected);
  });
});

describe('eligibilityRefusal — every use, against the LIVE row', () => {
  it('an active teacher with the flag, in the phone’s organisation: accepted', () => {
    expect(eligibilityRefusal(device, teacher, org)).toBeNull();
  });
  it.each([
    ['deactivated', { ...teacher, status: 'DISABLED' }, org, 'account-inactive'],
    ['removed', { ...teacher, deletedAt: new Date() }, org, 'account-inactive'],
    ['gone', null, org, 'account-inactive'],
    ['lost the permission', { ...teacher, canTriggerPanic: false }, org, 'no-authority'],
    ['demoted to viewer', { ...teacher, role: 'RESTRICTED_VIEWER' }, org, 'no-authority'],
    ['moved organisation', { ...teacher, tenantId: 't2' }, org, 'tenant-changed'],
    ['organisation archived', teacher, { ...org, archivedAt: new Date() }, 'tenant-archived'],
    ['promoted to platform staff', { ...teacher, role: 'SUPER_ADMIN' }, org, 'platform-staff'],
  ])('%s → refused (%s)', (_label, user, tenant, reason) => {
    expect(eligibilityRefusal(device, user as any, tenant as any)).toBe(reason);
  });
});

describe('enrollmentRefusal — minting a credential that never expires', () => {
  const now = 1_800_000_000;
  const base = {
    user: teacher,
    tenant: org,
    sessionTenantId: 't1',
    credentialCheckedAtSec: now - 60,
    nowSec: now,
    mfaBlocking: false,
    activeDeviceCount: 0,
  };
  it('a fresh, full sign-in of a person with authority: allowed', () => {
    expect(enrollmentRefusal(base)).toBeNull();
  });
  it('a sign-in older than 15 minutes (e.g. restored from a 30-day cookie) must be renewed', () => {
    expect(enrollmentRefusal({ ...base, credentialCheckedAtSec: now - ENROLL_FRESH_LOGIN_SEC - 1 })).toBe('stale-login');
    expect(enrollmentRefusal({ ...base, credentialCheckedAtSec: null })).toBe('stale-login');
  });
  it('a switched-workspace session cannot enrol (its tenant is not the person’s own)', () => {
    expect(enrollmentRefusal({ ...base, sessionTenantId: 't-child' })).toBe('switched-workspace');
  });
  it('the second-factor policy must be met', () => {
    expect(enrollmentRefusal({ ...base, mfaBlocking: true })).toBe('mfa-required');
  });
  it('platform staff never hold a panic phone', () => {
    expect(enrollmentRefusal({ ...base, user: { ...teacher, role: 'SUPER_ADMIN' } })).toBe('platform-staff');
  });
  it('no authority, no phone', () => {
    expect(enrollmentRefusal({ ...base, user: { ...teacher, canTriggerPanic: false } })).toBe('no-authority');
  });
  it(`at most ${MAX_ACTIVE_DEVICES_PER_USER} phones ready at once`, () => {
    expect(enrollmentRefusal({ ...base, activeDeviceCount: MAX_ACTIVE_DEVICES_PER_USER })).toBe('too-many-devices');
  });
  it('a disabled account cannot enrol', () => {
    expect(enrollmentRefusal({ ...base, user: { ...teacher, status: 'DISABLED' } })).toBe('account-inactive');
  });
});

describe('the credential', () => {
  it('is 256 random bits behind a versioned prefix, and only its sha256 is ever stored', () => {
    const a = mintPanicCredential();
    const b = mintPanicCredential();
    expect(a).not.toBe(b);
    expect(isPanicCredentialShape(a)).toBe(true);
    expect(hashPanicCredential(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPanicCredential(a)).not.toContain(a.slice(4));
  });
  it('a JWT, a refresh token or junk is not a panic credential', () => {
    expect(isPanicCredentialShape('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.sig')).toBe(false);
    expect(isPanicCredentialShape('fam.secret')).toBe(false);
    expect(isPanicCredentialShape('pd1.short')).toBe(false);
    expect(isPanicCredentialShape(undefined)).toBe(false);
  });
});

describe('PANIC_DEVICE_DISABLED — subtractive', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['0', false],
    ['off', false],
    ['1', true],
    ['true', true],
    ['YES', true],
  ])('%s → %s', (value, expected) => {
    expect(panicDevicesDisabled({ PANIC_DEVICE_DISABLED: value } as any)).toBe(expected);
  });
});

describe('the trigger’s own audit row', () => {
  it('names the phone and the address — only when a panic phone sent it', () => {
    expect(panicDeviceAuditFields({ kind: 'panic-device', panicDeviceId: 'pd-1', panicDeviceIp: '203.0.113.9' })).toEqual({
      via: 'panic-device',
      panicDeviceId: 'pd-1',
      panicDeviceIp: '203.0.113.9',
    });
    expect(panicDeviceAuditFields({ id: 'u1', role: 'SCHOOL_ADMIN' })).toEqual({});
    expect(panicDeviceAuditFields(undefined)).toEqual({});
  });
});

describe('what the person sees in the list', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'iPhone · Safari'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Android phone · Chrome'],
    [null, 'Device'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabelFromUserAgent(ua)).toBe(label);
  });
});
