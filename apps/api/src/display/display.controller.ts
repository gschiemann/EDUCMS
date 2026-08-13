/**
 * DisplayController — per-screen display capability + control REST surface.
 *
 * Mounted under /api/v1/screens (a THIRD controller on that prefix, after
 * ScreensController and GpioController — same pattern, same care: a new
 * literal segment must not collide with the `:id` param routes those two
 * already reserve).
 *
 *   POST /:id/display-capabilities   Device JWT. The player reports its
 *                                    read-only DisplayCapabilityProbe
 *                                    verdict. CSRF-EXEMPT (native Kotlin
 *                                    HttpURLConnection, no cookie jar).
 *   GET  /:id/display-capabilities   Operator. What the dashboard gates its
 *                                    controls on.
 *   POST /:id/display-control        Operator. Immediate action. 409s when
 *                                    the action exceeds the reported
 *                                    capability. NOT CSRF-exempt — it is a
 *                                    dashboard call with a session.
 *
 * The scheduled on/off path deliberately does NOT live here: schedules run
 * ON DEVICE from the manifest (AlarmManager), so a screen that loses network
 * still blanks at 22:00. See DisplaySchedulesController + display-manifest.ts.
 */

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressReq } from 'express';

import { AppRole } from '@cms/database';
import {
  DisplayCapabilityReportSchema,
  DisplayControlActionSchema,
  MIN_SAFE_BRIGHTNESS_PERCENT,
  type DisplayCapabilityReportInput,
  type DisplayControlActionInput,
} from '@cms/api-types';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { verifyDeviceForScreen } from '../screens/device-auth';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import {
  DisplayActionUnsupportedError,
  DisplayService,
  normalizeCapabilityReport,
  verdictFromStored,
} from './display.service';

@Controller('api/v1/screens')
export class DisplayController {
  private readonly logger = new Logger(DisplayController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly display: DisplayService,
  ) {}

  /**
   * POST /api/v1/screens/:id/display-capabilities
   *
   * The player reports what its hardware actually exposes. Device-JWT
   * authenticated through the ONE shared verifier (revocation list +
   * REVOKED status + credential epoch + live-row identity), never a local
   * copy — that divergence is what DT-05 existed to kill.
   *
   * THROTTLE: 30/min per IP. Sized like /gpio-event rather than like
   * /render-proof because this is a boot-time/on-demand report, not a
   * per-poll one — but note the standing trap: the throttler keys on IP,
   * and a whole school's kiosks share one NAT address. 30/min is ~30 screens
   * rebooting in the same minute behind one public IP; if a large venue ever
   * mass-reboots, this is the number to raise (see the render-proof
   * post-mortem at screens.controller.ts:4294).
   */
  @Post(':id/display-capabilities')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reportCapabilities(
    @Param('id') screenId: string,
    @Req() req: ExpressReq,
    @Body(new ZodValidationPipe(DisplayCapabilityReportSchema))
    body: DisplayCapabilityReportInput,
  ) {
    const auth = await verifyDeviceForScreen(
      { prisma: this.prisma, redis: this.redisService },
      req,
      screenId,
      // An unpaired screen has no tenant to audit against and no operator
      // able to act on the result — same call shape as /gpio-event.
      { allowUnpaired: false },
    );
    if (!auth.ok) {
      throw new UnauthorizedException({
        code: 'SCREEN_DEVICE_AUTH_REQUIRED',
        message: `Device auth required (${auth.reason})`,
      });
    }

    // ten-ok: identity-derived self-lookup — `screenId` was proved to equal the
    // device token's `sub` by verifyDeviceForScreen above, so the device IS the
    // principal and there is no narrower scope than its own row (case (b) in
    // the gate's escape-hatch list). Full row + cast because the new
    // displayCapabilities columns are not in the generated @prisma/client
    // types until `pnpm db:generate` runs.
    const screen = (await this.prisma.client.screen.findUnique({
      where: { id: screenId },
    })) as any;
    if (!screen) {
      throw new NotFoundException({
        code: 'SCREEN_NOT_FOUND',
        message: 'Screen not found',
      });
    }

    const report = normalizeCapabilityReport(body, Date.now());
    const { changed } = await this.display.recordCapabilities({
      screenId: screen.id,
      tenantId: (screen.tenantId as string) ?? null,
      previous: screen.displayCapabilities,
      report,
    });

    return { success: true, changed, verdict: report.verdict };
  }

