import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Request } from 'express';
import { Id, OverrideIncidentType, TriggerEmergencyInputSchema } from '@cms/api-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { evaluateMfaPolicy } from '../../auth/mfa-policy';
import { tenantMfaEnforced } from '../../auth/tenant-mfa-enforcement';
import { PrismaService } from '../../prisma/prisma.service';
import { ZodValidationPipe } from '../../security/zod-validation.pipe';
import { EmergencyController } from '../emergency.controller';
import {
  PANIC_RATE_LIMITS,
  deviceLabelFromUserAgent,
  enrollmentRefusal,
  panicDevicesDisabled,
  type PanicRoute,
} from './panic-device.policy';
import { PANIC_AUDIT, PanicDeviceService, type PanicDeviceRow, type PanicOrg, type PanicPerson } from './panic-device.service';
import { PanicRateLimiter } from './panic-rate-limit';

/**
 * Panic phones (2026-11-14) — the ONLY door a panic credential opens.
 *
 * WHO CALLS THIS. Not the phone. The phone talks to its own origin
 * (`apps/web/src/app/api/panic/*`, Next route handlers) and those handlers
 * call these routes server to server with the shared SESSION_BFF_SECRET. The
 * credential lives in an HttpOnly cookie on that origin and reaches here only
 * in a request BODY from that server — never a header a browser could attach,
 * never a URL. Without the secret configured on BOTH services every route
 * here answers 403 PANIC_DEVICE_UNAVAILABLE: a credential that never expires
 * must not be mintable or usable by anything but the web origin's server.
 * (The session BFF treats the same secret as optional; this one does not.)
 *
 * WHAT IT CAN DO. Exactly: mint (`enroll`, behind a full, recent sign-in),
 * look (`status`, `targets`, `active`), send (`trigger`, through the
 * emergency controller's own `triggerEmergency` — every check that route
 * makes, it makes here too), and turn itself off (`revoke`). There is no
 * all-clear here and there must never be one: ending an alert stays behind a
 * full sign-in. `panic-device.scope.spec.ts` pins the route list.
 *
 * WHO IT SENDS AS. The person the credential names, as their LIVE row says
 * now (`PanicDeviceService.authenticate`), confined to the organisation the
 * phone was enrolled in. The emergency controller sees an ordinary principal
 * of that person plus `kind: 'panic-device'`, so its TRIGGER_EMERGENCY audit
 * row names the phone.
 *
 * CSRF. The JWT-free routes carry no ambient credential (the secret is in the
 * body, from a server with no cookie jar) — the same argument as
 * `/auth/session/refresh`; they are on the CSRF exempt list. `enroll` is
 * Bearer-authenticated and takes the Bearer bypass.
 *
 * RATE LIMITS. Not the global per-IP throttle, whose key here would be the
 * web origin's egress address for every school at once — see
 * `panic-rate-limit.ts`.
 */

/** Header the web origin's server proves itself with (shared with the session BFF). */
export const PANIC_BFF_SECRET_HEADER = 'x-venueos-session-bff';
/** The phone's address as the web origin saw it. Read ONLY after the secret matched. */
export const PANIC_CLIENT_IP_HEADER = 'x-venueos-panic-client-ip';

export const CredentialBodySchema = z.object({ credential: z.string().min(1).max(200) }).strict();
type CredentialBody = z.infer<typeof CredentialBodySchema>;

export const PanicTriggerBodySchema = z
  .object({
    credential: z.string().min(1).max(200),
    type: OverrideIncidentType,
    /** A DRILL adds exactly this; absent = a LIVE alert, as on every surface. */
    isDrill: z.literal(true).optional(),
    /** One group or one screen. Absent = All screens (the phone's organisation). */
    target: z.object({ scopeType: z.enum(['group', 'device']), scopeId: Id }).strict().optional(),
  })
  .strict();
type PanicTriggerBody = z.infer<typeof PanicTriggerBodySchema>;

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

/** First value of a header, or null. */
function header(req: Request, name: string): string | null {
  const raw = req.headers[name];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length ? v : null;
}

