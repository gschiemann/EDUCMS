/**
 * THE INTERRUPTION LEDGER — vocabulary, bounds, summary math and the pure
 * transition detectors (2026-10-18, player rock-solid plan §4B / §7).
 *
 * The launch gate is "interruptions per launch screen, 72 h = 0 (emergency
 * drills excluded)". It can only be read if every interruption of content on
 * a screen leaves one row, with WHY it happened (`cause`) and WHO decided it
 * (`source`). Those rows live in the existing per-screen timeline table
 * (`screen_events`, 2026-08-31) beside its older timeline kinds; this file is
 * the one place their vocabulary is defined. No Nest, no Prisma, no network:
 * every rule here is a microsecond unit test (`screen-events.spec.ts`).
 *
 * ── WHAT COUNTS AS AN INTERRUPTION ──────────────────────────────────────
 * Every ledger row counts, except:
 *   • a hardware-video session STARTING (`engine-start`) — that is playback
 *     beginning; whatever stopped the previous picture has its own row;
 *   • an update DOWNLOADING (`ota-download`) — it runs in the background;
 *   • a new Player version REPORTED (`ota-installed`) — the install itself is
 *     the `ota-install` row (and the restart an `app-relaunch` row);
 *   • an alert ENDING (`emergency-clear`) — the alert counted once, at its start;
 *   • a hardware-video STOP whose reason is an alert taking the glass, or an
 *     app restart that is already its own row (`NON_INTERRUPTING_STOP_REASONS`)
 *     — a stop because the playlist moved on (`content-changed`) is not
 *     recorded at all (`UNRECORDED_STOP_REASONS`);
 *   • EMERGENCY DRILLS — every drill row (`detail.drill === true`) is left out
 *     of `interruptions` and counted in `drills` instead.
 *
 * ── WHERE THE ROWS COME FROM (every writer) ─────────────────────────────
 *   page-reload     operator   recordPushDeployment (refresh-web, bulk Resync, publish-to-fleet)
 *                   system     wedge detector (fire + push-dead durable ride)
 *                   system     media-publication sweep (1080p copy ready → REFRESH_WEB)
 *                   device     telemetry `update` (off-hours bundle applied)
 *   app-relaunch    device     status heartbeat: native `proc` (new pid / new boot count)
 *                   device     boot-diagnostic report
 *   engine-start    device     telemetry: a native session reaches `presenting`
 *   engine-stop     device     telemetry: a `failed` native state, or a new entry
 *                              in the APK's persisted session history (1.1.41+)
 *   engine-swap     device     telemetry: web → native / native → web for one file
 *   rendition-swap  operator   "Try full quality again" (PlaybackDemotionService.clear)
 *   demotion        system     PlaybackDemotionService (visible stutter → 1080p copy)
 *   ota-*           device     ota-state transitions; ota-installed on a version change
 *                              (status heartbeat + telemetry)
 *   emergency-*     operator   emergency trigger / all-clear (incl. drills) and the
 *                              per-screen emergency trigger / all-clear
 *
 * ── DISCIPLINE (binding) ────────────────────────────────────────────────
 *   • Best-effort: a ledger write never fails, slows or reorders the request
 *     it describes. Emergency writes are fire-and-forget AFTER the audit row.
 *   • Never manifest-fed: `ScreenEvent` is not in MANIFEST_FED_MODELS, and no
 *     Screen column is written for the ledger.
 *   • Bounded: `detail` ≤ 2 KB, `cause` a short token, rows deduplicated per
 *     (screen, kind, session or cause) — 60 s by default — so a reporting loop
 *     cannot flood a screen's ledger; normal playback leaves no trail (a
 *     native session start and its hand-over once per face × file per 6 h, a
 *     playlist moving on not at all); 30 days / 2,000 rows per screen
 *     retention (screen-events-retention.cron.ts).
 *   • `createdAt` is the event's time, on the SERVER's clock. A device time is
 *     used only clamped inside a window the server itself observed.
 */

