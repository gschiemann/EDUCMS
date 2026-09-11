/**
 * SEC-010 (2026-09-05) — the durable-session endpoints.
 *
 * `SessionRefreshService` proves that rotation and reuse detection are
 * correct in isolation. This file proves the thing that actually decides
 * whether the feature is safe: that presenting a VALID refresh token is not
 * a way around anything the Bearer path enforces.
 *
 * The endpoint mints an access token WITHOUT `JwtAuthGuard` — by design, the
 * refresh token IS the credential at that point — so every check the guard
 * would have run has to be re-run here, against LIVE state, or the cookie
 * becomes a 30-day bypass for revocation, deactivation, tenant archival and
 * the SEC-008 MFA policy. Each of those is a case below, and each asserts
 * BOTH that the request is refused AND that the family is burned, because
 * refusing once while leaving a live credential in the browser would just
 * move the bypass one round trip away.
 */
import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SessionController } from './session.controller';
import { MAX_FAMILY_LIFETIME_SEC } from './session-refresh.service';

const NOW_SEC = () => Math.floor(Date.now() / 1000);

function makeUser(over: Record<string, any> = {}) {
  return {
    id: 'u1',
    email: 'op@example.com',
    role: 'SCHOOL_ADMIN',
    tenantId: 't1',
    firstName: 'Op',
    lastName: 'Erator',
    canTriggerPanic: false,
    mustSetupCredentials: false,
    deletedAt: null,
    status: 'ACTIVE',
    mfaTotpVerifiedAt: new Date(),
    tenant: { slug: 't-slug', vertical: 'K12', name: 'T', archivedAt: null },
    ...over,
  };
}

function harness(opts: {
  rotate?: any;
  user?: any;
  invalidBefore?: number | null;
  invalidBeforeThrows?: boolean;
} = {}) {
  const sessions = {
    issueFamily: jest.fn(async () => ({
      token: 'fam.secret',
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    })),
    rotate: jest.fn(async () =>
      opts.rotate === undefined
        ? {
            ok: true,
            token: 'fam.next',
            userId: 'u1',
            origIat: NOW_SEC() - 3600,
            familyId: 'fam',
            expiresAt: new Date(Date.now() + 29 * 86400_000),
          }
        : opts.rotate,
    ),
    revokeFamily: jest.fn(async () => undefined),
    revokeByPresentedToken: jest.fn(async () => true),
  };
  const jwtService = {
    sign: jest.fn(() => 'minted.jwt'),
    decode: jest.fn(() => ({ rm: true, origIat: NOW_SEC() - 3600, sub: 'u1', tenantId: 't1' })),
  };
  const redisService = {
    getTokenInvalidBefore: jest.fn(async () => {
      if (opts.invalidBeforeThrows) throw new Error('redis down');
      return opts.invalidBefore ?? null;
    }),
  };
  const prisma = {
    client: {
      user: { findUnique: jest.fn(async () => (opts.user === undefined ? makeUser() : opts.user)) },
      auditLog: { create: jest.fn(async () => ({})) },
      sessionRefreshToken: { findFirst: jest.fn(async () => ({ userId: 'u1' })) },
    },
  };
  const controller = new SessionController(
    sessions as any,
    jwtService as any,
    redisService as any,
    prisma as any,
  );
  return { controller, sessions, jwtService, redisService, prisma };
}

function req(over: Record<string, any> = {}) {
  return {
    headers: { authorization: 'Bearer abc.def.ghi', 'user-agent': 'jest' },
    user: { userId: 'u1', tenantId: 't1' },
    ...over,
  } as any;
}

const prevSecret = process.env.SESSION_BFF_SECRET;
afterEach(() => {
  if (prevSecret === undefined) delete process.env.SESSION_BFF_SECRET;
  else process.env.SESSION_BFF_SECRET = prevSecret;
});
beforeEach(() => {
  delete process.env.SESSION_BFF_SECRET;
});

