/**
 * assets-delete-shared-file.controller.spec.ts — DELETE /assets/:id and the
 * stored file (2026-09-24).
 *
 * The row always goes. The BYTES go only when this row was their last holder
 * and they live in this tenant's own folder: fleet distribution gives every
 * child location a row that points at the parent's object, so a school
 * deleting its copy used to blank the district's and every sibling's video;
 * and a URL asset pointing into another tenant's folder let an admin delete
 * that tenant's file. Found while building the fast-start re-mux, whose kept
 * original takes the same guard (assets-remux-original.controller.spec.ts).
 */
import type { AiAltTextService } from '../ai/ai-alt-text.service';
import type { EmailService } from '../email/email.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MediaOptimizationService } from '../storage/media-optimization.service';
import type { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { VideoPosterService } from '../storage/video-poster.service';
import { AssetsController } from './assets.controller';

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';
const OWN = 't1/0c5e-clip.mp4';
const THEIRS = 't2/their-video.mp4';
const REQ = { user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } };

interface CountWhere {
  fileUrl: string;
  id: { not: string };
}

function makeController(
  fileUrl: string,
  opts: { stillUsed?: number | Error } = {},
) {
  const deleted: string[] = [];
  const counted: CountWhere[] = [];
  const asset = {
    id: 'a1',
    tenantId: 't1',
    fileUrl,
    mimeType: 'video/mp4',
    posterUrl: null,
    processingMeta: null,
  };
  const tx = {
    asset: {
      findFirst: jest.fn(() => Promise.resolve({ ...asset })),
      count: jest.fn((args: { where: CountWhere }) => {
        counted.push(args.where);
        const used = opts.stillUsed ?? 0;
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

describe('DELETE /assets/:id — the stored file goes only with its last row', () => {
  it('deletes the file when this row was its only holder', async () => {
    const { controller, deleted, counted, client } = makeController(
      `${PREFIX}${OWN}`,
    );
    await expect(controller.remove(REQ, 'a1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleted).toEqual([OWN]);
    // Asked across EVERY tenant — a fleet copy lives in another tenant's row.
    expect(counted).toEqual([
      { fileUrl: `${PREFIX}${OWN}`, id: { not: 'a1' } },
    ]);
    expect(client.asset.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps the file while another row (a fleet copy) still points at it — the row still goes', async () => {
    const { controller, deleted, client } = makeController(`${PREFIX}${OWN}`, {
      stillUsed: 2,
    });
    await expect(controller.remove(REQ, 'a1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleted).toEqual([]);
    expect(client.asset.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps the file when that cannot be confirmed', async () => {
    const { controller, deleted } = makeController(`${PREFIX}${OWN}`, {
      stillUsed: new Error('pool timeout'),
    });
    await expect(controller.remove(REQ, 'a1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleted).toEqual([]);
  });

  it("never deletes a file outside this tenant's own folder, and does not even ask", async () => {
    const { controller, deleted, counted, client } = makeController(
      `${PREFIX}${THEIRS}`,
    );
    await expect(controller.remove(REQ, 'a1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleted).toEqual([]);
    expect(counted).toEqual([]);
    expect(client.asset.delete).toHaveBeenCalledTimes(1);
  });

  it('a linked URL that is not ours touches no storage at all', async () => {
    const { controller, deleted, counted } = makeController(
      'https://cdn.example.com/clip.mp4',
    );
    await controller.remove(REQ, 'a1');
    expect(deleted).toEqual([]);
    expect(counted).toEqual([]);
  });
});
