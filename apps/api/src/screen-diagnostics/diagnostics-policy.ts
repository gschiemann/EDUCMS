/**
 * Screen diagnostics — the POLICY (2026-11-08, Manager waves, wave 2).
 *
 * Pure: no Prisma, no Redis, no clock of its own. Everything the service
 * decides about a self-test or a logs request is decided here so each rule
 * has a unit test (`diagnostics-policy.spec.ts`).
 *
 *   #5  Self-test        — the player checks storage, the cert store / clock,
 *                          DNS, API reachability and latency, the WebView
 *                          engine (and whether the legacy polyfill layer is
 *                          active), the heartbeat and the manifest age.
 *   #11 Network          — part of the self-test: captive portal / validated
 *                          network, DNS of the API host, the TLS chain, Wi-Fi
 *                          RSSI or the Ethernet link, the IP / gateway (masked).
 *   #4  Logs on demand   — the last N minutes of the Player's and the
 *                          Manager's log, redacted on the device AND here.
 *   #6  Storage health   — graded in `storage-health.ts`.
 *
 * TRANSPORT (CLAUDE.md §6, player rule 6): a request is stamped on the
 * screen row (`pendingDiagnosticsId/Kind/At`) and published as a signed
 * `DIAGNOSTICS_REQUEST` on `device:<screenId>`. So it rides pub/sub, the
 * manifest (`diagnosticsRequest`) AND the native status heartbeat's reply,
 * and the device answers BY VALUE — the request id — never by clock.
 *
 * THE SERVER IS THE AUTHORITY. Anything that reaches the device (a forged
 * frame, a stale manifest) can at most make it run a read-only probe whose
 * answer is refused: a result is accepted only for a PENDING, unexpired
 * request of THIS screen in THIS tenant, and a log upload additionally needs
 * the short-lived ticket the API minted for that request.
 */
import { createHmac, timingSafeEqual } from 'crypto';

// ─── Kinds, roles, bounds ─────────────────────────────────────────────────

export const DIAGNOSTICS_KINDS = ['SELF_TEST', 'LOGS'] as const;
export type DiagnosticsKind = (typeof DIAGNOSTICS_KINDS)[number];

export const LOG_MINUTES_DEFAULT = 15;
export const LOG_MINUTES_MIN = 5;
export const LOG_MINUTES_MAX = 60;

/** How long a request stays answerable. A dark panel heartbeats every 30-90 s. */
export const SELF_TEST_TTL_MS = 10 * 60_000;
export const LOGS_TTL_MS = 15 * 60_000;
/** After the native half lands, how long the page half may still arrive before the verdict is final. */
export const PAGE_GRACE_MS = 45_000;
/** A log-upload ticket lives this long. */
export const UPLOAD_TICKET_TTL_MS = 5 * 60_000;
/** The device's upload ceiling (Player + Manager text). */
export const LOG_UPLOAD_MAX_BYTES = 1_500_000;

/** Who may run a self-test: the admins who may already refresh the screen. */
export const SELF_TEST_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'] as const;
/**
 * Who may pull device logs: organisation admins only. A log is redacted, but
 * it is still the most detailed record of a building's network a screen holds.
 */
export const LOG_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN'] as const;

export const DIAGNOSTICS_AUDIT = {
  REQUESTED: 'SCREEN_DIAGNOSTICS_REQUESTED',
  LOGS_UPLOADED: 'SCREEN_DIAGNOSTICS_LOGS_UPLOADED',
  LOGS_DOWNLOADED: 'SCREEN_DIAGNOSTICS_LOGS_DOWNLOADED',
  LOGS_PURGED: 'SCREEN_DIAGNOSTICS_LOGS_PURGED',
} as const;

export const DIAGNOSTICS_WS_TYPE = 'DIAGNOSTICS_REQUEST';

export function mayRequest(role: string | null | undefined, kind: DiagnosticsKind): boolean {
  const roles: readonly string[] = kind === 'LOGS' ? LOG_ROLES : SELF_TEST_ROLES;
  return !!role && roles.includes(role);
}

