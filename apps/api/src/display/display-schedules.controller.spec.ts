/**
 * DisplaySchedulesController + schedule-contract tests.
 *
 * These rows arm on-device AlarmManager alarms, so a bad row is a screen
 * that never wakes up. Coverage:
 *   - schema validation: "HH:MM" 24h, real IANA timezone, 0..6 days, no
 *     duplicate days, onTime ≠ offTime, overnight windows ARE legal
 *   - exactly one target (screen XOR group), and it must be OWNED
 *   - TENANT ISOLATION: every read/write is scoped; a cross-tenant id 404s
 *     and mutations go through updateMany/deleteMany with the tenant in the
 *     WHERE, so scope cannot be refactored away
 *   - AuditLog on create / update / delete
 */

import { HttpStatus } from '@nestjs/common';

import { AppRole } from '@cms/database';
import {
  DisplayScheduleCreateSchema,
  DisplayScheduleUpdateSchema,
  isValidIanaTimezone,
} from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { DisplaySchedulesController } from './display-schedules.controller';
import { DISPLAY_AUDIT_ACTIONS, DisplayService } from './display.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const baseBody = {
  screenId: 'screen-a',
  daysOfWeek: [1, 2, 3, 4, 5],
  onTime: '07:00',
  offTime: '22:00',
  timezone: 'America/Chicago',
};

const adminReq = (tenantId = TENANT_A) => ({
  user: { id: 'u1', role: AppRole.SCHOOL_ADMIN, tenantId },
});

// ── contract-level validation (the schema is shared with the dashboard) ──

describe('DisplaySchedule contract', () => {
  const ok = (over: Record<string, unknown>) =>
    DisplayScheduleCreateSchema.safeParse({ ...baseBody, ...over }).success;

  it('accepts a normal weekday window', () => {
    expect(ok({})).toBe(true);
  });

  it('accepts an OVERNIGHT window — onTime > offTime is legal, not an error', () => {
    // Friday-night football: lit 18:00 through 02:00 the next morning.
    expect(ok({ onTime: '18:00', offTime: '02:00', daysOfWeek: [5] })).toBe(
      true,
    );
  });

  it('rejects a malformed clock time', () => {
    for (const t of [
      '7:00',
      '24:00',
      '07:60',
      '0700',
      '07:00:00',
      '',
      'noon',
    ]) {
      expect(ok({ onTime: t })).toBe(false);
    }
  });

  it('rejects an equal on/off pair — an ambiguous 0h-or-24h window', () => {
    expect(ok({ onTime: '07:00', offTime: '07:00' })).toBe(false);
  });

  it('rejects out-of-range, duplicate and empty day sets', () => {
    expect(ok({ daysOfWeek: [7] })).toBe(false);
    expect(ok({ daysOfWeek: [-1] })).toBe(false);
    expect(ok({ daysOfWeek: [1, 1] })).toBe(false);
    expect(ok({ daysOfWeek: [] })).toBe(false);
    // 0=Sunday..6=Saturday, the Daypart encoding — a full week is fine.
    expect(ok({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })).toBe(true);
  });

  it('rejects a timezone that is not a real IANA zone', () => {
    // A regex would happily accept "Not/AZone"; Intl does not. This matters:
    // the player resolves a real local instant from it, and a bad zone means
    // a screen that never wakes.
    expect(isValidIanaTimezone('America/Chicago')).toBe(true);
    expect(isValidIanaTimezone('America/Los_Angeles')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('Not/AZone')).toBe(false);
    expect(isValidIanaTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidIanaTimezone('America/Chicago ')).toBe(false); // trailing space
    expect(isValidIanaTimezone('')).toBe(false);
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(42)).toBe(false);
    expect(ok({ timezone: 'Not/AZone' })).toBe(false);
    // NOTE: ICU also resolves legacy tz-database aliases such as "CST" and
    // "EST5EDT". Those are genuinely resolvable zones, so accepting them is
    // correct — a regex-based "must contain a slash" check would wrongly
    // reject "UTC" too. The line we care about is that an unresolvable
    // string never reaches a device that has to compute a wake time from it.
    expect(isValidIanaTimezone('EST5EDT')).toBe(true);
  });

  it('lets a partial update through, but still validates the fields present', () => {
    expect(
      DisplayScheduleUpdateSchema.safeParse({ isActive: false }).success,
    ).toBe(true);
    expect(
      DisplayScheduleUpdateSchema.safeParse({ onTime: '25:00' }).success,
    ).toBe(false);
    expect(
      DisplayScheduleUpdateSchema.safeParse({ timezone: 'Not/AZone' }).success,
    ).toBe(false);
  });
});

// ── controller ──────────────────────────────────────────────────────────

