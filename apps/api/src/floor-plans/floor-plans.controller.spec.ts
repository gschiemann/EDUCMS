/**
 * Floor-plan image REPLACE — the pin-geometry contract (2026-08-25).
 *
 * Operator: "add change so i can swap images and not just delete and add".
 * Before this, correcting a drawing meant delete + re-upload, and DELETE
 * detaches every screen placed on the plan — so the swap cost the operator
 * all of their pin-placement work.
 *
 * Screen.floorX/floorY are ABSOLUTE PIXELS in the plan image's coordinate
 * space, and the UI draws them as a fraction of the plan box
 * (left% = floorX / plan.widthPx). These tests pin the consequences:
 *
 *   - a replace NEVER detaches or zeroes a placement;
 *   - a same-shape replace keeps every pin on the same physical spot, which
 *     means the stored pixels must be RESCALED, not left alone;
 *   - a different-shape replace is reported (aspectRatioChanged) so the UI
 *     can warn instead of silently moving somebody's screens;
 *   - the swap is tenant-scoped — another tenant's plan id 404s before a
 *     single byte is uploaded.
 *
 * The controller is instantiated directly with lightweight fakes, the same
 * pattern assets-upload-caps.controller.spec.ts uses — this exercises the
 * real handler without standing up the Nest DI graph.
 */

import { HttpException } from '@nestjs/common';
import { FloorPlansController } from './floor-plans.controller';

// ─── Fixtures ─────────────────────────────────────────────────────

/**
 * Minimal but REAL PNG header, so the controller's server-side dimension
 * probe reads these dimensions off the bytes rather than trusting the
 * client — which is the whole point of the probe.
 */
function pngOf(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function fileOf(width: number, height: number): any {
  return {
    buffer: pngOf(width, height),
    mimetype: 'image/png',
    originalname: 'floor-1.png',
  };
}

/** What the real client posts alongside the file. The server re-probes the
 *  bytes anyway and overrides these — see the probe test below. */
function dims(width: number, height: number) {
  return { widthPx: String(width), heightPx: String(height) };
}

type ScreenRow = {
  id: string;
  tenantId: string;
  floorPlanId: string | null;
  floorX: number | null;
  floorY: number | null;
};

function makePrisma(opts: {
  plans?: any[];
  screens?: ScreenRow[];
} = {}) {
  const plans = opts.plans ?? [
    {
      id: 'plan-1',
      tenantId: 'tenant-1',
      name: 'Lincoln HS — Floor 1',
      buildingLabel: 'Main',
      floorLabel: '1',
      imageUrl: 'https://x.supabase.co/storage/v1/object/floor-plans/tenant-1/floor-plans/old.png',
      widthPx: 1000,
      heightPx: 500,
    },
  ];
  const screens: ScreenRow[] = opts.screens ?? [];
  const audits: any[] = [];
  const transactions: any[][] = [];

  const client = {
    floorPlan: {
      findFirst: jest.fn(async ({ where }: any) =>
        plans.find((p) => p.id === where.id && p.tenantId === where.tenantId) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = plans.find((p) => p.id === where.id);
        Object.assign(row, data);
        return { ...row };
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 'plan-new', ...data })),
      delete: jest.fn(async () => ({})),
    },
    screen: {
      findMany: jest.fn(async ({ where }: any) =>
        screens
          .filter(
            (s) =>
              s.tenantId === where.tenantId &&
              s.floorPlanId === where.floorPlanId &&
              s.floorX != null &&
              s.floorY != null,
          )
          .map((s) => ({ id: s.id, floorX: s.floorX, floorY: s.floorY })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = screens.filter(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            s.tenantId === where.tenantId &&
            s.floorPlanId === where.floorPlanId,
        );
        for (const s of hit) Object.assign(s, data);
        return { count: hit.length };
      }),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return { id: `audit-${audits.length}` };
      }),
    },
    // Ops are already-running promises in these fakes; awaiting them all is
    // the closest honest stand-in for Prisma's batched transaction.
    $transaction: jest.fn(async (ops: any[]) => {
      transactions.push(ops);
      return Promise.all(ops);
    }),
  };

  return { client, plans, screens, audits, transactions } as any;
}

