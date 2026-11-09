/**
 * SCREEN DIAGNOSTICS — the page half (2026-11-08, Manager waves, wave 2).
 *
 * The operator's "Run self-test" reaches this page two ways: the signed
 * `DIAGNOSTICS_REQUEST` push on `device:<screenId>` and the manifest's
 * `diagnosticsRequest` (CLAUDE.md §6: commands ride pub/sub AND the
 * manifest). Both carry the same request id; the page answers it ONCE
 * (value identity, persisted), never by comparing clocks. The native side
 * answers the same id from its own heartbeat (`ScreenDiagnostics.kt`).
 *
 * What only the page can see, and reports:
 *   • the WebView engine as the page runs it (Chrome major from the UA) and
 *     whether the legacy polyfill layer for old engines is active;
 *   • the age of the last applied manifest;
 *   • a page → API round trip (`/api/v1/health`, liveness, bounded);
 *   • the origin quota (`navigator.storage.estimate`, the FUH43 ~160 MB);
 *   • the emergency tier of the offline cache, READ-ONLY: the service
 *     worker's existing STATUS reply (counts, bytes). Nothing is evicted,
 *     written or re-downloaded.
 *
 * Also the low-frequency storage report (`POST /screens/:id/storage-health`,
 * at most every 30 minutes) for the "Storage almost full" warning.
 *
 * Never interrupts playback: no state, no render, no reload — a fire-and-
 * forget POST with a bounded timeout. Pure helpers are unit-tested
 * (`__tests__/screenDiagnostics.test.ts`).
 */
import { readPlayerStorageEstimate } from './storageEstimate';
import { getCacheStatus } from './offline-cache';

export const DIAGNOSTICS_WS_TYPE = 'DIAGNOSTICS_REQUEST';
export const DIAG_DONE_KEY = 'edu_diag_done_id';
export const STORAGE_REPORT_KEY = 'edu_storage_report_at';
export const STORAGE_REPORT_EVERY_MS = 30 * 60_000;
export const PAGE_PROBE_TIMEOUT_MS = 6_000;

export interface DiagnosticsRequest {
  id: string;
  kind: 'SELF_TEST' | 'LOGS';
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** From the manifest's `diagnosticsRequest` or a WS/SSE payload `{requestId|id, kind, screenId?}`. */
export function readDiagnosticsRequest(raw: unknown, screenId?: string | null): DiagnosticsRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.requestId === 'string' ? r.requestId : typeof r.id === 'string' ? r.id : null;
  if (!id || !ID_RE.test(id)) return null;
  if (r.kind !== 'SELF_TEST' && r.kind !== 'LOGS') return null;
  // A pushed request names its screen; one for another screen is not ours.
  if (typeof r.screenId === 'string' && screenId && r.screenId !== screenId) return null;
  return { id, kind: r.kind };
}

export function chromeMajor(ua: string | null | undefined): number | null {
  const m = /Chrom(?:e|ium)\/(\d{2,4})\./.exec(ua ?? '');
  return m ? Number(m[1]) : null;
}

export interface MiniStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Answer an id once: true when this call claimed it. */
export function claimRequest(storage: MiniStorage | null | undefined, id: string): boolean {
  try {
    if (storage?.getItem(DIAG_DONE_KEY) === id) return false;
    storage?.setItem(DIAG_DONE_KEY, id);
  } catch { /* storage denied: answer anyway, the server refuses a duplicate */ }
  return true;
}

export function storageReportDue(nowMs: number, lastMs: number): boolean {
  return !Number.isFinite(lastMs) || lastMs <= 0 || nowMs < lastMs || nowMs - lastMs >= STORAGE_REPORT_EVERY_MS;
}

export interface PageDeps {
  apiRoot: string;
  token: string | null;
  screenId: string | null;
  /** epoch-ms of the last LIVE manifest the page applied, 0 = none yet. */
  manifestAppliedAtMs: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  storage?: MiniStorage | null;
  estimate?: Pick<StorageManager, 'estimate'> | null;
  cacheStatus?: () => Promise<{ supported: boolean; emergency: { count: number; bytes: number } } | null>;
  document?: Pick<Document, 'querySelector'> | null;
  userAgent?: string;
}

async function bounded(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ctl?.abort(); } catch { /* ignore */ } }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function emergencyTier(deps: PageDeps) {
  try {
    const st = await (deps.cacheStatus ?? getCacheStatus)();
    if (!st) return { readable: false, entries: null, bytes: null };
    if (!st.supported) return null; // no service worker: nothing to say
    return { readable: true, entries: st.emergency.count, bytes: st.emergency.bytes };
  } catch {
    return { readable: false, entries: null, bytes: null };
  }
}

