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
