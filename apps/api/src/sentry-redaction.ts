/**
 * SEC-011 (2026-09-04) — telemetry redaction for the API's Sentry client.
 *
 * WHY THIS FILE EXISTS. The previous redaction in `sentry.ts` scrubbed a
 * fixed set of request HEADERS and TOP-LEVEL request-body keys only. It did
 * not recurse, and it never touched URLs. Three concrete leaks followed
 * directly from that, and all three are real shapes in this codebase:
 *
 *   1. NESTED CREDENTIALS. POS/streaming/feed integrations post
 *      `{ integration: { credentials: { apiKey, accessToken } } }`. The old
 *      top-level loop saw only the key `integration`, which matches nothing,
 *      so the whole subtree — keys and values — went to Sentry verbatim.
 *   2. QUERY STRINGS. Legacy SSE accepts a long-lived device JWT as
 *      `?token=…`. Sentry records `request.url` and `request.query_string`
 *      itself; the old `beforeSend` rewrote neither, so a single 500 on that
 *      route copied a fleet device credential into a third-party system.
 *   3. VALUE SHAPES. A secret does not have to sit under a suspicious key.
 *      `{ note: 'use sk_live_… to retry' }`, a bearer echoed into an error
 *      message, a webhook secret in a config blob — key-name matching alone
 *      cannot see any of them.
 *
 * THE MODEL HERE. Redaction is defence in depth with three independent
 * layers, applied in this order at every node of the event:
 *
 *   ENVELOPE   a key whose entire subtree is credential material
 *              (`credentials`, `secrets`, `oauth`, …) is replaced wholesale
 *              and never walked. Dropping the container is strictly safer
 *              than trusting that every leaf inside it is recognisable.
 *   KEY NAME   a key that names a secret (`token`, `apiKey`, `password`,
 *              `signature`, …) has its value replaced, at any depth.
 *   VALUE      every surviving string is inspected on its own merits: JWTs,
 *              known vendor prefixes, and high-entropy hex/base64 are
 *              replaced; anything URL-shaped loses its query and fragment.
 *
 * DELIBERATELY NOT DONE: this does not try to be a secret scanner for
 * arbitrary prose. It is a bounded, testable filter over the shapes this
 * application actually sends. Over-redaction is the accepted failure mode —
 * a `[Filtered]` in a stack trace costs one debugging round-trip; a device
 * JWT in a third-party SaaS costs a fleet re-pair.
 *
 * NOT A SUBSTITUTE FOR FIXING THE SOURCE. The right long-term fix for the
 * SSE case is to stop accepting a device JWT in a query string at all
 * (headers or a single-use ticket instead). That lives in the device-auth
 * surface, owned elsewhere. This file makes the telemetry path safe
 * regardless of what the transport does.
 */

/** What every redacted value is replaced with. Matches the previous marker. */
export const FILTERED = '[Filtered]';

/**
 * Keys whose ENTIRE value is dropped without being walked.
 *
 * Matched against the key with every non-alphanumeric character removed and
 * lower-cased, so `api_keys`, `apiKeys` and `API-KEYS` are one rule. These
 * are containers we never want in telemetry in any form — recursing into
 * them and hoping each leaf trips a rule is the weaker guarantee.
 */
const ENVELOPE_KEYS = new Set([
  'credential',
  'credentials',
  'secret',
  'secrets',
  'apikey',
  'apikeys',
  'oauth',
  'oauthtokens',
  'tokens',
  'authorization',
  'auth',
  'authentication',
  'password',
  'passwords',
  'cookie',
  'cookies',
  'setcookie',
]);

/**
 * Keys whose value is replaced (the key itself is kept so the shape of the
 * payload is still legible in Sentry).
 *
 * The original filter was `/secret|token|key|password/i`. That is preserved
 * verbatim as the first alternation group — a redaction filter must only ever
 * widen — with the additions after it.
 *
 * `key` on its own is broad (it also matches `keyboard`, `idempotencyKey`).
 * That is intentional and inherited: a false positive here is a lost
 * debugging field, a false negative is a leaked credential.
 *
 * NOT included, on purpose: a bare `auth`, which would swallow `authState` —
 * the player-reliability signal we most need to read in a crash report.
 * (`auth` as a whole KEY is still dropped by ENVELOPE_KEYS above; what is
 * excluded here is the substring match that would also hit `authState`.)
 */
