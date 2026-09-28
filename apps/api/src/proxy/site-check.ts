/**
 * Website Tabs — the one-paste site check (2026-09-28).
 *
 * The operator pastes a URL into the Website Tabs panel and expects three
 * things to fill themselves in: the site's NAME, its ICON, and an honest
 * verdict on whether the page will actually show on a screen. Every kiosk
 * product in the competitor research (Kiosk Pro, Fully, Scalefusion, Rise,
 * Xibo, SiteKiosk, Yodeck, ScreenCloud, OptiSigns) makes the operator type
 * the label and upload the icon by hand, and only ScreenCloud shows a live
 * "it loads" checkmark. This module is that whole panel's back end.
 *
 * ── SECURITY ──────────────────────────────────────────────────────────
 * The URL is operator input, so the fetch goes through `safeFetch` — the
 * SSRF-guarded client every other operator-supplied URL in this API uses
 * (DNS resolve + private-range refusal + connect-time pin + byte cap +
 * timeout). Never `fetch(url)` here. The result echoes NOTHING about a
 * refused destination beyond `reason: 'blocked-host'` (SsrfError's
 * `publicMessage` posture from SDE-01): a private-IP literal, a private
 * DNS answer and a bad scheme all look identical to the caller.
 *
 * ── THE EMBED VERDICT ─────────────────────────────────────────────────
 * Browsers decide framing from two RESPONSE HEADERS and nothing else:
 *   • `Content-Security-Policy: frame-ancestors …` — when present it WINS
 *     and `X-Frame-Options` is ignored (CSP3 §7.3.1, every engine).
 *   • `X-Frame-Options: DENY | SAMEORIGIN | ALLOW-FROM <uri>` — otherwise.
 * `<meta http-equiv>` cannot carry either (frame-ancestors is explicitly
 * ignored in meta CSP; XFO is header-only), so the HTML is not consulted
 * for the verdict. A page that blocks framing is not a failure — it is the
 * case the native WebView on our app exists for — so the verdict is
 * reported as `embed: 'blocked'`, never as an error.
 */

import type { IncomingHttpHeaders } from 'node:http';
import * as cheerio from 'cheerio';
import {
  safeFetch,
  SsrfError,
  FetchTooLargeError,
  type SafeFetchResult,
} from '../branding/safe-fetch';
import { pickBrandSegment } from '../branding/branding-scraper.service';

export type EmbedVerdict = 'ok' | 'blocked' | 'unreachable';

export type SiteCheckReason =
  | 'x-frame-options'
  | 'frame-ancestors'
  | 'http-status'
  | 'blocked-host'
  | 'too-large'
  | 'network'
  | 'invalid-url'
  | null;

export interface SiteCheckResult {
  /** True when the page answered 2xx. `embed` says whether a browser may frame it. */
  ok: boolean;
  /** The normalised URL that was checked (bare domains get `https://`). */
  url: string;
  finalUrl: string | null;
  status: number | null;
  /** The site's own name — `og:site_name`, else the brand segment of `<title>`, else the host. */
  name: string | null;
  /** Absolute http(s) URL of the best icon the page declares, else `/favicon.ico` on its origin. */
  iconUrl: string | null;
  embed: EmbedVerdict;
  reason: SiteCheckReason;
  contentType: string | null;
}

/** Longest URL the panel accepts. Anything past this is not a URL a person pasted. */
export const SITE_CHECK_MAX_URL_LENGTH = 2048;

/** How much of the document the meta extractor reads. The head is what matters. */
const HTML_PARSE_CAP = 512 * 1024;

/** C0 controls + DEL — the bytes a browser silently strips out of a URL. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * `example.com/menu` → `https://example.com/menu`, exactly the auto-prefix
 * WebpageWidget applies, so the check and the screen see the same URL.
 * Returns null for anything that is not an http(s) URL once normalised —
 * `javascript:`, `file:`, `data:` and friends never reach the fetcher.
 */
export function normalizeSiteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > SITE_CHECK_MAX_URL_LENGTH) return null;
  if (hasControlChars(s)) return null; // browsers strip these mid-URL; refuse instead
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s)
    ? s
    : s.startsWith('//')
      ? `https:${s}`
      : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname) return null;
  return u.toString();
}

/** One header value, however node:http shaped it (string | string[] | undefined). */
function headerValues(
  headers: IncomingHttpHeaders | undefined,
  name: string,
): string[] {
  if (!headers) return [];
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') return [v];
  return [];
}