export const LEDGER_KINDS = {
  'page-reload': { interruption: true },
  'app-relaunch': { interruption: true },
  'engine-start': { interruption: false },
  'engine-stop': { interruption: true },
  'engine-swap': { interruption: true },
  'rendition-swap': { interruption: true },
  demotion: { interruption: true },
  'ota-download': { interruption: false },
  'ota-install': { interruption: true },
  'ota-installed': { interruption: false },
  'ota-needs-tap': { interruption: true },
  'ota-failed': { interruption: true },
  'emergency-start': { interruption: true },
  'emergency-clear': { interruption: false },
} as const;

export type LedgerKind = keyof typeof LEDGER_KINDS;
export const LEDGER_KIND_LIST: LedgerKind[] = Object.keys(LEDGER_KINDS) as LedgerKind[];

export function isLedgerKind(kind: unknown): kind is LedgerKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_KINDS, kind);
}

/** Who decided: a person, VenueOS itself, or the screen. */
export type LedgerSource = 'operator' | 'system' | 'device';

/**
 * Native stop reasons that are not an interruption on their own: a deliberate
 * content change, an alert taking the glass (counted as `emergency-start`,
 * drills excluded), and the process / device restarts the APK recovers on its
 * next boot (counted as `app-relaunch`).
 */
export const NON_INTERRUPTING_STOP_REASONS: ReadonlySet<string> = new Set([
  'content-changed',
  'emergency-held',
  'process-ended',
  'device-rebooted',
]);

export const LEDGER_DETAIL_MAX_BYTES = 2048;
/** Default dedup window: one row per (screen, kind, session or cause) per minute. */
export const LEDGER_DEDUP_MS = 60_000;
/** Identity-keyed events (a session, a process, a build) happen once; keep their key a day. */
export const LEDGER_IDENTITY_DEDUP_MS = 24 * 60 * 60_000;
/** How far back a backdated event may be placed (a recovered session history entry). */
export const LEDGER_MAX_BACKDATE_MS = 7 * 24 * 60 * 60_000;
/** A web sample / native report this recent still describes what is on the glass now. */
export const NATIVE_SWAP_WINDOW_MS = 3 * 60_000;
/**
 * A native session starting, and the hand-over from the browser that comes
 * with it, are kept once per face × file in this window: a mixed playlist
 * on the hardware engine starts a session per item, and a ledger that
 * recorded each one would be a play log that pushes the real interruptions
 * out of the per-screen cap.
 */
export const NATIVE_START_DEDUP_MS = 6 * 60 * 60_000;
/**
 * Native stop reasons that are the playlist moving on, not an interruption,
 * and are not recorded at all (a stop the ledger can neither count nor need
 * to explain — like `playlist-change`, which it leaves out).
 */
export const UNRECORDED_STOP_REASONS: ReadonlySet<string> = new Set(['content-changed']);

export interface LedgerEventInput {
  screenId: string;
  /** The screen's OWN tenant, from the live row. A row without one is not written. */
  tenantId: string | null | undefined;
  kind: LedgerKind;
  cause: string;
  source: LedgerSource;
  detail?: Record<string, unknown> | null;
  sessionId?: string | null;
  versionCode?: number | null;
  /** When it happened (server clock); default now. Clamped to [now − 7 d, now]. */
  at?: Date | null;
  /** Dedup identity; default `${kind}:${sessionId ?? cause}`. */
  dedupKey?: string;
  /** Dedup window, ms; default 60 s. */
  dedupMs?: number;
}

export interface LedgerRowData {
  screenId: string;
  tenantId: string;
  kind: LedgerKind;
  cause: string;
  source: LedgerSource;
  detail: Record<string, unknown> | null;
  sessionId: string | null;
  versionCode: number | null;
  createdAt: Date;
}

const SOURCES: ReadonlySet<string> = new Set(['operator', 'system', 'device']);

/** A token is read from at most this many characters of its raw value — cut BEFORE anything looks at it. */
export const LEDGER_TOKEN_INPUT_MAX = 128;
/** The longest token stored. */
export const LEDGER_TOKEN_MAX = 64;

