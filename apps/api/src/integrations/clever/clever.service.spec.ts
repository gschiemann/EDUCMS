import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CleverService, CLEVER_HTTP_CLIENT } from './clever.service';
import { CleverHttpClient, CleverUser } from './clever-http.client';
import { CleverSyncCron } from './clever-sync.cron';

// Ensure encryption key is set so encryptToken() doesn't throw during OAuth tests.
process.env.CLEVER_ENCRYPTION_KEY =
  process.env.CLEVER_ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.CLEVER_CLIENT_ID = process.env.CLEVER_CLIENT_ID || 'test-client';

class MockHttp implements CleverHttpClient {
  public exchangeCodeCalls: Array<[string, string]> = [];
  public listUsersResponse: CleverUser[] = [];
  public districtId = 'district-1';

  async exchangeCode(code: string, redirectUri: string) {
    this.exchangeCodeCalls.push([code, redirectUri]);
    return { access_token: 'tok-' + code, token_type: 'bearer' };
  }

  async listUsers() {
    return this.listUsersResponse;
  }

  async getDistrictId() {
    return this.districtId;
  }
}

function makePrismaMock() {
  const tenants = new Map<string, any>();
  const users = new Map<string, any>();
  const logs = new Map<string, any>();
  let logSeq = 1;
  let userSeq = 1;

  const client = {
    tenant: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const t = tenants.get(where.id);
        if (!t) return null;
        if (!select) return t;
        const out: any = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = t[k];
        return out;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        return Array.from(tenants.values()).filter((t) =>
          where?.cleverAccessToken?.not !== undefined ? t.cleverAccessToken !== null : true,
        );
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const t = tenants.get(where.id) ?? { id: where.id };
        Object.assign(t, data);
        tenants.set(where.id, t);
        return t;
      }),
    },
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        return Array.from(users.values()).filter((u) => u.tenantId === where.tenantId);
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = 'u' + userSeq++;
        const u = { id, ...data };
        users.set(id, u);
        return u;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const u of users.values()) {
          if (u.tenantId !== where.tenantId) continue;
          const matches = where.OR.some(
            (cond: any) =>
              (cond.cleverId && u.cleverId === cond.cleverId) ||
              (cond.email && u.email === cond.email),
          );
          if (matches) {
            Object.assign(u, data);
            count++;
          }
        }
        return { count };
      }),
    },
    cleverSyncLog: {
      create: jest.fn(async ({ data }: any) => {
        const id = 'log' + logSeq++;
        const row = {
          id,
          tenantId: data.tenantId,
          syncStartedAt: new Date(),
          syncCompletedAt: null,
          usersAdded: 0,
          usersUpdated: 0,
          usersDisabled: 0,
          errorMessage: null,
        };
        logs.set(id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = logs.get(where.id);
        Object.assign(row, data);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = Array.from(logs.values())
          .filter((l) => l.tenantId === where.tenantId)
          .sort((a, b) => b.syncStartedAt.getTime() - a.syncStartedAt.getTime());
        return rows[0] ?? null;
      }),
    },
  };

  return {
    prisma: { client } as unknown as PrismaService,
    _store: { tenants, users, logs },
  };
}

async function setup(tenantSeed?: Partial<{ cleverAccessToken: string | null }>) {
  const { prisma, _store } = makePrismaMock();
  const http = new MockHttp();

  const moduleRef = await Test.createTestingModule({
    providers: [
      CleverService,
      CleverSyncCron,
      { provide: PrismaService, useValue: prisma },
      { provide: CLEVER_HTTP_CLIENT, useValue: http },
    ],
  }).compile();

  const service = moduleRef.get(CleverService);
  const cron = moduleRef.get(CleverSyncCron);

  _store.tenants.set('t1', {
    id: 't1',
    cleverAccessToken: tenantSeed?.cleverAccessToken ?? null,
    cleverDistrictId: null,
    cleverConnectedAt: null,
  });

  return { service, cron, http, store: _store };
}

