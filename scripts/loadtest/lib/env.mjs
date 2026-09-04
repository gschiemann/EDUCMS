/**
 * env.mjs — configuration + THE SAFETY GATE for the 1,000-screen load test.
 *
 * ⚠️ THE ONLY RULE THAT MATTERS HERE: this harness must never be able to touch
 * production. The repo's `.env` files point `DATABASE_URL` at the production
 * Supabase project, so a harness that read them — or that accepted whatever
 * host it was handed — would silently seed 1,000 fake screens into the real
 * fleet and fire real emergency triggers at real tenants.
 *
 * Three defences, all of them fail-closed:
 *   1. NOTHING in this harness loads a `.env` file. Configuration arrives only
 *      from `docker-compose.loadtest.yml` and `run.sh`, both of which declare
 *      container-local connection strings inline.
 *   2. `assertDisposableStack()` parses the resolved database host and REFUSES
 *      to continue unless it is loopback or the compose service name, and
 *      refuses outright on any hint of a managed provider (supabase, rds,
 *      neon, railway, render, planetscale…). It runs at the top of every
 *      entrypoint.
 *   3. The API base URL is checked the same way, so the driver cannot be aimed
 *      at a deployed API even if the database is local.
 *
 * Plain Node, zero dependencies (node: builtins only).
 */

import { URL } from 'node:url';

/** Hosts that can only ever be this machine or the compose network. */
const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
  // compose service names from docker-compose.loadtest.yml
  'pg',
  'redis',
]);

/** Substrings that name a hosted provider. Presence is an immediate refusal. */
const FORBIDDEN_HOST_MARKERS = [
  'supabase',
  'pooler.supabase',
  'amazonaws',
  'rds.',
  'neon.tech',
  'railway.app',
  'railway.internal',
  'render.com',
  'planetscale',
  'vercel.app',
  'upstash',
  'redislabs',
  'azure',
  'gcp',
  'digitalocean',
];

function hostOf(value, label) {
  let host;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`[loadtest] ${label} is not a parseable URL: ${String(value).slice(0, 40)}…`);
  }
  return host.toLowerCase();
}

function assertLocalUrl(value, label) {
  if (!value) throw new Error(`[loadtest] ${label} is not set. Run via scripts/loadtest/run.sh.`);
  const host = hostOf(value, label);
  for (const marker of FORBIDDEN_HOST_MARKERS) {
    if (host.includes(marker)) {
      throw new Error(
        `[loadtest] REFUSING TO RUN: ${label} host "${host}" looks like a hosted provider ` +
          `("${marker}"). This harness only ever runs against the disposable local stack.`,
      );
    }
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `[loadtest] REFUSING TO RUN: ${label} host "${host}" is not local. ` +
        `Allowed: ${[...LOCAL_DB_HOSTS].join(', ')}.`,
    );
  }
  return host;
}

/**
 * Hard gate. Call this FIRST in every entrypoint, before any network or SQL.
 * Returns the validated config; throws (never returns a partial) otherwise.
 */
export function assertDisposableStack() {
  const apiUrl = process.env.LOADTEST_API_URL || 'http://127.0.0.1:58080';
  const dbUrl =
    process.env.LOADTEST_DATABASE_URL ||
    'postgresql://venueos:loadtest_local_only@127.0.0.1:55432/venueos_loadtest';

  const apiHost = assertLocalUrl(apiUrl, 'LOADTEST_API_URL');
  const dbHost = assertLocalUrl(dbUrl, 'LOADTEST_DATABASE_URL');

  // Belt and braces: the production DB name/user must never appear either.
  if (/postgres:\/\/postgres[:@]/.test(dbUrl) && !LOCAL_DB_HOSTS.has(dbHost)) {
    throw new Error('[loadtest] REFUSING TO RUN: database URL looks like a managed default.');
  }

  return { apiUrl, dbUrl, apiHost, dbHost };
}

/** Fleet shape + cadences. Cadences are READ FROM THE PLAYER SOURCE — see README. */
export const CONFIG = {
  /** Screens to simulate. Overridable so a smaller honest run can be reported. */
  screens: Number(process.env.LOADTEST_SCREENS || 1000),
  /** Tenants the fleet is spread across (each is one "venue" = one client IP). */
  tenants: Number(process.env.LOADTEST_TENANTS || 40),
  /** Steady-state measurement window, seconds. */
  steadySeconds: Number(process.env.LOADTEST_STEADY_SECONDS || 180),

  // ── Player cadences, mirrored from apps/web/src/app/player/ ──────────────
  // emergencyRev.ts: REV_POLL_HEALTHY_MS / REV_POLL_FAST_MS / RECONCILE_*_MS
  revPollHealthyMs: 10_000,
  revPollFastMs: 5_000,
  reconcileHealthyMs: 60_000,
  reconcileDegradedMs: 10_000,
  // telemetry.ts: TELEMETRY_INTERVAL_MS
  telemetryIntervalMs: 60_000,

  /** Per-venue keep-alive socket ceiling (never approached at these rates). */
  maxSocketsPerVenue: Number(process.env.LOADTEST_MAX_SOCKETS || 32),

  /** Compose project + service names, for docker exec / restart injections. */
  composeFile: 'docker-compose.loadtest.yml',
  composeProject: 'venueos-loadtest',
};

/**
 * The public address a venue appears to come from. Production shape: a venue
 * shares one NAT address (the API's own throttle comments say exactly this),
 * so 1,000 screens across 40 venues present 40 client IPs, not one.
 */
export function venueIp(tenantIndex) {
  // RFC 5737 TEST-NET-2 (198.51.100.0/24) + TEST-NET-3 (203.0.113.0/24):
  // documentation ranges, so these can never collide with a real address.
  const i = tenantIndex % 508;
  return i < 254 ? `198.51.100.${i + 1}` : `203.0.113.${i - 253}`;
}
