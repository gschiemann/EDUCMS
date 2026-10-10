/**
 * `?mode=drill` on /panic-content (2026-10-10): the DRILL bucket of a type is
 * its own protected playlist in its own Tenant column, tagged so it can never
 * be confused with the live bucket; a request with no mode is the live bucket,
 * exactly as before.
 */
import { HttpException } from '@nestjs/common';
import { PanicContentController } from './panic-content.controller';

type Row = Record<string, any>;

function makeDb() {
  const tenant: Row = { id: 't1', panicLockdownPlaylistId: null, drillLockdownPlaylistId: null, drillLockdownPortraitPlaylistId: null };
  const playlists = new Map<string, Row>();
  const items = new Map<string, Row>();
  const auditLogs: Row[] = [];
  let seq = 0;
  const client: any = {
    tenant: {
      findUnique: jest.fn(async () => ({ ...tenant })),
      update: jest.fn(async ({ data }: any) => Object.assign(tenant, data)),
    },
    playlist: {
      findFirst: jest.fn(async ({ where }: any) => {
        const p = playlists.get(where.id);
        return p && p.tenantId === where.tenantId ? { ...p } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const p = { id: `pl-${++seq}`, ...data };
        playlists.set(p.id, p);
        return { ...p };
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    playlistItem: {
      findMany: jest.fn(async ({ where }: any) => [...items.values()].filter((i) => i.playlistId === where.playlistId)),
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async ({ where }: any) => {
        const i = items.get(where.id);
        if (!i) return null;
        const p = playlists.get(i.playlistId)!;
        return { ...i, playlist: { tenantId: p.tenantId, isProtected: p.isProtected, protectedKind: p.protectedKind } };
      }),
      create: jest.fn(async ({ data }: any) => {
        const i = { id: `item-${++seq}`, ...data };
        items.set(i.id, i);
        return { ...i, asset: { id: data.assetId, fileUrl: 'u', mimeType: 'image/png', originalName: 'a.png' } };
      }),
      delete: jest.fn(async ({ where }: any) => items.delete(where.id)),
    },
    asset: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id, mimeType: 'image/png' })) },
    auditLog: { create: jest.fn(async ({ data }: any) => auditLogs.push(data)) },
    $transaction: jest.fn(async (fn: any) => fn(client)),
  };
  const ctrl = new PanicContentController({ client } as any);
  const req = { user: { id: 'u1', tenantId: 't1' } };
  return { ctrl, req, tenant, playlists, items, auditLogs };
}

describe('PanicContentController — drill mode', () => {
  it('creates the DRILL bucket in the drill column, tagged lockdown_drill, named DRILL:', async () => {
    const { ctrl, req, tenant, playlists } = makeDb();
    const res: any = await ctrl.listAssets(req, 'lockdown', undefined, 'drill');
    expect(res).toMatchObject({ kind: 'lockdown', orientation: 'landscape', mode: 'drill', items: [] });
    expect(tenant.drillLockdownPlaylistId).toBe(res.playlistId);
    expect(tenant.panicLockdownPlaylistId).toBeNull();
    const pl = playlists.get(res.playlistId)!;
    expect(pl).toMatchObject({ isProtected: true, protectedKind: 'lockdown_drill' });
    expect(pl.name).toMatch(/^🚨 DRILL: Lockdown \(System\)$/);
  });

  it('portrait drill buckets are their own column and tag', async () => {
    const { ctrl, req, tenant, playlists } = makeDb();
    const res: any = await ctrl.listAssets(req, 'lockdown', 'portrait', 'drill');
    expect(tenant.drillLockdownPortraitPlaylistId).toBe(res.playlistId);
    expect(playlists.get(res.playlistId)).toMatchObject({ protectedKind: 'lockdown_drill_portrait' });
  });

  it('no mode (or any other value) is the LIVE bucket, exactly as before', async () => {
    const { ctrl, req, tenant, playlists } = makeDb();
    const a: any = await ctrl.listAssets(req, 'lockdown');
    const b: any = await ctrl.listAssets(req, 'lockdown', undefined, 'live');
    expect(a.playlistId).toBe(b.playlistId);
    expect(a.mode).toBe('live');
    expect(tenant.panicLockdownPlaylistId).toBe(a.playlistId);
    expect(tenant.drillLockdownPlaylistId).toBeNull();
    expect(playlists.get(a.playlistId)).toMatchObject({ protectedKind: 'lockdown' });
  });

  it('the generic `default` bucket has no drill variant', async () => {
    const { ctrl, req } = makeDb();
    await expect(ctrl.listAssets(req, 'default', undefined, 'drill')).rejects.toThrow(HttpException);
  });

  it('adding and removing an asset in drill mode audits the mode and refuses a cross-bucket removal', async () => {
    const { ctrl, req, auditLogs } = makeDb();
    const item: any = await ctrl.addAsset(req, 'lockdown', { assetId: 'asset-1' }, undefined, 'drill');
    expect(JSON.parse(auditLogs.at(-1)!.details)).toMatchObject({ kind: 'lockdown', mode: 'drill', assetId: 'asset-1' });
    // the live bucket does not own this item
    await expect(ctrl.removeAsset(req, 'lockdown', item.id)).rejects.toThrow(HttpException);
    await expect(ctrl.removeAsset(req, 'lockdown', item.id, undefined, 'drill')).resolves.toEqual({ ok: true });
    expect(JSON.parse(auditLogs.at(-1)!.details)).toMatchObject({ mode: 'drill', itemId: item.id });
  });
});
