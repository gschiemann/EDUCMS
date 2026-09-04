/**
 * http.mjs — the measuring HTTP client.
 *
 * node:http only. One keep-alive Agent per simulated venue so the socket
 * behaviour resembles a site's NAT rather than one giant shared pool, and so
 * the `X-Forwarded-For` the API right-counts is stable per venue.
 *
 * Every request is timed from "about to write" to "body fully read" — the same
 * boundary `fetchJsonBounded` uses in the player (player rule 4: a response is
 * not a response until its body is read).
 */

import http from 'node:http';
import { CONFIG } from './env.mjs';

const agents = new Map();

/** What an Android-11 kiosk WebView actually sends. */
export const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36';

export function agentFor(venueIndex) {
  if (!agents.has(venueIndex)) {
    agents.set(
      venueIndex,
      new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30_000,
        maxSockets: CONFIG.maxSocketsPerVenue,
        maxFreeSockets: CONFIG.maxSocketsPerVenue,
      }),
    );
  }
  return agents.get(venueIndex);
}

export function destroyAgents() {
  for (const a of agents.values()) a.destroy();
  agents.clear();
}

/**
 * One request. Resolves with { status, headers, body, ms, error } — it never
 * rejects, because a load driver that throws on a connection reset stops
 * measuring the very thing it is there to measure.
 */
export function request({ apiUrl, method = 'GET', path, headers = {}, body = null, venueIndex = 0, clientIp, timeoutMs = 15_000 }) {
  const url = new URL(path, apiUrl);
  const started = process.hrtime.bigint();
  return new Promise((resolve) => {
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ms, ...out });
    };

    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        agent: agentFor(venueIndex),
        headers: {
          // A User-Agent on EVERY request, overridable per call. Without one,
          // `apps/api/src/security/anomaly.middleware.ts:19` logs
          // "Missing User-Agent" for each one and the run measures a
          // warn-logging path no real kiosk or browser ever takes.
          'user-agent': DEFAULT_UA,
          ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), error: null }),
        );
        res.on('error', (e) => done({ status: res.statusCode ?? 0, headers: res.headers, body: '', error: `body:${e.code || e.message}` }));
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
      done({ status: 0, headers: {}, body: '', error: 'timeout' });
    });
    req.on('error', (e) => done({ status: 0, headers: {}, body: '', error: e.code || e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

export function parseJson(res) {
  if (!res.body) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}