const isTokenChar = (c: number): boolean =>
  (c >= 97 && c <= 122) /* a-z */ || (c >= 48 && c <= 57) /* 0-9 */ || c === 95 /* _ */ || c === 46 /* . */;

/**
 * A short, lowercase token: `[a-z0-9_.]` with single `-` between runs, ≤ 64
 * chars, never starting or ending with `-`, never empty (`fallback` instead).
 *
 * Devices and callers control these strings, so the raw value is cut to
 * LEDGER_TOKEN_INPUT_MAX first and then read in ONE linear pass with no
 * regular expression (CodeQL js/polynomial-redos: the earlier
 * `/^-+|-+$/` backtracked quadratically on a long run of `-`). Anything that
 * is not a token character — `-` included — folds into one `-` between the
 * characters it separates.
 */
export function ledgerToken(value: unknown, fallback = 'unknown'): string {
  const raw = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const input = raw.slice(0, LEDGER_TOKEN_INPUT_MAX).toLowerCase();
  let out = '';
  let gap = false;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (!isTokenChar(c)) {
      gap = true;
      continue;
    }
    const dash = gap && out.length > 0;
    if (out.length + (dash ? 2 : 1) > LEDGER_TOKEN_MAX) break;
    if (dash) out += '-';
    out += input[i];
    gap = false;
  }
  return out || fallback;
}

/** `detail` as stored: JSON, at most 2 KB. A larger one keeps its scalar fields, marked `truncated`. */
export function boundDetail(detail: unknown): Record<string, unknown> | null {
  if (detail === null || detail === undefined) return null;
  if (typeof detail !== 'object' || Array.isArray(detail)) {
    return { value: String(detail).slice(0, 256) };
  }
  let json: string;
  try {
    json = JSON.stringify(detail);
  } catch {
    return { unserializable: true };
  }
  if (json === undefined) return null;
  if (Buffer.byteLength(json, 'utf8') <= LEDGER_DETAIL_MAX_BYTES) {
    return JSON.parse(json) as Record<string, unknown>;
  }
  const out: Record<string, unknown> = { truncated: true };
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    let value: unknown;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) value = v;
    else if (typeof v === 'string') value = v.slice(0, 120);
    else continue;
    out[k.slice(0, 64)] = value;
    if (Buffer.byteLength(JSON.stringify(out), 'utf8') > LEDGER_DETAIL_MAX_BYTES) {
      delete out[k.slice(0, 64)];
      break;
    }
  }
  return out;
}

/** The row a ledger event becomes, or null when it cannot be written (no tenant, bad kind). */
export function ledgerRow(input: LedgerEventInput, now: Date = new Date()): LedgerRowData | null {
  if (!input || typeof input.screenId !== 'string' || !input.screenId) return null;
  if (typeof input.tenantId !== 'string' || !input.tenantId) return null;
  if (!isLedgerKind(input.kind)) return null;
  const nowMs = now.getTime();
  const atMs = input.at instanceof Date && Number.isFinite(input.at.getTime()) ? input.at.getTime() : nowMs;
  const createdAt = new Date(Math.min(nowMs, Math.max(nowMs - LEDGER_MAX_BACKDATE_MS, atMs)));
  const versionCode =
    typeof input.versionCode === 'number' && Number.isInteger(input.versionCode) &&
    input.versionCode > 0 && input.versionCode <= 2_147_483_647
      ? input.versionCode
      : null;
  // Cut before it is read, like every caller-controlled string here.
  const sessionRaw = typeof input.sessionId === 'string' ? input.sessionId.slice(0, 256).trim() : '';
  const sessionId = sessionRaw ? sessionRaw.slice(0, 128) : null;
  return {
    screenId: input.screenId,
    tenantId: input.tenantId,
    kind: input.kind,
    cause: ledgerToken(input.cause),
    source: SOURCES.has(input.source) ? input.source : 'device',
    detail: boundDetail(input.detail ?? null),
    sessionId,
    versionCode,
    createdAt,
  };
}

/** The dedup identity of an event (the screen is always part of it). */
export function ledgerDedupKey(input: LedgerEventInput): string {
  const id = input.dedupKey ?? `${input.kind}:${input.sessionId || ledgerToken(input.cause)}`;
  return `${input.screenId}:${id}`.slice(0, 256);
}

