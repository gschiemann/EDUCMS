/**
 * SEC-008 — the MFA policy itself, tested as a pure function.
 *
 * The independent assessment (2026-09-04) found a complete MFA
 * implementation that nothing ever switched on: `User.mfaRequired` defaults
 * to false and only an admin toggling one account at a time ever set it, so
 * a stolen admin password was a single factor away from a district-wide
 * lockdown. `evaluateMfaPolicy` is the fix, and it is the ONLY place the
 * question is decided — `AuthService.login`, `AuthService.refreshSession`
 * and `MfaController.assertEnrollmentRequired` all read it.
 *
 * Every case here injects both `now` and `enforceAfter`, so nothing in this
 * file depends on the wall clock or the environment.
 */
import {
  evaluateMfaPolicy,
  mfaPolicyNotice,
  resolveMfaEnforceAfter,
  MFA_POLICY_DEFAULT_ENFORCE_AFTER,
  MFA_REQUIRED_ROLES,
  __resetMfaPolicyWarningForTests,
} from './mfa-policy';

const BEFORE = new Date('2026-09-10T00:00:00.000Z');
const AFTER = new Date('2026-11-01T00:00:00.000Z');
const DEADLINE = new Date(MFA_POLICY_DEFAULT_ENFORCE_AFTER);

/**
 * Enforcement is live, in a tenant that enforces.
 *
 * `tenantEnforced: true` is spelled out rather than defaulted (2026-09-11):
 * the option is REQUIRED on `MfaPolicyOptions` precisely so that no caller —
 * production or test — can express "evaluate this policy" without saying whose
 * policy it is. That is what stops the 7a14ce38 omitted-field bypass from
 * being rebuilt one optional property at a time.
 */
const enforced = { now: AFTER, enforceAfter: DEADLINE, tenantEnforced: true };
/** Still inside the grace window. */
const grace = { now: BEFORE, enforceAfter: DEADLINE, tenantEnforced: true };
/** Enforcement deadline has passed, but THIS organization opted out. */
const tenantOptional = { now: AFTER, enforceAfter: DEADLINE, tenantEnforced: false };