function makeStorage() {
  return {
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    floorPlanBucketName: () => 'floor-plans',
    uploadToBucket: jest.fn(
      async (bucket: string, path: string) =>
        `https://x.supabase.co/storage/v1/object/${bucket}/${path}`,
    ),
    parseObjectUrl: (url: string) => ({ bucket: 'floor-plans', path: url.split('/').pop() as string }),
    createSignedUrl: jest.fn(async () => 'https://x.supabase.co/signed/abc?token=t'),
  } as any;
}

function makeController(prisma: any, storage: any = makeStorage()) {
  return { controller: new FloorPlansController(prisma, storage), storage };
}

const adminReq = { user: { tenantId: 'tenant-1', id: 'user-1', role: 'SCHOOL_ADMIN' } };

function placedScreens(): ScreenRow[] {
  return [
    // Dead centre of a 1000×500 plan.
    { id: 'screen-1', tenantId: 'tenant-1', floorPlanId: 'plan-1', floorX: 500, floorY: 250 },
    // Bottom-right corner.
    { id: 'screen-2', tenantId: 'tenant-1', floorPlanId: 'plan-1', floorX: 1000, floorY: 500 },
    // Placed on a DIFFERENT plan — must not be touched by this swap.
    { id: 'screen-3', tenantId: 'tenant-1', floorPlanId: 'plan-2', floorX: 10, floorY: 10 },
    // Paired but unplaced.
    { id: 'screen-4', tenantId: 'tenant-1', floorPlanId: null, floorX: null, floorY: null },
  ];
}

// ─── Replace keeps the placements ─────────────────────────────────