describe('DisplaySchedulesController', () => {
  let controller: DisplaySchedulesController;
  let prisma: any;
  let display: any;

  // Instantiated directly rather than through Test.createTestingModule —
  // the class-level @UseGuards(JwtAuthGuard, RbacGuard) would otherwise drag
  // JwtService/ApiKeysService into the test module. Same pattern as
  // screens.fleet.spec.ts and gpio.device-auth.spec.ts. The guards are
  // covered by their own specs; what is under test here is the handler
  // logic, which is where the tenant scope actually lives.
  beforeEach(async () => {
    prisma = {
      client: {
        displaySchedule: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'ds-1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        screen: { findFirst: jest.fn().mockResolvedValue({ id: 'screen-a' }) },
        screenGroup: {
          findFirst: jest.fn().mockResolvedValue({ id: 'group-a' }),
        },
      },
    };
    display = {
      writeAudit: jest.fn().mockResolvedValue(undefined),
      notifyScheduleChanged: jest.fn(),
    };

    controller = new DisplaySchedulesController(
      prisma as unknown as PrismaService,
      display as unknown as DisplayService,
    );
  });

  describe('target validation', () => {
    it('requires exactly one of screenId / screenGroupId', async () => {
      await expect(
        controller.create(adminReq(), {
          ...baseBody,
          screenGroupId: 'group-a',
        } as any),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      const { screenId: _drop, ...noTarget } = baseBody;
      await expect(
        controller.create(adminReq(), noTarget as any),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('refuses a target screen the caller does not own — no cross-tenant reference', async () => {
      prisma.client.screen.findFirst.mockResolvedValue(null);
      await expect(
        controller.create(adminReq(), baseBody as any),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      expect(prisma.client.screen.findFirst).toHaveBeenCalledWith({
        where: { id: 'screen-a', tenantId: TENANT_A },
        select: { id: true },
      });
      expect(prisma.client.displaySchedule.create).not.toHaveBeenCalled();
    });

    it('refuses a target group the caller does not own', async () => {
      prisma.client.screenGroup.findFirst.mockResolvedValue(null);
      const { screenId: _drop, ...body } = baseBody;
      await expect(
        controller.create(adminReq(), {
          ...body,
          screenGroupId: 'group-x',
        } as any),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('caps the number of windows per target', async () => {
      prisma.client.displaySchedule.count.mockResolvedValue(20);
      await expect(
        controller.create(adminReq(), baseBody as any),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
    });
  });

  describe('tenant isolation', () => {
    it('scopes the list to the caller tenant', async () => {
      await controller.list(adminReq(TENANT_B));
      expect(prisma.client.displaySchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_B }),
        }),
      );
    });

    it('stamps the row with the caller tenant, never a body-supplied one', async () => {
      await controller.create(adminReq(TENANT_A), {
        ...baseBody,
        tenantId: TENANT_B,
      } as any);
      expect(
        prisma.client.displaySchedule.create.mock.calls[0][0].data.tenantId,
      ).toBe(TENANT_A);
    });

    it('404s an update for a row in another tenant, and writes nothing', async () => {
      prisma.client.displaySchedule.findFirst.mockResolvedValue(null);
      await expect(
        controller.update('ds-1', adminReq(TENANT_B), {
          isActive: false,
        } as any),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(prisma.client.displaySchedule.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the tenant in the mutation WHERE, not only in a preceding check', async () => {
      prisma.client.displaySchedule.findFirst.mockResolvedValue({
        id: 'ds-1',
        onTime: '07:00',
        offTime: '22:00',
      });
      await controller.update('ds-1', adminReq(TENANT_A), {
        isActive: false,
      } as any);
      expect(prisma.client.displaySchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'ds-1', tenantId: TENANT_A },
        data: { isActive: false },
      });

      await controller.remove('ds-1', adminReq(TENANT_A));
      expect(prisma.client.displaySchedule.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ds-1', tenantId: TENANT_A },
      });
    });

    it('404s a delete that matched no row in the caller tenant', async () => {
      prisma.client.displaySchedule.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        controller.remove('ds-1', adminReq(TENANT_B)),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('refuses a session carrying no tenant', async () => {
      await expect(
        controller.list({ user: { id: 'u', role: AppRole.SCHOOL_ADMIN } }),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });

  describe('audit + normalisation', () => {
    it('audits create / update / delete', async () => {
      await controller.create(adminReq(), baseBody as any);
      expect(display.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DISPLAY_AUDIT_ACTIONS.SCHEDULE_CREATED,
          tenantId: TENANT_A,
          userId: 'u1',
        }),
      );

      prisma.client.displaySchedule.findFirst.mockResolvedValue({
        id: 'ds-1',
        onTime: '07:00',
        offTime: '22:00',
      });
      await controller.update('ds-1', adminReq(), { onTime: '08:00' } as any);
      expect(display.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DISPLAY_AUDIT_ACTIONS.SCHEDULE_UPDATED,
        }),
      );

      await controller.remove('ds-1', adminReq());
      expect(display.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DISPLAY_AUDIT_ACTIONS.SCHEDULE_DELETED,
        }),
      );
    });

    it('dedupes + sorts daysOfWeek so an identical window always hashes the same', async () => {
      await controller.create(adminReq(), {
        ...baseBody,
        daysOfWeek: [5, 1, 3],
      } as any);
      expect(
        prisma.client.displaySchedule.create.mock.calls[0][0].data.daysOfWeek,
      ).toEqual([1, 3, 5]);
    });

    it('rejects an update that would collapse the window to on == off', async () => {
      prisma.client.displaySchedule.findFirst.mockResolvedValue({
        id: 'ds-1',
        onTime: '07:00',
        offTime: '22:00',
      });
      await expect(
        controller.update('ds-1', adminReq(), { offTime: '07:00' } as any),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(prisma.client.displaySchedule.updateMany).not.toHaveBeenCalled();
    });

    it('nudges the fleet to re-poll after an edit', async () => {
      await controller.create(adminReq(), baseBody as any);
      expect(display.notifyScheduleChanged).toHaveBeenCalledWith(TENANT_A);
    });
  });
});
