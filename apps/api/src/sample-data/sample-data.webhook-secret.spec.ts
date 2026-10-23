/**
 * The sample POS connections are REAL `custom-webhook` connections: their
 * `webhookSecret` is what `PosService` compares an inbound webhook's signature
 * against, so a guessable one would let anyone push menu prices into the
 * tenant. CodeQL js/insecure-randomness (2026-10-22): the secret used to be
 * `Math.random().toString(36)` — a PRNG seeded from a 128-bit xorshift state
 * that is recoverable from a handful of outputs. It is `crypto.randomBytes`
 * now; this pins the shape and the entropy of what the loaders hand PosService.
 */
import { SampleDataService } from './sample-data.service';

function build() {
  const created: any[] = [];
  const prisma = {
    client: {
      posProviderConnection: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      streamingConnection: { count: jest.fn().mockResolvedValue(0) },
      posMenuItem: { upsert: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    },
  };
  const pos = {
    createConnection: jest.fn(async (input: any) => {
      created.push(input);
      return { id: 'conn-' + created.length };
    }),
    // Anything the loader calls after the connection exists is a no-op here —
    // the secret is minted at createConnection time, which is all this proves.
    upsertMenuItems: jest.fn().mockResolvedValue(undefined),
    syncNow: jest.fn().mockResolvedValue(undefined),
  };
  const ads = { createHouseAd: jest.fn().mockResolvedValue({}) };
  const svc = new SampleDataService(prisma as any, pos as any, ads as any);
  return { svc, created };
}

describe('sample-data webhook secrets', () => {
  it('mints a 128-bit hex secret for the restaurant sample connection', async () => {
    const { svc, created } = build();
    await (svc as any)._seedRestaurantPos('tenant-1', 'user-1');
    expect(created).toHaveLength(1);
    expect(created[0].providerId).toBe('custom-webhook');
    expect(created[0].credentials.webhookSecret).toMatch(/^sample-[0-9a-f]{32}$/);
  });

  it('mints a 128-bit hex secret for the retail sample connection', async () => {
    const { svc, created } = build();
    await (svc as any)._seedRetailPos('tenant-1', 'user-1');
    expect(created).toHaveLength(1);
    expect(created[0].credentials.webhookSecret).toMatch(/^sample-[0-9a-f]{32}$/);
  });

  it('never repeats a secret across tenants', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { svc, created } = build();
      await (svc as any)._seedRestaurantPos(`tenant-${i}`, 'user-1');
      seen.add(created[0].credentials.webhookSecret);
    }
    expect(seen.size).toBe(20);
  });
});