// ── Reading: what counts, and the summary ────────────────────────────────

export interface LedgerRowLike {
  kind: string;
  cause?: string | null;
  detail?: unknown;
}

/** Is this row an emergency DRILL (start or end)? Only an explicit `drill: true` is. */
export function isDrillRow(row: LedgerRowLike): boolean {
  if (row.kind !== 'emergency-start' && row.kind !== 'emergency-clear') return false;
  const d = row.detail;
  return !!d && typeof d === 'object' && !Array.isArray(d) && (d as Record<string, unknown>).drill === true;
}

/** Does this row count toward `interruptions`? */
export function countsAsInterruption(row: LedgerRowLike): boolean {
  if (!isLedgerKind(row.kind)) return false;
  if (!LEDGER_KINDS[row.kind].interruption) return false;
  if (row.kind === 'engine-stop' && NON_INTERRUPTING_STOP_REASONS.has(String(row.cause ?? ''))) return false;
  if (isDrillRow(row)) return false;
  return true;
}

export interface LedgerSummary {
  /** Rows that count as interruptions (drills excluded). */
  interruptions: number;
  /** Emergency drills started in the window. */
  drills: number;
  /** Every ledger row in the window, per kind (informational and drill rows included). */
  byKind: Partial<Record<LedgerKind, number>>;
}

/**
 * The summary, from per-(kind, cause) counts plus the number of DRILL alert
 * starts — the shape the database answers cheaply (one groupBy, one count),
 * so the summary stays exact however many rows a screen wrote.
 */
export function summarizeLedger(
  groups: ReadonlyArray<{ kind: string; cause?: string | null; count: number }>,
  drillStarts: number,
): LedgerSummary {
  const byKind: Partial<Record<LedgerKind, number>> = {};
  let interruptions = 0;
  for (const g of groups) {
    if (!isLedgerKind(g.kind)) continue;
    const n = Math.max(0, Math.floor(Number(g.count) || 0));
    if (n === 0) continue;
    byKind[g.kind] = (byKind[g.kind] ?? 0) + n;
    if (countsAsInterruption({ kind: g.kind, cause: g.cause ?? null })) interruptions += n;
  }
  const drills = Math.max(0, Math.min(Math.floor(Number(drillStarts) || 0), byKind['emergency-start'] ?? 0));
  return { interruptions: Math.max(0, interruptions - drills), drills, byKind };
}

/** The same summary from whole rows (tests, small lists). */
export function summarizeLedgerRows(rows: ReadonlyArray<LedgerRowLike>): LedgerSummary {
  const groups = new Map<string, { kind: string; cause: string | null; count: number }>();
  let drillStarts = 0;
  for (const r of rows) {
    const key = `${r.kind}\u0000${r.cause ?? ''}`;
    const g = groups.get(key) ?? { kind: r.kind, cause: r.cause ?? null, count: 0 };
    g.count += 1;
    groups.set(key, g);
    if (r.kind === 'emergency-start' && isDrillRow(r)) drillStarts += 1;
  }
  return summarizeLedger([...groups.values()], drillStarts);
}

// ── Detectors: the transitions each writer turns into rows ───────────────

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const isoMs = (v: unknown): number | null => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  const ms = new Date(v as string).getTime();
  return Number.isFinite(ms) ? ms : null;
};
const sha8 = (sha: string | null): string | null => (sha ? sha.slice(0, 8) : null);

interface ScreenRef {
  screenId: string;
  tenantId: string | null | undefined;
  versionCode?: number | null;
}

/** What the server stored about the last native session (`lastVideoReport.native`). */
interface StoredNative {
  sessionId: string | null;
  state: string | null;
  sha256: string | null;
  faceIndex: number | null;
  atMs: number | null;
  /** `${face}:${at}` of every history entry it carried; null = it carried no history. */
  historyKeys: Set<string> | null;
}

