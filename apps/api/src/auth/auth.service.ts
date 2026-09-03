import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { cryptoPlatformConfig } from './crypto.config';
import { issueMfaChallengeToken } from './mfa-challenge-token';

// ── POST /auth/refresh — sliding session, capped at the ORIGINAL login ──────
// All four windows anchor to the `origIat` claim (the real credential check),
// which every refresh carries forward UNCHANGED. A token can slide, but the
// session's total life stays bounded by the authentication event — a stolen
// token cannot be kept alive forever.
/** Non-rememberMe sessions may refresh for 12h after login: a scorekeeper who
 *  signs in during warm-ups keeps the console through double OT without being
 *  bounced to /login in the third quarter — and without touching the 30d
 *  rememberMe ceiling. */
const REFRESH_WINDOW_SESSION_SEC = 12 * 60 * 60;
/** rememberMe keeps its existing ceiling: 30d from login, never longer. */
const REFRESH_WINDOW_REMEMBER_SEC = 30 * 24 * 60 * 60;
/** Mirrors auth.module signOptions `expiresIn: '1h'` — keep in sync. */
const SESSION_TOKEN_TTL_SEC = 60 * 60;
/** Mirrors the rememberMe `expiresIn: '30d'` used at login. */
const REMEMBER_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * auth-BUG-006: pre-computed Argon2id hash used as a timing decoy when
 * the user lookup misses. Without this, the "user not found" branch
 * skips the ~45ms argon2.verify call and returns ~200ms faster than
 * the "wrong password" branch — a measurable side channel that lets an
 * attacker enumerate which emails exist in the system. We compute this
 * once at module load using the project's argon2id params, then verify
 * against it on every miss so both branches take the same time.
 *
 * The plaintext "not_a_real_password" is a constant, not a secret —
 * its only purpose is to give argon2.verify something to chew on for
 * the same number of CPU cycles as the real path.
 */
