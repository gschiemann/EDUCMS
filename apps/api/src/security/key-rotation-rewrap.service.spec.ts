/**
 * The one-shot re-wrap job (2026-10-22): every stored credential envelope is
 * moved onto the primary DEVICE_SECRET_KEY during a rotation window.
 *
 * Proves, against an in-memory Prisma double holding all seven sealed stores:
 *   • no window ⇒ no reads, no writes, no audit row (`ran: false`)
 *   • old-key rows are re-wrapped and then open with the primary ALONE;
 *     primary rows are left alone; unreadable rows are counted and untouched
 *   • a second run rewrites nothing (idempotent)
 *   • every write is guarded on id + tenant + the exact old ciphertext: a row
 *     the operator re-sealed concurrently is skipped, never overwritten
 *   • the AuditLog row carries counts only — never a ciphertext or a key
 *   • the boot pass defers to the leader lease
 */
import { KeyRotationRewrapService, KEY_ROTATION_REWRAP_AUDIT_ACTION } from './key-rotation-rewrap.service';
import { sealCredentials, openCredentials } from '../streaming/creds-cipher';
import { sealAiKey, openAiKey } from '../ai/ai-key-cipher';
import { sealMfaSecret, openMfaSecret } from '../auth/mfa-secret-cipher';
import { SYSTEM_TENANT_ID } from './system-tenant';

const NEW_HEX = 'aa'.repeat(32);
const OLD_HEX = 'bb'.repeat(32);
const UNRELATED_HEX = 'cc'.repeat(32);
const VARS = ['NODE_ENV', 'DEVICE_SECRET_KEY', 'DEVICE_SECRET_KEY_PREVIOUS'] as const;
const saved: Record<string, string | undefined> = {};

function withKeys<T>(primary: string, previous: string | undefined, fn: () => T): T {
  process.env.DEVICE_SECRET_KEY = primary;
  if (previous === undefined) delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
  else process.env.DEVICE_SECRET_KEY_PREVIOUS = previous;
  return fn();
}