function readStoredNative(report: unknown): StoredNative | null {
  const native = obj(obj(report)?.native);
  if (!native) return null;
  const entries = obj(obj(native.timing)?.history)?.entries;
  return {
    sessionId: str(native.sessionId),
    state: str(native.state),
    sha256: str(native.sha256)?.toLowerCase() ?? null,
    faceIndex: num(native.faceIndex),
    atMs: isoMs(native.at),
    historyKeys: Array.isArray(entries)
      ? new Set(entries.map((e) => historyKey(obj(e))).filter((k): k is string => !!k))
      : null,
  };
}

function historyKey(e: Record<string, unknown> | null): string | null {
  if (!e) return null;
  const at = num(e.at);
  if (at === null) return null;
  return `${num(e.face) ?? 0}:${at}`;
}

/** The parts of a telemetry `nativeVideo` block the ledger reads. */
export interface NativeVideoLike {
  state: string;
  sessionId: string;
  sha256: string;
  faceIndex: number;
  reason?: string;
  codecName?: string;
  sessionProtocol?: number;
  protocol?: number;
  elapsedMs?: number;
  loops?: number;
  output?: { layerMode?: string; compositionMode?: string } | null;
  timing?: { history?: { entries?: ReadonlyArray<Record<string, unknown>> } | null } | null;
}

/**
 * Native session transitions in one telemetry post, against what the server
 * stored from the previous one:
 *   • engine-start — this session reached `presenting` (once per session);
 *   • engine-swap web→native — and the browser was playing this very file a
 *     moment ago (its last sample names it) while no native session was;
 *   • engine-stop — the session reports `failed`, or the APK's persisted
 *     history (1.1.41+) carries an entry the previous report did not
 *     (one per ended session, with the APK's own stop reason);
 *   • engine-swap native→web — the browser now plays the file a native
 *     session was presenting moments ago, and no native session presents it.
 * A first report (nothing stored) is a baseline: it starts sessions but never
 * imports history the server did not see end.
 */
