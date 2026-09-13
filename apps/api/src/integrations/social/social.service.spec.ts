/**
 * SocialService — sync idempotency, refresh threshold, tenant scoping,
 * degrade-when-unconfigured, and "no token ever leaves".
 *
 * The Prisma stand-in below is a TINY IN-MEMORY DATABASE rather than a bag of
 * jest.fn()s, because the two properties that matter here — "the same post
 * twice is one row" and "tenant A's query cannot return tenant B's row" — are
 * about what the STORE ends up holding. A mock that just records calls would
 * pass while the real upsert wrote duplicates.
 */
import {
  SocialService,
  REFRESH_WINDOW_MS,
  SYNC_POST_LIMIT,
} from './social.service';
import { openCredentials } from '../../streaming/creds-cipher';

// ─── in-memory Prisma stand-in ────────────────────────────────────────

interface Row {
  [k: string]: any;
}

function makePrisma() {
  const connections: Row[] = [];
  const posts: Row[] = [];
  const auditLogs: Row[] = [];
  let seq = 0;
  const nextId = () => `id-${++seq}`;

  /** Do the row's fields satisfy every key in `where`? Exactly the semantics
   *  we rely on: a `where` with BOTH tenantId and connectionId is an AND. */
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && Array.isArray(v.in)) {
        return v.in.includes(row[k]);
      }
      return row[k] === v;
    });

  const socialProviderConnection = {
    findMany: async ({ where, include }: any = {}) =>
      connections
        .filter((r) => matches(r, where || {}))
        .map((r) =>
          include?._count
            ? {
                ...r,
                _count: {
                  posts: posts.filter((p) => p.connectionId === r.id).length,
                },
              }
            : r,
        ),
    findFirst: async ({ where }: any) =>
      connections.find((r) => matches(r, where)) || null,
    create: async ({ data }: any) => {
      const row = { id: nextId(), createdAt: new Date(), ...data };
      connections.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = connections.find((r) => matches(r, where));
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return row;
    },
  };

  const socialPost = {
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let out = posts.filter((r) => matches(r, where || {}));
      if (orderBy?.postedAt === 'desc') {
        out = out
          .slice()
          .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
      }
      return typeof take === 'number' ? out.slice(0, take) : out;
    },
    upsert: async ({ where, update, create }: any) => {
      const key = where.connectionId_providerPostId;
      const existing = posts.find(
        (p) =>
          p.connectionId === key.connectionId &&
          p.providerPostId === key.providerPostId,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: nextId(), ...create };
      posts.push(row);
      return row;
    },
  };

  const auditLog = {
    create: async ({ data }: any) => {
      const row = { id: nextId(), ...data };
      auditLogs.push(row);
      return row;
    },
  };

  const client: any = {
    socialProviderConnection,
    socialPost,
    auditLog,
    // The transaction helper just hands the same accessors back — enough for
    // the disconnect path, which is the only transactional write here.
    $transaction: async (fn: any) =>
      fn({ socialProviderConnection, socialPost, auditLog }),
  };
  return { client, _state: { connections, posts, auditLogs } };
}

function svcWith(prisma: any): SocialService {
  return new SocialService(prisma);
}