export function parseKind(v: unknown): DiagnosticsKind | null {
  return typeof v === 'string' && (DIAGNOSTICS_KINDS as readonly string[]).includes(v) ? (v as DiagnosticsKind) : null;
}

export function clampMinutes(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return LOG_MINUTES_DEFAULT;
  return Math.min(LOG_MINUTES_MAX, Math.max(LOG_MINUTES_MIN, Math.round(n)));
}

export function ttlFor(kind: DiagnosticsKind): number {
  return kind === 'LOGS' ? LOGS_TTL_MS : SELF_TEST_TTL_MS;
}

// ─── Kill switches ────────────────────────────────────────────────────────

const truthy = (v: unknown) => ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/**
 * `SCREEN_DIAGNOSTICS_DISABLED=1` — no new self-test or logs request is
 * accepted, and the heartbeat / manifest stop carrying an open one. Results
 * already stored stay readable. Unset = the feature is on.
 */
export function diagnosticsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthy(env.SCREEN_DIAGNOSTICS_DISABLED);
}

/** `SCREEN_DIAGNOSTICS_LOG_RETENTION_DAYS` — 1..30, default 7. */
export function logRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.SCREEN_DIAGNOSTICS_LOG_RETENTION_DAYS ?? '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : 7;
}

/** Request rows (no log text) are kept this long. */
export const REQUEST_ROW_RETENTION_DAYS = 90;

// ─── The wire: what the manifest and the heartbeat carry ───────────────────

/**
 * Stored as `pendingDiagnosticsKind`: `SELF_TEST` or `LOGS:<minutes>`, so the
 * row needs no JSON column. Unknown text → null (say nothing to the device).
 */
export function encodePendingKind(kind: DiagnosticsKind, minutes?: number | null): string {
  return kind === 'LOGS' ? `LOGS:${clampMinutes(minutes)}` : 'SELF_TEST';
}

export interface WireRequest {
  id: string;
  kind: DiagnosticsKind;
  minutes?: number;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRequestId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

export function decodePending(id: unknown, kind: unknown): WireRequest | null {
  if (!isRequestId(id) || typeof kind !== 'string') return null;
  if (kind === 'SELF_TEST') return { id, kind: 'SELF_TEST' };
  const m = /^LOGS:(\d{1,3})$/.exec(kind);
  return m ? { id, kind: 'LOGS', minutes: clampMinutes(Number(m[1])) } : null;
}

/**
 * The manifest's `diagnosticsRequest`, as a spread: `{}` when nothing is
 * open, so every ordinary manifest — and its ETag — stays byte-for-byte what
 * it was. A pure function of column values (no clock): the cached body stays
 * hash-stable between command edges, like `refreshRequestedAt`.
 */
export function manifestDiagnostics(screen: {
  pendingDiagnosticsId?: string | null;
  pendingDiagnosticsKind?: string | null;
} | null | undefined): { diagnosticsRequest?: WireRequest } {
  if (!screen || diagnosticsDisabled()) return {};
  const req = decodePending(screen.pendingDiagnosticsId, screen.pendingDiagnosticsKind);
  return req ? { diagnosticsRequest: req } : {};
}

// ─── The upload ticket (the "short-lived signed upload") ───────────────────
//
// The device may only speak to the pinned API host (`HostAllowlist.kt` —
// widening it is a signing-key-class change), so the signed upload goes to
// the API, which writes the private bucket. The ticket binds the upload to
// ONE request of ONE screen, for five minutes, under a domain-separated HMAC.

const TICKET_DOMAIN = 'venueos-screen-diagnostics-upload-v1';

function ticketKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const k = (env.JWT_SECRET ?? '').trim();
  return k.length >= 16 ? k : null;
}

export function signUploadTicket(screenId: string, requestId: string, expMs: number, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = ticketKey(env);
  if (!key) return null;
  const mac = createHmac('sha256', key).update(`${TICKET_DOMAIN}|${screenId}|${requestId}|${expMs}`).digest('base64url');
  return `${expMs}.${mac}`;
}

