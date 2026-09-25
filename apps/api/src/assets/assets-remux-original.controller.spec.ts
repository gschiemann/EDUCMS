/**
 * assets-remux-original.controller.spec.ts — DELETE /assets/:id and the
 * original a fast-start re-mux kept.
 *
 * VideoPosterService moves a moov-last video's row onto a lossless fast-start
 * copy and KEEPS the original (widget configs and other rows hold copies of
 * its URL), recording it as `processingMeta.remux.previousStoragePath`. The
 * asset owns that original: deleting the asset deletes it too — but only in
 * the shape the swap records, and never while another row still points at it.
 */
import type { AiAltTextService } from '../ai/ai-alt-text.service';
import type { EmailService } from '../email/email.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MediaOptimizationService } from '../storage/media-optimization.service';
import type { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { VideoPosterService } from '../storage/video-poster.service';
import { AssetsController } from './assets.controller';

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';
const COPY = 't1/0c5e-clip-faststart-1a2b3c4d.mp4';
const ORIGINAL = 't1/0c5e-clip.mp4';
const REQ = { user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } };

interface AssetFixture {
  id: string;
  tenantId: string;
  fileUrl: string;
  mimeType: string;
  posterUrl: string | null;
  processingMeta: unknown;
}
interface CountWhere {
  fileUrl: string;
  id: { not: string };
}

/** A video row the re-mux already moved onto its fast-start copy. */
const remuxedAsset = (over: Partial<AssetFixture> = {}): AssetFixture => ({
  id: 'a1',
  tenantId: 't1',
  fileUrl: `${PREFIX}${COPY}`,
  mimeType: 'video/mp4',
  posterUrl: null,
  processingMeta: {
    probe: { fastStart: true },
    remux: {
      at: '2026-09-24T12:00:00.000Z',
      reason: 'fast-start',
      previousStoragePath: ORIGINAL,
      bytesBefore: 1000,
      bytesAfter: 1000,
    },
  },
  ...over,
});

function makeController(
  asset: AssetFixture,
  opts: { stillUsed?: number | Error } = {},
) {
  const deleted: string[] = [];
  const counted: CountWhere[] = [];
  const tx = {
    asset: {
      findFirst: jest.fn(() => Promise.resolve({ ...asset })),
      count: jest.fn((args: { where: CountWhere }) => {
        counted.push(args.where);
        // `stillUsed` answers for the kept ORIGINAL; the row's own file is
        // always the row's alone here (its own guard has its own spec).
        const used =
          args.where.fileUrl === `${PREFIX}${ORIGINAL}`
            ? (opts.stillUsed ?? 0)
            : 0;
        return used instanceof Error
          ? Promise.reject(used)
          : Promise.resolve(used);
      }),
      delete: jest.fn(() => Promise.resolve({})),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
    playlistItem: {
      findMany: jest.fn(() => Promise.resolve([])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  };
  const client = {
    ...tx,
    screen: { findFirst: jest.fn(() => Promise.resolve(null)) },
    playlistItem: {
      findMany: jest.fn(() => Promise.resolve([])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const storage = {
    extractPath: (u: string) =>
      u.startsWith(PREFIX) ? u.slice(PREFIX.length) : null,
    publicUrlForPath: (p: string) => `${PREFIX}${p}`,
    delete: jest.fn((p: string) => {
      deleted.push(p);
      return Promise.resolve();
    }),
  };
  const controller = new AssetsController(
    { client } as unknown as PrismaService,
    storage as unknown as SupabaseStorageService,
    {} as unknown as EmailService,
    {} as unknown as MediaOptimizationService,
    {} as unknown as AiAltTextService,
    {} as unknown as VideoPosterService,
  );
  return { controller, deleted, counted, client };
}

describe('DELETE /assets/:id — the original a fast-start re-mux kept', () => {
  it('deletes the fast-start copy AND the kept original with the asset', async () => {
    const { controller, deleted, counted, client } =
      makeController(remuxedAsset());

    await expect(controller.remove(REQ, 'a1')).resolves.toEqual({
      deleted: true,
    });

    expect(deleted).toEqual([COPY, ORIGINAL]);
    // Asked across EVERY tenant whether any other row still uses either file.
    expect(counted).toEqual([
      { fileUrl: `${PREFIX}${COPY}`, id: { not: 'a1' } },
      { fileUrl: `${PREFIX}${ORIGINAL}`, id: { not: 'a1' } },
    ]);
    expect(client.asset.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps the original while another row still points at it', async () => {
    const { controller, deleted } = makeController(remuxedAsset(), {
      stillUsed: 1,
    });
    await controller.remove(REQ, 'a1');
    expect(deleted).toEqual([COPY]);
  });

  it('keeps the original when that cannot be confirmed — and still deletes the asset', async () => {
    const { controller, deleted } = makeController(remuxedAsset(), {
      stillUsed: new Error('pool timeout'),
    });
    await expect(controller.remove(REQ, 'a1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleted).toEqual([COPY]);
  });

  it("never deletes a recorded path outside the asset's own tenant folder", async () => {
    const { controller, deleted, counted } = makeController(
      remuxedAsset({
        processingMeta: {
          remux: { previousStoragePath: 't2/their-video.mp4' },
        },
      }),
    );
    await controller.remove(REQ, 'a1');
    expect(deleted).toEqual([COPY]);
    expect(counted).toEqual([
      { fileUrl: `${PREFIX}${COPY}`, id: { not: 'a1' } },
    ]);
  });

  it('a video that was never re-muxed deletes exactly as before', async () => {
    const { controller, deleted, counted } = makeController(
      remuxedAsset({
        fileUrl: `${PREFIX}${ORIGINAL}`,
        processingMeta: { probe: { fastStart: true } },
      }),
    );
    await controller.remove(REQ, 'a1');
    expect(deleted).toEqual([ORIGINAL]);
    expect(counted).toEqual([
      { fileUrl: `${PREFIX}${ORIGINAL}`, id: { not: 'a1' } },
    ]);
  });
});
