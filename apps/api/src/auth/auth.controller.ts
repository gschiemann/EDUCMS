import { Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { LoginInputSchema, type LoginInput } from '@cms/api-types';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TENANT_ID, ensureSystemTenant } from '../security/system-tenant';
import type { Request } from 'express';

@Controller('api/v1/auth')
export class AuthController {
  private readonly authLogger = new Logger('AuthController');
  /** One-shot guard: the sentinel "system" tenant row only needs to be
   *  ensured once per process. After the first successful upsert we skip
   *  the round-trip on every subsequent unknown-email failed login. */
  private systemTenantEnsured = false;

  constructor(
    private authService: AuthService,
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  // Per-IP rate limit: 10 attempts per minute. argon2's cost slows brute
  // force but doesn't stop it; without a per-IP gate, credential stuffing
  // against a leaked email list runs unbounded. Matches signup's pattern
  // (5/min) but a touch looser since legitimate users sometimes mistype
  // their password 3-4 times before resetting. The global 600/min default
  // throttle covers nothing for credential attacks because attackers
  // rotate IPs; this PER-IP one is the real defense.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(
    // Bounded shape — email is format-checked + length-capped (max 254
    // per RFC 5321), password length-capped (max 256). Pre-Zod the
    // body was `Record<string, any>`, which let a 10MB string reach
    // argon2.verify() and DoS the request thread for ~30s.
    @Body(new ZodValidationPipe(LoginInputSchema)) body: LoginInput,
    @Req() req: Request,
  ) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      // P0-4 (2026-05-28) — credential check failed. Audit it for
      // forensics (credential stuffing: when, from which IP, against
      // which accounts). The throttler counter alone doesn't survive a
      // restart and isn't queryable per-account.
      await this.auditLoginAttempt(req, body.email, null, 'AUTH_LOGIN_FAILED', {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    const result = await this.authService.login(user, body.rememberMe);
    // P0-4 — credential check passed. `result` may be an MFA challenge
    // envelope (mfaRequired) rather than a full session; either way the
    // password proved out, so this is the success-of-credentials event.
    // The subsequent MFA step is audited separately in mfa.controller
    // (mfa.challenge_succeeded). We have the real user here, so the
    // tenant attribution is exact.
    await this.auditLoginAttempt(req, user.email, user.tenantId, 'AUTH_LOGIN_SUCCESS', {
      mfaRequired: !!(result as any)?.mfaRequired,
    });
    return result;
  }

  /**
   * P0-4 (2026-05-28) — write a login attempt to the immutable AuditLog.
   * Best-effort (a DB hiccup must never block or fail the login), but
   * NOT silent: failures are logged at warn so a broken audit path is
   * visible instead of masquerading as success — the lesson from the
   * 2026-05-21 safeguard-theater incident.
   *
   * `AuditLog.tenantId` is NOT NULL. On a FAILED attempt against a real
   * account we look the tenant up so the row lands on the right tenant.
   * On a failed attempt against an **unknown email** there is no natural
   * tenant — but credential-stuffing recon against non-existent accounts
   * is exactly the signal a SOC wants queryable in the durable trail, so
   * we attribute it to the dedicated sentinel `SYSTEM_TENANT_ID` (the row
   * carries `unknownAccount: true` in `details` so it's unmistakable and
   * never pollutes a real tenant's trail). The sentinel tenant row is
   * ensured idempotently here so the FK insert always lands.
   */
  private async auditLoginAttempt(
    req: Request,
    email: string,
    tenantId: string | null,
    action: 'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_FAILED',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    // Resolve a real tenant for the FAILED-against-real-account case.
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId && action === 'AUTH_LOGIN_FAILED') {
      resolvedTenantId = await this.authService.tenantIdForEmail(email);
    }

    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip ||
      null;
    const ua = ((req.headers['user-agent'] as string | undefined) || '').slice(0, 256);
    // Don't store the raw email in `details` (PII); a SHA-256 prefix is
    // enough to correlate repeated attempts against the same account
    // across rows without persisting the address in cleartext.
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);

