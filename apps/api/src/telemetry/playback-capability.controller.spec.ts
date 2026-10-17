/**
 * GET /screens/:id/playback-capability — read-only (video guarantee step 4).
 * (Guarding is pinned by security/route-guard-inventory.spec.ts, which scans
 * every controller.) Pins: tenant scope on the screen read, the per-file rows and their names,
 * the summary, the profile precedence end to end, and that other locations'
 * screens contribute only an aggregate.
 */
import { NotFoundException } from '@nestjs/common';
import { PlaybackCapabilityController } from './playback-capability.controller';

const SHA_ORIG = 'a'.repeat(64);
const SHA_1080 = 'b'.repeat(64);

const row = (over: Record<string, unknown> = {}) => ({
  screenId: 'scr-1',
  fileSha256: SHA_ORIG,
  tenantId: 't1',
  deviceClass: 'goodview/m65guq-bop382d-c/t982/sdk30',
  fileUrl: 'https://cdn.example/t1/clip%20one.mp4',
  width: 2160,
  height: 3338,
  samples: 5,
  settledSamples: 4,
  frames: BigInt(7200),
  dropped: BigInt(4),
  stalls: 0,
  stalledMs: BigInt(0),
  consecutiveGood: 4,
  consecutiveBad: 0,
  worstPct: 0.1,
  lastPct: 0,
  lastGrade: 'smooth',
  lastSettled: true,
  engine: 'continuous',
  concurrentMax: 1,
  unitConcurrentMax: 1,
  playerVersionCode: 1126,
  webviewMajor: 95,
  verdict: 'smooth',
  firstAt: new Date('2026-10-11T18:00:00Z'),
  lastAt: new Date('2026-10-11T19:35:00Z'),
  ...over,
});

function setup(over: { screen?: any; rows?: any[]; classGroups?: any[]; caps?: any; assets?: any[]; renditions?: any[]; children?: string[] } = {}) {
  const screen = over.screen === undefined
    ? { id: 'scr-1', tenantId: 't1', playerVersionCode: 1126, displayCapabilities: { build: { manufacturer: 'Goodview', model: 'M65GUQ-BOP382D-C', device: 'T982', sdk: 30 } } }
    : over.screen;
  const prisma: any = {
    client: {
      tenant: { findMany: jest.fn(async () => (over.children ?? []).map((id) => ({ id }))) },
      screen: { findFirst: jest.fn(async () => screen) },
      screenFilePlayback: { findMany: jest.fn(async () => over.rows ?? []) },
      screenMediaCapabilities: { findFirst: jest.fn(async () => over.caps ?? null) },
      asset: { findMany: jest.fn(async () => over.assets ?? []) },
      // Two raw reads: the class aggregate (screen_file_playback) and the
      // 1080p-copy name lookup (assets). Told apart by their SQL.
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('FROM screen_file_playback') ? over.classGroups ?? [] : over.renditions ?? []),
    },
  };
  return { prisma, controller: new PlaybackCapabilityController(prisma) };
}

const user = (over: Record<string, unknown> = {}) => ({ user: { id: 'u1', role: 'SCHOOL_ADMIN', tenantId: 't1', ...over } });

