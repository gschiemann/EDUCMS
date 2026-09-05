import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MAX_FAMILY_LIFETIME_SEC, SessionRefreshService } from './session-refresh.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { clientIpFromRequest } from '../security/client-ip';
import { evaluateMfaPolicy } from './mfa-policy';

/**
 * SEC-010 (2026-09-05) — HttpOnly refresh-credential endpoints.
 *
 * ── WHO CALLS THESE ──────────────────────────────────────────────────────
 * Not the browser. The dashboard talks to its OWN origin
 * (`apps/web/src/app/api/session/*`, Next route handlers), and those handlers
 * call these endpoints server-to-server. That indirection is not decoration:
 *
 *   • the web app is on `venue-os.app`, the API on a Railway host. A cookie
 *     the API sets is CROSS-SITE, and Safari's ITP drops cross-site cookies
 *     outright — the deploy already lives with that for `csrf-token` (see
 *     csrf.middleware.ts's Bearer bypass, which exists BECAUSE the cookie
 *     gets dropped). A design that only holds in Chrome is not shippable
 *     here; the cookie has to be first-party to the web origin.
 *   • keeping the refresh secret on the server side of the web origin is what
 *     makes it unreachable from page JavaScript, which is the whole finding.
 *
 * ── CSRF ─────────────────────────────────────────────────────────────────
 * `/refresh` and `/revoke` carry NO ambient credential: the refresh secret
 * arrives in the BODY, from a server, over a connection with no cookie jar.
 * CSRF's threat model (a browser attaching a credential it holds, to a
 * request the attacker composed) does not reach them, which is why they are
 * on the CSRF exempt list — the same argument as `/password-reset/complete`
 * and the device endpoints. The browser-facing CSRF boundary is the WEB
 * route handler, which requires a same-origin `Origin` header AND a custom
 * header a cross-site form post cannot set. See `apps/web/src/lib/session-bff.ts`.
 *
 * ── WHAT A STOLEN REFRESH TOKEN BUYS ─────────────────────────────────────
 * One use. It is single-use and rotating, so the first time the thief spends
 * it the legitimate client's next refresh is a REPLAY, which revokes the
 * whole family and logs the user out. Theft is not free and not quiet.
 */

const RefreshBodySchema = z.object({ refresh_token: z.string().min(24).max(512) }).strict();
type RefreshBody = z.infer<typeof RefreshBodySchema>;

/**
 * Optional shared secret proving the caller is the web origin's SERVER, not a
 * browser holding a stolen access token.
 *
 * SUBTRACTIVE BY DESIGN, exactly like `GATEWAY_SHARED_SECRET` and
 * `PLAYER_APK_STORAGE_REDIRECT`: when it is UNSET the endpoints behave as if
 * the check did not exist, so a half-configured deploy degrades to today's
 * posture (an XSS with a live access token can mint a durable credential —
 * which is strictly no worse than today, where it simply STEALS a 30-day
 * one) instead of locking every remembered operator out. When it is SET on
 * both services, an XSS cannot mint at all. Never let a missing env var be
 * the thing that signs the fleet out.
 */