/** Deterministic env for the whole file. */
const OLD_ENV = { ...process.env };
beforeEach(() => {
  process.env.INSTAGRAM_APP_ID = 'ig-id';
  process.env.INSTAGRAM_APP_SECRET = 'ig-secret';
  process.env.META_APP_ID = 'fb-id';
  process.env.META_APP_SECRET = 'fb-secret';
  // creds-cipher needs a 64-hex master key; the dev fallback pads, but be
  // explicit so a sealed blob is stable across the file.
  process.env.DEVICE_SECRET_KEY = 'a'.repeat(64);
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

function reply(status: number, body: unknown) {
  return { status, text: async () => JSON.stringify(body) };
}

async function seedInstagramConnection(
  svc: SocialService,
  prisma: any,
  overrides: Row = {},
): Promise<Row> {
  const conn = await svc.upsertConnection({
    tenantId: 'tenant-a',
    userId: 'user-1',
    providerId: 'instagram',
    accountId: 'ig-178414',
    displayName: '@sunnyside',
    accessToken: 'live-token',
    expiresAt: new Date(Date.now() + 60 * 86_400_000),
    scope: ['instagram_business_basic'],
  });
  Object.assign(conn, overrides);
  void prisma;
  return conn;
}

// ─── degrade when unconfigured ────────────────────────────────────────

describe('dormant until the Meta keys exist', () => {
  it('status() reports every missing var and never throws', () => {
    delete process.env.INSTAGRAM_APP_ID;
    delete process.env.INSTAGRAM_APP_SECRET;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    const svc = svcWith(makePrisma());
    const s = svc.status();
    expect(s.enabled).toBe(false);
    expect(s.missing.sort()).toEqual(
      [
        'INSTAGRAM_APP_ID',
        'INSTAGRAM_APP_SECRET',
        'META_APP_ID',
        'META_APP_SECRET',
      ].sort(),
    );
    expect(s.providers.find((p) => p.id === 'instagram')!.enabled).toBe(false);
  });

  it('status() reports one provider enabled when only its keys are set', () => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    const s = svcWith(makePrisma()).status();
    expect(s.enabled).toBe(true);
    expect(s.providers.find((p) => p.id === 'instagram')!.enabled).toBe(true);
    expect(s.providers.find((p) => p.id === 'facebook')!.enabled).toBe(false);
    expect(s.providers.find((p) => p.id === 'facebook')!.missing).toEqual([
      'META_APP_ID',
      'META_APP_SECRET',
    ]);
  });

  it('a sync on an unconfigured deploy marks the row ERROR instead of throwing', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    delete process.env.INSTAGRAM_APP_ID;
    delete process.env.INSTAGRAM_APP_SECRET;
    const out = await svc.syncConnection(conn, null);
    expect(out.status).toBe('error');
    const row = prisma._state.connections[0];
    expect(row.status).toBe('ERROR');
    expect(row.statusReason).toContain('INSTAGRAM_APP_ID');
  });
});

// ─── credentials ──────────────────────────────────────────────────────

describe('credential handling', () => {
  it('seals the token at rest and never returns it from listConnections', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    await seedInstagramConnection(svc, prisma);

    const stored = prisma._state.connections[0];
    // At rest it is a sealed envelope, not the token.
    expect(stored.encryptedCreds).toBeTruthy();
    expect(JSON.stringify(stored.encryptedCreds)).not.toContain('live-token');
    // ...and it really is the token, sealed (so the round trip works).
    expect(
      openCredentials({
        encryptedCreds: stored.encryptedCreds,
        encryptedDataKey: stored.encryptedDataKey,
      }),
    ).toEqual({ accessToken: 'live-token' });

    const dto = await svc.listConnections('tenant-a');
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('live-token');
    expect(serialized).not.toContain('encryptedCreds');
    expect(serialized).not.toContain('encryptedDataKey');
    expect(dto[0].displayName).toBe('@sunnyside');
  });

  it('writes an AuditLog row on connect and on disconnect', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    await svc.disconnect('tenant-a', conn.id, 'user-1');
    const actions = prisma._state.auditLogs.map((a: Row) => a.action);
    expect(actions).toContain('SOCIAL_CONNECTION_CREATED');
    expect(actions).toContain('SOCIAL_CONNECTION_REVOKED');
    for (const a of prisma._state.auditLogs) {
      expect(a.tenantId).toBe('tenant-a');
      expect(a.targetType).toBe('SocialProviderConnection');
      expect(a.details).not.toContain('live-token');
    }
  });

  it('disconnect destroys the credential, keeps the posts, and stops future syncs', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    svc.fetchImpl = async () =>
      reply(200, {
        data: [
          {
            id: 'm1',
            media_type: 'IMAGE',
            media_url: 'https://x.example/1.jpg',
          },
        ],
      });
    await svc.syncConnection(conn, null);
    expect(prisma._state.posts).toHaveLength(1);

    await svc.disconnect('tenant-a', conn.id, 'user-1');
    const row = prisma._state.connections[0];
    expect(row.status).toBe('REVOKED');
    // The sealed blob no longer decrypts to a token.
    expect(
      openCredentials({
        encryptedCreds: row.encryptedCreds,
        encryptedDataKey: row.encryptedDataKey,
      }),
    ).toEqual({});
    // Posts survive so a mid-rotation screen does not go blank.
    expect(prisma._state.posts).toHaveLength(1);
    // And a REVOKED connection is never synced again.
    const after = await svc.syncConnection(row, null);
    expect(after.status).toBe('error');
    expect(after.message).toMatch(/disconnected/i);
  });
});

// ─── sync ─────────────────────────────────────────────────────────────

