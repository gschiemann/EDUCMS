/**
 * DisplayController tests — HTTP semantics of the display-control surface.
 *
 * Coverage:
 *   - an action exceeding the screen's REPORTED capability returns 409
 *     CONFLICT (not 400 — the request is well-formed, it conflicts with the
 *     observed hardware) and never reaches the device
 *   - TENANT ISOLATION: a screen in another tenant is 404, never 403, and the
 *     action never runs; SUPER_ADMIN is cross-tenant by design
 *   - the device capability report is gated on the shared device verifier
 *   - GET capabilities returns null (→ every control disabled) for a screen
 *     that has never reported
 */

import {
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { AppRole } from '@cms/database';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { DisplayController } from './display.controller';
import { DisplayService } from './display.service';

jest.mock('../screens/device-auth', () => ({
  verifyDeviceForScreen: jest.fn(),
}));

const { verifyDeviceForScreen } = require('../screens/device-auth');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const SCREEN_A = 'screen-a';

const FULL_VERDICT = {
  volume: 'audiomanager',
  brightness: 'sysfs',
  screenBlank: 'device-owner',
  reboot: 'device-owner',
  hardPowerOff: 'none',
  deviceOwnerPath: 'held',
};
const BARE_VERDICT = {
  volume: 'audiomanager',
  brightness: 'software-dim',
  screenBlank: 'none',
  reboot: 'none',
  hardPowerOff: 'none',
  deviceOwnerPath: 'provisionable-after-factory-reset',
};

const screenRow = (
  verdict: Record<string, string> | null,
  tenantId = TENANT_A,
) => ({
  id: SCREEN_A,
  tenantId,
  screenGroupId: null,
  displayCapabilities: verdict
    ? { schema: 1, reportedAt: 1, build: { model: 'EP6N' }, verdict }
    : null,
  displayCapabilitiesAt: verdict ? new Date('2026-08-13T00:00:00Z') : null,
});

const adminReq = (tenantId = TENANT_A) => ({
  user: { id: 'u1', role: AppRole.SCHOOL_ADMIN, tenantId },
});

describe('DisplayController', () => {
  let controller: DisplayController;
  let prisma: any;
  let redis: any;
  let display: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      client: {
        screen: { findFirst: jest.fn(), findUnique: jest.fn() },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        // Emergency interlock surface. Default = quiet tenant. NOTE the
        // fail-closed contract: omit these and every DARKENING action is
        // refused with DISPLAY_EMERGENCY_HOLD, because an unreadable
        // emergency state must never resolve to "go ahead and blank it".
        screenEmergencyOverride: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            id: TENANT_A,
            parentId: null,
            archivedAt: null,
            emergencyStatus: 'INACTIVE',
          }),
        },
      },
    };
    redis = {
      publish: jest.fn().mockResolvedValue(true),
      isConnected: jest.fn().mockReturnValue(true),
    };
    display = {
      applyAction: jest.fn(),
      recordCapabilities: jest.fn().mockResolvedValue({ changed: true }),
    };

    // Direct instantiation — the class-level @UseGuards(JwtAuthGuard,
    // RbacGuard) would otherwise pull JwtService/ApiKeysService into the test
    // module. Same pattern as screens.fleet.spec.ts / gpio.device-auth.spec.ts.
    controller = new DisplayController(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      display as unknown as DisplayService,
    );
  });

  // ── capability gate → 409 ────────────────────────────────────────────

  describe('capability gating', () => {
    /**
     * The controller delegates the decision to DisplayService (tested
     * separately against the pure gate); what is asserted here is that the
     * refusal surfaces as 409 CONFLICT with a machine-readable code, so the
     * dashboard can say "this box exposes no backlight control" instead of
     * rendering a generic error.
     */
    it('maps REBOOT on a no-device-owner box to 409 with its OWN code, not a generic error', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(BARE_VERDICT));
      // Real service, real gate — no stub, so the 409 is proven end to end.
      (controller as any).display = new DisplayService(prisma, redis, {
        signMessage: jest.fn(),
      } as any);

      // Code changed from DISPLAY_ACTION_UNSUPPORTED with the 2026-08-13
      // no-device-owner decision: reboot is genuinely unavailable on the whole
      // fleet, so the operator gets a specific reason, not a shrug.
      await expect(
        controller.control(SCREEN_A, adminReq(), { action: 'REBOOT' } as any),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({
          code: 'DISPLAY_REBOOT_UNAVAILABLE',
          message: expect.stringContaining('Power-cycle it at the panel'),
        }),
      });
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('409s a RISK action on a screen that has never reported its capabilities', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(null));
      (controller as any).display = new DisplayService(prisma, redis, {
        signMessage: jest.fn(),
      } as any);

      await expect(
        controller.control(SCREEN_A, adminReq(), { action: 'BLANK' } as any),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({
          code: 'DISPLAY_CAPABILITIES_UNKNOWN',
        }),
      });
    });

    it('lets WAKE through on a screen that has never reported — recovery is never refused', async () => {
      // The manifest ships schedules to a never-probed screen regardless, so
      // that screen CAN be blanked by its own on-device alarm. Refusing the
      // un-blank direction was a dark wall-mounted panel with no dashboard
      // path back. (Contract C4: fail-open for recovery.)
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(null));
      (controller as any).display = new DisplayService(prisma, redis, {
        signMessage: jest.fn().mockReturnValue({ type: 'DISPLAY_CONTROL' }),
      } as any);

      const res: any = await controller.control(SCREEN_A, adminReq(), {
        action: 'WAKE',
      } as any);
      expect(res.success).toBe(true);
      expect(res.mechanism).toBe('software-dim');
      expect(redis.publish).toHaveBeenCalledWith(
        `device:${SCREEN_A}`,
        expect.any(Object),
      );
    });

    it('lets a supported action through', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(FULL_VERDICT));
      display.applyAction.mockResolvedValue({ success: true, action: 'BLANK' });
      await controller.control(SCREEN_A, adminReq(), {
        action: 'BLANK',
      } as any);
      expect(display.applyAction).toHaveBeenCalledWith(
        expect.objectContaining({
          screenId: SCREEN_A,
          tenantId: TENANT_A,
          action: 'BLANK',
        }),
      );
    });

    it('409s a BLANK while an emergency alert is up, and resolves the hold end to end', async () => {
      // LIFE SAFETY. A blanked panel that hides a lockdown alert can get
      // someone hurt, so the operator cannot originate one from the
      // dashboard during an incident — regardless of what the screen's WS
      // socket is doing.
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(FULL_VERDICT));
      prisma.client.tenant.findUnique.mockResolvedValue({
        id: TENANT_A,
        parentId: null,
        archivedAt: null,
        emergencyStatus: 'LOCKDOWN',
      });
      (controller as any).display = new DisplayService(prisma, redis, {
        signMessage: jest.fn().mockReturnValue({ type: 'DISPLAY_CONTROL' }),
      } as any);

      await expect(
        controller.control(SCREEN_A, adminReq(), { action: 'BLANK' } as any),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({ code: 'DISPLAY_EMERGENCY_HOLD' }),
      });
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('still lets WAKE and a brightness RAISE through during that same emergency', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(FULL_VERDICT));
      prisma.client.tenant.findUnique.mockResolvedValue({
        id: TENANT_A,
        parentId: null,
        archivedAt: null,
        emergencyStatus: 'LOCKDOWN',
      });
      (controller as any).display = new DisplayService(prisma, redis, {
        signMessage: jest.fn().mockReturnValue({ type: 'DISPLAY_CONTROL' }),
      } as any);

      await expect(
        controller.control(SCREEN_A, adminReq(), { action: 'WAKE' } as any),
      ).resolves.toMatchObject({ success: true });
      await expect(
        controller.control(SCREEN_A, adminReq(), {
          action: 'SET_BRIGHTNESS',
          percent: 100,
        } as any),
      ).resolves.toMatchObject({ success: true });
      // The recovery direction does not even pay for the emergency read.
      expect(prisma.client.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('400s a percent-bearing action with no percent (a different failure class than 409)', async () => {
      await expect(
        controller.control(SCREEN_A, adminReq(), {
          action: 'SET_BRIGHTNESS',
        } as any),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      // Rejected before the screen is even loaded.
      expect(prisma.client.screen.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── tenant isolation ────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('scopes the screen lookup to the caller tenant, and 404s a cross-tenant id', async () => {
      // A tenant-B admin aiming at tenant-A's screen: the tenant-scoped
      // findFirst matches nothing.
      prisma.client.screen.findFirst.mockResolvedValue(null);

      await expect(
        controller.control(SCREEN_A, adminReq(TENANT_B), {
          action: 'BLANK',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.client.screen.findFirst).toHaveBeenCalledWith({
        where: { id: SCREEN_A, tenantId: TENANT_B },
      });
      expect(display.applyAction).not.toHaveBeenCalled();
    });

    it('404s rather than 403s — the status must not confirm the id exists elsewhere', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(null);
      await expect(
        controller.getCapabilities(SCREEN_A, adminReq(TENANT_B)),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('lets SUPER_ADMIN reach any tenant (cross-tenant by design)', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(screenRow(FULL_VERDICT));
      await controller.getCapabilities(SCREEN_A, {
        user: { id: 'root', role: AppRole.SUPER_ADMIN, tenantId: TENANT_B },
      });
      expect(prisma.client.screen.findFirst).toHaveBeenCalledWith({
        where: { id: SCREEN_A },
      });
    });

    it('refuses a session with no tenant at all', async () => {
      await expect(
        controller.getCapabilities(SCREEN_A, {
          user: { id: 'u', role: AppRole.SCHOOL_ADMIN },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.screen.findFirst).not.toHaveBeenCalled();
    });

    it('409s a screen with no tenant instead of dispatching an unattributable action', async () => {
      prisma.client.screen.findFirst.mockResolvedValue({
        ...screenRow(FULL_VERDICT),
        tenantId: null,
      });
      await expect(
        controller.control(
          SCREEN_A,
          {
            user: { id: 'root', role: AppRole.SUPER_ADMIN, tenantId: TENANT_A },
          },
          { action: 'BLANK' } as any,
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({ code: 'SCREEN_NO_TENANT' }),
      });
    });
  });

  // ── device report ───────────────────────────────────────────────────

  describe('capability report', () => {
    const body = {
      schema: 1,
      build: { manufacturer: 'Goodview' },
      verdict: FULL_VERDICT,
    } as any;

    it('rejects a report whose device credential does not verify', async () => {
      verifyDeviceForScreen.mockResolvedValue({ ok: false, reason: 'revoked' });
      await expect(
        controller.reportCapabilities(SCREEN_A, {} as any, body),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(display.recordCapabilities).not.toHaveBeenCalled();
    });

    it('goes through the SHARED verifier with allowUnpaired:false', async () => {
      verifyDeviceForScreen.mockResolvedValue({
        ok: true,
        sub: SCREEN_A,
        tenantId: TENANT_A,
      });
      prisma.client.screen.findUnique.mockResolvedValue(screenRow(null));
      await controller.reportCapabilities(SCREEN_A, {} as any, body);
      expect(verifyDeviceForScreen).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        SCREEN_A,
        { allowUnpaired: false },
      );
    });

    it('persists the verdict and echoes it back', async () => {
      verifyDeviceForScreen.mockResolvedValue({
        ok: true,
        sub: SCREEN_A,
        tenantId: TENANT_A,
      });
      prisma.client.screen.findUnique.mockResolvedValue(screenRow(null));
      const res = await controller.reportCapabilities(
        SCREEN_A,
        {} as any,
        body,
      );
      expect(res).toMatchObject({
        success: true,
        changed: true,
        verdict: FULL_VERDICT,
      });
      expect(display.recordCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({ screenId: SCREEN_A, tenantId: TENANT_A }),
      );
    });

    it('404s a report for a screen row that no longer exists', async () => {
      verifyDeviceForScreen.mockResolvedValue({
        ok: true,
        sub: SCREEN_A,
        tenantId: TENANT_A,
      });
      prisma.client.screen.findUnique.mockResolvedValue(null);
      await expect(
        controller.reportCapabilities(SCREEN_A, {} as any, body),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('reports a null verdict for a never-probed screen so the UI disables everything', async () => {
    prisma.client.screen.findFirst.mockResolvedValue(screenRow(null));
    const res = await controller.getCapabilities(SCREEN_A, adminReq());
    expect(res.verdict).toBeNull();
    expect(res.minSafeBrightnessPercent).toBe(5);
  });

  it('surfaces the verdict + build for a probed screen', async () => {
    prisma.client.screen.findFirst.mockResolvedValue(screenRow(BARE_VERDICT));
    const res = await controller.getCapabilities(SCREEN_A, adminReq());
    // 'software-dim' is what the dashboard must translate into "dims the
    // image only — this box exposes no backlight control".
    expect(res.verdict).toMatchObject({
      brightness: 'software-dim',
      screenBlank: 'none',
    });
    expect(res.build).toMatchObject({ model: 'EP6N' });
  });

  it('is not a stub — HttpException is the real Nest class', () => {
    expect(new HttpException('x', 409)).toBeInstanceOf(HttpException);
  });
});
