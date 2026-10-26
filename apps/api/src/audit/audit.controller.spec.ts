import { AuditController } from './audit.controller';

describe('AuditController', () => {
  let controller: AuditController;
  let auditLog: any;

  beforeEach(() => {
    auditLog = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const prisma: any = { client: { auditLog } };
    controller = new AuditController(prisma);
  });

  const req = (overrides: any = {}) => ({ user: { tenantId: 't1', id: 'u1' }, ...overrides });

  it('list clamps limit and offset', async () => {
    auditLog.findMany.mockResolvedValue([{ id: 'a' }]);
    auditLog.count.mockResolvedValue(1);
    const res = await controller.list(req(), undefined, undefined, undefined, undefined, '9999', '-5');
    expect(res.limit).toBe(200); // clamped to max
    expect(res.offset).toBe(0);   // clamped to min
    const findArgs = auditLog.findMany.mock.calls[0][0];
    expect(findArgs.where.tenantId).toBe('t1');
  });

  it('list applies date + actor + action filters', async () => {
    await controller.list(
      req(),
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
      'user-42',
      'TRIGGER_EMERGENCY',
      '10',
      '0',
    );
    const where = auditLog.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.userId).toBe('user-42');
    expect(where.action).toBe('TRIGGER_EMERGENCY');
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
  });

  it('list ignores invalid dates instead of throwing', async () => {
    await controller.list(req(), 'not-a-date', undefined);
    const where = auditLog.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toBeUndefined();
  });

  it('exportCsv writes a csv payload with header and csv-safe escaping', async () => {
    auditLog.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-04-16T10:00:00.000Z'),
        action: 'TRIGGER_EMERGENCY',
        targetType: 'tenant',
        targetId: 't1',
        details: 'line1\n"quoted",line2',
        user: { email: 'admin@example.com', role: 'SCHOOL_ADMIN' },
      },
    ]);
    const headers: Record<string, string> = {};
    let body = '';
    const res: any = {
      setHeader: (k: string, v: string) => (headers[k] = v),
      send: (v: string) => (body = v),
    };
    await controller.exportCsv(req(), res);
    expect(headers['Content-Type']).toContain('text/csv');
    expect(headers['Content-Disposition']).toContain('attachment');
    expect(body.startsWith('timestamp,actorEmail,actorRole,action,targetType,targetId,details')).toBe(true);
    expect(body).toContain('admin@example.com');
    // details had newline + comma + quote — must be quoted & escaped
    expect(body).toContain('"line1\n""quoted"",line2"');
  });
});

/**
 * 2026-10-24 — customer-facing activity. The owner's phone showed
 * "Field Build Window Expire · field_build_window" and "Ota Push Held ·
 * screen" on Home; customers now read an ALLOWLIST written by people, and
 * only a SUPER_ADMIN who asks for it reads the raw trail.
 */