describe('sync', () => {
  it('is idempotent — the same post fetched twice is ONE row', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    const media = {
      data: [
        {
          id: 'm1',
          media_type: 'IMAGE',
          media_url: 'https://x.example/1.jpg',
          caption: 'first',
        },
        { id: 'm2', media_type: 'IMAGE', media_url: 'https://x.example/2.jpg' },
      ],
    };
    svc.fetchImpl = async () => reply(200, media);

    const first = await svc.syncConnection(conn, null);
    expect(first.itemCount).toBe(2);
    expect(prisma._state.posts).toHaveLength(2);

    // Second hour: the same two posts, one with an edited caption.
    media.data[0].caption = 'first (edited)';
    const second = await svc.syncConnection(conn, null);
    expect(second.itemCount).toBe(2);
    expect(prisma._state.posts).toHaveLength(2); // NOT 4
    expect(
      prisma._state.posts.find((p: Row) => p.providerPostId === 'm1')!.text,
    ).toBe('first (edited)');
  });

  it('stamps lastSyncedAt — the only freshness signal any UI may show', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    svc.fetchImpl = async () => reply(200, { data: [] });
    expect(prisma._state.connections[0].lastSyncedAt).toBeUndefined();
    await svc.syncConnection(conn, null);
    expect(prisma._state.connections[0].lastSyncedAt).toBeInstanceOf(Date);
    expect(prisma._state.connections[0].lastSyncItemCount).toBe(0);
  });

  it('asks the provider for SYNC_POST_LIMIT posts', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    let seen = '';
    svc.fetchImpl = async (url: string) => {
      seen = url;
      return reply(200, { data: [] });
    };
    await svc.syncConnection(conn, null);
    expect(new URL(seen).searchParams.get('limit')).toBe(
      String(SYNC_POST_LIMIT),
    );
  });

  it('marks EXPIRED (reconnect) on an OAuth failure, not ERROR (retry)', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    svc.fetchImpl = async () =>
      reply(400, {
        error: {
          message: 'Session expired. access_token=EAAsecret',
          type: 'OAuthException',
          code: 190,
        },
      });
    const out = await svc.syncConnection(conn, null);
    expect(out.status).toBe('error');
    const row = prisma._state.connections[0];
    expect(row.status).toBe('EXPIRED');
    expect(row.statusReason).toBe(
      'Instagram access expired — reconnect in the Apps tab.',
    );
    // The operator-facing reason must never carry the provider's body.
    expect(row.statusReason).not.toContain('EAAsecret');
  });

  it('marks ERROR (retryable) on a provider outage and keeps the cached posts', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    svc.fetchImpl = async () =>
      reply(200, {
        data: [
          {
            id: 'm1',
            media_type: 'IMAGE',
            media_url: 'https://x.example/1.jpg',
          },
        ],
      });
    await svc.syncConnection(conn, null);
    expect(prisma._state.posts).toHaveLength(1);

    svc.fetchImpl = async () =>
      reply(503, { error: { type: 'Internal', code: 2 } });
    const out = await svc.syncConnection(conn, null);
    expect(out.status).toBe('error');
    expect(prisma._state.connections[0].status).toBe('ERROR');
    // A failed refresh must never wipe the wall.
    expect(prisma._state.posts).toHaveLength(1);
  });
});

// ─── token refresh threshold ──────────────────────────────────────────

