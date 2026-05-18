import {
  SignupInputSchema,
  CreateInviteInputSchema,
  CreateUserDirectInputSchema,
  AcceptInviteInputSchema,
} from '@cms/api-types';

/**
 * Boundary validation for the onboarding endpoints, which previously
 * accepted an untyped `any` body. The schemas are `.passthrough()` —
 * they bound and type-check every KNOWN field but must never reject an
 * unexpected extra key (so adding one can't break a live client). The
 * service keeps the semantic rules (role rank, vertical enum, 8-char
 * password minimum).
 */
describe('onboarding request schemas', () => {
  describe('SignupInputSchema', () => {
    const valid = {
      districtName: 'Lincoln District',
      adminEmail: 'admin@lincoln.org',
      password: 'hunter2hunter',
    };

    it('accepts a well-formed signup body (slug/vertical optional)', () => {
      expect(SignupInputSchema.safeParse(valid).success).toBe(true);
      expect(SignupInputSchema.safeParse({ ...valid, slug: 'lincoln', vertical: 'K12' }).success).toBe(true);
    });

    it('passes unknown keys through — never breaks an existing client', () => {
      const r = SignupInputSchema.safeParse({ ...valid, somethingNew: 'x' });
      expect(r.success).toBe(true);
      if (r.success) expect((r.data as Record<string, unknown>).somethingNew).toBe('x');
    });

    it('rejects a missing or malformed email', () => {
      expect(SignupInputSchema.safeParse({ ...valid, adminEmail: undefined }).success).toBe(false);
      expect(SignupInputSchema.safeParse({ ...valid, adminEmail: 'not-an-email' }).success).toBe(false);
    });

    it('rejects an empty or over-long district name', () => {
      expect(SignupInputSchema.safeParse({ ...valid, districtName: '' }).success).toBe(false);
      expect(SignupInputSchema.safeParse({ ...valid, districtName: 'x'.repeat(201) }).success).toBe(false);
    });

    it('rejects a non-string password and a 10 MB password', () => {
      expect(SignupInputSchema.safeParse({ ...valid, password: { evil: 1 } }).success).toBe(false);
      expect(SignupInputSchema.safeParse({ ...valid, password: 'x'.repeat(10_000_000) }).success).toBe(false);
    });
  });

  describe('CreateInviteInputSchema', () => {
    const valid = { email: 'teacher@lincoln.org', role: 'CONTRIBUTOR' };

    it('accepts a well-formed invite body', () => {
      expect(CreateInviteInputSchema.safeParse(valid).success).toBe(true);
      expect(CreateInviteInputSchema.safeParse({ ...valid, firstName: 'Pat', lastName: 'Lee' }).success).toBe(true);
    });

    it('rejects a missing role and an over-long name', () => {
      expect(CreateInviteInputSchema.safeParse({ email: valid.email }).success).toBe(false);
      expect(CreateInviteInputSchema.safeParse({ ...valid, firstName: 'x'.repeat(81) }).success).toBe(false);
    });
  });

  describe('CreateUserDirectInputSchema', () => {
    it('accepts a well-formed direct-create body', () => {
      expect(
        CreateUserDirectInputSchema.safeParse({ email: 'a@b.org', role: 'CONTRIBUTOR', password: 'pw' }).success,
      ).toBe(true);
    });

    it('rejects a non-string email', () => {
      expect(
        CreateUserDirectInputSchema.safeParse({ email: 123, role: 'CONTRIBUTOR', password: 'pw' }).success,
      ).toBe(false);
    });
  });

  describe('AcceptInviteInputSchema', () => {
    it('accepts a password and rejects a missing one', () => {
      expect(AcceptInviteInputSchema.safeParse({ password: 'newpassword' }).success).toBe(true);
      expect(AcceptInviteInputSchema.safeParse({}).success).toBe(false);
    });
  });
});
