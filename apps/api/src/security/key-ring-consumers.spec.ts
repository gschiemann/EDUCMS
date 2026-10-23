/**
 * Every HMAC / device-JWT consumer of DEVICE_SECRET_KEY and DEVICE_JWT_SECRET
 * against the key ring (2026-10-22). For each consumer:
 *
 *   (a) previous unset  ⇒ unchanged: new-key material verifies, old-key refused
 *   (b) old-key material VERIFIES while the old key is `_PREVIOUS`
 *   (c) NEW material is always produced with the PRIMARY (it verifies with
 *       the primary alone once the window closes)
 *   (d) material from an unrelated key is refused, window or not
 *
 * The consumers that read env at CONSTRUCTION (RedisService, the JwtAuthGuard
 * device leg) have their own specs next to them.
 */
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { bindWsSignatureToChannel, verifyWsHmac, wsCanonicalString, wsHmacHex } from './ws-signature';
import { WebsocketSignerService } from './websocket-signer.service';
import { verifiedDeviceSubject } from './device-throttle-key';
import { decodeDeviceBearer, DEVICE_JWT_ALGORITHMS } from '../screens/device-auth';
import { mintStreamTicket, verifyStreamTicket } from '../screens/stream-ticket';
import { mintRenderCapability, verifyRenderCapability } from '../proxy/render-capability';
import { mintBeaconCapability, verifyBeaconCapability } from '../sports/beacon-capability';
import { makeFeedToken, verifyFeedToken } from '../sports/sports-feed-token';
import { makeConsoleToken, verifyConsoleToken } from '../sports/sports-console-token';
import { mintFieldTicket, verifyFieldTicket } from '../player-ota/field-candidate';
import { signDownloadTag, verifyDownloadTag } from '../player-ota/download-tag';
import { CleverService } from '../integrations/clever/clever.service';

const NEW_KEY = 'a1'.repeat(32); // 64 hex
const OLD_KEY = 'b2'.repeat(32);
const UNRELATED = 'c3'.repeat(32);

const VARS = [
  'NODE_ENV',
  'DEVICE_SECRET_KEY',
  'DEVICE_SECRET_KEY_PREVIOUS',
  'DEVICE_JWT_SECRET',
  'DEVICE_JWT_SECRET_PREVIOUS',
  'PROXY_RENDER_SECRET',
  'SPORTS_BEACON_SECRET',
  'SPORTS_FEED_SECRET',
  'SPORTS_CONSOLE_SECRET',
  'CLEVER_CLIENT_ID',
] as const;
const saved: Record<string, string | undefined> = {};

/** Run `fn` with DEVICE_SECRET_KEY / DEVICE_JWT_SECRET = `primary` and the given previous. */
function withKeys(primary: string, previous: string | undefined, fn: () => void) {
  process.env.DEVICE_SECRET_KEY = primary;
  process.env.DEVICE_JWT_SECRET = primary;
  if (previous === undefined) {
    delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
    delete process.env.DEVICE_JWT_SECRET_PREVIOUS;
  } else {
    process.env.DEVICE_SECRET_KEY_PREVIOUS = previous;
    process.env.DEVICE_JWT_SECRET_PREVIOUS = previous;
  }
  fn();
}