describe('PUT /floor-plans/:id — replace image keeps placements', () => {
  it('never detaches a screen: every pin survives the swap', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    const res: any = await controller.update(adminReq, 'plan-1', fileOf(2000, 1000), dims(2000, 1000));

    expect(res.imageReplace.placementsKept).toBe(2);
    const onPlan = prisma.screens.filter((s: ScreenRow) => s.floorPlanId === 'plan-1');
    expect(onPlan).toHaveLength(2);
    for (const s of onPlan) {
      expect(s.floorX).not.toBeNull();
      expect(s.floorY).not.toBeNull();
    }
    // The delete path's detach (floorPlanId: null) must never run here.
    expect(
      prisma.client.screen.updateMany.mock.calls.some(
        ([args]: any) => args?.data?.floorPlanId === null,
      ),
    ).toBe(false);
  });

  it('same aspect ratio: pins land on the SAME physical spot (fraction preserved)', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    // 1000×500 → 2000×1000. Same 2:1 shape, twice the pixels.
    const res: any = await controller.update(adminReq, 'plan-1', fileOf(2000, 1000), dims(2000, 1000));

    expect(res.imageReplace.aspectRatioChanged).toBe(false);
    const centre = prisma.screens.find((s: ScreenRow) => s.id === 'screen-1')!;
    const corner = prisma.screens.find((s: ScreenRow) => s.id === 'screen-2')!;
    // Centre stays the centre; corner stays the corner.
    expect(centre.floorX).toBe(1000);
    expect(centre.floorY).toBe(500);
    expect(corner.floorX).toBe(2000);
    expect(corner.floorY).toBe(1000);
    // Same fraction of the plan, which is what the UI actually renders.
    expect(centre.floorX! / res.widthPx).toBeCloseTo(0.5, 10);
    expect(centre.floorY! / res.heightPx).toBeCloseTo(0.5, 10);
  });

  it('identical dimensions: coordinates are left exactly as they were', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    const res: any = await controller.update(adminReq, 'plan-1', fileOf(1000, 500), dims(1000, 500));

    expect(res.imageReplace.placementsKept).toBe(2);
    expect(prisma.screens.find((s: ScreenRow) => s.id === 'screen-1')!.floorX).toBe(500);
    expect(prisma.screens.find((s: ScreenRow) => s.id === 'screen-2')!.floorY).toBe(500);
    // No pointless writes when the scale factor is 1.
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
  });

  it('a different aspect ratio is reported, and still keeps every pin', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    // 2:1 landscape → 1:2 portrait. Same fraction, very different picture.
    const res: any = await controller.update(adminReq, 'plan-1', fileOf(500, 1000), dims(500, 1000));

    expect(res.imageReplace.aspectRatioChanged).toBe(true);
    expect(res.imageReplace.placementsKept).toBe(2);
    const centre = prisma.screens.find((s: ScreenRow) => s.id === 'screen-1')!;
    expect(centre.floorX).toBe(250);
    expect(centre.floorY).toBe(500);
  });

  it('a re-export at a slightly different size is NOT called a shape change', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    // 1000×500 (2.0) → 1499×750 (1.9987) — rounding, not a reframe.
    const res: any = await controller.update(adminReq, 'plan-1', fileOf(1499, 750), dims(1499, 750));

    expect(res.imageReplace.aspectRatioChanged).toBe(false);
  });

  it('leaves screens on OTHER plans, and unplaced screens, alone', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    await controller.update(adminReq, 'plan-1', fileOf(2000, 1000), dims(2000, 1000));

    const other = prisma.screens.find((s: ScreenRow) => s.id === 'screen-3')!;
    expect(other.floorX).toBe(10);
    expect(other.floorY).toBe(10);
    const unplaced = prisma.screens.find((s: ScreenRow) => s.id === 'screen-4')!;
    expect(unplaced.floorPlanId).toBeNull();
    expect(unplaced.floorX).toBeNull();
  });

  it('clamps a historically out-of-bounds pin into the new plan', async () => {
    const prisma = makePrisma({
      screens: [
        { id: 'screen-9', tenantId: 'tenant-1', floorPlanId: 'plan-1', floorX: 4000, floorY: -20 },
      ],
    });
    const { controller } = makeController(prisma);

    const res: any = await controller.update(adminReq, 'plan-1', fileOf(500, 250), dims(500, 250));

    const s = prisma.screens[0];
    expect(s.floorX).toBe(res.widthPx);
    expect(s.floorY).toBe(0);
  });

  it('moves the pins and the dimensions in ONE transaction', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    await controller.update(adminReq, 'plan-1', fileOf(2000, 1000), dims(2000, 1000));

    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    // 2 placement writes + the plan row itself.
    expect(prisma.transactions[0]).toHaveLength(3);
  });
});

// ─── Tenant scoping ───────────────────────────────────────────────

describe('PUT /floor-plans/:id — tenant scoping', () => {
  it("404s on another tenant's plan id, and uploads nothing", async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller, storage } = makeController(prisma);
    const otherTenantReq = { user: { tenantId: 'tenant-2', id: 'user-9', role: 'SCHOOL_ADMIN' } };

    await expect(
      controller.update(otherTenantReq, 'plan-1', fileOf(2000, 1000), dims(2000, 1000)),
    ).rejects.toMatchObject({ status: 404 });

    expect(storage.uploadToBucket).not.toHaveBeenCalled();
    expect(prisma.client.floorPlan.update).not.toHaveBeenCalled();
    // The victim tenant's pins are untouched.
    expect(prisma.screens.find((s: ScreenRow) => s.id === 'screen-1')!.floorX).toBe(500);
  });

  it('scopes every placement write by tenant AND plan — never a bare id', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    await controller.update(adminReq, 'plan-1', fileOf(2000, 1000), dims(2000, 1000));

    for (const [args] of prisma.client.screen.updateMany.mock.calls) {
      expect(args.where.tenantId).toBe('tenant-1');
      expect(args.where.floorPlanId).toBe('plan-1');
    }
  });

  it('reads the plan tenant-scoped before doing anything', async () => {
    const prisma = makePrisma();
    const { controller } = makeController(prisma);

    await controller.update(adminReq, 'plan-1', fileOf(800, 400), dims(800, 400));

    expect(prisma.client.floorPlan.findFirst).toHaveBeenCalledWith({
      where: { id: 'plan-1', tenantId: 'tenant-1' },
    });
  });
});