    // Unknown email on a failed login → no natural tenant. Attribute the
    // row to the sentinel "system" tenant so the recon attempt IS in the
    // durable, queryable trail (not just stdout, which doesn't survive a
    // restart and isn't queryable per-account). `unknownAccount` flags it
    // so forensics never confuse it with a real-tenant event.
    const unknownAccount = !resolvedTenantId;
    // After this, the tenant is always defined: a real tenant for a known
    // account, or the sentinel for an unknown one. (`resolvedTenantId` stays
    // `string | null` to TS, so pin the final value in a non-null const.)
    const auditTenantId: string = unknownAccount ? SYSTEM_TENANT_ID : (resolvedTenantId as string);

    const details = JSON.stringify({ ip, ua, emailHash, unknownAccount, ...extra });

    try {
      // Ensure the sentinel tenant exists before the FK insert. One-shot
      // per process for known-email rows it's never needed; for the
      // unknown-email path it's a cheap idempotent upsert that becomes a
      // no-op after the first call.
      if (unknownAccount && !this.systemTenantEnsured) {
        await ensureSystemTenant(this.prisma.client);
        this.systemTenantEnsured = true;
      }
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: auditTenantId,
          userId: null, // not the actor's own action; identified via emailHash
          action,
          targetType: 'User',
          targetId: null,
          details,
        },
      });
    } catch (e: any) {
      // Best-effort — a DB hiccup must never block or fail the login. NOT
      // silent: warn so a broken audit path is visible (2026-05-21 lesson)
      // instead of masquerading as success.
      this.authLogger.warn(`auditLoginAttempt(${action}) failed: ${e?.message ?? e}`);
    }
  }

  /**
   * Server-side logout: revokes the bearer token by adding it to the Redis
   * revocation set, so JwtAuthGuard rejects it on the next request. Lane-1
   * P0 fix — previously "logout" was a pure client-side cookie clear and
   * the JWT remained valid for up to 30 days (rememberMe ceiling) even
   * after the user clicked "Log out."
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request) {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('No bearer token');
    }
    const user = (req as any).user;
    const pub = this.redisService.publisher;
    // Lane-1 P2 fix: Redis is the ONLY revocation store. If it's unreachable
    // we cannot honor the logout — return 503 instead of pretending success.
    // Pairs with jwt-auth.guard.ts which now fails CLOSED on Redis errors.
    if (!pub) {
      throw new HttpException(
        'Revocation service unavailable; try again',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      await pub.sadd('jwt_revoked_list', token);
      // 30 days = rememberMe ceiling — the JWT itself expires by then, so the
      // set never grows unboundedly. Resets each logout (acceptable).
      await pub.expire('jwt_revoked_list', 60 * 60 * 24 * 30);
    } catch {
      throw new HttpException(
        'Revocation service unavailable; try again',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // Lane-1 P2 fix: AuditLog every logout for incident forensics
    // ("when did the attacker burn the session?"). Best-effort — never
    // fail the logout if the audit row fails.
    //
    // `AuditLog.tenantId` is NOT NULL. A normal user JWT always carries
    // tenantId, but an unusual token state (e.g. an api-key/device
    // identity reaching here) can resolve to null — that `create` would
    // be guaranteed to throw on the FK/not-null. Guard it: skip the audit
    // row rather than fire a write we know can't land. The token
    // revocation above already happened, so the logout is still honored.
    const auditTenantId = user?.tenantId || user?.schoolId || user?.districtId || null;
    if (auditTenantId) {
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: auditTenantId,
            userId: user?.userId || user?.id || null,
            action: 'AUTH_LOGOUT',
            targetType: 'User',
            targetId: user?.userId || user?.id || null,
            details: JSON.stringify({
              ip: req.ip || req.headers['x-forwarded-for'] || null,
              ua: (req.headers['user-agent'] || '').slice(0, 256),
            }),
          },
        });
      } catch { /* best-effort */ }
    }
    return { success: true };
  }
}