export function verifyUploadTicket(
  ticket: unknown,
  screenId: string,
  requestId: string,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof ticket !== 'string' || ticket.length > 200) return false;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return false;
  const expMs = Number(ticket.slice(0, dot));
  if (!Number.isSafeInteger(expMs) || expMs < nowMs || expMs > nowMs + UPLOAD_TICKET_TTL_MS + 5_000) return false;
  const expected = signUploadTicket(screenId, requestId, expMs, env);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(ticket);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Sanitising what the device sends ──────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const code = (v: unknown, max = 48): string | null =>
  typeof v === 'string' && v.length <= max && /^[A-Za-z0-9 ._:/+()-]*$/.test(v) && v.length > 0 ? v : null;
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null;
/** A masked address: `10.0.x.x`, `fe80::x`, never a full host address. */
const masked = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 40 && /^[0-9a-fx.:]+$/i.test(v) && /x/i.test(v) ? v : null;

const DAY_MS = 86_400_000;

export interface NativeSelfTest {
  app: { versionName: string | null; versionCode: number | null };
  storage: { freeBytes: number | null; totalBytes: number | null; writeOk: boolean | null; writeMs: number | null } | null;
  clock: { skewMs: number | null } | null;
  tls: { ok: boolean | null; error: string | null; chainLength: number | null; leafDaysLeft: number | null } | null;
  dns: { ok: boolean | null; ms: number | null; count: number | null; error: string | null } | null;
  api: { ok: boolean | null; status: number | null; ms: number | null; error: string | null } | null;
  net: {
    transport: 'wifi' | 'ethernet' | 'cellular' | 'other' | 'none' | null;
    validated: boolean | null;
    captivePortal: boolean | null;
    rssi: number | null;
    linkMbps: number | null;
    ipKind: 'private' | 'public' | 'cgnat' | 'link-local' | 'none' | null;
    ip: string | null;
    gateway: string | null;
  } | null;
  /** `legacyLayer`: the APK's legacy-engine compatibility layer (#258, `LegacyEnginePolicy`) is installed on this unit. */
  webview: { versionName: string | null; major: number | null; legacyLayer: boolean | null } | null;
  durationMs: number | null;
}

/** The native half, reduced to the fields and shapes we grade. Never throws. */
export function sanitizeNativeSelfTest(raw: unknown): NativeSelfTest | null {
  const r = obj(raw);
  if (!r) return null;
  const app = obj(r.app) ?? {};
  const st = obj(r.storage);
  const ck = obj(r.clock);
  const tl = obj(r.tls);
  const dn = obj(r.dns);
  const ap = obj(r.api);
  const nt = obj(r.net);
  const wv = obj(r.webview);
  return {
    app: { versionName: code(app.versionName), versionCode: num(app.versionCode, 10_000_000) },
    storage: st ? {
      freeBytes: num(st.freeBytes), totalBytes: num(st.totalBytes),
      writeOk: bool(st.writeOk), writeMs: num(st.writeMs, 600_000),
    } : null,
    clock: ck ? { skewMs: num(ck.skewMs, 100 * 365 * DAY_MS, -100 * 365 * DAY_MS) } : null,
    tls: tl ? {
      ok: bool(tl.ok), error: code(tl.error), chainLength: num(tl.chainLength, 20),
      leafDaysLeft: num(tl.leafDaysLeft, 10_000, -10_000),
    } : null,
    dns: dn ? { ok: bool(dn.ok), ms: num(dn.ms, 600_000), count: num(dn.count, 64), error: code(dn.error) } : null,
    api: ap ? { ok: bool(ap.ok), status: num(ap.status, 999), ms: num(ap.ms, 600_000), error: code(ap.error) } : null,
    net: nt ? {
      transport: oneOf(nt.transport, ['wifi', 'ethernet', 'cellular', 'other', 'none'] as const),
      validated: bool(nt.validated), captivePortal: bool(nt.captivePortal),
      rssi: num(nt.rssi, 0, -127), linkMbps: num(nt.linkMbps, 100_000),
      ipKind: oneOf(nt.ipKind, ['private', 'public', 'cgnat', 'link-local', 'none'] as const),
      ip: masked(nt.ip), gateway: masked(nt.gateway),
    } : null,
    webview: wv ? { versionName: code(wv.versionName), major: num(wv.major, 1000), legacyLayer: bool(wv.legacyLayer) } : null,
    durationMs: num(r.durationMs, 600_000),
  };
}

