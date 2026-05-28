import { Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { LoginInputSchema, type LoginInput } from '@cms/api-types';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';

@Controller('api/v1/auth')
export class AuthController {
  private readonly authLogger = new Logger('AuthController');

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
   * account we look the tenant up so the row lands on the right tenant;
   * on a failed attempt against an unknown email there is no tenant to
   * attribute it to, so we log the miss to stdout (warn) and skip the
   * row rather than fabricate a tenant and pollute someone else's trail.
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
    const details = JSON.stringify({ ip, ua, emailHash, ...extra });

    if (!resolvedTenantId) {
      // No tenant to attribute the row to (unknown email on a failed
      // login). Audit to stdout so the attempt is still recorded
      // somewhere queryable in logs; can't write a NOT-NULL-tenant row.
      this.authLogger.warn(
        `AUTH_LOGIN_FAILED for unknown account — no tenant to attribute AuditLog row. ${details}`,
      );
      return;
    }

    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: resolvedTenantId,
          userId: null, // not the actor's own action; identified via emailHash
          action,
          targetType: 'User',
          targetId: null,
          details,
        },
      });
    } catch (e: any) {
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
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: user?.tenantId || user?.schoolId || user?.districtId || null,
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
    return { success: true };
  }
}