/** A forwarded address is a throttle key and an audit field: shape-check it like client-ip.ts does. */
function normalizeForwardedIp(value: string | null): string | null {
  if (!value) return null;
  let v = value.split(',')[0].trim().toLowerCase();
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) v = mapped[1];
  if (!v || v.length > 45 || !/^[0-9a-f.:]+$/.test(v)) return null;
  return v;
}

@Controller('api/v1/panic-device')
@SkipThrottle()
export class PanicDeviceController {
  private readonly logger = new Logger('PanicDeviceController');

  constructor(
    private readonly devices: PanicDeviceService,
    private readonly limiter: PanicRateLimiter,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** The emergency controller's own handlers, in-process (the drill runner does the same). */
  private emergency(): Pick<EmergencyController, 'triggerEmergency' | 'targets' | 'activeAlerts'> {
    return this.moduleRef.get(EmergencyController, { strict: false });
  }

  /** The web origin's server, or nobody. Returns the phone's real address when it sent one. */
  private assertBffCaller(req: Request): string | null {
    const configured = bffSecret();
    const presented = header(req, PANIC_BFF_SECRET_HEADER);
    if (!configured || !presented || !safeEquals(presented, configured)) {
      throw new ForbiddenException({
        code: 'PANIC_DEVICE_UNAVAILABLE',
        message: 'Panic phones are only reachable through the web origin, with SESSION_BFF_SECRET set on both services.',
      });
    }
    return normalizeForwardedIp(header(req, PANIC_CLIENT_IP_HEADER));
  }

  private assertEnabled(): void {
    if (panicDevicesDisabled()) {
      throw new ForbiddenException({
        code: 'PANIC_DEVICE_DISABLED',
        message: 'Panic phones are turned off on this server. Sign in to send an alert.',
      });
    }
  }

  private async limit(key: string, max: number): Promise<void> {
    if (!(await this.limiter.allow(key, max))) {
      throw new HttpException(
        { code: 'PANIC_DEVICE_RATE_LIMITED', message: 'Too many requests from this phone. Wait a moment and try again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Authenticate the presented credential for `route`: the per-address limit
   * BEFORE the lookup (it bounds junk floods), the per-phone limit after.
   * A database error is 503 — "could not find out", and the phone keeps its
   * cookie; only the server's decision (401) ends it.
   */
  private async authenticate(
    route: Exclude<PanicRoute, 'enroll'>,
    credential: string,
    clientIp: string | null,
  ): Promise<{ device: PanicDeviceRow; user: PanicPerson; tenant: PanicOrg }> {
    const limits = PANIC_RATE_LIMITS[route];
    if (clientIp) await this.limit(`${route}:ip:${clientIp}`, limits.client);
    let result;
    try {
      result = await this.devices.authenticate(credential, { ip: clientIp });
    } catch (e: any) {
      this.logger.warn(`panic credential check unavailable (${route}): ${e?.message ?? e}`);
      throw new ServiceUnavailableException({ code: 'PANIC_DEVICE_CHECK_UNAVAILABLE', message: 'Could not check this phone right now. Try again.' });
    }
    if (!result.ok) {
      if (route === 'trigger' && result.device) {
        await this.devices.auditUse({
          action: PANIC_AUDIT.REFUSED,
          device: result.device,
          details: { reason: result.refusal, ip: clientIp },
        });
      }
      throw new UnauthorizedException({
        code: 'PANIC_DEVICE_REFUSED',
        reason: result.refusal,
        message: 'This phone is no longer set up for emergencies. Sign in to send an alert.',
      });
    }
    await this.limit(`${route}:dev:${result.device.id}`, limits.device);
    this.devices.touch(result.device, clientIp);
    return result;
  }

  /**
   * The principal the emergency controller sees: the person, confined to the
   * phone's organisation, marked as a panic phone so its audit rows name it.
   */
  private principalOf(device: PanicDeviceRow, user: PanicPerson, clientIp: string | null) {
    return {
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: device.tenantId,
      schoolId: device.tenantId,
      canTriggerPanic: user.canTriggerPanic === true,
      kind: 'panic-device' as const,
      panicDeviceId: device.id,
      panicDeviceIp: clientIp,
    };
  }

  // ── Mint ────────────────────────────────────────────────────────────────

  /**
   * "Keep this phone ready for emergencies." A full, RECENT sign-in of a
   * person who may send an emergency, in their own organisation, meeting the
   * second-factor policy, mints one credential. The secret goes back to the
   * web origin's server only; it sets the cookie and never shows it to the page.
   */
  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async enroll(@Req() req: Request) {
    const clientIp = this.assertBffCaller(req);
    this.assertEnabled();

    const actor = (req as any).user;
    const userId: string | undefined = actor?.id || actor?.userId;
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({ code: 'PANIC_DEVICE_ENROLL_NOT_APPLICABLE', message: 'Only a signed-in person can keep a phone ready.' });
    }
    if (clientIp) await this.limit(`enroll:ip:${clientIp}`, PANIC_RATE_LIMITS.enroll.client);
    await this.limit(`enroll:user:${userId}`, PANIC_RATE_LIMITS.enroll.user);

    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    const payload = (type === 'Bearer' && token ? this.jwtService.decode(token) : null) as Record<string, unknown> | null;
    const checkedAt =
      typeof payload?.origIat === 'number' ? payload.origIat : typeof payload?.iat === 'number' ? payload.iat : null;

    // ten-ok: identity SELF-lookup — `userId` is the principal JwtAuthGuard
    // verified on this request; its tenant is compared to the session's below.
    const row = (await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true, tenantId: true, email: true, role: true, status: true, deletedAt: true,
        canTriggerPanic: true, mfaRequired: true, mfaTotpVerifiedAt: true,
      } as any,
    })) as any;
    const [tenant, passkeyCount, activeDeviceCount] = row
      ? await Promise.all([
          this.prisma.client.tenant.findUnique({
            where: { id: row.tenantId },
            select: { id: true, archivedAt: true, mfaEnforced: true } as any,
          }) as Promise<any>,
          // A passkey is a second factor (mfa-policy.ts) — the policy needs the count.
          this.prisma.client.passkey.count({ where: { userId: row.id } }),
          this.devices.countActiveForUser(row.id, row.tenantId),
        ])
      : [null, 0, 0];
    // SEC-008: a credential that never expires is never minted for an account
    // that owes a second factor — the same live evaluation the cookie refresh makes.
    const mfaBlocking = row
      ? evaluateMfaPolicy({ ...row, hasPasskey: passkeyCount > 0 }, { tenantEnforced: tenantMfaEnforced(tenant) }).blocking
      : true;
    const refusal = enrollmentRefusal({
      user: row,
      tenant: tenant ?? null,
      sessionTenantId: actor?.tenantId,
      credentialCheckedAtSec: checkedAt,
      nowSec: Math.floor(Date.now() / 1000),
      mfaBlocking,
      activeDeviceCount,
    });
    if (refusal) {
      throw new ForbiddenException({
        code: 'PANIC_DEVICE_ENROLL_REFUSED',
        reason: refusal,
        message:
          refusal === 'stale-login'
            ? 'Sign in again to keep this phone ready — it has to be a fresh sign-in.'
            : 'This account cannot keep a phone ready for emergencies.',
      });
    }

    const userAgent = (req.headers['user-agent'] as string) || null;
    const { credential, device } = await this.devices.enroll({
      user: { id: row.id, tenantId: row.tenantId, email: row.email },
      label: deviceLabelFromUserAgent(userAgent),
      ip: clientIp,
      userAgent,
    });
    return { credential, device: { id: device.id, label: device.label, createdAt: device.createdAt } };
  }

  // ── Look ────────────────────────────────────────────────────────────────

  /** Who this phone sends as. Opened once per launch of the panic app. */
  @Post('status')
  @HttpCode(HttpStatus.OK)
  async status(@Body(new ZodValidationPipe(CredentialBodySchema)) body: CredentialBody, @Req() req: Request) {
    const clientIp = this.assertBffCaller(req);
    this.assertEnabled();
    const { device, user, tenant } = await this.authenticate('status', body.credential, clientIp);
    return {
      device: { id: device.id, label: device.label, createdAt: device.createdAt },
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        role: user.role,
        tenantId: device.tenantId,
        tenantName: tenant.name ?? null,
        tenantSlug: tenant.slug ?? device.tenantId,
        canTriggerPanic: user.canTriggerPanic === true,
      },
    };
  }

