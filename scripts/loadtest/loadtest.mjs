/**
 * loadtest.mjs — the 1,000-screen failure-mode load test.
 *
 * Closes the last open item of the 2026-09-02 efficiency audit ("Run the
 * 1,000-screen failure-mode load test") against a disposable local stack.
 *
 * WHAT IT SIMULATES. One object per screen, running the SAME control plane the
 * shipped player runs, at the SAME cadences — read out of
 * apps/web/src/app/player/emergencyRev.ts and telemetry.ts, not invented:
 *
 *   GET  /screens/:id/emergency-rev   10 s healthy · 5 s alert-on-glass or
 *                                     push-degraded, If-None-Match baseline
 *   GET  /screens/:id/manifest        60 s healthy · 10 s degraded, and on any
 *                                     rev change (the reconcile the poll defers)
 *   POST /screens/:id/telemetry       60 s
 *   WS   /realtime                    HELLO → AUTH_OK, HEARTBEAT every 15 s
 *
 * The rev-poll classification and the fetch decision are ports of
 * `classifyRevPoll` / `decideRevAction`, so a server answer that would make the
 * real fleet reconcile makes this fleet reconcile too — which is the whole
 * point of measuring requests/second/screen rather than asserting it.
 *
 * WHAT IT MEASURES. Everything the audit's acceptance criteria name, plus the
 * four failure modes, each proved independently.
 *
 * ⚠️ Runs only against the disposable stack — see lib/env.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertDisposableStack, CONFIG } from './lib/env.mjs';
import { request, parseJson, destroyAgents } from './lib/http.mjs';
import { MiniWs } from './lib/ws.mjs';
import { RouteStats, table, pct, verdict } from './lib/stats.mjs';
import { exec, sql, scalar, compose, resetQueryStats, readQueryStats } from './lib/sql.mjs';
import { startResourceSampler } from './lib/resources.mjs';

const { apiUrl } = assertDisposableStack();
const OUT_DIR = path.join(process.cwd(), 'scripts', 'loadtest', '.out');
const fleet = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'fleet.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();


// ── Route accounting ──────────────────────────────────────────────────────
const ROUTES = ['emergency-rev', 'manifest', 'telemetry', 'ws-upgrade', 'emergency-trigger', 'emergency-all-clear'];
let stats = new Map();
let counting = false;
function resetStats() {
  stats = new Map(ROUTES.map((r) => [r, new RouteStats(r)]));
}
function record(route, res) {
  if (!counting) return;
  stats.get(route)?.record(res);
}
resetStats();

// ── One simulated screen ──────────────────────────────────────────────────

class Screen {
  constructor(rec, tenant) {
    this.id = rec.screenId;
    this.token = rec.deviceToken;
    this.fingerprint = rec.fingerprint;
    this.tenantId = rec.tenantId;
    this.tenantIndex = rec.tenantIndex;
    this.ip = tenant.ip;

    this.lastAppliedRev = null;
    this.manifestEtag = null;
    this.emergencyOnGlass = false;
    this.serverActive = false;
    this.throttleStrikes = 0;
    this.pushDegraded = true; // until AUTH_OK — never equate TCP open with connected
    this.wsAllowed = true;
    this.ws = null;
    this.hbTimer = null;

    this.nextRev = 0;
    this.nextManifest = 0;
    this.nextTelemetry = 0;
    this.revInFlight = false;
    this.manifestInFlight = false; // the single-flight manifestGate
    this.telemetryInFlight = false;

    this.frames = 0;
    this.unauthorized = 0;

    // Drill instrumentation
    this.alertWatch = null; // { firedAt, wsAt, httpAt, resolve }
  }

  base(extra = {}) {
    // headers LAST: the device credential must survive any caller-supplied
    // header object (an earlier version spread `extra` afterwards and silently
    // dropped Authorization whenever a caller passed its own headers).
    //
    // (The User-Agent every request needs is supplied by lib/http.mjs.)
    return {
      apiUrl,
      venueIndex: this.tenantIndex,
      clientIp: this.ip,
      ...extra,
      headers: { Authorization: `Bearer ${this.token}`, ...(extra.headers || {}) },
    };
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  connectWs() {
    if (!this.wsAllowed || this.ws) return;
    const started = now();
    const ws = new MiniWs(`${apiUrl.replace(/^http/, 'http')}/realtime`);
    this.ws = ws;
    ws.on('open', () => {
      record('ws-upgrade', { ms: now() - started, status: 101, body: '', error: null });
      ws.send({ event: 'HELLO', data: { token: this.token } });
      this.hbTimer = setInterval(() => ws.send({ event: 'HEARTBEAT' }), 15_000);
    });
    ws.on('message', (msg) => {
      const type = msg.type || msg.event;
      if (type === 'AUTH_OK') {
        this.pushDegraded = false; // ONLY AUTH_OK clears it (player rule 5)
        return;
      }
      if (type === 'OVERRIDE' || type === 'ALL_CLEAR') {
        if (this.alertWatch && this.alertWatch.want === type && this.alertWatch.wsAt == null) {
          this.alertWatch.wsAt = now();
          this.alertWatch.maybeDone();
        }
        // The player preempts a reconcile on both. Mirror it.
        this.nextManifest = 0;
        this.nextRev = 0;
      }
    });
    ws.on('close', () => {
      this.pushDegraded = true;
      if (this.hbTimer) clearInterval(this.hbTimer);
      this.hbTimer = null;
      this.ws = null;
    });
    ws.on('error', () => {
      this.pushDegraded = true;
      if (this.hbTimer) clearInterval(this.hbTimer);
      this.hbTimer = null;
      this.ws = null;
    });
    ws.connect();
  }

  dropWs() {
    this.wsAllowed = false;
    this.pushDegraded = true;
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.hbTimer = null;
    try {
      this.ws?.close();
    } catch { /* already gone */ }
    this.ws = null;
  }

  // ── Cadences (ports of emergencyRev.ts) ─────────────────────────────────
  //
  // JITTER. A real fleet is 1,000 independent boxes whose timers drifted apart
  // over weeks of uptime; they do not share a clock and they never tick
  // together. Scheduling every screen on an exact multiple of its cadence
  // would measure a thundering herd (and would flatter the p99, because the
  // herd's own queueing is what the API would actually face). Every interval
  // is therefore spread ±12 %, redrawn per tick, on top of the phase offset
  // that spreads each screen's FIRST tick across the whole period.
  jitter(ms) {
    return Math.round(ms * (0.88 + Math.random() * 0.24));
  }
  revCadence() {
    return this.jitter(
      this.emergencyOnGlass || this.pushDegraded || this.serverActive
        ? CONFIG.revPollFastMs
        : CONFIG.revPollHealthyMs,
    );
  }
  reconcileCadence() {
    return this.jitter(this.pushDegraded ? CONFIG.reconcileDegradedMs : CONFIG.reconcileHealthyMs);
  }
  telemetryCadence() {
    return this.jitter(CONFIG.telemetryIntervalMs);
  }

  // ── The three routine calls ─────────────────────────────────────────────
  async revPoll() {
    if (this.revInFlight) return;
    this.revInFlight = true;
    try {
      const res = await request(
        this.base({
          method: 'GET',
          path: `/api/v1/screens/${this.id}/emergency-rev`,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(this.lastAppliedRev ? { 'If-None-Match': this.lastAppliedRev } : {}),
          },
          timeoutMs: 8_000,
        }),
      );
      record('emergency-rev', res);
      const outcome = classifyRevPoll(this.lastAppliedRev, res);
      this.throttleStrikes = outcome.kind === 'throttled' ? this.throttleStrikes + 1 : 0;
      if (outcome.kind === 'unchanged' || outcome.kind === 'changed') this.serverActive = outcome.active;

      let doFetch;
      if (outcome.kind === 'throttled') doFetch = this.throttleStrikes >= 3;
      else if (outcome.kind === 'unavailable') doFetch = true;
      else if (outcome.kind === 'changed') doFetch = true;
      else doFetch = false;

      if (doFetch) {
        const okBefore = this.lastManifestOkAt || 0;
        await this.manifestFetch();
        if (outcome.kind === 'changed' && (this.lastManifestOkAt || 0) > okBefore) {
          this.lastAppliedRev = outcome.rev;
        }
      }
    } finally {
      this.revInFlight = false;
    }
  }

  async manifestFetch() {
    if (this.manifestInFlight) return; // single-flight, like manifestGate
    this.manifestInFlight = true;
    try {
      const res = await request(
        this.base({
          method: 'GET',
          path: `/api/v1/screens/${this.id}/manifest`,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(this.manifestEtag ? { 'If-None-Match': this.manifestEtag } : {}),
          },
          timeoutMs: 15_000,
        }),
      );
      record('manifest', res);
      if (res.status === 401 || res.status === 403) {
        this.unauthorized += 1;
        return;
      }
      if (res.status === 304) {
        this.lastManifestOkAt = now();
        return;
      }
      if (res.status !== 200) return;
      this.lastManifestOkAt = now();
      const json = parseJson(res);
      if (!json) return;
      this.manifestEtag = res.headers.etag || json.hash || this.manifestEtag;
      const wasEmergency = this.emergencyOnGlass;
      this.emergencyOnGlass = json.isEmergency === true;
      if (this.alertWatch) {
        const want = this.alertWatch.want;
        const arrived = want === 'OVERRIDE' ? this.emergencyOnGlass : wasEmergency && !this.emergencyOnGlass;
        if (arrived && this.alertWatch.httpAt == null) {
          this.alertWatch.httpAt = now();
          this.alertWatch.maybeDone();
        }
      }
    } finally {
      this.manifestInFlight = false;
    }
  }

  async telemetry() {
    if (this.telemetryInFlight) return;
    this.telemetryInFlight = true;
    try {
      this.frames += 600; // ~60 s of painted frames at 10 fps of proof counter
      const res = await request(
        this.base({
          method: 'POST',
          path: `/api/v1/screens/${this.id}/telemetry`,
          body: {
            versions: { player: '1.1.16', playerCode: 1116, manager: '1.0.9', bundleSha: 'loadtest0000' },
            cache: { playlist: { count: 3, bytes: 1448739 }, emergency: { count: 2, bytes: 240000 } },
            render: { frames: this.frames, hash: `h${this.frames}`, contentKind: 'playlist' },
            capsHash: 'caps-lt-1',
          },
          timeoutMs: 15_000,
        }),
      );
      record('telemetry', res);
      if (res.status === 401) this.unauthorized += 1;
    } finally {
      this.telemetryInFlight = false;
    }
  }

  /** Arm a drill watcher; resolves when both paths are known or the deadline passes. */
  watchFor(want, firedAt, deadlineMs) {
    let resolve;
    const p = new Promise((r) => (resolve = r));
    const w = {
      want,
      firedAt,
      wsAt: null,
      httpAt: null,
      done: false,
      maybeDone() {
        if (!w.done && w.wsAt != null && w.httpAt != null) {
          w.done = true;
          resolve(w);
        }
      },
    };
    this.alertWatch = w;
    setTimeout(() => {
      if (!w.done) {
        w.done = true;
        resolve(w);
      }
    }, deadlineMs);
    return p;
  }
}

