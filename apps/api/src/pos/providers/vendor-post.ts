/**
 * Token-endpoint POST for the per-store POS vendors (2026-10-11, launch
 * security re-audit V-1).
 *
 * The Shopify and Lightspeed token endpoints live on a PER-STORE host, so the
 * host is built from a value the merchant (or an attacker) controls. The host
 * validators in shopify.ts / lightspeed.ts pin it to the vendor's own domain;
 * this helper is the second gate: the request carries our platform
 * `client_secret`, so it goes through the SSRF-safe POST (public address only,
 * DNS pinned at connect, ports 80/443, no redirects) and only to a host on the
 * vendor allowlist below. A dev sandbox override (non-production only) is the
 * single exception, because it intentionally points at a local mock server.
 */
import { safeFetchPost } from '../../branding/safe-fetch';

const VENDOR_TOKEN_HOSTS: RegExp[] = [
  /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/,
  /^[a-z0-9-]{1,63}\.retail\.lightspeed\.app$/,
];

export function isAllowedVendorTokenHost(host: string): boolean {
  const h = String(host || '').toLowerCase();
  return VENDOR_TOKEN_HOSTS.some((re) => re.test(h));
}

export interface VendorPostResult {
  ok: boolean;
  status: number;
  text: string;
}

export async function vendorTokenPost(
  url: string,
  opts: { headers: Record<string, string>; body: string; devOverride: boolean },
): Promise<VendorPostResult> {
  if (opts.devOverride && process.env.NODE_ENV !== 'production') {
    const res = await fetch(url, { method: 'POST', headers: opts.headers, body: opts.body });
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => '') };
  }
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port || !isAllowedVendorTokenHost(u.hostname)) {
    throw new Error('POS token host is not an allowed vendor host');
  }
  const res = await safeFetchPost(url, {
    body: opts.body,
    headers: opts.headers,
    captureBody: true,
    maxBytes: 256 * 1024,
    timeoutMs: 10_000,
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, text: res.body || '' };
}
