/**
 * SEC-006 (2026-09-04) — client side of the proxy render capability.
 *
 * `GET /api/v1/proxy/web` is public (it is an iframe `src`; an iframe cannot
 * carry an `Authorization` header), but its CHROMIUM half no longer is: the
 * server only runs the renderer when the request presents a signed, URL-bound
 * capability minted by the authenticated `POST /api/v1/proxy/render-capability`.
 * This module fetches that capability and hands back the `&cap=…` fragment to
 * append to the proxy URL.
 *
 * WHO CAN MINT. Either principal the WEBPAGE widget legitimately runs as:
 *   • an operator session (the builder's live preview) — the JWT the rest of
 *     the dashboard already sends;
 *   • a paired screen (the player) — that screen's device token.
 * The device token is read ONLY to authenticate the MINT request. It never
 * goes into the proxy URL: the proxied frame carries hostile third-party HTML,
 * and `player/page.tsx` + `WidgetRenderer.tsx` both carry standing comments
 * against ever putting a credential where that page can read it. The
 * capability that DOES ride the URL is not a credential — it authorises one
 * already-chosen URL to be rendered, and nothing else.
 *
 * DO NO HARM. Every failure path returns `''`. An un-capped proxy URL still
 * loads: the server takes the `safeFetch` strip-scripts path, which is the
 * same fallback the renderer has always used on a Chromium crash or timeout.
 * A minting outage must degrade a screen, never blank one.
 *
 * The device token is READ-ONLY here. `apps/web/src/app/player/trustGuards.ts`
 * is the single writer of that key (player-reliability rule #3, "one token
 * store per side"); this module must never write it, and never adopt one from
 * a URL.
 */

import { API_URL } from '@/lib/api-url';
import { DEVICE_TOKEN_STORAGE_KEY } from '@/app/player/trustGuards';
import { useUIStore } from '@/store/ui-store';

interface Lease {
  capability: string;
  /** Re-mint at this point rather than riding a capability to its expiry. */
  renewAt: number;
}

/** In-flight mints, keyed by target URL. Single-flight per URL. */
const inflight = new Map<string, Promise<Lease | null>>();
/** Settled leases, keyed by target URL. */
const settled = new Map<string, Lease>();

/**
 * How early to re-mint. The server issues 6 hours; renewing 30 minutes early
 * leaves generous margin on a signage box whose clock can be minutes out of
 * step (the same skew that forced VALUE-identity refresh acks on the player).
 */
const RENEW_MARGIN_MS = 30 * 60_000;

/**
 * Cap on remembered leases. A screen shows a handful of WEBPAGE widgets; a
 * builder session can walk many. Bounded so a long-lived kiosk tab cannot grow
 * this map without limit.
 */
const MAX_LEASES = 64;

/** The operator's session token, when this surface has one. */
function sessionToken(): string | null {
  try {
    const t = useUIStore.getState().token;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

/** The paired screen's device token, when this surface is on one. */
function deviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(DEVICE_TOKEN_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    // Sandboxed / partitioned storage — no credential to offer, which is a
    // legitimate state, not an error.
    return null;
  }
}

function mintUrl(apiRoot: string): string {
  const root = apiRoot.replace(/\/+$/, '');
  const base = root.endsWith('/api/v1') ? root : `${root}/api/v1`;
  return `${base}/proxy/render-capability`;
}

async function mint(url: string, apiRoot: string): Promise<Lease | null> {
  // Session first: in the builder both may be present (an operator previewing
  // on a paired screen's browser), and the operator identity is the more
  // meaningful attribution for a preview render.
  const token = sessionToken() || deviceToken();
  if (!token) return null;
  try {
    const res = await fetch(mintUrl(apiRoot), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { capability?: unknown; expiresAt?: unknown };
    if (typeof body?.capability !== 'string' || !body.capability) return null;
    const expiresAt = Number(body.expiresAt) || Date.now() + 60_000;
    return { capability: body.capability, renewAt: expiresAt - RENEW_MARGIN_MS };
  } catch {
    return null;
  }
}

function leaseIsUsable(lease: Lease | undefined, now: number): lease is Lease {
  return !!lease && now < lease.renewAt;
}

/**
 * The `&cap=…` query fragment for one proxy URL, or `''` when none could be
 * obtained. Safe to append unconditionally.
 */
export async function renderCapabilityParam(
  url: string,
  apiRoot: string = API_URL,
): Promise<string> {
  if (!url || typeof window === 'undefined') return '';
  const now = Date.now();

  let lease = settled.get(url);
  if (!leaseIsUsable(lease, now)) {
    let pending = inflight.get(url);
    if (!pending) {
      pending = mint(url, apiRoot).finally(() => {
        inflight.delete(url);
      });
      inflight.set(url, pending);
    }
    const minted = await pending;
    if (!minted) return '';
    if (settled.size >= MAX_LEASES) {
      // Cheap eviction: drop the oldest insertion. Map preserves order, and a
      // wrongly-evicted lease just costs one extra mint.
      const oldest = settled.keys().next();
      if (!oldest.done) settled.delete(oldest.value);
    }
    settled.set(url, minted);
    lease = minted;
  }
  if (!lease) return '';
  return `&cap=${encodeURIComponent(lease.capability)}`;
}

/** Test-only: drop cached leases between cases. */
export function _resetRenderCapabilityForTests(): void {
  inflight.clear();
  settled.clear();
}
