import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { cryptoPlatformConfig } from './crypto.config';
import { issueMfaChallengeToken } from './mfa-challenge-token';
import { evaluateMfaPolicy, mfaPolicyNotice, type MfaPolicyDecision } from './mfa-policy';
import { tenantMfaEnforced } from './tenant-mfa-enforcement';

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
/**
 * SEC-010 (2026-09-05) — the rememberMe ACCESS token is 1h, same as every
 * other one. It used to be 30 DAYS, which is the whole of the audit finding
 * "the remembered bearer remains JS-readable for up to 30 days": the token
 * the dashboard hands to `Authorization:` is by definition readable by page
 * JavaScript, so its lifetime IS the value of a stolen page context.
 *
 * What did NOT change: `REFRESH_WINDOW_REMEMBER_SEC` below. A remembered
 * session still lives 30 days from the credential check — it just does so as
 * a chain of 1-hour access tokens, renewed either by the Bearer sliding path
 * here or, once the browser has been closed longer than an hour, by the
 * HttpOnly refresh cookie (`session.controller.ts`). Same UX, 1/720th of the
 * exposure.
 */
const REMEMBER_TOKEN_TTL_SEC = SESSION_TOKEN_TTL_SEC;

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

/**
 * SEC-008 — the two ways a caller may legitimately hand back a full session
 * without re-running the MFA policy gate. Both are narrow, and neither is a
 * general "skip MFA" switch: `login` still evaluates the policy either way,
 * it just does not BLOCK on it.
 */
