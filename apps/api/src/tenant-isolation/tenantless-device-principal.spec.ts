/**
 * SDW-01 (2026-11-23): every handler a screen credential reaches that scopes
 * a query by the principal's tenant requires a tenant scope of its own.
 *
 * DeviceIdentityInterceptor requires a device principal's live screen to have
 * a tenant on every route that does not opt in
 * (`screens/device-principal-routes.spec.ts` covers that route by route). The
 * handlers below also require a non-empty tenant themselves, so each one
 * holds the requirement without relying on the interceptor.
 *
 * The Prisma double evaluates the where clause the way Prisma does
 * (`two-tenant-prisma.ts`, pinned by `two-tenant-prisma.spec.ts`), against a
 * dataset that holds both tenants' rows.
 */
import { HttpStatus } from '@nestjs/common';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
// The branding controller pulls in an ESM-only sanitizer jest cannot parse;
// nothing here sanitizes (same stub as the role matrix).
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (raw: string) => String(raw) },
}));

import { makeTwoTenantPrisma, type Dataset } from './two-tenant-prisma';
import { SocialService } from '../integrations/social/social.service';
import { SocialController } from '../integrations/social/social.controller';
import { AssetsController } from '../assets/assets.controller';
import { GoogleReviewsController } from '../integrations/google-reviews/google-reviews.controller';
import type { GoogleReviewsService } from '../integrations/google-reviews/google-reviews.service';
import { __clearReviewsMemoryCache } from '../integrations/google-reviews/google-reviews-cache';
import type { RedisService } from '../realtime/redis.service';
import { ProxyController } from '../proxy/proxy.controller';
import { verifyRenderCapability } from '../proxy/render-capability';
import { AnalyticsController } from '../analytics/analytics.controller';
import { BrandingController } from '../branding/branding.controller';
import { hasTenantId } from '../auth/require-tenant';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const UNPAIRED_SCREEN = 'screen-unpaired';

/** What the interceptor leaves on a request for a screen with no tenant. */
const unpairedDevice = () => ({
  user: {
    id: UNPAIRED_SCREEN,
    sub: UNPAIRED_SCREEN,
    kind: 'device',
    tenantId: undefined,
    schoolId: undefined,
  },
  headers: {},
});
const pairedDevice = (tenantId: string) => ({
  user: {
    id: 'screen-a',
    sub: 'screen-a',
    kind: 'device',
    tenantId,
    schoolId: tenantId,
  },
  headers: {},
});

function dataset(): Dataset {
  return {
    screen: [
      { id: UNPAIRED_SCREEN, tenantId: null, status: 'PENDING' },
      { id: 'screen-a', tenantId: TENANT_A, status: 'ONLINE' },
    ],
    socialProviderConnection: [
      {
        id: 'conn-a',
        tenantId: TENANT_A,
        providerId: 'instagram',
        accountId: 'ig-a',
        displayName: '@a',
        status: 'ACTIVE',
        createdAt: new Date(),
      },
      {
        id: 'conn-b',
        tenantId: TENANT_B,
        providerId: 'instagram',
        accountId: 'ig-b',
        displayName: '@b',
        status: 'ACTIVE',
        createdAt: new Date(),
      },
    ],
    socialPost: [
      {
        id: 'post-a',
        tenantId: TENANT_A,
        connectionId: 'conn-a',
        kind: 'image',
        text: 'A',
        postedAt: new Date(),
      },
      {
        id: 'post-b',
        tenantId: TENANT_B,
        connectionId: 'conn-b',
        kind: 'image',
        text: 'B',
        postedAt: new Date(),
      },
    ],
    asset: [
      {
        id: 'asset-b',
        tenantId: TENANT_B,
        status: 'PUBLISHED',
        fileUrl: 'https://cdn.test/b.png',
        mimeType: 'image/png',
        fileSize: 10,
      },
    ],
    tenantBranding: [
      { id: 'brand-b', tenantId: TENANT_B, displayName: 'Beta' },
    ],
    touchEvent: [],
  };
}

describe('hasTenantId', () => {
  it('accepts a real id and nothing else', () => {
    expect(hasTenantId('tenant-a')).toBe(true);
    for (const v of [undefined, null, '', '   ', 0, {}, []])
      expect(hasTenantId(v)).toBe(false);
  });
});

describe('social posts require a tenant scope', () => {
  it('listPosts and connectionSummary without a tenant scope answer empty and run no query', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    const svc = new SocialService({ client: prisma.client } as any);
    await expect(
      svc.listPosts(undefined as unknown as string, {}),
    ).resolves.toEqual([]);
    await expect(
      svc.listPosts('', { connectionId: 'conn-b' }),
    ).resolves.toEqual([]);
    await expect(
      svc.connectionSummary(undefined as unknown as string, 'conn-b'),
    ).resolves.toBeNull();
    expect(prisma.touched).toEqual([]);
  });

  it('GET posts without a tenant scope answers no posts and no connection', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    const ctl = new SocialController(
      new SocialService({ client: prisma.client } as any),
    );
    await expect(ctl.listPosts(unpairedDevice(), undefined)).resolves.toEqual({
      posts: [],
      connection: null,
    });
    await expect(ctl.listPosts(unpairedDevice(), 'conn-b')).resolves.toEqual({
      posts: [],
      connection: null,
    });
    expect(prisma.touched).toEqual([]);
  });

  it('a paired screen reads its own tenant’s posts', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    const ctl = new SocialController(
      new SocialService({ client: prisma.client } as any),
    );
    const out = await ctl.listPosts(pairedDevice(TENANT_A), 'conn-a');
    expect(out.posts.map((p) => p.id)).toEqual(['post-a']);
    expect(out.connection?.displayName).toBe('@a');
    expect(prisma.foreignTouches(TENANT_A)).toEqual([]);
  });
});