  /**
   * GET /api/v1/screens/:id/display-capabilities
   *
   * What the dashboard gates every control on. Returns `verdict: null` when
   * the screen has never reported — the UI must then disable everything
   * rather than guess. Not `@NoViewerRead()`: the response discloses hardware
   * facts, it is not itself an authorization.
   */
  @Get(':id/display-capabilities')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async getCapabilities(@Param('id') screenId: string, @Req() req: any) {
    const screen = await this.loadOperatorScreen(screenId, req);
    const stored = screen.displayCapabilities ?? null;
    return {
      screenId: screen.id,
      verdict: verdictFromStored(stored),
      reportedAt: screen.displayCapabilitiesAt ?? null,
      build:
        stored && typeof stored === 'object' ? (stored.build ?? null) : null,
      /** So the UI can label its floor without hard-coding the number. */
      minSafeBrightnessPercent: MIN_SAFE_BRIGHTNESS_PERCENT,
    };
  }

  /**
   * POST /api/v1/screens/:id/display-control
   *
   * Immediate action. Roles mirror /gpio-set: CONTRIBUTOR and
   * RESTRICTED_VIEWER cannot blank or reboot a physical screen.
   *
   * 409 CONFLICT when the action exceeds the screen's REPORTED capability —
   * including the case where it has reported nothing at all. That is the
   * point of the capability probe: no button the hardware cannot perform,
   * and no optimistic firing at hardware we have not observed.
   */
  @Post(':id/display-control')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async control(
    @Param('id') screenId: string,
    @Req() req: any,
    @Body(new ZodValidationPipe(DisplayControlActionSchema))
    body: DisplayControlActionInput,
  ) {
    if (
      (body.action === 'SET_VOLUME' || body.action === 'SET_BRIGHTNESS') &&
      typeof body.percent !== 'number'
    ) {
      throw new HttpException(
        {
          code: 'DISPLAY_PERCENT_REQUIRED',
          message: `${body.action} requires a percent between 0 and 100`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const screen = await this.loadOperatorScreen(screenId, req);
    if (!screen.tenantId || typeof screen.tenantId !== 'string') {
      throw new HttpException(
        {
          code: 'SCREEN_NO_TENANT',
          message: 'Screen is not assigned to a tenant',
        },
        HttpStatus.CONFLICT,
      );
    }

    try {
      return await this.display.applyAction({
        screenId: screen.id,
        tenantId: screen.tenantId,
        userId: req.user?.id ?? req.user?.userId ?? null,
        action: body.action,
        percent: body.percent,
        revertAfterMs: body.revertAfterMs,
        allowBlack: body.allowBlack,
        reason: body.reason,
        capabilities: screen.displayCapabilities ?? null,
      });
    } catch (e) {
      if (e instanceof DisplayActionUnsupportedError) {
        // 409, not 400: the request is well-formed, it conflicts with the
        // observed state of the hardware.
        throw new HttpException(
          { code: e.code, message: e.message, ...e.detail },
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /**
   * Tenant-scoped screen load for the operator routes.
   *
   * SUPER_ADMIN is cross-tenant by design; every other role must match.
   * A cross-tenant miss returns 404, never 403 — the house rule that stops
   * the error code from confirming a screen id exists in another tenant.
   */
  private async loadOperatorScreen(screenId: string, req: any): Promise<any> {
    const isSuper = req.user?.role === AppRole.SUPER_ADMIN;
    const callerTenantId: string | null =
      req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;

    if (!isSuper && !callerTenantId) {
      throw new NotFoundException({
        code: 'SCREEN_NOT_FOUND',
        message: 'Screen not found',
      });
    }

    const screen = (await this.prisma.client.screen.findFirst({
      where: isSuper
        ? { id: screenId }
        : { id: screenId, tenantId: callerTenantId as string },
    })) as any;
    if (!screen) {
      throw new NotFoundException({
        code: 'SCREEN_NOT_FOUND',
        message: 'Screen not found',
      });
    }
    return screen;
  }
}