export interface LoginOptions {
  /**
   * The caller has ALREADY verified a second factor for this user inside
   * this same request — MfaController's `/challenge` (TOTP or backup code)
   * and `/required/verify` (enrollment just completed). Without this, those
   * paths hand `login` a curated user object with no `mfa*` fields, the
   * SEC-008 policy re-derives "required" from the ROLE, and the user is
   * challenged again forever.
   */
  mfaAlreadySatisfied?: boolean;
  /**
   * ACCOUNT-CREATION paths only: `OnboardingService.signup` (new tenant +
   * its first DISTRICT_ADMIN) and `acceptInvite` (an invited user setting
   * their password from an emailed, single-use token). Both mint the FIRST
   * session at the instant the account comes into existence, and both are
   * consumed by a web client that expects an `access_token` and has no
   * enrollment UI on that screen.
   *
   * The bounded cost, stated plainly: such a session is minted WITHOUT
   * `rememberMe`, so it dies in 1 hour, and the account's NEXT login goes
   * through the gate like everyone else. It is a one-hour window on a
   * brand-new account, not an exemption for the identity.
   */
  skipPolicyGate?: boolean;
}
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
    // SEC-010 — `rememberMe` used to be accepted here and meant "sign a
    // 30-day token". No caller ever passed it (change-password and
    // complete-setup both omit it), and the option is gone rather than left
    // as a live 30-day switch a future caller could flip by accident.
    // Durability is the HttpOnly refresh cookie now, never the access token.
    opts: { iatSeconds: number },
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
      // SEC-010 — `rememberMe` no longer buys a longer ACCESS token. It marks
      // the class (`rm`), and durability comes from the HttpOnly refresh
      // cookie. Every token this method signs dies in an hour.
      undefined,
    );
  }

  /**
   * ONE tenant read that serves BOTH the session payload (slug / vertical /
   * name for URL routing + vertical-aware copy) and the MFA policy column.
   *
   * `mfaEnforced` rides in this select rather than in a second query so the
   * gate costs nothing extra on the auth hot path — and because
   * `tenantMfaEnforced()` takes a row whose `mfaEnforced` key is REQUIRED, a
   * future edit that trims this select fails `tsc` instead of silently
   * downgrading every login to "this tenant does not enforce".
   *
   * Returns null on a missing tenant or a thrown query; both fail CLOSED at
   * `tenantMfaEnforced`.
   */
  private async loadTenantForSession(tenantId: string | null | undefined) {
    if (!tenantId) return null;
    try {
      // ten-ok: the id IS the tenant scope — resolving the acting tenant's own row.
      return await this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { slug: true, vertical: true, name: true, mfaEnforced: true },
      });
    } catch {
      return null;
    }
  }

  /**
   * The MFA decision for a user, tenant policy included — for callers that
   * need it OUTSIDE a session mint. Today that is exactly one: the
   * `AUTH_LOGIN_SUCCESS` audit row in AuthController, which records WHY the
   * policy did or did not hold.
   *
   * It re-reads the tenant rather than accepting a pre-computed decision on
   * purpose. A caller-supplied decision is a caller-supplied authorization,
   * and the cost here is one indexed primary-key lookup on a path that runs
   * once per sign-in. Never make this an argument to `login`.
   */
  async mfaPolicyForUser(user: any): Promise<MfaPolicyDecision> {
    const tenant = await this.loadTenantForSession(user?.tenantId);
    return evaluateMfaPolicy(user, { tenantEnforced: tenantMfaEnforced(tenant) });
  }

  async login(user: any, rememberMe?: boolean, opts: LoginOptions = {}) {
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
    //
    // `mfaAlreadySatisfied` is how MfaController finalizes a login it has
    // ALREADY second-factored in this same request. Without it, the
    // curated user object those paths pass (deliberately carrying no
    // `mfa*` fields) would fall straight through into the SEC-008 policy
    // gate below — which reads ROLE, not just the columns — and challenge
    // the user again. That is an infinite challenge→verify→challenge loop,
    // and it is the single most dangerous edge in this file.
    if (!opts.mfaAlreadySatisfied && user?.mfaTotpVerifiedAt) {
      return {
        mfaRequired: true,
        mfaToken: issueMfaChallengeToken(this.jwtService, user.id, rememberMe),
      };
    }

    // ── ACC-03 (2026-08-01) / SEC-008 (2026-09-04) — MFA POLICY GATE ──────
    // ACC-03 turned `User.mfaRequired` from a dead column into a real
    // control: if it is set and the user has NOT completed TOTP enrollment,
    // password alone does NOT produce a session. They get a short-lived
    // challenge token flagged `mfaEnrollmentRequired` and must finish
    // enrollment through POST /auth/mfa/required/{enroll,verify} — which
    // returns the real session on success. Enrollment is reachable WITHOUT a
    // session precisely so a required-MFA user is never locked out (they
    // cannot call the session-gated /enroll to get in).
    //
    // SEC-008 found the gap that left: the column was only ever set one
    // account at a time, so no privileged or panic-capable identity was
    // actually covered. `evaluateMfaPolicy` now derives the requirement from
    // the live row — privileged role OR `canTriggerPanic` OR the explicit
    // per-user override — with a dated grace window for the derived half so
    // switching it on does not meet every live admin with a wall. See
    // mfa-policy.ts for the full rationale; it is the ONLY place that
    // decides, and MfaController.assertEnrollmentRequired reads the same
    // function so "no session" and "may enrol" can never disagree.
    //
    // `skipPolicyGate` is for the two account-CREATION paths (signup and
    // invite-accept) that mint the first session at the moment the account
    // comes into existence — see LoginOptions.
    //
    // SSO is deliberately exempt — the IdP is the authenticator there. That
    // decision and its obligations are recorded on SsoService.completeSsoLogin.
    //
    // ── PER-TENANT ENFORCEMENT (2026-09-11) — AND THE ORDERING TRAP ──────
    // The tenant row used to load THIRTEEN LINES BELOW this gate, purely for
    // slug/vertical/name. Adding `mfaEnforced` to that select and leaving it
    // where it was would have produced a policy input that arrives AFTER the
    // decision it governs. Worse: `validateUser` strips the joined tenant off
    // the user object (`const { passwordHash, tenant, ...result }`), so there
    // is nothing on `user` to read either. So the read MOVED above the gate
    // and now serves both purposes — one query, no extra round trip, and the
    // policy cannot be decided before its input exists.
    const tenant = await this.loadTenantForSession(user?.tenantId);
    const mfaDecision = evaluateMfaPolicy(user, { tenantEnforced: tenantMfaEnforced(tenant) });
    if (!opts.mfaAlreadySatisfied && !opts.skipPolicyGate && mfaDecision.blocking) {
      return {
        mfaRequired: true,
        mfaEnrollmentRequired: true,
        mfaToken: issueMfaChallengeToken(this.jwtService, user.id, rememberMe),
      };
    }

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
      // SEC-010 (2026-09-05) — ONE HOUR, ALWAYS, rememberMe or not.
      //
      // History: 365d → 30d (still far too long) → 1h. The audit finding was
      // exact — "the remembered bearer remains JS-readable for up to 30 days"
      // — because this token is the thing the dashboard puts in an
      // `Authorization:` header, which means page JavaScript can read it, and
      // its `expiresIn` was the entire value of a stolen page context.
      //
      // rememberMe still means 30 days of staying signed in. It is now
      // delivered as a chain of hour-long tokens: while the tab is open, the
      // Bearer sliding path (POST /auth/refresh) renews within
      // REFRESH_WINDOW_REMEMBER_SEC; once the browser has been shut longer
      // than an hour, the HttpOnly, first-party, single-use refresh cookie
      // does it (POST /auth/session/refresh). Neither the cookie nor its
      // contents are reachable from page JavaScript.
      access_token: this.jwtService.sign(payload),
      // SEC-008 grace window. Present ONLY while a privileged / panic-capable
      // user still has runway before enrollment becomes blocking, so the
      // dashboard can show a banner with a REAL date instead of "soon".
      // Additive and absent in every other case — no existing client field
      // changes shape, and a client that ignores it behaves exactly as before.
      ...(mfaPolicyNotice(mfaDecision) ? { mfaPolicy: mfaPolicyNotice(mfaDecision) } : {}),
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
      include: {
        tenant: {
          // `mfaEnforced` (2026-09-11) rides the join the refresh path already
          // makes. It MUST stay in this select: `tenantMfaEnforced()` below
          // takes a row whose `mfaEnforced` key is required, so dropping it
          // breaks the build rather than quietly extending the sessions of
          // non-compliant admins in an enforcing tenant.
          select: { slug: true, vertical: true, name: true, archivedAt: true, mfaEnforced: true },
        },
      },
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

    // ── SEC-008 — refresh must not EXTEND a non-compliant privileged session ──
    // The policy's enforcement point is session ISSUANCE (login), so sessions
    // that predate the deadline keep running. This is the second checkpoint
    // that BOUNDS them: once the deadline passes, a privileged or panic-capable
    // user who never enrolled stops sliding and their current token drains to
    // its own `exp` (≤12h session / ≤30d rememberMe) instead of being renewed
    // indefinitely. Evaluated against the LIVE row like every other claim here,
    // so a role PROMOTION also lands at the next refresh.
    //
    // The 401 is what the client already does on any refresh refusal: send the
    // user to /login — where the enrollment challenge is waiting. That is the
    // whole recovery path, and it needs no new client code.
    //
    // Evaluated against `user.tenant` — the TYPED join above, deliberately not
    // the `u` alias, which is `as any` and would silently accept a row that
    // never selected the column.
    const refreshMfaDecision = evaluateMfaPolicy(u, {
      tenantEnforced: tenantMfaEnforced(user?.tenant),
    });
    if (refreshMfaDecision.blocking) {
      throw new UnauthorizedException({
        code: 'AUTH_MFA_ENROLLMENT_REQUIRED',
        message:
          'Two-factor authentication is now required for this account. ' +
          'Please sign in again to finish setting it up.',
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