  /** Where an alert can go — the emergency controller's own answer for this person. */
  @Post('targets')
  @HttpCode(HttpStatus.OK)
  async targets(@Body(new ZodValidationPipe(CredentialBodySchema)) body: CredentialBody, @Req() req: Request) {
    const clientIp = this.assertBffCaller(req);
    this.assertEnabled();
    const { device, user } = await this.authenticate('targets', body.credential, clientIp);
    return this.emergency().targets({ user: this.principalOf(device, user, clientIp) });
  }

  /** What is live — read-only. Ending an alert needs a full sign-in. */
  @Post('active')
  @HttpCode(HttpStatus.OK)
  async active(@Body(new ZodValidationPipe(CredentialBodySchema)) body: CredentialBody, @Req() req: Request) {
    const clientIp = this.assertBffCaller(req);
    this.assertEnabled();
    const { device, user } = await this.authenticate('active', body.credential, clientIp);
    return this.emergency().activeAlerts({ user: this.principalOf(device, user, clientIp) });
  }

  // ── Send ────────────────────────────────────────────────────────────────

  /**
   * Send an emergency as the person this phone belongs to. The body is
   * narrow on purpose — type, LIVE or DRILL, and at most one group or screen;
   * never a playlist, a media URL, a text or an expiry — and it is turned
   * into exactly the request the panic page sends with a session, validated
   * by the trigger's own schema, and handed to the trigger's own handler,
   * which makes every check it makes for a session (scope ownership, the
   * drill-over-live refusal, the audit row, the signed fan-out).
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async trigger(@Body(new ZodValidationPipe(PanicTriggerBodySchema)) body: PanicTriggerBody, @Req() req: Request) {
    const clientIp = this.assertBffCaller(req);
    this.assertEnabled();
    const { device, user } = await this.authenticate('trigger', body.credential, clientIp);
    const principal = this.principalOf(device, user, clientIp);

    const input = TriggerEmergencyInputSchema.parse({
      scopeType: body.target ? body.target.scopeType : 'tenant',
      scopeId: body.target ? body.target.scopeId : device.tenantId,
      overridePayload: {
        severity: 'CRITICAL',
        type: body.type,
        ...(body.isDrill === true ? { isDrill: true } : {}),
      },
    });
    const trail = {
      type: body.type,
      isDrill: body.isDrill === true,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      ip: clientIp,
      ua: ((req.headers['user-agent'] as string) || '').slice(0, 256),
    };
    try {
      const result: any = await this.emergency().triggerEmergency(input, { user: principal });
      await this.devices.auditUse({
        action: PANIC_AUDIT.USED,
        device,
        details: { ...trail, outcome: 'sent', overrideId: result?.overrideId ?? null },
      });
      return result;
    } catch (e: any) {
      const status = typeof e?.getStatus === 'function' ? e.getStatus() : 500;
      const response = typeof e?.getResponse === 'function' ? e.getResponse() : null;
      await this.devices.auditUse({
        action: PANIC_AUDIT.USED,
        device,
        details: { ...trail, outcome: 'not-sent', status, code: (response as any)?.code ?? null },
      });
      throw e;
    }
  }

  // ── Turn off ────────────────────────────────────────────────────────────

  /** "Turn off on this phone." Idempotent; a credential already dead answers the same. */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(@Body(new ZodValidationPipe(CredentialBodySchema)) body: CredentialBody, @Req() req: Request) {
    const clientIp = this.assertBffCaller(req);
    // Deliberately NOT behind the kill switch: turning a phone off must work
    // while the feature is switched off too.
    let result;
    try {
      if (clientIp) await this.limit(`revoke:ip:${clientIp}`, PANIC_RATE_LIMITS.revoke.client);
      result = await this.devices.authenticate(body.credential, { ip: clientIp });
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException({ code: 'PANIC_DEVICE_CHECK_UNAVAILABLE', message: 'Could not reach the server. Try again.' });
    }
    if (!result.ok) return { revoked: false };
    await this.limit(`revoke:dev:${result.device.id}`, PANIC_RATE_LIMITS.revoke.device);
    const revoked = await this.devices.revoke({ device: result.device, byUserId: result.user.id, reason: 'self', ip: clientIp });
    return { revoked };
  }
}
