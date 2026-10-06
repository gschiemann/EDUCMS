/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- Stateful synthetic Prisma delegates intentionally accept flexible query shapes. */
import {
  EMERGENCY_DEFAULT_FIELDS,
  initializeEmergencyLocations,
} from './emergency-defaults';
import { TenantsController } from './tenants.controller';

/** Stateful synthetic store: repeat initialization must read its previous copies. */
function fixture() {
  const sourceAsset = {
    id: 'hq-media',
    tenantId: 'hq',
    status: 'PUBLISHED',
    uploadedByUserId: 'author',
    fileUrl: 'https://media.example/alert.png',
    mimeType: 'image/png',
    fileSize: 10,
    originalName: 'alert.png',
    fileHash: 'hash',
    altText: 'Alert',
    processingMeta: null,
  };
  const tenants: any[] = [
    {
      id: 'hq',
      parentId: null,
      archivedAt: null,
      vertical: 'CORPORATE',
      emergencyEnabled: true,
      panicLockdownPlaylistId: 'hq-alert',
    },
    {
      id: 'empty',
      parentId: 'hq',
      archivedAt: null,
      vertical: 'CORPORATE',
      emergencyEnabled: null,
    },
    {
      id: 'legacy',
      parentId: 'hq',
      archivedAt: null,
      vertical: 'CORPORATE',
      emergencyEnabled: null,
      panicLockdownPlaylistId: 'legacy-alert',
    },
    {
      id: 'local',
      parentId: 'hq',
      archivedAt: null,
      vertical: 'CORPORATE',
      emergencyEnabled: true,
      panicLockdownPlaylistId: 'local-alert',
    },
    {
      id: 'cleared',
      parentId: 'hq',
      archivedAt: null,
      vertical: 'CORPORATE',
      emergencyEnabled: null,
      panicLockdownPlaylistId: 'cleared-alert',
    },
    {
      id: 'archived',
      parentId: 'hq',
      archivedAt: new Date(),
      emergencyEnabled: null,
    },
    { id: 'other', parentId: null, archivedAt: null, emergencyEnabled: null },
  ];
  const playlists: any[] = [
    {
      id: 'hq-alert',
      tenantId: 'hq',
      name: 'Lockdown',
      isProtected: true,
      protectedKind: 'lockdown',
      sourcePlaylistId: null,
    },
    ...['legacy', 'local', 'cleared'].map((id) => ({
      id: `${id}-alert`,
      tenantId: id,
      name: 'Local',
      isProtected: true,
      protectedKind: 'lockdown',
      sourcePlaylistId: null,
    })),
  ];
  const assets: any[] = [sourceAsset];
  const items: any[] = [
    {
      id: 'hq-item',
      playlistId: 'hq-alert',
      assetId: 'hq-media',
      durationMs: 10000,
      sequenceOrder: 0,
      transitionType: 'FADE',
      muted: false,
      daysOfWeek: null,
      timeStart: null,
      timeEnd: null,
    },
    { id: 'local-item', playlistId: 'local-alert', assetId: 'local-media' },
  ];
  const audits: any[] = [
    {
      tenantId: 'cleared',
      targetType: 'Playlist',
      targetId: 'cleared-alert',
      action: 'PANIC_CONTENT_ASSET_REMOVED',
    },
  ];
  const matches = (row: any, where: any) => {
    for (const key of [
      'id',
      'tenantId',
      'parentId',
      'archivedAt',
      'sourcePlaylistId',
      'targetType',
      'targetId',
      'action',
      'slug',
    ]) {
      if (!(key in where)) continue;
      const value = where[key];
      if (value?.in ? !value.in.includes(row[key]) : row[key] !== value)
        return false;
    }
    if (
      where.OR &&
      !where.OR.some(
        (part: any) => row.emergencyEnabled === part.emergencyEnabled,
      )
    )
      return false;
    if (where.items?.none && items.some((item) => item.playlistId === row.id))
      return false;
    return true;
  };
  const tx: any = {
    tenant: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          tenants.find((row) => matches(row, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        tenants.filter((row) => matches(row, where)),
      ),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          tenants.find((row) => matches(row, where)),
          data,
        ),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = tenants.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: 'new-location',
          archivedAt: null,
          emergencyEnabled: null,
          ...data,
        };
        tenants.push(row);
        return row;
      }),
    },
    playlist: {
      findMany: jest.fn(async ({ where, include }: any) =>
        playlists
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            ...(include
              ? {
                  items: items
                    .filter((item) => item.playlistId === row.id)
                    .map((item) => ({
                      ...item,
                      asset: assets.find((a) => a.id === item.assetId),
                    })),
                }
              : {
                  _count: {
                    items: items.filter((item) => item.playlistId === row.id)
                      .length,
                  },
                }),
          })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = playlists.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        playlists.push(...data);
        return { count: data.length };
      }),
    },
    asset: {
      createMany: jest.fn(async ({ data }: any) => {
        assets.push(...data);
        return { count: data.length };
      }),
    },
    playlistItem: {
      createMany: jest.fn(async ({ data }: any) => {
        items.push(...data);
        return { count: data.length };
      }),
    },
    auditLog: {
      findMany: jest.fn(async ({ where }: any) =>
        audits.filter((row) => matches(row, where)),
      ),
      createMany: jest.fn(async ({ data }: any) => {
        audits.push(...data);
        return { count: data.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return data;
      }),
    },
  };
  const prisma: any = {
    client: { ...tx, $transaction: jest.fn(async (cb: any) => cb(tx)) },
  };
  return { tx, prisma, tenants, playlists, assets, items, audits, sourceAsset };
}
const ids = ['empty', 'legacy', 'local', 'cleared', 'archived'];