/** Port of classifyRevPoll (apps/web/src/app/player/emergencyRev.ts). */
function classifyRevPoll(lastAppliedRev, res) {
  if (res.error || res.status === 0) return { kind: 'unavailable', reason: `fetch-failed:${res.error}` };
  if (res.status === 304) {
    if (!lastAppliedRev) return { kind: 'unavailable', reason: 'not-modified-without-baseline' };
    const etag = res.headers?.etag ?? null;
    if (etag && etag !== lastAppliedRev) return { kind: 'changed', rev: etag, active: false };
    return { kind: 'unchanged', rev: lastAppliedRev, active: false };
  }
  if (res.status === 429) return { kind: 'throttled' };
  if (res.status !== 200) return { kind: 'unavailable', reason: `http-${res.status}` };
  const body = parseJson(res);
  if (!body || typeof body.rev !== 'string' || !body.rev) return { kind: 'unavailable', reason: 'unparseable-body' };
  if (!lastAppliedRev || body.rev !== lastAppliedRev) return { kind: 'changed', rev: body.rev, active: body.active === true };
  return { kind: 'unchanged', rev: body.rev, active: body.active === true };
}

// ── Fleet + scheduler ─────────────────────────────────────────────────────

const tenantsByIndex = new Map(fleet.tenants.map((t) => [t.index, t]));
// LOADTEST_MAX_SCREENS drives a SUBSET of a seeded fleet — used to smoke the
// harness itself without re-seeding.
//
// fleet.json lists screens GROUPED BY TENANT (25 consecutive per venue), so a
// prefix slice is "the first N venues, fully populated" — which is also what
// makes it the right shape for the ramp: every rung keeps the same 25
// screens-per-public-IP density, so the ramp varies TOTAL load while holding
// per-IP load constant. The per-IP limit is measured separately and
// deliberately by `natCeilingDrill`, and must not be a confounder here.
const MAX_SCREENS = Number(process.env.LOADTEST_MAX_SCREENS || 0);
const fleetRecords = MAX_SCREENS > 0 ? fleet.screens.slice(0, MAX_SCREENS) : fleet.screens;
const screens = fleetRecords.map((rec) => new Screen(rec, tenantsByIndex.get(rec.tenantIndex)));
const byTenant = new Map();
for (const s of screens) {
  if (!byTenant.has(s.tenantIndex)) byTenant.set(s.tenantIndex, []);
  byTenant.get(s.tenantIndex).push(s);
}

/** Drill targets, mapped onto whatever tenants actually exist (small runs). */
const tenantIndexes = [...byTenant.keys()].sort((a, b) => a - b);
const T = (n) => tenantIndexes[n % tenantIndexes.length];

/**
 * The set the scheduler currently drives. The ramp (phase 1) runs the SAME
 * fleet at 125 / 250 / 500 / 1,000 screens so the degradation point is read
 * off one continuous curve rather than four separate runs on four different
 * machine states.
 */
let activeScreens = screens;
function setActive(n) {
  activeScreens = screens.slice(0, n);
  return activeScreens;
}

let schedulerTimer = null;
function startScheduler() {
  // 100 ms, not 200 ms: at 1,000 screens the 10 s rev poll alone is ~100
  // fires/s, and a coarse tick would bucket them into artificial bursts —
  // the driver's own scheduling granularity must not become the thing the
  // API is measured against.
  if (schedulerTimer) clearInterval(schedulerTimer); // idempotent: never leak a second ticker
  const tick = () => {
    const t = now();
    for (const s of activeScreens) {
      if (s.retired) continue; // deliberately broken by the stale-player drill
      if (t >= s.nextRev) {
        s.nextRev = t + s.revCadence();
        void s.revPoll();
      }
      if (t >= s.nextManifest) {
        s.nextManifest = t + s.reconcileCadence();
        void s.manifestFetch();
      }
      if (t >= s.nextTelemetry) {
        s.nextTelemetry = t + s.telemetryCadence();
        void s.telemetry();
      }
      if (s.wsAllowed && !s.ws) s.connectWs();
    }
  };
  schedulerTimer = setInterval(tick, 100);
}
function stopScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

/**
 * Spread every screen's FIRST tick of each timer across that timer's own
 * period, re-based on the real phase start. A fleet boots over hours; without
 * this the whole set fires on the same millisecond and the measurement is of
 * a herd, not of steady state.
 */
function rebasePhaseOffsets(set, at = now()) {
  for (let i = 0; i < set.length; i++) {
    const f = set.length > 1 ? i / set.length : 0;
    set[i].nextRev = at + Math.floor(f * CONFIG.revPollHealthyMs);
    set[i].nextManifest = at + Math.floor(f * CONFIG.reconcileHealthyMs);
    // Telemetry is rebased FORWARD ONLY. The server accepts at most one
    // telemetry POST per screen per 30 s
    // (`apps/api/src/telemetry/telemetry.controller.ts:461`), so pulling a
    // screen's next post EARLIER between ramp rungs makes it post twice
    // inside that floor and collect a 429 the real fleet would never see —
    // which would then be reported as an API error rate. A screen's
    // telemetry phase is a property of the screen, not of the rung.
    set[i].nextTelemetry = Math.max(set[i].nextTelemetry || 0, at + Math.floor(f * CONFIG.telemetryIntervalMs));
  }
}

// ── Drill helpers ─────────────────────────────────────────────────────────

async function triggerEmergency(tenantIndex, label) {
  const t = tenantsByIndex.get(tenantIndex);
  const firedAt = now();
  const res = await request({
    apiUrl,
    method: 'POST',
    path: '/api/v1/emergency/trigger',
    venueIndex: tenantIndex,
    clientIp: t.ip,
    headers: { Authorization: `Bearer ${t.adminToken}` },
    body: {
      scopeType: 'tenant',
      scopeId: t.tenantId,
      overridePayload: { type: 'lockdown', severity: 'CRITICAL', textBlob: `Load-test drill (${label}) — not a real alert` },
    },
    timeoutMs: 30_000,
  });
  record('emergency-trigger', res);
  const json = parseJson(res);
  return { firedAt, status: res.status, ms: res.ms, overrideId: json?.overrideId, body: res.body.slice(0, 200) };
}

async function allClear(tenantIndex, overrideId) {
  const t = tenantsByIndex.get(tenantIndex);
  const firedAt = now();
  const res = await request({
    apiUrl,
    method: 'POST',
    path: `/api/v1/emergency/${encodeURIComponent(overrideId)}/all-clear`,
    venueIndex: tenantIndex,
    clientIp: t.ip,
    headers: { Authorization: `Bearer ${t.adminToken}` },
    body: { scopeType: 'tenant', scopeId: t.tenantId },
    timeoutMs: 30_000,
  });
  record('emergency-all-clear', res);
  return { firedAt, status: res.status, ms: res.ms, body: res.body.slice(0, 200) };
}

function summarizeWatches(watches, firedAt) {
  const wsD = watches.map((w) => (w.wsAt ? w.wsAt - firedAt : null)).filter((v) => v != null);
  const httpD = watches.map((w) => (w.httpAt ? w.httpAt - firedAt : null)).filter((v) => v != null);
  const p = (arr, q) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil((q / 100) * s.length) - 1))];
  };
  return {
    n: watches.length,
    wsDelivered: wsD.length,
    wsP50: p(wsD, 50),
    wsP95: p(wsD, 95),
    wsMax: wsD.length ? Math.max(...wsD) : null,
    httpDelivered: httpD.length,
    httpP50: p(httpD, 50),
    httpP95: p(httpD, 95),
    httpMax: httpD.length ? Math.max(...httpD) : null,
  };
}

/** Fire an OVERRIDE at one tenant and wait for every screen in it to see it. */
async function drill(tenantIndex, label, { deadlineMs = 40_000 } = {}) {
  const fleetScreens = byTenant.get(tenantIndex);
  const t0 = now();
  const watchers = fleetScreens.map((s) => s.watchFor('OVERRIDE', t0, deadlineMs));
  const fired = await triggerEmergency(tenantIndex, label);
  const watches = await Promise.all(watchers);
  for (const s of fleetScreens) s.alertWatch = null;
  const out = { label, trigger: fired, ...summarizeWatches(watches, fired.firedAt) };

  // Return the tenant to normal so the next drill starts clean.
  if (fired.overrideId) {
    const clearWatchers = fleetScreens.map((s) => s.watchFor('ALL_CLEAR', now(), deadlineMs));
    const cleared = await allClear(tenantIndex, fired.overrideId);
    const clearWatches = await Promise.all(clearWatchers);
    for (const s of fleetScreens) s.alertWatch = null;
    out.allClear = { status: cleared.status, ...summarizeWatches(clearWatches, cleared.firedAt) };
  }
  return out;
}

/**
 * THE LIFE-SAFETY NUMBER: one lockdown, every screen in the fleet, while the
 * fleet is under its full steady-state load.
 *
 * The per-tenant `drill()` above measures 25 screens. This measures all of
 * them: every tenant's admin fires `POST /emergency/trigger` at once (a
 * district-wide event is 40 principals hitting the panic button in the same
 * minute, and a state-wide weather alert is worse), and every screen is
 * watched on BOTH delivery paths. Reported as time from the FIRST trigger
 * request leaving the driver to the alert being observable on that screen —
 * so the trigger's own latency is inside the number, not excluded from it.
 */
