/**
 * A browser-sized report never shrinks a known panel size (2026-10-17, player
 * rock-solid §1 "4K screens drop back"; Astra's resolution triage 2026-10-15).
 *
 * The manifest picks a screen's video by `Screen.resolution`. Registration
 * stored any non-empty report, and the player sends either the APK's physical
 * `?w=&h=` or, when the page has none (a face, a page that lost its query),
 * `window.screen` in DPI-scaled CSS pixels — so one 1080×1668 report moved a
 * 2160×3840 screen onto the 1080p copy. The user agent cannot tell the two
 * apart (a face's WebView says `EduCmsPlayer/` too); the page now names its
 * source. These pin the register write through the real handler, and what the
 * manifest then selects.
 */

import * as jwt from 'jsonwebtoken';
import { ScreensController, _registerFpCooldown } from './screens.controller';
import { parseResolution, registeredResolution } from './registered-resolution';
import { selectVideoFile } from './video-rendition';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN = 'screen-resolution-001';
const FP = 'fp-resolution-001';
const APK_UA = 'Mozilla/5.0 (Linux; Android 11; wv) AppleWebKit/537.36 Chrome/95.0.4638.74 Safari/537.36 EduCmsPlayer/1.1.29 (Android 11)';

/** A 4K original with a validated 1080p copy — the Brookfield portrait shape. */
const ASSET = {
  fileUrl: 'https://cdn.example/assets/t/clip-4k.mp4',
  fileHash: 'd'.repeat(64),
  fileSize: 140_000_000,
  mimeType: 'video/mp4',
  processingMeta: {
    renditions: {
      '1080p': { url: 'https://cdn.example/assets/t/renditions/clip-1080.mp4', sha256: '3'.repeat(64), size: 38_000_000, width: 1080, height: 1668 },
    },
  },
};