export function nativeEngineEvents(args: ScreenRef & {
  /** `Screen.lastVideoReport` as stored BEFORE this post. */
  storedReport: unknown;
  /** This post's `nativeVideo` block, if any. */
  native: NativeVideoLike | null | undefined;
  /** This post's sanitized web video sample (`sha256` lowercased), if any. */
  webSample: { sha256?: string | null } | null | undefined;
  nowMs: number;
}): LedgerEventInput[] {
  const out: LedgerEventInput[] = [];
  const base = { screenId: args.screenId, tenantId: args.tenantId, versionCode: args.versionCode ?? null };
  const prev = readStoredNative(args.storedReport);
  const cur = args.native ?? null;
  const curSha = cur ? cur.sha256.toLowerCase() : null;
  const stored = obj(args.storedReport);
  const storedWebSha = str(stored?.sha256)?.toLowerCase() ?? null;
  const storedWebAt = isoMs(stored?.at);
  const nowWebSha = str(args.webSample?.sha256)?.toLowerCase() ?? null;
  const recent = (ms: number | null) => ms !== null && args.nowMs - ms >= 0 && args.nowMs - ms <= NATIVE_SWAP_WINDOW_MS;
  const prevPresentingRecently = !!prev && prev.state === 'presenting' && recent(prev.atMs);

  if (cur && cur.state === 'presenting' && !(prev && prev.sessionId === cur.sessionId && prev.state === 'presenting')) {
    out.push({
      ...base,
      kind: 'engine-start',
      cause: 'native',
      source: 'device',
      sessionId: cur.sessionId,
      detail: {
        face: cur.faceIndex,
        sha8: sha8(curSha),
        protocol: cur.sessionProtocol ?? cur.protocol ?? null,
        codec: cur.codecName ?? null,
        layer: cur.output?.layerMode ?? null,
        composition: cur.output?.compositionMode ?? null,
      },
      dedupKey: `engine-start:${cur.faceIndex}:${sha8(curSha)}`,
      dedupMs: NATIVE_START_DEDUP_MS,
    });
    const webHadIt =
      (nowWebSha !== null && nowWebSha === curSha) ||
      (storedWebSha !== null && storedWebSha === curSha && recent(storedWebAt));
    const nativeHadIt = prevPresentingRecently && prev!.sha256 === curSha;
    if (webHadIt && !nativeHadIt) {
      out.push({
        ...base,
        kind: 'engine-swap',
        cause: 'web-to-native',
        source: 'device',
        sessionId: cur.sessionId,
        detail: { face: cur.faceIndex, sha8: sha8(curSha) },
        dedupKey: `engine-swap:w2n:${cur.faceIndex}:${sha8(curSha)}`,
        dedupMs: NATIVE_START_DEDUP_MS,
      });
    }
  }

  if (
    cur && cur.state === 'failed' &&
    !UNRECORDED_STOP_REASONS.has(ledgerToken(cur.reason, 'failed')) &&
    !(prev && prev.sessionId === cur.sessionId && prev.state === 'failed')
  ) {
    out.push({
      ...base,
      kind: 'engine-stop',
      cause: ledgerToken(cur.reason, 'failed'),
      source: 'device',
      sessionId: cur.sessionId,
      detail: { face: cur.faceIndex, sha8: sha8(curSha), elapsedMs: cur.elapsedMs ?? null, loops: cur.loops ?? null },
      dedupKey: `engine-stop:${cur.sessionId}`,
      dedupMs: LEDGER_IDENTITY_DEDUP_MS,
    });
  }

  const entries = cur?.timing?.history?.entries;
  if (prev?.historyKeys && Array.isArray(entries)) {
    const lower = prev.atMs ?? args.nowMs;
    for (const raw of entries.slice(0, 16)) {
      const e = obj(raw);
      const key = historyKey(e);
      if (!e || !key || prev.historyKeys.has(key)) continue;
      if (UNRECORDED_STOP_REASONS.has(ledgerToken(e.reason, 'ended'))) continue;
      const deviceAt = num(e.at)!;
      out.push({
        ...base,
        kind: 'engine-stop',
        cause: ledgerToken(e.reason, 'ended'),
        source: 'device',
        // The APK's history carries no session id; it is keyed by face + time.
        sessionId: null,
        // Device clock, clamped into the window the server saw: after the
        // previous report, not after this one.
        at: new Date(Math.min(args.nowMs, Math.max(lower, deviceAt))),
        detail: {
          face: num(e.face),
          sha8: str(e.sha8),
          build: str(e.build),
          elapsedMs: num(e.elapsedMs),
          loops: num(e.loops),
          recovered: e.recovered === true ? true : undefined,
          layer: str(e.layer),
          composition: str(e.composition),
          deviceAt,
        },
        dedupKey: `engine-stop:h:${key}`,
        dedupMs: LEDGER_IDENTITY_DEDUP_MS,
      });
    }
  }

  if (
    prevPresentingRecently &&
    prev!.sha256 &&
    nowWebSha === prev!.sha256 &&
    !(cur && cur.state === 'presenting' && curSha === prev!.sha256)
  ) {
    out.push({
      ...base,
      kind: 'engine-swap',
      cause: 'native-to-web',
      source: 'device',
      sessionId: prev!.sessionId,
      detail: { face: prev!.faceIndex, sha8: sha8(prev!.sha256) },
      dedupKey: `engine-swap:n2w:${prev!.sessionId ?? prev!.sha256}`,
      dedupMs: LEDGER_IDENTITY_DEDUP_MS,
    });
  }
  return out;
}

/** The `proc` block of a native runtime report: this process's id, start and the box's boot count. */
function readProc(report: unknown): { pid: number; at: number; boot: number | null } | null {
  const p = obj(obj(report)?.proc);
  const pid = num(p?.pid);
  const at = num(p?.at);
  if (pid === null || at === null) return null;
  return { pid, at, boot: num(p?.boot) };
}

/**
 * A Player process that is not the one the server last heard from: a new
 * boot count is a device reboot; otherwise a new process (a crash, a kill,
 * the Manager or Android relaunching it) — or, when the same heartbeat also
 * reports a new Player build, the restart an update install causes. No
 * stored process = no baseline = nothing to compare.
 */
