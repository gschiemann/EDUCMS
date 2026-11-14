/**
 * Per-screen emergency routes — request schema (F2) and floor-reference
 * ownership (F3), security review 2026-11-14.
 *
 * F2: `POST :screenId/trigger` and `POST bulk-trigger` were the only emergency
 *     routes without a schema. A bulk body with no `override` threw a
 *     TypeError (500, not 400) and `screenIds` entries reached Prisma untyped.
 *     The schema keeps free text LENIENT (truncated later, never refused): an
 *     alert must not fail because its note ran long.
 * F3: `floorPlanId` / `floorZoneId` were stored and broadcast without the
 *     tenant check `playlistId` gets. Nothing resolves them today, but the
 *     first feature that showed "the plan named in the alert" would have shown
 *     another school's floor plan.
 */
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { HttpException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import {
  ScreenEmergencyController,
  OverrideInputSchema,
  BulkTriggerInputSchema,
} from './screen-emergency.controller';
import { ZodValidationPipe } from '../security/zod-validation.pipe';

const A = 'tenant-a';
const B = 'tenant-b';

const screens = [
  { id: 'scr-a1', tenantId: A },
  { id: 'scr-a2', tenantId: A },
  { id: 'scr-b1', tenantId: B },
];
const plans = [
  { id: 'plan-a', tenantId: A },
  { id: 'plan-a2', tenantId: A },
  { id: 'plan-b', tenantId: B },
];
const zones = [
  { id: 'zone-a', floorPlanId: 'plan-a' },
  { id: 'zone-a-other', floorPlanId: 'plan-a2' },
  { id: 'zone-b', floorPlanId: 'plan-b' },
];

function inTenant(where: any, tenantId: string): boolean {
  if (!where) return true;
  if (typeof where === 'string') return where === tenantId;
  if (Array.isArray(where.in)) return where.in.includes(tenantId);
  return true;
}

function makeController() {
  const client = {
    screen: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          screens.find(
            (s) => s.id === where.id && inTenant(where.tenantId, s.tenantId),
          ) ?? null,
      ),
      findUnique: jest.fn(
        async ({ where }: any) =>
          screens.find((s) => s.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        screens.filter(
          (s) =>
            where.id.in.includes(s.id) &&
            (!where.tenantId || s.tenantId === where.tenantId),
        ),
      ),
    },
    playlist: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    floorPlan: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          plans.find(
            (p) => p.id === where.id && inTenant(where.tenantId, p.tenantId),
          ) ?? null,
      ),
    },
    floorZone: {
      findFirst: jest.fn(async ({ where }: any) => {
        const z = zones.find((x) => x.id === where.id);
        const plan = z && plans.find((p) => p.id === z.floorPlanId);
        if (!z || !plan || !inTenant(where.floorPlan?.tenantId, plan.tenantId))
          return null;
        return {
          floorPlanId: z.floorPlanId,
          floorPlan: { tenantId: plan.tenantId },
        };
      }),
    },
  };
  const ctrl = new ScreenEmergencyController(
    { client } as any,
    {} as any,
    {} as any,
  );
  // Isolate the checks: the write + broadcast path has its own suites.
  const created = jest
    .spyOn(ctrl as any, 'createOverrideAndBroadcast')
    .mockImplementation(async (opts: any) => ({
      overrideId: `ovr-${opts.screen.id}`,
    }));
  return { ctrl, client, created };
}

const adminA = { user: { id: 'u-a', role: AppRole.SCHOOL_ADMIN, tenantId: A } };
const superAdmin = { user: { id: 'u-s', role: AppRole.SUPER_ADMIN } };

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

describe('F2 — the schemas are wired into both routes', () => {
  function bodyPipes(handler: 'trigger' | 'bulkTrigger') {
    const meta =
      Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        ScreenEmergencyController,
        handler,
      ) ?? {};
    return Object.values(meta).flatMap((arg: any) => arg.pipes ?? []);
  }
  it.each(['trigger', 'bulkTrigger'] as const)(
    '%s validates its body with a ZodValidationPipe',
    (h) => {
      expect(
        bodyPipes(h).some((p: unknown) => p instanceof ZodValidationPipe),
      ).toBe(true);
    },
  );
});

