/**
 * ACC-01 follow-up (2026-08-03) — the client mirror of the server's
 * role-assignment table.
 *
 * ACC-01 gave the SSO `defaultRole` writer a rank gate, which instantly made
 * the settings dropdown ship a guaranteed error: it listed `DISTRICT_ADMIN`,
 * and a DISTRICT_ADMIN — the role that page is gated to — can never assign it.
 * These tests pin the two properties that matter: the mirror agrees with the
 * server, and a tenant-scoped surface can never offer SUPER_ADMIN.
 */
import {
  assignableRoles,
  canAssignRole,
  tenantRoleOptions,
  TENANT_ASSIGNABLE_ROLES,
} from '../role-assignment';

describe('assignableRoles — strictly below my own rank', () => {
  it('SUPER_ADMIN can assign every tenant role but not another SUPER_ADMIN', () => {
    expect(assignableRoles('SUPER_ADMIN')).toEqual([
      'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER',
    ]);
    expect(canAssignRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(false);
  });

  it('DISTRICT_ADMIN cannot assign DISTRICT_ADMIN — the exact SSO dropdown bug', () => {
    expect(canAssignRole('DISTRICT_ADMIN', 'DISTRICT_ADMIN')).toBe(false);
    expect(canAssignRole('DISTRICT_ADMIN', 'SCHOOL_ADMIN')).toBe(true);
  });

  it('SCHOOL_ADMIN tops out at CONTRIBUTOR', () => {
    expect(assignableRoles('SCHOOL_ADMIN')).toEqual(['CONTRIBUTOR', 'RESTRICTED_VIEWER']);
  });

  it('a CONTRIBUTOR, an unknown role, and no role all assign nothing (fail closed)', () => {
    expect(assignableRoles('CONTRIBUTOR')).toEqual([]);
    expect(assignableRoles('WAT')).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
    expect(assignableRoles(undefined)).toEqual([]);
  });
});

describe('tenantRoleOptions — what a tenant-scoped picker may show', () => {
  it('never offers SUPER_ADMIN, even to a SUPER_ADMIN', () => {
    // A platform-owner role must not be reachable from anything a tenant
    // admin drives.
    expect(TENANT_ASSIGNABLE_ROLES).not.toContain('SUPER_ADMIN');
    expect(tenantRoleOptions('SUPER_ADMIN')).not.toContain('SUPER_ADMIN');
  });

  it('drops the caller own-rank option a DISTRICT_ADMIN could never save', () => {
    expect(tenantRoleOptions('DISTRICT_ADMIN')).toEqual([
      'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER',
    ]);
  });

  it('keeps an already-stored value so an existing config renders its own setting', () => {
    // Otherwise the select would silently display someone else's choice.
    expect(tenantRoleOptions('DISTRICT_ADMIN', 'DISTRICT_ADMIN')[0]).toBe('DISTRICT_ADMIN');
  });

  it('does not duplicate a stored value the caller can also assign', () => {
    const opts = tenantRoleOptions('DISTRICT_ADMIN', 'CONTRIBUTOR');
    expect(opts.filter((r) => r === 'CONTRIBUTOR')).toHaveLength(1);
  });
});
