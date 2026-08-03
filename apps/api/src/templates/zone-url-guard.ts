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
import { validatePublicUrl } from '../branding/safe-fetch';

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

/** `scheme:` prefix per RFC 3986 — the only thing that can make a URL non-relative. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** C0 controls + DEL. Browsers silently strip these mid-URL; we refuse instead. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
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

  // Root-relative, same-origin reference (`/templates/hs/x.html`,
  // `/board/<id>`). Never `//host` — that is scheme-relative, handled below.
  if (value.startsWith('/') && !value.startsWith('//')) return;

  let candidate = value;
  if (HAS_SCHEME.test(value)) {
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
  } else if (value.startsWith('//')) {
    // Scheme-relative — a browser resolves it against our https origin.
    candidate = `https:${value}`;
  } else {
    // Bare domain — WebpageWidget auto-prefixes https://; validate what
    // the player will actually load.
    candidate = `https://${value}`;
  }

  try {
    validatePublicUrl(candidate);
  } catch (e: any) {
    rejectUrl(zoneName, field, e?.message || 'URL failed validation.');
  }
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
    const fields = URL_BEARING_ZONE_FIELDS[String(zone?.widgetType ?? '').toUpperCase()];
    if (!fields) continue;

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
    for (const field of fields) assertZoneUrlValueSafe(zoneName, field, config[field]);
  }
}
