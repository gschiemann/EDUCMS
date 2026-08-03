import { ForbiddenException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import {
  assertCallerCanAssignRole,
  assertTenantScopedRoleAssignable,
  TENANT_ASSIGNABLE_ROLES,
} from './role-assignment';

/**
 * Locks in the privilege-escalation guard. A caller must only ever be
 * able to assign roles strictly below their own rank — this is what
 * stops a SCHOOL_ADMIN from minting a DISTRICT_ADMIN through the
 * onboarding invite / direct-create endpoints (auth-002 / BUG-005).
 */
describe('assertCallerCanAssignRole', () => {
  const allows = (caller: string, target: string) =>
    expect(() => assertCallerCanAssignRole(caller, target)).not.toThrow();
  const denies = (caller: string, target: string) =>
    expect(() => assertCallerCanAssignRole(caller, target)).toThrow(ForbiddenException);

  it('SUPER_ADMIN may assign every non-super role', () => {
    allows(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN);
    allows(AppRole.SUPER_ADMIN, AppRole.SCHOOL_ADMIN);
    allows(AppRole.SUPER_ADMIN, AppRole.CONTRIBUTOR);
    allows(AppRole.SUPER_ADMIN, AppRole.RESTRICTED_VIEWER);
  });

  it('SUPER_ADMIN may not mint another SUPER_ADMIN', () => {
    denies(AppRole.SUPER_ADMIN, AppRole.SUPER_ADMIN);
  });

  it('DISTRICT_ADMIN may assign school-admin and below', () => {
    allows(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN);
    allows(AppRole.DISTRICT_ADMIN, AppRole.CONTRIBUTOR);
    allows(AppRole.DISTRICT_ADMIN, AppRole.RESTRICTED_VIEWER);
  });

  it('DISTRICT_ADMIN may not assign at or above its own rank', () => {
    denies(AppRole.DISTRICT_ADMIN, AppRole.DISTRICT_ADMIN);
    denies(AppRole.DISTRICT_ADMIN, AppRole.SUPER_ADMIN);
  });

  it('SCHOOL_ADMIN may assign only contributor / viewer', () => {
    allows(AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR);
    allows(AppRole.SCHOOL_ADMIN, AppRole.RESTRICTED_VIEWER);
  });

  it('SCHOOL_ADMIN may NOT escalate to school- or district-admin', () => {
    // The exact escalation the audit found in the onboarding path.
    denies(AppRole.SCHOOL_ADMIN, AppRole.SCHOOL_ADMIN);
    denies(AppRole.SCHOOL_ADMIN, AppRole.DISTRICT_ADMIN);
    denies(AppRole.SCHOOL_ADMIN, AppRole.SUPER_ADMIN);
  });

  it('non-admin and unknown caller roles may assign nothing', () => {
    denies(AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER);
    denies(AppRole.RESTRICTED_VIEWER, AppRole.CONTRIBUTOR);
    denies('NONSENSE_ROLE', AppRole.CONTRIBUTOR);
  });
});

/**
 * ACC-01 (2026-08-01) — the shared TENANT-SCOPED ceiling.
 *
 * `ApiKeysService.ALLOWED_ROLES` already encoded "SUPER_ADMIN is a
 * platform-owner role and is not mintable from a tenant surface". SSO had no
 * equivalent, which is how an unauthenticated self-signup could reach
 * SUPER_ADMIN via its own IdP. This helper is now the single source of truth
 * so the rule cannot live in one module and be missing from the next.
 */
describe('assertTenantScopedRoleAssignable (ACC-01)', () => {
  const allows = (caller: string | null | undefined, target: string) =>
    expect(() => assertTenantScopedRoleAssignable(caller, target, 'SSO defaultRole')).not.toThrow();
  const denies = (caller: string | null | undefined, target: string) =>
    expect(() => assertTenantScopedRoleAssignable(caller, target, 'SSO defaultRole')).toThrow(
      ForbiddenException,
    );

  it('never allows SUPER_ADMIN — not even for a SUPER_ADMIN caller', () => {
    denies(AppRole.SUPER_ADMIN, AppRole.SUPER_ADMIN);
    denies(AppRole.DISTRICT_ADMIN, AppRole.SUPER_ADMIN);
    denies(AppRole.SCHOOL_ADMIN, AppRole.SUPER_ADMIN);
  });

  it('fails CLOSED for an unidentified caller', () => {
    denies(null, AppRole.RESTRICTED_VIEWER);
    denies(undefined, AppRole.CONTRIBUTOR);
    denies('', AppRole.CONTRIBUTOR);
  });

  it('still enforces the strictly-below-my-rank rule on top of the ceiling', () => {
    denies(AppRole.DISTRICT_ADMIN, AppRole.DISTRICT_ADMIN);
    denies(AppRole.SCHOOL_ADMIN, AppRole.DISTRICT_ADMIN);
    allows(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN);
    allows(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN);
  });

  it('rejects junk role strings', () => {
    denies(AppRole.SUPER_ADMIN, 'ROOT');
    denies(AppRole.SUPER_ADMIN, '');
  });

  it('the ceiling excludes SUPER_ADMIN and covers every other role', () => {
    expect(TENANT_ASSIGNABLE_ROLES).not.toContain(AppRole.SUPER_ADMIN);
    expect([...TENANT_ASSIGNABLE_ROLES].sort()).toEqual(
      [
        AppRole.CONTRIBUTOR,
        AppRole.DISTRICT_ADMIN,
        AppRole.RESTRICTED_VIEWER,
        AppRole.SCHOOL_ADMIN,
      ].sort(),
    );
  });
});
