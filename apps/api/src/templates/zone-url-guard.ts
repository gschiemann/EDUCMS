/**
 * INJ-003 (2026-08-01) — write-time URL validation for template zone config.
 *
 * `TemplateZone.defaultConfig` is `z.any()` at the API boundary
 * (packages/api-types/src/index.ts) and is persisted verbatim by both
 * `POST /templates` and `PUT /templates/:id/zones`. For the three widget
 * types whose config carries a URL that the PLAYER turns into a live
 * network reference — an iframe `src` (WEBPAGE, EXTERNAL_HTML) or a video
 * `src` (STREAMING) — that meant an operator-supplied `javascript:` /
 * `data:` payload rode straight through to a screen with no server-side
 * check at all.
 *
 * This is a SCHEME / SSRF gate, deliberately NOT a host allowlist:
 * embedding third-party pages and streams is a shipped, legitimate
 * feature, so we must not pin URLs to first-party hosts.
 *
 * Rules, per URL-bearing field:
 *   1. Empty / non-string        → ignored (the widget renders its own
 *                                  empty state; not our business here).
 *   2. Control characters        → rejected. Browsers strip \n / \t while
 *                                  parsing a URL, which is the classic way
 *                                  to smuggle `java\nscript:` past a naive
 *                                  scheme test. We refuse rather than
 *                                  normalize, so what we validate is
 *                                  byte-identical to what we persist.
 *   3. Root-relative `/foo`      → allowed. This is the SHIPPED shape for
 *      (but never `//host`)         every EXTERNAL_HTML board
 *                                  (`/templates/hs/*.html`) and the sports
 *                                  direct-mode surfaces (`/board/…`).
 *                                  A path can never carry a scheme, so
 *                                  there is nothing to validate.
 *   4. Explicit scheme           → `https:` only (validated below).
 *                                  `http:` is allowed ONLY for a loopback
 *                                  host and ONLY outside production, so
 *                                  local dev against `http://localhost:3000`
 *                                  keeps working. EVERYTHING else —
 *                                  `javascript:`, `data:`, `blob:`,
 *                                  `file:`, `intent:`, `vbscript:`, … — is
 *                                  rejected outright.
 *   5. Scheme-relative `//host`  → resolved as `https://host` (what a
 *                                  browser does on our https pages) and
 *                                  validated as such.
 *   6. Bare `example.com/x`      → resolved as `https://example.com/x`,
 *                                  mirroring WebpageWidget's own
 *                                  auto-prefix, and validated as such.
 *
 * The https case reuses `validatePublicUrl` from branding/safe-fetch —
 * the established helper for exactly this (see ai.service.ts's touchAction
 * `open-url` sanitizer, which pairs the same `^https://` test with it).
 * We do NOT use the async `assertPublicUrl` here: it performs a DNS
 * lookup per URL, and a single save can carry up to 500 zones — that would
 * turn one operator Save into hundreds of blocking resolutions. The
 * DNS-rebinding half of the defense already lives where it matters, at the
 * server-side fetch (proxy/renderer.service.ts calls `assertPublicUrl`
 * before `page.goto`).
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { isIP } from 'node:net';
import { validatePublicUrl, isPrivateIp } from '../branding/safe-fetch';

/**
 * Widget types whose zone config carries a player-dereferenced URL, and
 * the config keys that hold it. Sourced from the renderers:
 *   WEBPAGE / EXTERNAL_HTML → `config.url`  (WidgetRenderer.tsx)
 *   STREAMING               → `config.playbackUrl` / `config.embedUrl`
 *                             (StreamingWidget.tsx)
 * Add a widget here the moment it starts dereferencing a config URL.
 */
export const URL_BEARING_ZONE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  WEBPAGE: ['url'],
  EXTERNAL_HTML: ['url'],
  STREAMING: ['playbackUrl', 'embedUrl'],
};

