import { HttpException, HttpStatus } from '@nestjs/common';
import { AssetDeleteBatch, folderSubtreeIds } from './asset-delete-batch';
import { AssetsController } from './assets.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { EmailService } from '../email/email.service';
import type { MediaOptimizationService } from '../storage/media-optimization.service';
import type { AiAltTextService } from '../ai/ai-alt-text.service';
import type { VideoPosterService } from '../storage/video-poster.service';

const req = { user: { id: 'user', tenantId: 'ours', role: 'SCHOOL_ADMIN' } };
function controller(client: unknown) {
  return new AssetsController(
    { client } as PrismaService,
    {} as SupabaseStorageService,
    {} as EmailService,
    {} as MediaOptimizationService,
    {} as AiAltTextService,
    {} as VideoPosterService,
  );
}

it('limits work to two across simultaneous batches, preserves order and reports kept files', async () => {
  const batch = new AssetDeleteBatch();
  let active = 0,
    peak = 0;
  const remove = async (id: string) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (id === 'protected')
      throw new HttpException(
        {
          code: 'ASSET_IN_EMERGENCY_CONTENT',
          message: 'Protected content is kept.',
        },
        HttpStatus.CONFLICT,
      );
  };
  const [a, b] = await Promise.all([
    batch.run(['one', 'protected', 'one', 'two'], remove),
    batch.run(['three', 'four'], remove),
  ]);
  expect(peak).toBe(2);
  expect(a).toEqual([
    { id: 'one', deleted: true },
    {
      id: 'protected',
      deleted: false,
      code: 'ASSET_IN_EMERGENCY_CONTENT',
      message: 'Protected content is kept.',
    },
    { id: 'two', deleted: true },
  ]);
  expect(b.every((item) => item.deleted)).toBe(true);
});

it.each([[], Array(21).fill('one'), [''], ['one', 2], null])(
  'rejects invalid selections before any deletion: %j',
  async (ids) => {
    const remove = jest.fn();
    await expect(new AssetDeleteBatch().run(ids, remove)).rejects.toMatchObject(
      { status: 400 },
    );
    expect(remove).not.toHaveBeenCalled();
  },
);

it('calls the unchanged guarded deletion with the same tenant actor and explicit confirmation', async () => {
  const api = controller({});
  const remove = jest.spyOn(api, 'remove').mockResolvedValue({ deleted: true });
  await api.removeBatch(req, { ids: ['one', 'two'] }, 'in-use');
  expect(remove).toHaveBeenCalledWith(req, 'one', 'in-use');
  expect(remove).toHaveBeenCalledWith(req, 'two', 'in-use');
  remove.mockClear();
  await api.removeBatch(req, { ids: ['one'] });
  expect(remove).toHaveBeenCalledWith(req, 'one', undefined);
});

it('does not leak an unexpected database error in the batch receipt', async () => {
  const result = await new AssetDeleteBatch().run(['one'], () =>
    Promise.reject(new Error('database password and private schema')),
  );
  expect(JSON.stringify(result)).not.toContain('password');
  expect(result[0]).toMatchObject({
    deleted: false,
    code: 'ASSET_DELETE_FAILED',
  });
});

const folders = [
  { id: 'root', parentId: null, name: 'Root' },
  { id: 'child', parentId: 'root', name: 'Child' },
  { id: 'leaf', parentId: 'child', name: 'Leaf' },
  { id: 'other', parentId: null, name: 'Other' },
];
it('includes descendants without siblings, even when rows arrive out of order', () => {
  expect(new Set(folderSubtreeIds([...folders].reverse(), 'root'))).toEqual(
    new Set(['root', 'child', 'leaf']),
  );
});

function folderApi(remaining: number, auditError = false) {
  const tx = {
    assetFolder: {
      findFirst: jest.fn().mockResolvedValue(folders[0]),
      findMany: jest.fn().mockResolvedValue(folders),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    asset: {
      count: jest.fn().mockResolvedValue(remaining),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'asset' }]),
    },
    auditLog: {
      create: auditError
        ? jest.fn().mockRejectedValue(new Error('audit unavailable'))
        : jest.fn().mockResolvedValue({}),
    },
  };
  const client = {
    ...tx,
    $transaction: jest.fn((run: (db: typeof tx) => unknown) => run(tx)),
  };
  return { api: controller(client), client, tx };
}
it('folder contents are read only within the owning tenant and include subfolders', async () => {
  const { api, tx } = folderApi(0);
  await expect(api.folderDeletionSummary(req, 'root')).resolves.toEqual({
    name: 'Root',
    assetIds: ['asset'],
    folders: 3,
  });
  expect(tx.assetFolder.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { tenantId: 'ours' } }),
  );
  expect(tx.asset.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { tenantId: 'ours', folderId: { in: ['root', 'child', 'leaf'] } },
    }),
  );
  await expect(api.folderDeletionSummary(req, 'foreign')).rejects.toMatchObject(
    { status: 404 },
  );
});
it('keeps the entire folder tree if a protected file or a new upload remains', async () => {
  const { api, tx } = folderApi(1);
  await expect(
    api.deleteFolder(req, 'root', 'empty-tree'),
  ).rejects.toMatchObject({ status: 409 });
  expect(tx.assetFolder.deleteMany).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
it('removes only an empty tenant-owned tree and writes the audit within its serializable transaction', async () => {
  const { api, client, tx } = folderApi(0);
  await api.deleteFolder(req, 'root', 'empty-tree');
  expect(tx.assetFolder.deleteMany).toHaveBeenCalledWith({
    where: { tenantId: 'ours', id: { in: ['root', 'child', 'leaf'] } },
  });
  expect(tx.auditLog.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'ours',
        userId: 'user',
        action: 'ASSET_FOLDER_DELETED',
      }) as Record<string, unknown>,
    }),
  );
  expect(client.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ isolationLevel: 'Serializable' }),
  );
});
it('the keep-files choice moves files and child folders, with an awaited audit', async () => {
  const { api, tx } = folderApi(3);
  await api.deleteFolder(req, 'root');
  expect(tx.asset.updateMany).toHaveBeenCalledWith({
    where: { folderId: 'root', tenantId: 'ours' },
    data: { folderId: null },
  });
  expect(tx.assetFolder.deleteMany).not.toHaveBeenCalled();
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  const failed = folderApi(0, true);
  await expect(
    failed.api.deleteFolder(req, 'root', 'empty-tree'),
  ).rejects.toThrow('audit unavailable');
});
