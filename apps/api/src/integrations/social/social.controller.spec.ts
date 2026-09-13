/**
 * SocialController — the HTTP boundary.
 *
 * THE ONE THAT MATTERS is the tenant scope on `GET posts`: it is the only
 * route a PAIRED SCREEN can call, and a screen is the least trusted principal
 * that ever holds a tenant id. So this file proves, at the controller level:
 *
 *   • the tenantId used for the query comes from `req.user`, NEVER from the
 *     query string — a caller that supplies `?tenantId=` or another tenant's
 *     `?connectionId=` gets nothing;
 *   • the `posts` route carries `JwtAuthGuard` and deliberately NOT
 *     `RbacGuard` (a device token has no role and would be 403'd), while
 *     every other route carries BOTH plus admin `@RequireRoles`. That is a
 *     metadata assertion, because "we removed a guard on purpose" is exactly
 *     the kind of decision that gets silently widened later.
 */
import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

interface Row {
  [k: string]: any;
}

function makePrisma(connections: Row[], posts: Row[]) {
  const matches = (row: Row, where: Row) =>
    Object.entries(where || {}).every(([k, v]) => row[k] === v);
  return {
    client: {
      socialProviderConnection: {
        findFirst: async ({ where }: any) =>
          connections.find((r) => matches(r, where)) || null,
        findMany: async ({ where, include }: any = {}) =>
          connections
            .filter((r) => matches(r, where || {}))
            .map((r) =>
              include?._count
                ? {
                    ...r,
                    _count: {
                      posts: posts.filter((p) => p.connectionId === r.id)
                        .length,
                    },
                  }
                : r,
            ),
      },
      socialPost: {
        findMany: async ({ where, take }: any = {}) => {
          const out = posts.filter((r) => matches(r, where || {}));
          return typeof take === 'number' ? out.slice(0, take) : out;
        },
      },
    },
  };
}

/** Two tenants, each with one connection and one post. */
function fixture() {
  const connections: Row[] = [
    {
      id: 'conn-a',
      tenantId: 'tenant-a',
      providerId: 'instagram',
      accountId: 'ig-a',
      displayName: '@a',
      status: 'ACTIVE',
      createdAt: new Date(),
      encryptedCreds: 'SEALED-A',
      encryptedDataKey: 'KEY-A',
    },
    {
      id: 'conn-b',
      tenantId: 'tenant-b',
      providerId: 'instagram',
      accountId: 'ig-b',
      displayName: '@b',
      status: 'EXPIRED',
      statusReason: 'expired',
      createdAt: new Date(),
      encryptedCreds: 'SEALED-B',
      encryptedDataKey: 'KEY-B',
    },
  ];
  const posts: Row[] = [
    {
      id: 'post-a',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      kind: 'image',
      text: 'tenant A only',
      mediaUrl: 'https://x.example/a.jpg',
      postedAt: new Date(),
    },
    {
      id: 'post-b',
      tenantId: 'tenant-b',
      connectionId: 'conn-b',
      kind: 'image',
      text: 'tenant B only',
      mediaUrl: 'https://x.example/b.jpg',
      postedAt: new Date(),
    },
  ];
  const prisma = makePrisma(connections, posts);
  const ctl = new SocialController(new SocialService(prisma as any));
  return { ctl, connections, posts };
}

/** A paired screen: kind 'device', a tenantId, and NO role. */
const DEVICE_A = {
  user: {
    id: 'screen-1',
    sub: 'screen-1',
    kind: 'device',
    tenantId: 'tenant-a',
  },
};
const DEVICE_B = {
  user: {
    id: 'screen-2',
    sub: 'screen-2',
    kind: 'device',
    tenantId: 'tenant-b',
  },
};

describe('GET posts — tenant scope', () => {
  it('returns only the caller tenant’s posts', async () => {
    const { ctl } = fixture();
    const a = await ctl.listPosts(DEVICE_A, 'conn-a');
    expect(a.posts.map((p) => p.id)).toEqual(['post-a']);
    const b = await ctl.listPosts(DEVICE_B, 'conn-b');
    expect(b.posts.map((p) => p.id)).toEqual(['post-b']);
  });

  it('TENANT A CANNOT READ TENANT B’S CONNECTION — the whole point', async () => {
    const { ctl, posts } = fixture();
    // Tenant B's post really is in the store, so an empty answer is the
    // FILTER working and not an empty database.
    expect(posts.some((p) => p.connectionId === 'conn-b')).toBe(true);

    const stolen = await ctl.listPosts(DEVICE_A, 'conn-b');
    expect(stolen.posts).toEqual([]);
    // ...and it must not leak the OTHER tenant's connection metadata either.
    expect(stolen.connection).toBeNull();
  });

  it('ignores a tenantId supplied by the caller', async () => {
    const { ctl } = fixture();
    // Even if a client crafts the query, the tenant comes from the token.
    const out = await ctl.listPosts(
      { user: { ...DEVICE_A.user }, query: { tenantId: 'tenant-b' } } as any,
      'conn-b',
    );
    expect(out.posts).toEqual([]);
  });

  it('never returns a credential field on the connection summary', async () => {
    const { ctl } = fixture();
    const out = await ctl.listPosts(DEVICE_A, 'conn-a');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('SEALED-A');
    expect(serialized).not.toContain('KEY-A');
    expect(serialized).not.toContain('encryptedCreds');
    expect(out.connection?.displayName).toBe('@a');
    expect(out.connection?.status).toBe('ACTIVE');
  });

  it('surfaces EXPIRED so the widget can say "reconnect" instead of showing an empty frame', async () => {
    const { ctl } = fixture();
    const out = await ctl.listPosts(DEVICE_B, 'conn-b');
    expect(out.connection?.status).toBe('EXPIRED');
  });
});

describe('guards', () => {
  const guardsOn = (method: string) =>
    (Reflect.getMetadata(
      '__guards__',
      (SocialController.prototype as any)[method],
    ) || []) as unknown[];
  const rolesOn = (method: string) =>
    (Reflect.getMetadata(
      'roles',
      (SocialController.prototype as any)[method],
    ) || []) as unknown[];

  it('posts is JwtAuthGuard ONLY — a device token has no role and RbacGuard would 403 it', () => {
    const g = guardsOn('listPosts');
    expect(g).toContain(JwtAuthGuard);
    expect(g).not.toContain(RbacGuard);
    expect(rolesOn('listPosts')).toEqual([]);
  });

  it.each(['listConnections', 'sync', 'disconnect', 'status'])(
    '%s keeps BOTH guards — these are operator routes, never device routes',
    (method) => {
      const g = guardsOn(method);
      expect(g).toContain(JwtAuthGuard);
      expect(g).toContain(RbacGuard);
    },
  );

  it.each(['sync', 'disconnect'])('%s is admin-only', (method) => {
    const roles = rolesOn(method);
    expect(roles).toEqual([
      AppRole.SUPER_ADMIN,
      AppRole.DISTRICT_ADMIN,
      AppRole.SCHOOL_ADMIN,
    ]);
  });
});