export interface PageSelfTest {
  chromeMajor: number | null;
  legacyPolyfills: boolean | null;
  manifestAgeMs: number | null;
  apiRoundTripMs: number | null;
  apiOk: boolean | null;
  origin: { usage: number | null; quota: number | null } | null;
  emergency: { readable: boolean | null; entries: number | null; bytes: number | null } | null;
}

export function sanitizePageSelfTest(raw: unknown): PageSelfTest | null {
  const r = obj(raw);
  if (!r) return null;
  const o = obj(r.origin);
  const e = obj(r.emergency);
  return {
    chromeMajor: num(r.chromeMajor, 1000),
    legacyPolyfills: bool(r.legacyPolyfills),
    manifestAgeMs: num(r.manifestAgeMs, 365 * DAY_MS),
    apiRoundTripMs: num(r.apiRoundTripMs, 600_000),
    apiOk: bool(r.apiOk),
    origin: o ? { usage: num(o.usage), quota: num(o.quota) } : null,
    emergency: e ? { readable: bool(e.readable), entries: num(e.entries, 100_000), bytes: num(e.bytes) } : null,
  };
}

// ─── The grader ───────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type CheckGroup = 'device' | 'network' | 'player';

export const CHECK_IDS = [
  'storage', 'clock', 'certs',
  'network', 'link', 'dns', 'api', 'address',
  'webview', 'heartbeat', 'manifest', 'origin', 'emergency',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface Check {
  id: CheckId;
  group: CheckGroup;
  status: CheckStatus;
  /** Numbers and short codes for the card's detail line — never free text. */
  values: Record<string, string | number | boolean>;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export const GRADE = {
  STORAGE_FAIL_BYTES: 256 * MiB,
  STORAGE_WARN_BYTES: 1 * GiB,
  STORAGE_FAIL_RATIO: 0.02,
  STORAGE_WARN_RATIO: 0.05,
  CLOCK_WARN_MS: 2 * 60_000,
  CLOCK_FAIL_MS: 10 * 60_000,
  CERT_WARN_DAYS: 14,
  RSSI_WARN: -75,
  RSSI_FAIL: -85,
  DNS_WARN_MS: 1_000,
  API_WARN_MS: 1_500,
  HEARTBEAT_WARN_MS: 2 * 60_000,
  HEARTBEAT_FAIL_MS: 10 * 60_000,
  MANIFEST_WARN_MS: 10 * 60_000,
  MANIFEST_FAIL_MS: 60 * 60_000,
  ORIGIN_WARN_RATIO: 0.8,
  ORIGIN_FAIL_RATIO: 0.95,
  ENGINE_OLD_MAJOR: 80,
} as const;

const c = (id: CheckId, group: CheckGroup, status: CheckStatus, values: Check['values'] = {}): Check => ({ id, group, status, values });

function strip(values: Record<string, string | number | boolean | null | undefined>): Check['values'] {
  const out: Check['values'] = {};
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

export function gradeStorageCheck(s: NativeSelfTest['storage']): Check {
  if (!s || s.freeBytes === null || s.totalBytes === null || s.totalBytes === 0) return c('storage', 'device', 'unknown');
  const ratio = s.freeBytes / s.totalBytes;
  const values = strip({ freeBytes: s.freeBytes, totalBytes: s.totalBytes, writeMs: s.writeMs });
  if (s.writeOk === false || s.freeBytes < GRADE.STORAGE_FAIL_BYTES || ratio < GRADE.STORAGE_FAIL_RATIO) {
    return c('storage', 'device', 'fail', { ...values, ...(s.writeOk === false ? { writeFailed: true } : {}) });
  }
  if (s.freeBytes < GRADE.STORAGE_WARN_BYTES || ratio < GRADE.STORAGE_WARN_RATIO) return c('storage', 'device', 'warn', values);
  return c('storage', 'device', 'pass', values);
}

export function gradeSelfTest(input: {
  native: NativeSelfTest | null;
  page: PageSelfTest | null;
  /** `screens.lastPingAt` age at grading time, null = never. */
  heartbeatAgeMs: number | null;
}): { verdict: 'pass' | 'warn' | 'fail'; checks: Check[] } {
  const { native: n, page: p } = input;
  const checks: Check[] = [];

  // Device
  checks.push(gradeStorageCheck(n?.storage ?? null));
  const skew = n?.clock?.skewMs ?? null;
  if (skew === null) checks.push(c('clock', 'device', 'unknown'));
  else {
    const abs = Math.abs(skew);
    checks.push(c('clock', 'device', abs > GRADE.CLOCK_FAIL_MS ? 'fail' : abs > GRADE.CLOCK_WARN_MS ? 'warn' : 'pass', { skewSec: Math.round(skew / 1000) }));
  }
  const tls = n?.tls ?? null;
  if (!tls || tls.ok === null) checks.push(c('certs', 'device', 'unknown'));
  else if (!tls.ok) checks.push(c('certs', 'device', 'fail', strip({ error: tls.error })));
  else checks.push(c('certs', 'device', tls.leafDaysLeft !== null && tls.leafDaysLeft < GRADE.CERT_WARN_DAYS ? 'warn' : 'pass',
    strip({ chainLength: tls.chainLength, leafDaysLeft: tls.leafDaysLeft })));

  // Network
  const net = n?.net ?? null;
  if (!net) checks.push(c('network', 'network', 'unknown'));
  else if (net.transport === 'none') checks.push(c('network', 'network', 'fail', { offline: true }));
  else if (net.captivePortal) checks.push(c('network', 'network', 'fail', { captivePortal: true }));
  else checks.push(c('network', 'network', net.validated === false ? 'warn' : net.validated ? 'pass' : 'unknown', strip({ transport: net.transport })));

  if (!net || !net.transport || net.transport === 'none') checks.push(c('link', 'network', 'unknown'));
  else if (net.transport === 'wifi') {
    const rssi = net.rssi;
    checks.push(c('link', 'network', rssi === null ? 'unknown' : rssi < GRADE.RSSI_FAIL ? 'fail' : rssi < GRADE.RSSI_WARN ? 'warn' : 'pass',
      strip({ transport: 'wifi', rssi, linkMbps: net.linkMbps })));
  } else checks.push(c('link', 'network', 'pass', strip({ transport: net.transport, linkMbps: net.linkMbps })));

  const dns = n?.dns ?? null;
  if (!dns || dns.ok === null) checks.push(c('dns', 'network', 'unknown'));
  else checks.push(c('dns', 'network', !dns.ok ? 'fail' : (dns.ms ?? 0) > GRADE.DNS_WARN_MS ? 'warn' : 'pass', strip({ ms: dns.ms, count: dns.count, error: dns.error })));

  const api = n?.api ?? null;
  if (api && api.ok !== null) {
    checks.push(c('api', 'network', !api.ok ? 'fail' : (api.ms ?? 0) > GRADE.API_WARN_MS ? 'warn' : 'pass', strip({ ms: api.ms, status: api.status, error: api.error })));
  } else if (p && p.apiOk !== null) {
    checks.push(c('api', 'network', !p.apiOk ? 'fail' : (p.apiRoundTripMs ?? 0) > GRADE.API_WARN_MS ? 'warn' : 'pass', strip({ ms: p.apiRoundTripMs })));
  } else checks.push(c('api', 'network', 'unknown'));

  if (!net || !net.ipKind) checks.push(c('address', 'network', 'unknown'));
  else if (net.ipKind === 'none' || net.ipKind === 'link-local') checks.push(c('address', 'network', 'fail', strip({ ipKind: net.ipKind })));
  else checks.push(c('address', 'network', net.gateway ? 'pass' : 'warn', strip({ ipKind: net.ipKind, ip: net.ip, gateway: net.gateway })));

  // Player
  const major = p?.chromeMajor ?? n?.webview?.major ?? null;
  if (major === null) checks.push(c('webview', 'player', 'unknown'));
  else checks.push(c('webview', 'player', major < GRADE.ENGINE_OLD_MAJOR ? 'warn' : 'pass',
    strip({ major, versionName: n?.webview?.versionName, legacyLayer: n?.webview?.legacyLayer, legacyPolyfills: p?.legacyPolyfills })));

  const hb = input.heartbeatAgeMs;
  checks.push(hb === null ? c('heartbeat', 'player', 'fail', { never: true })
    : c('heartbeat', 'player', hb > GRADE.HEARTBEAT_FAIL_MS ? 'fail' : hb > GRADE.HEARTBEAT_WARN_MS ? 'warn' : 'pass', { ageSec: Math.round(hb / 1000) }));

  if (!p || p.manifestAgeMs === null) checks.push(c('manifest', 'player', p ? 'unknown' : 'warn', p ? {} : { pageSilent: true }));
  else checks.push(c('manifest', 'player', p.manifestAgeMs > GRADE.MANIFEST_FAIL_MS ? 'fail' : p.manifestAgeMs > GRADE.MANIFEST_WARN_MS ? 'warn' : 'pass',
    { ageSec: Math.round(p.manifestAgeMs / 1000) }));

  const o = p?.origin ?? null;
  if (!o || o.usage === null || !o.quota) checks.push(c('origin', 'player', 'unknown'));
  else {
    const ratio = o.usage / o.quota;
    checks.push(c('origin', 'player', ratio >= GRADE.ORIGIN_FAIL_RATIO ? 'fail' : ratio >= GRADE.ORIGIN_WARN_RATIO ? 'warn' : 'pass',
      { usage: o.usage, quota: o.quota, percent: Math.round(ratio * 100) }));
  }

  const em = p?.emergency ?? null;
  if (!em || em.readable === null) checks.push(c('emergency', 'player', 'unknown'));
  else checks.push(c('emergency', 'player', em.readable ? 'pass' : 'fail', strip({ entries: em.entries, bytes: em.bytes })));

  const known = checks.filter((k) => k.status !== 'unknown');
  const verdict = known.some((k) => k.status === 'fail') ? 'fail'
    : known.some((k) => k.status === 'warn') || known.length === 0 ? 'warn'
      : 'pass';
  return { verdict, checks };
}

// ─── Request life cycle (read-time, no clock of its own) ───────────────────

export type ViewStatus = 'pending' | 'running' | 'complete' | 'failed' | 'expired';

export function viewStatus(row: {
  kind: string;
  status: string;
  expiresAt: Date;
  deliveredAt?: Date | null;
  nativeAt?: Date | null;
  pageAt?: Date | null;
}, nowMs: number): ViewStatus {
  if (row.status === 'COMPLETE') return 'complete';
  if (row.status === 'FAILED') return 'failed';
  if (row.status === 'EXPIRED') return 'expired';
  if (row.kind === 'SELF_TEST') {
    const nativeIn = !!row.nativeAt;
    if (nativeIn && (row.pageAt || nowMs - row.nativeAt!.getTime() > PAGE_GRACE_MS)) return 'complete';
    if (nowMs > row.expiresAt.getTime()) return row.nativeAt || row.pageAt ? 'complete' : 'expired';
    return nativeIn || row.pageAt || row.deliveredAt ? 'running' : 'pending';
  }
  if (nowMs > row.expiresAt.getTime()) return 'expired';
  return row.deliveredAt ? 'running' : 'pending';
}