const DUMMY_PASSWORD_FOR_TIMING = 'not_a_real_password';
const DUMMY_HASH_PROMISE: Promise<string> = argon2.hash(DUMMY_PASSWORD_FOR_TIMING, {
  type: cryptoPlatformConfig.type,
  memoryCost: cryptoPlatformConfig.memoryCost,
  timeCost: cryptoPlatformConfig.timeCost,
  parallelism: cryptoPlatformConfig.parallelism,
});

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  /**
   * Hash a password using Argon2id with platform-standard settings.
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: cryptoPlatformConfig.type,
      memoryCost: cryptoPlatformConfig.memoryCost,
      timeCost: cryptoPlatformConfig.timeCost,
      parallelism: cryptoPlatformConfig.parallelism,
    });
  }

  /**
   * Does `password` match `hash`? Uses the ONE platform Argon2id config, so a
   * caller can never drift into a second parameter set.
   *
   * Deliberately narrower than `validateUser`: that method also enforces
   * account state (soft-deleted, non-ACTIVE, archived tenant) and equalises
   * timing for the login enumeration channel. Callers that already hold an
   * authenticated principal and just need "is this the same secret?" — e.g.
   * first-login setup refusing to keep the shared starter password — want
   * this, and would misread `validateUser`'s null as "wrong password".
   *
   * Never throws: an unparseable/legacy hash is `false`, not a 500.
   */
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password, cryptoPlatformConfig);
    } catch {
      return false;
    }
  }

  /**
   * Validate user credentials against stored Argon2id hash.
   * Falls back to legacy plaintext comparison for unseeded/dev accounts,
   * then auto-upgrades the hash.
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const found = await this.prisma.client.user.findUnique({
      where: { email },
      // ACC-05 (2026-08-01): pull the owning tenant's archive state in the
      // SAME query the login already makes — zero extra round-trips on the
      // hot auth path. `archivedAt` is the soft-delete marker for a retired
      // location; a user of an archived tenant must not be able to obtain a
      // session (see the deletedAt precedent immediately below).
      include: { tenant: { select: { archivedAt: true } } },
    });
    // 2026-06-16 — a soft-deleted user must never authenticate. The delete
    // path also anonymizes the email, but defend in depth: treat a deletedAt
    // row as no-user so the timing-equalized dummy-verify branch still runs.
    //
    // ACC-05 — likewise for a user whose TENANT is archived. Archiving a
    // tenant used to be a display-layer change only: every one of its users
    // could still log in, and an admin among them could still fire
    // /emergency/trigger at real screens. Folded into the same null-out so it
    // inherits the timing-equalized branch below and cannot be used to
    // distinguish "archived tenant" from "wrong password".
    const tenantArchived = !!(found as any)?.tenant?.archivedAt;
    const user = found && !(found as any).deletedAt && !tenantArchived ? found : null;
    if (!user) {
      // auth-BUG-006: even though we have nothing to verify, run a
      // dummy argon2.verify so the response time matches the
      // "user found, wrong password" branch. Otherwise an attacker
      // can enumerate valid emails by measuring the latency gap
      // (~200ms missing-user vs ~245ms wrong-password).
      try {
        const dummyHash = await DUMMY_HASH_PROMISE;
        await argon2.verify(dummyHash, pass, cryptoPlatformConfig);
      } catch {
        // Don't leak the dummy verify failing; just absorb.
      }
      return null;
    }

    // Audit fix #8: refuse login for users still in the INVITED state.
    // They must accept their invite and set a password before they can log
    // in directly. Without this gate, the placeholder password set during
    // invite creation could (in theory) be guessed before the operator
    // accepts.
    if (user.status && user.status !== 'ACTIVE') {
      // Same timing-equalization trick — run a dummy verify so an
      // attacker can't tell ACTIVE-but-wrong-password apart from
      // INVITED-but-correct-email-shape.
      try {
        const dummyHash = await DUMMY_HASH_PROMISE;
        await argon2.verify(dummyHash, pass, cryptoPlatformConfig);
      } catch {}
      return null;
    }

    // Try Argon2id verification first (production path)
    try {
      const isValid = await argon2.verify(user.passwordHash, pass, cryptoPlatformConfig);
      if (isValid) {
        // Drop the hash AND the joined tenant row — callers want the user
        // shape they had before ACC-05 added the archive join.
        const { passwordHash, tenant, ...result } = user as any;
        return result;
      }
    } catch {
      // Hash format not recognized by argon2 — fall through to legacy check
    }

    // Argon2id verification failed — reject
    return null;
  }

  /**
   * P0-4 (2026-05-28) — resolve the tenant a failed-login email maps to,
   * so the controller can write an `AUTH_LOGIN_FAILED` AuditLog row
   * attributed to the RIGHT tenant. `AuditLog.tenantId` is NOT NULL in
   * the schema, so a failed attempt against a real account can only be
   * audited if we know that account's tenant.
   *
   * Returns `null` when the email maps to no user — in that case there
   * is no tenant to attribute the row to (and fabricating one would
   * corrupt another tenant's audit trail), so the controller logs the
   * miss to stdout instead. This deliberately performs NO password
   * work — `validateUser` already ran the argon2 timing-equalizer, so
   * this lookup is only reached after the credential check resolved and
   * adds no enumeration side channel (it returns the same `null` to the
   * caller regardless; the result never reaches the HTTP response).
   */
  async tenantIdForEmail(email: string): Promise<string | null> {
    try {
      const user = await this.prisma.client.user.findUnique({
        where: { email },
        select: { tenantId: true },
      });
      return user?.tenantId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Mint a session JWT whose `iat` is PINNED to `iatSeconds` (ACC-02).
   *
   * Needed by the credential-change flows. Those revoke every live token for
   * the user by stamping a per-user "invalid-before" epoch (RedisService.
   * markUserTokensInvalid), which JwtAuthGuard enforces as `iat < epoch →
   * reject`. A replacement token signed with the ambient clock would land on
   * `iat === floor(now)` while the epoch is `floor(now) + 1`, so the guard
   * would reject the token we JUST issued and bounce the user to the login
   * screen the instant they changed their password. Pinning `iat` to the
   * revocation epoch makes the new session the first valid one after the cut
   * — every OTHER live token is strictly older and stays revoked.
   *
   * (jsonwebtoken honors an `iat` supplied in the payload; verified against
   * the installed version rather than assumed.)
   */
  signSessionToken(
    user: {
      id: string;
      email: string;
      tenantId: string;
      role: string;
      canTriggerPanic?: boolean;
      /** FIRST-LOGIN CREDENTIAL SETUP — see the `msc` claim below. */
      mustSetupCredentials?: boolean;
    },
    opts: { iatSeconds: number; rememberMe?: boolean },
  ): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        canTriggerPanic: !!user.canTriggerPanic,
        // `msc` = mustSetupCredentials (2026-09-03). JwtAuthGuard reads it to
        // gate an account still holding its provisioning placeholder email +
        // starter password down to the setup / logout / me routes. Every
        // caller of this method reads the LIVE user row, so the claim is
        // authoritative; a token WITHOUT it makes the guard verify against the
        // database instead of trusting silence (the fail-safe direction).
        msc: !!user.mustSetupCredentials,
        iat: opts.iatSeconds,
      },
      opts.rememberMe ? { expiresIn: '30d' } : undefined,
    );
  }

  async login(user: any, rememberMe?: boolean) {
    // P0-4 (audit 2026-05-27) — if MFA is enabled on this user we
    // STOP the normal session creation here and return a short-lived
    // challenge token. The client trades the challenge token + a
    // valid TOTP / backup code for the real session via
    // POST /api/v1/auth/mfa/challenge.
    //
    // `mfaTotpVerifiedAt` is the source of truth for "MFA enabled":
    // we set it only after the user proves they can read codes from
    // their Authenticator, so an interrupted enrollment can never
    // lock them out (the secret stays provisional and is ignored
    // by login).
    if (user?.mfaTotpVerifiedAt) {
      return {
        mfaRequired: true,
        mfaToken: issueMfaChallengeToken(this.jwtService, user.id, rememberMe),
      };
    }

    // ── ACC-03 (2026-08-01) — `User.mfaRequired` IS NOW ENFORCED ──────────
    // `mfaRequired` shipped as a schema column with an "admin can force 2FA
    // on this user" comment and NO reader anywhere in the API or the web app
    // — a policy switch that did literally nothing. An admin who turned it on
    // believed the account was protected; it was not. Now: if the policy is
    // set and the user has NOT completed TOTP enrollment, password alone does
    // NOT produce a session. They get the same short-lived challenge token as
    // the normal MFA path, flagged `mfaEnrollmentRequired`, and must finish
    // enrollment through POST /auth/mfa/required/{enroll,verify} — which
    // returns the real session on success. Enrollment is reachable WITHOUT a
    // session precisely so a required-MFA user is never locked out (they
    // cannot call the session-gated /enroll to get in).
    //
    // SSO is deliberately exempt — the IdP is the authenticator there. That
    // decision and its obligations are recorded on SsoService.completeSsoLogin.
    if (user?.mfaRequired) {
      return {
        mfaRequired: true,
        mfaEnrollmentRequired: true,
        mfaToken: issueMfaChallengeToken(this.jwtService, user.id, rememberMe),
      };
    }

    // Look up the tenant slug + vertical for URL-friendly routing AND
    // VenueOS-era vertical-aware UI copy. Vertical drives terminology,
    // template library filter, default emergency types — without it
    // the dashboard always renders K12 strings even on gym/retail
    // tenants.
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true, vertical: true, name: true },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      canTriggerPanic: user.canTriggerPanic,
      // Sliding-refresh anchor (POST /auth/refresh). `origIat` = the ORIGINAL
      // credential check; refresh re-mints tokens but carries it forward
      // unchanged, so total session life stays capped relative to the real
      // authentication (12h session / 30d rememberMe). `rm` marks the
      // rememberMe class so a refresh re-mints with the same class.
      origIat: Math.floor(Date.now() / 1000),
      // FIRST-LOGIN CREDENTIAL SETUP (2026-09-03). `msc` = mustSetupCredentials,
      // read from the live row `validateUser` just returned. JwtAuthGuard uses
      // it to gate an account still on its provisioning placeholder email +
      // starter password down to the setup / logout / me routes without a
      // database round-trip on every request.
      msc: !!user.mustSetupCredentials,
      ...(rememberMe ? { rm: true } : {}),
    };
    return {
      // rememberMe was 365d — too long. A token leaked from a stolen
      // laptop or compromised browser session was good for a full year
      // with no rotation/refresh path. 30d is the reasonable upper
      // bound for "stay signed in" UX (shorter than typical password
      // policy, longer than a normal work session). After this expires,
      // the user is asked to log in again — same flow as no-rememberMe
      // hitting the default JWT TTL. (2026-08-06: POST /auth/refresh now
      // slides sessions WITHIN these ceilings — see refreshSession.)
      access_token: this.jwtService.sign(payload, rememberMe ? { expiresIn: '30d' } : undefined),
      user: {
        id: user.id, email: user.email, role: user.role,
        // 2026-05-11 — first/last name in the login response so the
        // dashboard greeting + sidebar can render "Hi, Greg" without
        // a separate /users/me round trip. Null when the user hasn't
        // set them yet; client falls back to email-prefix.
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        tenantId: user.tenantId, tenantSlug: tenant?.slug || user.tenantId,
        tenantName: tenant?.name || null,
        tenantVertical: tenant?.vertical || 'K12',
        canTriggerPanic: user.canTriggerPanic,
        // The dashboard shell reads this to render the one-time credential
        // setup screen INSTEAD of the app — it must arrive with the login
        // response, or the app paints for a frame before the gate appears.
        mustSetupCredentials: !!user.mustSetupCredentials,
      }
    };
  }

  /**
   * Trust-wave D (2026-08-06) — POST /auth/refresh body. Trades a STILL-VALID
   * session token for a fresh one of the same class (sliding-with-cap).
   *
   * `currentToken` MUST already have passed JwtAuthGuard on this request —
   * signature, expiry, `jwt_revoked_list`, and the per-user invalid-before
   * epoch were all verified there, so an expired or revoked token can never
   * reach this method (refresh cannot resurrect a revoked session). The
   * decode below is claims-reading only, never trust-establishing.
   *
   * Everything minted here comes from the LIVE user row, not the old token —
   * a role downgrade or a canTriggerPanic revocation lands at the next
   * refresh instead of riding the stale claim until natural expiry, which
   * NARROWS the known role-staleness gap (Standard Audit Surface §10).
   */
  async refreshSession(userId: string, currentToken: string) {
    const payload = (this.jwtService.decode(currentToken) ?? {}) as Record<string, any>;
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = typeof payload.iat === 'number' ? payload.iat : nowSec;
    const exp = typeof payload.exp === 'number' ? payload.exp : null;

    // Token class: the explicit `rm` claim (login stamps it on rememberMe
    // mints). Tokens minted before the claim existed fall back to lifetime
    // inference — 1h session vs 30d rememberMe, so anything living past the
    // 12h session window is unambiguously the rememberMe class.
    const rememberClass =
      payload.rm === true || (exp !== null && exp - iat > REFRESH_WINDOW_SESSION_SEC);

    // Anchor: the original login. Pre-claim tokens and the secondary mint
    // paths (MFA challenge trade-in predates origIat only in old sessions;
    // change-password + tenant-switch don't stamp it) anchor at their own
    // iat — the first refresh then carries that anchor down the chain.
    const origIat = typeof payload.origIat === 'number' ? payload.origIat : iat;

    // Sliding-with-cap, checked BEFORE any DB work (cheap-first). The 60s
    // floor mirrors ACC-07: never hand back an already-(nearly-)dead token.
    const windowSec = rememberClass ? REFRESH_WINDOW_REMEMBER_SEC : REFRESH_WINDOW_SESSION_SEC;
    const remainingSec = origIat + windowSec - nowSec;
    if (remainingSec < 60) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_WINDOW_EXCEEDED',
        message: 'Session is past its refresh window. Please log in again.',
      });
    }

    // Tail guard — refuse a NO-GAIN refresh. Once a token's `exp` already
    // sits at (or within 60s of) everything a re-mint could grant, refreshing
    // extends nothing: the LAST mint of a session dies at the cap by design.
    // Without this, a busy console burns a refresh round-trip + an AuditLog
    // row on every response through the window's final minutes (the client
    // sees exp<15min forever). Also covers legacy login-minted rememberMe
    // tokens, whose exp IS the cap. Same code as the window refusal — to the
    // client both mean "this session ends where it ends"; the 401
    // session-expired path owns the actual end.
    const classTtlSec = rememberClass ? REMEMBER_TOKEN_TTL_SEC : SESSION_TOKEN_TTL_SEC;
    const newExpSec = Math.min(nowSec + classTtlSec, origIat + windowSec);
    if (exp !== null && newExpSec - exp < 60) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_WINDOW_EXCEEDED',
        message: 'Session is past its refresh window. Please log in again.',
      });
    }

    // Re-validate against the LIVE row — refresh must never extend a session
    // for an account that was deleted, disabled, or whose tenant was retired
    // since login. Same gates as validateUser (deletedAt / non-ACTIVE status /
    // ACC-05 archived tenant), minus the password it doesn't have.
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { tenant: { select: { slug: true, vertical: true, name: true, archivedAt: true } } },
    });
    const u = user as any;
    if (!u || u.deletedAt || (u.status && u.status !== 'ACTIVE') || u.tenant?.archivedAt) {
      // One opaque code for all four states — no account-state oracle.
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_INVALID_SESSION',
        message: 'Session can no longer be refreshed. Please log in again.',
      });
    }

    // A token minted by the workspace-switch path (tenants.controller
    // switchTenant) carries the TARGET tenant's id — a scope the live user
    // row does not describe. Re-minting from the row would silently flip the
    // acting tenant back to home mid-session (API scope diverging from the
    // workspace the operator is looking at), and ACC-07 deliberately pinned a
    // switched session's lifetime to the token that authorized it. Refuse
    // instead: the switched token stays exactly as valid as it was — it just
    // doesn't slide (status quo for switched sessions; the operator
    // re-switches after their next login).
    if (typeof payload.tenantId === 'string' && payload.tenantId !== u.tenantId) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_SCOPE_CHANGED',
        message:
          'A switched-workspace session cannot be refreshed. It stays valid until it expires.',
      });
    }

    const newPayload = {
      sub: u.id,
      email: u.email,
      tenantId: u.tenantId,
      role: u.role,
      canTriggerPanic: !!u.canTriggerPanic,
      origIat,
      // FIRST-LOGIN CREDENTIAL SETUP — re-read from the LIVE row like every
      // other claim here, so a flag set (or cleared) since login lands at the
      // next refresh rather than riding the stale claim to expiry.
      msc: !!u.mustSetupCredentials,
      ...(rememberClass ? { rm: true } : {}),
    };
    return {
      access_token: this.jwtService.sign(newPayload, {
        // Same class as the token being refreshed, clamped so `exp` never
        // lands past the window — the LAST mint of a session dies exactly at
        // origIat + 12h (or + 30d), not one class-lifetime beyond it.
        // (`newExpSec - nowSec` ≡ min(class TTL, remaining window).)
        expiresIn: newExpSec - nowSec,
      }),
      rememberClass,
      // Mirrors the login response's user shape (auth.controller returns it
      // verbatim so the client can keep its stored user coherent).
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        tenantId: u.tenantId,
        tenantSlug: u.tenant?.slug || u.tenantId,
        tenantName: u.tenant?.name || null,
        tenantVertical: u.tenant?.vertical || 'K12',
        canTriggerPanic: u.canTriggerPanic,
        mustSetupCredentials: !!u.mustSetupCredentials,
      },
    };
  }
}
