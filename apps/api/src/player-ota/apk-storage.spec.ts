/**
 * apk-storage.spec.ts
 *
 * Locks the P0-5 APK-delivery decision (efficiency audit 2026-09-02): the
 * versioned OTA endpoints 302 to a short-lived signed URL for an immutable
 * object in a PRIVATE bucket when one exists AND its recorded digest matches
 * the digest the API vouches for — and keep piping the bytes themselves in
 * every other case.
 *
 * The properties these tests exist to defend:
 *
 *   - FAIL-SAFE. Every uncertainty resolves to the proxy — the path that
 *     works today. A release published before the bucket existed, an
 *     unreachable bucket, a garbled sidecar, a signing failure, an
 *     unobtainable digest and the kill switch must all keep the fleet
 *     updating.
 *   - THE API IS THE TRUST ANCHOR. The bucket's `.sha256` sidecar is only
 *     ever CROSS-CHECKED against the API's own digest; it is never a source
 *     of one. A compromised bucket that serves a different binary with a
 *     matching sidecar must still be refused. And an empty expected-sha is
 *     "unknown", not "no verification required" — the one bug in this file
 *     that could silently stall OTA fleet-wide.
 *   - THE OBJECT LAYOUT IS A CONTRACT shared with
 *     scripts/upload-apks-to-storage.mjs and the release workflow. If the
 *     path shape drifts on one side, every kiosk quietly falls back to the
 *     proxy and the egress win evaporates with no error anywhere. These
 *     tests are the only thing holding the three in sync.
 *   - ROLLBACK STILL WORKS. Delivery is a pure function of (kind,
 *     versionCode); this module holds no "latest" pointer, so re-advertising
 *     an older versionCode is still all a rollback takes.
 *   - THE SIGNED URL OUTLIVES ITS HANDOUT WINDOW. A URL that can expire
 *     mid-download is how this pattern classically fails.
 */

import {
  APK_DELIVERY_MEMO_TTL_MS,
  APK_SIGNED_URL_TTL_SECONDS,
  __resetApkDeliveryMemoForTests,
  absoluteSignedUrl,
  apkAuthenticatedObjectUrl,
  apkBucketName,
  apkDownloadFilename,
  apkObjectPath,
  apkSidecarPath,
  apkStorageEnabled,
  parseSidecarSha,
  resolveApkDelivery,
  versionNameFromCode,
  type ApkStorageRedis,
} from './apk-storage';
import { DOWNLOAD_TAG_PARAM, signDownloadTag, verifyDownloadTag } from './download-tag';

const SUPABASE = 'https://proj.supabase.co';
const SERVICE_KEY = 'service-role-key';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const OBJECT = `${SUPABASE}/storage/v1/object/apks/player/v10112/edu-cms-player-v1.1.12.apk`;
const SIDECAR = `${OBJECT}.sha256`;
const SIGN = `${SUPABASE}/storage/v1/object/sign/apks/player/v10112/edu-cms-player-v1.1.12.apk`;
const SIGNED_REL = '/object/sign/apks/player/v10112/edu-cms-player-v1.1.12.apk?token=jwt.tok.en';

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SUPABASE_URL: SUPABASE,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

interface FakeRoute { status: number; body?: string }

/**
 * Minimal fetch double. Records every call so a test can assert the probe
 * ran exactly once across N downloads (the memoization contract) and that
 * the private-bucket reads are authenticated.
 */
function fakeFetch(routes: Record<string, FakeRoute>) {
  const calls: Array<{ url: string; method: string; auth: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, method: init?.method || 'GET', auth: headers.Authorization || '' });
    const route = routes[url] ?? { status: 404 };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => route.body ?? '',
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Sidecar, object and signing endpoint all healthy for `player` v10112. */
function healthyRoutes(sha = SHA_A): Record<string, FakeRoute> {
  return {
    [OBJECT]: { status: 200 },
    [SIDECAR]: { status: 200, body: `${sha}  edu-cms-player-v1.1.12.apk\n` },
    [SIGN]: { status: 200, body: JSON.stringify({ signedURL: SIGNED_REL }) },
  };
}

function resolve(overrides: Partial<Parameters<typeof resolveApkDelivery>[0]> = {}) {
  return resolveApkDelivery({
    kind: 'player',
    versionCode: 10112,
    expectedSha: async () => SHA_A,
    env: env(),
    ...overrides,
  });
}