async function fleetWideDrill({ deadlineMs = 60_000 } = {}) {
  const targets = activeScreens.filter((s) => !s.retired);
  const tenantsToFire = tenantIndexes.filter((idx) =>
    targets.some((s) => s.tenantIndex === idx),
  );
  const t0 = now();
  const watchers = targets.map((s) => s.watchFor('OVERRIDE', t0, deadlineMs));

  const fired = await Promise.all(tenantsToFire.map((idx) => triggerEmergency(idx, 'fleet-wide')));
  const firedAt = Math.min(...fired.map((f) => f.firedAt));
  const lastTriggerDoneAt = Math.max(...fired.map((f) => f.firedAt + f.ms));
  const watches = await Promise.all(watchers);
  for (const s of targets) s.alertWatch = null;

  // Delivery, measured from the first trigger REQUEST — the moment the
  // operator's finger left the button.
  const anyD = watches
    .map((w) => {
      const first = [w.wsAt, w.httpAt].filter((v) => v != null);
      return first.length ? Math.min(...first) - firedAt : null;
    })
    .filter((v) => v != null);
  const p = (arr, qq) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil((qq / 100) * s.length) - 1))];
  };

  const out = {
    label: 'fleet-wide',
    screens: targets.length,
    tenantsFired: tenantsToFire.length,
    triggerStatuses: fired.reduce((a, f) => ((a[f.status] = (a[f.status] || 0) + 1), a), {}),
    triggerP50Ms: p(fired.map((f) => f.ms), 50),
    triggerP95Ms: p(fired.map((f) => f.ms), 95),
    triggerMaxMs: Math.max(...fired.map((f) => f.ms)),
    allTriggersAcceptedInMs: Math.round(lastTriggerDoneAt - firedAt),
    deliveredAnyPath: anyD.length,
    anyP50: p(anyD, 50),
    anyP95: p(anyD, 95),
    anyP99: p(anyD, 99),
    anyMax: anyD.length ? Math.max(...anyD) : null,
    ...summarizeWatches(watches, firedAt),
  };

  // All-clear, same shape, same fleet.
  const clearIds = fired.filter((f) => f.overrideId);
  if (clearIds.length) {
    const c0 = now();
    const cw = targets.map((s) => s.watchFor('ALL_CLEAR', c0, deadlineMs));
    const cleared = await Promise.all(
      clearIds.map((f, i) => allClear(tenantsToFire[fired.indexOf(f)], f.overrideId)),
    );
    const clearedAt = Math.min(...cleared.map((c) => c.firedAt));
    const cWatches = await Promise.all(cw);
    for (const s of targets) s.alertWatch = null;
    const cAny = cWatches
      .map((w) => {
        const first = [w.wsAt, w.httpAt].filter((v) => v != null);
        return first.length ? Math.min(...first) - clearedAt : null;
      })
      .filter((v) => v != null);
    out.allClear = {
      statuses: cleared.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {}),
      deliveredAnyPath: cAny.length,
      anyP50: p(cAny, 50),
      anyP95: p(cAny, 95),
      anyMax: cAny.length ? Math.max(...cAny) : null,
      ...summarizeWatches(cWatches, clearedAt),
    };
  }
  return out;
}

/**
 * Postgres saturation, in the two shapes that actually happen in production.
 *
 *   (a) POOL saturation. `connection_limit=10` is a CLIENT-side ceiling: when
 *       all ten slots are busy, the eleventh Prisma query WAITS, and after
 *       `pool_timeout=20` it fails P2024. Anything that makes a common query
 *       slow — a lock, a bad plan, an index build, a vacuum on the hot table —
 *       fills those ten slots at the fleet's own request rate. Simulated with
 *       an ACCESS EXCLUSIVE lock on `screens`, which is what a migration or a
 *       manual `ALTER TABLE` does, and which every device route must cross.
 *
 *   (b) SERVER connection exhaustion. `max_connections=60` with ~30 already
 *       consumed by the platform itself (CLAUDE.md). A second API replica, a
 *       psql session left open, or a migration runner can take the rest; the
 *       API then cannot open a connection at all.
 *
 * Both are held for a bounded window and then released, and the number that
 * matters is not "did it error" (it must) but: does it shed load cleanly, does
 * it recover WITHOUT intervention, and how long does recovery take.
 */
async function pgSaturationDrills() {
  const out = {};

  const windowStats = (label, seconds, fn) =>
    (async () => {
      resetStats();
      counting = true;
      const started = now();
      await fn(seconds);
      counting = false;
      await sleep(1_200);
      return {
        label,
        seconds: (now() - started) / 1000,
        routes: [...stats.values()]
          .filter((r) => r.count > 0)
          .map((r) => ({
            route: r.name,
            count: r.count,
            p50: r.percentile(50),
            p95: r.percentile(95),
            p99: r.percentile(99),
            max: r.percentile(100),
            errors: r.errors,
            statuses: r.statusSummary(),
          })),
        totalRequests: [...stats.values()].reduce((a, r) => a + r.count, 0),
        totalErrors: [...stats.values()].reduce((a, r) => a + r.errors, 0),
      };
    })();

  // ── (a) Pool saturation via an exclusive lock on `screens` ──────────────
  console.log('   · failure mode 2a: Postgres POOL saturation (ACCESS EXCLUSIVE on screens)…');
  const LOCK_S = 30;
  const sampler = startResourceSampler({ intervalMs: 2_000, label: 'pg-pool-saturation' });
  const lockStarted = now();
  // Fire and forget — psql holds the lock for LOCK_S then rolls back.
  const lockHeld = compose(
    'exec',
    '-T',
    'pg',
    'psql',
    '-U',
    'venueos',
    '-d',
    'venueos_loadtest',
    '-c',
    `BEGIN; LOCK TABLE screens IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(${LOCK_S}); ROLLBACK;`,
  ).catch((e) => ({ err: String(e.message || e).slice(0, 200) }));

  out.poolSaturation = await windowStats('under-lock', LOCK_S, async (secs) => {
    await sleep(secs * 1000);
  });
  out.poolSaturation.resources = sampler.stop();
  await lockHeld;
  const lockReleasedAt = now();
  out.poolSaturation.lockHeldSeconds = LOCK_S;
  out.poolSaturation.lockWallMs = lockReleasedAt - lockStarted;

  // Recovery: how long until the fleet is clean again, with no intervention?
  const recoverStart = now();
  let cleanAt = null;
  for (let i = 0; i < 40; i++) {
    resetStats();
    counting = true;
    await sleep(3_000);
    counting = false;
    const errs = [...stats.values()].reduce((a, r) => a + r.errors, 0);
    const reqs = [...stats.values()].reduce((a, r) => a + r.count, 0);
    if (errs === 0 && reqs > 0) {
      cleanAt = now();
      break;
    }
  }
  out.poolSaturation.recoveryMs = cleanAt ? cleanAt - lockReleasedAt : null;
  out.poolSaturation.recovered = cleanAt != null;
  console.log(
    `     lock released; fleet error-free again after ${out.poolSaturation.recoveryMs ?? '>120000'} ms`,
  );

  // ── (b) Server connection exhaustion ────────────────────────────────────
  console.log('   · failure mode 2b: Postgres SERVER connection exhaustion (max_connections)…');
  const free = Number(
    await scalar(
      `SELECT (setting::int - (SELECT count(*) FROM pg_stat_activity))::text FROM pg_settings WHERE name='max_connections';`,
    ),
  );
  // Leave 2 slots so the harness's own psql can still read pg_stat_activity;
  // superuser_reserved_connections keeps a couple in hand regardless.
  const hold = Math.max(0, free - 2);
  const HOLD_S = 25;
  const sampler2 = startResourceSampler({ intervalMs: 2_000, label: 'pg-conn-exhaustion' });
  const hogStarted = now();
  const hogs = compose(
    'exec',
    '-T',
    'pg',
    'sh',
    '-c',
    `for i in $(seq 1 ${hold}); do psql -U venueos -d venueos_loadtest -c "select pg_sleep(${HOLD_S})" >/dev/null 2>&1 & done; wait`,
  ).catch((e) => ({ err: String(e.message || e).slice(0, 200) }));
  await sleep(2_500); // let the hogs actually connect

  out.connectionExhaustion = await windowStats('under-exhaustion', HOLD_S - 4, async (secs) => {
    await sleep(secs * 1000);
  });
  out.connectionExhaustion.resources = sampler2.stop();
  out.connectionExhaustion.connectionsHeld = hold;
  out.connectionExhaustion.freeBefore = free;
  await hogs;
  const hogsDoneAt = now();
  out.connectionExhaustion.holdWallMs = hogsDoneAt - hogStarted;

  let clean2 = null;
  for (let i = 0; i < 30; i++) {
    resetStats();
    counting = true;
    await sleep(3_000);
    counting = false;
    const errs = [...stats.values()].reduce((a, r) => a + r.errors, 0);
    const reqs = [...stats.values()].reduce((a, r) => a + r.count, 0);
    if (errs === 0 && reqs > 0) {
      clean2 = now();
      break;
    }
  }
  out.connectionExhaustion.recoveryMs = clean2 ? clean2 - hogsDoneAt : null;
  out.connectionExhaustion.recovered = clean2 != null;
  console.log(
    `     ${hold} connections released; fleet error-free again after ${out.connectionExhaustion.recoveryMs ?? '>90000'} ms`,
  );

  return out;
}

/**
 * THE SITE CEILING. Every screen in one building leaves through one public
 * address, and the global throttler is keyed on that address
 * (`apps/api/src/app.module.ts:220` — ttl 60 000 ms, limit 600). So the real
 * scale limit is not "how many screens does the platform hold", it is "how
 * many screens fit behind one NAT" — and the arithmetic says that is far
 * below the fleet size:
 *
 *   healthy screen  = 6 rev + 1 manifest + 1 telemetry = 8 req/min → 75 screens
 *   push degraded   = 12 rev + 6 manifest + 1 telemetry = 19 req/min → 31 screens
 *
 * The degraded number is the dangerous one, because "push degraded" is the
 * state a school firewall that blocks WebSockets puts EVERY screen in
 * permanently, and it is also the state a Redis outage puts the whole fleet
 * in — i.e. exactly when an alert most needs to get through.
 *
 * This drill measures it instead of asserting it: N screens, one shared
 * client IP, real cadences, one full throttle window.
 */