/**
 * The web origins THIS deployment serves the dashboard and player from —
 * `ALLOWED_ORIGINS`, the same list CORS trusts. A `frame-ancestors` or
 * `ALLOW-FROM` that names one of them is a site that deliberately lets our
 * screens frame it (a district's own portal, typically), and that is an OK,
 * not a block.
 */
function ownOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).origin.toLowerCase();
      } catch {
        return s;
      }
    });
}

/** Does a CSP source expression (`*`, `https:`, `https://a.b`, `*.b.c`) admit one of our origins? */
function sourceAdmitsOurOrigin(source: string, ours: string[]): boolean {
  const src = source.trim().toLowerCase().replace(/^'|'$/g, '');
  if (!src || src === 'none' || src === 'self') return false;
  if (src === '*') return true;
  // Scheme-only sources admit every origin on that scheme.
  if (/^(https?|\*):$/.test(src)) return true;
  for (const o of ours) {
    let host: string;
    let scheme: string;
    try {
      const u = new URL(o);
      host = u.host;
      scheme = u.protocol.replace(':', '');
    } catch {
      continue;
    }
    // Strip an explicit scheme + trailing path from the source.
    const m = /^(?:([a-z*]+):\/\/)?([^/]+)/.exec(src);
    if (!m) continue;
    const srcScheme = m[1];
    const srcHost = m[2];
    if (srcScheme && srcScheme !== '*' && srcScheme !== scheme) continue;
    if (srcHost === host) return true;
    if (srcHost.startsWith('*.')) {
      const suffix = srcHost.slice(1); // ".example.com"
      if (host.endsWith(suffix) && host.length > suffix.length) return true;
    }
  }
  return false;
}

/**
 * Judge the two framing headers of the FINAL response. Pure; unit-tested.
 * A page with neither header, or with an invalid `X-Frame-Options` value
 * (browsers ignore those), frames fine.
 */
export function parseEmbedPolicy(
  headers: IncomingHttpHeaders | undefined,
  ours: string[] = ownOrigins(),
): {
  embed: 'ok' | 'blocked';
  reason: 'x-frame-options' | 'frame-ancestors' | null;
} {
  // Enforced CSP only — a report-only policy blocks nothing.
  const policies = headerValues(headers, 'content-security-policy');
  for (const policy of policies) {
    for (const directive of policy.split(';')) {
      const parts = directive.trim().split(/\s+/).filter(Boolean);
      if (!parts.length || parts[0].toLowerCase() !== 'frame-ancestors')
        continue;
      const sources = parts.slice(1);
      // `frame-ancestors` with no sources, or 'none', denies everyone.
      const admits = sources.some((s) => sourceAdmitsOurOrigin(s, ours));
      return admits
        ? { embed: 'ok', reason: null }
        : { embed: 'blocked', reason: 'frame-ancestors' };
    }
  }
  const xfo = headerValues(headers, 'x-frame-options')
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  for (const value of xfo) {
    if (value === 'DENY' || value === 'SAMEORIGIN')
      return { embed: 'blocked', reason: 'x-frame-options' };
    if (value.startsWith('ALLOW-FROM')) {
      const uri = value.slice('ALLOW-FROM'.length).trim().toLowerCase();
      let origin = uri;
      try {
        origin = new URL(uri).origin.toLowerCase();
      } catch {
        /* keep the raw value */
      }
      // Modern browsers ignore ALLOW-FROM entirely (it frames). Report it as
      // a block unless it names us, because the site's INTENT is to restrict.
      return ours.includes(origin)
        ? { embed: 'ok', reason: null }
        : { embed: 'blocked', reason: 'x-frame-options' };
    }
  }
  return { embed: 'ok', reason: null };
}

/** `www.example.com` → `example.com`; used when a page declares no name at all. */
function hostAsName(finalUrl: string): string | null {
  try {
    const host = new URL(finalUrl).hostname.replace(/^www\./i, '');
    return host || null;
  } catch {
    return null;
  }
}

function absoluteHttpUrl(
  href: string | undefined,
  base: string,
): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Largest edge of a `sizes` attribute (`"32x32 64x64"` → 64; `"any"` → 64). */
function sizeScore(sizes: string | undefined, href: string): number {
  const s = (sizes || '').toLowerCase().trim();
  if (s === 'any' || /\.svg(\?|$)/i.test(href)) return 64;
  let best = 0;
  for (const m of s.matchAll(/(\d+)x(\d+)/g)) {
    best = Math.max(best, Math.max(Number(m[1]), Number(m[2])));
  }
  return best;
}

