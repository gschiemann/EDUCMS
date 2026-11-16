/**
 * Custom POS webhook — the shared secret and the receiver's failure limit.
 *
 *   - a NEW custom-webhook connection gets a server-generated secret
 *     (32 random bytes, base64url) returned once;
 *   - an operator-supplied secret shorter than 32 characters is refused;
 *   - existing connections (any stored secret) keep authenticating;
 *   - the receiver refuses an IP after repeated failed authentications,
 *     without counting successful pushes.
 */
import { HttpStatus } from '@nestjs/common';
import { PosService, MIN_CUSTOM_WEBHOOK_SECRET_LENGTH } from './pos.service';
import { PosController } from './pos.controller';
import { PosOAuthController, CUSTOM_WEBHOOK_MAX_FAILURES } from './pos-oauth.controller';
import { openCredentials, sealCredentials } from '../streaming/creds-cipher';
import { _resetIngestRateLimitMemoryForTests } from '../security/ingest-rate-limit';

function makePrisma() {
  const created: any[] = [];
  const posProviderConnection = {
    findMany: jest.fn(async () => [] as any[]),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `c${created.length + 1}`, createdAt: new Date(), ...data };
      created.push(row);
      return row;
    }),
    update: jest.fn(async () => ({})),
  };
  const client = {
    posProviderConnection,
    posMenuItem: { upsert: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { prisma: { client } as any, posProviderConnection, created };
}

const user = { tenantId: 'tenant-A', id: 'user-1' };

describe('custom-webhook connection secret', () => {
  it('generates a 32-byte base64url secret when none is supplied, and returns it once', async () => {
    const { prisma, created } = makePrisma();
    const svc = new PosService(prisma, {} as any);
    const ctl = new PosController(svc as any);
    const out: any = await ctl.createConnection({ user } as any, { providerId: 'custom-webhook', credentials: {} });
    expect(out.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(out.webhookSecret, 'base64url')).toHaveLength(32);
    const stored = openCredentials({
      encryptedCreds: created[0].encryptedCreds,
      encryptedDataKey: created[0].encryptedDataKey,
    }) as any;
    expect(stored.webhookSecret).toBe(out.webhookSecret);
  });

  it('never generates the same secret twice', async () => {
    const { prisma } = makePrisma();
    const svc = new PosService(prisma, {} as any);
    const a: any = await svc.createConnection({ ...{ tenantId: 't1', userId: 'u' }, providerId: 'custom-webhook', credentials: {} });
    const b: any = await svc.createConnection({ ...{ tenantId: 't2', userId: 'u' }, providerId: 'custom-webhook', credentials: {} });
    expect(a.generatedWebhookSecret).not.toBe(b.generatedWebhookSecret);
  });

  it(`refuses an operator-supplied secret shorter than ${MIN_CUSTOM_WEBHOOK_SECRET_LENGTH} characters`, async () => {
    const { prisma, created } = makePrisma();
    const svc = new PosService(prisma, {} as any);
    await expect(
      svc.createConnection({
        tenantId: 't',
        userId: 'u',
        providerId: 'custom-webhook',
        credentials: { webhookSecret: 'x'.repeat(MIN_CUSTOM_WEBHOOK_SECRET_LENGTH - 1) },
      }),
    ).rejects.toThrow(/at least 32 characters/);
    expect(created).toHaveLength(0);
  });

  it('accepts an operator-supplied secret of 32+ characters and does not return it', async () => {
    const { prisma } = makePrisma();
    const svc = new PosService(prisma, {} as any);
    const ctl = new PosController(svc as any);
    const out: any = await ctl.createConnection({ user } as any, {
      providerId: 'custom-webhook',
      credentials: { webhookSecret: 'y'.repeat(MIN_CUSTOM_WEBHOOK_SECRET_LENGTH) },
    });
    expect(out.webhookSecret).toBeUndefined();
  });
});

describe('custom-webhook receiver', () => {
  const OLD_SHORT_SECRET = 'legacy-short-secret';
  let svc: PosService;
  let ctl: PosOAuthController;

  beforeEach(() => {
    _resetIngestRateLimitMemoryForTests();
    const { prisma, posProviderConnection } = makePrisma();
    const sealed = sealCredentials({ webhookSecret: OLD_SHORT_SECRET });
    posProviderConnection.findMany.mockResolvedValue([
      { id: 'legacy', tenantId: 'tenant-A', providerId: 'custom-webhook', ...sealed },
    ]);
    svc = new PosService(prisma, { ingestPosCatalog: jest.fn(async () => ({})) } as any);
    ctl = new PosOAuthController(prisma, svc, {} as any, { publisher: null } as any);
  });

  const reqFrom = (ip: string, body: unknown = { items: [{ id: 'a', name: 'A', priceCents: 1 }] }) =>
    ({ body, ip, headers: {}, socket: { remoteAddress: ip } }) as any;

  it('an existing connection with a short stored secret still authenticates', async () => {
    const out = await ctl.customWebhook('custom-webhook', reqFrom('203.0.113.1'), OLD_SHORT_SECRET);
    expect(out).toMatchObject({ ok: true });
  });

  it('refuses an IP after repeated failures, even with the right secret, without affecting other IPs', async () => {
    for (let i = 0; i < CUSTOM_WEBHOOK_MAX_FAILURES; i++) {
      await expect(ctl.customWebhook('custom-webhook', reqFrom('203.0.113.9'), `wrong-${i}`)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    await expect(ctl.customWebhook('custom-webhook', reqFrom('203.0.113.9'), OLD_SHORT_SECRET)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    const other = await ctl.customWebhook('custom-webhook', reqFrom('203.0.113.10'), OLD_SHORT_SECRET);
    expect(other).toMatchObject({ ok: true });
  });

  it('a missing secret header counts as a failure', async () => {
    for (let i = 0; i < CUSTOM_WEBHOOK_MAX_FAILURES; i++) {
      await expect(ctl.customWebhook('custom-webhook', reqFrom('203.0.113.7'), undefined)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    await expect(ctl.customWebhook('custom-webhook', reqFrom('203.0.113.7'), OLD_SHORT_SECRET)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('successful pushes do not consume the failure budget', async () => {
    for (let i = 0; i < CUSTOM_WEBHOOK_MAX_FAILURES * 2; i++) {
      await expect(ctl.customWebhook('custom-webhook', reqFrom('203.0.113.5'), OLD_SHORT_SECRET)).resolves.toMatchObject({
        ok: true,
      });
    }
  });
});
