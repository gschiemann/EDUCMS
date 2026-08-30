/**
 * R-01 (2026-08-01, security wave) — the player's TRUST ANCHOR guards.
 *
 * `getApiRoot()` decides which host the kiosk treats as "the server": the
 * WebSocket, the SSE stream, the device-authenticated manifest (the SOLE
 * arbiter of the lockdown overlay) and the stranded-alert reconcile all derive
 * from it. Before this module the override was accepted verbatim from a
 * `?api=` query param — no scheme check, no host allowlist, no production gate
 * — and persisted to localStorage forever. One drive-by load of
 * `/player?api=https://evil.example` handed an attacker the screen: they
 * become the manifest (paint a fake lockdown, or suppress a real one) and they
 * harvest the device JWT on the first HELLO.
 *
 * Everything here is PURE (no React, no window) so it is exhaustively
 * unit-testable without mounting the 9.6k-line player page — the same pattern
 * as `emergencyReconcile.ts` and `sync/`.
 *
 * Policy:
 *   - `https:` required. `http:` only for loopback, and only outside production.
 *   - Host must match the build's `NEXT_PUBLIC_API_URL` host, the origin the
 *     player page itself was served from, an explicitly-configured extra host
 *     (`NEXT_PUBLIC_API_ROOT_ALLOWLIST`, comma-separated — the escape hatch for
 *     staging / on-prem installs), or a small built-in known-good set.
 *   - Matching is exact-host OR a proper suffix on a DOT BOUNDARY. Never
 *     `includes()`/`startsWith()`, which `venue-os.app.evil.com` would defeat.
 *   - Validation runs on READ as well as on write, so a screen poisoned before
 *     this shipped self-heals (the bad value is dropped from localStorage) on
 *     its very next load.
 */

export const API_ROOT_STORAGE_KEY = 'edu_api_root';
export const DEVICE_TOKEN_STORAGE_KEY = 'edu_device_token';

/**
 * Known-good API hosts that are trusted even if the build somehow shipped
 * without `NEXT_PUBLIC_API_URL` (in which case the env fallback is
 * `http://localhost:8080` and a legitimate `?api=` pointed at production would
 * otherwise be refused). Keep this list SHORT and always full hostnames —
 * never a shared apex like `up.railway.app`, which would trust every tenant on
 * that platform.
 */
export const BUILT_IN_ALLOWED_API_HOSTS: readonly string[] = [
  'api-production-39a1.up.railway.app',
];

export interface ApiRootPolicy {
  /** `NEXT_PUBLIC_API_URL` — the build-time trust root. */
  envApiUrl?: string | null;
  /** `NEXT_PUBLIC_API_ROOT_ALLOWLIST` — comma-separated hosts or URLs. */
  extraHosts?: string | readonly string[] | null;
  /** The origin the player page itself was served from (`window.location.origin`). */
  pageOrigin?: string | null;
  /** true → `http:` is refused outright, loopback included. */
  isProduction: boolean;
}

/** Historic normalization: the override may be given with or without `/api/v1`. */
function stripApiSuffix(s: string): string {
  return s.replace(/\/api\/v1\/?$/, '');
}