describe('F2 — bulk-trigger input', () => {
  const pipe = new ZodValidationPipe(BulkTriggerInputSchema);
  const meta = {} as any;

  it('a missing override is a 400, not a TypeError 500', () => {
    expect(() => pipe.transform({ screenIds: ['scr-a1'] }, meta)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('non-string or empty screen ids are refused before Prisma', () => {
    for (const screenIds of [[{ $ne: null }], [42], [''], [], 'scr-a1']) {
      expect(() =>
        pipe.transform({ screenIds, override: { type: 'LOCKDOWN' } }, meta),
      ).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('a long note or text is still accepted (truncated later, never refused)', () => {
    const out = pipe.transform(
      {
        screenIds: ['scr-a1'],
        override: {
          type: 'LOCKDOWN',
          scopeNote: 'x'.repeat(5_000),
          textBlob: 'y'.repeat(9_000),
        },
      },
      meta,
    );
    expect(out.override.scopeNote).toHaveLength(5_000);
  });

  it('null optional fields are accepted, as the old handler accepted them', () => {
    expect(() =>
      new ZodValidationPipe(OverrideInputSchema).transform(
        {
          type: 'LOCKDOWN',
          playlistId: null,
          mediaUrl: null,
          floorPlanId: null,
          expiresAt: null,
        },
        meta,
      ),
    ).not.toThrow();
  });

  it('scenarioId is held to a short safe label (there is no scenario table yet)', () => {
    const p = new ZodValidationPipe(OverrideInputSchema);
    expect(() =>
      p.transform({ type: 'LOCKDOWN', scenarioId: 'gym-lockdown_2' }, meta),
    ).not.toThrow();
    for (const bad of ['<script>', 'a'.repeat(65), 'a b', '']) {
      expect(() =>
        p.transform({ type: 'LOCKDOWN', scenarioId: bad }, meta),
      ).toThrow();
    }
  });
});

describe('F3 — floor plan / zone ids must belong to the targeted tenant', () => {
  it('own plan + own zone on that plan → triggers', async () => {
    const { ctrl, created } = makeController();
    await expect(
      status(
        ctrl.trigger(adminA, 'scr-a1', {
          type: 'LOCKDOWN',
          floorPlanId: 'plan-a',
          floorZoneId: 'zone-a',
        }),
      ),
    ).resolves.toBe(200);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it("another tenant's floor plan → 404, nothing written", async () => {
    const { ctrl, created } = makeController();
    await expect(
      status(
        ctrl.trigger(adminA, 'scr-a1', {
          type: 'LOCKDOWN',
          floorPlanId: 'plan-b',
        }),
      ),
    ).resolves.toBe(404);
    expect(created).not.toHaveBeenCalled();
  });

  it("another tenant's zone → 404, nothing written", async () => {
    const { ctrl, created } = makeController();
    await expect(
      status(
        ctrl.trigger(adminA, 'scr-a1', {
          type: 'LOCKDOWN',
          floorZoneId: 'zone-b',
        }),
      ),
    ).resolves.toBe(404);
    expect(created).not.toHaveBeenCalled();
  });

  it('a zone that is not on the named plan → 404', async () => {
    const { ctrl, created } = makeController();
    await expect(
      status(
        ctrl.trigger(adminA, 'scr-a1', {
          type: 'LOCKDOWN',
          floorPlanId: 'plan-a',
          floorZoneId: 'zone-a-other',
        }),
      ),
    ).resolves.toBe(404);
    expect(created).not.toHaveBeenCalled();
  });

  it('bulk: refused unless the plan belongs to EVERY targeted tenant', async () => {
    const { ctrl, created } = makeController();
    // Same tenant: fine.
    await expect(
      status(
        ctrl.bulkTrigger(adminA, {
          screenIds: ['scr-a1', 'scr-a2'],
          override: { type: 'LOCKDOWN', floorPlanId: 'plan-a' },
        }),
      ),
    ).resolves.toBe(200);
    expect(created).toHaveBeenCalledTimes(2);
    created.mockClear();
    // SUPER_ADMIN spanning two tenants with tenant A's plan: refused.
    await expect(
      status(
        ctrl.bulkTrigger(superAdmin, {
          screenIds: ['scr-a1', 'scr-b1'],
          override: { type: 'LOCKDOWN', floorPlanId: 'plan-a' },
        }),
      ),
    ).resolves.toBe(404);
    expect(created).not.toHaveBeenCalled();
  });

  it('no floor ids → no floor lookups at all (the common alert path is untouched)', async () => {
    const { ctrl, client } = makeController();
    await ctrl.trigger(adminA, 'scr-a1', { type: 'LOCKDOWN' });
    await ctrl.bulkTrigger(adminA, {
      screenIds: ['scr-a1'],
      override: { type: 'EVACUATE' },
    });
    expect(client.floorPlan.findFirst).not.toHaveBeenCalled();
    expect(client.floorZone.findFirst).not.toHaveBeenCalled();
  });
});