describe('GET /screens/:id/playback-capability', () => {
  it('scopes the screen read to the active workspace + its child locations and 404s otherwise', async () => {
    const { prisma, controller } = setup({ screen: null, children: ['t1-school'] });
    await expect(controller.get('scr-x', user())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.tenant.findMany.mock.calls[0][0].where).toEqual({ parentId: 't1', archivedAt: null });
    expect(prisma.client.screen.findFirst.mock.calls[0][0].where).toEqual({ id: 'scr-x', tenantId: { in: ['t1', 't1-school'] } });
    expect(prisma.client.screenFilePlayback.findMany).not.toHaveBeenCalled();
  });

  it('a SUPER_ADMIN is scoped to the workspace too — never an unscoped read', async () => {
    const { prisma, controller } = setup();
    await controller.get('scr-1', user({ role: 'SUPER_ADMIN' }));
    expect(prisma.client.screen.findFirst.mock.calls[0][0].where).toEqual({ id: 'scr-1', tenantId: { in: ['t1'] } });
  });

  it('a caller with no tenant gets a 404 without any read', async () => {
    const { prisma, controller } = setup();
    await expect(controller.get('scr-1', { user: { role: 'SCHOOL_ADMIN' } })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.screen.findFirst).not.toHaveBeenCalled();
  });

  it('never measured → unknown, with the class default as the profile', async () => {
    const { controller } = setup();
    const out = await controller.get('scr-1', user());
    expect(out.summary).toBe('unknown');
    expect(out.files).toEqual([]);
    expect(out.capability).toMatchObject({ deviceClass: 'goodview/m65guq-bop382d-c/t982/sdk30', maxShortEdge: 2160, evidence: 'class-default' });
    expect(out.declared).toBeNull();
  });

  it('per-file rows: names resolved in THIS location only (original and 1080p copy), summary and profile', async () => {
    const { prisma, controller } = setup({
      rows: [
        row(),
        row({ fileSha256: SHA_1080, width: 1080, height: 1668, verdict: 'stuttering', consecutiveGood: 0, consecutiveBad: 3, dropped: BigInt(3900), frames: BigInt(7200), unitConcurrentMax: 2 }),
      ],
      assets: [{ id: 'asset-1', originalName: 'Fall promo.mp4', fileUrl: 'x', fileHash: SHA_ORIG }],
      renditions: [{ id: 'asset-1', originalName: 'Fall promo.mp4', fileUrl: 'x', sha: SHA_1080 }],
      caps: { report: { webviewMajor: 95, configs: [{ id: '2160p30-portrait', supported: true, smooth: true, powerEfficient: true }] }, webviewMajor: 95, reportedAt: new Date('2026-10-11T18:00:00Z') },
    });
    const out = await controller.get('scr-1', user());
    expect(prisma.client.screenFilePlayback.findMany.mock.calls[0][0].where).toEqual({ screenId: 'scr-1', tenantId: 't1' });
    expect(prisma.client.asset.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', fileHash: { in: [SHA_ORIG, SHA_1080] } });
    expect(out.summary).toBe('stutters');
    expect(out.files[0]).toMatchObject({ name: 'Fall promo.mp4', assetId: 'asset-1', copy: 'original', verdict: 'smooth', droppedPct: 0.1, settledSamples: 4 });
    expect(out.files[1]).toMatchObject({ copy: '1080p', verdict: 'stuttering', droppedPct: 54.2, unitConcurrentMax: 2 });
    expect(out.capability).toMatchObject({ maxShortEdge: 2160, evidence: 'measured-screen', maxUnitConcurrentVideos: 1, concurrencyEvidence: 'measured-screen', stale: false });
    expect(out.declared).toEqual({ reportedAt: '2026-10-11T18:00:00.000Z', maxShortEdge: 2160, webviewMajor: 95 });
  });

  it('a file not in this location keeps only its file name', async () => {
    const { controller } = setup({ rows: [row()] });
    const out = await controller.get('scr-1', user());
    expect(out.files[0]).toMatchObject({ name: 'clip one.mp4', assetId: null, copy: null });
  });

  it('samples recorded without grading (2026-10-17 guard) reach the drawer: count, last reason and when', async () => {
    const { controller } = setup({
      rows: [
        row({ excludedSamples: 3, excludedReason: 'page-load', excludedAt: new Date('2026-10-17T09:02:04.329Z') }),
        row({ fileSha256: SHA_1080, excludedReason: 'not-a-reason', excludedSamples: null }),
      ],
    });
    const out = await controller.get('scr-1', user());
    expect(out.files[0]).toMatchObject({ excludedSamples: 3, excludedReason: 'page-load', excludedAt: '2026-10-17T09:02:04.329Z' });
    // A row from before the guard, or a value it does not know, reads as "none".
    expect(out.files[1]).toMatchObject({ excludedSamples: 0, excludedReason: null, excludedAt: null });
  });

  it('same-model evidence from other locations arrives as SQL aggregates only — no foreign row is ever read', async () => {
    const { prisma, controller } = setup({
      // A 4K-panel screen that only ever played 1080p here, and its model smooth at 4K on 3 other screens.
      rows: [row({ width: 1080, height: 1920, deviceClass: 'acme/box-9/x/sdk30' })],
      classGroups: [{ verdict: 'smooth', se: 2160, unit: 1, at: new Date('2026-10-11T19:00:00Z'), screens: 3 }],
    });
    const out = await controller.get('scr-1', user());
    const raw = prisma.client.$queryRaw.mock.calls.find((c: any[]) => c[0].join('?').includes('FROM screen_file_playback'));
    expect(raw).toBeDefined();
    expect(raw.slice(1)).toEqual(['acme/box-9/x/sdk30', 'scr-1', 200]);
    // The class query never goes through the model API (which returns rows).
    for (const c of prisma.client.screenFilePlayback.findMany.mock.calls) expect(c[0].where).toEqual({ screenId: 'scr-1', tenantId: 't1' });
    expect(out.capability).toMatchObject({ maxShortEdge: 2160, evidence: 'measured-class', classScreens: 3 });
  });
});