beforeEach(() => __resetApkDeliveryMemoForTests());

describe('object layout — the contract shared with CI and the backfill script', () => {
  it('keys the object by versionCode and names it after the release asset', () => {
    expect(apkObjectPath('player', 10112)).toBe('player/v10112/edu-cms-player-v1.1.12.apk');
    expect(apkObjectPath('manager', 10024)).toBe('manager/v10024/edu-cms-manager-v1.0.24.apk');
  });

  it('puts the sha256 sidecar beside the APK, not in a parallel tree', () => {
    expect(apkSidecarPath('player', 10112)).toBe(`${apkObjectPath('player', 10112)}.sha256`);
  });

  it('defaults to the apks bucket and honours an override for a staging project', () => {
    expect(apkBucketName(env())).toBe('apks');
    expect(apkBucketName(env({ PLAYER_APK_STORAGE_BUCKET: 'apks-staging' }))).toBe('apks-staging');
  });

  it('reads the private bucket through the AUTHENTICATED object route', () => {
    expect(apkAuthenticatedObjectUrl(apkObjectPath('player', 10112), env())).toBe(OBJECT);
    // Never the /object/public/ route — the bucket is private on purpose.
    expect(apkAuthenticatedObjectUrl(apkObjectPath('player', 10112), env())).not.toContain('/public/');
  });

  it('tolerates a trailing slash on SUPABASE_URL', () => {
    expect(apkAuthenticatedObjectUrl(apkObjectPath('player', 10112), env({ SUPABASE_URL: `${SUPABASE}/` }))).toBe(OBJECT);
  });

  it('is null when no Supabase project is configured', () => {
    expect(apkAuthenticatedObjectUrl('x', {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('absoluteSignedUrl', () => {
  /**
   * 2026-05-26 — operator: "the apk downloads as edu cms player from
   * settings, that should say VenueOS Player". The proxy sets that filename
   * in Content-Disposition; a redirect would otherwise leak the storage
   * object's name to the operator's browser.
   */
  it('preserves the operator-facing download filename through the redirect', () => {
    expect(apkDownloadFilename('player', 10112)).toBe('venue-os-player-vc10112.apk');
    expect(absoluteSignedUrl(SIGNED_REL, 'venue-os-player-vc10112.apk', env()))
      .toBe(`${SUPABASE}/storage/v1${SIGNED_REL}&download=venue-os-player-vc10112.apk`);
  });

  it('normalises a relative URL with no leading slash', () => {
    expect(absoluteSignedUrl('object/sign/apks/a?token=t', 'f.apk', env()))
      .toBe(`${SUPABASE}/storage/v1/object/sign/apks/a?token=t&download=f.apk`);
  });

  it('does not double the /storage/v1 prefix when Storage already included it', () => {
    const out = absoluteSignedUrl('/storage/v1/object/sign/apks/a?token=t', 'f.apk', env()) || '';
    expect(out.match(/\/storage\/v1/g)).toHaveLength(1);
  });
});

describe('versionNameFromCode — the Gradle/API encoding, shared with the pin lookup', () => {
  it('decodes the repo formula', () => {
    expect(versionNameFromCode(10112)).toBe('1.1.12');
    expect(versionNameFromCode(10024)).toBe('1.0.24');
    expect(versionNameFromCode(20105)).toBe('2.1.5');
  });
});

describe('parseSidecarSha', () => {
  it('reads the shasum two-field form', () => {
    expect(parseSidecarSha(`${SHA_A}  edu-cms-player-v1.1.12.apk\n`)).toBe(SHA_A);
  });

  it('reads a bare digest', () => {
    expect(parseSidecarSha(`${SHA_A}\n`)).toBe(SHA_A);
  });

  it('lowercases', () => {
    expect(parseSidecarSha('A'.repeat(64))).toBe(SHA_A);
  });

  it('refuses anything that is not a 64-hex digest', () => {
    expect(parseSidecarSha('')).toBeNull();
    expect(parseSidecarSha('not a digest')).toBeNull();
    expect(parseSidecarSha('a'.repeat(63))).toBeNull();
    expect(parseSidecarSha('{"error":"not found"}')).toBeNull();
  });
});

describe('apkStorageEnabled — the kill switch is subtractive only', () => {
  it('is on when a project and its service key are configured', () => {
    expect(apkStorageEnabled(env())).toBe(true);
  });

  it('is off with no project', () => {
    expect(apkStorageEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is off with no service key — the bucket is private, reads must be authenticated', () => {
    expect(apkStorageEnabled({ SUPABASE_URL: SUPABASE } as NodeJS.ProcessEnv)).toBe(false);
  });

  it.each(['off', 'OFF', 'false', '0'])('is off when the switch says %s', (flag) => {
    expect(apkStorageEnabled(env({ PLAYER_APK_STORAGE_REDIRECT: flag }))).toBe(false);
  });

  it('stays on for any other value — it can only ever subtract', () => {
    expect(apkStorageEnabled(env({ PLAYER_APK_STORAGE_REDIRECT: 'on' }))).toBe(true);
  });
});

describe('resolveApkDelivery — redirect when the object is present and verified', () => {
  it('302s to a signed URL when the sidecar matches the API digest', async () => {
    const { impl } = fakeFetch(healthyRoutes());
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.mode).toBe('redirect');
    expect(delivery.reason).toBe('storage-verified');
    expect(delivery.url).toBe(`${SUPABASE}/storage/v1${SIGNED_REL}&download=venue-os-player-vc10112.apk`);
  });

  it('authenticates every private-bucket call with the service-role key', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    await resolve({ fetchImpl: impl });
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.auth).toBe(`Bearer ${SERVICE_KEY}`);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'HEAD', 'POST']);
  });

  it('asks for a signed URL that long outlives the window it is handed out in', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    await resolve({ fetchImpl: impl });
    const signCall = calls.find((c) => c.method === 'POST');
    expect(signCall?.url).toBe(SIGN);
    // A URL minted at T is served until T+memo and must stay valid well
    // past that, or a kiosk on a slow link can be handed one that dies
    // mid-download. 1 h vs 5 min.
    expect(APK_SIGNED_URL_TTL_SECONDS * 1000).toBeGreaterThan(APK_DELIVERY_MEMO_TTL_MS * 4);
  });

  it('matches case-insensitively (an uppercase committed pin is still a match)', async () => {
    const { impl } = fakeFetch(healthyRoutes());
    const delivery = await resolve({ fetchImpl: impl, expectedSha: async () => SHA_A.toUpperCase() });
    expect(delivery.mode).toBe('redirect');
  });

  /**
   * Rollback: the fleet is rolled back by advertising an older versionCode.
   * Delivery is a pure function of (kind, versionCode), so that older build
   * addresses its own immutable object — no separate rollback plumbing, and
   * nothing in this module can pin the fleet to a version.
   */
  it('addresses each versionCode independently, so a rollback target resolves too', async () => {
    const olderObject = `${SUPABASE}/storage/v1/object/apks/player/v10111/edu-cms-player-v1.1.11.apk`;
    const olderSign = `${SUPABASE}/storage/v1/object/sign/apks/player/v10111/edu-cms-player-v1.1.11.apk`;
    const { impl } = fakeFetch({
      [olderObject]: { status: 200 },
      [`${olderObject}.sha256`]: { status: 200, body: SHA_B },
      [olderSign]: { status: 200, body: JSON.stringify({ signedURL: '/object/sign/apks/player/v10111/x?token=t' }) },
    });
    const delivery = await resolve({ fetchImpl: impl, versionCode: 10111, expectedSha: async () => SHA_B });
    expect(delivery.mode).toBe('redirect');
    expect(delivery.url).toContain('/v10111/');
  });
});

describe('resolveApkDelivery — proxy fallback, the fail-safe direction', () => {
  it('proxies when the release was never uploaded (no sidecar)', async () => {
    const { impl } = fakeFetch({});
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.mode).toBe('proxy');
    expect(delivery.url).toBeNull();
    expect(delivery.reason).toBe('sidecar-http-404');
  });

  it('proxies when the sidecar is present but the APK object is missing', async () => {
    const routes = healthyRoutes();
    delete routes[OBJECT];
    const { impl } = fakeFetch(routes);
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.reason).toBe('object-http-404');
  });

  it('proxies when the sidecar body is not a digest (an error payload, say)', async () => {
    const routes = healthyRoutes();
    routes[SIDECAR] = { status: 200, body: '{"error":"Object not found"}' };
    const { impl } = fakeFetch(routes);
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.reason).toBe('sidecar-unparseable');
  });

  /**
   * THE LOUD ONE, and the reason the sidecar is a cross-check rather than a
   * source. A bucket that serves different bytes WITH a matching sidecar is
   * exactly the compromise this refuses: the API's digest wins, always.
   * Redirecting anyway would not install anything bad (the device sha-checks
   * what it wrote to disk) but it WOULD stall OTA silently — the failure
   * class the player rules exist to prevent.
   */
  it('proxies — and logs at error — when storage disagrees with the API digest', async () => {
    const { impl } = fakeFetch(healthyRoutes(SHA_B));
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const delivery = await resolve({ fetchImpl: impl, logger, expectedSha: async () => SHA_A });
    expect(delivery.mode).toBe('proxy');
    expect(delivery.reason).toBe('sha-mismatch');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain('DISAGREES');
  });

  it('never signs a URL for an object it refused', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes(SHA_B));
    await resolve({ fetchImpl: impl, expectedSha: async () => SHA_A });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  /**
   * An empty expected-sha means "we could not establish a digest" (GitHub
   * down, GH_TOKEN expired). It must never read as a waiver.
   */
  it('proxies when the API has no digest of its own', async () => {
    const { impl } = fakeFetch(healthyRoutes());
    const delivery = await resolve({ fetchImpl: impl, expectedSha: async () => '' });
    expect(delivery.mode).toBe('proxy');
    expect(delivery.reason).toBe('expected-sha-unavailable');
  });

  it('proxies when the digest lookup throws', async () => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const { impl } = fakeFetch(healthyRoutes());
    const delivery = await resolve({
      fetchImpl: impl,
      logger,
      expectedSha: async () => { throw new Error('github 502'); },
    });
    expect(delivery.reason).toBe('expected-sha-unavailable');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('proxies when the bucket is unreachable', async () => {
    const impl = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.mode).toBe('proxy');
    expect(delivery.reason).toBe('sidecar-unreachable');
  });

  it('proxies when signing fails', async () => {
    const routes = healthyRoutes();
    routes[SIGN] = { status: 500 };
    const { impl } = fakeFetch(routes);
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.reason).toBe('sign-http-500');
  });

  it('proxies when the signing response has no URL in it', async () => {
    const routes = healthyRoutes();
    routes[SIGN] = { status: 200, body: '{}' };
    const { impl } = fakeFetch(routes);
    const delivery = await resolve({ fetchImpl: impl });
    expect(delivery.reason).toBe('sign-no-url');
  });

  it('proxies with no network call at all when Supabase is unconfigured', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    const delivery = await resolve({ fetchImpl: impl, env: {} as NodeJS.ProcessEnv });
    expect(delivery.mode).toBe('proxy');
    expect(delivery.reason).toBe('storage-unconfigured');
    expect(calls).toHaveLength(0);
  });

  it('proxies immediately when the kill switch is thrown', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    const delivery = await resolve({ fetchImpl: impl, env: env({ PLAYER_APK_STORAGE_REDIRECT: 'off' }) });
    expect(delivery.mode).toBe('proxy');
    expect(delivery.reason).toBe('storage-disabled');
    expect(calls).toHaveLength(0);
  });
});

