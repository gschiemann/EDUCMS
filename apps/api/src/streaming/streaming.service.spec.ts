/**
 * StreamingService tests — playback-URL resolution.
 * ─────────────────────────────────────────────────
 *
 * Launch-audit S1 regression guard (2026-07-16): manually-pasted
 * YouTube/Twitch/Vimeo channels persist the URL ONLY into `externalId`
 * (playbackUrl is null). Before the fix, both `listChannels` and
 * `resolvePlayback` returned an empty playbackUrl for those channels, so
 * the template-builder picker copied `undefined` into the widget config
 * and the StreamingWidget rendered "No channel selected" — the #1
 * marketed streaming path, broken end-to-end.
 *
 * These tests assert that an iframe channel whose URL lives only in
 * externalId resolves to a NON-EMPTY playable URL through both the DTO
 * (listChannels) and the /play resolver (resolvePlayback), while preset
 * channels (externalId = slug, playbackUrl set) are unaffected and a
 * genuinely-empty channel still resolves to undefined.
 *
 * The Prisma client is mocked per-model — no real DB.
 */
import { StreamingService } from './streaming.service';

const TENANT = 'tenant-1';
const YT_URL = 'https://www.youtube.com/watch?v=abc123XYZ';

function makeMockPrisma(channels: any[]) {
  const streamChannel = {
    findMany: jest.fn().mockResolvedValue(channels),
    findFirst: jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(channels.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null),
    ),
  };
  return { client: { streamChannel } } as any;
}

function svcWith(prisma: any): StreamingService {
  return new StreamingService(prisma);
}

// A manually-pasted iframe channel exactly as settings/streaming saved it
// BEFORE the fix: URL only in externalId, playbackUrl null.
const buggyIframeChannel = {
  id: 'ch-iframe',
  tenantId: TENANT,
  connectionId: 'conn-1',
  externalId: YT_URL,
  kind: 'LIVE',
  title: 'ESPN Live',
  description: null,
  thumbnailUrl: null,
  category: null,
  playbackUrl: null,
  playbackType: 'iframe',
  allowAdOverlay: true,
  status: 'ACTIVE',
  connection: { providerId: 'youtube-live' },
};

describe('StreamingService — S1 iframe playback resolution', () => {
  it('listChannels: an iframe channel with URL only in externalId yields a non-empty playbackUrl', async () => {
    const prisma = makeMockPrisma([buggyIframeChannel]);
    const [dto] = await svcWith(prisma).listChannels(TENANT);

    expect(dto.playbackUrl).toBe(YT_URL);
    expect(dto.playbackUrl).toBeTruthy();
    // externalId still surfaced so the picker/player has the raw source.
    expect(dto.externalId).toBe(YT_URL);
    expect(dto.playbackType).toBe('iframe');
  });

  it('resolvePlayback: the same channel resolves to a non-empty playback AND embed URL', async () => {
    const prisma = makeMockPrisma([buggyIframeChannel]);
    const res = await svcWith(prisma).resolvePlayback(TENANT, 'ch-iframe');

    expect(res.playbackUrl).toBe(YT_URL);
    // iframe providers play via the embed URL — it must be populated.
    expect(res.embedUrl).toBe(YT_URL);
    expect(res.embedUrl).toBeTruthy();
    expect(res.playbackType).toBe('iframe');
  });

  it('does NOT treat a non-URL externalId (preset slug) as a playback URL', async () => {
    const presetChannel = {
      ...buggyIframeChannel,
      id: 'ch-preset',
      externalId: 'nhk-world', // slug, not a URL
      playbackUrl: null,
      connection: { providerId: 'public-broadcasters' },
    };
    const prisma = makeMockPrisma([presetChannel]);

    const [dto] = await svcWith(prisma).listChannels(TENANT);
    expect(dto.playbackUrl).toBeUndefined();

    const res = await svcWith(prisma).resolvePlayback(TENANT, 'ch-preset');
    expect(res.playbackUrl).toBeUndefined();
    expect(res.embedUrl).toBeUndefined();
  });

  it('leaves an already-populated playbackUrl (HLS / preset embed) untouched', async () => {
    const hlsChannel = {
      ...buggyIframeChannel,
      id: 'ch-hls',
      externalId: 'https://cdn.example.com/live.m3u8',
      playbackUrl: 'https://cdn.example.com/live.m3u8',
      playbackType: 'hls',
      connection: { providerId: 'custom-hls' },
    };
    const prisma = makeMockPrisma([hlsChannel]);

    const [dto] = await svcWith(prisma).listChannels(TENANT);
    expect(dto.playbackUrl).toBe('https://cdn.example.com/live.m3u8');

    const res = await svcWith(prisma).resolvePlayback(TENANT, 'ch-hls');
    expect(res.playbackUrl).toBe('https://cdn.example.com/live.m3u8');
    // Non-iframe → no embedUrl.
    expect(res.embedUrl).toBeUndefined();
  });
});