describe('Initial corporate emergency defaults', () => {
  it('enables screenless locations, seeds new and legacy empty buckets, preserves local edits, and audits each change', async () => {
    const f = fixture();
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ids, 'admin'),
    ).toEqual({
      locationsEnabled: 3,
      locationsInitialized: 2,
      defaultBucketsLoaded: 2,
    });
    for (const id of ids.filter((id) => id !== 'archived'))
      expect(f.tenants.find((t) => t.id === id).emergencyEnabled).toBe(true);
    expect(
      f.tenants.find((t) => t.id === 'archived').emergencyEnabled,
    ).toBeNull();
    expect(f.tenants.find((t) => t.id === 'other').emergencyEnabled).toBeNull();
    for (const id of ['empty', 'legacy']) {
      const playlistId = f.tenants.find(
        (t) => t.id === id,
      ).panicLockdownPlaylistId;
      expect(f.playlists.find((p) => p.id === playlistId)).toMatchObject({
        tenantId: id,
        sourcePlaylistId: 'hq-alert',
        isProtected: true,
      });
      const item = f.items.find((i) => i.playlistId === playlistId);
      expect(item).toMatchObject({
        durationMs: 10000,
        sequenceOrder: 0,
        muted: false,
      });
      expect(f.assets.find((a) => a.id === item.assetId)).toMatchObject({
        tenantId: id,
        fileUrl: f.sourceAsset.fileUrl,
        status: 'PUBLISHED',
      });
      expect(item.assetId).not.toBe('hq-media');
    }
    expect(f.items.filter((i) => i.playlistId === 'local-alert')).toEqual([
      { id: 'local-item', playlistId: 'local-alert', assetId: 'local-media' },
    ]);
    expect(
      f.items.filter((i) => i.playlistId === 'cleared-alert'),
    ).toHaveLength(0);
    expect(f.audits.filter((a) => a.targetType === 'Tenant')).toHaveLength(3);
    expect(f.audits.find((a) => a.tenantId === 'empty')).toMatchObject({
      userId: 'admin',
      action: 'EMERGENCY_DEFAULTS_INITIALIZED',
    });
  });

  it('copies all alert kinds, both orientations and the generic fallback into independent protected buckets', async () => {
    const f = fixture();
    f.items.splice(0, 1);
    f.playlists.splice(0, 1);
    for (const [field, kind] of Object.entries(EMERGENCY_DEFAULT_FIELDS)) {
      f.tenants[0][field] = `hq-${kind}`;
      f.playlists.push({
        id: `hq-${kind}`,
        tenantId: 'hq',
        name: kind,
        isProtected: true,
        protectedKind: kind,
      });
      f.items.push({
        id: `${kind}-item`,
        playlistId: `hq-${kind}`,
        assetId: 'hq-media',
        durationMs: 15000,
        sequenceOrder: 0,
      });
    }
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ['empty'], 'admin'),
    ).toEqual({
      locationsEnabled: 1,
      locationsInitialized: 1,
      defaultBucketsLoaded: 14,
    });
    for (const [field, kind] of Object.entries(EMERGENCY_DEFAULT_FIELDS)) {
      expect(
        f.playlists.find((p) => p.id === f.tenants[1][field]),
      ).toMatchObject({
        tenantId: 'empty',
        isProtected: true,
        protectedKind: kind,
      });
      expect(
        f.items.filter((i) => i.playlistId === f.tenants[1][field]),
      ).toHaveLength(1);
    }
    expect(f.assets.filter((a) => a.tenantId === 'empty')).toHaveLength(1);
  });

  it('re-applying never duplicates copies or repopulates a locally emptied initial copy', async () => {
    const f = fixture();
    await initializeEmergencyLocations(f.tx, 'hq', ['empty'], 'admin');
    f.items.splice(
      f.items.findIndex(
        (i) => i.playlistId === f.tenants[1].panicLockdownPlaylistId,
      ),
      1,
    );
    const counts = [f.assets.length, f.playlists.length, f.audits.length];
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ['empty'], 'admin'),
    ).toEqual({
      locationsEnabled: 0,
      locationsInitialized: 0,
      defaultBucketsLoaded: 0,
    });
    expect([f.assets.length, f.playlists.length, f.audits.length]).toEqual(
      counts,
    );
    expect(
      f.items.some(
        (i) => i.playlistId === f.tenants[1].panicLockdownPlaylistId,
      ),
    ).toBe(false);
  });

  it('dry run plans the same changes without writes, including no claiming of legacy buckets', async () => {
    const f = fixture();
    const before = JSON.stringify([
      f.tenants,
      f.playlists,
      f.assets,
      f.items,
      f.audits,
    ]);
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ids, null, 'maintenance', {
        dryRun: true,
      }),
    ).toEqual({
      locationsEnabled: 3,
      locationsInitialized: 2,
      defaultBucketsLoaded: 2,
    });
    expect(
      JSON.stringify([f.tenants, f.playlists, f.assets, f.items, f.audits]),
    ).toBe(before);
    expect(f.tx.playlist.updateMany).not.toHaveBeenCalled();
    expect(f.tx.tenant.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditLog.createMany).not.toHaveBeenCalled();
  });

  it.each(['PENDING_APPROVAL', 'REJECTED'])(
    'refuses %s corporate media before any writes',
    async (status) => {
      const f = fixture();
      f.sourceAsset.status = status;
      await expect(
        initializeEmergencyLocations(f.tx, 'hq', ids, 'admin'),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.tx.asset.createMany).not.toHaveBeenCalled();
      expect(f.tx.tenant.updateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses a foreign asset and scopes playlist reads to the corporate tenant', async () => {
    const f = fixture();
    f.sourceAsset.tenantId = 'other';
    await expect(
      initializeEmergencyLocations(f.tx, 'hq', ids, 'admin'),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.tx.playlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'hq', id: { in: ['hq-alert'] } },
      }),
    );
  });

  it('preserves an unprotected local playlist even if empty', async () => {
    const f = fixture();
    f.playlists.find((p) => p.id === 'legacy-alert').isProtected = false;
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ['legacy'], 'admin'),
    ).toMatchObject({ locationsEnabled: 1, locationsInitialized: 0 });
    expect(f.tx.playlist.updateMany).not.toHaveBeenCalled();
  });

  it('still enables a location when HQ has no media, without claiming content is loaded', async () => {
    const f = fixture();
    f.items.splice(0, 1);
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ['empty'], 'admin'),
    ).toEqual({
      locationsEnabled: 1,
      locationsInitialized: 0,
      defaultBucketsLoaded: 0,
    });
    expect(f.tx.asset.createMany).not.toHaveBeenCalled();
  });

  it.each(['hq', 'empty'])(
    'refuses initialization while an alert is active in %s, without touching alert state',
    async (id) => {
      const f = fixture();
      f.tenants.find((t) => t.id === id).emergencyStatus = 'CRITICAL';
      await expect(
        initializeEmergencyLocations(f.tx, 'hq', ids, 'admin'),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.tx.asset.createMany).not.toHaveBeenCalled();
      expect(f.tx.tenant.updateMany).not.toHaveBeenCalled();
      expect(f.tx.auditLog.createMany).not.toHaveBeenCalled();
      expect(f.tenants.find((t) => t.id === id).emergencyStatus).toBe(
        'CRITICAL',
      );
    },
  );

  it('does nothing for a disabled parent', async () => {
    const f = fixture();
    f.tenants[0].emergencyEnabled = false;
    expect(
      await initializeEmergencyLocations(f.tx, 'hq', ids, 'admin'),
    ).toEqual({
      locationsEnabled: 0,
      locationsInitialized: 0,
      defaultBucketsLoaded: 0,
    });
    expect(f.tx.tenant.updateMany).not.toHaveBeenCalled();
  });
});

