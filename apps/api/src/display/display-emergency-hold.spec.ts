/**
 * EMERGENCY INTERLOCK — server half.
 *
 * VenueOS screens carry lockdown / evacuation / severe-weather alerts. A
 * blanked or dimmed panel that hides an active alert can get someone hurt,
 * and nothing in display-control consulted emergency state when it was
 * built. The device holds the primary interlock; these tests pin the server
 * rule: an operator cannot ORIGINATE a blackout during an incident, and the
 * guard can NEVER stop them lighting a screen back up.
 */

import { Test } from '@nestjs/testing';

import { DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT } from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { resolveEmergencyHold } from './display-emergency-hold';
import {
  DISPLAY_EMERGENCY_HOLD_CODE,
  DisplayService,
  isDarkeningAction,
} from './display.service';

const SCREEN = { id: 'screen-1', tenantId: 'tenant-1' };

function makePrisma(
  opts: {
    override?: any;
    tenant?: any;
    ancestors?: Record<string, any>;
    throws?: boolean;
  } = {},
) {
  const ancestors = opts.ancestors ?? {};
  return {
    client: {
      screenEmergencyOverride: {
        findUnique: jest.fn(async () => {
          if (opts.throws) throw new Error('pool timeout');
          return opts.override ?? null;
        }),
      },
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === SCREEN.tenantId) {
            return (
              opts.tenant ?? {
                id: SCREEN.tenantId,
                parentId: null,
                archivedAt: null,
                emergencyStatus: 'INACTIVE',
              }
            );
          }
          return ancestors[where.id] ?? null;
        }),
      },
    },
  } as any;
}

