/**
 * Media-source connection tests.
 *
 * Two defects these lock down, both found while wiring the gym media
 * boards' in-editor source picker (2026-08-24):
 *
 *  1. NOTHING in the codebase ever moved a streaming connection out of
 *     PENDING. `custom-hls` — a customer's own or explicitly licensed
 *     feed, and per the provider matrix the ONE route that works end to
 *     end today — saved as PENDING and stayed there. The operator pasted
 *     a working URL, got an amber "pending" pill, and waited on an
 *     approval with no approver. PENDING means "waiting on a third
 *     party"; for a feed we play ourselves there is no third party.
 *
 *  2. The editor decided whether a source could drive a screen by
 *     inferring from the provider id. That inference is precisely how a
 *     board ends up claiming a live feed it does not have, so capability
 *     is derived server-side from the provider definition and shipped on
 *     the DTO.
 *
 * The Prisma client is mocked per-model — no real DB, no real network
 * (the URL probe is stubbed).
 */
import { StreamingService } from './streaming.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

function makeMockPrisma() {
  const created: any[] = [];
  const streamProviderConnection = {
    create: jest.fn().mockImplementation(({ data }: any) => {
      const row = { id: 'conn-' + (created.length + 1), ...data, createdAt: new Date() };
      created.push(row);
      return Promise.resolve(row);
    }),
    findMany: jest.fn().mockImplementation(() =>
      Promise.resolve(created.map((r) => ({ ...r, _count: { channels: 0 } }))),
    ),
  };
  return { created, prisma: { client: { streamProviderConnection } } as any };
}

/** Stub the network probe so these stay hermetic. */
function svcWithProbe(prisma: any, ok: boolean, reason?: string): StreamingService {
  const svc = new StreamingService(prisma);
  (svc as any).validateStreamUrl = jest.fn().mockResolvedValue({
    ok, type: 'hls', embeddable: true, reason,
  });
  return svc;
}

describe('custom-hls connections finish, instead of pending forever', () => {
  it('a reachable customer-owned feed becomes ACTIVE and records when it was verified', async () => {
    const { prisma, created } = makeMockPrisma();
    const svc = svcWithProbe(prisma, true);

    await svc.createConnection({
      tenantId: TENANT, userId: USER, providerId: 'custom-hls',
      credentials: { playbackUrl: 'https://cdn.example.com/club/master.m3u8' },
    });

    expect(created[0].status).toBe('ACTIVE');
    expect(created[0].statusReason).toBeNull();
    expect(created[0].lastVerifiedAt).toBeInstanceOf(Date);
  });

  it('an unreachable feed is an ERROR the operator can see and fix, not an endless wait', async () => {
    const { prisma, created } = makeMockPrisma();
    const svc = svcWithProbe(prisma, false, 'Stream returned 404.');

    await svc.createConnection({
      tenantId: TENANT, userId: USER, providerId: 'custom-hls',
      credentials: { playbackUrl: 'https://cdn.example.com/gone.m3u8' },
    });

    expect(created[0].status).toBe('ERROR');
    expect(created[0].statusReason).toBe('Stream returned 404.');
    // The distinction that matters: not PENDING. Nothing would ever have
    // resolved a PENDING row.
    expect(created[0].status).not.toBe('PENDING');
  });

  it('a probe that throws still resolves to a stated ERROR', async () => {
    const { prisma, created } = makeMockPrisma();
    const svc = new StreamingService(prisma);
    (svc as any).validateStreamUrl = jest.fn().mockRejectedValue(new Error('socket hang up'));

    await svc.createConnection({
      tenantId: TENANT, userId: USER, providerId: 'custom-hls',
      credentials: { playbackUrl: 'https://cdn.example.com/x.m3u8' },
    });

    expect(created[0].status).toBe('ERROR');
    expect(created[0].statusReason).toBeTruthy();
  });
});

describe('a source states what it can actually do', () => {
  it('a feed VenueOS plays itself is RENDERS; a music service with no adapter is not', async () => {
    const { prisma } = makeMockPrisma();
    const svc = svcWithProbe(prisma, true);

    await svc.createConnection({
      tenantId: TENANT, userId: USER, providerId: 'custom-hls',
      credentials: { playbackUrl: 'https://cdn.example.com/a.m3u8' },
    });
    await svc.createConnection({
      tenantId: TENANT, userId: USER, providerId: 'soundtrack',
      credentials: { apiKey: 'k' },
    });

    const list = await svc.listConnections(TENANT);
    const hls = list.find((c) => c.providerId === 'custom-hls');
    const music = list.find((c) => c.providerId === 'soundtrack');

    expect(hls?.mediaRole).toBe('RENDERS');
    expect(hls?.isMusic).toBe(false);

    // Soundtrack is a real licensed business-music service with a real
    // API — and our adapter is not built. It must not read as a source
    // that can drive the screen.
    expect(music?.mediaRole).toBe('PENDING_ADAPTER');
    expect(music?.isMusic).toBe(true);
    expect(music?.status).toBe('PENDING');
  });
});

describe('sources that cannot lawfully play are refused at the API, not just hidden in the UI', () => {
  const cases: Array<[string, RegExp]> = [
    ['youtube', /does not permit commercial venue display/i],
    ['twitch', /does not permit commercial venue display/i],
    ['public-broadcasters', /does not permit commercial venue display/i],
    ['atmosphere', /does not have a public API/i],
    ['directv-business', /does not have a public API/i],
  ];
  it.each(cases)('%s is rejected', async (providerId, message) => {
    const { prisma, created } = makeMockPrisma();
    const svc = svcWithProbe(prisma, true);
    await expect(
      svc.createConnection({ tenantId: TENANT, userId: USER, providerId, credentials: {} }),
    ).rejects.toThrow(message);
    expect(created).toHaveLength(0);
  });
});