describe('Corporate enablement and new location integration', () => {
  const req: any = {
    user: { tenantId: 'hq', userId: 'admin', role: 'DISTRICT_ADMIN' },
  };
  it('walks only the caller subtree and commits config, copies and root/child audit rows together', async () => {
    const f = fixture();
    const controller = new TenantsController(f.prisma, {} as any, {} as any);
    expect(
      await controller.setEmergencyEnabled(req, {
        enabled: true,
        applyToAllLocations: true,
      }),
    ).toMatchObject({ ok: true, locationsEnabled: 3, locationsInitialized: 2 });
    expect(f.prisma.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 20000 },
    );
    expect(f.tx.tenant.findMany).toHaveBeenCalledWith({
      where: { parentId: { in: ['hq'] }, archivedAt: null },
      select: { id: true },
    });
    expect(f.audits.find((a) => a.tenantId === 'hq')).toMatchObject({
      action: 'EMERGENCY_ENABLED_CHANGED',
      userId: 'admin',
    });
    expect(f.tenants.find((t) => t.id === 'other').emergencyEnabled).toBeNull();
  });
  it('local admin changes and corporate changes without opting in do not cascade to other locations', async () => {
    for (const [role, enabled] of [
      ['SCHOOL_ADMIN', true],
      ['DISTRICT_ADMIN', false],
      ['DISTRICT_ADMIN', true],
    ] as const) {
      const f = fixture();
      const controller = new TenantsController(f.prisma, {} as any, {} as any);
      await controller.setEmergencyEnabled(
        { user: { ...req.user, role } },
        { enabled },
      );
      expect(f.tx.tenant.findMany).not.toHaveBeenCalled();
      expect(f.tenants[1].emergencyEnabled).toBeNull();
    }
  });
  it('does not silently enroll a new location when corporate is enabled', async () => {
    const f = fixture();
    const controller = new TenantsController(f.prisma, {} as any, {} as any);
    await controller.createChild(req, { name: 'New Location' });
    expect(f.tenants.find((t) => t.id === 'new-location')).toMatchObject({
      parentId: 'hq',
      emergencyEnabled: null,
    });
    expect(f.tx.asset.createMany).not.toHaveBeenCalled();
    expect(
      f.audits
        .filter((a) => a.targetId === 'new-location')
        .map((a) => a.action),
    ).toEqual(['CHILD_TENANT_CREATED']);
  });
  it.each([
    {
      role: 'SCHOOL_ADMIN',
      enabled: true,
      applyToAllLocations: true,
      status: 403,
    },
    {
      role: 'DISTRICT_ADMIN',
      enabled: false,
      applyToAllLocations: true,
      status: 403,
    },
    {
      role: 'DISTRICT_ADMIN',
      enabled: true,
      applyToAllLocations: 'true',
      status: 400,
    },
  ])(
    'refuses invalid or unauthorized company-wide configuration without any write: %p',
    async (input) => {
      const f = fixture();
      const controller = new TenantsController(f.prisma, {} as any, {} as any);
      await expect(
        controller.setEmergencyEnabled(
          { user: { ...req.user, role: input.role } },
          input as any,
        ),
      ).rejects.toMatchObject({ status: input.status });
      expect(f.prisma.client.$transaction).not.toHaveBeenCalled();
    },
  );
  it('an initialization failure rejects the entire enablement transaction rather than returning success', async () => {
    const f = fixture();
    f.sourceAsset.status = 'REJECTED';
    const controller = new TenantsController(f.prisma, {} as any, {} as any);
    await expect(
      controller.setEmergencyEnabled(req, {
        enabled: true,
        applyToAllLocations: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
