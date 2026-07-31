/**
 * Storage HTTP transport with a node:https fallback (2026-07-31 incident).
 *
 * Between 2026-07-23 (last successful asset upload) and 2026-07-31, EVERY
 * undici `fetch()` from the Railway prod container to the Supabase Storage
 * host began failing at the network level with the opaque `TypeError: fetch
 * failed` — 100% of upload attempts (verified in deploy logs: every
 * "Upload: bucket=…" line in the 07-31 window is followed by a "fetch
 * failed" warn). Meanwhile node:https requests from the SAME container to
 * OTHER hosts kept working (the branding scraper's safeFetch fetched
 * external sites successfully seconds before the uploads failed), and the
 * IDENTICAL fetch call (same key, same bucket, same Blob+Content-Length
 * shape) succeeds from a dev machine. So: environment × undici specific.
 *
 * Because `fetch failed` hides its real cause in `error.cause`, this module
 * does two things:
 *   1. logs the FULL cause chain (code/errno/AggregateError members) so the
 *      next failure is diagnosable from Railway logs alone, and
 *   2. transparently retries the request over node:https — the transport
 *      this codebase already proves works from the prod container
 *      (safe-fetch.ts made the same undici→node:https move for the scraper;
 *      see its "reverted undici approach crashed boot" comment).
 *
 * `makeStorageFetch` returns a drop-in `fetch`-compatible function used for
 * BOTH the raw Storage REST calls in SupabaseStorageService AND the
 * supabase-js client (`global.fetch`), so signed-URL minting, bucket
 * ensure-at-boot, and deletes ride the same fallback.
 */
import * as https from 'node:https';
import * as http from 'node:http';

/**
 * Process-wide transport health counters, shared by every makeStorageFetch
 * instance (storage service + bug-reporter). The storage watchdog and the
 * /health/storage probe read these to distinguish "healthy", "working but
 * riding the fallback" (primary broken — ALERT), and "down".
 */
export interface StorageTransportState {
  totalPrimaryFailures: number;
  totalFallbackSuccesses: number;
  totalFallbackFailures: number;
  lastPrimaryOkAt: string | null;
  lastPrimaryFailureAt: string | null;
  lastFallbackCause: string | null;
}

export const storageTransportState: StorageTransportState = {
  totalPrimaryFailures: 0,
  totalFallbackSuccesses: 0,
  totalFallbackFailures: 0,
  lastPrimaryOkAt: null,
  lastPrimaryFailureAt: null,
  lastFallbackCause: null,
};

/** Walk an error's cause chain into one diagnosable line. */
export function describeFetchError(e: any): string {
  const parts: string[] = [];
  let cur: any = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    const code = cur.code ?? cur.errno;
    parts.push(`${cur.name ?? 'Error'}: ${cur.message ?? String(cur)}${code ? ` [${code}]` : ''}`);
    if (Array.isArray(cur.errors) && cur.errors.length) {
      parts.push(
        `aggregate(${cur.errors
          .slice(0, 4)
          .map((x: any) => `${x?.code ?? x?.errno ?? x?.message ?? String(x)}`)
          .join(', ')})`,
      );
    }
    cur = cur.cause;
  }
  return parts.join(' ← ');
}

function headersToObject(init?: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  const h = new Headers(init);
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function bodyToBuffer(body: any): Promise<Buffer | null> {
  if (body == null) return null;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== 'undefined' && body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  throw new Error(`storage https-fallback: unsupported body type ${body?.constructor?.name ?? typeof body}`);
}

/**
 * Minimal fetch-over-node:https. Only what the Storage REST API + supabase-js
 * storage client need: string URL, method, headers, buffered body, buffered
 * response, no redirects (the Storage API never 3xxs API calls).
 */
export async function httpsFallbackFetch(input: any, init?: any): Promise<Response> {
  const urlStr: string = typeof input === 'string' ? input : String(input?.url ?? input);
  const url = new URL(urlStr);
  const lib = url.protocol === 'https:' ? https : http;
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = headersToObject(init?.headers);
  const bodyBuf = await bodyToBuffer(init?.body);
  if (bodyBuf) headers['content-length'] = String(bodyBuf.length); // authoritative — overrides any caller value

  return await new Promise<Response>((resolve, reject) => {
    const req = lib.request(
      url,
      // 120s inactivity timeout: large (up to 500MB) server-side uploads keep
      // the socket active while streaming; inactivity — not total time — is
      // the hang signal.
      { method, headers, timeout: 120_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') respHeaders.set(k, v);
            else if (Array.isArray(v)) respHeaders.set(k, v.join(', '));
          }
          // Response() forbids bodies on these statuses.
          const body = [101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
          resolve(
            new Response(body, {
              status,
              statusText: res.statusMessage ?? '',
              headers: respHeaders,
            }),
          );
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('storage https-fallback: socket inactivity timeout'));
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

/** True for undici's network-level failure wrapper (NOT HTTP error statuses —
 *  those come back as normal Responses and must not trigger a retry). */
function isNetworkLevelFetchFailure(e: any): boolean {
  return e instanceof TypeError || e?.name === 'TypeError' || /fetch failed/i.test(String(e?.message ?? ''));
}

/**
 * fetch-compatible transport: global fetch first, node:https on network-level
 * failure. `log` receives one diagnosable line per fallback (cause chain
 * included) — this is what makes the next "fetch failed" debuggable from logs.
 */
export function makeStorageFetch(log: (msg: string) => void): (input: any, init?: any) => Promise<Response> {
  return async (input: any, init?: any): Promise<Response> => {
    try {
      // ROOT CAUSE (captured in prod logs 2026-07-31 20:17 UTC by this very
      // transport): `TypeError: fetch failed ← InvalidArgumentError: invalid
      // content-length header [UND_ERR_INVALID_ARG]`. The upload callsites
      // have always sent a manual 'Content-Length' alongside a Blob body;
      // the newer undici in the 2026-07-30 node:20-alpine rebuild rejects
      // that combination (undici computes the length from the body itself).
      // Strip it for the primary attempt — undici sets the correct value —
      // so the primary path heals instead of permanently riding the
      // fallback. The node:https fallback sets its own authoritative value.
      let primaryInit = init;
      if (init?.headers) {
        const h = new Headers(init.headers);
        if (h.has('content-length')) {
          h.delete('content-length');
          primaryInit = { ...init, headers: h };
        }
      }
      const res = await fetch(input, primaryInit);
      storageTransportState.lastPrimaryOkAt = new Date().toISOString();
      return res;
    } catch (e: any) {
      if (!isNetworkLevelFetchFailure(e)) throw e;
      const cause = describeFetchError(e);
      storageTransportState.totalPrimaryFailures++;
      storageTransportState.lastPrimaryFailureAt = new Date().toISOString();
      storageTransportState.lastFallbackCause = cause;
      const urlStr = typeof input === 'string' ? input : String(input?.url ?? input);
      let host = 'unknown-host';
      try {
        host = new URL(urlStr).host;
      } catch {
        /* keep placeholder */
      }
      log(`storage fetch to ${host} failed at network level — retrying over node:https. Cause: ${cause}`);
      try {
        const res = await httpsFallbackFetch(input, init);
        storageTransportState.totalFallbackSuccesses++;
        log(`storage https-fallback to ${host} succeeded (${res.status})`);
        return res;
      } catch (fallbackErr: any) {
        storageTransportState.totalFallbackFailures++;
        log(`storage https-fallback to ${host} ALSO failed: ${describeFetchError(fallbackErr)}`);
        throw fallbackErr;
      }
    }
  };
}