async function origin(deps: PageDeps) {
  const est = await readPlayerStorageEstimate((deps.estimate ?? (typeof navigator !== 'undefined' ? navigator.storage : undefined)) ?? undefined);
  return est ? { usage: est.usage, quota: est.quota } : null;
}

/** The page's facts for a self-test. Never throws. */
export async function collectPageFacts(deps: PageDeps): Promise<Record<string, unknown>> {
  const now = (deps.now ?? Date.now)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ua = deps.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null);
  let legacyPolyfills: boolean | null = null;
  try { legacyPolyfills = !!doc?.querySelector('script[data-edu-shim="legacy-polyfills"]'); } catch { legacyPolyfills = null; }
  const t0 = (deps.now ?? Date.now)();
  const res = await bounded(fetchImpl, `${deps.apiRoot}/api/v1/health`, { method: 'GET', cache: 'no-store' }, PAGE_PROBE_TIMEOUT_MS);
  const apiRoundTripMs = (deps.now ?? Date.now)() - t0;
  return {
    chromeMajor: chromeMajor(ua),
    legacyPolyfills,
    manifestAgeMs: deps.manifestAppliedAtMs > 0 ? Math.max(0, now - deps.manifestAppliedAtMs) : null,
    apiOk: !!res && res.ok,
    apiRoundTripMs: res ? apiRoundTripMs : null,
    origin: await origin(deps),
    emergency: await emergencyTier(deps),
  };
}

/** Run the page half of a request once. Returns the HTTP status, or null when nothing was sent. */
export async function answerDiagnosticsRequest(req: DiagnosticsRequest | null, deps: PageDeps): Promise<number | null> {
  if (!req || req.kind !== 'SELF_TEST' || !deps.token || !deps.screenId) return null;
  if (!claimRequest(deps.storage ?? safeLocalStorage(), req.id)) return null;
  const facts = await collectPageFacts(deps);
  const res = await bounded(deps.fetchImpl ?? fetch, `${deps.apiRoot}/api/v1/screens/${deps.screenId}/diagnostics/${req.id}/page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
    body: JSON.stringify(facts),
  }, 15_000);
  return res ? res.status : null;
}

/** The storage report, at most every 30 minutes. Returns the HTTP status, or null when not due / not sent. */
export async function maybeReportStorage(deps: PageDeps): Promise<number | null> {
  if (!deps.token || !deps.screenId) return null;
  const store = deps.storage ?? safeLocalStorage();
  const now = (deps.now ?? Date.now)();
  let last = 0;
  try { last = Number(store?.getItem(STORAGE_REPORT_KEY) ?? 0); } catch { last = 0; }
  if (!storageReportDue(now, last)) return null;
  try { store?.setItem(STORAGE_REPORT_KEY, String(now)); } catch { /* best effort */ }
  const body = { origin: await origin(deps), emergency: await emergencyTier(deps) };
  if (!body.origin && !body.emergency) return null;
  const res = await bounded(deps.fetchImpl ?? fetch, `${deps.apiRoot}/api/v1/screens/${deps.screenId}/storage-health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
    body: JSON.stringify(body),
  }, 15_000);
  return res ? res.status : null;
}

// ─── The page's hook points (player/page.tsx calls only these) ─────────

let manifestAppliedAtMs = 0;

/** Live manifest applied: remember when (manifest age), run any open request, and the storage report when due. */
export function onLiveManifestApplied(manifest: unknown, ctx: { apiRoot: string; token: string | null; screenId: string | null }): void {
  manifestAppliedAtMs = Date.now();
  const req = readDiagnosticsRequest((manifest as Record<string, unknown> | null)?.diagnosticsRequest, ctx.screenId);
  const deps: PageDeps = { ...ctx, manifestAppliedAtMs };
  void answerDiagnosticsRequest(req, deps).catch(() => undefined);
  void maybeReportStorage(deps).catch(() => undefined);
}

/** A pushed DIAGNOSTICS_REQUEST (WS or SSE payload). */
export function onPushedDiagnosticsRequest(payload: unknown, ctx: { apiRoot: string; token: string | null; screenId: string | null }): void {
  const req = readDiagnosticsRequest(payload, ctx.screenId);
  void answerDiagnosticsRequest(req, { ...ctx, manifestAppliedAtMs }).catch(() => undefined);
}

function safeLocalStorage(): MiniStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