function bffSecret(): string | null {
  const raw = process.env.SESSION_BFF_SECRET;
  return typeof raw === 'string' && raw.length >= 16 ? raw : null;
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export const BFF_SECRET_HEADER = 'x-venueos-session-bff';

@Controller('api/v1/auth/session')
export class SessionController {
  private readonly logger = new Logger('SessionController');
  private warnedNoSecret = false;

  constructor(
    private readonly sessions: SessionRefreshService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private assertBffCaller(req: Request): void {
    const configured = bffSecret();
    if (!configured) {
      if (!this.warnedNoSecret) {
        this.warnedNoSecret = true;
        this.logger.warn(
          'SESSION_BFF_SECRET is not set — /auth/session/* accepts any caller that ' +
            'already holds a valid credential. Set the same value on the web and API ' +
            'services to bind these endpoints to the web origin server.',
        );
      }
      return;
    }
    const raw = req.headers[BFF_SECRET_HEADER];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (typeof presented !== 'string' || !safeEquals(presented, configured)) {
      throw new ForbiddenException({
        code: 'SESSION_BFF_UNAUTHORIZED',
        message: 'This endpoint is only callable by the web origin server.',
      });
    }
  }

  /**
   * Open a durable family for the session whose access token authorizes this
   * request. Only a REMEMBER-CLASS session (`rm` claim) qualifies: a plain
   * session's semantics — per-tab, gone when the tab closes — are unchanged
   * by SEC-010, and handing it a 30-day cookie would silently upgrade it.
   */
  @Post('issue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async issue(@Req() req: Request) {
    this.assertBffCaller(req);

    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException({ code: 'AUTH_NO_BEARER_TOKEN', message: 'No bearer token' });
    }
    const actor = (req as any).user;
    const userId: string | undefined = actor?.userId || actor?.id;
    // Machine identities have their own credential lifecycles (CLAUDE.md
    // player rules 1-3). They never get a browser session cookie.
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({
        code: 'SESSION_ISSUE_NOT_APPLICABLE',
        message: 'Only a signed-in user session can be made durable.',
      });
    }

    const payload = (this.jwtService.decode(token) ?? {}) as Record<string, any>;
    if (payload.rm !== true) {
      throw new ForbiddenException({
        code: 'SESSION_NOT_REMEMBERED',
        message: 'This session did not opt into staying signed in.',
      });
    }
    // A switched-workspace token describes a scope the live user row does
    // not — the Bearer refresh path already refuses to slide one
    // (AUTH_REFRESH_SCOPE_CHANGED), and a cookie that outlived the tab would
    // be a second way around that decision.
    if (typeof payload.tenantId === 'string' && typeof actor?.tenantId === 'string' && payload.sub) {
      const live = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });
      if (live && live.tenantId !== payload.tenantId) {
        throw new ForbiddenException({
          code: 'SESSION_SCOPE_CHANGED',
          message: 'A switched-workspace session cannot be made durable.',
        });
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const origIat = typeof payload.origIat === 'number' ? payload.origIat : nowSec;
    const issued = await this.sessions.issueFamily(userId, origIat, {
      userAgent: (req.headers['user-agent'] as string) || null,
      ipAddress: clientIpFromRequest(req),
    });
    if (!issued) {
      throw new ForbiddenException({
        code: 'SESSION_WINDOW_EXCEEDED',
        message: 'This session is past its 30-day window.',
      });
    }
    return { refresh_token: issued.token, expires_at: issued.expiresAt.toISOString() };
  }

  /**
   * Spend a refresh token; get back a fresh <=1h access token AND the
   * rotated refresh token that replaces it.
   *
   * NO `JwtAuthGuard` on purpose — by the time this is called the access
   * token is expired (or was never in this browser at all, e.g. the operator
   * reopened the PWA the next morning). The refresh token IS the credential.
   * Everything the guard would have checked is re-checked here against LIVE
   * state: revocation epoch, account status, tenant archive, MFA policy.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  // Generous for a real client (one refresh per hour of use, plus one per
  // cold start) and useless as a mint loop.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async refresh(
    @Body(new ZodValidationPipe(RefreshBodySchema)) body: RefreshBody,
    @Req() req: Request,
  ) {
    this.assertBffCaller(req);

    const meta = {
      userAgent: (req.headers['user-agent'] as string) || null,
      ipAddress: clientIpFromRequest(req),
    };
    const rotated = await this.sessions.rotate(body.refresh_token, meta);
    if (!rotated.ok) {
      if (rotated.reason === 'reused') {
        // Audited, not just logged: a replayed refresh token is the one
        // signal that distinguishes "session expired" from "someone else has
        // your cookie", and the operator's incident timeline needs the row.
        await this.auditReuse(body.refresh_token, meta);
      }
      throw new UnauthorizedException({
        code: 'SESSION_REFRESH_REJECTED',
        message: 'Your saved sign-in is no longer valid. Please sign in again.',
      });
    }

    // ── Re-validate against LIVE state, in the same order the Bearer
    //    refresh path does. A cookie must never be a way around a revocation
    //    that already happened.
    let invalidBefore: number | null = null;
    try {
      invalidBefore = await this.redisService.getTokenInvalidBefore(rotated.userId);
    } catch {
      // Both revocation stores unreachable. We cannot prove this session was
      // not revoked, so we do not mint. 503, not 401: the client must retry,
      // not tear the session down (the same posture JwtAuthGuard takes).
      throw new ServiceUnavailableException({
        code: 'AUTH_REVOCATION_UNAVAILABLE',
        message: 'Auth check unavailable; please retry',
      });
    }
    if (invalidBefore != null && rotated.origIat < invalidBefore) {
      await this.sessions.revokeFamily(rotated.familyId, 'user-invalid-before');
      throw new UnauthorizedException({
        code: 'SESSION_REFRESH_REJECTED',
        message: 'Your saved sign-in is no longer valid. Please sign in again.',
      });
    }

    // ten-ok: identity SELF-lookup — id comes from the refresh row, which is
    // the authenticated principal for this request.
    const u = (await this.prisma.client.user.findUnique({
      where: { id: rotated.userId },
      include: { tenant: { select: { slug: true, vertical: true, name: true, archivedAt: true } } },
    })) as any;
    if (!u || u.deletedAt || (u.status && u.status !== 'ACTIVE') || u.tenant?.archivedAt) {
      await this.sessions.revokeFamily(rotated.familyId, 'account-not-refreshable');
      throw new UnauthorizedException({
        code: 'SESSION_REFRESH_REJECTED',
        message: 'Your saved sign-in is no longer valid. Please sign in again.',
      });
    }
    // SEC-008 — a cookie must not extend a non-compliant privileged session
    // any more than the Bearer refresh path may. Same live evaluation.
    if (evaluateMfaPolicy(u).blocking) {
      await this.sessions.revokeFamily(rotated.familyId, 'mfa-enrollment-required');
      throw new UnauthorizedException({
        code: 'AUTH_MFA_ENROLLMENT_REQUIRED',
        message:
          'Two-factor authentication is now required for this account. ' +
          'Please sign in again to finish setting it up.',
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = rotated.origIat + MAX_FAMILY_LIFETIME_SEC - nowSec;
    if (remainingSec < 60) {
      await this.sessions.revokeFamily(rotated.familyId, 'window-exceeded');
      throw new UnauthorizedException({
        code: 'SESSION_REFRESH_REJECTED',
        message: 'Your saved sign-in has expired. Please sign in again.',
      });
    }

    const access_token = this.jwtService.sign(
      {
        sub: u.id,
        email: u.email,
        tenantId: u.tenantId,
        role: u.role,
        canTriggerPanic: !!u.canTriggerPanic,
        origIat: rotated.origIat,
        msc: !!u.mustSetupCredentials,
        // Still the remember class — the Bearer sliding path stays available
        // to this token and stays capped at origIat + 30d, unchanged.
        rm: true,
      },
      // Never longer than an hour, and never past the family ceiling.
      { expiresIn: Math.min(60 * 60, remainingSec) },
    );

    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: u.tenantId,
          userId: u.id,
          action: 'AUTH_SESSION_COOKIE_REFRESH',
          targetType: 'User',
          targetId: u.id,
          details: JSON.stringify({ ip: meta.ipAddress, familyId: rotated.familyId }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(AUTH_SESSION_COOKIE_REFRESH) failed: ${e?.message ?? e}`);
    }

    return {
      access_token,
      refresh_token: rotated.token,
      expires_at: rotated.expiresAt.toISOString(),
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

  /**
   * Sign-out for the durable half. Deliberately forgiving: presenting an
   * already-spent or already-revoked token is NORMAL here (log out twice,
   * log out from a tab whose cookie the last refresh replaced) and must not
   * be graded as an attack — so this does not go through `rotate`.
   */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async revoke(
    @Body(new ZodValidationPipe(RefreshBodySchema)) body: RefreshBody,
    @Req() req: Request,
  ) {
    this.assertBffCaller(req);
    await this.sessions.revokeByPresentedToken(body.refresh_token);
    // Always success: the caller has already cleared the cookie, and telling
    // an anonymous caller whether a token existed is a free oracle.
    return { success: true };
  }

  /** Best-effort forensic row for a replayed refresh token. */
  private async auditReuse(
    presented: string,
    meta: { ipAddress: string | null; userAgent: string | null },
  ): Promise<void> {
    const familyId = presented.split('.')[0] || null;
    if (!familyId) return;
    try {
      const row = await this.prisma.client.sessionRefreshToken.findFirst({
        where: { familyId },
        select: { userId: true },
      });
      if (!row) return;
      const user = await this.prisma.client.user.findUnique({
        where: { id: row.userId },
        select: { tenantId: true },
      });
      if (!user) return;
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: user.tenantId,
          userId: row.userId,
          action: 'AUTH_SESSION_REFRESH_REUSE',
          targetType: 'User',
          targetId: row.userId,
          details: JSON.stringify({
            familyId,
            ip: meta.ipAddress,
            ua: (meta.userAgent || '').slice(0, 256),
            note: 'Refresh token replayed — entire session family revoked.',
          }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(AUTH_SESSION_REFRESH_REUSE) failed: ${e?.message ?? e}`);
    }
  }
}
