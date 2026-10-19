/**
 * NATIVE-FIRST, page side of protocol v4 (design
 * `docs/design/NATIVE-FIRST-ONE-STORE.md` §3.5 / §4.3 / §6; owner D1).
 *
 * NO NEW BRIDGE METHOD (CLAUDE.md player rule 9): v4 is a `version: 4`
 * message on the existing `sharedVideoPrepare`, and v4 facts are extra keys
 * on the existing `sharedVideoState` reply — exactly how protocol 3 rode the
 * same four methods. `NATIVE_VOID/VALUE_METHODS` and the nativeBridge canary
 * are unchanged. The app advertises `protocolMax: 4` only when its class
 * table and the switch allow native-first, so an older bundle never meets
 * v4, and this bundle sends v4 only to an app that advertised it.
 *
 * THE MESSAGES (identity only — never a URL, never a token):
 *   intend  {version:4, op:"intend", screenId, revision, sha256, assetId,
 *            start:"now"|"boundary", lease}
 *   release {version:4, op:"release", lease, at:"now"|"boundary"}
 *   sync    {version:4, op:"sync", manifestTag, emergencySetHash?}
 * `lease` is THIS page document's id (32 lowercase hex, generated once per
 * document): a reload is a new lease, which must adopt the app's intent
 * before it can change or release it (§4.1).
 *
 * THE REPLY (v4 keys this page reads; every one optional, all bounded —
 * stream B's shapes, origin/claude/native-first-stream-b):
 *   protocolMax: 4                         only where the class AND this face's switch allow it
 *   nativeFirst: {enabled, manifest, classDefault}   (device.nativeFirst = the CLASS default)
 *   lease: {id, live, ageMs, unattended}  (or {id, state} / "<id>")
 *   intent: {screenId, revision, sha256, assetId, start, atMs,
 *            status: "suspended-by-hold"|"pre-rolling"|<session state>|"ended",
 *            lastEnd, settled}
 *   intentRejected: {reason, sha256, atMs}
 *   availability: {ready, epoch, …}        the 1.1.35 window answer
 *   store: {mode:"off"|"adopting"|"active", serve, generation,
 *           ready:[sha…≤64], pending:[sha…≤64],
 *           downloading:{sha8, bytesLoaded, bytesTotal},
 *           emergency:{setHash, complete, count, bytes}, …}
 *   (the top-level session fields — state, sessionId, revision, sha256,
 *    output … — keep describing this face's solo session; an ended one is
 *    `state: "failed"` + `reason` for 30 s. The app NEVER restarts content on
 *    its own (B's D5): after a hold, its own UI or a lifecycle end, the page
 *    intends again.)
 *
 * Pure: no React, no DOM, no bridge, no clock.
 */
import { readNativeSharedVideoState, type NativeSharedVideoState } from './nativeSharedVideo';

export const NATIVE_FIRST_PROTOCOL = 4;
/** The page polls `sharedVideoState` this often while a native-first session matters (§4.1). */
export const NATIVE_FIRST_POLL_MS = 500;
/** One poll's reply budget; a reply that never comes is not native's verdict. */
export const NATIVE_FIRST_REPLY_TIMEOUT_MS = 2_000;
/** A rendered frame older than this is not proof of a picture (the existing confirm-by-render rule). */
export const NATIVE_FIRST_FRESH_MS = 2_500;
export const NATIVE_FIRST_MAX_LIST = 64;

const UUID_RE = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA_RE = /^[a-f0-9]{64}$/i;
const SHA8_RE = /^[a-f0-9]{8}$/i;
const LEASE_RE = /^[a-f0-9]{32}$/;
const TAG_RE = /^[A-Za-z0-9._:+/=-]{1,128}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

// ── The lease ────────────────────────────────────────────────────────────