function setup(row: { tenantId: string | null; resolution: string | null }) {
  const state: any = {
    id: SCREEN,
    deviceFingerprint: FP,
    pairingCode: row.tenantId ? null : 'ABC123',
    tenantId: row.tenantId,
    status: row.tenantId ? 'ONLINE' : 'PENDING',
    name: 'Resolution test screen',
    credentialEpoch: 3,
    credentialEpochRotatedAt: new Date(Date.now() - 6 * 60 * 60_000),
    authState: 'PROVEN',
    resolution: row.resolution,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    hardwareModel: 'generic-android',
  };
  const writes: any[] = [];
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn(async () => ({ ...state })),
        update: jest.fn(async ({ data }: { data: any }) => {
          writes.push(data);
          if (data.credentialEpoch?.increment) {
            state.credentialEpoch += data.credentialEpoch.increment;
            return { credentialEpoch: state.credentialEpoch };
          }
          Object.assign(state, data);
          return { ...state };
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      screenEvent: { create: jest.fn(async () => ({})) },
    },
  };
  prisma.client.$transaction = jest.fn((fn: (tx: any) => Promise<unknown>) => fn(prisma.client));
  prisma.client.$queryRaw = jest.fn(async () => [{ id: SCREEN }]);
  const controller = new ScreensController(
    ...([prisma, { publish: jest.fn() }, { signMessage: jest.fn() }, { assertSeatAvailable: jest.fn() }, {}, {}] as unknown as ConstructorParameters<typeof ScreensController>),
  );
  const token = jwt.sign({ sub: SCREEN, deviceId: SCREEN, kind: 'device', ep: 3 }, SECRET, { expiresIn: '180d' });
  const register = (body: Record<string, unknown>) =>
    controller.register(
      { deviceFingerprint: FP, ...(row.tenantId ? { priorDeviceToken: token } : {}), ...body } as any,
      { ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' }, headers: {} } as any,
    );
  return { state, writes, register };
}

beforeEach(() => {
  jest.clearAllMocks();
  _registerFpCooldown.clear();
});

describe('register keeps a known 4K size over a browser-sized report', () => {
  it('a 2160×3840 screen receiving a 1080×1668 browser report keeps 2160×3840 — and the manifest still selects the 4K file', async () => {
    const t = setup({ tenantId: 'tenant-r', resolution: '2160×3840' });
    await t.register({ resolution: '1080×1668', resolutionSource: 'browser', userAgent: APK_UA });
    const write = t.writes.find((w) => 'resolution' in w);
    expect(write.resolution).toBe('2160×3840');
    expect(selectVideoFile(ASSET, t.state.resolution)).toEqual({ url: ASSET.fileUrl, sha256: ASSET.fileHash, size: ASSET.fileSize });
  });

  it('a page that predates the source field cannot shrink it either', async () => {
    const t = setup({ tenantId: 'tenant-r', resolution: '2160×3840' });
    await t.register({ resolution: '1080×1920', userAgent: APK_UA });
    expect(t.state.resolution).toBe('2160×3840');
  });

  it('the APK\'s own physical size still shrinks it — a box moved to a smaller panel', async () => {
    const t = setup({ tenantId: 'tenant-r', resolution: '2160×3840' });
    await t.register({ resolution: '1080×1920', resolutionSource: 'device', userAgent: APK_UA });
    expect(t.state.resolution).toBe('1080×1920');
    expect(selectVideoFile(ASSET, t.state.resolution).url).toBe(ASSET.processingMeta.renditions['1080p'].url);
  });

  it('a genuine 1080p screen still gets the 1080p copy', async () => {
    const t = setup({ tenantId: 'tenant-r', resolution: '1080×1920' });
    await t.register({ resolution: '1080×1920', resolutionSource: 'device', userAgent: APK_UA });
    expect(t.state.resolution).toBe('1080×1920');
    expect(selectVideoFile(ASSET, t.state.resolution)).toEqual({
      url: ASSET.processingMeta.renditions['1080p'].url,
      sha256: '3'.repeat(64),
      size: 38_000_000,
    });
  });

  it('a rotation or a larger report is always taken, whatever its source', async () => {
    const t = setup({ tenantId: 'tenant-r', resolution: '2160×3840' });
    await t.register({ resolution: '3840×2160', resolutionSource: 'browser' });
    expect(t.state.resolution).toBe('3840×2160');
    const small = setup({ tenantId: 'tenant-r', resolution: '960×540' });
    await small.register({ resolution: '1080×1920', resolutionSource: 'browser' });
    expect(small.state.resolution).toBe('1080×1920');
  });

  it('the unpaired branch follows the same rule', async () => {
    const t = setup({ tenantId: null, resolution: '2160×3840' });
    await t.register({ resolution: '1080×1668', resolutionSource: 'browser', userAgent: APK_UA });
    expect(t.state.resolution).toBe('2160×3840');
  });
});

describe('registeredResolution', () => {
  it('no report or garbage never replaces a known size; with nothing known the raw report is stored as before', () => {
    expect(registeredResolution('2160×3840', undefined, 'device')).toBe('2160×3840');
    expect(registeredResolution('2160×3840', '  ', 'device')).toBe('2160×3840');
    expect(registeredResolution('2160×3840', 'garbage', 'device')).toBe('2160×3840');
    expect(registeredResolution(null, '1080×1668', 'browser')).toBe('1080×1668');
    expect(registeredResolution(null, 'garbage', 'browser')).toBe('garbage');
    expect(registeredResolution(null, undefined, undefined)).toBeNull();
  });

  it('smaller only from the device; equal or larger from anyone', () => {
    expect(registeredResolution('2160x3840', '1080×1668', 'browser')).toBe('2160x3840');
    expect(registeredResolution('2160×3840', '1080×1668', 'device')).toBe('1080×1668');
    expect(registeredResolution('2160×3840', '1080×1668', 'Device')).toBe('2160×3840');
    expect(registeredResolution('1920×1080', '1080×1920', 'browser')).toBe('1080×1920');
    expect(registeredResolution('1920×1080', '3840×2160', undefined)).toBe('3840×2160');
  });

  it('parses both separators the players send', () => {
    expect(parseResolution('2160×3840')).toEqual({ w: 2160, h: 3840 });
    expect(parseResolution(' 1920 x 1080 ')).toEqual({ w: 1920, h: 1080 });
    expect(parseResolution('0×1080')).toBeNull();
    expect(parseResolution(42)).toBeNull();
  });
});
