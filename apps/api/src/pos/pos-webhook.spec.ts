/**
 * Custom-webhook POS receiver tests (P0-5, 2026-05-28).
 * ─────────────────────────────────────────────────────
 *
 * The `custom-webhook` provider is the bring-your-own-POS escape hatch:
 * any system that can POST JSON pushes its catalog to
 * /api/v1/pos/webhook/custom-webhook with a shared X-Webhook-Secret.
 *
 * These tests prove the two load-bearing behaviours from the bug report:
 *   1. A correctly-secreted payload upserts PosMenuItem rows for the
 *      connection's tenant (tenant is resolved from the secret, never
 *      from the client).
 *   2. A bad secret → no connection match → the controller 401s and
 *      nothing is upserted.
 *
 * We use the REAL creds-cipher (it has a dev fallback when
 * DEVICE_SECRET_KEY is unset), so the seal → store → decrypt →
 * constant-time-compare path is exercised end-to-end, not mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PosService } from './pos.service';
import { MenuService } from './menu.service';
import { PosOAuthController } from './pos-oauth.controller';
import { PrismaService } from '../prisma/prisma.service';
import { sealCredentials } from '../streaming/creds-cipher';

const TENANT = 'tenant-A';
const SECRET = 'super-secret-byo-pos-key-1234567890';

function makeConnRow(secret: string) {
  const sealed = sealCredentials({ webhookSecret: secret });
  return {
    id: 'conn-1',
    tenantId: TENANT,
    providerId: 'custom-webhook',
    encryptedCreds: sealed.encryptedCreds,
    encryptedDataKey: sealed.encryptedDataKey,
  };
}

describe('Custom POS webhook', () => {
  let svc: PosService;
  let controller: PosOAuthController;
  let posProviderConnection: any;
  let posMenuItem: any;

  beforeEach(async () => {
    posProviderConnection = {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };
    posMenuItem = {
      upsert: jest.fn().mockResolvedValue({}),
    };

    // Build the service through DI (only needs PrismaService), then hand
    // it to the controller directly. We instantiate the controller with
    // `new` rather than through a TestingModule so its @UseGuards on the
    // `authorize` method don't drag JwtService/Reflector into the DI graph
    // — guards aren't evaluated when a controller method is called directly.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosService,
        MenuService,
        {
          provide: PrismaService,
          useValue: { client: { posProviderConnection, posMenuItem } },
        },
      ],
    }).compile();

    const prisma = module.get(PrismaService);
    svc = module.get(PosService);
    const menu = module.get(MenuService);
    controller = new PosOAuthController(prisma, svc, menu);
  });

  describe('findCustomWebhookConnectionBySecret', () => {
    it('matches the connection whose stored secret equals the supplied one', async () => {
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      const conn = await svc.findCustomWebhookConnectionBySecret(SECRET);
      expect(conn).not.toBeNull();
      expect(conn.id).toBe('conn-1');
      expect(conn.tenantId).toBe(TENANT);
    });

    it('returns null for a wrong secret', async () => {
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      const conn = await svc.findCustomWebhookConnectionBySecret('not-the-secret');
      expect(conn).toBeNull();
    });

    it('returns null for an empty / missing secret', async () => {
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      expect(await svc.findCustomWebhookConnectionBySecret('')).toBeNull();
      expect(await svc.findCustomWebhookConnectionBySecret(undefined)).toBeNull();
    });

    it('does not match a secret that is a prefix of the stored secret', async () => {
      // length-guard before timingSafeEqual: a shorter prefix must NOT match.
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      const conn = await svc.findCustomWebhookConnectionBySecret(SECRET.slice(0, 10));
      expect(conn).toBeNull();
    });
  });

  describe('ingestCustomWebhookCatalog', () => {
    it('upserts a PosMenuItem keyed on connectionId+externalId for the connection tenant', async () => {
      const conn = makeConnRow(SECRET);
      const res = await svc.ingestCustomWebhookCatalog(conn, {
        items: [
          {
            id: 'burger-01',
            name: 'Classic Burger',
            priceCents: 799,
            description: '1/4 lb',
            category: 'Burgers',
          },
        ],
      });

      expect(res).toEqual({ upserted: 1, skipped: 0 });
      expect(posMenuItem.upsert).toHaveBeenCalledTimes(1);
      expect(posMenuItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connectionId_externalId: { connectionId: 'conn-1', externalId: 'burger-01' } },
          create: expect.objectContaining({
            tenantId: TENANT,
            connectionId: 'conn-1',
            externalId: 'burger-01',
            name: 'Classic Burger',
            priceCents: 799,
            category: 'Burgers',
            available: true,
          }),
        }),
      );
      // Connection flips to ACTIVE with the count.
      expect(posProviderConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: expect.objectContaining({ status: 'ACTIVE', lastSyncItemCount: 1 }),
        }),
      );
    });

    it('accepts a major-unit `price` and converts to cents', async () => {
      const conn = makeConnRow(SECRET);
      await svc.ingestCustomWebhookCatalog(conn, {
        items: [{ id: 'x', name: 'Latte', price: 4.5 }],
      });
      expect(posMenuItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ priceCents: 450 }) }),
      );
    });

    it('skips items missing id or name, counts them, and never trusts a client tenantId', async () => {
      const conn = makeConnRow(SECRET);
      const res = await svc.ingestCustomWebhookCatalog(conn, {
        items: [
          { name: 'No id' },
          { id: 'no-name' },
          { id: 'ok', name: 'Good', priceCents: 100, tenantId: 'tenant-EVIL' },
        ],
      });
      expect(res).toEqual({ upserted: 1, skipped: 2 });
      // The one good item lands under the CONNECTION's tenant, not the
      // attacker-supplied tenantId in the payload.
      expect(posMenuItem.upsert).toHaveBeenCalledTimes(1);
      expect(posMenuItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ tenantId: TENANT }) }),
      );
    });

    it('rejects a body without an items array', async () => {
      const conn = makeConnRow(SECRET);
      await expect(svc.ingestCustomWebhookCatalog(conn, {} as any)).rejects.toThrow();
      expect(posMenuItem.upsert).not.toHaveBeenCalled();
    });
  });

  describe('controller POST /pos/webhook/:providerId', () => {
    const reqWith = (body: unknown) => ({ body }) as any;

    it('upserts on a correct secret and returns the count', async () => {
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      const out = await controller.customWebhook(
        'custom-webhook',
        reqWith({ items: [{ id: 'a', name: 'Item A', priceCents: 100 }] }),
        SECRET,
      );
      expect(out).toEqual({ ok: true, upserted: 1, skipped: 0 });
      expect(posMenuItem.upsert).toHaveBeenCalledTimes(1);
    });

    it('401s on a bad secret and upserts nothing', async () => {
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      await expect(
        controller.customWebhook(
          'custom-webhook',
          reqWith({ items: [{ id: 'a', name: 'Item A' }] }),
          'wrong-secret',
        ),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
      expect(posMenuItem.upsert).not.toHaveBeenCalled();
    });

    it('401s when the secret header is missing', async () => {
      await expect(
        controller.customWebhook('custom-webhook', reqWith({ items: [] }), undefined),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
      expect(posProviderConnection.findMany).not.toHaveBeenCalled();
    });

    it('404s for any providerId other than custom-webhook (never shadows a real receiver)', async () => {
      await expect(
        controller.customWebhook('square', reqWith({ items: [] }), SECRET),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(posProviderConnection.findMany).not.toHaveBeenCalled();
    });

    it('400s on a non-object body even with a valid secret', async () => {
      posProviderConnection.findMany.mockResolvedValue([makeConnRow(SECRET)]);
      await expect(
        controller.customWebhook('custom-webhook', reqWith('not json'), SECRET),
      ).rejects.toBeInstanceOf(HttpException);
      expect(posMenuItem.upsert).not.toHaveBeenCalled();
    });
  });
});