/** A fresh lease id: 32 lowercase hex. It names a document, it is not a secret. */
export function newNativeLeaseId(fill?: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(16);
  try {
    if (fill) fill(bytes);
    else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

// ── The messages ─────────────────────────────────────────────────────────

export interface NativeIntentIdentity {
  screenId: string;
  revision: string;
  sha256: string;
  assetId: string;
}
export type NativeStart = 'now' | 'boundary';

export function validIdentity(id: NativeIntentIdentity | null | undefined): id is NativeIntentIdentity {
  return !!id && UUID_RE.test(id.screenId) && text(id.revision) && SHA_RE.test(id.sha256) && UUID_RE.test(id.assetId);
}

/** The intent message, or null when the identity or the lease is malformed (nothing is sent). */
export function nativeIntendMessage(id: NativeIntentIdentity, start: NativeStart, lease: string): string | null {
  if (!validIdentity(id) || !LEASE_RE.test(lease) || (start !== 'now' && start !== 'boundary')) return null;
  return JSON.stringify({
    version: NATIVE_FIRST_PROTOCOL, op: 'intend',
    screenId: id.screenId, revision: id.revision, sha256: id.sha256.toLowerCase(), assetId: id.assetId,
    start, lease,
  });
}

export function nativeReleaseMessage(lease: string, at: NativeStart): string | null {
  if (!LEASE_RE.test(lease) || (at !== 'now' && at !== 'boundary')) return null;
  return JSON.stringify({ version: NATIVE_FIRST_PROTOCOL, op: 'release', lease, at });
}

/** An HTTP ETag as a manifest tag: `W/` and quotes stripped, bounded; null when unusable. */
export function nativeManifestTag(etag: string | null | undefined): string | null {
  if (typeof etag !== 'string') return null;
  const t = etag.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return TAG_RE.test(t) ? t : null;
}

/** Stream B's grammar for the emergency set hash (a value outside it would refuse the WHOLE sync). */
const SET_HASH_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export function nativeSyncMessage(manifestTag: string, emergencySetHash?: string | null): string | null {
  if (!TAG_RE.test(manifestTag)) return null;
  const hash = typeof emergencySetHash === 'string' && SET_HASH_RE.test(emergencySetHash) ? emergencySetHash : null;
  return JSON.stringify({ version: NATIVE_FIRST_PROTOCOL, op: 'sync', manifestTag, ...(hash ? { emergencySetHash: hash } : {}) });
}

// ── The reply ────────────────────────────────────────────────────────────

export type NativeStoreMode = 'off' | 'adopting' | 'active';
export interface NativeStoreBlock {
  mode: NativeStoreMode;
  serve: boolean;
  generation: number;
  /** Verified large files of the current sets (sha256, lowercase), ≤ 64. */
  ready: string[];
  pending: string[];
  downloading: { sha8: string; bytesLoaded: number; bytesTotal: number } | null;
  emergency: { setHash: string | null; complete: boolean; count: number; bytes: number } | null;
}
export type NativeIntentSuspension = 'hold' | 'operator-ui' | null;
export interface NativeFirstFacts {
  /** `protocolMax` (0 when absent). */
  protocolMax: number;
  nativeSolo: boolean;
  /**
   * Native-first is ON for THIS face: stream B's `nativeFirst.enabled` (the
   * class default OR this face's manifest switch), else protocolMax ≥ 4 (B
   * advertises 4 only then). `device.nativeFirst` alone is the CLASS DEFAULT
   * (false everywhere this release) and never turns a face off by itself.
   */
  nativeFirst: boolean;
  /** The lease the app counts as this face's controller right now, when it says. */
  lease: { id: string; state: 'held' | 'absent' | 'retired' } | null;
  intent: (NativeIntentIdentity & {
    start: NativeStart | null;
    suspended: NativeIntentSuspension;
    /** B: `suspended-by-hold` | `pre-rolling` | a session state | `ended`. */
    status: string | null;
    lastEnd: string | null;
    settled: boolean;
  }) | null;
  /** The app refused an intent (B: `{reason, sha256, atMs}`); `key` identifies this refusal. */
  intentRejected: { reason: string; sha256: string | null; key: string } | null;
  /** The 1.1.35 window-availability answer, when the reply carries it (the app's own UI / lifecycle). */
  availability: { ready: boolean; epoch: number } | null;
  /** This face's solo session (top-level fields), or null when idle / unreadable. */
  session: NativeSharedVideoState | null;
  store: NativeStoreBlock | null;
}

function shaList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v.slice(0, NATIVE_FIRST_MAX_LIST)) if (typeof s === 'string' && SHA_RE.test(s)) out.push(s.toLowerCase());
  return out;
}