describe('CleverService', () => {
  describe('OAuth', () => {
    it('builds an authorize URL with tenantId encoded in state', async () => {
      const { service } = await setup();
      const url = service.buildAuthorizeUrl('t1', 'https://app.example.com/cb');
      expect(url).toContain('https://clever.com/oauth/authorize?');
      expect(url).toContain('redirect_uri=https');
      const state = new URL(url).searchParams.get('state')!;
      expect(service.decodeState(state).tenantId).toBe('t1');
    });

    it('exchanges code, stores encrypted token + district id', async () => {
      const { service, http, store } = await setup();
      await service.completeOAuth('t1', 'abc', 'https://app.example.com/cb');
      expect(http.exchangeCodeCalls).toEqual([['abc', 'https://app.example.com/cb']]);
      const t = store.tenants.get('t1');
      expect(t.cleverDistrictId).toBe('district-1');
      expect(t.cleverAccessToken).toBeTruthy();
      expect(t.cleverAccessToken).not.toBe('tok-abc'); // encrypted, not plaintext
      expect(t.cleverConnectedAt).toBeInstanceOf(Date);
    });
  });

  describe('diff logic', () => {
    it('classifies add / update / disable correctly', async () => {
      const { service, store } = await setup();
      store.users.set('u-existing-by-cleverid', {
        id: 'u-existing-by-cleverid',
        tenantId: 't1',
        email: 'alice@school.edu',
        cleverId: 'c-alice',
      });
      store.users.set('u-existing-by-email', {
        id: 'u-existing-by-email',
        tenantId: 't1',
        email: 'bob@school.edu',
        cleverId: null,
      });
      store.users.set('u-stale', {
        id: 'u-stale',
        tenantId: 't1',
        email: 'gone@school.edu',
        cleverId: 'c-gone',
      });

      const remote: CleverUser[] = [
        { id: 'c-alice', email: 'alice@school.edu', role: 'teacher', district: 'd1' },
        { id: 'c-bob', email: 'bob@school.edu', role: 'school_admin', district: 'd1' },
        { id: 'c-new', email: 'carol@school.edu', role: 'teacher', district: 'd1' },
      ];

      const diff = await service.computeDiff('t1', remote);
      expect(diff.toAdd.map((u) => u.email)).toEqual(['carol@school.edu']);
      expect(diff.toUpdate.map((u) => u.id).sort()).toEqual(['c-alice', 'c-bob']);
      expect(diff.toDisable).toEqual(['u-stale']);
    });

    it('skips remote users with null email', async () => {
      const { service } = await setup();
      const remote: CleverUser[] = [
        { id: 'c1', email: null, role: 'teacher', district: 'd1' },
      ];
      const diff = await service.computeDiff('t1', remote);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.toUpdate).toHaveLength(0);
    });
  });

  describe('syncTenant', () => {
    it('creates users and records a sync log', async () => {
      // Seed tenant with a real-encrypted token so decryption works round-trip.
      const { service, http, store } = await setup();
      await service.completeOAuth('t1', 'abc', 'https://x/cb');

      http.listUsersResponse = [
        { id: 'c-new', email: 'new@s.edu', role: 'teacher', district: 'd1' },
      ];

      const res = await service.syncTenant('t1');
      expect(res.usersAdded).toBe(1);
      expect(res.usersUpdated).toBe(0);
      expect(res.usersDisabled).toBe(0);

      const createdUser = Array.from(store.users.values()).find(
        (u: any) => u.email === 'new@s.edu',
      );
      expect(createdUser).toBeDefined();
      expect(createdUser.cleverId).toBe('c-new');
      expect(createdUser.role).toBe('CONTRIBUTOR');
    });

    it('is idempotent — second run produces no adds', async () => {
      const { service, http } = await setup();
      await service.completeOAuth('t1', 'abc', 'https://x/cb');
      http.listUsersResponse = [
        { id: 'c-new', email: 'new@s.edu', role: 'teacher', district: 'd1' },
      ];
      const first = await service.syncTenant('t1');
      const second = await service.syncTenant('t1');
      expect(first.usersAdded).toBe(1);
      expect(second.usersAdded).toBe(0);
      expect(second.usersUpdated).toBe(1);
    });

    it('records errorMessage if Clever HTTP fails', async () => {
      const { service, http, store } = await setup();
      await service.completeOAuth('t1', 'abc', 'https://x/cb');
      jest.spyOn(http, 'listUsers').mockRejectedValueOnce(new Error('boom'));
      await expect(service.syncTenant('t1')).rejects.toThrow('boom');
      const log = Array.from(store.logs.values()).pop();
      expect(log.errorMessage).toContain('boom');
      expect(log.syncCompletedAt).toBeInstanceOf(Date);
    });

    it('refuses to sync a disconnected tenant', async () => {
      const { service } = await setup();
      await expect(service.syncTenant('t1')).rejects.toThrow(/not connected/i);
    });
  });
});