describe('resolveApkDelivery — memoization (probe + sign once per 5-min window)', () => {
  it('probes and signs once across many downloads of the same version', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    for (let i = 0; i < 5; i++) {
      expect((await resolve({ fetchImpl: impl })).mode).toBe('redirect');
    }
    // sidecar GET + object HEAD + sign POST, for five downloads. Handing the
    // SAME signed URL to every device in the window is also the only way
    // Storage's CDN can reuse one cache entry across the fleet.
    expect(calls).toHaveLength(3);
  });

  it('memoizes the negative verdict too — a fleet push against an un-uploaded build must not re-probe per device', async () => {
    const { impl, calls } = fakeFetch({});
    for (let i = 0; i < 4; i++) {
      expect((await resolve({ fetchImpl: impl })).mode).toBe('proxy');
    }
    expect(calls).toHaveLength(1);
  });

  it('re-probes after the window expires — a backfill takes effect within 5 minutes', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    let clock = 1_000_000;
    await resolve({ fetchImpl: impl, now: () => clock });
    clock += APK_DELIVERY_MEMO_TTL_MS + 1;
    await resolve({ fetchImpl: impl, now: () => clock });
    expect(calls).toHaveLength(6);
  });

  it('does NOT memoize a transient digest failure — a GitHub blip must not pin 5 minutes of proxying', async () => {
    const { impl } = fakeFetch(healthyRoutes());
    let shaAvailable = false;
    const call = () => resolve({ fetchImpl: impl, expectedSha: async () => (shaAvailable ? SHA_A : '') });
    expect((await call()).mode).toBe('proxy');
    shaAvailable = true;
    expect((await call()).mode).toBe('redirect');
  });

  it('shares the verdict across replicas via Redis', async () => {
    const store = new Map<string, string>();
    const redis: ApkStorageRedis = {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => { store.set(k, v); return 'OK'; },
    };
    const first = fakeFetch(healthyRoutes());
    await resolve({ fetchImpl: first.impl, redis });
    expect(store.size).toBe(1);

    // A second replica: empty in-memory memo, same Redis, no storage calls.
    __resetApkDeliveryMemoForTests();
    const second = fakeFetch({});
    const delivery = await resolve({ fetchImpl: second.impl, redis });
    expect(delivery.mode).toBe('redirect');
    expect(second.calls).toHaveLength(0);
  });

  it('falls back to probing when Redis is down', async () => {
    const redis: ApkStorageRedis = {
      get: async () => { throw new Error('redis down'); },
      set: async () => { throw new Error('redis down'); },
    };
    const { impl } = fakeFetch(healthyRoutes());
    expect((await resolve({ fetchImpl: impl, redis })).mode).toBe('redirect');
  });

  it('ignores a corrupt Redis payload rather than trusting it', async () => {
    const redis: ApkStorageRedis = { get: async () => '{"mode":"teleport"}', set: async () => 'OK' };
    const { impl } = fakeFetch(healthyRoutes());
    const delivery = await resolve({ fetchImpl: impl, redis });
    expect(delivery.mode).toBe('redirect');
    expect(delivery.reason).toBe('storage-verified');
  });

  it('keys the memo per kind — a Player verdict never answers for Manager', async () => {
    const { impl } = fakeFetch(healthyRoutes()); // Manager was never uploaded.
    expect((await resolve({ fetchImpl: impl })).mode).toBe('redirect');
    const manager = await resolve({ fetchImpl: impl, kind: 'manager', versionCode: 10024 });
    expect(manager.mode).toBe('proxy');
  });
});