export function readNativeStoreBlock(v: unknown): NativeStoreBlock | null {
  if (!record(v) || !['off', 'adopting', 'active'].includes(String(v.mode))) return null;
  const d = v.downloading;
  const e = v.emergency;
  return {
    mode: v.mode as NativeStoreMode,
    serve: v.serve === true,
    generation: count(v.generation) ? v.generation : 0,
    ready: shaList(v.ready),
    pending: shaList(v.pending),
    downloading: record(d) && typeof d.sha8 === 'string' && SHA8_RE.test(d.sha8) && count(d.bytesLoaded) && count(d.bytesTotal)
      ? { sha8: d.sha8.toLowerCase(), bytesLoaded: d.bytesLoaded, bytesTotal: d.bytesTotal } : null,
    emergency: record(e) && typeof e.complete === 'boolean'
      ? {
          setHash: typeof e.setHash === 'string' && TAG_RE.test(e.setHash) ? e.setHash : null,
          complete: e.complete,
          count: count(e.count) ? e.count : 0,
          bytes: count(e.bytes) ? e.bytes : 0,
        }
      : null,
  };
}

function readSuspension(v: unknown): NativeIntentSuspension {
  if (v === true || v === 'hold' || v === 'emergency-held' || v === 'suspended-by-hold') return 'hold';
  if (v === 'operator-ui') return 'operator-ui';
  return null;
}
/** The app echoes the PAGE's lease id (stream B accepts `[A-Za-z0-9_-]{8,64}`). */
const APP_LEASE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const STATUS_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** The v4 facts of one `sharedVideoState` reply (string or object), bounded; null when unusable. */
export function readNativeFirstFacts(raw: unknown): NativeFirstFacts | null {
  let v: unknown = raw;
  try {
    if (typeof raw === 'string') {
      if (raw.length > 16384) return null;
      v = JSON.parse(raw);
    }
  } catch {
    return null;
  }
  if (!record(v) || v.version !== 1) return null;
  const device = record(v.device) ? v.device : null;
  const protocolMax = count(v.protocolMax) && v.protocolMax <= 99 ? v.protocolMax : 0;
  const l = v.lease;
  const lease = typeof l === 'string' && APP_LEASE_RE.test(l)
    ? { id: l, state: 'held' as const }
    : record(l) && typeof l.id === 'string' && APP_LEASE_RE.test(l.id)
      ? ['held', 'absent', 'retired'].includes(String(l.state))
        ? { id: l.id, state: l.state as 'held' | 'absent' | 'retired' }
        : typeof l.live === 'boolean'
          ? { id: l.id, state: (l.live ? 'held' : 'absent') as 'held' | 'absent' }
          : null
      : null;
  const i = v.intent;
  const intentId = record(i)
    ? { screenId: String(i.screenId ?? ''), revision: String(i.revision ?? ''), sha256: String(i.sha256 ?? '').toLowerCase(), assetId: String(i.assetId ?? '') }
    : null;
  const status = record(i) && typeof i.status === 'string' && STATUS_RE.test(i.status) ? i.status : null;
  const intent = record(i) && validIdentity(intentId)
    ? {
        ...intentId,
        start: i.start === 'now' || i.start === 'boundary' ? (i.start as NativeStart) : null,
        suspended: readSuspension(i.suspended) ?? readSuspension(status),
        status,
        lastEnd: typeof i.lastEnd === 'string' && /^[a-z0-9-]{1,64}$/.test(i.lastEnd) ? i.lastEnd : null,
        settled: i.settled === true,
      }
    : null;
  const r = v.intentRejected;
  const intentRejected = record(r) && typeof r.reason === 'string' && /^[a-z0-9-]{1,64}$/.test(r.reason)
    ? {
        reason: r.reason,
        sha256: typeof r.sha256 === 'string' && SHA_RE.test(r.sha256) ? r.sha256.toLowerCase() : null,
        key: `${r.reason}|${typeof r.atMs === 'number' && Number.isFinite(r.atMs) ? r.atMs : ''}|${typeof r.sha256 === 'string' ? r.sha256.toLowerCase() : ''}`,
      }
    : null;
  const a = v.availability;
  const availability = record(a) && typeof a.ready === 'boolean'
    ? { ready: a.ready, epoch: count(a.epoch) ? a.epoch : 0 }
    : null;
  const nf = v.nativeFirst;
  const s = readNativeSharedVideoState(v);
  return {
    protocolMax,
    nativeSolo: device?.nativeSolo === true,
    // An explicit per-face answer wins; otherwise v4 itself says it is on.
    nativeFirst: record(nf)
      ? nf.enabled === true
      : nf === true || device?.nativeFirst === true || protocolMax >= NATIVE_FIRST_PROTOCOL,
    lease,
    intent,
    intentRejected,
    availability,
    session: s && s.state !== 'idle' ? s : null,
    store: readNativeStoreBlock(v.store),
  };
}