export function procRelaunchEvent(args: ScreenRef & {
  storedReport: unknown;
  storedReportAt: Date | null | undefined;
  report: unknown;
  versionChanged: boolean;
  nowMs: number;
}): LedgerEventInput | null {
  const prev = readProc(args.storedReport);
  const next = readProc(args.report);
  if (!prev || !next) return null;
  const reboot = prev.boot !== null && next.boot !== null && prev.boot !== next.boot;
  const restarted = next.pid !== prev.pid || next.at !== prev.at;
  if (!reboot && !restarted) return null;
  const lower = args.storedReportAt instanceof Date ? args.storedReportAt.getTime() : args.nowMs;
  return {
    screenId: args.screenId,
    tenantId: args.tenantId,
    versionCode: args.versionCode ?? null,
    kind: 'app-relaunch',
    cause: reboot ? 'reboot' : args.versionChanged ? 'update-install' : 'process-restart',
    source: 'device',
    // The process start on the device clock, clamped after the last report the server saw.
    at: new Date(Math.min(args.nowMs, Math.max(lower, next.at))),
    detail: { bootFrom: prev.boot, bootTo: next.boot, deviceAt: next.at },
    dedupKey: `app-relaunch:${next.pid}:${next.at}`,
    dedupMs: LEDGER_IDENTITY_DEDUP_MS,
  };
}

/** Which device OTA states become a ledger kind (on a TRANSITION into them only). */
export function otaLedgerKind(state: string): LedgerKind | null {
  // Bounded before the (linear, anchored) pattern below ever reads it.
  const s = String(state || '').slice(0, 64).toUpperCase();
  if (s === 'DOWNLOADING') return 'ota-download';
  if (s === 'INSTALLING') return 'ota-install';
  if (s === 'NEEDS_TAP') return 'ota-needs-tap';
  if (s === 'ERROR' || s === 'RELAUNCH_BLOCKED' || /^FAILED_[A-Z0-9_]{1,40}$/.test(s)) return 'ota-failed';
  return null;
}

/** A stored OTA state report becomes a row only when the state CHANGED. */
export function otaStateEvent(args: ScreenRef & {
  previousState: string | null | undefined;
  state: string;
  progress: number | null;
  authenticated: boolean;
}): LedgerEventInput | null {
  const kind = otaLedgerKind(args.state);
  if (!kind) return null;
  if (String(args.previousState || '').toUpperCase() === String(args.state).toUpperCase()) return null;
  return {
    screenId: args.screenId,
    tenantId: args.tenantId,
    versionCode: args.versionCode ?? null,
    kind,
    cause: ledgerToken(args.state),
    source: 'device',
    detail: { from: args.previousState ?? null, progress: args.progress, authenticated: args.authenticated },
  };
}

/**
 * A Player build the screen had not reported before (an install landed, or a
 * rollback) — or the build a tracked push offered, now running.
 */
export function versionChangeEvent(args: ScreenRef & {
  previousCode: number | null | undefined;
  reportedCode: number | null | undefined;
  versionName: string | null | undefined;
  pushSatisfied: boolean;
  /** Set by a route that also takes anonymous reports (player-ota update-check): did this one prove the device? */
  authenticated?: boolean;
}): LedgerEventInput | null {
  const to = num(args.reportedCode);
  if (to === null || to <= 0) return null;
  const from = num(args.previousCode);
  const changed = from !== null && from !== to;
  if (!changed && !args.pushSatisfied) return null;
  return {
    screenId: args.screenId,
    tenantId: args.tenantId,
    versionCode: Math.floor(to),
    kind: 'ota-installed',
    cause: changed ? 'version-change' : 'push-satisfied',
    source: 'device',
    detail: {
      from,
      to: Math.floor(to),
      version: str(args.versionName)?.slice(0, 40) ?? null,
      ...(changed && from !== null && to < from ? { rollback: true } : {}),
      ...(typeof args.authenticated === 'boolean' ? { authenticated: args.authenticated } : {}),
    },
    dedupKey: `ota-installed:${Math.floor(to)}`,
    dedupMs: LEDGER_IDENTITY_DEDUP_MS,
  };
}
