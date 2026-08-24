/**
 * Regression tests: a NEW screen row must adopt the orientation of the panel
 * the device just reported, not the column default.
 *
 * ⚠️ THE FIELD BUG THIS PINS (2026-08-24). `Screen.orientation` is
 * `@default("LANDSCAPE")`, and the manifest hands that value to the player,
 * which applies it via `setRequestedOrientation`. So every auto-created row
 * ACTIVELY FORCED landscape regardless of the hardware. Two 2160×3840 signage
 * panels installed that day came up unusable: one letterboxed its content into
 * a landscape strip across the middle of the glass, the other rendered the
 * entire UI rotated 90°.
 *
 * It stayed hidden for months because every previously-paired screen had been
 * set to AUTO by hand long ago — a brand-new row is the only path that meets
 * the raw default, and new rows only appeared when the fleet's device
 * fingerprints changed (debug -> release signing key, which re-scopes
 * ANDROID_ID on Android 8+).
 *
 * The device reports `resolution` on the register call itself, so no guessing
 * is required: h > w is portrait on a fixed-mount panel.
 *
 * Landscape input resolves to the same value the column default already had,
 * so portrait hardware is the ONLY behaviour change — that asymmetry is
 * asserted below so a future refactor cannot quietly widen it.
 */

import { ScreensController, resolveManifestOrientation } from './screens.controller';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const mockPrisma: any = {
  client: {
    screen: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  },
};

const mockRedis: any = { publish: jest.fn() };
const mockSigner: any = { signMessage: jest.fn() };
const mockLicense: any = { assertSeatAvailable: jest.fn() };

let controller: ScreensController;

beforeEach(() => {
  jest.clearAllMocks();
  // Brand-new device: no existing row for this fingerprint, and no pairing
  // code collision.
  mockPrisma.client.screen.findUnique.mockResolvedValue(null);
  mockPrisma.client.screen.create.mockImplementation(async ({ data }: any) => ({
    id: 'screen-new-001',
    credentialEpoch: 0,
    ...data,
  }));
  controller = new ScreensController(
    mockPrisma, mockRedis, mockSigner, mockLicense, {} as any, {} as any,
  );
});

const makeReq = (ip = '10.0.0.77') => ({
  ip,
  socket: { remoteAddress: ip },
  headers: {},
});

/** The `data` object the controller handed to prisma.screen.create. */
const createdData = () => mockPrisma.client.screen.create.mock.calls[0][0].data;

async function registerWith(resolution: string | undefined) {
  await (controller as any).register(
    {
      deviceFingerprint: `fp-${Math.abs(hash(String(resolution)))}`,
      ...(resolution === undefined ? {} : { resolution }),
    },
    makeReq(),
  );
}

// Stable per-input fingerprint so the per-fingerprint register cooldown does
// not reject the second and later cases in this file.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

describe('POST /screens/register — orientation derived from reported panel', () => {
  it('PORTRAIT for a taller-than-wide panel, using the U+00D7 separator players actually send', async () => {
    // ⚠️ This exact string is what the field devices report. An ASCII-only
    // parser silently fails here and falls back to forced landscape — which
    // is the bug, not a near miss.
    await registerWith('2160×3840');
    expect(createdData().orientation).toBe('PORTRAIT');
  });

  it('PORTRAIT for the ASCII and star separators too', async () => {
    await registerWith('1080x1920');
    expect(createdData().orientation).toBe('PORTRAIT');
    mockPrisma.client.screen.create.mockClear();
    await registerWith('1200*1600');
    expect(createdData().orientation).toBe('PORTRAIT');
  });

  it('LANDSCAPE for a wider-than-tall panel', async () => {
    await registerWith('1920×1080');
    expect(createdData().orientation).toBe('LANDSCAPE');
  });

  it('LANDSCAPE for an exactly square panel — not portrait', async () => {
    // h > w is the rule; equal sides must NOT tip into portrait.
    await registerWith('1080×1080');
    expect(createdData().orientation).toBe('LANDSCAPE');
  });

  it('a LANDSCAPE-reporting device still lands LANDSCAPE — no accidental flip', async () => {
    await registerWith('3840×2160');
    expect(createdData().orientation).toBe('LANDSCAPE');
  });

  it('leaves the column default ALONE when resolution is absent or unparseable', async () => {
    // Writing a guess here would be worse than the default: it asserts an
    // answer the device never gave us. Omitting the key lets Prisma apply
    // the column default and keeps an operator override meaningful.
    await registerWith(undefined);
    expect(createdData().orientation).toBeUndefined();

    mockPrisma.client.screen.create.mockClear();
    await registerWith('not-a-resolution');
    expect(createdData().orientation).toBeUndefined();

    mockPrisma.client.screen.create.mockClear();
    await registerWith('0×0');
    expect(createdData().orientation).toBeUndefined();
  });
});

