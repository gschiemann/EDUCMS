/**
 * apk-storage.ts — the object-storage delivery path for fleet APKs.
 *
 * ============================================================
 * WHY (efficiency audit 2026-09-02, P0-5)
 * ============================================================
 *
 * Every Player and Manager APK the fleet installs is currently PIPED
 * THROUGH THE RAILWAY API: `/apk/v/:vc` pulls the asset from the private
 * GitHub Release with GH_TOKEN, buffers the whole ~2 MB binary in process
 * memory (`versionedApkCache`, 5-entry LRU), and `res.end(buf)` writes it
 * back out. Railway bills that write. The cache is process-local, so every
 * deploy makes it cold again, and a fleet-wide push means N devices x the
 * full binary out of one container that is ALSO the emergency-delivery
 * path (CLAUDE.md: "The life-safety API should remain lightweight and
 * predictable").
 *
 * This module moves the BYTES to Supabase object storage and leaves every
 * DECISION on the API. `/apk/v/:vc` becomes a 302 to a short-lived signed
 * URL for an immutable object; the proxy stays as the fallback for every
 * version that was published before the bucket existed.
 *
 * ============================================================
 * THE BUCKET IS PRIVATE — signed URLs, not a public object
 * ============================================================
 *
 * The bucket is created with `public: false` and every download is a
 * freshly-minted signed URL (1 h). A public bucket would have been simpler
 * and CDN-friendlier, but it would also make the signed kiosk APK a
 * permanently world-readable object at a guessable URL — the one artifact
 * that must not become the thing that stays public when the GitHub repo is
 * private. Private + signed keeps our endpoint the only way in: throttled,
 * logged, and revocable by deleting the object.
 *
 * WHAT THIS DOES NOT DO IS AUTHENTICATE THE DOWNLOAD, and that is a
 * measured constraint, not an oversight. The SHIPPED downloaders —
 * `OtaUpdateWorker.dlConn`, Manager's `OtaWorker.download`,
 * `ManagerSelfUpdateWorker.download` and `ManagerBootstrap.download` — all
 * open a bare `HttpURLConnection` with nothing but timeouts on it. Not one
 * of them sends an Authorization header on the BYTE request (the device
 * token rides the `/update-check` POST only). Gating `/apk/v/:vc` on a
 * credential would therefore brick OTA for the entire installed fleet, and
 * the only way to deliver a build that could authenticate is... OTA. The
 * endpoint keeps exactly the auth posture it has today (unauthenticated,
 * throttled) — which is also the posture the byte proxy has today, so this
 * change strictly narrows exposure rather than widening it. Sequencing the
 * real fix is in the report: ship a build that sends the device token on
 * the download, wait for the fleet floor to include it, then gate.
 *
 * ============================================================
 * WHAT DOES *NOT* CHANGE — read before editing
 * ============================================================
 *
 * 1. THE SHA AUTHORITY. The digest advertised to a kiosk is still produced
 *    by the API: the committed out-of-band pin in release-policy.ts, else
 *    the hash of the bytes of the AUTHENTICATED GitHub Release asset
 *    (`shaViaProxyCache`). The `.sha256` sidecar in the bucket is NEVER a
 *    source of truth — it is only ever CROSS-CHECKED against the API's own
 *    digest, so a compromised bucket cannot serve a different binary with a
 *    matching sidecar and have it believed. Storage is a delivery mirror.
 *
 * 2. THE ROLLOUT CONTROLS. Cohort, maintenance window, canary hold,
 *    anti-rollback floor, quarantine and the signing cutover all run in
 *    `/update-check`, which decides WHETHER a version is offered at all,
 *    and the "latest" pointer stays in release-policy. This module runs
 *    later and only decides WHERE already-approved bytes come from. It
 *    holds no pointer and can never pin the fleet to a version — rollback
 *    is still "advertise the older versionCode", whose immutable object is
 *    still in the bucket.
 *
 * 3. THE DEVICE-SIDE VERIFICATION. `OtaUpdateWorker` sha256s the file it
 *    actually wrote to disk and discards a mismatch. A redirect is
 *    transparent to that check: `instanceFollowRedirects` defaults to true
 *    and is set EXPLICITLY in `ManagerBootstrap.download` and
 *    `ManagerSelfUpdateWorker.download`; `HttpURLConnection` follows
 *    same-protocol (https->https) hops on its own. The shipped fleet
 *    already relies on exactly this for the github.com ->
 *    objects.githubusercontent.com hop, which is why `HostAllowlist` pins
 *    only the FIRST hop and says so in its own comment. The first hop here
 *    stays our own API origin.
 *
 * ============================================================
 * FAIL-SAFE DIRECTION
 * ============================================================
 *
 * Every uncertainty resolves to `proxy` — the path that works today. A
 * missing object, a missing/garbled sidecar, an unreachable bucket, a
 * signing failure, an unobtainable expected digest, or a sidecar that
 * disagrees with the server's own digest all mean "serve it the old way",
 * loudly. The one thing this module must never do is redirect a kiosk at
 * bytes the server has not matched against its own digest: that would not
 * install anything bad (the device verifies), but it WOULD stall OTA
 * silently, which is the exact failure class CLAUDE.md's player rules
 * exist to prevent.
 */