describe('resolveEmergencyHold', () => {
  it('is inactive on a quiet tenant', async () => {
    expect(await resolveEmergencyHold(makePrisma(), SCREEN)).toEqual({
      active: false,
      source: null,
    });
  });

  it('holds on this tenant’s own emergency', async () => {
    const prisma = makePrisma({
      tenant: {
        id: SCREEN.tenantId,
        parentId: null,
        archivedAt: null,
        emergencyStatus: 'LOCKDOWN',
      },
    });
    expect(await resolveEmergencyHold(prisma, SCREEN)).toEqual({
      active: true,
      source: 'tenant',
    });
  });

  it('holds on a non-expired PER-SCREEN override even when the tenant is quiet', async () => {
    const prisma = makePrisma({
      override: { screenId: SCREEN.id, type: 'LOCKDOWN', expiresAt: null },
    });
    expect(await resolveEmergencyHold(prisma, SCREEN)).toEqual({
      active: true,
      source: 'screen',
    });
  });

  it('ignores an EXPIRED per-screen override', async () => {
    const prisma = makePrisma({
      override: {
        screenId: SCREEN.id,
        type: 'LOCKDOWN',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect((await resolveEmergencyHold(prisma, SCREEN)).active).toBe(false);
  });

  it('inherits a DISTRICT-wide emergency through the parent chain', async () => {
    const prisma = makePrisma({
      tenant: {
        id: SCREEN.tenantId,
        parentId: 'district-1',
        archivedAt: null,
        emergencyStatus: 'INACTIVE',
      },
      ancestors: {
        'district-1': {
          id: 'district-1',
          parentId: null,
          archivedAt: null,
          emergencyStatus: 'EVACUATE',
        },
      },
    });
    expect(await resolveEmergencyHold(prisma, SCREEN)).toEqual({
      active: true,
      source: 'ancestor',
    });
  });

  it('never inherits into an ARCHIVED location — same rule as the fan-out', async () => {
    const prisma = makePrisma({
      tenant: {
        id: SCREEN.tenantId,
        parentId: 'district-1',
        archivedAt: new Date(),
        emergencyStatus: 'INACTIVE',
      },
      ancestors: {
        'district-1': {
          id: 'district-1',
          parentId: null,
          archivedAt: null,
          emergencyStatus: 'LOCKDOWN',
        },
      },
    });
    expect((await resolveEmergencyHold(prisma, SCREEN)).active).toBe(false);
  });

  it('survives a parent CYCLE without spinning', async () => {
    const prisma = makePrisma({
      tenant: {
        id: SCREEN.tenantId,
        parentId: 'a',
        archivedAt: null,
        emergencyStatus: 'INACTIVE',
      },
      ancestors: {
        a: {
          id: 'a',
          parentId: 'b',
          archivedAt: null,
          emergencyStatus: 'INACTIVE',
        },
        b: {
          id: 'b',
          parentId: 'a',
          archivedAt: null,
          emergencyStatus: 'INACTIVE',
        },
      },
    });
    expect((await resolveEmergencyHold(prisma, SCREEN)).active).toBe(false);
  });

  it('FAILS CLOSED when emergency state cannot be read', async () => {
    // "We could not read emergency state" must never resolve to "go ahead
    // and black out the screen".
    expect(
      await resolveEmergencyHold(makePrisma({ throws: true }), SCREEN),
    ).toEqual({
      active: true,
      source: 'unreadable',
    });
  });

  it('is inactive for an unpaired screen and reads nothing', async () => {
    const prisma = makePrisma();
    expect(
      await resolveEmergencyHold(prisma, { id: 's', tenantId: null }),
    ).toEqual({ active: false, source: null });
    expect(
      prisma.client.screenEmergencyOverride.findUnique,
    ).not.toHaveBeenCalled();
  });
});

describe('isDarkeningAction', () => {
  it('flags exactly the actions that can hide an alert', () => {
    expect(isDarkeningAction('BLANK', {})).toBe(true);
    expect(isDarkeningAction('SET_BRIGHTNESS', { percent: 0 })).toBe(true);
    expect(
      isDarkeningAction('SET_BRIGHTNESS', {
        percent: DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT - 1,
      }),
    ).toBe(true);
    // allowBlack is darkening regardless of the action it rides on.
    expect(isDarkeningAction('WAKE', { allowBlack: true })).toBe(true);
  });

  it('never flags the recovery direction', () => {
    expect(isDarkeningAction('WAKE', {})).toBe(false);
    expect(isDarkeningAction('SET_VOLUME', { percent: 0 })).toBe(false);
    expect(isDarkeningAction('REBOOT', {})).toBe(false);
    expect(
      isDarkeningAction('SET_BRIGHTNESS', {
        percent: DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
      }),
    ).toBe(false);
    expect(isDarkeningAction('SET_BRIGHTNESS', { percent: 100 })).toBe(false);
  });
});

describe('DisplayService — emergency hold refuses only the darkening direction', () => {
  let service: DisplayService;
  let prisma: any;
  let redis: any;

  const FULL = {
    schema: 1,
    verdict: {
      volume: 'audiomanager',
      brightness: 'sysfs',
      screenBlank: 'device-owner',
      reboot: 'device-owner',
      hardPowerOff: 'none',
      deviceOwnerPath: 'held',
    },
  };

  beforeEach(async () => {
    redis = {
      publish: jest.fn().mockResolvedValue(true),
      isConnected: jest.fn().mockReturnValue(true),
    };
    prisma = {
      client: {
        screen: { update: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DisplayService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        {
          provide: WebsocketSignerService,
          useValue: {
            signMessage: jest.fn((t, p) => ({ type: t, payload: p })),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(DisplayService);
  });

  const apply = (over: Record<string, unknown>) =>
    service.applyAction({
      screenId: 'screen-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      capabilities: FULL,
      emergencyHold: { active: true, source: 'tenant' },
      ...over,
    } as any);

  it('REFUSES a BLANK while an alert is up, and never publishes', async () => {
    await expect(apply({ action: 'BLANK' })).rejects.toMatchObject({
      code: DISPLAY_EMERGENCY_HOLD_CODE,
    });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('REFUSES a dim below the legibility floor, and an allowBlack', async () => {
    await expect(
      apply({ action: 'SET_BRIGHTNESS', percent: 10 }),
    ).rejects.toMatchObject({ code: DISPLAY_EMERGENCY_HOLD_CODE });
    await expect(
      apply({
        action: 'SET_BRIGHTNESS',
        percent: 0,
        allowBlack: true,
        revertAfterMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: DISPLAY_EMERGENCY_HOLD_CODE });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('ALLOWS every recovery action while the alert is up', async () => {
    // The guard must never be able to keep an operator from lighting a screen
    // mid-incident — that would be worse than the risk it protects against.
    await expect(apply({ action: 'WAKE' })).resolves.toMatchObject({
      success: true,
    });
    await expect(
      apply({ action: 'SET_BRIGHTNESS', percent: 100 }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      apply({ action: 'SET_VOLUME', percent: 80 }),
    ).resolves.toMatchObject({ success: true });
    expect(redis.publish).toHaveBeenCalledTimes(3);
  });

  it('audits the refusal — a blank attempted during a lockdown is a real signal', async () => {
    await expect(apply({ action: 'BLANK' })).rejects.toBeTruthy();
    const details = JSON.parse(
      prisma.client.auditLog.create.mock.calls[0][0].data.details,
    );
    expect(details).toMatchObject({
      requested: 'BLANK',
      outcome: 'refused',
      code: DISPLAY_EMERGENCY_HOLD_CODE,
      emergencySource: 'tenant',
    });
  });

  it('says so plainly when the state could not be read', async () => {
    await expect(
      apply({
        action: 'BLANK',
        emergencyHold: { active: true, source: 'unreadable' },
      }),
    ).rejects.toThrow(/could not be confirmed/i);
  });

  it('does nothing at all when no hold is active', async () => {
    await expect(
      apply({
        action: 'BLANK',
        emergencyHold: { active: false, source: null },
      }),
    ).resolves.toMatchObject({ success: true });
    // …and an omitted hold defaults to "no hold" for internal callers.
    await expect(
      service.applyAction({
        screenId: 'screen-1',
        tenantId: 'tenant-1',
        userId: null,
        action: 'BLANK',
        capabilities: FULL,
      } as any),
    ).resolves.toMatchObject({ success: true });
  });
});