/** Is this session presenting the given identity (same bytes, same revision)? */
export function sessionMatches(s: NativeSharedVideoState | null | undefined, id: Pick<NativeIntentIdentity, 'sha256' | 'revision'>): boolean {
  return !!s && s.sha256 === id.sha256.toLowerCase() && s.revision === id.revision;
}

/** The confirm-by-render rule: presenting, attached, visible, a fresh frame. */
export function sessionHasFreshFrame(s: NativeSharedVideoState | null | undefined): boolean {
  const o = s?.output;
  return !!s && s.state === 'presenting' && !!o && o.attached && o.visible && o.ageMs <= NATIVE_FIRST_FRESH_MS && o.uniqueFrames > 0;
}

/** Native is presenting REGULAR content on this face (emergency content is never native — §7 E2). */
export function nativePresenting(facts: NativeFirstFacts | null | undefined): boolean {
  return !!facts && facts.protocolMax >= NATIVE_FIRST_PROTOCOL && facts.session?.state === 'presenting';
}

// ── Re-attach and reconcile (§4.3) ───────────────────────────────────────

export type FaceWant =
  /** Native for this identity; `verified` = the decision is `native` (not `wait`). */
  | { kind: 'native'; identity: NativeIntentIdentity; verified: boolean }
  /** Web content on this face (painted beneath before any release). */
  | { kind: 'web' }
  /** The page has not decided yet (no manifest applied): never act. */
  | { kind: 'undecided' };

export type ReattachAction =
  | { kind: 'hold-first' }
  | { kind: 'adopt'; identity: NativeIntentIdentity }
  | { kind: 'intend'; identity: NativeIntentIdentity; start: NativeStart }
  | { kind: 'release'; at: NativeStart }
  | { kind: 'nothing' };

/**
 * What a page (a new one after a reload, or this one after a content change)
 * does about the app's session, per §4.3. `alert` = the manifest carries an
 * alert (the emergency step already raised the hold, which removes every
 * native surface; nothing native is sent).
 *
 *   app presenting X, want native X           → adopt X (intend X, boundary): nothing on glass
 *   app presenting X, want native Y verified  → intend Y at X's boundary
 *   app presenting X, want native Y waiting   → adopt X until Y is verified
 *   app presenting X, want web                → release at X's boundary (web painted beneath first)
 *   app idle (intent suspended by the hold or
 *   none), want native X verified             → intend X now (frame 0)
 *   app holds an intent but presents nothing,
 *   want web                                  → release now
 */