const SENSITIVE_KEY =
  /secret|token|key|password|passwd|passphrase|credential|authorization|cookie|signature|sessionid|bearer|dsn|privatekey/i;

/**
 * A JSON Web Token. Matched two ways because it arrives two ways.
 *
 * `JWT_ANYWHERE` finds one embedded in prose ("401 for Bearer eyJhbG…"),
 * anchored on the `eyJ` that every base64url-encoded `{"` header starts with
 * — that anchor is what keeps it from eating ordinary dotted identifiers.
 * `JWT_WHOLE` catches a token whose header is not `eyJ`-shaped but which
 * occupies the entire value, where three base64url segments is signal enough.
 */
const JWT_ANYWHERE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const JWT_WHOLE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

/**
 * Vendor key prefixes that are unambiguous by construction. Every one of
 * these is either in this repo's env surface or in an integration we ship:
 * Stripe (`sk_`/`rk_`/`whsec_`), Resend (`re_`), Google (`AIza`), OpenAI
 * (`sk-`), Anthropic (`sk-ant-`), Supabase (`sb_secret_`), GitHub
 * (`ghp_`/`gho_`/`ghs_`/`ghu_`/`github_pat_`), Slack (`xox…`), SendGrid
 * (`SG.`), Shopify (`shpat_`/`shpss_`), Square (`EAAA`).
 *
 * Publishable/public counterparts (`pk_live_`, `pk_test_`) are deliberately
 * absent: they are meant to be public, and redacting them would hide which
 * Stripe account a failing call belonged to.
 */
const VENDOR_SECRET =
  /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|rk_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|re_[A-Za-z0-9_]{8,}|AIza[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|shp(?:at|ss)_[A-Za-z0-9]{16,})/g;

/**
 * High-entropy blobs. Both of our 64-char hex secrets (`JWT_SECRET`,
 * `DEVICE_SECRET_KEY`, `GATEWAY_SHARED_SECRET`) and most opaque bearer
 * tokens land here even when nothing about the key name says so.
 *
 * The base64 rule additionally requires mixed case AND a digit, which is what
 * separates a real token from a long lowercase slug like
 * `springfield-elementary-north-hallway-display-01`. A single UUID (36 chars)
 * is under the 40-char floor and survives — those are IDs we need.
 */
const HEX_BLOB = /^[a-fA-F0-9]{32,}$/;
const BASE64_BLOB = /^[A-Za-z0-9+/_-]{40,}={0,2}$/;

/** How deep to walk before giving up. Guards against pathological payloads. */
const MAX_DEPTH = 12;

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/** True when the key names a container we drop wholesale. */
export function isEnvelopeKey(key: string): boolean {
  return ENVELOPE_KEYS.has(normalizeKey(key));
}

/** True when the key names a secret whose value must be replaced. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function looksLikeHighEntropySecret(value: string): boolean {
  if (HEX_BLOB.test(value)) return true;
  if (!BASE64_BLOB.test(value)) return false;
  // Mixed case + a digit. A long single-case slug is a name, not a secret.
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

/**
 * Strip `?query` and `#fragment` from every URL-looking substring.
 *
 * Deliberately regex-based rather than `new URL()`: the string being scrubbed
 * is usually a sentence with a URL inside it ("GET https://api/x?token=… 401"),
 * not a bare URL, and `new URL()` cannot see those. The capture stops at the
 * first whitespace, quote or angle bracket, which is where a URL ends in every
 * message shape we emit.
 */
export function stripUrlSecrets(value: string): string {
  return value.replace(
    /((?:https?|wss?):\/\/[^\s"'<>()[\]]*?)([?#][^\s"'<>()[\]]*)/gi,
    (_match, base: string) => `${base}?[Filtered]`,
  );
}

/**
 * Redact one string on its own merits, ignoring whatever key it sat under.
 *
 * Order matters: URL stripping runs FIRST so that a token living in a query
 * string is gone before the entropy rules get a chance to look at the whole
 * URL and decide it is fine.
 */
export function redactString(value: string): string {
  let out = stripUrlSecrets(value);
  if (JWT_WHOLE.test(out)) return FILTERED;
  out = out.replace(JWT_ANYWHERE, FILTERED);
  out = out.replace(VENDOR_SECRET, FILTERED);
  if (looksLikeHighEntropySecret(out)) return FILTERED;
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively redact any value: objects, arrays, strings, primitives.
 *
 * `seen` is a real cycle guard, not decoration — Sentry serializes request
 * bodies that can and do contain self-references, and an unguarded walk would
 * hang the process inside `beforeSend`, i.e. inside the error path.
 */
export function redactValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return FILTERED;
  if (seen.has(value)) return FILTERED;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1, seen));
  }
  if (!isPlainObject(value)) {
    // Buffers, Dates, class instances, Maps. We cannot reason about their
    // contents, and a Buffer is a very plausible carrier for key material.
    if (value instanceof Date) return value;
    return FILTERED;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isEnvelopeKey(key) || isSensitiveKey(key)) {
      out[key] = FILTERED;
    } else {
      out[key] = redactValue(entry, depth + 1, seen);
    }
  }
  return out;
}