function hostOf(candidate: string): string | null {
  const raw = candidate.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // Bare host (`api.example.com`, maybe with a port or a trailing path).
    // Re-parse through a scheme so the WHATWG parser does the work; anything
    // that still fails is not a host we will ever trust.
    try {
      return new URL(`https://${raw.replace(/^\/+/, '')}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

/**
 * Exact host equality, or a proper subdomain on a DOT boundary.
 * `hostMatches('venue-os.app.evil.com', 'venue-os.app')` → false.
 */
export function hostMatches(host: string, allowed: string): boolean {
  const a = allowed.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  const h = host.trim().toLowerCase();
  if (!a || !h) return false;
  return h === a || h.endsWith(`.${a}`);
}

/** Every host this build is willing to treat as "the server". */
export function allowedApiHosts(policy: ApiRootPolicy): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const h = v ? hostOf(v) : null;
    if (h && !out.includes(h)) out.push(h);
  };
  push(policy.envApiUrl);
  push(policy.pageOrigin);
  const extras =
    typeof policy.extraHosts === 'string'
      ? policy.extraHosts.split(',')
      : Array.isArray(policy.extraHosts)
        ? policy.extraHosts
        : [];
  for (const e of extras) push(e);
  for (const b of BUILT_IN_ALLOWED_API_HOSTS) push(b);
  return out;
}

function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

/**
 * Validate + normalize an API-root override.
 *
 * @returns the normalized root (origin + path, no trailing `/api/v1`, no query
 *          or fragment) when it is trusted, or `null` when it must be refused.
 */
export function normalizeApiRoot(raw: unknown, policy: ApiRootPolicy): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null; // relative / garbage / `javascript:` with no parseable form
  }

  // Embedded credentials would be replayed to the host on every request.
  if (url.username || url.password) return null;

  const protocol = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  const loopback = isLoopbackHost(host);

  if (protocol === 'http:') {
    // Plaintext is a dev-only affordance, and only against the local machine.
    if (policy.isProduction || !loopback) return null;
  } else if (protocol !== 'https:') {
    return null; // ws:, file:, data:, javascript:, …
  }

  // Dev loopback needs no allowlist entry; everything else must be listed.
  if (!(loopback && !policy.isProduction)) {
    const allowed = allowedApiHosts(policy);
    if (!allowed.some((a) => hostMatches(host, a))) return null;
  }

  // Drop query + fragment (an `?api=https://good.host/#@evil.example` style
  // decoration can never survive) and re-normalize the path.
  const path = stripApiSuffix(url.pathname).replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

export interface ResolveApiRootOptions {
  /** `window.location.search` (or a bare query string). */
  search?: string | null;
  policy: ApiRootPolicy;
  /** localStorage, or null when unavailable. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Env-derived default. This is the trust ROOT — it is never validated. */
  fallback: string;
  onReject?: (reason: string, value: string) => void;
}

/**
 * The full read path: `?api=` → localStorage → env fallback, with validation
 * (and self-healing removal of a poisoned stored value) at every step.
 */
export function resolveApiRoot(opts: ResolveApiRootOptions): string {
  const { policy, storage, fallback } = opts;
  const reject = opts.onReject ?? (() => {});

  let fromUrl: string | null = null;
  if (opts.search) {
    try {
      fromUrl = new URLSearchParams(opts.search).get('api');
    } catch {
      fromUrl = null;
    }
  }

  if (fromUrl) {
    const normalized = normalizeApiRoot(fromUrl, policy);
    if (normalized) {
      try {
        storage?.setItem(API_ROOT_STORAGE_KEY, normalized);
      } catch {
        /* private-mode / quota — the in-memory value still applies */
      }
      return normalized;
    }
    reject('untrusted-api-param', fromUrl);
    // Deliberately fall through: a bad param must not clobber a good stored
    // value, but it must also never be used.
  }

  let saved: string | null = null;
  try {
    saved = storage?.getItem(API_ROOT_STORAGE_KEY) ?? null;
  } catch {
    saved = null;
  }
  if (saved) {
    const normalized = normalizeApiRoot(saved, policy);
    if (normalized) {
      if (normalized !== saved) {
        try {
          storage?.setItem(API_ROOT_STORAGE_KEY, normalized);
        } catch { /* swallow */ }
      }
      return normalized;
    }
    // SELF-HEAL: a screen poisoned before this guard shipped drops the bad
    // value here and is back on the real server on this very load.
    reject('untrusted-stored-api-root', saved);
    try {
      storage?.removeItem(API_ROOT_STORAGE_KEY);
    } catch { /* swallow */ }
  }

  return fallback;
}

// ─── Device token hygiene (same shape of bug as `?api=`) ────────────────────
//
// `?token=` is persisted to localStorage verbatim and then sent as the device
// Bearer credential + the SSE query token. A valid token can only be minted by
// the server, so this is not the same severity as the API-root repoint — but
// an unvalidated blob still ends up in storage, in a URL, and in logs. Enforce
// a conservative shape (JWT / `dev_<screen>_<tenant>` charset, bounded length)
// on BOTH write and read, so a junk value is never persisted and a previously
// poisoned one self-heals.
//
// ── PRECEDENCE (changed 2026-08-30, player reliability program W1-12) ──────
//
// THE PRODUCTION FAILURE. The Android shell re-injects a token into the page
// URL on EVERY native reload — and it reads that token from a legacy
// DataStore whose writer died releases ago, so on long-lived devices the
// injected value is months stale. The old rule here ("URL wins, overwrite
// storage immediately") meant every watchdog/boot reload clobbered the fresh
// server-minted token in localStorage with that fossil; the next register
// presented it, got epoch-rejected, and the screen was downgraded to a
// 1-hour unproven credential — 409 SCREEN_TOKEN_DOWNGRADED audit rows across
// the pilot fleet in one week, and content-dead screens (G43: 37 h) once
// those hour tokens expired. Worse: getDeviceToken() re-resolves on every
// call, so the clobber re-applied continuously, undoing every renewal.
//
// New rule: a plausible STORED token wins outright — storage is written only
// by server-accepted mints (register/pairing responses) and is therefore
// always at least as fresh as anything the shell can inject. The URL
// candidate is adopted ONLY when storage is empty (first boot after install
// or cleared WebView data — the legacy bootstrap case it was built for).
// Token shape is still not token validity; the server remains the judge.

const DEVICE_TOKEN_MAX_LEN = 4096;
/** base64url + `.` (JWT) and `_`/`-` (the `dev_<screenId>_<tenantId>` form). */
const DEVICE_TOKEN_RE = /^[A-Za-z0-9._~+/=-]+$/;

export function isPlausibleDeviceToken(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const t = raw.trim();
  if (!t || t.length > DEVICE_TOKEN_MAX_LEN) return false;
  return DEVICE_TOKEN_RE.test(t);
}

export interface ResolveDeviceTokenOptions {
  /** `window.location.search` (or a bare query string). */
  search?: string | null;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  onReject?: (reason: string) => void;
}

export function resolveDeviceToken(opts: ResolveDeviceTokenOptions): string | null {
  const { storage } = opts;
  const reject = opts.onReject ?? (() => {});

  // 1) A plausible stored token wins outright (see PRECEDENCE above).
  let saved: string | null = null;
  try {
    saved = storage?.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    // Unreadable storage (sandboxed/partitioned runtime). Deep-audit
    // B-P1-5: this used to return null HERE — refusing the URL token too,
    // on a device where the shell-injected `?token=` is the only
    // credential that exists. Fall through: the URL branch below adopts it
    // IN MEMORY (the setItem attempt is best-effort), which is strictly
    // better than a screen with no credential at all.
    saved = null;
  }
  if (saved) {
    if (isPlausibleDeviceToken(saved)) return saved.trim();
    reject('malformed-stored-token');
    try {
      storage?.removeItem(DEVICE_TOKEN_STORAGE_KEY);
    } catch { /* swallow */ }
  }

  // 2) No usable stored token — this is the legacy bootstrap case where a
  //    shell-injected `?token=` is legitimately the only credential we have.
  let fromUrl: string | null = null;
  if (opts.search) {
    try {
      fromUrl = new URLSearchParams(opts.search).get('token');
    } catch {
      fromUrl = null;
    }
  }
  if (!fromUrl) return null;
  if (isPlausibleDeviceToken(fromUrl)) {
    const t = fromUrl.trim();
    try {
      storage?.setItem(DEVICE_TOKEN_STORAGE_KEY, t);
    } catch { /* swallow */ }
    return t;
  }
  reject('malformed-token-param');
  return null;
}