/**
 * download-tag: the per-download screen attribution the fleet can carry
 * TODAY, because `/update-check` stamps it onto the advertised URL and the
 * Kotlin workers use that URL verbatim. It is a LOG FIELD. If a future
 * change makes it decide anything, read the header of download-tag.ts first.
 */
describe('download tag — telemetry only, signed so the log cannot be poisoned', () => {
  const tagEnv = { DEVICE_SECRET_KEY: 'x'.repeat(64) } as NodeJS.ProcessEnv;

  it('round-trips a screen id', () => {
    const tag = signDownloadTag('scr_abc123', 10112, tagEnv);
    expect(tag).toBeTruthy();
    expect(verifyDownloadTag(tag, 10112, tagEnv)).toBe('scr_abc123');
  });

  it('is URL-safe, so it survives being appended to the advertised apkUrl', () => {
    const tag = signDownloadTag('scr_abc123', 10112, tagEnv) || '';
    expect(encodeURIComponent(tag)).toBe(tag);
    expect(DOWNLOAD_TAG_PARAM).toBe('dl');
  });

  it('refuses a forged signature', () => {
    expect(verifyDownloadTag('scr_abc123.0000000000000000', 10112, tagEnv)).toBe('');
  });

  it('is bound to the versionCode it was minted for', () => {
    const tag = signDownloadTag('scr_abc123', 10112, tagEnv);
    expect(verifyDownloadTag(tag, 10111, tagEnv)).toBe('');
  });

  it('yields no attribution rather than throwing on junk input', () => {
    for (const junk of [undefined, null, '', 'nodot', '.abc', 42, { id: 'x' }, 'a'.repeat(500)]) {
      expect(verifyDownloadTag(junk, 10112, tagEnv)).toBe('');
    }
  });

  it('mints nothing when there is no screen or no secret — the URL stays as it is today', () => {
    expect(signDownloadTag(null, 10112, tagEnv)).toBeNull();
    expect(signDownloadTag('', 10112, tagEnv)).toBeNull();
    expect(signDownloadTag('scr_abc123', 10112, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('refuses an id that is not a plain opaque token', () => {
    expect(signDownloadTag('scr/../../etc', 10112, tagEnv)).toBeNull();
    expect(verifyDownloadTag('scr/evil.0000000000000000', 10112, tagEnv)).toBe('');
  });
});