describe('evaluateMfaPolicy — WHO is covered', () => {
  it.each(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'])(
    '%s is required to hold a second factor',
    (role) => {
      const d = evaluateMfaPolicy({ role }, enforced);
      expect(d.required).toBe(true);
      expect(d.reasons).toContain('privileged-role');
      expect(d.blocking).toBe(true);
    },
  );

  it.each(['CONTRIBUTOR', 'RESTRICTED_VIEWER'])(
    '%s is NOT swept in by role alone',
    (role) => {
      const d = evaluateMfaPolicy({ role }, enforced);
      expect(d.required).toBe(false);
      expect(d.blocking).toBe(false);
    },
  );

  it('a panic-capable CONTRIBUTOR IS required — the capability, not the title', () => {
    const d = evaluateMfaPolicy({ role: 'CONTRIBUTOR', canTriggerPanic: true }, enforced);
    expect(d.required).toBe(true);
    expect(d.reasons).toContain('panic-capable');
    expect(d.blocking).toBe(true);
  });

  it('a panic-capable RESTRICTED_VIEWER is required too (read-only ≠ harmless)', () => {
    const d = evaluateMfaPolicy({ role: 'RESTRICTED_VIEWER', canTriggerPanic: true }, enforced);
    expect(d.blocking).toBe(true);
  });

  it('an unknown / null role is not privileged by accident', () => {
    expect(evaluateMfaPolicy({ role: null }, enforced).required).toBe(false);
    expect(evaluateMfaPolicy({ role: 'SOMETHING_NEW' }, enforced).required).toBe(false);
    expect(evaluateMfaPolicy(null, enforced).required).toBe(false);
    expect(evaluateMfaPolicy(undefined, enforced).required).toBe(false);
  });

  it('lists exactly the three admin roles — a 4th must be a deliberate edit', () => {
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(
      ['DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'SUPER_ADMIN'],
    );
  });
});

describe('evaluateMfaPolicy — ENROLLED users are never blocked', () => {
  it('a privileged user who completed TOTP enrollment passes', () => {
    const d = evaluateMfaPolicy(
      { role: 'SUPER_ADMIN', mfaTotpVerifiedAt: new Date('2026-08-01') },
      enforced,
    );
    expect(d.required).toBe(true);
    expect(d.enrolled).toBe(true);
    expect(d.blocking).toBe(false);
    expect(d.inGrace).toBe(false);
  });

  it('a PROVISIONAL secret is not enrollment — only mfaTotpVerifiedAt counts', () => {
    // The provisional-secret rule predates SEC-008 (an interrupted enrollment
    // must never lock anyone out). The policy must inherit it, not re-decide it.
    const d = evaluateMfaPolicy(
      { role: 'SUPER_ADMIN', mfaTotpVerifiedAt: null },
      enforced,
    );
    expect(d.enrolled).toBe(false);
    expect(d.blocking).toBe(true);
  });
});

describe('SEC-008 grace window', () => {
  it('a privileged user is REQUIRED but not BLOCKED before the deadline', () => {
    const d = evaluateMfaPolicy({ role: 'DISTRICT_ADMIN' }, grace);
    expect(d.required).toBe(true);
    expect(d.blocking).toBe(false);
    expect(d.inGrace).toBe(true);
  });

  it('the same user IS blocked once the deadline passes', () => {
    const d = evaluateMfaPolicy({ role: 'DISTRICT_ADMIN' }, enforced);
    expect(d.blocking).toBe(true);
    expect(d.inGrace).toBe(false);
  });

  it('blocks exactly AT the deadline instant, not a tick later', () => {
    expect(
      evaluateMfaPolicy({ role: 'DISTRICT_ADMIN' }, { now: DEADLINE, enforceAfter: DEADLINE, tenantEnforced: true })
        .blocking,
    ).toBe(true);
    expect(
      evaluateMfaPolicy(
        { role: 'DISTRICT_ADMIN' },
        { now: new Date(DEADLINE.getTime() - 1), enforceAfter: DEADLINE, tenantEnforced: true },
      ).blocking,
    ).toBe(false);
  });

  it('the grace notice names a real date the dashboard can render', () => {
    const notice = mfaPolicyNotice(evaluateMfaPolicy({ role: 'SCHOOL_ADMIN' }, grace));
    expect(notice).toEqual({
      enrollmentRequired: true,
      enforceAfter: MFA_POLICY_DEFAULT_ENFORCE_AFTER,
    });
  });

  it('there is NO notice for an unaffected or already-enrolled user', () => {
    expect(mfaPolicyNotice(evaluateMfaPolicy({ role: 'CONTRIBUTOR' }, grace))).toBeUndefined();
    expect(
      mfaPolicyNotice(
        evaluateMfaPolicy({ role: 'SCHOOL_ADMIN', mfaTotpVerifiedAt: new Date() }, grace),
      ),
    ).toBeUndefined();
  });

  it('the notice never leaks WHY (reasons stay in the audit log)', () => {
    const notice = mfaPolicyNotice(evaluateMfaPolicy(
      { role: 'CONTRIBUTOR', canTriggerPanic: true },
      grace,
    ));
    expect(Object.keys(notice ?? {}).sort()).toEqual(['enforceAfter', 'enrollmentRequired']);
  });
});

describe('the per-user mfaRequired override (ACC-03) is NOT weakened by SEC-008', () => {
  it('blocks IMMEDIATELY — an admin who forces 2FA on an account gets it now, not after the deadline', () => {
    const d = evaluateMfaPolicy({ role: 'CONTRIBUTOR', mfaRequired: true }, grace);
    expect(d.reasons).toContain('per-user-override');
    expect(d.blocking).toBe(true);
    expect(d.inGrace).toBe(false);
  });

  it('survives the break-glass switch — that only removes the DERIVED policy', () => {
    const d = evaluateMfaPolicy(
      { role: 'CONTRIBUTOR', mfaRequired: true },
      { now: AFTER, enforceAfter: null, tenantEnforced: true },
    );
    expect(d.blocking).toBe(true);
  });
});

// ── PER-TENANT ENFORCEMENT (2026-09-11) ──────────────────────────────────
// Greg: "i want people to have the options but for my riot accounts, leave it
// turned on, we will keep that security so just new customers."
//
// The setting gates the DERIVED half and nothing else. Every case below fails
// if that line is drawn anywhere else.
describe('per-tenant enforcement gates the DERIVED half', () => {
  it.each(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'])(
    '%s is NOT blocked in an organization that has opted out',
    (role) => {
      const d = evaluateMfaPolicy({ role }, tenantOptional);
      expect(d.required).toBe(false);
      expect(d.blocking).toBe(false);
      expect(d.tenantEnforced).toBe(false);
    },
  );

  it('a panic-capable user is not blocked either — the capability rule is derived too', () => {
    const d = evaluateMfaPolicy({ role: 'CONTRIBUTOR', canTriggerPanic: true }, tenantOptional);
    expect(d.blocking).toBe(false);
  });

  it('the audit row does not claim a reason that did not apply', () => {
    // `reasons` feeds the AUTH_LOGIN_SUCCESS forensic row. Listing
    // "privileged-role" for an admin in a non-enforcing organization would be
    // an audit trail that describes a rule nobody was under.
    const d = evaluateMfaPolicy({ role: 'DISTRICT_ADMIN', canTriggerPanic: true }, tenantOptional);
    expect(d.reasons).toEqual([]);
  });

  it('the PER-USER override still blocks — tenant policy may only ADD enforcement', () => {
    // The load-bearing asymmetry. An operator who deliberately forced 2FA onto
    // one account does not lose it because the org-wide setting says optional.
    const d = evaluateMfaPolicy({ role: 'CONTRIBUTOR', mfaRequired: true }, tenantOptional);
    expect(d.required).toBe(true);
    expect(d.reasons).toContain('per-user-override');
    expect(d.blocking).toBe(true);
  });

  it('an ENROLLED user in an optional tenant is simply not blocked (nothing to enrol)', () => {
    const d = evaluateMfaPolicy(
      { role: 'SUPER_ADMIN', mfaTotpVerifiedAt: new Date('2026-08-01') },
      tenantOptional,
    );
    expect(d.enrolled).toBe(true);
    expect(d.blocking).toBe(false);
  });

  it('turning enforcement ON blocks the same user the optional tenant let through', () => {
    const subject = { role: 'SCHOOL_ADMIN' };
    expect(evaluateMfaPolicy(subject, tenantOptional).blocking).toBe(false);
    expect(evaluateMfaPolicy(subject, enforced).blocking).toBe(true);
  });

  it('FAILS CLOSED on a literal undefined — an omitted input is not permission', () => {
    // The 7a14ce38 shape, guarded at the last line of defence. `login(user:
    // any)` and every hand-built test double mean `tenantEnforced: undefined`
    // can still reach this function at runtime despite the required type. It
    // must read as ENFORCE, never as "this organization opted out".
    const d = evaluateMfaPolicy(
      { role: 'DISTRICT_ADMIN' },
      { now: AFTER, enforceAfter: DEADLINE, tenantEnforced: undefined as any },
    );
    expect(d.tenantEnforced).toBe(true);
    expect(d.blocking).toBe(true);
  });

  it('break-glass and the tenant setting are independent subtractions', () => {
    // Either one alone removes derived blocking; neither touches the override.
    const admin = { role: 'SUPER_ADMIN' };
    expect(evaluateMfaPolicy(admin, { now: AFTER, enforceAfter: null, tenantEnforced: true }).blocking).toBe(false);
    expect(evaluateMfaPolicy(admin, tenantOptional).blocking).toBe(false);
    expect(
      evaluateMfaPolicy(
        { role: 'SUPER_ADMIN', mfaRequired: true },
        { now: AFTER, enforceAfter: null, tenantEnforced: false },
      ).blocking,
    ).toBe(true);
  });

  it('reports tenantEnforced on the decision so the audit row can say whose call it was', () => {
    expect(evaluateMfaPolicy({ role: 'SCHOOL_ADMIN' }, enforced).tenantEnforced).toBe(true);
    expect(evaluateMfaPolicy({ role: 'SCHOOL_ADMIN' }, tenantOptional).tenantEnforced).toBe(false);
  });
});

describe('break-glass', () => {
  it('disables the derived requirement platform-wide', () => {
    const d = evaluateMfaPolicy({ role: 'SUPER_ADMIN' }, { now: AFTER, enforceAfter: null, tenantEnforced: true });
    expect(d.required).toBe(true); // still TRUE — the policy still says so…
    expect(d.blocking).toBe(false); // …it just is not enforced.
    expect(d.enforceAfter).toBeNull();
  });
});

describe('resolveMfaEnforceAfter — configuration', () => {
  beforeEach(() => __resetMfaPolicyWarningForTests());

  it('unset falls back to the built-in deadline (no forever-grace state)', () => {
    expect(resolveMfaEnforceAfter('')?.toISOString()).toBe(MFA_POLICY_DEFAULT_ENFORCE_AFTER);
    expect(resolveMfaEnforceAfter('   ')?.toISOString()).toBe(MFA_POLICY_DEFAULT_ENFORCE_AFTER);
  });

  it('reads the environment when no argument is given — and a MISSING var still lands on the deadline', () => {
    // The whole point of the built-in constant: a deployment that never sets
    // the variable still gets enforcement, on the shipped date. (jest.setup.ts
    // pins the var suite-wide, so this case has to unset it explicitly.)
    const saved = process.env.MFA_REQUIRED_ENFORCE_AFTER;
    try {
      delete process.env.MFA_REQUIRED_ENFORCE_AFTER;
      expect(resolveMfaEnforceAfter()?.toISOString()).toBe(MFA_POLICY_DEFAULT_ENFORCE_AFTER);
      process.env.MFA_REQUIRED_ENFORCE_AFTER = '2027-03-01T00:00:00Z';
      expect(resolveMfaEnforceAfter()?.toISOString()).toBe('2027-03-01T00:00:00.000Z');
    } finally {
      if (saved === undefined) delete process.env.MFA_REQUIRED_ENFORCE_AFTER;
      else process.env.MFA_REQUIRED_ENFORCE_AFTER = saved;
    }
  });

  it.each(['now', 'NOW', 'immediate', 'always'])('%s means enforce with no grace', (v) => {
    expect(resolveMfaEnforceAfter(v)?.getTime()).toBe(0);
  });

  it.each(['off', 'false', '0', 'never', 'disabled', 'NO'])('%s is break-glass', (v) => {
    expect(resolveMfaEnforceAfter(v)).toBeNull();
  });

  it('accepts an explicit ISO instant', () => {
    expect(resolveMfaEnforceAfter('2027-01-15T12:00:00Z')?.toISOString()).toBe(
      '2027-01-15T12:00:00.000Z',
    );
  });

  it('a TYPO falls back to the deadline, never to "off" — fail-safe direction', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // "of" instead of "off" must NOT silently disable required MFA.
    expect(resolveMfaEnforceAfter('of')?.toISOString()).toBe(MFA_POLICY_DEFAULT_ENFORCE_AFTER);
    expect(resolveMfaEnforceAfter('yesterday')?.toISOString()).toBe(
      MFA_POLICY_DEFAULT_ENFORCE_AFTER,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('shouts once when break-glass is active', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resolveMfaEnforceAfter('off');
    resolveMfaEnforceAfter('off');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('BREAK-GLASS ACTIVE');
    warn.mockRestore();
  });

  it('the shipped default deadline is a real, parseable instant', () => {
    expect(Number.isNaN(new Date(MFA_POLICY_DEFAULT_ENFORCE_AFTER).getTime())).toBe(false);
  });
});