/** The four-way contract, given a mint-under-key and a verify. */
function contract(
  name: string,
  mintUnder: (key: string) => string,
  verifies: (material: string) => boolean,
) {
  describe(name, () => {
    it('(a) previous unset: primary material verifies, old-key material is refused', () => {
      let underOld = '';
      withKeys(OLD_KEY, undefined, () => {
        underOld = mintUnder(OLD_KEY);
      });
      withKeys(NEW_KEY, undefined, () => {
        expect(verifies(mintUnder(NEW_KEY))).toBe(true);
        expect(verifies(underOld)).toBe(false);
      });
    });
    it('(b) old-key material verifies while the old key is _PREVIOUS', () => {
      let underOld = '';
      withKeys(OLD_KEY, undefined, () => {
        underOld = mintUnder(OLD_KEY);
      });
      withKeys(NEW_KEY, OLD_KEY, () => {
        expect(verifies(underOld)).toBe(true);
      });
    });
    it('(c) new material is minted with the PRIMARY: it still verifies once the window closes', () => {
      let underWindow = '';
      withKeys(NEW_KEY, OLD_KEY, () => {
        underWindow = mintUnder(NEW_KEY);
        expect(verifies(underWindow)).toBe(true);
      });
      withKeys(NEW_KEY, undefined, () => {
        expect(verifies(underWindow)).toBe(true);
      });
      // …and NOT with the previous alone (it was not minted on it).
      withKeys(OLD_KEY, undefined, () => {
        expect(verifies(underWindow)).toBe(false);
      });
    });
    it('(d) material from an unrelated key is refused, with and without a window', () => {
      let underUnrelated = '';
      withKeys(UNRELATED, undefined, () => {
        underUnrelated = mintUnder(UNRELATED);
      });
      withKeys(NEW_KEY, undefined, () => expect(verifies(underUnrelated)).toBe(false));
      withKeys(NEW_KEY, OLD_KEY, () => expect(verifies(underUnrelated)).toBe(false));
    });
  });
}

