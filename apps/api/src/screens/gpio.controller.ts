/**
 * GpioController — Goodview EP6N GPIO IN/OUT REST surface.
 *
 * Spec lives at the top of `apps/api/src/screens/gpio.service.ts`.
 * This controller is just the HTTP front door + auth wrappers; every
 * mutation routes through GpioService so the emergency-system path
 * can call into the same writes without an HTTP hop.
 *
 * Endpoints (all mounted under /api/v1/screens):
 *
 *   POST /:id/gpio-event   — Device JWT. The player reports a dry-
 *                            contact edge from the EP6N. Body
 *                            { pin, state, at? }. Triggers an
 *                            emergency override on the screen when
 *                            wiring + state are active.
 *
 *   POST /:id/gpio-set     — JwtAuthGuard. Operator from the
 *                            dashboard flips a GPIO OUT pin
 *                            (status lamp on, horn off). Body
 *                            { pin, state }. Persists state +
 *                            broadcasts a signed GPIO_SET message.
 *
 * Out of scope here: the manifest endpoint surfaces the current
 * gpioState; see ScreensController.getManifest in
 * `apps/api/src/screens/screens.controller.ts`.
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { requireSecret } from '../security/required-secret';
import { GpioService, type GpioInPin, type GpioOutPin, type GpioInputState, type GpioOutputState } from './gpio.service';

/** Pin sets for input validation. */
const GPIO_IN_PINS = new Set<GpioInPin>(['in1', 'in2']);
const GPIO_OUT_PINS = new Set<GpioOutPin>(['out1', 'out2']);
const GPIO_INPUT_STATES = new Set<GpioInputState>(['low', 'high', 'edge_rising', 'edge_falling']);
const GPIO_OUTPUT_STATES = new Set<GpioOutputState>(['low', 'high']);

/**
 * Device-JWT auth check, scoped to a single screenId. Mirror of the
 * helper in `screens.controller.ts` — kept inline so this controller
 * doesn't depend on the screens controller's internals + so the
 * pattern stays in sync with the existing manifest / cache-status
 * device-auth surface.
 *
 * Returns the verified screenId on success or null on failure.
 * Callers should respond 401 on null.
 *
 * Backward-compat: also accepts the short-lived HMAC header
 * (X-Device-Auth: `${ts}.${hex hmac}`) that already-shipped player
 * binaries use. Same shape as
 * `screens.controller#verifyDeviceForScreen`.
 */
