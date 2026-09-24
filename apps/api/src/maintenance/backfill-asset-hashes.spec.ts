/**
 * Boot-time asset hash backfill (2026-09-23 changes): it hashes as the bytes
 * STREAM (a 2 GB direct-upload video must never sit in the API's heap), and its
 * write is CONDITIONAL on the asset still serving the URL it hashed — the
 * signage transcode can swap a video to a new file (with that file's own hash)
 * while a long download is in flight, and the original's hash must never land
 * on the new file.
 */
import { createHash } from 'crypto';
import { backfillManagedAssetHashes } from './backfill-asset-hashes';

const SUPA = 'https://example.supabase.co';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function streamingResponse(chunks: Buffer[]): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(new Uint8Array(chunks[i++]));
      else controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('backfillManagedAssetHashes', () => {
  const realFetch = global.fetch;
  const OLD = { url: process.env.SUPABASE_URL, off: process.env.EMERGENCY_HASH_BACKFILL };
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA;
    delete process.env.EMERGENCY_HASH_BACKFILL;
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env.SUPABASE_URL = OLD.url;
    if (OLD.off === undefined) delete process.env.EMERGENCY_HASH_BACKFILL;
    else process.env.EMERGENCY_HASH_BACKFILL = OLD.off;
  });

  function prismaWith(rows: Array<{ id: string; fileUrl: string }>) {
    return {
      client: {
        asset: {
          findMany: jest.fn(async () => rows),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
      },
    } as any;
  }
  const logger = { log: jest.fn(), warn: jest.fn() } as any;

  it('hashes the streamed body chunk by chunk — same digest as the whole file', async () => {
    const chunks = [Buffer.alloc(700_000, 1), Buffer.alloc(900_000, 2), Buffer.from('tail')];
    global.fetch = jest.fn(async () => streamingResponse(chunks)) as any;
    const url = `${SUPA}/storage/v1/object/public/assets/t/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4`;
    const prisma = prismaWith([{ id: 'a1', fileUrl: url }]);
    await backfillManagedAssetHashes(prisma, logger);
    expect(prisma.client.asset.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', fileUrl: url, fileHash: null },
      data: { fileHash: sha(Buffer.concat(chunks)) },
    });
  });

  it('only ever selects managed (our Supabase) assets with no hash', async () => {
    global.fetch = jest.fn() as any;
    const prisma = prismaWith([]);
    await backfillManagedAssetHashes(prisma, logger);
    expect(prisma.client.asset.findMany.mock.calls[0][0].where).toEqual({ fileHash: null, fileUrl: { startsWith: SUPA } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a failed or empty download writes nothing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(streamingResponse([])) as any;
    const prisma = prismaWith([
      { id: 'a1', fileUrl: `${SUPA}/x/1.mp4` },
      { id: 'a2', fileUrl: `${SUPA}/x/2.mp4` },
    ]);
    await backfillManagedAssetHashes(prisma, logger);
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('EMERGENCY_HASH_BACKFILL=off still disables it entirely', async () => {
    process.env.EMERGENCY_HASH_BACKFILL = 'off';
    const prisma = prismaWith([{ id: 'a1', fileUrl: `${SUPA}/x/1.mp4` }]);
    await backfillManagedAssetHashes(prisma, logger);
    expect(prisma.client.asset.findMany).not.toHaveBeenCalled();
  });
});
