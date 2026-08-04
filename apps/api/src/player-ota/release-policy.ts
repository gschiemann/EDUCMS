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
 *
 * 2026-08-03 — raised to 1.1.0, the first release-signed build. Every
 * `player-v*` release below it was signed with the debug keystore that sat
 * in a public repo with its password committed two files away — that key is
 * permanently compromised, so no build from that era may ever be advertised
 * again, no matter what tag appears upstream. Safe to set now: the only
 * callers below the [SIGNING_CUTOVER_VERSION] are `-debug` installs, which
 * the cutover gate already answers with needsManualReinstall.
 */
export const MIN_SUPPORTED_PLAYER_VERSION = '1.1.0';

/**
 * Floor for the Manager APK. Still '0.0.0': the first release-signed
 * Manager has not been TAGGED yet (latest is manager-v1.0.23, debug era),
 * and a 1.1.0 floor today would refuse to advertise ANY manager build —
 * stranding the pre-cutover fleet's Manager self-update entirely. Raise to
 * '1.1.0' right after the fleet reinstall tour, when manager-v1.1.0 exists
 * and no `-debug` Manager remains that we care about.
 */
export const MIN_SUPPORTED_MANAGER_VERSION = '0.0.0';

/**
 * ─── The signing cutover (2026-08-03) ────────────────────────────────
 *
 * v1.1.0 is the first build signed with the real release keystore AND the
 * first with the un-suffixed applicationId (`com.educms.player` /
 * `com.educms.manager`). Every screen deployed before it runs the `.debug`
 * package signed with the compromised public keystore. Android will NEVER
 * install across that boundary — different package id installs side by
 * side, same package id with a different key fails with
 * INSTALL_FAILED_UPDATE_INCOMPATIBLE. There is no server-side override.
 *
 * Without this gate, a `-debug` caller below the boundary would be offered
 * v1.1.0 on every 6h poll: ~6 MB downloaded, install fails, ERROR state
 * reported, forever — bandwidth churn plus a dashboard that cries wolf.
 * The gate answers those callers with `uptoDate + needsManualReinstall`
 * instead, which the dashboard renders as a "hands-on reinstall required"
 * chip — turning the dead pipeline into a live checklist for the physical
 * reinstall tour (runbook: apps/player/RELEASE_SIGNING.md).
 *
 * The `-debug` marker is reliable: both build.gradle.kts files apply
 * `versionNameSuffix = "-debug"`, and the shipped Kotlin workers report
 * `BuildConfig.VERSION_NAME` verbatim. Manager's bootstrap call (fresh
 * kiosk, Player absent) reports versionName "none" / vc=0 and is
 * additionally exempted at the call site — a fresh install is a NEW
 * package, which crosses no boundary.
 */
export const SIGNING_CUTOVER_VERSION = '1.1.0';

/**
 * True when [callerVersionName] identifies a pre-cutover `-debug` install
 * and [targetVersionName] is at or past the cutover — i.e. an update
 * Android is guaranteed to refuse. Fail-open on weird input: an
 * unparseable caller is NOT treated as `-debug` (the gate must never
 * strand a legitimate release-signed caller).
 */
export function blockedBySigningCutover(
  callerVersionName: unknown,
  targetVersionName: string,
): boolean {
  const caller = String(callerVersionName ?? '').trim().toLowerCase();
  if (!caller.endsWith('-debug')) return false;
  return semverGteLocal(targetVersionName, SIGNING_CUTOVER_VERSION);
}

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

/** Manager builds recalled the same way. Env hook: MANAGER_APK_QUARANTINE. */
export const QUARANTINED_MANAGER_VERSIONS: readonly string[] = [];

export function quarantinedVersions(): Set<string> {
  const fromEnv = String(process.env.PLAYER_APK_QUARANTINE || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set([...QUARANTINED_PLAYER_VERSIONS, ...fromEnv]);
}

export function quarantinedManagerVersions(): Set<string> {
  const fromEnv = String(process.env.MANAGER_APK_QUARANTINE || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set([...QUARANTINED_MANAGER_VERSIONS, ...fromEnv]);
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

/** Manager pins — same contract. Env hook: MANAGER_APK_SHA_PINS. */
export const MANAGER_RELEASE_SHA_PINS: Readonly<Record<string, string>> = {};

export function managerShaPins(): Record<string, string> {
  const merged: Record<string, string> = { ...MANAGER_RELEASE_SHA_PINS };
  for (const pair of String(process.env.MANAGER_APK_SHA_PINS || '').split(',')) {
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
  /** Override the floor. Tests only — production reads the const. */
  floor?: string;
}): ReleaseGateVerdict {
  return evaluateAgainstPolicy(opts, {
    floor: opts.floor ?? MIN_SUPPORTED_PLAYER_VERSION,
    quarantined: quarantinedVersions(),
    pins: opts.pins ?? shaPins(),
  });
}

/**
 * The identical gate for Manager builds. Manager is the MORE privileged
 * component — it installs Player — so it gets the full policy, not just
 * the URL check it had before (parity fix, 2026-08-03 review P2-6).
 */
export function evaluateManagerReleaseForFleet(opts: {
  versionName: string;
  apkUrl: string;
  computedSha: string;
  pins?: Record<string, string>;
  floor?: string;
}): ReleaseGateVerdict {
  return evaluateAgainstPolicy(opts, {
    floor: opts.floor ?? MIN_SUPPORTED_MANAGER_VERSION,
    quarantined: quarantinedManagerVersions(),
    pins: opts.pins ?? managerShaPins(),
  });
}

function evaluateAgainstPolicy(
  opts: { versionName: string; apkUrl: string; computedSha: string },
  policy: { floor: string; quarantined: Set<string>; pins: Record<string, string> },
): ReleaseGateVerdict {
  const { versionName, apkUrl, computedSha } = opts;

  if (!isAllowedApkUrl(apkUrl)) {
    return { allowed: false, reason: `apk-url-rejected:${safeHostForLog(apkUrl)}` };
  }
  if (policy.floor !== '0.0.0' && !semverGteLocal(versionName, policy.floor)) {
    return {
      allowed: false,
      reason: `below-min-supported-version:${versionName}<${policy.floor}`,
    };
  }
  if (policy.quarantined.has(versionName)) {
    return { allowed: false, reason: `version-quarantined:${versionName}` };
  }

  const pin = policy.pins[versionName];
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