function verifyDeviceForScreen(req: ExpressReq, screenId: string): { ok: true; sub: string } | { ok: false; reason: string } {
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const secret = requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' });
      const decoded = jwt.verify(token, secret) as any;
      if (decoded?.kind !== 'device') return { ok: false, reason: 'wrong_token_kind' };
      if (decoded?.sub !== screenId) return { ok: false, reason: 'subject_mismatch' };
      return { ok: true, sub: decoded.sub };
    } catch (e) {
      return { ok: false, reason: `jwt_invalid:${(e as Error).message}` };
    }
  }

  const hmacHeader = req.headers['x-device-auth'];
  if (typeof hmacHeader === 'string' && hmacHeader.includes('.')) {
    const [tsStr, sig] = hmacHeader.split('.');
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'hmac_ts_bad' };
    if (Math.abs(Date.now() - ts) > 2 * 60 * 1000) return { ok: false, reason: 'hmac_expired' };
    const secret = requireSecret('DEVICE_SECRET_KEY', { devFallback: 'dev_only_device_secret_CHANGE_ME' });
    const expected = crypto.createHmac('sha256', secret).update(`${screenId}:${ts}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return { ok: false, reason: 'hmac_sig_bad' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'hmac_sig_bad' };
    return { ok: true, sub: screenId };
  }

  return { ok: false, reason: 'no_auth' };
}

@Controller('api/v1/screens')
export class GpioController {
  private readonly logger = new Logger(GpioController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gpio: GpioService,
  ) {}

  /**
   * POST /api/v1/screens/:id/gpio-event
   *
   * Player → API. The EP6N has fired an edge or state change on
   * GPIO IN. We classify the wiring + decide whether to trigger the
   * matching emergency (panic_button → LOCKDOWN, fire_alarm →
   * EVACUATE), log only, or rate-limit.
   *
   * Throttle: 30/min per IP at the controller layer + 10/min per
   * screen at the service layer (anti-flap). The first guards the
   * cheap case (kiosks share one school's public IP); the second
   * caps the worst case (a bouncing dry contact during a real
   * incident).
   */
  @Post(':id/gpio-event')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async gpioEvent(
    @Param('id') screenId: string,
    @Req() req: ExpressReq,
    @Body() body: { pin?: string; state?: string; at?: string },
  ) {
    const auth = verifyDeviceForScreen(req, screenId);
    if (!auth.ok) {
      throw new UnauthorizedException(`Device auth required (${auth.reason})`);
    }

    const pinRaw = (body?.pin || '').toString().trim().toLowerCase();
    if (!GPIO_IN_PINS.has(pinRaw as GpioInPin)) {
      throw new BadRequestException(`Invalid pin '${pinRaw}'. Expected one of: ${[...GPIO_IN_PINS].join(', ')}`);
    }
    const pin = pinRaw as GpioInPin;

    const stateRaw = (body?.state || '').toString().trim().toLowerCase();
    if (!GPIO_INPUT_STATES.has(stateRaw as GpioInputState)) {
      throw new BadRequestException(`Invalid state '${stateRaw}'. Expected one of: ${[...GPIO_INPUT_STATES].join(', ')}`);
    }
    const state = stateRaw as GpioInputState;

    const at = typeof body?.at === 'string' && body.at.length > 0 && body.at.length < 40 ? body.at : undefined;

    // Resolve the screen + its tenantId. The device JWT proved which
    // screen the event is for; we re-read the row so the tenantId
    // for the audit + override comes from the DB, not the request.
    // No `select` here: the `config` column was added 2026-05-27 and
    // the @prisma/client types don't carry it yet (regenerated on
    // next `pnpm db:generate`), so we read the full row and cast.
    const screen = (await this.prisma.client.screen.findUnique({
      where: { id: screenId },
    })) as any;
    if (!screen) {
      throw new NotFoundException('Screen not found');
    }
    if (!screen.tenantId || typeof screen.tenantId !== 'string') {
      throw new HttpException('Screen is not assigned to a tenant', HttpStatus.CONFLICT);
    }

    const result = await this.gpio.handleInputEvent({
      screenId: screen.id as string,
      tenantId: screen.tenantId as string,
      event: { pin, state, at },
      config: screen.config ?? null,
    });

    return result;
  }

  /**
   * POST /api/v1/screens/:id/gpio-set
   *
   * Dashboard operator → API. Flip a GPIO OUT pin's state. The
   * service writes Screen.config.gpioState + broadcasts a signed
   * GPIO_SET on `device:<screenId>`. Player reads the new state
   * via the manifest (poll fallback) or via the broadcast (fast
   * path).
   *
   * Roles: SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN. CONTRIBUTOR /
   * RESTRICTED_VIEWER cannot fire physical-world relays.
   */
  @Post(':id/gpio-set')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async gpioSet(
    @Param('id') screenId: string,
    @Req() req: any,
    @Body() body: { pin?: string; state?: string },
  ) {
    const pinRaw = (body?.pin || '').toString().trim().toLowerCase();
    if (!GPIO_OUT_PINS.has(pinRaw as GpioOutPin)) {
      throw new BadRequestException(`Invalid pin '${pinRaw}'. Expected one of: ${[...GPIO_OUT_PINS].join(', ')}`);
    }
    const pin = pinRaw as GpioOutPin;

    const stateRaw = (body?.state || '').toString().trim().toLowerCase();
    if (!GPIO_OUTPUT_STATES.has(stateRaw as GpioOutputState)) {
      throw new BadRequestException(`Invalid state '${stateRaw}'. Expected one of: ${[...GPIO_OUTPUT_STATES].join(', ')}`);
    }
    const state = stateRaw as GpioOutputState;

    // Tenant-scope the screen lookup. SUPER_ADMIN may target any tenant;
    // every other role must match req.user.tenantId.
    const callerTenantId: string | null = req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    const isSuper = req.user?.role === AppRole.SUPER_ADMIN;

    const screen = (await this.prisma.client.screen.findUnique({
      where: { id: screenId },
    })) as any;
    if (!screen) {
      throw new NotFoundException('Screen not found');
    }
    if (!screen.tenantId || typeof screen.tenantId !== 'string') {
      throw new HttpException('Screen is not assigned to a tenant', HttpStatus.CONFLICT);
    }
    if (!isSuper && screen.tenantId !== callerTenantId) {
      // 404 not 403 to avoid leaking screen existence across tenants.
      throw new NotFoundException('Screen not found');
    }

    await this.gpio.setOutput({
      screenId: screen.id as string,
      tenantId: screen.tenantId as string,
      pin,
      state,
      userId: req.user?.id ?? null,
      source: 'operator',
    });

    return { success: true };
  }
}