describe('asset playback — a missing scope is a 404', () => {
  const controller = (prisma: ReturnType<typeof makeTwoTenantPrisma>) =>
    new AssetsController(
      { client: prisma.client } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { kickOff: () => {} } as any,
    );

  it('asset playback without a tenant scope answers 404', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    await expect(
      controller(prisma).getForPlayback(unpairedDevice(), 'asset-b'),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(prisma.touched.filter((t) => t.model === 'asset')).toEqual([]);
  });

  it('a paired screen resolves its own tenant’s asset, and only that', async () => {
    const data = dataset();
    data.asset.push({
      id: 'asset-a',
      tenantId: TENANT_A,
      status: 'PUBLISHED',
      fileUrl: 'https://cdn.test/a.png',
      mimeType: 'image/png',
      fileSize: 10,
    });
    const prisma = makeTwoTenantPrisma(data);
    await expect(
      controller(prisma).getForPlayback(pairedDevice(TENANT_A), 'asset-a'),
    ).resolves.toMatchObject({ id: 'asset-a' });
    await expect(
      controller(prisma).getForPlayback(pairedDevice(TENANT_A), 'asset-b'),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(prisma.foreignTouches(TENANT_A)).toEqual([]);
  });
});

describe('Google reviews require a tenant scope (the per-tenant cap)', () => {
  beforeEach(() => __clearReviewsMemoryCache());
  const service = () => {
    const mock = {
      enabled: jest.fn().mockReturnValue(true),
      searchPlaces: jest.fn().mockResolvedValue([]),
      getReviews: jest.fn().mockResolvedValue({
        payload: {
          place: null,
          reviews: [],
          fetchedAt: '2026-11-23T00:00:00.000Z',
        },
        cached: false,
      }),
    };
    return { svc: mock as unknown as GoogleReviewsService, mock };
  };
  const noRedis = { publisher: null } as unknown as RedisService;

  it('a reviews fetch without a tenant scope answers 403 before Google is called', async () => {
    const { svc, mock } = service();
    await expect(
      new GoogleReviewsController(svc, noRedis).getReviews(
        unpairedDevice(),
        'place-1',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(mock.getReviews).not.toHaveBeenCalled();
  });

  it('a place search without a tenant scope answers 403 before Google is called', async () => {
    const { svc, mock } = service();
    const tenantless = { user: { id: 'u1', role: 'SCHOOL_ADMIN' } };
    await expect(
      new GoogleReviewsController(svc, noRedis).searchPlaces(tenantless, {
        query: 'springfield',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(mock.searchPlaces).not.toHaveBeenCalled();
  });

  it('a paired screen gets reviews', async () => {
    const { svc, mock } = service();
    const out = await new GoogleReviewsController(svc, noRedis).getReviews(
      pairedDevice(TENANT_A),
      'place-1',
    );
    expect(out.enabled).toBe(true);
    expect(mock.getReviews).toHaveBeenCalledTimes(1);
  });
});

describe('render capability requires a tenant scope', () => {
  // A public IP literal: `assertPublicUrl` skips DNS for it, so this runs offline.
  const URL = 'https://93.184.216.34/board';
  const mint = (req: any) => {
    const controller = new ProxyController(undefined as any);
    (controller as any).logger = {
      warn: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    return controller.mintRenderCapability({ url: URL }, req);
  };

  it('a capability request without a tenant scope answers 403', async () => {
    await expect(mint(unpairedDevice())).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('a paired screen gets one, bound to its tenant', async () => {
    const out: any = await mint(pairedDevice(TENANT_A));
    const verdict = verifyRenderCapability(out.capability, URL);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.claims.t).toBe(TENANT_A);
  });
});

describe('touch events require a tenant scope', () => {
  const event = () => ({ templateId: 'tpl-1', clientTs: Date.now() });

  it('a batch without a tenant scope answers 403 and writes nothing', async () => {
    const createMany = jest.fn();
    const ctl = new AnalyticsController({
      client: { touchEvent: { createMany } },
    } as any);
    await expect(
      ctl.ingest(unpairedDevice(), { events: [event() as any] }),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('a paired screen’s batch lands under its tenant', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const ctl = new AnalyticsController({
      client: { touchEvent: { createMany } },
    } as any);
    await expect(
      ctl.ingest(pairedDevice(TENANT_A), { events: [event() as any] }),
    ).resolves.toEqual({ accepted: 1, rejected: 0 });
    expect(createMany.mock.calls[0][0].data[0].tenantId).toBe(TENANT_A);
  });
});

describe('branding/me requires a tenant scope', () => {
  const controller = (prisma: ReturnType<typeof makeTwoTenantPrisma>) =>
    new BrandingController(
      { client: prisma.client } as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('without a tenant scope it answers null and runs no query', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    await expect(
      controller(prisma).getMine(unpairedDevice()),
    ).resolves.toBeNull();
    expect(prisma.touched).toEqual([]);
  });
});
