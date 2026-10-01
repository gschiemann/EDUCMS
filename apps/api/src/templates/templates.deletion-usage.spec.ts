import { TemplatesController } from './templates.controller';

function setup({ found = true, protection = 'none', count = 2 } = {}) {
  const refs = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Playlist ${i}`,
  }));
  const client = {
    template: {
      findFirst: jest.fn().mockResolvedValue(found ? { id: 'tpl1' } : null),
    },
    playlist: {
      findMany: jest.fn().mockResolvedValue(refs),
      findFirst: jest
        .fn()
        .mockResolvedValue(
          protection === 'protected' ? { id: 'private-id' } : null,
        ),
    },
    tenant: {
      findFirst:
        protection === 'check-broken'
          ? jest.fn().mockRejectedValue(new Error('db down'))
          : jest.fn().mockResolvedValue(null),
    },
    screen: { findFirst: jest.fn().mockResolvedValue(null) },
    screenEmergencyOverride: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const controller = Object.create(
    TemplatesController.prototype,
  ) as TemplatesController;
  Object.assign(controller, {
    prisma: { client },
    playlistReach: jest.fn().mockResolvedValue({
      byPlaylist: new Map(
        refs.map((p, i) => [
          p.id,
          {
            screens: new Set(['shared-screen', `s${i}`]),
            tenants: new Set(['t1']),
            activeNow: true,
          },
        ]),
      ),
    }),
  });
  return { controller, client, refs };
}
const req = { user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } };

describe('fresh template deletion impact (read-only)', () => {
  it('scopes template and playlists to the caller and unions reach across all playlists', async () => {
    const { controller, client, refs } = setup({ count: 8 });
    await expect(controller.deletionUsage(req, 'tpl1')).resolves.toEqual({
      playlists: refs.slice(0, 6),
      total: 8,
      screensReached: 9,
      locations: 1,
      protectedEmergency: false,
    });
    expect(client.template.findFirst).toHaveBeenCalledWith({
      where: { id: 'tpl1', tenantId: 't1' },
      select: { id: true },
    });
    expect(client.playlist.findMany).toHaveBeenCalledWith({
      where: { templateId: 'tpl1', tenantId: 't1' },
      select: { id: true, name: true },
    });
  });

  it('a missing or other-tenant template reveals no usage', async () => {
    const { controller, client } = setup({ found: false });
    await expect(
      controller.deletionUsage(req, 'other-tenant-template'),
    ).rejects.toMatchObject({ status: 404 });
    expect(client.playlist.findMany).not.toHaveBeenCalled();
  });

  it('unused templates have zero reach and need no protection lookup', async () => {
    const { controller, client } = setup({ count: 0 });
    await expect(controller.deletionUsage(req, 'tpl1')).resolves.toEqual({
      playlists: [],
      total: 0,
      screensReached: 0,
      locations: 0,
      protectedEmergency: false,
    });
    expect(client.playlist.findFirst).not.toHaveBeenCalled();
  });

  it.each(['protected', 'check-broken'])(
    'returns only a protection boolean when %s, without exposing guard details',
    async (protection) => {
      const { controller } = setup({ protection });
      const usage = await controller.deletionUsage(req, 'tpl1');
      expect(usage.protectedEmergency).toBe(true);
      expect(JSON.stringify(usage)).not.toContain('private-id');
      expect(JSON.stringify(usage)).not.toContain('db down');
    },
  );
});