describe('AuditController — customer activity vs the raw trail', () => {
  let controller: AuditController;
  let auditLog: any;
  let playlist: any;
  let screen: any;

  beforeEach(() => {
    auditLog = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    playlist = { findMany: jest.fn().mockResolvedValue([]) };
    screen = { findMany: jest.fn().mockResolvedValue([]) };
    controller = new AuditController({ client: { auditLog, playlist, screen } } as any);
  });

  const admin = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } };
  const owner = { user: { tenantId: 't1', id: 'owner', role: 'SUPER_ADMIN' } };

  /** The action filter Prisma received, as a set (or a single value). */
  const actionFilter = () => auditLog.findMany.mock.calls[0][0].where.action;

  it('the dashboard card reads the allowlist only — never OTA / field-build / token rows', async () => {
    await controller.getRecentActivity(owner);
    const where = auditLog.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    const allowed: string[] = where.action.in;
    expect(allowed).toEqual(expect.arrayContaining(['PLAYLIST_CREATED', 'SCHEDULE_CREATED', 'TRIGGER_EMERGENCY']));
    for (const backend of ['FIELD_BUILD_WINDOW_EXPIRE', 'OTA_PUSH_HELD', 'PLAYER_FIELD_APK_OFFER', 'FIELD_BUILD_PUSH', 'SCREEN_TOKEN_RENEWED']) {
      expect(allowed).not.toContain(backend);
    }
    // …and a person (or the customer's own API key) wrote it.
    const actor = where.AND[0].OR;
    expect(actor).toEqual(expect.arrayContaining([{ userId: { not: null } }, { apiKeyId: { not: null } }]));
  });

  it('the card resolves names: "published “Lobby loop” to Lobby TV"', async () => {
    auditLog.findMany.mockResolvedValue([
      {
        id: 'a1', tenantId: 't1', userId: 'u2', apiKeyId: null, supportGrantId: null,
        action: 'SCHEDULE_CREATED', targetType: 'Schedule', targetId: 's1',
        details: JSON.stringify({ playlistId: 'p1', screenId: 'scr1', mode: 'replace' }),
        createdAt: new Date('2026-10-24T10:00:00Z'),
        user: { email: 'greg@example.com', role: 'SCHOOL_ADMIN', firstName: 'Greg', lastName: 'S', tenantId: 't1' },
      },
    ]);
    playlist.findMany.mockResolvedValue([{ id: 'p1', name: 'Lobby loop' }]);
    screen.findMany.mockResolvedValue([{ id: 'scr1', name: 'Lobby TV' }]);
    const [item] = await controller.getRecentActivity(admin);
    expect(item).toMatchObject({
      action: 'SCHEDULE_CREATED',
      category: 'content',
      subject: 'Lobby loop',
      target: 'Lobby TV',
      targetKey: 'scr1',
      actor: { kind: 'person', userId: 'u2', name: 'Greg' },
    });
    // Lookups stay inside the caller's tenant.
    expect(playlist.findMany.mock.calls[0][0].where.tenantId).toEqual({ in: ['t1'] });
    // Raw details never travel in the item.
    expect((item as any).details).toBeUndefined();
  });

  it('a VenueOS super admin working in a customer organisation reads as VenueOS support', async () => {
    auditLog.findMany.mockResolvedValue([
      {
        id: 'a2', tenantId: 't1', userId: 'owner', apiKeyId: null, supportGrantId: null,
        action: 'PLAYLIST_CREATED', targetType: 'Playlist', targetId: 'p9',
        details: JSON.stringify({ name: 'Fall promo' }), createdAt: new Date(),
        user: { email: 'owner@venueos.test', role: 'SUPER_ADMIN', firstName: 'Owner', lastName: null, tenantId: 'home' },
      },
    ]);
    const [item] = await controller.getRecentActivity(admin);
    expect(item.actor).toEqual({ kind: 'support', userId: 'owner', name: null });
    expect(item.subject).toBe('Fall promo');
  });

  it('a customer admin cannot ask for the raw trail', async () => {
    await controller.list(admin, undefined, undefined, undefined, undefined, '50', '0', undefined, 'all');
    expect(actionFilter().in).toEqual(expect.arrayContaining(['PLAYLIST_CREATED']));
    expect(actionFilter().in).not.toContain('OTA_PUSH_HELD');
  });

  it('a customer asking for a backend action gets an empty page and no query', async () => {
    const res = await controller.list(admin, undefined, undefined, undefined, 'FIELD_BUILD_WINDOW_EXPIRE', '50', '0');
    expect(res).toMatchObject({ items: [], total: 0, view: 'activity' });
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });

  it('a category narrows to one shelf of the allowlist; an unknown one is ignored', async () => {
    await controller.list(admin, undefined, undefined, undefined, undefined, '50', '0', undefined, undefined, 'emergency');
    const shelf: string[] = actionFilter().in;
    expect(shelf).toEqual(expect.arrayContaining(['TRIGGER_EMERGENCY', 'CLEAR_EMERGENCY_DRILL']));
    expect(shelf).not.toContain('PLAYLIST_CREATED');
    auditLog.findMany.mockClear();
    await controller.list(admin, undefined, undefined, undefined, undefined, '50', '0', undefined, undefined, 'nonsense');
    expect(actionFilter().in).toContain('PLAYLIST_CREATED');
    // An action outside the requested shelf: empty, no query.
    auditLog.findMany.mockClear();
    const res = await controller.list(admin, undefined, undefined, undefined, 'PLAYLIST_CREATED', '50', '0', undefined, undefined, 'emergency');
    expect(res.items).toEqual([]);
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });

  it('an allowlisted action filter is honoured exactly (Settings pages read drill history this way)', async () => {
    await controller.list(admin, undefined, undefined, undefined, 'TRIGGER_EMERGENCY_DRILL', '50', '0');
    expect(actionFilter()).toBe('TRIGGER_EMERGENCY_DRILL');
  });

  it('customer rows keep every column they had and gain names', async () => {
    auditLog.findMany.mockResolvedValue([
      {
        id: 'a3', tenantId: 't1', userId: 'u1', apiKeyId: null, supportGrantId: null,
        action: 'PLAYLIST_DELETED', targetType: 'Playlist', targetId: 'p3',
        details: JSON.stringify({ name: 'Old loop' }), createdAt: new Date(),
        user: { email: 'a@b.test', role: 'SCHOOL_ADMIN', firstName: null, lastName: null, tenantId: 't1' },
      },
    ]);
    auditLog.count.mockResolvedValue(1);
    const res: any = await controller.list(admin);
    expect(res.items[0]).toMatchObject({
      id: 'a3',
      details: JSON.stringify({ name: 'Old loop' }),
      user: { email: 'a@b.test' },
      subject: 'Old loop',
      actor: { kind: 'person', name: 'a' },
    });
  });

  it('the owner keeps the raw trail by default and can ask for the customer view', async () => {
    await controller.list(owner);
    expect(auditLog.findMany.mock.calls[0][0].where.action).toBeUndefined();
    auditLog.findMany.mockClear();
    await controller.list(owner, undefined, undefined, undefined, undefined, '50', '0', undefined, 'activity');
    expect(actionFilter().in).toEqual(expect.arrayContaining(['TRIGGER_EMERGENCY']));
  });

  it('a customer export is the customer view; the owner export stays raw', async () => {
    const res: any = { setHeader: () => undefined, send: () => undefined };
    await controller.exportCsv(admin, res);
    expect(actionFilter().in).not.toContain('SCREEN_TOKEN_RENEWED');
    auditLog.findMany.mockClear();
    await controller.exportCsv(owner, res);
    expect(auditLog.findMany.mock.calls[0][0].where.action).toBeUndefined();
  });
});