export function reconcileFace(facts: NativeFirstFacts | null, want: FaceWant, alert: boolean): ReattachAction {
  if (alert) return { kind: 'hold-first' };
  if (want.kind === 'undecided' || !facts || facts.protocolMax < NATIVE_FIRST_PROTOCOL) return { kind: 'nothing' };
  const presenting = facts.session?.state === 'presenting' ? facts.session : null;
  if (want.kind === 'web') {
    if (presenting) return { kind: 'release', at: 'boundary' };
    if (facts.intent || facts.session) return { kind: 'release', at: 'now' };
    return { kind: 'nothing' };
  }
  const id = want.identity;
  if (presenting) {
    if (sessionMatches(presenting, id)) return { kind: 'adopt', identity: id };
    if (want.verified) return { kind: 'intend', identity: id, start: 'boundary' };
    const held = facts.intent && sessionMatches(presenting, facts.intent) ? facts.intent : null;
    return held
      ? { kind: 'adopt', identity: { screenId: held.screenId, revision: held.revision, sha256: held.sha256, assetId: held.assetId } }
      : { kind: 'nothing' };
  }
  return want.verified ? { kind: 'intend', identity: id, start: 'now' } : { kind: 'nothing' };
}

// ── Store-mode readiness (§6): the same shapes mediaReadiness reads ───────

/** `lookupCached`'s shape, answered from the store: current = verified by digest; no digest = not answered. */
export function storeLookupCached(
  assets: ReadonlyArray<{ url: string; sha256?: string | null }>,
  store: NativeStoreBlock,
): Record<string, { present: boolean; current: boolean }> {
  const ready = new Set(store.ready);
  const out: Record<string, { present: boolean; current: boolean }> = {};
  for (const a of assets) {
    const sha = typeof a.sha256 === 'string' && SHA_RE.test(a.sha256) ? a.sha256.toLowerCase() : null;
    if (!sha) continue; // a URL-lane file: the worker answers it
    const current = ready.has(sha);
    out[a.url] = { present: current, current };
  }
  return out;
}

export type CacheDrive = 'unknown' | 'ready' | 'unavailable';

/**
 * The readiness inputs in store mode, without touching mediaReadiness.ts
 * (its inputs are the drive and the on-disk keys; only their source moves).
 *
 * Store mode = the manifest names native-first for this face AND the app
 * reports `store.mode = active` AND there is a native-selected file. In any
 * other case — including a store whose state could not be read — the worker
 * path, unchanged: a store failure never means "stream".
 *
 * In store mode the drive is 'ready' — never 'unavailable', which means
 * "stream everything" (`isItemReady`) — and a NATIVE-selected file is on
 * disk exactly when the store lists its digest in `ready`: native reads the
 * store, so the worker's copy does not count for it (phase 1). Everything
 * else keeps the worker's keys. A native-selected file only exists for SOLO
 * content (the server builds the descriptor for nothing else), so no
 * web-played file shares a store-mode face.
 */
export function storeModeReadiness(input: {
  storeMode: boolean;
  store: NativeStoreBlock | null;
  workerDrive: CacheDrive;
  workerKeys: ReadonlySet<string>;
  /** The native-selected files (phase 1: the face's descriptor file), by cache key. */
  nativeFiles: ReadonlyArray<{ key: string; sha256: string }>;
}): { cacheDrive: CacheDrive; onDisk: ReadonlySet<string>; source: 'store' | 'worker' } {
  const { storeMode, store, workerDrive, workerKeys, nativeFiles } = input;
  if (!storeMode || !store || store.mode !== 'active' || nativeFiles.length === 0) {
    return { cacheDrive: workerDrive, onDisk: workerKeys, source: 'worker' };
  }
  const ready = new Set(store.ready);
  const onDisk = new Set(workerKeys);
  for (const f of nativeFiles) {
    if (SHA_RE.test(f.sha256) && ready.has(f.sha256.toLowerCase())) onDisk.add(f.key);
    else onDisk.delete(f.key);
  }
  return { cacheDrive: 'ready', onDisk, source: 'store' };
}
