/**
 * assets-storage-summary.controller.spec.ts — `GET /assets/storage-summary`:
 * the tenant's storage, by kind, with linked URLs counted as files but not
 * bytes, and every read tenant-scoped.
 */
import { AssetsController } from './assets.controller';

function makeController(
  rows: Array<{
    tenantId: string;
    mimeType: string | null;
    fileSize: number | null;
  }>,
) {
  const findMany = jest.fn((args: { where: { tenantId: string } }) =>
    Promise.resolve(
      rows
        .filter((r) => r.tenantId === args.where.tenantId)
        .map(({ mimeType, fileSize }) => ({ mimeType, fileSize })),
    ),
  );
  const prisma = { client: { asset: { findMany } } } as never;
  const controller = new AssetsController(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { controller, findMany };
}

describe('GET /assets/storage-summary', () => {
  it('sums bytes and files by kind for the caller tenant only', async () => {
    const { controller, findMany } = makeController([
      { tenantId: 't1', mimeType: 'video/mp4', fileSize: 48_800_000 },
      { tenantId: 't1', mimeType: 'video/mp4', fileSize: 257_600_000 },
      { tenantId: 't1', mimeType: 'image/png', fileSize: 1_200_000 },
      { tenantId: 't1', mimeType: 'application/pdf', fileSize: 2_300_000 },
      { tenantId: 't1', mimeType: 'text/html', fileSize: null }, // a linked URL: a file, no bytes
      { tenantId: 'OTHER', mimeType: 'video/mp4', fileSize: 999_999_999 },
    ]);
    const out = await controller.storageSummary({ user: { tenantId: 't1' } });
    expect(out).toEqual({
      totalBytes: 309_900_000,
      totalFiles: 5,
      videos: { bytes: 306_400_000, files: 2 },
      images: { bytes: 1_200_000, files: 1 },
      other: { bytes: 2_300_000, files: 2 },
    });
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
  });

  it('is all zeros for an empty library', async () => {
    const { controller } = makeController([]);
    expect(
      await controller.storageSummary({ user: { tenantId: 't1' } }),
    ).toMatchObject({ totalBytes: 0, totalFiles: 0 });
  });
});