/** Player or Manager — the two APKs the fleet installs. */
export type ApkKind = 'player' | 'manager';

/** Where the caller should get the bytes, and why. */
export interface ApkDelivery {
  mode: 'redirect' | 'proxy';
  /**
   * Absolute signed storage URL. Always null when `mode === 'proxy'`.
   * CARRIES A BEARER TOKEN — never log it; log `safeHost(url)` instead.
   */
  url: string | null;
  /** Short machine-greppable reason — goes straight into the log line. */
  reason: string;
}

/** The two ioredis calls this module makes. Kept minimal so tests can fake it. */
export interface ApkStorageRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

export interface ApkStorageLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ResolveApkDeliveryOptions {
  kind: ApkKind;
  versionCode: number;
  /**
   * The digest the server is willing to vouch for, resolved by the caller
   * (committed pin first, else the hash of the authenticated GitHub bytes).
   * Returning '' means "unknown" and forces the proxy path — it is NEVER
   * treated as "no verification required".
   */
  expectedSha: () => Promise<string>;
  redis?: ApkStorageRedis | null;
  logger?: ApkStorageLogger;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/** Default bucket. Overridable so a staging project can use its own. */
const DEFAULT_BUCKET = 'apks';

/**
 * Signed-URL lifetime. Deliberately MUCH longer than the memo window below:
 * a URL minted at T is handed out until T+5min and stays valid to T+60min,
 * so a kiosk on a slow link that starts its download at the very end of the
 * window still has ~55 minutes to finish. A signed URL that can expire
 * mid-download is the classic way this pattern fails; the margin is the fix.
 */
export const APK_SIGNED_URL_TTL_SECONDS = 3600;

/** Probe + signed-URL verdicts are memoized this long, in memory AND in Redis. */
export const APK_DELIVERY_MEMO_TTL_MS = 5 * 60 * 1000;

/** Storage round-trips are bounded — a hung bucket must not wedge a download. */
const PROBE_TIMEOUT_MS = 5_000;

const memoryMemo = new Map<string, { at: number; delivery: ApkDelivery }>();

/** Tests only — the module-level memo would otherwise leak between cases. */
export function __resetApkDeliveryMemoForTests(): void {
  memoryMemo.clear();
}

/**
 * versionCode -> versionName, the repo's `major*10000 + minor*100 + patch`
 * encoding (10112 -> "1.1.12"). Same formula the controller and Gradle use;
 * player-ota.spec.ts locks it.
 */
export function versionNameFromCode(versionCode: number): string {
  const major = Math.floor(versionCode / 10000);
  const minor = Math.floor((versionCode % 10000) / 100);
  const patch = versionCode % 100;
  return `${major}.${minor}.${patch}`;
}

/**
 * The immutable object path for one release. Keyed by versionCode (the
 * value every OTA surface already speaks) with the versionName in the
 * filename so a human browsing the bucket can read it:
 *
 *   player/v10112/edu-cms-player-v1.1.12.apk
 *   manager/v10024/edu-cms-manager-v1.0.24.apk
 *
 * The filename matches the GitHub Release asset name exactly, so the
 * backfill and the CI publish step cannot disagree about where a file goes.
 */
export function apkObjectPath(kind: ApkKind, versionCode: number): string {
  const versionName = versionNameFromCode(versionCode);
  return `${kind}/v${versionCode}/edu-cms-${kind}-v${versionName}.apk`;
}

/** The `.sha256` sidecar that sits beside every uploaded APK. */
export function apkSidecarPath(kind: ApkKind, versionCode: number): string {
  return `${apkObjectPath(kind, versionCode)}.sha256`;
}

/**
 * The operator-facing download filename. Preserved EXACTLY as the proxy
 * sets it (2026-05-26 — operator: "the apk downloads as edu cms player
 * from settings, that should say VenueOS Player"). Supabase honours
 * `download=<name>` on a signed URL by emitting a matching
 * Content-Disposition, so the redirect keeps the same filename the proxy
 * produced instead of leaking the storage object's name.
 */
export function apkDownloadFilename(kind: ApkKind, versionCode: number): string {
  return `venue-os-${kind}-vc${versionCode}.apk`;
}

export function apkBucketName(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PLAYER_APK_STORAGE_BUCKET || '').trim() || DEFAULT_BUCKET;
}