// ─── Audit + response ─────────────────────────────────────────────

describe('PUT /floor-plans/:id — audit and response', () => {
  it('audits the swap with the previous image and the pin verdict', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    await controller.update(adminReq, 'plan-1', fileOf(500, 1000), dims(500, 1000));

    const row = prisma.audits.find((a: any) => a.action === 'REPLACE_FLOOR_PLAN_IMAGE');
    expect(row).toBeTruthy();
    expect(row.tenantId).toBe('tenant-1');
    expect(row.userId).toBe('user-1');
    expect(row.targetType).toBe('floor_plan');
    expect(row.targetId).toBe('plan-1');
    const details = JSON.parse(row.details);
    expect(details.previousImageUrl).toContain('old.png');
    expect(details.previousWidthPx).toBe(1000);
    expect(details.widthPx).toBe(500);
    expect(details.aspectRatioChanged).toBe(true);
    expect(details.placementsKept).toBe(2);
  });

  it('returns a SIGNED image url — never the private-bucket one', async () => {
    const prisma = makePrisma();
    const { controller, storage } = makeController(prisma);

    const res: any = await controller.update(adminReq, 'plan-1', fileOf(800, 400), dims(800, 400));

    expect(storage.createSignedUrl).toHaveBeenCalled();
    expect(res.imageUrl).toBe('https://x.supabase.co/signed/abc?token=t');
  });

  it('probes the real dimensions instead of believing the client', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    // Client claims 100×100; the bytes say 2000×1000. A lie here would move
    // every pin, so the probe must win.
    const res: any = await controller.update(adminReq, 'plan-1', fileOf(2000, 1000), {
      widthPx: '100',
      heightPx: '100',
    });

    expect(res.widthPx).toBe(2000);
    expect(res.heightPx).toBe(1000);
    expect(prisma.screens.find((s: ScreenRow) => s.id === 'screen-1')!.floorX).toBe(1000);
  });
});

// ─── Rename-only path is unchanged ────────────────────────────────

describe('PUT /floor-plans/:id — rename still works', () => {
  it('renames without a file: no upload, no pin writes, no replace summary', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller, storage } = makeController(prisma);

    const res: any = await controller.update(adminReq, 'plan-1', undefined, {
      name: '  Lincoln HS — Floor 1 (remodel)  ',
      floorLabel: '1A',
    });

    expect(storage.uploadToBucket).not.toHaveBeenCalled();
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
    expect(res.imageReplace).toBeUndefined();
    expect(res.name).toBe('Lincoln HS — Floor 1 (remodel)');
    expect(res.floorLabel).toBe('1A');
    expect(prisma.audits.some((a: any) => a.action === 'REPLACE_FLOOR_PLAN_IMAGE')).toBe(false);
  });

  it('404s a rename on a plan the caller does not own', async () => {
    const prisma = makePrisma();
    const { controller } = makeController(prisma);
    const otherTenantReq = { user: { tenantId: 'tenant-2', id: 'user-9', role: 'SCHOOL_ADMIN' } };

    await expect(
      controller.update(otherTenantReq, 'plan-1', undefined, { name: 'Mine now' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('a dropped file on a declared swap is an error, not a silent no-op', async () => {
    const prisma = makePrisma({ screens: placedScreens() });
    const { controller } = makeController(prisma);

    // multer's fileFilter drops a PDF/oversize file: `file` arrives undefined
    // even though the operator picked one.
    await expect(
      controller.update(adminReq, 'plan-1', undefined, { replaceImage: '1' }),
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.client.floorPlan.update).not.toHaveBeenCalled();
  });
});