describe('token refresh threshold', () => {
  it('does not refresh a token with more than the window left', () => {
    const svc = svcWith(makePrisma());
    expect(
      svc.needsRefresh(new Date(Date.now() + REFRESH_WINDOW_MS + 60_000)),
    ).toBe(false);
  });

  it('refreshes a token with less than the window left', () => {
    const svc = svcWith(makePrisma());
    expect(
      svc.needsRefresh(new Date(Date.now() + REFRESH_WINDOW_MS - 60_000)),
    ).toBe(true);
  });

  it('never refreshes a non-expiring credential (a Facebook Page token)', () => {
    const svc = svcWith(makePrisma());
    expect(svc.needsRefresh(null)).toBe(false);
    expect(svc.needsRefresh(undefined)).toBe(false);
  });

  it('rolls the Instagram token forward and re-seals it when inside the window', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    // Put it 5 days from expiry — inside the 10-day window.
    conn.expiresAt = new Date(Date.now() + 5 * 86_400_000);
    prisma._state.connections[0].expiresAt = conn.expiresAt;

    const urls: string[] = [];
    svc.fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes('refresh_access_token')) {
        return reply(200, {
          access_token: 'rolled-token',
          expires_in: 5184000,
        });
      }
      return reply(200, { data: [] });
    };
    await svc.syncConnection(conn, 'user-1');

    expect(urls.some((u) => u.includes('refresh_access_token'))).toBe(true);
    const row = prisma._state.connections[0];
    expect(
      openCredentials({
        encryptedCreds: row.encryptedCreds,
        encryptedDataKey: row.encryptedDataKey,
      }),
    ).toEqual({ accessToken: 'rolled-token' });
    expect(prisma._state.auditLogs.map((a: Row) => a.action)).toContain(
      'SOCIAL_TOKEN_REFRESHED',
    );
  });

  it('does not call the refresh endpoint when the token is fresh', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    const urls: string[] = [];
    svc.fetchImpl = async (url: string) => {
      urls.push(url);
      return reply(200, { data: [] });
    };
    await svc.syncConnection(conn, null);
    expect(urls.some((u) => u.includes('refresh_access_token'))).toBe(false);
  });

  it('keeps syncing on a still-valid token when the refresh call itself fails', async () => {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const conn = await seedInstagramConnection(svc, prisma);
    conn.expiresAt = new Date(Date.now() + 5 * 86_400_000);
    svc.fetchImpl = async (url: string) => {
      if (url.includes('refresh_access_token'))
        return reply(500, { error: { code: 1 } });
      return reply(200, {
        data: [
          {
            id: 'm9',
            media_type: 'IMAGE',
            media_url: 'https://x.example/9.jpg',
          },
        ],
      });
    };
    const out = await svc.syncConnection(conn, null);
    expect(out.status).toBe('ok');
    expect(prisma._state.posts).toHaveLength(1);
  });
});

// ─── tenant scoping ───────────────────────────────────────────────────

describe('tenant scoping', () => {
  async function twoTenants() {
    const prisma = makePrisma();
    const svc = svcWith(prisma);
    const a = await svc.upsertConnection({
      tenantId: 'tenant-a',
      userId: 'u-a',
      providerId: 'instagram',
      accountId: 'ig-a',
      displayName: '@a',
      accessToken: 'tok-a',
      expiresAt: null,
      scope: [],
    });
    const b = await svc.upsertConnection({
      tenantId: 'tenant-b',
      userId: 'u-b',
      providerId: 'instagram',
      accountId: 'ig-b',
      displayName: '@b',
      accessToken: 'tok-b',
      expiresAt: null,
      scope: [],
    });
    svc.fetchImpl = async (url: string) =>
      reply(200, {
        data: [
          {
            id: url.includes('a') ? 'post-a' : 'post-b',
            media_type: 'IMAGE',
            media_url: 'https://x.example/p.jpg',
          },
        ],
      });
    // Give each tenant one post, written under its OWN tenantId.
    await svc.syncConnection(a, null);
    await svc.syncConnection(b, null);
    return { prisma, svc, a, b };
  }

  it('listConnections only ever returns the caller tenant’s rows', async () => {
    const { svc } = await twoTenants();
    expect(
      (await svc.listConnections('tenant-a')).map((c) => c.displayName),
    ).toEqual(['@a']);
    expect(
      (await svc.listConnections('tenant-b')).map((c) => c.displayName),
    ).toEqual(['@b']);
  });

  it('listPosts refuses another tenant’s connectionId instead of honouring it', async () => {
    const { svc, b, prisma } = await twoTenants();
    // Both tenants really do have a cached post — so an empty result below is
    // the FILTER working, not an empty database.
    expect(prisma._state.posts).toHaveLength(2);
    const leaked = await svc.listPosts('tenant-a', { connectionId: b.id });
    expect(leaked).toEqual([]);
    // ...while the same id from its OWN tenant works.
    expect(
      await svc.listPosts('tenant-b', { connectionId: b.id }),
    ).toHaveLength(1);
  });

  it('an unfiltered listPosts still only returns the caller tenant’s posts', async () => {
    const { svc } = await twoTenants();
    const rows = await svc.listPosts('tenant-a', {});
    expect(rows).toHaveLength(1);
    expect(rows[0].connectionId).not.toBe('');
  });

  it('triggerSync and disconnect 404 on another tenant’s connection', async () => {
    const { svc, b } = await twoTenants();
    await expect(svc.triggerSync('tenant-a', b.id, 'u-a')).rejects.toThrow(
      /not found/i,
    );
    await expect(svc.disconnect('tenant-a', b.id, 'u-a')).rejects.toThrow(
      /not found/i,
    );
  });

  it('clamps the post limit so one caller cannot ask for the whole table', async () => {
    const { svc } = await twoTenants();
    // 10_000 must not become take: 10_000.
    const rows = await svc.listPosts('tenant-a', { limit: 10_000 });
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});