/**
 * ⚠️ 'AUTO' IS NOT AUTO-DETECTION ON THIS HARDWARE — the point of the resolver.
 *
 * On the device 'AUTO' maps to SCREEN_ORIENTATION_UNSPECIFIED: "release the
 * lock, let the sensor decide". Signage panels have no accelerometer, so that
 * is a no-op that defers to a firmware default which is frequently landscape
 * even on a physically portrait panel. Worse, the player's CSS rotate fallback
 * — the safety net for ROMs that ignore the Android orientation API entirely —
 * is gated on the literal string 'PORTRAIT', so an AUTO screen gets no
 * fallback either.
 *
 * Operator, on two 2160×3840 panels: "2160x3840 is portrait....make them auto
 * and have it work properly." So AUTO is resolved server-side, where the panel
 * is known, and the device receives a concrete value that the existing proven
 * PORTRAIT path can act on.
 */
describe('resolveManifestOrientation — makes AUTO mean auto-detect', () => {
  it('resolves AUTO to PORTRAIT for a portrait panel', () => {
    expect(resolveManifestOrientation('AUTO', '2160×3840')).toBe('PORTRAIT');
  });

  it('resolves AUTO to LANDSCAPE for a landscape panel', () => {
    expect(resolveManifestOrientation('AUTO', '1920×1080')).toBe('LANDSCAPE');
  });

  it('NEVER overrides an explicit operator choice — a deliberately sideways-mounted panel wins', () => {
    // A portrait panel an operator has deliberately set to LANDSCAPE must stay
    // landscape. Inferring over the top of an explicit choice is the exact
    // failure this area has already produced once.
    expect(resolveManifestOrientation('LANDSCAPE', '2160×3840')).toBe('LANDSCAPE');
    expect(resolveManifestOrientation('PORTRAIT', '1920×1080')).toBe('PORTRAIT');
  });

  it('stays AUTO when the panel size is unknown — defer rather than guess', () => {
    expect(resolveManifestOrientation('AUTO', null)).toBe('AUTO');
    expect(resolveManifestOrientation('AUTO', '')).toBe('AUTO');
    expect(resolveManifestOrientation('AUTO', 'garbage')).toBe('AUTO');
    expect(resolveManifestOrientation('AUTO', '0×0')).toBe('AUTO');
  });

  it('square is LANDSCAPE, matching the register-time rule (h > w, strictly)', () => {
    expect(resolveManifestOrientation('AUTO', '1080×1080')).toBe('LANDSCAPE');
  });

  it('falls back to LANDSCAPE for a null/unknown column, preserving historical behaviour', () => {
    expect(resolveManifestOrientation(null, '2160×3840')).toBe('LANDSCAPE');
    expect(resolveManifestOrientation(undefined, '2160×3840')).toBe('LANDSCAPE');
  });

  it('accepts the U+00D7 separator players actually send, not just ASCII x', () => {
    // An ASCII-only parser matches nothing here and silently returns AUTO,
    // which reinstates the whole bug.
    expect(resolveManifestOrientation('AUTO', '2160×3840')).toBe('PORTRAIT');
    expect(resolveManifestOrientation('AUTO', '2160x3840')).toBe('PORTRAIT');
  });

  it('is case-insensitive on the stored column', () => {
    expect(resolveManifestOrientation('auto', '2160×3840')).toBe('PORTRAIT');
    expect(resolveManifestOrientation('portrait', '1920×1080')).toBe('PORTRAIT');
  });
});
