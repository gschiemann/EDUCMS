/**
 * release-policy.ts — the server-side controls the OTA pipeline did not
 * have: artifact-URL validation, out-of-band digest pinning, an
 * anti-rollback floor, and a per-build kill switch.
 * (Findings OTA-03, OTA-04, OTA-05 — 2026-08-03.)
 *
 * CONTEXT. There is no "publish" endpoint in this API. A `player-v*` git
 * tag triggers a workflow that attaches an APK to a GitHub Release, and the
 * server DISCOVERS it by polling the public Releases API. That is a good
 * design for tenant-facing authz — no tenant user of any role can choose
 * which bytes land on a screen — but it left the server with no opinion at
 * all about the bytes it advertises. The only version authority in the
 * entire system was "the highest-sorting non-draft `player-v*` tag GitHub
 * currently returns."
 *
 * WHY THESE LISTS ARE COMMITTED CODE AND NOT ENV VARS. Environment-variable
 * version pinning (`PLAYER_APK_LATEST_VERSION_CODE` / `PLAYER_APK_URL`) was
 * removed on 2026-05-15 after it silently pinned the whole fleet to a stale
 * build TWICE — a stale env var is invisible and its failure mode is "the
 * fleet stops updating." The lists here fail in the SAFE direction instead:
 * they can only ever REFUSE to advertise a build, never force an old one,
 * and a mistake is loud (the server logs why it declined and returns
 * `uptoDate`) rather than silent. The one env hook, PLAYER_APK_QUARANTINE,
 * has the same one-way property — it can only subtract from what is
 * offered, so a stale value cannot pin the fleet to a vulnerable build.
 */

/** Hosts allowed to serve a fleet APK. See `isAllowedApkUrl`. */
const BUILTIN_APK_HOST_ALLOWLIST = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