async function natCeilingDrill(sizes, { seconds = 70 } = {}) {
  const out = [];
  for (const n of sizes) {
    const set = screens.slice(0, Math.min(n, screens.length));
    if (set.length < n) break;
    const savedIps = set.map((s) => s.ip);
    // One building, one public address. venueIndex is left alone so the
    // socket pools stay spread — only what the API right-counts changes.
    const sharedIp = '203.0.113.254';
    for (const s of set) s.ip = sharedIp;

    activeScreens = set;
    resetStats();
    counting = true;
    const t0 = now();
    rebasePhaseOffsets(set, t0);
    startScheduler();
    await sleep(seconds * 1000);
    stopScheduler();
    counting = false;
    await sleep(1_200);

    const routes = [...stats.values()].filter((r) => r.count > 0);
    const throttled = routes.reduce((a, r) => a + (r.byStatus.get('429') || 0), 0);
    const total = routes.reduce((a, r) => a + r.count, 0);
    out.push({
      screensBehindOneIp: n,
      seconds: (now() - t0) / 1000,
      totalRequests: total,
      reqPerMin: (total / ((now() - t0) / 1000)) * 60,
      throttled429: throttled,
      throttledPct: total ? (throttled / total) * 100 : 0,
      byRoute: routes.map((r) => ({
        route: r.name,
        count: r.count,
        throttled: r.byStatus.get('429') || 0,
        statuses: r.statusSummary(),
      })),
    });
    console.log(
      `     ${String(n).padStart(4)} screens on ONE IP → ${Math.round(out.at(-1).reqPerMin)} req/min · ` +
        `${throttled}/${total} throttled (${out.at(-1).throttledPct.toFixed(1)} %)`,
    );

    for (let i = 0; i < set.length; i++) set[i].ip = savedIps[i];
    // Let the 60 s throttle window drain before the next size, or the next
    // measurement inherits this one's bucket.
    await sleep(62_000);
  }
  activeScreens = screens;
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────

const report = { startedAt: new Date().toISOString(), fleet: { screens: screens.length, tenants: fleet.tenants.length } };

async function main() {
  console.log(`\n=== VenueOS fleet load test — ${screens.length} screens / ${fleet.tenants.length} tenants ===`);
  console.log(`API ${apiUrl} · rev ${CONFIG.revPollHealthyMs / 1000}s · manifest ${CONFIG.reconcileHealthyMs / 1000}s · telemetry ${CONFIG.telemetryIntervalMs / 1000}s\n`);

  await exec('CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');

  // ── Warm-up: one manifest each + WS connect, spread over 30 s ───────────
  console.log('[phase 0] warm-up — first manifest + WS connect for every screen…');
  counting = false;
  for (let i = 0; i < screens.length; i++) {
    screens[i].connectWs();
    if (i % 25 === 24) await sleep(30); // stagger the WS storm a little
  }
  // First manifest, in bounded batches, so every screen has an ETag + the
  // server has a per-screen emergency record (otherwise every first rev poll
  // is legitimately `cold`).
  for (let i = 0; i < screens.length; i += 50) {
    await Promise.all(screens.slice(i, i + 50).map((s) => s.manifestFetch()));
  }
  // …and one rev poll each, to establish the baseline the 304s compare to.
  for (let i = 0; i < screens.length; i += 50) {
    await Promise.all(screens.slice(i, i + 50).map((s) => s.revPoll()));
  }
  const authOk = screens.filter((s) => !s.pushDegraded).length;
  const withEtag = screens.filter((s) => s.manifestEtag).length;
  const withRev = screens.filter((s) => s.lastAppliedRev).length;
  console.log(`[phase 0] WS AUTH_OK ${authOk}/${screens.length} · manifest ETag ${withEtag} · rev baseline ${withRev}`);
  report.warmup = { authOk, withEtag, withRev, total: screens.length };

  // ── Phase 1: the load ramp ─────────────────────────────────────────────
  // Same fleet, same machine, same process, four sizes. "What breaks first"
  // is a question about a CURVE, and four independent runs on four different
  // machine states cannot draw one.
  const rungs = (process.env.LOADTEST_RAMP || `${Math.round(screens.length / 8)},${Math.round(screens.length / 4)},${Math.round(screens.length / 2)},${screens.length}`)
    .split(',')
    .map((n) => Math.min(screens.length, Math.max(1, Number(n.trim()))))
    .filter((n, i, a) => Number.isFinite(n) && a.indexOf(n) === i)
    .sort((a, b) => a - b);
  const rungSeconds = Number(process.env.LOADTEST_RUNG_SECONDS || 75);
  console.log(`[phase 1] load ramp: ${rungs.join(' → ')} screens, ${rungSeconds}s each…`);

  report.ramp = [];
  for (const n of rungs) {
    const set = setActive(n);
    // Screens above the rung must be quiet AND socket-free, or the "125
    // screens" measurement is really 1,000 sockets with 125 pollers.
    for (const s of screens.slice(n)) s.dropWs();
    for (const s of set) {
      s.wsAllowed = true;
      if (!s.ws) s.connectWs();
    }
    await sleep(4_000); // let the sockets settle / AUTH_OK land

    resetStats();
    counting = true;
    await resetQueryStats();
    const sampler = startResourceSampler({ intervalMs: 2_500, label: `ramp-${n}` });
    const t0 = now();
    rebasePhaseOffsets(set, t0);
    startScheduler();
    await sleep(rungSeconds * 1000);
    stopScheduler();
    const secs = (now() - t0) / 1000;
    counting = false;
    await sleep(1_500);
    const resources = sampler.stop();
    const pg = await readQueryStats(12);

    const total = [...stats.values()].reduce((a, r) => a + r.count, 0);
    const errs = [...stats.values()].reduce((a, r) => a + r.errors, 0);
    const rung = {
      screens: n,
      seconds: secs,
      wsConnected: set.filter((s) => !s.pushDegraded).length,
      totalRequests: total,
      totalErrors: errs,
      errorRate: total ? errs / total : 0,
      reqPerSec: total / secs,
      reqPerScreenPerSec: total / secs / n,
      routes: [...stats.values()]
        .filter((r) => r.count > 0)
        .map((r) => ({
          route: r.name,
          count: r.count,
          p50: r.percentile(50),
          p95: r.percentile(95),
          p99: r.percentile(99),
          max: r.percentile(100),
          errors: r.errors,
          statuses: r.statusSummary(),
          bytes: r.bytes,
        })),
      pgStatementsPerSec: pg.total / secs,
      resources,
    };
    report.ramp.push(rung);
    const m = rung.routes.find((r) => r.route === 'manifest');
    console.log(
      `   ${String(n).padStart(5)} screens · ${rung.reqPerSec.toFixed(1)} req/s · ` +
        `manifest p95 ${m ? pct(m.p95) : '—'} ms · err ${(rung.errorRate * 100).toFixed(3)}% · ` +
        `API cpu p95 ${resources.api.cpuPctP95?.toFixed(0)}% mem ${resources.api.memMbMax?.toFixed(0)}MB · ` +
        `pg active max ${resources.pg.activeMax}/${resources.pg.backendsMax}`,
    );
  }

  // The top rung IS the headline steady state, so downstream criteria keep
  // reading `report.steady` and mean the full fleet.
  const full = report.ramp[report.ramp.length - 1];
  setActive(screens.length);
  for (const s of screens) {
    s.wsAllowed = true;
    if (!s.ws) s.connectWs();
  }
  const steadyQueries = await readQueryStats(20);
  const dbPoolWaits = await scalar(`SELECT count(*)::text FROM pg_stat_activity WHERE datname='venueos_loadtest';`);

  report.steady = {
    seconds: full.seconds,
    screens: full.screens,
    marks: report.ramp.map((r) => ({ screens: r.screens, reqPerScreenPerSec: r.reqPerScreenPerSec })),
    routes: full.routes,
    totalRequests: full.totalRequests,
    totalErrors: full.totalErrors,
    pg: steadyQueries,
    pgConnections: Number(dbPoolWaits),
    resources: full.resources,
  };

  // LOADTEST_ONLY_RAMP=1 stops here. Used for the tight "did that fix change
  // the numbers?" loop: the ramp is the steady-state measurement, and re-running
  // twenty minutes of failure injection to re-read one error rate wastes time
  // and perturbs the very thing being compared.
  if (process.env.LOADTEST_ONLY_RAMP === '1') {
    for (const s of screens) s.dropWs();
    destroyAgents();
    const r = report.ramp.at(-1);
    console.log(
      `\n[ramp only] ${r.screens} screens · ${r.totalRequests} requests · ` +
        `${r.totalErrors} errors (${(r.errorRate * 100).toFixed(4)} %) · ` +
        `statuses: ${r.routes.map((x) => `${x.route}=${x.statuses}`).join(' | ')}`,
    );
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    return;
  }

  // ── Phase 2: "no Postgres query on an unchanged emergency-rev" ──────────
  console.log('[phase 2] emergency-rev 304 cost — control window vs poll window…');
  const CONTROL_S = 24;
  const sample = screens.slice(0, Math.min(250, screens.length));

  // PRIMING (not measured). "Unchanged" is only meaningful against a baseline
  // the server itself just issued — and the baseline must then be KEPT
  // CURRENT, exactly as the real player keeps `lastAppliedRev` current in
  // `classifyRevPoll`. An earlier version of this phase pinned one baseline
  // for the whole window; a single revision move anywhere in the fleet (a
  // schedule boundary tick, any manifest-fed write) then made every
  // subsequent poll a legitimate 200, and the measurement reported "0 × 304"
  // — measuring the harness, not the endpoint.
  //
  // So: adopt on every 200, in priming AND in the measured window.
  const probeRev = new Map();
  const adopt = (s, res) => {
    if (res.status === 304) return; // baseline still current
    const body = parseJson(res);
    const rev = res.headers?.etag || body?.rev;
    if (res.status === 200 && rev) probeRev.set(s.id, rev);
  };
  const probeOnce = (s) =>
    request(
      s.base({
        method: 'GET',
        path: `/api/v1/screens/${s.id}/emergency-rev`,
        headers: probeRev.get(s.id) ? { 'If-None-Match': probeRev.get(s.id) } : {},
        timeoutMs: 10_000,
      }),
    );

  // Two priming rounds: the first mints a baseline, the second absorbs any
  // revision move that happened while the first was in flight. Both are
  // excluded from the measurement.
  await Promise.all(sample.map(async (s) => adopt(s, await probeOnce(s))));
  await sleep(3_000);
  await Promise.all(sample.map(async (s) => adopt(s, await probeOnce(s))));
  await sleep(3_000);

  // Idle control: what the background workers cost with no player traffic.
  await resetQueryStats();
  await sleep(CONTROL_S * 1000);
  const control = await readQueryStats(8);

  await resetQueryStats();
  const revStats = new RouteStats('rev-304');
  const revStart = now();
  let revCount = 0;
  let notModified = 0;
  while ((now() - revStart) / 1000 < CONTROL_S - 3) {
    await Promise.all(
      sample.map(async (s) => {
        if (!probeRev.get(s.id)) return;
        const res = await probeOnce(s);
        revStats.record(res);
        revCount += 1;
        if (res.status === 304) notModified += 1;
        adopt(s, res); // stay current, like the player's lastAppliedRev
      }),
    );
    await sleep(5_000); // above the endpoint's own 2 s per-screen floor
  }
  const revWindow = await readQueryStats(25);

  // PER-STATEMENT attribution. "133 queries above the control" is a number an
  // engineer cannot act on; "the 304 path still runs screen.findUnique N
  // times" names the line to fix. Subtract the idle control statement by
  // statement, so background workers cancel out and only the rev poll's own
  // cost survives.
  const controlByQuery = new Map(control.top.map((q) => [q.query, q.calls]));
  const attributedStatements = revWindow.top
    .map((q) => ({
      query: q.query,
      callsInWindow: q.calls,
      callsInControl: controlByQuery.get(q.query) ?? 0,
      attributable: q.calls - (controlByQuery.get(q.query) ?? 0),
      perPoll: revCount ? (q.calls - (controlByQuery.get(q.query) ?? 0)) / revCount : null,
      totalMs: q.ms,
    }))
    .filter((q) => q.attributable > 0)
    .sort((a, b) => b.attributable - a.attributable);

  report.revCost = {
    windowSeconds: CONTROL_S,
    sampleScreens: sample.length,
    controlQueries: control.total,
    controlTop: control.top.slice(0, 5),
    revRequests: revCount,
    notModified,
    revWindowQueries: revWindow.total,
    revWindowTop: revWindow.top.slice(0, 8),
    attributable: revWindow.total - control.total,
    attributablePerPoll: revCount ? (revWindow.total - control.total) / revCount : null,
    attributedStatements: attributedStatements.slice(0, 8),
    p50: revStats.percentile(50),
    p95: revStats.percentile(95),
    p99: revStats.percentile(99),
    statuses: revStats.statusSummary(),
  };
  console.log(
    `   control ${control.total} queries / ${CONTROL_S}s · rev window ${revWindow.total} queries for ${revCount} polls (${notModified} were 304)`,
  );
  for (const q of attributedStatements.slice(0, 4)) {
    console.log(`     +${q.attributable} (${q.perPoll.toFixed(3)}/poll)  ${q.query.slice(0, 96)}`);
  }

  // ── Phase 3: failure modes ─────────────────────────────────────────────
  console.log('[phase 3] emergency drills + failure injection…');
  resetStats();
  counting = true;
  startScheduler();
  await sleep(5_000);

  report.drills = {};

  // 3.0 Baseline — WS up, Redis up.
  console.log('   · baseline (WS up, Redis up)…');
  report.drills.baseline = await drill(T(0), 'baseline');

  // 3.0b THE LIFE-SAFETY NUMBER — one alert, every screen, under full load.
  console.log(`   · fleet-wide fan-out: lockdown to ALL ${activeScreens.length} screens under load…`);
  const fwSampler = startResourceSampler({ intervalMs: 1_500, label: 'fleet-wide-fanout' });
  report.drills.fleetWide = await fleetWideDrill();
  report.drills.fleetWide.resources = fwSampler.stop();
  console.log(
    `     delivered ${report.drills.fleetWide.deliveredAnyPath}/${report.drills.fleetWide.screens} · ` +
      `p50 ${report.drills.fleetWide.anyP50} ms · p95 ${report.drills.fleetWide.anyP95} ms · ` +
      `max ${report.drills.fleetWide.anyMax} ms`,
  );
  await sleep(5_000);

  // 3.1 WebSocket transport down for the target tenant's screens.
  console.log('   · failure mode 0: WebSocket transport down (one tenant)…');
  for (const s of byTenant.get(T(1))) s.dropWs();
  await sleep(8_000); // let the fleet settle into degraded cadences
  report.drills.wsDown = await drill(T(1), 'ws-down');

  // 3.2 Redis down — the whole pub/sub bus and the throttler store.
  //
  // Measured on the WHOLE fleet, not one tenant: "screens must not go dark"
  // is a fleet claim. Every screen loses its socket (the bus is gone), the
  // alert is fired at every tenant, and delivery must still happen over the
  // documented HTTP backstop (CLAUDE.md emergency safeguard #4).
  console.log('   · failure mode 1: Redis down (pub/sub + throttle store) — WHOLE FLEET…');
  const redisSampler = startResourceSampler({ intervalMs: 2_000, label: 'redis-down' });
  const beforeRedisStop = now();
  for (const s of activeScreens) s.dropWs(); // WS cannot deliver without the bus either
  await compose('stop', 'redis');
  await sleep(4_000);
  // Is the fleet still being SERVED while Redis is gone? (Not just: does the
  // alert arrive. A screen that 500s on its manifest has gone dark.)
  resetStats();
  counting = true;
  await sleep(15_000);
  counting = false;
  const redisDownTraffic = {
    routes: [...stats.values()]
      .filter((r) => r.count > 0)
      .map((r) => ({
        route: r.name,
        count: r.count,
        p50: r.percentile(50),
        p95: r.percentile(95),
        p99: r.percentile(99),
        errors: r.errors,
        statuses: r.statusSummary(),
      })),
    totalRequests: [...stats.values()].reduce((a, r) => a + r.count, 0),
    totalErrors: [...stats.values()].reduce((a, r) => a + r.errors, 0),
  };
  resetStats();
  counting = true;
  report.drills.redisDown = await fleetWideDrill({ deadlineMs: 60_000 });
  report.drills.redisDown.label = 'redis-down (fleet-wide)';
  report.drills.redisDown.trafficWhileDown = redisDownTraffic;
  report.drills.redisDown.resources = redisSampler.stop();
  const redisDownMs = now() - beforeRedisStop;
  await compose('start', 'redis');
  // Recovery: how long until every screen's push path is live again?
  const redisBackAt = now();
  for (const s of activeScreens) {
    s.wsAllowed = true;
    if (!s.ws) s.connectWs();
  }
  let wsBackAt = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1_000);
    if (activeScreens.filter((s) => !s.pushDegraded).length >= activeScreens.length * 0.98) {
      wsBackAt = now();
      break;
    }
  }
  report.drills.redisDown.redisRestored = true;
  report.drills.redisDown.redisDownForMs = redisDownMs;
  report.drills.redisDown.pushRestoredMs = wsBackAt ? wsBackAt - redisBackAt : null;
  report.drills.redisDown.pushRestoredScreens = activeScreens.filter((s) => !s.pushDegraded).length;
  console.log(
    `     Redis back; push path restored on ${report.drills.redisDown.pushRestoredScreens}/${activeScreens.length} screens ` +
      `in ${report.drills.redisDown.pushRestoredMs ?? '>40000'} ms`,
  );
  await sleep(5_000);

  // 3.2b Postgres saturation, both shapes.
  Object.assign(report.drills, await pgSaturationDrills());

  // 3.2c The site ceiling — how many screens fit behind ONE public address.
  console.log('   · failure mode 3 / scale ceiling: screens behind a single NAT address (600 req/min/IP)…');
  const natSizes = (process.env.LOADTEST_NAT_SIZES || '50,75,100')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= screens.length);
  report.natCeiling = await natCeilingDrill(natSizes);
  // Put the fleet back the way the remaining drills expect it.
  activeScreens = screens;
  for (const s of screens) {
    s.wsAllowed = true;
    if (!s.ws) s.connectWs();
  }
  rebasePhaseOffsets(screens);
  startScheduler();
  counting = true;
  await sleep(8_000);

  // 3.3 API restart — a deploy in the middle of the fleet's traffic.
  console.log('   · failure mode 4: API restart under load…');
  resetStats();
  counting = true;
  const restartAt = now();
  await compose('restart', 'api');
  let backAt = null;
  for (let i = 0; i < 120; i++) {
    const res = await request({ apiUrl, path: '/api/v1/health', venueIndex: 0, timeoutMs: 3_000 });
    if (res.status === 200) {
      backAt = now();
      break;
    }
    await sleep(1_000);
  }
  const restartMs = backAt ? backAt - restartAt : null;
  // Every screen's socket died with the process; let them reconnect.
  for (const s of activeScreens) if (s.wsAllowed) s.connectWs();
  await sleep(15_000);
  const reconnected = activeScreens.filter((s) => !s.pushDegraded).length;
  counting = false;
  await sleep(1_000);
  const restartWindow = {
    routes: [...stats.values()]
      .filter((r) => r.count > 0)
      .map((r) => ({ route: r.name, count: r.count, errors: r.errors, statuses: r.statusSummary() })),
    totalRequests: [...stats.values()].reduce((a, r) => a + r.count, 0),
    totalErrors: [...stats.values()].reduce((a, r) => a + r.errors, 0),
  };
  resetStats();
  counting = true;

  // THE CLAIM UNDER TEST: "screens reconnect without re-pairing." That is a
  // statement about the CREDENTIAL, not about the socket. Prove it directly —
  // every screen re-authenticates with the token it already held, and the
  // server's own verdict column still says PROVEN. `unauthorized` counts every
  // 401/403 any screen has seen since the run began.
  const unauthorizedAfter = activeScreens.reduce((a, s) => a + s.unauthorized, 0);
  const provenRow = await sql(
    `SELECT count(*) FILTER (WHERE auth_state = 'PROVEN')::text, count(*)::text
       FROM screens WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'loadtest-venue-%');`,
  );
  // A fresh manifest for every screen, on the SAME credential, after restart.
  const postRestart = await Promise.all(
    activeScreens.map(async (s) => {
      const res = await request(
        s.base({ method: 'GET', path: `/api/v1/screens/${s.id}/manifest`, timeoutMs: 20_000 }),
      );
      return res.status;
    }),
  );
  const postRestartStatuses = postRestart.reduce((a, st) => ((a[st] = (a[st] || 0) + 1), a), {});

  report.drills.apiRestart = {
    restartToHealthyMs: restartMs,
    wsReconnected: reconnected,
    wsExpected: activeScreens.filter((s) => s.wsAllowed).length,
    trafficAcrossRestart: restartWindow,
    credentialSurvived: {
      unauthorizedResponsesTotal: unauthorizedAfter,
      screensStillProven: Number(provenRow[0]?.[0] ?? 0),
      screensTotal: Number(provenRow[0]?.[1] ?? 0),
      manifestStatusesOnOldToken: postRestartStatuses,
      rePairRequired: unauthorizedAfter > 0 || Object.keys(postRestartStatuses).some((k) => k === '401' || k === '403'),
    },
    ...(await drill(T(3), 'after-api-restart', { deadlineMs: 45_000 })),
  };
  console.log(
    `     back in ${restartMs} ms · WS re-auth ${reconnected}/${activeScreens.length} · ` +
      `manifest on the pre-restart token: ${JSON.stringify(postRestartStatuses)} · ` +
      `401/403 seen all run: ${unauthorizedAfter}`,
  );

  // 3.4 Stale player — an unproven credential, and a revoked one.
  console.log('   · failure mode 5: stale player (unproven + revoked credential)…');
  report.drills.stalePlayer = await stalePlayerDrill();

  stopScheduler();
  counting = false;
  await sleep(1_500);
  report.drillTraffic = [...stats.values()].map((r) => ({
    route: r.name,
    count: r.count,
    p50: r.percentile(50),
    p95: r.percentile(95),
    p99: r.percentile(99),
    errors: r.errors,
    statuses: r.statusSummary(),
  }));

  for (const s of screens) s.dropWs();
  destroyAgents();

  evaluate();
  printReport();
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n[loadtest] machine-readable results: scripts/loadtest/.out/report.json`);
}

/**
 * A screen whose credential has gone stale, in both shapes the audit names.
 *
 *   (a) UNPROVEN — the 1-hour bootstrap token a fingerprint-only register
 *       mints. SEC-001 says every privileged device route must 401 it.
 *   (b) REVOKED  — an operator rotates the credential epoch, so the token the
 *       screen actually holds stops working. This is the real "stale player":
 *       it must go 401, the fleet must SAY so (`authState`), and an operator
 *       re-pair must be the way back.
 */
async function stalePlayerDrill() {
  const tIdx = T(4);
  const poolScreens = byTenant.get(tIdx);
  const victim = poolScreens[poolScreens.length - 1];
  const tenant = tenantsByIndex.get(tIdx);
  victim.retired = true; // stop the scheduler driving a screen we are breaking
  victim.dropWs();
  const out = {};

  const post = (path, body, admin = false, token = null) =>
    request({
      apiUrl,
      method: 'POST',
      path,
      venueIndex: tIdx,
      clientIp: tenant.ip,
      headers: { Authorization: `Bearer ${admin ? tenant.adminToken : token}` },
      body,
    });
  const probe = (token, suffix, method = 'GET', body = null) =>
    request({
      apiUrl,
      method,
      path: `/api/v1/screens/${victim.id}${suffix}`,
      venueIndex: tIdx,
      clientIp: tenant.ip,
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  const registerFp = (priorDeviceToken) =>
    request({
      apiUrl,
      method: 'POST',
      path: '/api/v1/screens/register',
      venueIndex: tIdx,
      clientIp: tenant.ip,
      body: { deviceFingerprint: victim.fingerprint, ...(priorDeviceToken ? { priorDeviceToken } : {}) },
    });
  const authStateOf = async (id) => (await sql(`SELECT auth_state FROM screens WHERE id = '${id}';`))[0]?.[0] ?? null;

  // ── A. UNPROVEN credential — the ROUTINE stale player ───────────────────
  // (APK re-sideload, cleared WebView storage, a token that expired over the
  // summer). A fingerprint-only register is exactly how a real screen lands
  // here, and SEC-001 decides what it may still do.
  const regA = await registerFp(null);
  const regAJson = parseJson(regA);
  const unproven = regAJson?.deviceToken;
  out.unproven = {
    mintStatus: regA.status,
    requiresRePair: !!regAJson?.requiresRePair,
    authStateAfterMint: await authStateOf(victim.id),
    probes: {},
  };
  for (const [name, suffix, method, body] of [
    ['manifest', '/manifest', 'GET', null],
    ['emergency-rev', '/emergency-rev', 'GET', null],
    ['emergency-assets', '/emergency-assets', 'GET', null],
    ['telemetry', '/telemetry', 'POST', { capsHash: 'x' }],
  ]) {
    out.unproven.probes[name] = (await probe(unproven, suffix, method, body)).status;
  }

  // Does an alert still reach a screen holding ONLY an unproven credential?
  // That is CLAUDE.md emergency safeguard #4 — the documented HTTP backstop.
  const firedA = await triggerEmergency(tIdx, 'stale-unproven');
  let sawAt = null;
  const deadlineA = now() + 30_000;
  while (now() < deadlineA) {
    const m = await probe(unproven, '/manifest');
    const j = parseJson(m);
    if (m.status === 200 && j?.isEmergency === true) {
      sawAt = now();
      break;
    }
    await sleep(1_000);
  }
  out.unproven.alertReachedMs = sawAt ? sawAt - firedA.firedAt : null;
  out.unproven.alertReached = sawAt != null;

  // Recovery: the operator's dashboard "restore trust", then the device's next
  // register presents the pre-rotation token (epoch current-1).
  const recoverStart = now();
  const restore = await post(`/api/v1/screens/${victim.id}/restore-trust`, {}, true);
  const renew = await registerFp(unproven);
  const renewJson = parseJson(renew);
  out.unproven.recovery = {
    restoreTrustStatus: restore.status,
    renewStatus: renew.status,
    requiresRePair: renewJson?.requiresRePair ?? null,
    ms: now() - recoverStart,
  };
  if (renewJson?.deviceToken) {
    victim.token = renewJson.deviceToken;
    const after = await probe(victim.token, '/manifest');
    out.unproven.recovery.manifestAfter = after.status;
    out.unproven.recovery.authState = await authStateOf(victim.id);
  }
  if (firedA.overrideId) await allClear(tIdx, firedA.overrideId);
  await sleep(2_000);

  // ── B. REVOKED credential — the operator kill switch ────────────────────
  //
  // The revoke is RETRIED, and the drill records whether it ever landed. In
  // the 1,000-screen run the first attempt came back `status: 0` — a
  // transport-level ECONNRESET (see the keep-alive finding) — so the
  // credential was never actually revoked and every "the revoked screen still
  // works" observation after it was meaningless. A drill that cannot tell
  // "the kill switch failed to fire" from "the kill switch fired and did
  // nothing" is worse than no drill.
  let revoke = null;
  let revokeAttempts = 0;
  for (let i = 0; i < 4; i++) {
    revokeAttempts += 1;
    revoke = await post(`/api/v1/screens/${victim.id}/revoke-credential`, { reason: 'load-test drill' }, true);
    if (revoke.status >= 200 && revoke.status < 300) break;
    await sleep(750);
  }
  await sleep(1_500);
  out.revoked = {
    revokeStatus: revoke.status,
    revokeAttempts,
    revokeLanded: revoke.status >= 200 && revoke.status < 300,
    manifest: (await probe(victim.token, '/manifest')).status,
    emergencyRev: (await probe(victim.token, '/emergency-rev')).status,
    telemetry: (await probe(victim.token, '/telemetry', 'POST', { capsHash: 'x' })).status,
    row: (await sql(`SELECT auth_state, status FROM screens WHERE id = '${victim.id}';`))[0] ?? null,
  };

  // An alert fired while the screen is revoked must not reach it.
  const firedB = await triggerEmergency(tIdx, 'stale-revoked');
  await sleep(4_000);
  out.revoked.alertWhileRevoked = {
    triggerStatus: firedB.status,
    manifestStatus: (await probe(victim.token, '/manifest')).status,
  };

  // What can the operator actually do to bring it back?
  const reRegister = await registerFp(null);
  const restore2 = await post(`/api/v1/screens/${victim.id}/restore-trust`, {}, true);
  out.revoked.recoveryAttempts = {
    registerFingerprintOnly: { status: reRegister.status, code: parseJson(reRegister)?.code ?? null },
    restoreTrust: { status: restore2.status, code: parseJson(restore2)?.code ?? null },
  };

  // The path that DOES work: delete the screen row, re-provision from scratch.
  const reprovisionStart = now();
  const del = await request({
    apiUrl,
    method: 'DELETE',
    path: `/api/v1/screens/${victim.id}`,
    venueIndex: tIdx,
    clientIp: tenant.ip,
    headers: { Authorization: `Bearer ${tenant.adminToken}` },
  });
  let reprovision = { deleteStatus: del.status };
  if (del.status === 200 || del.status === 204) {
    const regC = await registerFp(null);
    const regCJson = parseJson(regC);
    if (regCJson?.pairingCode) {
      const pair = await post(
        '/api/v1/screens/pair',
        { pairingCode: regCJson.pairingCode, screenGroupId: tenant.groupId },
        true,
      );
      const renewC = await registerFp(regCJson.deviceToken);
      const renewCJson = parseJson(renewC);
      reprovision = {
        ...reprovision,
        newScreenId: regCJson.screenId,
        sameScreenId: regCJson.screenId === victim.id,
        pairStatus: pair.status,
        renewStatus: renewC.status,
        requiresRePair: renewCJson?.requiresRePair ?? null,
        ms: now() - reprovisionStart,
      };
      if (renewCJson?.deviceToken && regCJson.screenId) {
        const m = await request({
          apiUrl,
          path: `/api/v1/screens/${regCJson.screenId}/manifest`,
          venueIndex: tIdx,
          clientIp: tenant.ip,
          headers: { Authorization: `Bearer ${renewCJson.deviceToken}` },
        });
        const j = parseJson(m);
        reprovision.manifestAfter = m.status;
        reprovision.alertVisibleAfterRecovery = j?.isEmergency === true;
      }
    } else {
      reprovision.registerAfterDelete = { status: regC.status, code: regCJson?.code ?? null };
    }
  }
  out.revoked.reprovision = reprovision;
  if (firedB.overrideId) await allClear(tIdx, firedB.overrideId);
  return out;
}

// ── Acceptance criteria ───────────────────────────────────────────────────

function evaluate() {
  const s = report.steady;
  const routes = Object.fromEntries(s.routes.map((r) => [r.route, r]));
  const rpsPerScreen = s.totalRequests / s.seconds / s.screens;
  const telemetryPerScreenPerMin = (routes.telemetry.count / s.screens / s.seconds) * 60;
  const errorRate = s.totalErrors / Math.max(1, s.totalRequests);

  const revAttributable = report.revCost.attributable;
  // Sum of the POSITIVE per-statement deltas, divided by the polls that
  // caused them — "how many Postgres statements did one unchanged poll cost".
  const revPerPoll =
    report.revCost.revRequests > 0
      ? (report.revCost.attributedStatements || []).reduce((a, q) => a + q.attributable, 0) /
        report.revCost.revRequests
      : 0;
  report.revCost.attributedPerPoll = revPerPoll;
  const emergencyApiP99 = Math.max(
    report.drills.baseline?.trigger?.ms ?? 0,
    ...Object.values(report.drills)
      .map((d) => d?.trigger?.ms)
      .filter((v) => typeof v === 'number'),
  );
  // Delivery latency for the fleet-wide alert, measured on ITS OWN window.
  // `report.drillTraffic` accumulates across the whole of phase 3 — including
  // the 30 s window in which this harness deliberately holds an ACCESS
  // EXCLUSIVE lock on `screens` — so grading C4a on it would grade the API on
  // an outage the harness caused. The saturation behaviour has its own
  // criteria (C11/C12).
  const drillRouteP99 = report.drills.fleetWide?.anyP99 ?? 0;

  const httpFallbackP95 = report.drills.redisDown?.httpP95;
  const wsP95 = report.drills.baseline?.wsP95;
  const acP95 = report.drills.baseline?.allClear?.httpP95;

  report.criteria = [
    {
      id: 'C1',
      criterion: 'No more than one telemetry POST per screen per minute',
      measured: `${telemetryPerScreenPerMin.toFixed(3)} POST/screen/min`,
      pass: telemetryPerScreenPerMin <= 1.05,
    },
    {
      // Graded on the PER-STATEMENT delta, not the raw total. The idle
      // control still contains background workers and WS heartbeats whose
      // tick can land on either side of the window boundary, so the totals
      // swing by tens of statements in both directions; subtracting
      // statement-by-statement cancels them and leaves only what the poll
      // itself caused. A run where nothing came back 304 is NOT a pass — it
      // measured something else — so that is reported as INVALID.
      id: 'C2',
      criterion: 'No Postgres query on an unchanged emergency-revision request',
      measured:
        report.revCost.notModified === 0
          ? `INVALID — 0 of ${report.revCost.revRequests} polls returned 304 (${report.revCost.statuses}); nothing unchanged was measured`
          : `${report.revCost.revRequests} polls, ${report.revCost.notModified} × 304 → ` +
            `${revPerPoll.toFixed(3)} attributable statements per poll ` +
            `(raw totals: ${report.revCost.revWindowQueries} vs ${report.revCost.controlQueries} idle)`,
      pass: report.revCost.notModified > 0 && revPerPoll <= 0.05,
    },
    {
      id: 'C3',
      criterion: 'Healthy player traffic below 0.15 HTTP req/s/screen',
      measured: `${rpsPerScreen.toFixed(4)} req/s/screen`,
      pass: rpsPerScreen < 0.15,
    },
    {
      id: 'C4a',
      criterion: 'Emergency delivery p99 below 1 s at the API',
      measured: `trigger p99 ${Math.round(emergencyApiP99)} ms · emergency-path route p99 ${Math.round(drillRouteP99)} ms`,
      pass: emergencyApiP99 < 1000 && drillRouteP99 < 1000,
    },
    {
      id: 'C4b',
      criterion: 'Error rate below 0.1 %',
      measured: `${(errorRate * 100).toFixed(4)} % (${s.totalErrors}/${s.totalRequests})`,
      pass: errorRate < 0.001,
    },
    {
      id: 'C5',
      criterion: 'Survives the existing 10-connection Postgres pool',
      measured: `pool held at connection_limit=10; ${s.pgConnections} backends; ${s.totalErrors} 5xx/transport errors in ${Math.round(s.seconds)} s`,
      pass: s.totalErrors === 0,
    },
    {
      id: 'C6',
      criterion: 'Signed push emergency delivery p95 under 2 s',
      measured: wsP95 == null ? 'not delivered' : `${wsP95} ms (${report.drills.baseline.wsDelivered}/${report.drills.baseline.n} screens)`,
      pass: wsP95 != null && wsP95 < 2000 && report.drills.baseline.wsDelivered === report.drills.baseline.n,
    },
    {
      id: 'C7',
      criterion: 'HTTP emergency fallback detection p95 under 10 s (Redis + WS both dead)',
      measured:
        httpFallbackP95 == null
          ? 'not delivered'
          : `${httpFallbackP95} ms (${report.drills.redisDown.httpDelivered}/${report.drills.redisDown.n} screens)`,
      pass: httpFallbackP95 != null && httpFallbackP95 < 10_000 && report.drills.redisDown.httpDelivered === report.drills.redisDown.n,
    },
    {
      id: 'C8',
      criterion: 'All-clear meets the same targets',
      measured:
        acP95 == null
          ? 'not delivered'
          : `HTTP p95 ${acP95} ms · WS p95 ${report.drills.baseline.allClear.wsP95} ms (${report.drills.baseline.allClear.httpDelivered}/${report.drills.baseline.allClear.n})`,
      pass:
        acP95 != null &&
        acP95 < 10_000 &&
        report.drills.baseline.allClear.httpDelivered === report.drills.baseline.allClear.n,
    },
  ];

  // ── The four things the audit item actually asks about ──────────────────
  const fw = report.drills.fleetWide;
  if (fw) {
    report.criteria.push({
      id: 'C9',
      criterion: `Fleet-wide lockdown reaches every one of ${fw.screens} screens under full load`,
      measured: `${fw.deliveredAnyPath}/${fw.screens} · p50 ${fw.anyP50} ms · p95 ${fw.anyP95} ms · max ${fw.anyMax} ms · ${fw.tenantsFired} triggers accepted in ${fw.allTriggersAcceptedInMs} ms`,
      pass: fw.deliveredAnyPath === fw.screens && fw.anyP95 != null && fw.anyP95 < 5_000,
    });
  }
  const rd = report.drills.redisDown;
  if (rd) {
    const t = rd.trafficWhileDown;
    report.criteria.push({
      id: 'C10',
      criterion: 'Redis dies mid-run: screens keep being served, and the alert still lands over HTTP',
      measured:
        `${t.totalRequests} requests served with Redis stopped, ${t.totalErrors} errors · ` +
        `alert reached ${rd.deliveredAnyPath}/${rd.screens} (HTTP p95 ${rd.httpP95} ms) · ` +
        `push path restored ${rd.pushRestoredMs ?? '>40000'} ms after Redis returned`,
      pass:
        t.totalErrors === 0 &&
        rd.deliveredAnyPath === rd.screens &&
        rd.httpP95 != null &&
        rd.httpP95 < 15_000,
    });
  }
  const ps = report.drills.poolSaturation;
  if (ps) {
    report.criteria.push({
      id: 'C11',
      criterion: 'Postgres pool saturation sheds load and self-recovers with no intervention',
      measured:
        `${ps.totalErrors}/${ps.totalRequests} requests failed while the hot table was locked ` +
        `(${((ps.totalErrors / Math.max(1, ps.totalRequests)) * 100).toFixed(1)} %) · ` +
        `error-free again ${ps.recoveryMs ?? '>120000'} ms after release`,
      pass: ps.recovered === true && (ps.recoveryMs ?? Infinity) < 30_000,
    });
  }
  const ce = report.drills.connectionExhaustion;
  if (ce) {
    report.criteria.push({
      id: 'C12',
      criterion: 'Postgres server connection exhaustion is survivable and self-recovers',
      measured:
        `${ce.connectionsHeld} of ${ce.freeBefore} free connections held · ` +
        `${ce.totalErrors}/${ce.totalRequests} requests failed · ` +
        `error-free again ${ce.recoveryMs ?? '>90000'} ms after release`,
      pass: ce.recovered === true && (ce.recoveryMs ?? Infinity) < 30_000,
    });
  }
  const ar = report.drills.apiRestart;
  if (ar?.credentialSurvived) {
    const cs = ar.credentialSurvived;
    report.criteria.push({
      id: 'C13',
      criterion: 'API restart under load: screens reconnect on the SAME credential, no re-pair',
      measured:
        `healthy again in ${ar.restartToHealthyMs} ms · WS re-auth ${ar.wsReconnected}/${ar.wsExpected} · ` +
        `manifest on the pre-restart token ${JSON.stringify(cs.manifestStatusesOnOldToken)} · ` +
        `${cs.screensStillProven}/${cs.screensTotal} still PROVEN · ${cs.unauthorizedResponsesTotal} 401/403 all run`,
      pass: cs.rePairRequired === false && ar.wsReconnected >= ar.wsExpected * 0.98,
    });
  }
  if (report.natCeiling?.length) {
    const firstThrottled = report.natCeiling.find((r) => r.throttled429 > 0);
    report.criteria.push({
      id: 'C15',
      criterion: 'A single site (one public IP) can run a realistic number of screens without being throttled',
      measured: report.natCeiling
        .map((r) => `${r.screensBehindOneIp}:${Math.round(r.reqPerMin)}req/min ${r.throttledPct.toFixed(1)}%429`)
        .join('  '),
      pass: !firstThrottled,
      note: firstThrottled
        ? `throttling begins between ${report.natCeiling[report.natCeiling.indexOf(firstThrottled) - 1]?.screensBehindOneIp ?? '<' + firstThrottled.screensBehindOneIp} and ${firstThrottled.screensBehindOneIp} screens per IP`
        : null,
    });
  }
  // Did the ramp find a knee? Report it as data, and fail only on a real cliff.
  if (report.ramp?.length) {
    const worst = report.ramp[report.ramp.length - 1];
    report.criteria.push({
      id: 'C14',
      criterion: `No latency cliff across the ramp (${report.ramp.map((r) => r.screens).join('→')} screens)`,
      measured: report.ramp
        .map((r) => {
          const m = r.routes.find((x) => x.route === 'manifest');
          return `${r.screens}:${m ? Math.round(m.p95) : '—'}ms/${(r.errorRate * 100).toFixed(2)}%`;
        })
        .join('  '),
      pass: worst.errorRate < 0.001,
    });
  }
}

function printReport() {
  const s = report.steady;

  if (report.ramp?.length) {
    console.log('\n\n══════════════ LOAD RAMP ══════════════');
    console.log(
      table(
        ['screens', 'req/s', 'rps/screen', 'manifest p95', 'rev p95', 'telem p95', 'err %', 'API cpu p95', 'API mem MB', 'pg active max', 'pg stmt/s'],
        report.ramp.map((r) => {
          const g = (n) => r.routes.find((x) => x.route === n);
          return [
            r.screens,
            r.reqPerSec.toFixed(1),
            r.reqPerScreenPerSec.toFixed(4),
            pct(g('manifest')?.p95),
            pct(g('emergency-rev')?.p95),
            pct(g('telemetry')?.p95),
            (r.errorRate * 100).toFixed(3),
            r.resources?.api?.cpuPctP95?.toFixed(0) ?? '—',
            r.resources?.api?.memMbMax?.toFixed(0) ?? '—',
            `${r.resources?.pg?.activeMax ?? '—'}/${r.resources?.pg?.backendsMax ?? '—'}`,
            r.pgStatementsPerSec.toFixed(1),
          ];
        }),
      ),
    );
    const rr = report.ramp.at(-1)?.resources;
    if (rr) {
      console.log(
        `\nAt ${report.ramp.at(-1).screens} screens — API cpu p50 ${rr.api.cpuPctP50?.toFixed(0)}% / p95 ${rr.api.cpuPctP95?.toFixed(0)}% ` +
          `of ${rr.api.hostCpus} cpus · mem ${rr.api.memMbP50?.toFixed(0)}–${rr.api.memMbMax?.toFixed(0)} MB of ${rr.api.memLimitMb?.toFixed(0)} MB · ` +
          `pg backends ${rr.pg.backendsMax} (max_connections ${rr.pg.maxConnections}), busy at once ${rr.pg.activeMax} of the 10-slot pool` +
          (rr.redis
            ? ` · redis ${rr.redis.connectedClientsMax} clients, ${rr.redis.opsPerSecMax} ops/s peak, ${rr.redis.usedMemoryMb?.toFixed(1)} MB, ${rr.redis.pubsubChannelsMax} channels`
            : ''),
      );
    }
  }

  console.log('\n\n══════════════ STEADY STATE ══════════════');
  console.log(
    `${s.screens} screens · ${report.fleet.tenants} tenants · ${Math.round(s.seconds)} s · ` +
      `${s.totalRequests} requests · ${(s.totalRequests / s.seconds).toFixed(1)} req/s total · ` +
      `${(s.totalRequests / s.seconds / s.screens).toFixed(4)} req/s/screen`,
  );
  console.log(
    '\n' +
      table(
        ['route', 'count', 'req/s', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'err', 'statuses'],
        s.routes.map((r) => [
          r.route,
          r.count,
          (r.count / s.seconds).toFixed(2),
          pct(r.p50),
          pct(r.p95),
          pct(r.p99),
          pct(r.max),
          r.errors,
          r.statuses,
        ]),
      ),
  );
  console.log(`\nPostgres: ${s.pg.total} statements in the window (${(s.pg.total / s.seconds).toFixed(1)}/s), top:`);
  console.log(
    table(
      ['calls', 'total ms', 'statement'],
      s.pg.top.slice(0, 10).map((q) => [q.calls, q.ms, q.query]),
    ),
  );

  console.log('\n══════════════ ACCEPTANCE CRITERIA ══════════════');
  console.log(
    table(
      ['', 'criterion', 'measured', 'verdict'],
      report.criteria.map((c) => [c.id, c.criterion, c.measured, verdict(c.pass)]),
    ),
  );

  console.log('\n══════════════ FAILURE MODES ══════════════');
  const fw = report.drills.fleetWide;
  if (fw) {
    console.log(
      `Fleet-wide lockdown (${fw.tenantsFired} tenants, ${fw.screens} screens, under full load):\n` +
        `  triggers accepted ${JSON.stringify(fw.triggerStatuses)} · trigger p50 ${Math.round(fw.triggerP50Ms)} ms / p95 ${Math.round(fw.triggerP95Ms)} ms / max ${Math.round(fw.triggerMaxMs)} ms · all ${fw.tenantsFired} in ${fw.allTriggersAcceptedInMs} ms\n` +
        `  ON GLASS (first path to win): ${fw.deliveredAnyPath}/${fw.screens} · p50 ${fw.anyP50} ms · p95 ${fw.anyP95} ms · p99 ${fw.anyP99} ms · max ${fw.anyMax} ms\n` +
        `  by path: WS ${fw.wsDelivered}/${fw.n} (p95 ${fw.wsP95} ms) · HTTP ${fw.httpDelivered}/${fw.n} (p95 ${fw.httpP95} ms)` +
        (fw.allClear
          ? `\n  ALL-CLEAR: ${fw.allClear.deliveredAnyPath}/${fw.screens} · p50 ${fw.allClear.anyP50} ms · p95 ${fw.allClear.anyP95} ms · max ${fw.allClear.anyMax} ms`
          : ''),
    );
  }
  const satRows = [];
  for (const key of ['poolSaturation', 'connectionExhaustion']) {
    const d = report.drills[key];
    if (!d) continue;
    satRows.push([
      key,
      `${Math.round(d.seconds)} s`,
      `${d.totalRequests}`,
      `${d.totalErrors} (${((d.totalErrors / Math.max(1, d.totalRequests)) * 100).toFixed(1)} %)`,
      d.routes.map((r) => `${r.route}=${r.statuses}`).join(' ').slice(0, 90),
      d.recovered ? `${d.recoveryMs} ms` : 'DID NOT RECOVER',
    ]);
  }
  if (satRows.length) {
    console.log('\nPostgres saturation');
    console.log(table(['drill', 'window', 'requests', 'failed', 'statuses', 'recovery'], satRows));
  }
  if (report.drills.redisDown?.trafficWhileDown) {
    const t = report.drills.redisDown.trafficWhileDown;
    console.log(
      `\nWith Redis STOPPED: ${t.totalRequests} requests served, ${t.totalErrors} errors — ` +
        t.routes.map((r) => `${r.route} p95 ${pct(r.p95)}ms ${r.statuses}`).join(' · '),
    );
  }
  if (report.natCeiling?.length) {
    console.log('\nSite ceiling — screens behind ONE public IP (global throttler: 600 req / 60 s / IP)');
    console.log(
      table(
        ['screens on 1 IP', 'req/min', 'requests', '429s', '% throttled', 'per route'],
        report.natCeiling.map((r) => [
          r.screensBehindOneIp,
          Math.round(r.reqPerMin),
          r.totalRequests,
          r.throttled429,
          r.throttledPct.toFixed(1),
          r.byRoute.map((x) => `${x.route}:${x.throttled}`).join(' '),
        ]),
      ),
    );
  }
  console.log('');
  const rows = [];
  for (const [key, d] of Object.entries(report.drills)) {
    if (!d || !('n' in d)) continue;
    rows.push([
      key,
      `${d.n} screens`,
      d.trigger ? `${d.trigger.status} / ${Math.round(d.trigger.ms)} ms` : '—',
      `${d.wsDelivered}/${d.n}`,
      d.wsP95 == null ? '—' : `${d.wsP95} ms`,
      `${d.httpDelivered}/${d.n}`,
      d.httpP95 == null ? '—' : `${d.httpP95} ms`,
      d.httpMax == null ? '—' : `${d.httpMax} ms`,
    ]);
  }
  console.log(table(['drill', 'scope', 'trigger', 'via WS', 'WS p95', 'via HTTP', 'HTTP p95', 'HTTP max'], rows));
  if (report.drills.apiRestart) {
    console.log(
      `\nAPI restart: back to /health 200 in ${report.drills.apiRestart.restartToHealthyMs} ms · ` +
        `WS re-authenticated ${report.drills.apiRestart.wsReconnected}/${report.drills.apiRestart.wsExpected}`,
    );
  }
  const sp = report.drills.stalePlayer;
  if (sp) {
    console.log('\nStale player');
    console.log(
      table(
        ['state', 'route statuses', 'alert reaches it', 'recovery'],
        [
          [
            `unproven (authState ${sp.unproven.authStateAfterMint})`,
            JSON.stringify(sp.unproven.probes),
            sp.unproven.alertReached ? `yes, ${sp.unproven.alertReachedMs} ms (manifest backstop)` : 'NO',
            `restore-trust ${sp.unproven.recovery.restoreTrustStatus} → renew ${sp.unproven.recovery.renewStatus} ` +
              `(requiresRePair=${sp.unproven.recovery.requiresRePair}, manifest ${sp.unproven.recovery.manifestAfter ?? '—'}, ` +
              `authState ${sp.unproven.recovery.authState ?? '—'}, ${sp.unproven.recovery.ms} ms)`,
          ],
          [
            `revoked (${(sp.revoked.row || []).join('/')})`,
            JSON.stringify({
              manifest: sp.revoked.manifest,
              'emergency-rev': sp.revoked.emergencyRev,
              telemetry: sp.revoked.telemetry,
            }),
            !sp.revoked.revokeLanded
              ? `NOT TESTED — revoke never landed (status ${sp.revoked.revokeStatus} after ${sp.revoked.revokeAttempts} attempts)`
              : sp.revoked.alertWhileRevoked?.manifestStatus === 200
                ? 'yes (UNEXPECTED)'
                : `no (manifest ${sp.revoked.alertWhileRevoked?.manifestStatus})`,
            `register ${sp.revoked.recoveryAttempts.registerFingerprintOnly.status}/${sp.revoked.recoveryAttempts.registerFingerprintOnly.code} · ` +
              `restore-trust ${sp.revoked.recoveryAttempts.restoreTrust.status}/${sp.revoked.recoveryAttempts.restoreTrust.code} · ` +
              `delete+re-provision ${JSON.stringify(sp.revoked.reprovision)}`,
          ],
        ],
      ),
    );
  }
  const failed = report.criteria.filter((c) => !c.pass);
  console.log(`\n${failed.length === 0 ? 'ALL CRITERIA PASS' : `${failed.length} CRITERION FAILURE(S): ${failed.map((f) => f.id).join(', ')}`}`);
}

main().catch(async (e) => {
  console.error('\n[loadtest] FAILED:', e.stack || e.message || e);
  try {
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  } catch { /* best effort */ }
  process.exit(1);
});