beforeAll(() => {
  for (const k of VARS) saved[k] = process.env[k];
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type Row = Record<string, any>;

/**
 * A tiny Prisma double: `findMany` with select/where-not-null/orderBy/cursor/
 * skip/take, and `updateMany` with an exact-match `where` — the only two
 * shapes the job uses.
 */
function delegate(rows: Row[], idField = 'id') {
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'not' in v ? row[k] !== v.not : row[k] === v,
    );
  return {
    rows,
    findMany: jest.fn(async (args: Row) => {
      let out = rows.filter((r) => (args.where ? matches(r, args.where) : true));
      out = [...out].sort((a, b) => String(a[idField]).localeCompare(String(b[idField])));
      if (args.cursor) {
        const i = out.findIndex((r) => r[idField] === args.cursor[idField]);
        out = out.slice(i + (args.skip ?? 0));
      }
      if (args.take) out = out.slice(0, args.take);
      return out.map((r) => {
        const picked: Row = {};
        for (const k of Object.keys(args.select)) picked[k] = r[k];
        return picked;
      });
    }),
    updateMany: jest.fn(async (args: Row) => {
      let count = 0;
      for (const r of rows) {
        if (matches(r, args.where)) {
          Object.assign(r, args.data);
          count++;
        }
      }
      return { count };
    }),
  };
}

function makeWorld() {
  const sealedUnder = (hex: string, plain: Row) => withKeys(hex, undefined, () => sealCredentials(plain));
  const aiUnder = (hex: string) => withKeys(hex, undefined, () => sealAiKey('sk-ant-test-0123456789abcdef'));
  const mfaUnder = (hex: string) => withKeys(hex, undefined, () => sealMfaSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'));

  const stream = [
    { id: 's-old', tenantId: 't1', ...sealedUnder(OLD_HEX, { k: 'stream-old' }) },
    { id: 's-new', tenantId: 't1', ...sealedUnder(NEW_HEX, { k: 'stream-new' }) },
  ];
  const pos = [{ id: 'p-old', tenantId: 't2', ...sealedUnder(OLD_HEX, { accessToken: 'pos' }) }];
  const ads = [{ id: 'a-unreadable', tenantId: 't2', ...sealedUnder(UNRELATED_HEX, { k: 'x' }) }];
  const social = [{ id: 'so-old', tenantId: 't3', ...sealedUnder(OLD_HEX, { accessToken: 'ig' }) }];
  const wifi = [
    { screenId: 'scr-1', tenantId: 't1', wifiSecret: JSON.stringify(sealedUnder(OLD_HEX, { passphrase: 'hunter2' })) },
    { screenId: 'scr-2', tenantId: 't1', wifiSecret: null },
    { screenId: 'scr-3', tenantId: 't1', wifiSecret: 'not-json' },
  ];
  const tenants = [
    { id: 't1', aiKeyEncrypted: aiUnder(OLD_HEX) },
    { id: 't2', aiKeyEncrypted: null },
    { id: 't3', aiKeyEncrypted: aiUnder(NEW_HEX) },
  ];
  const users = [
    { id: 'u-old', tenantId: 't1', mfaTotpSecret: mfaUnder(OLD_HEX) },
    { id: 'u-none', tenantId: 't1', mfaTotpSecret: null },
  ];

  const auditRows: Row[] = [];
  const client: Row = {
    streamProviderConnection: delegate(stream),
    posProviderConnection: delegate(pos),
    adNetworkConnection: delegate(ads),
    socialProviderConnection: delegate(social),
    desiredDeviceSettings: delegate(wifi, 'screenId'),
    tenant: Object.assign(delegate(tenants), { upsert: jest.fn(async () => ({})) }),
    user: delegate(users),
    auditLog: { create: jest.fn(async ({ data }: Row) => void auditRows.push(data)) },
  };
  return { client, auditRows, stream, pos, ads, social, wifi, tenants, users };
}

const svcFor = (client: Row, lease?: any) => new KeyRotationRewrapService({ client } as any, lease);

describe('KeyRotationRewrapService', () => {
  it('is a NO-OP with no window open: reads nothing, writes nothing, audits nothing', async () => {
    const w = makeWorld();
    const report = await withKeys(NEW_HEX, undefined, () => svcFor(w.client).run('manual'));
    expect(report.ran).toBe(false);
    expect(report.totals.scanned).toBe(0);
    expect(w.client.streamProviderConnection.findMany).not.toHaveBeenCalled();
    expect(w.client.auditLog.create).not.toHaveBeenCalled();
    expect(await withKeys(NEW_HEX, undefined, () => svcFor(w.client).runAtBoot())).toBeNull();
  });

  it('re-wraps old-key rows across all seven stores, leaves primary and unreadable rows, and is idempotent', async () => {
    const w = makeWorld();
    const first = await withKeys(NEW_HEX, OLD_HEX, () => svcFor(w.client).run('manual', 'admin-1'));

    expect(first.ran).toBe(true);
    expect(first.tables['StreamProviderConnection']).toMatchObject({ scanned: 2, rewrapped: 1, current: 1, unreadable: 0 });
    expect(first.tables['PosProviderConnection']).toMatchObject({ scanned: 1, rewrapped: 1 });
    expect(first.tables['AdNetworkConnection']).toMatchObject({ scanned: 1, rewrapped: 0, unreadable: 1 });
    expect(first.tables['SocialProviderConnection']).toMatchObject({ scanned: 1, rewrapped: 1 });
    // null wifi row is not scanned; the non-JSON one is unreadable and untouched.
    expect(first.tables['DesiredDeviceSettings.wifiSecret']).toMatchObject({ scanned: 2, rewrapped: 1, unreadable: 1 });
    expect(first.tables['Tenant.aiKeyEncrypted']).toMatchObject({ scanned: 2, rewrapped: 1, current: 1 });
    expect(first.tables['User.mfaTotpSecret']).toMatchObject({ scanned: 1, rewrapped: 1 });
    expect(first.totals).toMatchObject({ rewrapped: 6, unreadable: 2, skipped: 0 });

    // Every moved row now opens with the PRIMARY ALONE, and plaintext is intact.
    withKeys(NEW_HEX, undefined, () => {
      expect(openCredentials(w.stream[0] as any)).toEqual({ k: 'stream-old' });
      expect(openCredentials(w.pos[0] as any)).toEqual({ accessToken: 'pos' });
      expect(openCredentials(w.social[0] as any)).toEqual({ accessToken: 'ig' });
      expect(openCredentials(JSON.parse(w.wifi[0].wifiSecret as string))).toEqual({ passphrase: 'hunter2' });
      expect(openAiKey(w.tenants[0].aiKeyEncrypted as string)).toBe('sk-ant-test-0123456789abcdef');
      expect(openMfaSecret(w.users[0].mfaTotpSecret as string)).toBe('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    });
    // Untouched rows are byte-identical.
    expect(w.wifi[2].wifiSecret).toBe('not-json');
    expect(w.wifi[1].wifiSecret).toBeNull();

    // Second run: nothing left to move.
    const second = await withKeys(NEW_HEX, OLD_HEX, () => svcFor(w.client).run('manual'));
    expect(second.totals.rewrapped).toBe(0);
    expect(second.totals.current).toBe(6 + 2); // the 6 moved + the 2 that were already current
    expect(second.totals.unreadable).toBe(2);
  });

  it('writes are tenant-scoped and guarded on the exact old ciphertext (a concurrent re-seal is never overwritten)', async () => {
    const w = makeWorld();
    const original = w.client.user.updateMany;
    // Simulate the operator re-enrolling MFA between the read and the write.
    w.client.user.updateMany = jest.fn(async (args: Row) => {
      const freshSeal = withKeys(NEW_HEX, undefined, () => sealMfaSecret('NEWSECRETNEWSECRETNEWSECRETNEWSE'));
      w.users[0].mfaTotpSecret = freshSeal;
      return original(args);
    });
    const report = await withKeys(NEW_HEX, OLD_HEX, () => svcFor(w.client).run('manual'));
    expect(report.tables['User.mfaTotpSecret']).toMatchObject({ rewrapped: 0, skipped: 1 });
    withKeys(NEW_HEX, undefined, () =>
      expect(openMfaSecret(w.users[0].mfaTotpSecret as string)).toBe('NEWSECRETNEWSECRETNEWSECRETNEWSE'),
    );
    // Every guarded where names the tenant (the Tenant table is keyed by its own id).
    for (const d of ['streamProviderConnection', 'posProviderConnection', 'socialProviderConnection', 'desiredDeviceSettings'] as const) {
      for (const call of w.client[d].updateMany.mock.calls) {
        expect(call[0].where.tenantId).toBeDefined();
        expect(Object.keys(call[0].where)).toEqual(expect.arrayContaining(['tenantId']));
      }
    }
    expect(w.client.user.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'u-old', tenantId: 't1' });
  });

  it('writes ONE AuditLog row per run with counts only — never a ciphertext, key or plaintext', async () => {
    const w = makeWorld();
    await withKeys(NEW_HEX, OLD_HEX, () => svcFor(w.client).run('manual', 'admin-1'));
    expect(w.auditRows).toHaveLength(1);
    const row = w.auditRows[0];
    expect(row).toMatchObject({
      action: KEY_ROTATION_REWRAP_AUDIT_ACTION,
      tenantId: SYSTEM_TENANT_ID,
      userId: 'admin-1',
      targetType: 'secret',
      targetId: 'DEVICE_SECRET_KEY',
    });
    const details = JSON.parse(row.details);
    expect(details.trigger).toBe('manual');
    expect(details.totals.rewrapped).toBe(6);
    const serialised = JSON.stringify(row);
    for (const needle of [NEW_HEX, OLD_HEX, 'hunter2', 'sk-ant-test', 'JBSWY3DP', ...w.stream.map((r) => r.encryptedDataKey)]) {
      expect(serialised).not.toContain(needle);
    }
    // Only numbers under tables/totals.
    for (const counts of Object.values(details.tables) as Row[]) {
      for (const v of Object.values(counts)) expect(typeof v).toBe('number');
    }
  });

  it('the boot pass runs only on the lease leader and releases the lease afterwards', async () => {
    const w = makeWorld();
    const follower = { tryAcquire: jest.fn(async () => ({ leader: false, degraded: false, fence: 0, name: 'x' })), release: jest.fn() };
    expect(await withKeys(NEW_HEX, OLD_HEX, () => svcFor(w.client, follower).runAtBoot())).toBeNull();
    expect(w.client.streamProviderConnection.findMany).not.toHaveBeenCalled();

    const leader = { tryAcquire: jest.fn(async () => ({ leader: true, degraded: false, fence: 1, name: 'x' })), release: jest.fn(async () => undefined) };
    const report = await withKeys(NEW_HEX, OLD_HEX, () => svcFor(w.client, leader).runAtBoot());
    expect(report?.ran).toBe(true);
    expect(report?.trigger).toBe('boot');
    expect(leader.tryAcquire).toHaveBeenCalledWith('security:key-rotation-rewrap', expect.any(Object));
    expect(leader.release).toHaveBeenCalledWith('security:key-rotation-rewrap');
  });

  it('two overlapping triggers on one process coalesce into a single pass', async () => {
    const w = makeWorld();
    const svc = svcFor(w.client);
    const [a, b] = await withKeys(NEW_HEX, OLD_HEX, () => Promise.all([svc.run('manual'), svc.run('boot')]));
    expect(a).toBe(b);
    expect(w.auditRows).toHaveLength(1);
  });
});
