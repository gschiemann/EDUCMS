/**
 * The demotion surface on PlaybackCapabilityController (2026-10-12, owner
 * decision A): the GET lists a screen's active demotions (named from THIS
 * location's library only); POST …/playback-demotions/:id/clear is "Try full
 * quality again" — admin roles only, tenant-scoped (404 outside the
 * workspace), audited, never a reload.
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { PlaybackCapabilityController } from './playback-capability.controller';
import { PlaybackDemotionService, VIDEO_PLAYBACK_DEMOTION_CLEARED } from './playback-demotion.service';
import { ROLES_KEY } from '../auth/roles.decorator';

const SHA = 'a'.repeat(64);

function setup(over: { screen?: any; demotions?: any[]; assets?: any[] } = {}) {
  const screen = over.screen === undefined ? { id: 'scr-1', tenantId: 't1', playerVersionCode: 1, displayCapabilities: null } : over.screen;
  const demotions = over.demotions ?? [{ id: 'dem-1', tenantId: 't1', screenId: 'scr-1', sourceSha256: SHA, assetId: 'asset-1', createdAt: new Date('2026-10-12T10:00:00Z'), clearedAt: null }];
  const audits: any[] = [];
  const client: any = {
    tenant: { findMany: jest.fn(async () => []) },
    screen: { findFirst: jest.fn(async ({ where }: any) => (screen && where.tenantId.in.includes(screen.tenantId) && where.id === screen.id ? screen : null)) },
    screenFilePlayback: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 1 })) },
    screenMediaCapabilities: { findFirst: jest.fn(async () => null) },
    asset: { findMany: jest.fn(async ({ where }: any) => (over.assets ?? [{ id: 'asset-1', tenantId: 't1', originalName: 'Promo 4K.mp4', fileUrl: 'https://cdn/p.mp4' }]).filter((a) => a.tenantId === where.tenantId && where.id.in.includes(a.id))) },
    $queryRaw: jest.fn(async () => []),
    screenPlaybackDemotion: {
      findMany: jest.fn(async ({ where }: any) => demotions.filter((d) => d.screenId === where.screenId && d.tenantId === where.tenantId && !d.clearedAt)),
      findFirst: jest.fn(async ({ where }: any) => demotions.find((d) => d.id === where.id && d.screenId === where.screenId && d.tenantId === where.tenantId && !d.clearedAt) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const d = demotions.find((x) => x.id === where.id && x.tenantId === where.tenantId && !x.clearedAt);
        if (!d) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
  };
  client.$transaction = jest.fn(async (fn: any) => fn(client));
  const prisma: any = { client };
  const redis = { publish: jest.fn(async () => undefined) };
  const signer = { signMessage: jest.fn((t: string) => `signed-${t}`) };
  const svc = new PlaybackDemotionService(prisma, redis as any, signer as any);
  return { client, demotions, audits, redis, signer, controller: new PlaybackCapabilityController(prisma, svc) };
}

const user = (over: Record<string, unknown> = {}) => ({ user: { id: 'u1', userId: 'u1', role: 'SCHOOL_ADMIN', tenantId: 't1', ...over } });

describe('GET lists active demotions', () => {
  it('named from this location; empty for an ordinary screen', async () => {
    const out = await setup().controller.get('scr-1', user());
    expect(out.demotions).toEqual([{ id: 'dem-1', sha256: SHA, assetId: 'asset-1', name: 'Promo 4K.mp4', since: '2026-10-12T10:00:00.000Z' }]);
    const none = await setup({ demotions: [] }).controller.get('scr-1', user());
    expect(none.demotions).toEqual([]);
  });
  it('an asset id from another location is never named', async () => {
    const out = await setup({ assets: [{ id: 'asset-1', tenantId: 't2', originalName: 'Secret.mp4', fileUrl: 'x' }] }).controller.get('scr-1', user());
    expect(out.demotions[0]).toMatchObject({ assetId: null, name: null });
  });
});

describe('POST /screens/:id/playback-demotions/:demotionId/clear', () => {
  it('admin roles only (CONTRIBUTOR and RESTRICTED_VIEWER cannot)', () => {
    const roles: string[] = Reflect.getMetadata(ROLES_KEY, PlaybackCapabilityController.prototype.clearDemotion);
    expect(roles.sort()).toEqual([AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.SUPER_ADMIN].sort());
  });

  it('clears, audits with the caller, sends ONE signed SYNC to that screen (no reload)', async () => {
    const h = setup();
    expect(await h.controller.clearDemotion('scr-1', 'dem-1', user())).toEqual({ cleared: true });
    expect(h.demotions[0]).toMatchObject({ clearedByUserId: 'u1' });
    expect(h.audits).toEqual([expect.objectContaining({ action: VIDEO_PLAYBACK_DEMOTION_CLEARED, userId: 'u1', tenantId: 't1', targetId: 'scr-1' })]);
    expect(h.redis.publish).toHaveBeenCalledTimes(1);
    expect(h.redis.publish).toHaveBeenCalledWith('device:scr-1', 'signed-SYNC');
    expect(h.signer.signMessage).not.toHaveBeenCalledWith('REFRESH_WEB', expect.anything());
  });

  it('another workspace\'s screen → 404 before anything is read or written', async () => {
    const h = setup({ screen: { id: 'scr-1', tenantId: 't2', playerVersionCode: 1, displayCapabilities: null } });
    await expect(h.controller.clearDemotion('scr-1', 'dem-1', user())).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.screenPlaybackDemotion.findFirst).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
  });

  it('a demotion id of another screen → 404, nothing written', async () => {
    const h = setup({ demotions: [{ id: 'dem-9', tenantId: 't1', screenId: 'scr-other', sourceSha256: SHA, clearedAt: null }] });
    await expect(h.controller.clearDemotion('scr-1', 'dem-9', user())).rejects.toMatchObject({ status: 404 });
    expect(h.demotions[0].clearedAt).toBeNull();
    expect(h.audits).toEqual([]);
  });
});