/**
 * Headers. `authorization` and `cookie` are absolute; everything else falls
 * through to the same key-name and value-shape rules as the body, so
 * `x-venueos-gw-secret` and a raw JWT in a bespoke header are both caught.
 */
export function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') {
      out[key] = FILTERED;
    } else if (isEnvelopeKey(key) || isSensitiveKey(key)) {
      out[key] = FILTERED;
    } else {
      out[key] = typeof value === 'string' ? redactString(value) : value;
    }
  }
  return out;
}

/**
 * The captured request URL keeps its path (that is the whole diagnostic
 * value) and loses everything after it. `?token=` on the legacy SSE route is
 * the case this exists for.
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : `${url.slice(0, cut)}?[Filtered]`;
}

/** Minimal structural view of the parts of a Sentry event we rewrite. */
export interface RedactableEvent {
  message?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    data?: unknown;
    [key: string]: unknown;
  };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  /**
   * Performance transactions carry the outbound HTTP calls we make, and a
   * span's `description` / `data['http.url']` is a full URL — query string
   * included. Same leak as `request.url`, different envelope.
   */
  spans?: Array<{ description?: string; data?: Record<string, unknown> }>;
  exception?: { values?: Array<{ value?: string }> };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

/**
 * Rewrite an outbound Sentry event in place and return it.
 *
 * Mutates rather than clones on purpose: Sentry hands `beforeSend` the event
 * it is about to serialize, and returning a structurally-similar copy would
 * silently drop any SDK-internal field this function does not know about.
 */
export function redactEvent<T extends RedactableEvent>(event: T): T {
  if (typeof event.message === 'string') {
    event.message = redactString(event.message);
  }

  if (event.request) {
    event.request.url = redactUrl(event.request.url);
    // The query string is never diagnostic enough to be worth the risk: it is
    // exactly where `?token=` lives. Drop the field rather than filter it.
    if ('query_string' in event.request) {
      delete event.request.query_string;
    }
    if (event.request.cookies) {
      event.request.cookies = {};
    }
    event.request.headers = redactHeaders(event.request.headers);
    if (event.request.data !== undefined) {
      event.request.data = redactValue(event.request.data);
    }
  }

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (typeof crumb.message === 'string') {
        crumb.message = redactString(crumb.message);
      }
      if (crumb.data) {
        crumb.data = redactValue(crumb.data) as Record<string, unknown>;
      }
    }
  }

  if (event.spans) {
    for (const span of event.spans) {
      if (typeof span.description === 'string') {
        span.description = redactString(span.description);
      }
      if (span.data) {
        span.data = redactValue(span.data) as Record<string, unknown>;
      }
    }
  }

  if (event.exception?.values) {
    for (const value of event.exception.values) {
      if (typeof value.value === 'string') {
        value.value = redactString(value.value);
      }
    }
  }

  if (event.extra) {
    event.extra = redactValue(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    // `contexts.trace` is SDK-owned and its shape is fixed: `trace_id` is 32
    // hex characters and `span_id` is 16, which the high-entropy rule would
    // otherwise replace — silently breaking every trace link in Sentry while
    // protecting nothing. Everything else under `contexts` (including
    // anything a future `setContext()` adds) still goes through the walker.
    const { trace, ...rest } = event.contexts;
    const redacted = redactValue(rest) as Record<string, unknown>;
    event.contexts = trace === undefined ? redacted : { ...redacted, trace };
  }
  if (event.tags) {
    event.tags = redactValue(event.tags) as Record<string, unknown>;
  }

  return event;
}
