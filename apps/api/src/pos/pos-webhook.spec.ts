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
import { createHmac } from 'node:crypto';
import { PosService } from './pos.service';
import { MenuService } from './menu.service';
import { PosOAuthController } from './pos-oauth.controller';
import { PrismaService } from '../prisma/prisma.service';
import { sealCredentials } from '../streaming/creds-cipher';
import { verifySquareSignature } from './providers/square';

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

/**
 * Square webhook receiver tests (2026-07-03 fix).
 * ─────────────────────────────────────────────────
 *
 * BUG: Square signs the HMAC over `notificationUrl + <exact bytes POSTed>`.
 * main.ts previously mounted the Stripe-style raw-body express.raw() parser
 * ONLY on /api/v1/billing/webhook — the Square route fell through to the
 * global express.json() parser, so req.rawBody was undefined and the
 * controller's old fallback re-serialized the ALREADY-PARSED body via
 * `JSON.stringify(req.body)`. That round-trip is byte-identical to what
 * Square sent ONLY for trivial ASCII payloads; for anything with non-ASCII
 * text (e.g. an item name with an accented character or emoji), JSON.stringify
 * escapes/encodes differently than Square's own serializer, so the computed
 * HMAC differs and timingSafeEqual fails → legitimate events 401.
 *
 * FIX: main.ts now mounts the same raw-body capture on
 * '/api/v1/pos/webhook/square' specifically (never on the sibling
 * '/api/v1/pos/webhook/:providerId' custom-webhook route, which still reads
 * plain parsed JSON), and the controller verifies + parses from that Buffer
 * — never from a re-serialized JSON.stringify.
 */
