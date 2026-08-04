/**
 * INTEG-01 / INTEG-02 (2026-08-04) — a child tenant must not be able to
 * substitute its own file into a district's fleet publish.
 *
 * THE ATTACK this proves is closed:
 *   1. `POST /assets/complete-upload` used to persist `Asset.fileHash` straight
 *      from the request body, checking only that it was 64 hex characters.
 *      Nothing ever compared it to the bytes in storage (INTEG-01).
 *   2. `PlaylistDistributionService.ensureChildAsset` used to find the child
 *      tenant's copy of a pushed asset BY THAT HASH (INTEG-02).
 *
 * Chain them and a CONTRIBUTOR — the lowest role that can upload — creates a
 * row in their own school claiming the hash of content the district is about to
 * push, with `fileUrl` pointing anywhere they like. The district publishes to
 * the fleet, `ensureChildAsset` resolves to the attacker's row, and the
 * attacker's file plays on that school's screens inside the district's
 * playlist. No district credentials needed at any point.
 *
 * The fix is to key the lookup on `fileUrl`, which is server-generated from the
 * storage path and never client-asserted. These tests stage the poisoned row
 * and assert it is never selected.
 */

import 'reflect-metadata';
import { PlaylistDistributionService } from './playlist-distribution.service';

const PARENT_ASSET = {
  id: 'asset-district-original',
  tenantId: 'tenant-district',
  fileUrl: 'https://proj.supabase.co/storage/v1/object/public/media/tenant-district/lockdown-notice.png',
  mimeType: 'image/png',
  fileSize: 2048,
  originalName: 'lockdown-notice.png',
  // The real hash of the district's file. An attacker who has ever seen this
  // asset can compute it — it is not a secret.
  fileHash: 'a'.repeat(64),
  altText: null,
};

/** The row an attacker pre-creates inside the child school. */
const POISONED_CHILD_ASSET = {
  id: 'asset-attacker-controlled',
  tenantId: 'tenant-child-school',
  fileUrl: 'https://attacker.example/defaced.png',
  fileHash: PARENT_ASSET.fileHash, // claimed, never verified — that was INTEG-01
};

function makeService(childAssets: Array<Record<string, unknown>>) {
  const findFirstCalls: any[] = [];
  const created: any[] = [];
  const prisma = {
    client: {
      asset: {
        findFirst: jest.fn(async ({ where }: any) => {
          findFirstCalls.push(where);
          const hit = childAssets.find((a) =>
            Object.entries(where).every(([k, v]) => (a as any)[k] === v),
          );
          return hit ? { id: (hit as any).id } : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { id: 'asset-newly-created-for-child' };
        }),
      },
    },
  };
  const service = new PlaylistDistributionService(prisma as any, {} as any, {} as any);
  return { service, prisma, findFirstCalls, created };
}

describe('INTEG-02 — ensureChildAsset never resolves a child asset by client-asserted fileHash', () => {
  it('ignores a poisoned child row that claims the parent hash, and creates a clean copy instead', async () => {
    // The child tenant contains ONLY the attacker's row. There is no legitimate
    // copy yet, so the pre-fix code would have matched the poison by hash.
    const { service, findFirstCalls, created } = makeService([POISONED_CHILD_ASSET]);

    const resolvedId = await (service as any).ensureChildAsset(
      PARENT_ASSET,
      'tenant-child-school',
      'user-district-admin',
    );

    // THE ASSERTION THAT MATTERS: the attacker's asset id is never returned.
    expect(resolvedId).not.toBe(POISONED_CHILD_ASSET.id);
    expect(resolvedId).toBe('asset-newly-created-for-child');

    // A clean child row was created pointing at the DISTRICT's file.
    expect(created).toHaveLength(1);
    expect(created[0].fileUrl).toBe(PARENT_ASSET.fileUrl);
    expect(created[0].tenantId).toBe('tenant-child-school');

    // And the lookup itself must never key on fileHash — belt and braces, so a
    // future refactor that reintroduces hash matching fails here too.
    expect(findFirstCalls).toHaveLength(1);
    expect(findFirstCalls[0]).toEqual({
      tenantId: 'tenant-child-school',
      fileUrl: PARENT_ASSET.fileUrl,
    });
    expect(findFirstCalls[0]).not.toHaveProperty('fileHash');
  });

  it('still reuses the legitimate child copy (find-or-create round-trip is intact)', async () => {
    // The normal path: a previous publish already mirrored the parent asset in,
    // so the same fileUrl exists in the child. It must be reused, not duplicated.
    const legitimate = {
      id: 'asset-child-legit-mirror',
      tenantId: 'tenant-child-school',
      fileUrl: PARENT_ASSET.fileUrl,
      fileHash: PARENT_ASSET.fileHash,
    };
    const { service, created } = makeService([POISONED_CHILD_ASSET, legitimate]);

    const resolvedId = await (service as any).ensureChildAsset(
      PARENT_ASSET,
      'tenant-child-school',
      'user-district-admin',
    );

    expect(resolvedId).toBe(legitimate.id);
    expect(created).toHaveLength(0); // reused, no duplicate row
  });

  it('resolves by fileUrl even when the parent asset has no hash at all', async () => {
    // fileHash is now null on every fresh presign upload (INTEG-01 fix), so the
    // no-hash case is the COMMON path, not an edge case.
    const hashless = { ...PARENT_ASSET, fileHash: null };
    const { service, findFirstCalls, created } = makeService([]);

    const resolvedId = await (service as any).ensureChildAsset(
      hashless,
      'tenant-child-school',
      'user-district-admin',
    );

    expect(resolvedId).toBe('asset-newly-created-for-child');
    expect(findFirstCalls[0]).toEqual({
      tenantId: 'tenant-child-school',
      fileUrl: PARENT_ASSET.fileUrl,
    });
    expect(created[0].fileHash).toBeNull();
  });
});