function supabaseBase(env: NodeJS.ProcessEnv): string {
  return (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

function serviceKey(env: NodeJS.ProcessEnv): string {
  return (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

/**
 * Storage delivery is live when a Supabase project AND its service key are
 * configured (the bucket is private — every read and every signing call is
 * authenticated) AND the kill switch has not been thrown.
 *
 * `PLAYER_APK_STORAGE_REDIRECT=off` is SUBTRACTIVE ONLY — like the
 * quarantine hook, it can only send the fleet back to the path that already
 * works, so a stale value can never strand anyone (the failure mode the
 * 2026-05-15 env-var version-pinning removal was about).
 */
export function apkStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!supabaseBase(env) || !serviceKey(env)) return false;
  const flag = (env.PLAYER_APK_STORAGE_REDIRECT || '').trim().toLowerCase();
  return flag !== 'off' && flag !== 'false' && flag !== '0';
}

/**
 * The AUTHENTICATED object URL — the private-bucket read path, used by the
 * server's own probes with the service-role key. This is never handed to a
 * client; clients only ever get a signed URL.
 */
export function apkAuthenticatedObjectUrl(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const base = supabaseBase(env);
  if (!base) return null;
  return `${base}/storage/v1/object/${apkBucketName(env)}/${path}`;
}

/** Storage's sign endpoint for one object. */
function signEndpoint(path: string, env: NodeJS.ProcessEnv): string | null {
  const base = supabaseBase(env);
  if (!base) return null;
  return `${base}/storage/v1/object/sign/${apkBucketName(env)}/${path}`;
}

/**
 * Turn the relative `signedURL` Storage returns into an absolute URL, and
 * append the operator-facing download filename. Storage returns
 * `/object/sign/<bucket>/<path>?token=…` (some versions without the leading
 * slash), so both shapes are normalised here rather than at the call site.
 */
export function absoluteSignedUrl(
  signedUrl: string,
  downloadFilename: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const base = supabaseBase(env);
  if (!base || !signedUrl) return null;
  const rel = signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`;
  const absolute = rel.startsWith('/storage/v1')
    ? `${base}${rel}`
    : `${base}/storage/v1${rel}`;
  const joiner = absolute.includes('?') ? '&' : '?';
  return `${absolute}${joiner}download=${encodeURIComponent(downloadFilename)}`;
}

/** First 64 hex chars of a `shasum -a 256` sidecar ("<sha>  <filename>"). */
export function parseSidecarSha(body: string): string | null {
  const match = /^\s*([0-9a-fA-F]{64})\b/.exec(body || '');
  return match ? match[1].toLowerCase() : null;
}

function memoKey(kind: ApkKind, versionCode: number): string {
  return `ota:apk-delivery:v1:${kind}:${versionCode}`;
}

function isDelivery(value: unknown): value is ApkDelivery {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { mode?: unknown; url?: unknown; reason?: unknown };
  return (
    (candidate.mode === 'redirect' || candidate.mode === 'proxy')
    && (typeof candidate.url === 'string' || candidate.url === null)
    && typeof candidate.reason === 'string'
  );
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, { ...init, signal: controller.signal });
    // Bound the BODY read too, not just the headers — a 200-then-stalled
    // body is the exact shape that wedged the player's manifest chain
    // (deep-audit F1). The AbortController above stays armed until the
    // text() promise settles for precisely that reason.
    const text = resp.ok && init.method !== 'HEAD' ? await resp.text() : '';
    return { ok: resp.ok, status: resp.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const key = serviceKey(env);
  return { Authorization: `Bearer ${key}`, apikey: key };
}

/**
 * Decide whether `/apk/v/:vc` should 302 to object storage or keep piping
 * the bytes itself, and mint the signed URL when it should.
 *
 * The verdict is memoized for 5 minutes in process memory and in Redis (so
 * a multi-replica API probes and signs once per window rather than once per
 * replica per download — and every device inside one window gets the SAME
 * signed URL, which is also the only way Storage's CDN can reuse a cache
 * entry across the fleet). Both a positive and a negative verdict are
 * cached: the negative so a fleet-wide push against a version that was
 * never uploaded does not re-probe on every device.
 */
export async function resolveApkDelivery(
  opts: ResolveApkDeliveryOptions,
): Promise<ApkDelivery> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger;
  const { kind, versionCode } = opts;

  const proxy = (reason: string): ApkDelivery => ({ mode: 'proxy', url: null, reason });

  // Never memoized: the check is free and the flag must take effect at once.
  if (!apkStorageEnabled(env)) {
    const configured = !!supabaseBase(env) && !!serviceKey(env);
    return proxy(configured ? 'storage-disabled' : 'storage-unconfigured');
  }

  const key = memoKey(kind, versionCode);
  const hit = memoryMemo.get(key);
  if (hit && now() - hit.at < APK_DELIVERY_MEMO_TTL_MS) return hit.delivery;

  if (opts.redis) {
    try {
      const cached = await opts.redis.get(key);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (isDelivery(parsed)) {
          memoryMemo.set(key, { at: now(), delivery: parsed });
          return parsed;
        }
      }
    } catch {
      /* Redis is an optimization here, never a dependency. */
    }
  }

  const remember = async (delivery: ApkDelivery): Promise<ApkDelivery> => {
    memoryMemo.set(key, { at: now(), delivery });
    if (opts.redis) {
      try {
        await opts.redis.set(
          key,
          JSON.stringify(delivery),
          'EX',
          Math.floor(APK_DELIVERY_MEMO_TTL_MS / 1000),
        );
      } catch {
        /* memory memo already written */
      }
    }
    return delivery;
  };

  const objectPath = apkObjectPath(kind, versionCode);
  const objectUrl = apkAuthenticatedObjectUrl(objectPath, env);
  const sidecarUrl = apkAuthenticatedObjectUrl(apkSidecarPath(kind, versionCode), env);
  const signUrl = signEndpoint(objectPath, env);
  if (!objectUrl || !sidecarUrl || !signUrl) return proxy('storage-unconfigured');

  // ── 1. The bucket's record of what these bytes are ─────────────────────
  // A CROSS-CHECK, never a source: it is compared against the API's own
  // digest below and can only ever cause a REFUSAL to redirect.
  let sidecarSha: string | null = null;
  try {
    // The uploader writes the APK FIRST and the sidecar SECOND, so a
    // readable sidecar implies a complete object. The HEAD below still
    // confirms it — once per memo window, cheap insurance against a
    // half-finished manual upload.
    const resp = await fetchBounded(fetchImpl, sidecarUrl, {
      method: 'GET',
      headers: authHeaders(env),
    });
    if (!resp.ok) return remember(proxy(`sidecar-http-${resp.status}`));
    sidecarSha = parseSidecarSha(resp.text);
    if (!sidecarSha) return remember(proxy('sidecar-unparseable'));
  } catch (e: unknown) {
    logger?.warn(`[ota][apk-delivery] sidecar probe failed kind=${kind} vc=${versionCode}: ${errMessage(e)}`);
    return remember(proxy('sidecar-unreachable'));
  }

  // ── 2. The API's own digest — the trust anchor ─────────────────────────
  // Empty means "we could not establish a digest", which is a proxy, never
  // a waiver.
  let want = '';
  try {
    want = (await opts.expectedSha()) || '';
  } catch (e: unknown) {
    logger?.warn(`[ota][apk-delivery] expected-sha lookup failed kind=${kind} vc=${versionCode}: ${errMessage(e)}`);
  }
  if (!want) {
    // Deliberately NOT memoized — a GitHub blip must not pin this version
    // to the proxy for five minutes.
    return proxy('expected-sha-unavailable');
  }

  if (want.toLowerCase() !== sidecarSha) {
    logger?.error(
      `[ota][apk-delivery][security] storage object DISAGREES with the API digest — `
      + `kind=${kind} vc=${versionCode} expected=${want.slice(0, 12)} `
      + `storage=${sidecarSha.slice(0, 12)} — serving from the proxy instead. `
      + `The bucket object is wrong or was overwritten; re-run scripts/upload-apks-to-storage.mjs.`,
    );
    return remember(proxy('sha-mismatch'));
  }

  // ── 3. The object really is there ──────────────────────────────────────
  try {
    const head = await fetchBounded(fetchImpl, objectUrl, {
      method: 'HEAD',
      headers: authHeaders(env),
    });
    if (!head.ok) return remember(proxy(`object-http-${head.status}`));
  } catch (e: unknown) {
    logger?.warn(`[ota][apk-delivery] object HEAD failed kind=${kind} vc=${versionCode}: ${errMessage(e)}`);
    return remember(proxy('object-unreachable'));
  }

  // ── 4. Mint the short-lived signed URL ─────────────────────────────────
  let signed: string | null = null;
  try {
    const resp = await fetchBounded(fetchImpl, signUrl, {
      method: 'POST',
      headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: APK_SIGNED_URL_TTL_SECONDS }),
    });
    if (!resp.ok) return remember(proxy(`sign-http-${resp.status}`));
    const payload: unknown = JSON.parse(resp.text);
    const relative = (payload as { signedURL?: unknown; signedUrl?: unknown } | null)?.signedURL
      ?? (payload as { signedUrl?: unknown } | null)?.signedUrl;
    if (typeof relative !== 'string' || !relative) return remember(proxy('sign-no-url'));
    signed = absoluteSignedUrl(relative, apkDownloadFilename(kind, versionCode), env);
  } catch (e: unknown) {
    logger?.warn(`[ota][apk-delivery] signing failed kind=${kind} vc=${versionCode}: ${errMessage(e)}`);
    return remember(proxy('sign-failed'));
  }
  if (!signed) return remember(proxy('sign-no-url'));

  return remember({ mode: 'redirect', url: signed, reason: 'storage-verified' });
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