describe('POST /auth/session/refresh — a cookie is never a way around a revocation', () => {
  it('mints a <=1h access token on the happy path and rotates the cookie', async () => {
    const { controller, jwtService } = harness();
    const out = await controller.refresh({ refresh_token: 'fam.secret' } as any, req());

    expect(out.access_token).toBe('minted.jwt');
    expect(out.refresh_token).toBe('fam.next');
    // The ROTATED token is returned to the BFF (which parks it in the
    // cookie), never a long-lived access token.
    const [, signOpts] = jwtService.sign.mock.calls[0];
    expect(signOpts.expiresIn).toBeLessThanOrEqual(3600);
    expect(signOpts.expiresIn).toBeGreaterThan(0);
  });

  it('refuses AND burns the family when the per-user invalid-before epoch moved', async () => {
    // "Sign out everywhere" / change-password stamps this epoch. If the
    // cookie ignored it, logging out everywhere would not log out the
    // browser holding the cookie — which is the whole point of the feature.
    const origIat = NOW_SEC() - 7200;
    const { controller, sessions } = harness({
      rotate: {
        ok: true,
        token: 'fam.next',
        userId: 'u1',
        origIat,
        familyId: 'fam',
        expiresAt: new Date(Date.now() + 86400_000),
      },
      invalidBefore: origIat + 60,
    });

    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.revokeFamily).toHaveBeenCalledWith('fam', 'user-invalid-before');
  });

  it('503s (not 401s) when the revocation store is unreachable — retry, do not tear down', async () => {
    // Same posture as JwtAuthGuard. A 401 here would sign the operator out
    // on a Redis blip; a 503 tells the client to try again, and the BFF
    // keeps the cookie for exactly that reason.
    const { controller, sessions } = harness({ invalidBeforeThrows: true });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(sessions.revokeFamily).not.toHaveBeenCalled();
  });

  for (const [label, user] of [
    ['a DELETED user', makeUser({ deletedAt: new Date() })],
    ['a DISABLED user', makeUser({ status: 'DISABLED' })],
    ['an ARCHIVED tenant', makeUser({ tenant: { slug: 's', archivedAt: new Date() } })],
    ['a user row that no longer exists', null],
  ] as Array<[string, any]>) {
    it(`refuses AND burns the family for ${label}`, async () => {
      const { controller, sessions } = harness({ user });
      await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessions.revokeFamily).toHaveBeenCalledWith('fam', 'account-not-refreshable');
    });
  }

  it('refuses AND burns the family when SEC-008 MFA enrollment has become blocking', async () => {
    // A privileged account past the enrollment deadline must not keep
    // sliding on a cookie any more than it may on the Bearer path.
    const { controller, sessions } = harness({
      user: makeUser({ role: 'SUPER_ADMIN', mfaTotpVerifiedAt: null }),
    });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      /Two-factor/,
    );
    expect(sessions.revokeFamily).toHaveBeenCalledWith('fam', 'mfa-enrollment-required');
  });

  // ── FAIL-OPEN #2, cookie half (recon 2026-09-11) ────────────────────────
  // The SEC-010 cookie path joins the tenant with the same narrow select the
  // Bearer path does. Reading `undefined` here keeps a non-compliant admin's
  // REMEMBERED session alive for up to 30 days — the longest-lived fail-open
  // of the six.
  it('LETS THROUGH a privileged unenrolled user whose organization opted out', async () => {
    const { controller, sessions } = harness({
      user: makeUser({
        role: 'SUPER_ADMIN',
        mfaTotpVerifiedAt: null,
        tenant: { slug: 's', vertical: 'RETAIL', name: 'T', archivedAt: null, mfaEnforced: false },
      }),
    });
    await expect(
      controller.refresh({ refresh_token: 'fam.x' } as any, req()),
    ).resolves.toBeDefined();
    expect(sessions.revokeFamily).not.toHaveBeenCalled();
  });

  it('REFUSES the same user when the organization enforces', async () => {
    const { controller, sessions } = harness({
      user: makeUser({
        role: 'SUPER_ADMIN',
        mfaTotpVerifiedAt: null,
        tenant: { slug: 's', vertical: 'K12', name: 'T', archivedAt: null, mfaEnforced: true },
      }),
    });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      /Two-factor/,
    );
    expect(sessions.revokeFamily).toHaveBeenCalledWith('fam', 'mfa-enrollment-required');
  });

  it('FAILS CLOSED when the join does not carry the column', async () => {
    // The base fixture's tenant has no `mfaEnforced` — exactly the shape a
    // pre-2026-09-11 select produces. It must read as ENFORCED.
    const { controller } = harness({
      user: makeUser({ role: 'SUPER_ADMIN', mfaTotpVerifiedAt: null }),
    });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      /Two-factor/,
    );
  });

  it('refuses AND burns the family once the 30-day window is spent', async () => {
    const { controller, sessions } = harness({
      rotate: {
        ok: true,
        token: 'fam.next',
        userId: 'u1',
        origIat: NOW_SEC() - MAX_FAMILY_LIFETIME_SEC - 10,
        familyId: 'fam',
        expiresAt: new Date(Date.now() + 1000),
      },
    });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.revokeFamily).toHaveBeenCalledWith('fam', 'window-exceeded');
  });

  it('a REUSE writes the forensic audit row — the one signal that is not "just expired"', async () => {
    const { controller, prisma } = harness({ rotate: { ok: false, reason: 'reused' } });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      UnauthorizedException,
    );
    const actions = prisma.client.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action);
    expect(actions).toContain('AUTH_SESSION_REFRESH_REUSE');
  });

  it('an ordinary expiry does NOT write a reuse row (no crying wolf)', async () => {
    const { controller, prisma } = harness({ rotate: { ok: false, reason: 'expired' } });
    await expect(controller.refresh({ refresh_token: 'fam.x' } as any, req())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('every refusal answers with ONE opaque code — no account-state oracle', async () => {
    for (const reason of ['unknown', 'expired', 'revoked', 'malformed'] as const) {
      const { controller } = harness({ rotate: { ok: false, reason } });
      await controller
        .refresh({ refresh_token: 'fam.x' } as any, req())
        .then(
          () => {
            throw new Error(`expected a refusal for ${reason}`);
          },
          (e: any) => {
            expect(e.getResponse().code).toBe('SESSION_REFRESH_REJECTED');
          },
        );
    }
  });
});

describe('POST /auth/session/issue — only a remember-class HUMAN session gets a cookie', () => {
  it('issues for a session carrying the rm claim', async () => {
    const { controller, sessions } = harness();
    const out = await controller.issue(req());
    expect(out.refresh_token).toBe('fam.secret');
    expect(sessions.issueFamily).toHaveBeenCalled();
  });

  it('refuses a session that never opted into staying signed in', async () => {
    // Handing a per-tab session a 30-day cookie would silently upgrade it —
    // the operator did not ask to stay signed in, and the multi-tenant
    // per-tab isolation the store exists for would be gone.
    const { controller, jwtService, sessions } = harness();
    jwtService.decode.mockReturnValue({ sub: 'u1' });
    await expect(controller.issue(req())).rejects.toThrow(ForbiddenException);
    expect(sessions.issueFamily).not.toHaveBeenCalled();
  });

  for (const kind of ['api-key', 'device']) {
    it(`refuses a ${kind} identity — machine credentials have their own lifecycle`, async () => {
      const { controller, sessions } = harness();
      await expect(
        controller.issue(req({ user: { userId: 'u1', kind } })),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessions.issueFamily).not.toHaveBeenCalled();
    });
  }

  it('refuses a SWITCHED-WORKSPACE session (the Bearer path refuses to slide one too)', async () => {
    const { controller, prisma, sessions } = harness();
    prisma.client.user.findUnique.mockResolvedValue({ tenantId: 'OTHER' } as any);
    await expect(controller.issue(req())).rejects.toThrow(ForbiddenException);
    expect(sessions.issueFamily).not.toHaveBeenCalled();
  });

  it('refuses when the session is already past its 30-day window', async () => {
    const { controller, sessions } = harness();
    sessions.issueFamily.mockResolvedValue(null as any);
    await expect(controller.issue(req())).rejects.toThrow(/30-day/);
  });
});

describe('POST /auth/session/revoke — logout is forgiving, never an attack signal', () => {
  it('always reports success and never grades a spent token as a replay', async () => {
    const { controller, sessions } = harness();
    const out = await controller.revoke({ refresh_token: 'fam.spent' } as any, req());
    expect(out).toEqual({ success: true });
    // Deliberately NOT `rotate` — logging out twice, or with the cookie the
    // last refresh replaced, is normal and must not burn an audit row.
    expect(sessions.revokeByPresentedToken).toHaveBeenCalledWith('fam.spent');
    expect(sessions.rotate).not.toHaveBeenCalled();
  });
});

describe('SESSION_BFF_SECRET — subtractive by design', () => {
  it('UNSET: the endpoints work (a half-configured deploy must not sign the fleet out)', async () => {
    const { controller } = harness();
    await expect(
      controller.refresh({ refresh_token: 'fam.x' } as any, req()),
    ).resolves.toBeTruthy();
  });

  it('SET: a caller without the header is refused on every endpoint', async () => {
    process.env.SESSION_BFF_SECRET = 'x'.repeat(32);
    const { controller } = harness();
    await expect(controller.refresh({ refresh_token: 'f.x' } as any, req())).rejects.toThrow(
      ForbiddenException,
    );
    await expect(controller.revoke({ refresh_token: 'f.x' } as any, req())).rejects.toThrow(
      ForbiddenException,
    );
    await expect(controller.issue(req())).rejects.toThrow(ForbiddenException);
  });

  it('SET: a caller presenting the WRONG secret is refused', async () => {
    process.env.SESSION_BFF_SECRET = 'x'.repeat(32);
    const { controller } = harness();
    await expect(
      controller.refresh(
        { refresh_token: 'f.x' } as any,
        req({ headers: { 'x-venueos-session-bff': 'y'.repeat(32) } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SET: the web origin server presenting the right secret is let through', async () => {
    const secret = 'x'.repeat(32);
    process.env.SESSION_BFF_SECRET = secret;
    const { controller } = harness();
    await expect(
      controller.refresh(
        { refresh_token: 'f.x' } as any,
        req({ headers: { 'x-venueos-session-bff': secret, 'user-agent': 'jest' } }),
      ),
    ).resolves.toBeTruthy();
  });

  it('a TOO-SHORT secret is treated as unset rather than as a weak gate', async () => {
    process.env.SESSION_BFF_SECRET = 'short';
    const { controller } = harness();
    await expect(
      controller.refresh({ refresh_token: 'f.x' } as any, req()),
    ).resolves.toBeTruthy();
  });
});