/**
 * Config keys holding an ARRAY of objects that each carry a URL, keyed by
 * widget type. STREAMING's `playbackUrlVariants` is the per-codec variant
 * list (StreamingWidget.tsx:72-79); `pickBestVideo()` picks one and feeds it
 * straight to `<video src>`, so it is every bit as dereferenced as
 * `playbackUrl` — and it is the field the first pass of this guard missed.
 */
export const URL_BEARING_ZONE_ARRAY_FIELDS: Readonly<
  Record<string, ReadonlyArray<{ field: string; key: string }>>
> = {
  STREAMING: [{ field: 'playbackUrlVariants', key: 'url' }],
};

/** `scheme:` prefix per RFC 3986 — the only thing that can make a URL non-relative. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/**
 * `host:port` masquerading as `scheme:` — `example.com:8443/live.m3u8`
 * satisfies HAS_SCHEME with a "scheme" of `example.com`. Digits after the
 * colon up to the first `/ ? #` are the structural tell that this is an
 * authority, not a scheme, so it must take the bare-domain branch (and get
 * an honest port error) rather than a nonsense
 * `Disallowed URL scheme "example.com:"`.
 */
const LOOKS_LIKE_HOST_PORT = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i;
/** C0 controls + DEL. Browsers silently strip these mid-URL; we refuse instead. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

/**
 * Two holes `validatePublicUrl` does NOT cover, closed here because this
 * URL is dereferenced by the PLAYER (a kiosk on the customer's LAN), not by
 * our server:
 *
 *  1. **Bracketed IPv6 literals.** `new URL('https://[::1]/x').hostname`
 *     is `"[::1]"` WITH the brackets, and `node:net.isIP('[::1]')` is 0 —
 *     so safe-fetch's `isIP(hostname) && isPrivateIp(hostname)` test never
 *     fires and `https://[::1]/admin` sails through. (`safeFetch` itself
 *     survives by accident: the non-IP branch then tries a DNS lookup of
 *     `[::1]`, which errors closed. The SYNCHRONOUS `validatePublicUrl`
 *     callers — this guard, `ai.service.parseCtaHref`,
 *     `streaming.validateStreamUrl` — have no such backstop.) Fixing
 *     `safe-fetch.ts` is the right long-term move; it is outside this
 *     change's blast radius, so the bracket-stripped check lives here.
 *
 *  2. **`localhost` by NAME.** Not an IP literal, so `isPrivateIp` cannot
 *     see it — but on a kiosk it IS the device's own loopback.
 *     RFC 6761 reserves `localhost` and `*.localhost` as always-loopback,
 *     so both are refused. Other LAN names (`intranet`, `*.local`) are
 *     deliberately still allowed: embedding an on-prem dashboard is a
 *     legitimate, shipped use of the WEBPAGE widget.
 */
function assertHostNotLoopbackLiteral(zoneName: string, field: string, url: URL): void {
  const bare = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (isIP(bare) && isPrivateIp(bare)) {
    rejectUrl(zoneName, field, `Private/loopback IP ${url.hostname} is not allowed.`);
  }
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    rejectUrl(zoneName, field, 'localhost is not allowed — it resolves to the screen itself.');
  }
}