/** Extra hosts for a staging / on-prem mirror. Comma-separated. */
function envApkHosts(): string[] {
  return String(process.env.PLAYER_APK_HOST_ALLOWLIST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * OTA-04 — validate an APK URL before it is advertised to the fleet.
 *
 * `apkUrl` was previously taken verbatim from the GitHub JSON field
 * `browser_download_url` and handed to every kiosk with no scheme check and
 * no host allowlist. Note the release-list fetch is ANONYMOUS (no
 * Authorization header), making it the least-authenticated leg of the
 * chain: a repo rename/transfer, a mis-set `PLAYER_APK_GITHUB_REPO`, an
 * on-path proxy in front of `api.github.com`, or a response-shaping bug
 * upstream would all have had the server faithfully advertise an arbitrary
 * URL — including a plain `http:` one — to the whole fleet.
 *
 * Host matching is exact or a dot-boundary suffix, so `github.com.evil.com`
 * is refused (the same rule the player's `?api=` trust guard uses).
 */
export function isAllowedApkUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // Credentials in an artifact URL are never legitimate here and would be
  // leaked into every kiosk's logs.
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname.toLowerCase();
  const allow = [...BUILTIN_APK_HOST_ALLOWLIST, ...envApkHosts()];
  return allow.some((a) => host === a || host.endsWith(`.${a}`));
}

/**
 * OTA-05 — anti-rollback floor.
 *
 * Publishing `player-v9.9.9` containing an OLD, vulnerable build
 * downgrades the entire installed base within one poll cycle:
 * `semverGte` compares TAG NAMES and nothing establishes a monotonic floor
 * of known-good builds. Raise this whenever a build is retired for a
 * security reason; the server will then refuse to advertise anything below
 * it no matter what tag exists upstream.
 *
 * Format: bare semver, no `player-v` prefix. '0.0.0' = no floor.
 */
export const MIN_SUPPORTED_PLAYER_VERSION = '0.0.0';

/**
 * OTA-05 — per-build kill switch / quarantine denylist.
 *
 * There was previously NO recall mechanism: if a build was discovered to be
 * malicious or broken the only lever was publishing a higher tag and hoping
 * every screen polled. `canaryFleetPercent = 0` disables ALL OTA for a
 * tenant, which is an all-or-nothing instrument, not a build-specific block.
 *
 * Anything listed here is never advertised, by any path, to any screen.
 * Add the bare semver (e.g. '1.0.71'). Also accepts a runtime addition via
 * PLAYER_APK_QUARANTINE for an incident where waiting for a deploy is too
 * slow — subtractive only, so a stale value is safe.
 */
export const QUARANTINED_PLAYER_VERSIONS: readonly string[] = [];

export function quarantinedVersions(): Set<string> {
  const fromEnv = String(process.env.PLAYER_APK_QUARANTINE || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set([...QUARANTINED_PLAYER_VERSIONS, ...fromEnv]);
}

/**
 * OTA-03 — out-of-band digest pins.
 *
 * `resolveLatestPlayerReleaseSha()` fetches THE SAME URL it is about to
 * advertise and hashes whatever comes back. If the release asset is ever
 * swapped, the server obligingly hashes the NEW bytes and advertises a
 * matching digest. It is a transport-integrity check and nothing more.
 * The in-code claim that it "closes the release asset swap attack vector"
 * was false, and is corrected at the call site.
 *
 * A digest only proves provenance when it is recorded INDEPENDENTLY of the
 * artifact being verified. This map is that independent record: committed
 * to the repo at release time, reviewed like any other code change, and
 * compared against the computed digest before anything is advertised. A
 * mismatch is fail-closed and loud.
 *
 * Populate at release time:  '1.0.64': '<sha256 of the arm64 APK>'
 * An unpinned version still ships (we are not going to strand the fleet on
 * an empty map) — but it ships WITHOUT a provenance claim, and the log line
 * says so. This is the honest state of the control, not a claim that it is
 * complete.
 *
 * NOTE: the underlying problem — CI signs release APKs with a debug
 * keystore committed to a public repo — is not fixable from this file.
 * Anyone with `git clone` can still produce an APK that passes Android's
 * signature-continuity check on update. Digest pinning narrows the window;
 * release-signing with a non-public key closes it.
 */
export const PLAYER_RELEASE_SHA_PINS: Readonly<Record<string, string>> = {};

/**
 * The committed pins, plus any supplied at runtime as
 * `PLAYER_APK_SHA_PINS="1.0.71=<sha256>,1.0.72=<sha256>"`.
 *
 * The env hook exists for an incident where waiting for a deploy is too
 * slow, and it fails in the SAFE direction: a wrong or stale pin makes the
 * server DECLINE to advertise that build (loudly), it can never cause a
 * bad build to be advertised. That is the same one-way property the
 * quarantine list has, and it is why these hooks are acceptable where the
 * 2026-05-15 version-pinning env vars were not.
 */
export function shaPins(): Record<string, string> {
  const merged: Record<string, string> = { ...PLAYER_RELEASE_SHA_PINS };
  for (const pair of String(process.env.PLAYER_APK_SHA_PINS || '').split(',')) {
    const [v, sha] = pair.split('=').map((s) => s.trim());
    if (v && sha) merged[v] = sha;
  }
  return merged;
}

export type ReleaseGateVerdict =
  | { allowed: true; pinned: boolean }
  | { allowed: false; reason: string };

/** Compare 3-part semver, `a >= b`. Unparseable parts read as 0. */
function semverGteLocal(a: string, b: string): boolean {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/**
 * The single gate every advertised Player build passes through: URL shape,
 * anti-rollback floor, quarantine, and digest pin.
 *
 * `computedSha` is the server-computed digest (may be empty when it could
 * not be computed — the caller already fails closed on that separately).
 */
export function evaluateReleaseForFleet(opts: {
  versionName: string;
  apkUrl: string;
  computedSha: string;
  /** Override the pin source. Tests only — production reads `shaPins()`. */
  pins?: Record<string, string>;
}): ReleaseGateVerdict {
  const { versionName, apkUrl, computedSha } = opts;

  if (!isAllowedApkUrl(apkUrl)) {
    return { allowed: false, reason: `apk-url-rejected:${safeHostForLog(apkUrl)}` };
  }
  if (
    MIN_SUPPORTED_PLAYER_VERSION !== '0.0.0' &&
    !semverGteLocal(versionName, MIN_SUPPORTED_PLAYER_VERSION)
  ) {
    return {
      allowed: false,
      reason: `below-min-supported-version:${versionName}<${MIN_SUPPORTED_PLAYER_VERSION}`,
    };
  }
  if (quarantinedVersions().has(versionName)) {
    return { allowed: false, reason: `version-quarantined:${versionName}` };
  }

  const pin = (opts.pins ?? shaPins())[versionName];
  if (pin) {
    if (!computedSha || computedSha.toLowerCase() !== pin.toLowerCase()) {
      return { allowed: false, reason: `sha-pin-mismatch:${versionName}` };
    }
    return { allowed: true, pinned: true };
  }
  return { allowed: true, pinned: false };
}

/** Host only — never log a full artifact URL with a query signature in it. */
function safeHostForLog(rawUrl: string): string {
  try {
    return new URL(rawUrl).host || 'unparseable';
  } catch {
    return 'unparseable';
  }
}
