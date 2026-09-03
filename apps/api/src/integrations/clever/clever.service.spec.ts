import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../realtime/redis.service';
import { CleverService, CLEVER_HTTP_CLIENT } from './clever.service';
import { CleverHttpClient, CleverUser } from './clever-http.client';
import { CleverSyncCron } from './clever-sync.cron';
import { CleverOAuthStateStore } from './clever-oauth-state';
import { SSO_PROVISIONED_NO_PASSWORD_HASH } from '../../auth/sso-provisioned-account';

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
  const auditRows: any[] = [];
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
      findMany: jest.fn(async ({ where, select }: any) => {
        const inTenant = Array.from(users.values()).filter((u) => u.tenantId === where.tenantId);
        // CLV-02 reads the pre-update rows with the SAME `where` the update
        // uses, so the mock has to honour the OR clause too — otherwise the
        // audit/revocation test would pass against a mock that can't fail.
        const matched = !where.OR
          ? inTenant
          : inTenant.filter((u) =>
              where.OR.some(
                (cond: any) =>
                  (cond.cleverId && u.cleverId === cond.cleverId) ||
                  (cond.email && u.email === cond.email),
              ),
            );
        // ⚠️ DETACHED COPIES, like real Prisma. Returning the live store objects
        // let the subsequent `updateMany` mutate the rows CLV-02 had already
        // read as "before", so every old→new comparison collapsed to no-change
        // and the audit assertions passed vacuously. (Cost a debug cycle.)
        return matched.map((u) => {
          if (!select) return { ...u };
          const out: any = {};
          for (const k of Object.keys(select)) if (select[k]) out[k] = u[k];
          return out;
        });
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
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'audit' + (auditRows.length + 1), ...data };
        auditRows.push(row);
        return row;
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
    _store: { tenants, users, logs, auditRows },
  };
}

/**
 * A stand-in for the pieces of RedisService the Clever code touches.
 *
 * `publisher: null` is the Redis-DOWN shape, which exercises the in-process
 * fallback in `CleverOAuthStateStore`; `redisUp()` below returns a fake
 * ioredis with a real map behind it so the multi-replica path is covered too.
 */
function makeRedisMock(withPublisher: boolean) {
  const store = new Map<string, string>();
  const publisher = withPublisher
    ? {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
        del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      }
    : null;
  const markUserTokensInvalid = jest.fn(async () => undefined);
  return {
    redis: { publisher, markUserTokensInvalid } as unknown as RedisService,
    revoked: markUserTokensInvalid,
    keys: store,
  };
}

async function setup(
  tenantSeed?: Partial<{ cleverAccessToken: string | null }>,
  opts?: { redisUp?: boolean },
) {
  const { prisma, _store } = makePrismaMock();
  const http = new MockHttp();
  const redisMock = makeRedisMock(opts?.redisUp ?? true);

  const moduleRef = await Test.createTestingModule({
    providers: [
      CleverService,
      CleverSyncCron,
      CleverOAuthStateStore,
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redisMock.redis },
      { provide: CLEVER_HTTP_CLIENT, useValue: http },
    ],
  }).compile();

  const service = moduleRef.get(CleverService);
  const cron = moduleRef.get(CleverSyncCron);
  const stateStore = moduleRef.get(CleverOAuthStateStore);

  _store.tenants.set('t1', {
    id: 't1',
    cleverAccessToken: tenantSeed?.cleverAccessToken ?? null,
    cleverDistrictId: null,
    cleverConnectedAt: null,
  });
  // A second tenant so cross-tenant state-swap can actually be exercised.
  _store.tenants.set('t2', {
    id: 't2',
    cleverAccessToken: null,
    cleverDistrictId: null,
    cleverConnectedAt: null,
  });

  return {
    service,
    cron,
    http,
    stateStore,
    redis: redisMock,
    store: _store,
  };
}

/** Start a connect flow and hand back what the browser would be carrying. */
async function beginConnect(
  service: CleverService,
  tenantId = 't1',
  userId: string | null = 'admin-1',
) {
  const { url, nonce } = await service.beginConnect(tenantId, 'https://app.example.com/cb', userId);
  const state = new URL(url).searchParams.get('state') as string;
  return { url, nonce, state };
}