/**
 * Name + icon from the document head. Pure; unit-tested. Reads at most the
 * first 512 KB — a homepage's `<head>` is never further in than that.
 */
export function extractSiteMeta(
  html: string,
  finalUrl: string,
): { name: string | null; iconUrl: string | null } {
  const $ = cheerio.load(
    html.length > HTML_PARSE_CAP ? html.slice(0, HTML_PARSE_CAP) : html,
  );
  const meta = (sel: string) => ($(sel).first().attr('content') || '').trim();

  const ogSite =
    meta('meta[property="og:site_name"]') || meta('meta[name="og:site_name"]');
  const appName =
    meta('meta[name="application-name"]') ||
    meta('meta[name="apple-mobile-web-app-title"]');
  const title = ($('title').first().text() || '').replace(/\s+/g, ' ').trim();
  let name: string | null = ogSite || appName || null;
  if (!name && title) name = pickBrandSegment(title, ogSite || null);
  if (!name) name = hostAsName(finalUrl);
  if (name && name.length > 60) name = name.slice(0, 57).trimEnd() + '…';

  // Icon: apple-touch-icon beats a plain icon; among icons the largest wins.
  let bestIcon: { url: string; score: number } | null = null;
  $('link[rel]').each((_, el) => {
    const rel = String($(el).attr('rel') || '').toLowerCase();
    const href = $(el).attr('href');
    if (!href) return;
    let score = -1;
    if (/\bapple-touch-icon(-precomposed)?\b/.test(rel))
      score = 1000 + sizeScore($(el).attr('sizes'), href);
    else if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel))
      score = sizeScore($(el).attr('sizes'), href);
    if (score < 0) return;
    const url = absoluteHttpUrl(href, finalUrl);
    if (!url) return;
    if (!bestIcon || score > bestIcon.score) bestIcon = { url, score };
  });
  let iconUrl: string | null = bestIcon
    ? (bestIcon as { url: string }).url
    : null;
  if (!iconUrl) {
    try {
      iconUrl = new URL('/favicon.ico', finalUrl).toString();
    } catch {
      iconUrl = null;
    }
  }
  return { name, iconUrl };
}

export interface SiteCheckDeps {
  fetch: (
    url: string,
    opts: Parameters<typeof safeFetch>[1],
  ) => Promise<SafeFetchResult>;
}

/**
 * The whole check: normalise, fetch through the SSRF guard, judge the
 * headers, read the head. Never throws — every failure is a result the panel
 * can show in plain words.
 */
export async function checkSite(
  raw: unknown,
  deps: SiteCheckDeps = { fetch: safeFetch },
): Promise<SiteCheckResult> {
  const url = normalizeSiteUrl(raw);
  const base: SiteCheckResult = {
    ok: false,
    url: url ?? (typeof raw === 'string' ? raw.slice(0, 200) : ''),
    finalUrl: null,
    status: null,
    name: null,
    iconUrl: null,
    embed: 'unreachable',
    reason: null,
    contentType: null,
  };
  if (!url) return { ...base, reason: 'invalid-url' };

  let res: SafeFetchResult;
  try {
    res = await deps.fetch(url, {
      timeoutMs: 8000,
      maxBytes: 2 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
  } catch (e) {
    if (e instanceof SsrfError) return { ...base, reason: 'blocked-host' };
    if (e instanceof FetchTooLargeError)
      return { ...base, reason: 'too-large' };
    return { ...base, reason: 'network' };
  }

  const finalUrl = res.finalUrl || url;
  const status = res.status;
  const contentType = res.contentType || null;
  const nameFallback = hostAsName(finalUrl);
  if (status < 200 || status >= 300) {
    return {
      ...base,
      finalUrl,
      status,
      contentType,
      name: nameFallback,
      reason: 'http-status',
    };
  }

  const isHtml = /text\/html|application\/xhtml/i.test(contentType || '');
  const { name, iconUrl } = isHtml
    ? extractSiteMeta(res.body.toString('utf8'), finalUrl)
    : {
        name: nameFallback,
        iconUrl: absoluteHttpUrl('/favicon.ico', finalUrl),
      };
  const policy = parseEmbedPolicy(res.headers);
  return {
    ok: true,
    url,
    finalUrl,
    status,
    name,
    iconUrl,
    embed: policy.embed,
    reason: policy.reason,
    contentType,
  };
}