describe('Square POS webhook — raw-body HMAC verification', () => {
  const SIGNING_KEY = 'square-signing-key-for-tests';
  const NOTIFICATION_URL = 'https://api.example.com/api/v1/pos/webhook/square';
  const MERCHANT_ID = 'MERCHANT-123';

  // A payload whose item name contains non-ASCII characters — the exact
  // class of payload that breaks the JSON.stringify(req.body) round-trip.
  // Different servers/serializers may render the same JS object with
  // different escaping for non-ASCII code points, and Square's raw bytes on
  // the wire are authoritative — only they matter for the signature.
  const RAW_BODY_STRING = JSON.stringify({
    merchant_id: MERCHANT_ID,
    event_id: 'evt-non-ascii-1',
    type: 'catalog.version.updated',
    data: { object: { item_name: 'Café Ñoño 🍔 — 特価品' } },
  });

  function signRawBody(raw: string): string {
    return createHmac('sha256', SIGNING_KEY).update(NOTIFICATION_URL + raw).digest('base64');
  }

  let svc: { claimWebhookEvent: jest.Mock; findConnectionByMerchantId: jest.Mock; syncConnection: jest.Mock };
  let menu: { applySquareInventoryCounts: jest.Mock };
  let controller: PosOAuthController;
  let prevSigningKey: string | undefined;

  beforeEach(() => {
    prevSigningKey = process.env.SQUARE_WEBHOOK_SIG_KEY;
    process.env.SQUARE_WEBHOOK_SIG_KEY = SIGNING_KEY;
    delete process.env.PUBLIC_API_BASE_URL;

    svc = {
      claimWebhookEvent: jest.fn().mockResolvedValue(true),
      findConnectionByMerchantId: jest.fn().mockResolvedValue({ id: 'conn-sq-1', tenantId: 'tenant-sq' }),
      syncConnection: jest.fn().mockResolvedValue(undefined),
    };
    menu = { applySquareInventoryCounts: jest.fn().mockResolvedValue(undefined) };

    controller = new PosOAuthController(
      {} as any, // PrismaService — unused by the webhook path
      svc as any,
      menu as any,
      undefined as any, // RedisService — unused by the webhook path
    );
  });

  afterEach(() => {
    if (prevSigningKey === undefined) delete process.env.SQUARE_WEBHOOK_SIG_KEY;
    else process.env.SQUARE_WEBHOOK_SIG_KEY = prevSigningKey;
    delete process.env.PUBLIC_API_BASE_URL;
  });

  function reqWith(rawBody: Buffer | undefined, host = 'api.example.com') {
    return {
      rawBody,
      protocol: 'https',
      headers: { host },
    } as any;
  }

  it('THE BUG, proven directly: a non-ASCII payload verifies against its raw bytes but FAILS against the JSON.stringify round-trip', () => {
    const rawBytes = Buffer.from(RAW_BODY_STRING, 'utf8');
    const correctSignature = signRawBody(rawBytes.toString('utf8'));

    // Verifying against the exact raw bytes Square signed: passes.
    const passesAgainstRawBytes = verifySquareSignature({
      signatureHeader: correctSignature,
      notificationUrl: NOTIFICATION_URL,
      body: rawBytes.toString('utf8'),
      signingKey: SIGNING_KEY,
      algo: 'sha256',
    });
    expect(passesAgainstRawBytes).toBe(true);

    // The old buggy fallback: parse the raw bytes into an object (as Nest's
    // body-parser would), then re-serialize with JSON.stringify — exactly
    // what the removed fallback did. Force a key-order / whitespace
    // divergence the way a real intermediary parser commonly would, by
    // rebuilding the object with keys in a different order than the wire
    // payload used. This reproduces the real-world failure mode: Square's
    // own JSON serialization order is not guaranteed to match whatever
    // order a re-serialization produces.
    const parsed = JSON.parse(rawBytes.toString('utf8'));
    const reorderedClone = {
      event_id: parsed.event_id,
      type: parsed.type,
      merchant_id: parsed.merchant_id,
      data: parsed.data,
    };
    const reSerialized = JSON.stringify(reorderedClone);
    expect(reSerialized).not.toBe(RAW_BODY_STRING); // proves the two byte-strings genuinely differ

    const passesAgainstReserialized = verifySquareSignature({
      signatureHeader: correctSignature,
      notificationUrl: NOTIFICATION_URL,
      body: reSerialized,
      signingKey: SIGNING_KEY,
      algo: 'sha256',
    });
    expect(passesAgainstReserialized).toBe(false);
  });

  it('controller accepts a correctly-signed request when req.rawBody carries the exact bytes', async () => {
    const rawBytes = Buffer.from(RAW_BODY_STRING, 'utf8');
    const signature = signRawBody(rawBytes.toString('utf8'));

    const result = await controller.webhook(reqWith(rawBytes), signature, undefined);

    expect(result).toEqual({ ok: true });
    expect(svc.findConnectionByMerchantId).toHaveBeenCalledWith(MERCHANT_ID);
    expect(svc.syncConnection).toHaveBeenCalled();
  });

  it('controller 401s when req.rawBody is present but the signature does not match (tampered/mismatched bytes)', async () => {
    const rawBytes = Buffer.from(RAW_BODY_STRING, 'utf8');
    // Sign a DIFFERENT body than the one actually delivered — simulates
    // exactly what the old JSON.stringify(req.body) fallback did: verify
    // against bytes that are not what Square actually sent.
    const wrongSignature = signRawBody(JSON.stringify({ merchant_id: MERCHANT_ID, event_id: 'different' }));

    await expect(controller.webhook(reqWith(rawBytes), wrongSignature, undefined)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(svc.findConnectionByMerchantId).not.toHaveBeenCalled();
  });

  it('controller 400s when req.rawBody is missing entirely (raw-body mount not applied) instead of silently falling back to JSON.stringify(req.body)', async () => {
    const signature = signRawBody(RAW_BODY_STRING);
    await expect(controller.webhook(reqWith(undefined), signature, undefined)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(svc.findConnectionByMerchantId).not.toHaveBeenCalled();
  });

  it('rejects when SQUARE_WEBHOOK_SIG_KEY is unset', async () => {
    delete process.env.SQUARE_WEBHOOK_SIG_KEY;
    const rawBytes = Buffer.from(RAW_BODY_STRING, 'utf8');
    await expect(controller.webhook(reqWith(rawBytes), 'anything', undefined)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});

/**
 * Webhook idempotency is TENANT-SCOPED (P1 cross-tenant data-loss fix,
 * 2026-07-03).
 * ───────────────────────────────────────────────────────────────────
 *
 * BUG: `claimWebhookEvent` composed the ProcessedPosEvent primary key as
 * `${providerId}:${eventId}` — no tenant. On the `custom-webhook` provider
 * the operator supplies `eventId` freely (a counter, a unix-second, a
 * literal like `menu-update`), so two DIFFERENT tenants routinely emit the
 * SAME eventId. Tenant A's `eventId:'1001'` inserted row
 * `custom-webhook:1001`; Tenant B's own `eventId:'1001'` then hit the unique
 * constraint (P2002) on the SAME primary key → `claimWebhookEvent` returned
 * false → the controller replied `{ ok:true, deduped:true }` WITHOUT applying
 * B's menu/price/auto-86 push. B's sold-out item / wrong price kept showing
 * on B's live screens, indefinitely for any re-used eventId.
 *
 * FIX: the key is now `${tenantId}:${providerId}:${eventId}`, isolating each
 * tenant's dedup namespace. A same-tenant replay of the same eventId still
 * dedups; two tenants with the same eventId now BOTH process.
 *
 * These tests model the real DB behaviour: `processedPosEvent.create` throws
 * a P2002 when (and only when) the composed `id` already exists — exactly
 * what Postgres does for a duplicate primary key.
 */
describe('Webhook idempotency is tenant-scoped (P1 cross-tenant fix)', () => {
  // A fake ProcessedPosEvent table that enforces PK-uniqueness on `id`,
  // mirroring the Prisma/Postgres unique-constraint → P2002 behaviour that
  // `claimWebhookEvent` catches.
  function makeProcessedPosEventTable() {
    const seen = new Set<string>();
    return {
      seen,
      create: jest.fn(async ({ data }: { data: { id: string } }) => {
        if (seen.has(data.id)) {
          const err: any = new Error('Unique constraint failed on the fields: (`id`)');
          err.code = 'P2002';
          throw err;
        }
        seen.add(data.id);
        return { ...data };
      }),
    };
  }

  describe('claimWebhookEvent (service unit)', () => {
    let svc: PosService;
    let table: ReturnType<typeof makeProcessedPosEventTable>;

    beforeEach(async () => {
      table = makeProcessedPosEventTable();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PosService,
          MenuService,
          {
            provide: PrismaService,
            useValue: { client: { processedPosEvent: table } },
          },
        ],
      }).compile();
      svc = module.get(PosService);
    });

    it('same tenant + same eventId → first true, replay false (still dedups)', async () => {
      expect(await svc.claimWebhookEvent('tenant-A', 'custom-webhook', '1001', 'menu')).toBe(true);
      expect(await svc.claimWebhookEvent('tenant-A', 'custom-webhook', '1001', 'menu')).toBe(false);
      // Only ONE row was ever inserted for this (tenant, provider, eventId).
      expect(table.seen.has('tenant-A:custom-webhook:1001')).toBe(true);
      expect(table.seen.size).toBe(1);
    });

    it('TWO tenants + the SAME eventId → BOTH claim (no cross-tenant collision)', async () => {
      // Without the fix these would collide on `custom-webhook:1001` and the
      // second call would return false — dropping Tenant B's push.
      expect(await svc.claimWebhookEvent('tenant-A', 'custom-webhook', '1001', 'menu')).toBe(true);
      expect(await svc.claimWebhookEvent('tenant-B', 'custom-webhook', '1001', 'menu')).toBe(true);
      // Two distinct rows — one per tenant.
      expect(table.seen.has('tenant-A:custom-webhook:1001')).toBe(true);
      expect(table.seen.has('tenant-B:custom-webhook:1001')).toBe(true);
      expect(table.seen.size).toBe(2);
    });

    it('the composed key includes the tenant id (regression guard on the key shape)', async () => {
      await svc.claimWebhookEvent('tenant-XYZ', 'square', 'evt-9', 'inventory');
      expect(table.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id: 'tenant-XYZ:square:evt-9' }),
        }),
      );
    });
  });

  describe('custom-webhook controller (end-to-end through the receiver)', () => {
    // Two tenants, two secrets, one shared eventId. Prove both pushes apply.
    const SECRET_A = 'secret-for-tenant-A-0000000000000';
    const SECRET_B = 'secret-for-tenant-B-1111111111111';

    let controller: PosOAuthController;
    let table: ReturnType<typeof makeProcessedPosEventTable>;
    let posMenuItem: any;

    function connRow(id: string, tenantId: string, secret: string) {
      const sealed = sealCredentials({ webhookSecret: secret });
      return {
        id,
        tenantId,
        providerId: 'custom-webhook',
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
      };
    }

    beforeEach(async () => {
      table = makeProcessedPosEventTable();
      posMenuItem = { upsert: jest.fn().mockResolvedValue({}) };
      const posProviderConnection = {
        // Both tenants' custom-webhook rows live in the same table; the
        // receiver picks the one whose decrypted secret matches.
        findMany: jest.fn().mockResolvedValue([
          connRow('conn-A', 'tenant-A', SECRET_A),
          connRow('conn-B', 'tenant-B', SECRET_B),
        ]),
        update: jest.fn().mockResolvedValue({}),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PosService,
          MenuService,
          {
            provide: PrismaService,
            useValue: {
              client: { posProviderConnection, posMenuItem, processedPosEvent: table },
            },
          },
        ],
      }).compile();
      const prisma = module.get(PrismaService);
      const svc = module.get(PosService);
      const menu = module.get(MenuService);
      controller = new PosOAuthController(prisma, svc, menu);
    });

    const reqWith = (body: unknown) => ({ body }) as any;
    const pushWithEventId = (eventId: string) =>
      reqWith({ eventId, items: [{ id: 'burger', name: 'Burger', priceCents: 999 }] });

    it('two tenants pushing the SAME eventId BOTH apply (the core cross-tenant fix)', async () => {
      const outA = await controller.customWebhook('custom-webhook', pushWithEventId('1001'), SECRET_A);
      const outB = await controller.customWebhook('custom-webhook', pushWithEventId('1001'), SECRET_B);

      // Neither push was deduped away — both upserted their catalog.
      expect(outA).toEqual({ ok: true, upserted: 1, skipped: 0 });
      expect(outB).toEqual({ ok: true, upserted: 1, skipped: 0 });
      expect((outA as any).deduped).toBeUndefined();
      expect((outB as any).deduped).toBeUndefined();

      // Each tenant's item landed under its OWN tenant.
      const tenantsUpserted = posMenuItem.upsert.mock.calls.map(
        (c: any[]) => c[0].create.tenantId,
      );
      expect(tenantsUpserted).toEqual(expect.arrayContaining(['tenant-A', 'tenant-B']));
      // Two independent dedup rows.
      expect(table.seen.has('tenant-A:custom-webhook:1001')).toBe(true);
      expect(table.seen.has('tenant-B:custom-webhook:1001')).toBe(true);
    });

    it('the SAME tenant replaying the SAME eventId still dedups (no double-apply)', async () => {
      const first = await controller.customWebhook('custom-webhook', pushWithEventId('1001'), SECRET_A);
      const replay = await controller.customWebhook('custom-webhook', pushWithEventId('1001'), SECRET_A);

      expect(first).toEqual({ ok: true, upserted: 1, skipped: 0 });
      expect(replay).toEqual({ ok: true, deduped: true });
      // Only the first delivery upserted.
      expect(posMenuItem.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