function rejectUrl(zoneName: string, field: string, reason: string): never {
  throw new HttpException(
    {
      code: 'TEMPLATE_ZONE_URL_REJECTED',
      message: `Zone "${zoneName}" — ${field}: ${reason}`,
      zone: zoneName,
      field,
    },
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Validate ONE URL-bearing config value. Exported for direct unit testing;
 * callers normally use `assertZoneUrlsSafe`.
 */
export function assertZoneUrlValueSafe(zoneName: string, field: string, raw: unknown): void {
  if (typeof raw !== 'string') return;
  const value = raw.trim();
  if (!value) return;

  if (CONTROL_CHARS.test(value)) {
    rejectUrl(zoneName, field, 'URL contains control characters.');
  }

  // Shape detection must read the string the way a BROWSER does, and the
  // WHATWG URL parser treats a backslash as a slash for the special
  // schemes (http/https) our pages run on. Without this, `/\evil.com` and
  // `\\evil.com` look root-relative here but resolve to `https://evil.com`
  // in the iframe — sliding past the checks below (including the
  // private-IP one: `/\127.0.0.1/x` would have reached the kiosk's own
  // loopback). Normalize the leading run of separators for the SHAPE test
  // only; the value we validate and persist stays byte-identical.
  const leading = value.slice(0, 2).replace(/\\/g, '/');
  const isSeparatorLed = leading.startsWith('/');
  const isAuthorityLed = leading.startsWith('//');

  // Root-relative, same-origin reference (`/templates/hs/x.html`,
  // `/board/<id>`). Never `//host` — that is scheme-relative, handled below.
  if (isSeparatorLed && !isAuthorityLed) return;

  let candidate = value;
  if (HAS_SCHEME.test(value) && !LOOKS_LIKE_HOST_PORT.test(value)) {
    const scheme = value.slice(0, value.indexOf(':')).toLowerCase();
    if (scheme === 'http') {
      // Dev-only loopback escape hatch. Parse first so we judge the real
      // host, not a lookalike prefix (`http://localhost.evil.com`).
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        rejectUrl(zoneName, field, 'Not a valid URL.');
      }
      if (process.env.NODE_ENV === 'production' || !isLoopbackHost(parsed.hostname)) {
        rejectUrl(zoneName, field, 'Insecure http:// URL — use https://.');
      }
      return;
    }
    if (scheme !== 'https') {
      rejectUrl(zoneName, field, `Disallowed URL scheme "${scheme}:" — only https:// is allowed.`);
    }
  } else if (isAuthorityLed) {
    // Scheme-relative — a browser resolves it against our https origin.
    // Backslash forms (`\\host`, `/\host`) resolve identically, so validate
    // the slash-normalized authority rather than letting `new URL` see a
    // shape it would treat as a path.
    candidate = `https://${value.slice(2).replace(/^[\\/]+/, '')}`;
  } else {
    // Bare domain — WebpageWidget auto-prefixes https://; validate what
    // the player will actually load.
    candidate = `https://${value}`;
  }

  let parsed: URL;
  try {
    parsed = validatePublicUrl(candidate);
  } catch (e: any) {
    rejectUrl(zoneName, field, e?.message || 'URL failed validation.');
  }
  // The two loopback shapes validatePublicUrl misses — see the helper.
  assertHostNotLoopbackLiteral(zoneName, field, parsed);
}

/**
 * Validate every URL-bearing field across a zone array. Tolerant of the two
 * shapes `defaultConfig` arrives in: a plain object (request bodies) and a
 * JSON string (rows read back from the DB, e.g. a version snapshot). Any
 * other shape is skipped rather than rejected — this guard's job is to
 * catch dangerous URLs, not to police config shape.
 */
export function assertZoneUrlsSafe(
  zones: ReadonlyArray<{ name?: unknown; widgetType?: unknown; defaultConfig?: unknown }> | undefined | null,
): void {
  if (!Array.isArray(zones)) return;
  for (const zone of zones) {
    const widgetType = String(zone?.widgetType ?? '').toUpperCase();
    const fields = URL_BEARING_ZONE_FIELDS[widgetType];
    const arrayFields = URL_BEARING_ZONE_ARRAY_FIELDS[widgetType];
    if (!fields && !arrayFields) continue;

    let config: any = zone?.defaultConfig;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch {
        continue; // Unparseable config can't carry a URL we could resolve.
      }
    }
    if (!config || typeof config !== 'object') continue;

    const zoneName = typeof zone?.name === 'string' && zone.name ? zone.name : 'untitled';
    for (const field of fields ?? []) assertZoneUrlValueSafe(zoneName, field, config[field]);
    for (const { field, key } of arrayFields ?? []) {
      const list = config[field];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        assertZoneUrlValueSafe(zoneName, `${field}[].${key}`, (entry as any)[key]);
      }
    }
  }
}