describe('CleverService', () => {
  describe('OAuth', () => {
    it('builds an authorize URL with tenantId encoded in state', async () => {
      const { service } = await setup();
      const { url } = service.buildAuthorizeUrl('t1', 'https://app.example.com/cb');
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

  /**
   * CLV-01 — the state must be bound to the browser that started the flow.
   *
   * THE ATTACK, spelled out so a future refactor cannot quietly re-open it:
   * an attacker who is DISTRICT_ADMIN of their own tenant starts a connect,
   * takes the `state`, and phishes the authorize URL to an admin of a victim
   * district. The victim authenticates with THEIR Clever credentials; if the
   * callback only re-verified the HMAC, the victim's Clever token would land
   * on the ATTACKER's tenant and a `/sync` would import the victim district's
   * staff roster (names, emails, roles) into it.
   */
  describe('CLV-01 — OAuth state is bound to the initiating session', () => {
    it('happy path: the browser that started the flow completes it', async () => {
      const { service } = await setup();
      const { state, nonce } = await beginConnect(service);
      await expect(service.consumeState(state, nonce)).resolves.toEqual({
        tenantId: 't1',
        userId: 'admin-1',
      });
    });

    it('REFUSES a phished state presented by a different browser', async () => {
      const { service } = await setup();
      // Attacker (tenant t1) mints a state and phishes the URL. The victim's
      // browser holds no nonce cookie for it at all.
      const { state } = await beginConnect(service, 't1', 'attacker');
      await expect(service.consumeState(state, null)).rejects.toThrow(/session mismatch/i);
      await expect(service.consumeState(state, 'some-other-nonce')).rejects.toThrow(
        /session mismatch/i,
      );
    });

    it('REFUSES a replayed state — the nonce is single-use', async () => {
      const { service } = await setup();
      const { state, nonce } = await beginConnect(service);
      await expect(service.consumeState(state, nonce)).resolves.toBeTruthy();
      await expect(service.consumeState(state, nonce)).rejects.toThrow(
        /unknown or already used/i,
      );
    });

    it('REFUSES a state whose envelope tenant was swapped for another tenant', async () => {
      const { service } = await setup();
      // Two live handshakes: t1 (the attacker) and t2 (the victim district).
      const a = await beginConnect(service, 't1', 'attacker');
      const v = await beginConnect(service, 't2', 'victim-admin');
      // Splice the victim's nonce into an envelope claiming the attacker's
      // tenant. Today the HMAC (which covers tenantId|nonce|ts) is what
      // rejects this; the `tenant mismatch` branch in consumeState is the
      // belt-and-braces second gate, so the assertion accepts either. If a
      // future change ever makes the envelope forgeable, this test still
      // fails-safe rather than passing silently.
      const spliced = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(a.state, 'base64url').toString('utf8')),
          nonce: v.nonce,
        }),
      ).toString('base64url');
      await expect(service.consumeState(spliced, v.nonce)).rejects.toThrow(
        /signature mismatch|tenant mismatch/i,
      );
      // And the victim's own handshake still resolves to the VICTIM's tenant,
      // never the attacker's.
      await expect(service.consumeState(v.state, v.nonce)).resolves.toEqual({
        tenantId: 't2',
        userId: 'victim-admin',
      });
    });

    it('REFUSES a signed state that was never persisted (URL minted without beginConnect)', async () => {
      const { service } = await setup();
      const { url, nonce } = service.buildAuthorizeUrl('t1', 'https://app.example.com/cb');
      const state = new URL(url).searchParams.get('state') as string;
      await expect(service.consumeState(state, nonce)).rejects.toThrow(/unknown or already used/i);
    });

    it('works with NO Redis (in-process fallback) and is still single-use there', async () => {
      const { service } = await setup(undefined, { redisUp: false });
      const { state, nonce } = await beginConnect(service);
      await expect(service.consumeState(state, nonce)).resolves.toEqual({
        tenantId: 't1',
        userId: 'admin-1',
      });
      await expect(service.consumeState(state, nonce)).rejects.toThrow(/unknown or already used/i);
    });

    it('fails CLOSED when Redis answers "no record" (a consumed multi-replica state)', async () => {
      const { service, redis } = await setup();
      const { state, nonce } = await beginConnect(service);
      // Simulate another replica having consumed it: the Redis key is gone,
      // but this replica still holds its own in-process copy. It must NOT be
      // accepted — that fall-through is how replay comes back.
      redis.keys.clear();
      await expect(service.consumeState(state, nonce)).rejects.toThrow(/unknown or already used/i);
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

  /**
   * CLV-02 — a Clever roster entry can rewrite ANY local account's role on an
   * email match (`computeDiff` routes email matches into `toUpdate`). That is
   * the most privileged mutation in the product, and it used to happen with no
   * AuditLog row and no session revocation, so a DOWNGRADE did not bite for up
   * to 30 days (the rememberMe JWT ceiling).
   */
  describe('CLV-02 — role rewrites are audited and downgrades revoke sessions', () => {
    async function connected(opts?: { redisUp?: boolean }) {
      const s = await setup(undefined, opts);
      await s.service.completeOAuth('t1', 'abc', 'https://x/cb');
      return s;
    }

    it('writes an AuditLog row naming the acting admin, old role and new role', async () => {
      const { service, http, store } = await connected();
      store.users.set('u-local', {
        id: 'u-local',
        tenantId: 't1',
        email: 'principal@s.edu',
        role: 'SCHOOL_ADMIN',
        cleverId: null,
      });
      http.listUsersResponse = [
        { id: 'c-1', email: 'principal@s.edu', role: 'district_admin', district: 'd1' },
      ];

      await service.syncTenant('t1', 'admin-9');

      const rows = store.auditRows.filter((r: any) => r.action === 'USER_ROLE_CHANGED');
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe('t1');
      expect(rows[0].userId).toBe('admin-9');
      expect(rows[0].targetId).toBe('u-local');
      const details = JSON.parse(rows[0].details);
      expect(details).toMatchObject({
        source: 'clever-sync',
        email: 'principal@s.edu',
        fromRole: 'SCHOOL_ADMIN',
        toRole: 'DISTRICT_ADMIN',
        cleverId: 'c-1',
        cleverRole: 'district_admin',
      });
    });

    it('REVOKES live tokens on a downgrade', async () => {
      const { service, http, store, redis } = await connected();
      store.users.set('u-admin', {
        id: 'u-admin',
        tenantId: 't1',
        email: 'was-admin@s.edu',
        role: 'DISTRICT_ADMIN',
        cleverId: 'c-1',
      });
      http.listUsersResponse = [
        // Clever now says this person is only a teacher.
        { id: 'c-1', email: 'was-admin@s.edu', role: 'teacher', district: 'd1' },
      ];

      await service.syncTenant('t1', 'admin-9');

      expect(store.users.get('u-admin').role).toBe('CONTRIBUTOR');
      expect(redis.revoked).toHaveBeenCalledWith('u-admin');
    });

    it('does NOT revoke on a promotion (a widening needs no forced logout)', async () => {
      const { service, http, store, redis } = await connected();
      store.users.set('u-teacher', {
        id: 'u-teacher',
        tenantId: 't1',
        email: 'teach@s.edu',
        role: 'CONTRIBUTOR',
        cleverId: 'c-1',
      });
      http.listUsersResponse = [
        { id: 'c-1', email: 'teach@s.edu', role: 'school_admin', district: 'd1' },
      ];

      await service.syncTenant('t1', 'admin-9');

      expect(store.users.get('u-teacher').role).toBe('SCHOOL_ADMIN');
      expect(redis.revoked).not.toHaveBeenCalled();
      expect(store.auditRows.filter((r: any) => r.action === 'USER_ROLE_CHANGED')).toHaveLength(1);
    });

    it('writes NOTHING when the role is unchanged (no audit noise, no revocation)', async () => {
      const { service, http, store, redis } = await connected();
      store.users.set('u-same', {
        id: 'u-same',
        tenantId: 't1',
        email: 'same@s.edu',
        role: 'CONTRIBUTOR',
        cleverId: 'c-1',
      });
      http.listUsersResponse = [
        { id: 'c-1', email: 'same@s.edu', role: 'teacher', district: 'd1' },
      ];

      await service.syncTenant('t1', 'admin-9');

      expect(store.auditRows).toHaveLength(0);
      expect(redis.revoked).not.toHaveBeenCalled();
    });

    it('records the nightly cron as an unattributed (system) actor, not a fake user', async () => {
      const { service, http, store } = await connected();
      store.users.set('u-local', {
        id: 'u-local',
        tenantId: 't1',
        email: 'p@s.edu',
        role: 'DISTRICT_ADMIN',
        cleverId: 'c-1',
      });
      http.listUsersResponse = [
        { id: 'c-1', email: 'p@s.edu', role: 'teacher', district: 'd1' },
      ];

      await service.syncTenant('t1'); // cron shape — no actor

      const rows = store.auditRows.filter((r: any) => r.action === 'USER_ROLE_CHANGED');
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBeNull();
      expect(JSON.parse(rows[0].details).source).toBe('clever-sync');
    });

    it('a Redis-down revocation does not fail the sync, but the row is still written', async () => {
      const { service, http, store, redis } = await connected();
      redis.revoked.mockRejectedValueOnce(new Error('redis down'));
      store.users.set('u-admin', {
        id: 'u-admin',
        tenantId: 't1',
        email: 'a@s.edu',
        role: 'DISTRICT_ADMIN',
        cleverId: 'c-1',
      });
      http.listUsersResponse = [{ id: 'c-1', email: 'a@s.edu', role: 'teacher', district: 'd1' }];

      const res = await service.syncTenant('t1', 'admin-9');

      expect(res.usersUpdated).toBe(1);
      expect(store.auditRows).toHaveLength(1);
    });

    it('newly-created Clever accounts carry the shared no-password placeholder', async () => {
      const { service, http, store } = await connected();
      http.listUsersResponse = [
        { id: 'c-new', email: 'new@s.edu', role: 'teacher', district: 'd1' },
      ];
      await service.syncTenant('t1', 'admin-9');
      const created = Array.from(store.users.values()).find((u: any) => u.email === 'new@s.edu');
      expect(created.passwordHash).toBe(SSO_PROVISIONED_NO_PASSWORD_HASH);
    });
  });
});