beforeAll(() => {
  for (const k of VARS) saved[k] = process.env[k];
  for (const k of VARS) delete process.env[k];
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── Realtime fan-out signature primitives ────────────────────────────────────
describe('ws-signature with a ring', () => {
  const envelope = (key: string, channel?: string) => {
    const eventId = 'evt-' + Math.random().toString(36).slice(2);
    const timestamp = Date.now();
    const payload = { severity: 'LOCKDOWN' };
    return {
      eventId,
      timestamp,
      type: 'OVERRIDE',
      payload,
      signature: wsHmacHex(wsCanonicalString({ eventId, timestamp, type: 'OVERRIDE', payload, channel }), key),
    };
  };

  it('(a) a single-string secret behaves exactly as before', () => {
    expect(verifyWsHmac(envelope(NEW_KEY, 'tenant:a'), NEW_KEY, undefined, 'tenant:a').ok).toBe(true);
    expect(verifyWsHmac(envelope(OLD_KEY, 'tenant:a'), NEW_KEY, undefined, 'tenant:a')).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });
  it('(b) a ring accepts a signature made with the previous key; (d) never an unrelated one', () => {
    const ring = [NEW_KEY, OLD_KEY];
    expect(verifyWsHmac(envelope(OLD_KEY, 'tenant:a'), ring, undefined, 'tenant:a').ok).toBe(true);
    expect(verifyWsHmac(envelope(NEW_KEY, 'tenant:a'), ring, undefined, 'tenant:a').ok).toBe(true);
    expect(verifyWsHmac(envelope(UNRELATED, 'tenant:a'), ring, undefined, 'tenant:a').ok).toBe(false);
    // Channel binding is untouched by the ring: wrong channel still fails.
    expect(verifyWsHmac(envelope(OLD_KEY, 'tenant:a'), ring, undefined, 'tenant:b').ok).toBe(false);
  });
  it('(c) bindWsSignatureToChannel re-signs with the PRIMARY even when the envelope arrived under the previous key', () => {
    const ring = [NEW_KEY, OLD_KEY];
    const bound = bindWsSignatureToChannel(envelope(OLD_KEY), 'tenant:a', ring);
    expect(verifyWsHmac(bound, NEW_KEY, undefined, 'tenant:a').ok).toBe(true);
    expect(verifyWsHmac(bound, OLD_KEY, undefined, 'tenant:a').ok).toBe(false);
  });
  it('bindWsSignatureToChannel still refuses to mint for an envelope no ring key verifies', () => {
    const forged = envelope(UNRELATED);
    expect(bindWsSignatureToChannel(forged, 'tenant:a', [NEW_KEY, OLD_KEY])).toBe(forged);
  });
  it('WebsocketSignerService signs with the PRIMARY only', () => {
    withKeys(NEW_KEY, OLD_KEY, () => {
      const signed = new WebsocketSignerService().signMessage('OVERRIDE', { severity: 'LOCKDOWN' }, 'tenant:a');
      expect(verifyWsHmac(signed, NEW_KEY, undefined, 'tenant:a').ok).toBe(true);
      expect(verifyWsHmac(signed, OLD_KEY, undefined, 'tenant:a').ok).toBe(false);
    });
  });
});

// ── Device JWT verifiers (pure, no DB) ───────────────────────────────────────
const SCREEN = '11111111-1111-4111-8111-111111111111';
const deviceToken = (key: string) =>
  jwt.sign({ sub: SCREEN, deviceId: SCREEN, kind: 'device', tenantId: 't1' }, key, {
    algorithm: DEVICE_JWT_ALGORITHMS[0],
    expiresIn: '1h',
  });
const reqWith = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any;

contract(
  'decodeDeviceBearer (HTTP device auth)',
  deviceToken,
  (t) => decodeDeviceBearer(reqWith(t), SCREEN).ok,
);
describe('verifiedDeviceSubject (per-device throttle key)', () => {
  // A fresh token per assertion: the helper memoises ACCEPTED tokens for 60 s
  // by token hash, so re-verifying the same bytes would answer from the memo.
  const fresh = (key: string) =>
    jwt.sign({ sub: SCREEN, kind: 'device', n: crypto.randomUUID() }, key, { algorithm: 'HS256', expiresIn: '1h' });
  const subjectOf = (t: string) => verifiedDeviceSubject(reqWith(t));
  it('(a) previous unset: old-key token has no device identity; (d) nor an unrelated one', () => {
    withKeys(NEW_KEY, undefined, () => {
      expect(subjectOf(fresh(NEW_KEY))).toBe(SCREEN);
      expect(subjectOf(fresh(OLD_KEY))).toBeNull();
      expect(subjectOf(fresh(UNRELATED))).toBeNull();
    });
  });
  it('(b) old-key token resolves during the window; (d) unrelated still null', () => {
    withKeys(NEW_KEY, OLD_KEY, () => {
      expect(subjectOf(fresh(OLD_KEY))).toBe(SCREEN);
      expect(subjectOf(fresh(NEW_KEY))).toBe(SCREEN);
      expect(subjectOf(fresh(UNRELATED))).toBeNull();
    });
  });
});

// ── HMAC consumers of DEVICE_SECRET_KEY ──────────────────────────────────────
const mintUnderKey = <T>(key: string, mint: () => T): T => {
  const p = process.env.DEVICE_SECRET_KEY;
  const pp = process.env.DEVICE_SECRET_KEY_PREVIOUS;
  process.env.DEVICE_SECRET_KEY = key;
  delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
  try {
    return mint();
  } finally {
    process.env.DEVICE_SECRET_KEY = p as string;
    if (pp === undefined) delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
    else process.env.DEVICE_SECRET_KEY_PREVIOUS = pp;
  }
};

contract(
  'stream ticket (screens/stream-ticket.ts)',
  (key) => mintUnderKey(key, () => mintStreamTicket(SCREEN, 0).ticket),
  (t) => verifyStreamTicket(t).ok,
);

contract(
  'render capability (proxy/render-capability.ts, no PROXY_RENDER_SECRET)',
  (key) =>
    mintUnderKey(
      key,
      () =>
        mintRenderCapability({ url: 'https://example.com/board', tenantId: 't1', principalKind: 'device', principalId: SCREEN })
          .capability,
    ),
  (c) => verifyRenderCapability(c, 'https://example.com/board').ok,
);

contract(
  'beacon capability (sports/beacon-capability.ts, no SPORTS_BEACON_SECRET)',
  (key) => mintUnderKey(key, () => mintBeaconCapability({ gameId: 'g1', scope: 'impression', screenId: SCREEN }).capability),
  (c) => verifyBeaconCapability(c, { gameId: 'g1', scope: 'impression' }).ok,
);

contract(
  'sports feed token, bare v0 (sports/sports-feed-token.ts, no SPORTS_FEED_SECRET)',
  (key) => mintUnderKey(key, () => makeFeedToken('game-1')),
  (t) => verifyFeedToken('game-1', t),
);
contract(
  'sports feed token, structured (versioned + ttl)',
  (key) => mintUnderKey(key, () => makeFeedToken('game-1', { version: 2, ttlSeconds: 600 })),
  (t) => verifyFeedToken('game-1', t, 2),
);
contract(
  'sports console token (sports/sports-console-token.ts, no SPORTS_CONSOLE_SECRET)',
  (key) => mintUnderKey(key, () => makeConsoleToken('a1b2c3d4-0000-4000-8000-000000000001')),
  (t) => verifyConsoleToken('a1b2c3d4-0000-4000-8000-000000000001', t),
);

describe('dedicated secrets are NOT widened by the DEVICE_SECRET_KEY window', () => {
  it('a render capability minted under DEVICE_SECRET_KEY is refused once PROXY_RENDER_SECRET is set, window or not', () => {
    let cap = '';
    withKeys(OLD_KEY, undefined, () => {
      cap = mintRenderCapability({ url: 'https://x.test/', tenantId: null, principalKind: 'user', principalId: 'u1' }).capability;
    });
    process.env.PROXY_RENDER_SECRET = 'dedicated_render_secret_0123456789';
    try {
      withKeys(NEW_KEY, OLD_KEY, () => {
        expect(verifyRenderCapability(cap, 'https://x.test/').ok).toBe(false);
      });
    } finally {
      delete process.env.PROXY_RENDER_SECRET;
    }
  });
});

// ── OTA helpers that take `env` explicitly ───────────────────────────────────
const fcRelease = {
  versionName: '1.1.25-field.1',
  versionCode: 10125,
  sha256: crypto.createHash('sha256').update('bytes').digest('hex'),
  size: 5,
  sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/1',
};
const TENANT = '22222222-2222-4222-8222-222222222222';
const fcNow = Date.now();
const fcEnv = (primary: string, previous?: string): NodeJS.ProcessEnv => ({
  PLAYER_APK_FIELD_CANDIDATE: fcRelease.versionName,
  PLAYER_APK_FIELD_TENANT_ID: TENANT,
  PLAYER_APK_FIELD_SCREEN_IDS: SCREEN,
  PLAYER_APK_FIELD_EXPIRES_AT: new Date(fcNow + 60_000).toISOString(),
  DEVICE_SECRET_KEY: primary,
  ...(previous ? { DEVICE_SECRET_KEY_PREVIOUS: previous } : {}),
});

describe('field-candidate ticket (player-ota/field-candidate.ts)', () => {
  const mintWith = (key: string) => mintFieldTicket(fcRelease, SCREEN, TENANT, fcEnv(key), fcNow)!;
  const ok = (t: string, env: NodeJS.ProcessEnv) => verifyFieldTicket(t, fcRelease, env, fcNow) !== null;
  it('(a) previous unset: old-key ticket refused', () => {
    expect(ok(mintWith(NEW_KEY), fcEnv(NEW_KEY))).toBe(true);
    expect(ok(mintWith(OLD_KEY), fcEnv(NEW_KEY))).toBe(false);
  });
  it('(b) old-key ticket verifies during the window; (c) a window ticket is minted on the primary', () => {
    expect(ok(mintWith(OLD_KEY), fcEnv(NEW_KEY, OLD_KEY))).toBe(true);
    const underWindow = mintFieldTicket(fcRelease, SCREEN, TENANT, fcEnv(NEW_KEY, OLD_KEY), fcNow)!;
    expect(ok(underWindow, fcEnv(NEW_KEY))).toBe(true);
    expect(ok(underWindow, fcEnv(OLD_KEY))).toBe(false);
  });
  it('(d) unrelated key refused either way', () => {
    expect(ok(mintWith(UNRELATED), fcEnv(NEW_KEY))).toBe(false);
    expect(ok(mintWith(UNRELATED), fcEnv(NEW_KEY, OLD_KEY))).toBe(false);
  });
});

describe('APK download tag (player-ota/download-tag.ts)', () => {
  const env = (primary: string, previous?: string): NodeJS.ProcessEnv => ({
    DEVICE_SECRET_KEY: primary,
    ...(previous ? { DEVICE_SECRET_KEY_PREVIOUS: previous } : {}),
  });
  const mintWith = (key: string) => signDownloadTag('screen_abc', 10125, env(key))!;
  it('(a) previous unset: old-key tag refused', () => {
    expect(verifyDownloadTag(mintWith(NEW_KEY), 10125, env(NEW_KEY))).toBe('screen_abc');
    expect(verifyDownloadTag(mintWith(OLD_KEY), 10125, env(NEW_KEY))).toBe('');
  });
  it('(b) old-key tag verifies during the window; (c) a window tag is signed with the primary', () => {
    expect(verifyDownloadTag(mintWith(OLD_KEY), 10125, env(NEW_KEY, OLD_KEY))).toBe('screen_abc');
    const underWindow = signDownloadTag('screen_abc', 10125, env(NEW_KEY, OLD_KEY))!;
    expect(verifyDownloadTag(underWindow, 10125, env(NEW_KEY))).toBe('screen_abc');
    expect(verifyDownloadTag(underWindow, 10125, env(OLD_KEY))).toBe('');
  });
  it('(d) unrelated key refused either way', () => {
    expect(verifyDownloadTag(mintWith(UNRELATED), 10125, env(NEW_KEY))).toBe('');
    expect(verifyDownloadTag(mintWith(UNRELATED), 10125, env(NEW_KEY, OLD_KEY))).toBe('');
  });
});

// ── Clever OAuth state envelope ──────────────────────────────────────────────
describe('Clever OAuth state (integrations/clever/clever.service.ts)', () => {
  const svc = new CleverService({} as any, {} as any, {} as any, {} as any);
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
  beforeAll(() => {
    process.env.CLEVER_CLIENT_ID = 'client-id-for-test';
  });
  const mintWith = (key: string) =>
    mintUnderKey(key, () => stateOf(svc.buildAuthorizeUrl('tenant-1', 'https://api.test/cb').url));
  const ok = (state: string) => {
    try {
      return svc.decodeState(state).tenantId === 'tenant-1';
    } catch {
      return false;
    }
  };
  it('(a)/(b)/(c)/(d) follow the ring', () => {
    withKeys(NEW_KEY, undefined, () => {
      expect(ok(mintWith(NEW_KEY))).toBe(true);
      expect(ok(mintWith(OLD_KEY))).toBe(false);
      expect(ok(mintWith(UNRELATED))).toBe(false);
    });
    let underWindow = '';
    withKeys(NEW_KEY, OLD_KEY, () => {
      expect(ok(mintWith(OLD_KEY))).toBe(true);
      expect(ok(mintWith(UNRELATED))).toBe(false);
      underWindow = stateOf(svc.buildAuthorizeUrl('tenant-1', 'https://api.test/cb').url);
    });
    withKeys(NEW_KEY, undefined, () => expect(ok(underWindow)).toBe(true));
    withKeys(OLD_KEY, undefined, () => expect(ok(underWindow)).toBe(false));
  });
});
