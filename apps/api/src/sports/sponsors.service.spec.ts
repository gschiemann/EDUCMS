/**
 * VenueOS Sports — SponsorsService tests.
 *
 * Sponsor CRUD validation + the proof-of-play report math (the part
 * that closes the ad sale). In-memory Prisma fake, no DB.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SponsorsService } from './sponsors.service';

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      return false;
    }
    return row[k] === v;
  });
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where || {})),
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('Row not found');
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

const TENANT = 'tenant-1';

function setup() {
  const sponsor = makeTable();
  const game = makeTable();
  // P0-4 — sponsor CRUD now writes AuditLog rows; the in-memory fake
  // needs the table or every mutation would hit the audit helper's
  // try/catch and log a warn. Including it lets tests assert audit rows.
  const auditLog = makeTable();
  const prisma = { client: { sponsor, game, auditLog } };
  const service = new SponsorsService(prisma as any);
  return { service, sponsor, game, auditLog };
}

describe('SponsorsService — create', () => {
  it('rejects an empty name', async () => {
    const { service } = setup();
    await expect(service.create(TENANT, { name: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('defaults to active with weight 1', async () => {
    const { service } = setup();
    const s = await service.create(TENANT, { name: "Joe's Pizza" });
    expect(s.active).toBe(true);
    expect(s.weight).toBe(1);
    expect(s.tenantId).toBe(TENANT);
  });

  it('clamps the rotation weight to 1–10', async () => {
    const { service } = setup();
    expect((await service.create(TENANT, { name: 'A', weight: 99 })).weight).toBe(10);
    expect((await service.create(TENANT, { name: 'B', weight: 0 })).weight).toBe(1);
    expect((await service.create(TENANT, { name: 'C', weight: 3 })).weight).toBe(3);
  });

  it('bounds an over-long name', async () => {
    const { service } = setup();
    const s = await service.create(TENANT, { name: 'x'.repeat(500) });
    expect(s.name.length).toBe(120);
  });
});

describe('SponsorsService — update & remove', () => {
  it('rejects clearing the name to empty', async () => {
    const { service } = setup();
    const s = await service.create(TENANT, { name: 'Acme' });
    await expect(service.update(TENANT, s.id, { name: '' })).rejects.toThrow(BadRequestException);
  });

  it('is tenant-scoped', async () => {
    const { service } = setup();
    const s = await service.create(TENANT, { name: 'Acme' });
    await expect(service.update('other', s.id, { weight: 2 })).rejects.toThrow(NotFoundException);
    await expect(service.remove('other', s.id)).rejects.toThrow(NotFoundException);
    await expect(service.remove(TENANT, s.id)).resolves.toEqual({ deleted: true });
  });
});

describe('SponsorsService — proof-of-play report', () => {
  it('handles zero sponsors and zero games without error', async () => {
    const { service } = setup();
    const report = await service.report(TENANT);
    expect(report.totalGames).toBe(0);
    expect(report.totalLiveSeconds).toBe(0);
    expect(report.sponsors).toEqual([]);
    expect(report.spotSeconds).toBe(8);
  });

  it('estimates spots from live game time and rotation weight', async () => {
    const { service, sponsor, game } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Gold', weight: 1, active: true, tier: 'Gold' });
    // one finished game, exactly 1 hour of live time
    game.rows.push({
      tenantId: TENANT,
      status: 'FINAL',
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(),
      updatedAt: new Date(),
    });
    const report = await service.report(TENANT);
    expect(report.totalGames).toBe(1);
    expect(report.totalLiveSeconds).toBe(3600);
    // cycle = (1 stats slot + weight 1) * 8s = 16s → 3600/16 = 225 spots
    const row = report.sponsors.find((s) => s.id === 'sp1')!;
    expect(row.estimatedSpots).toBe(225);
    expect(row.estimatedExposureSeconds).toBe(225 * 8);
  });

  it('counts a FINAL game that is missing endedAt (fallback to updatedAt)', async () => {
    const { service, sponsor, game } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Gold', weight: 1, active: true });
    game.rows.push({
      tenantId: TENANT,
      status: 'FINAL',
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: null, // missing — must NOT silently score 0
      updatedAt: new Date(Date.now() - 1_800_000), // went final ~30 min in
    });
    const report = await service.report(TENANT);
    expect(report.totalLiveSeconds).toBeGreaterThan(0);
    expect(report.sponsors[0].estimatedSpots).toBeGreaterThan(0);
  });

  it('gives an inactive sponsor zero spots', async () => {
    const { service, sponsor, game } = setup();
    sponsor.rows.push({ id: 'on', tenantId: TENANT, name: 'On', weight: 1, active: true });
    sponsor.rows.push({ id: 'off', tenantId: TENANT, name: 'Off', weight: 1, active: false });
    game.rows.push({
      tenantId: TENANT,
      status: 'FINAL',
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(),
      updatedAt: new Date(),
    });
    const report = await service.report(TENANT);
    expect(report.sponsors.find((s) => s.id === 'off')!.estimatedSpots).toBe(0);
    expect(report.sponsors.find((s) => s.id === 'on')!.estimatedSpots).toBeGreaterThan(0);
  });

  it('ignores never-started games', async () => {
    const { service, sponsor, game } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Gold', weight: 1, active: true });
    game.rows.push({ tenantId: TENANT, status: 'SCHEDULED', startedAt: null, endedAt: null, updatedAt: new Date() });
    const report = await service.report(TENANT);
    expect(report.totalLiveSeconds).toBe(0);
  });
});

describe('SponsorsService — audit trail (P0-4)', () => {
  it('writes a SPONSOR_CREATED row attributed to the actor', async () => {
    const { service, auditLog } = setup();
    const created = await service.create(TENANT, { name: 'Acme Co', weight: 3 }, 'user-9');
    const row = auditLog.rows.find((r) => r.action === 'SPONSOR_CREATED');
    expect(row).toBeTruthy();
    expect(row.tenantId).toBe(TENANT);
    expect(row.userId).toBe('user-9');
    expect(row.targetType).toBe('Sponsor');
    expect(row.targetId).toBe(created.id);
    expect(JSON.parse(row.details).name).toBe('Acme Co');
  });

  it('writes a SPONSOR_UPDATED row listing the changed fields', async () => {
    const { service, sponsor, auditLog } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Gold', weight: 1, active: true });
    await service.update(TENANT, 'sp1', { weight: 5, active: false }, 'user-9');
    const row = auditLog.rows.find((r) => r.action === 'SPONSOR_UPDATED');
    expect(row).toBeTruthy();
    expect(row.targetId).toBe('sp1');
    expect(JSON.parse(row.details).changedFields).toEqual(
      expect.arrayContaining(['weight', 'active']),
    );
  });

  it('writes a SPONSOR_DELETED row capturing the name before delete', async () => {
    const { service, sponsor, auditLog } = setup();
    sponsor.rows.push({ id: 'sp1', tenantId: TENANT, name: 'Gold', weight: 1, active: true });
    await service.remove(TENANT, 'sp1', 'user-9');
    const row = auditLog.rows.find((r) => r.action === 'SPONSOR_DELETED');
    expect(row).toBeTruthy();
    expect(row.targetId).toBe('sp1');
    expect(JSON.parse(row.details).name).toBe('Gold');
    // sponsor row itself is gone
    expect(sponsor.rows.find((r) => r.id === 'sp1')).toBeUndefined();
  });
});
