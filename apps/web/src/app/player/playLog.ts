import { fetchJsonBounded, headersStatusOf } from './fetchTimeout';

/**
 * playLog.ts — the device play log (2026-11-09, player stability gap 7).
 *
 * WHY. Proof-of-play was a server-side sample every ~10 minutes of which
 * playlist was SCHEDULED. A customer who must prove a given file ran on a
 * given screen at a given time needs what the screen actually SHOWED. This
 * records one entry per playlist item put on the glass: ids, start time on the
 * server-corrected clock, shown duration on the monotonic clock, and whether
 * it ran to its end. Ids and times only — never content text, never anything
 * a person typed.
 *
 * RULES (binding, each pinned by `__tests__/playLog.test.ts`):
 *   • It never affects playback or the emergency path. Every entry point is
 *     wrapped; a failure drops the entry and returns. Nothing here is awaited
 *     by the page.
 *   • Emergency alerts and drills are NOT logged — the audit log is the
 *     record of truth for an alert. A content item an alert cut short is
 *     logged with `completed: false`. No upload while an alert is on glass.
 *   • Bounded memory and durable storage: at most PLAY_LOG_MAX_QUEUE entries,
 *     oldest dropped first, persisted to localStorage (survives a reload and an
 *     offline spell) no more than every 30 s and on pagehide.
 *   • Slow cadence: first upload ~3–4 min after boot, then every 10 min; a
 *     backlog drains one batch per 90 s. Preview tabs never record (the page
 *     never starts this in preview mode).
 *   • The server can stand it down (`stop: true`, the PLAY_LOG_DISABLED kill
 *     switch): the queue is dropped and nothing is recorded or sent until
 *     `retryAfterMs` has passed, across reloads.
 *   • Chromium 83 safe: plain timers and fetchJsonBounded (no
 *     AbortSignal.timeout), no DOM styling at all.
 *
 * `completed`: true when the item was shown for at least its planned duration
 * minus 1 s; for an item with no planned duration (a video that plays to its
 * end), true unless it was cut short (alert, blank, stop, playlist change to
 * nothing, page exit). A single item on glass for a long time is split into
 * PLAY_LOG_SEGMENT_MS segments so a solo slide still leaves a trail.
 */

export const PLAY_LOG_STORAGE_KEY = 'edu_play_log_v1';
export const PLAY_LOG_MAX_QUEUE = 2_000;
export const PLAY_LOG_BATCH = 200;
export const PLAY_LOG_TICK_MS = 30_000;
export const PLAY_LOG_FIRST_UPLOAD_MS = 180_000;
export const PLAY_LOG_UPLOAD_INTERVAL_MS = 600_000;
export const PLAY_LOG_DRAIN_INTERVAL_MS = 90_000;
export const PLAY_LOG_SEGMENT_MS = 15 * 60_000;
/** Shorter than this is a transition flicker, not a play. */
export const PLAY_LOG_MIN_SHOWN_MS = 250;
export const PLAY_LOG_COMPLETE_SLACK_MS = 1_000;
export const PLAY_LOG_DEFAULT_STOP_MS = 6 * 3_600_000;
const MAX_ID = 128;
const ID_RE = /^[A-Za-z0-9_.:-]+$/;

export interface PlayLogShown {
  playlistId: string;
  itemId: string;
  assetId: string | null;
  /** The item's planned on-glass time, or null (plays to its end). */
  plannedMs: number | null;
}

export interface PlayLogEntry {
  startedAt: number;
  shownMs: number;
  completed: boolean;
  playlistId: string;
  itemId: string;
  assetId: string | null;
}

type CloseReason = 'advance' | 'segment' | 'interrupted';

function cleanId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > 0 && s.length <= MAX_ID && ID_RE.test(s) ? s : null;
}

/**
 * What the play log should consider "on glass" right now, or null for
 * nothing loggable: no item, an emergency (alert or drill) on glass or an
 * emergency playlist, a blanked / stopped screen, or a page not playing.
 */
export function playLogShown(
  item: any,
  playlist: any,
  gates: { emergency: boolean; blanked: boolean; playing: boolean },
): PlayLogShown | null {
  try {
    if (!item || !playlist || gates.emergency || gates.blanked || !gates.playing) return null;
    if (playlist.isEmergency) return null;
    const playlistId = cleanId(playlist.id);
    const itemId = cleanId(item.id);
    if (!playlistId || !itemId) return null;
    const planned = Number(item.durationMs);
    return {
      playlistId,
      itemId,
      assetId: cleanId(item.asset?.id ?? item.assetId),
      plannedMs: Number.isFinite(planned) && planned > 0 ? planned : null,
    };
  } catch {
    return null;
  }
}

const sameShown = (a: PlayLogShown | null, b: PlayLogShown | null) =>
  !!a && !!b && a.playlistId === b.playlistId && a.itemId === b.itemId;

const entryKey = (e: PlayLogEntry) => `${e.startedAt}|${e.itemId}`;

/**
 * The pure core: the open entry, the bounded queue, and the upload decision.
 * Takes every clock as an argument (wall = server-corrected epoch ms, mono =
 * performance.now()), so it is unit-testable without timers.
 */
export class PlayLogCore {
  queue: PlayLogEntry[] = [];
  stopUntil = 0;
  dirty = false;
  private open: { shown: PlayLogShown; wallStart: number; monoStart: number } | null = null;
  private emergency = false;
  private nextUploadAt: number;
  private inFlight: Set<string> | null = null;

  constructor(nowMono: number, firstUploadMs = PLAY_LOG_FIRST_UPLOAD_MS) {
    this.nextUploadAt = nowMono + firstUploadMs;
  }

  stopped(wallMs: number): boolean {
    return wallMs < this.stopUntil;
  }

  /** The page's view of the glass changed (or re-rendered). Idempotent. */
  observe(shown: PlayLogShown | null, emergency: boolean, wallMs: number, monoMs: number): void {
    this.emergency = emergency;
    if (this.open && sameShown(this.open.shown, shown)) return;
    this.close(shown ? 'advance' : 'interrupted', monoMs);
    if (shown && !this.stopped(wallMs)) this.open = { shown, wallStart: Math.round(wallMs), monoStart: monoMs };
  }

  /** Periodic: split a long-running entry into segments. */
  tick(wallMs: number, monoMs: number): void {
    const o = this.open;
    if (!o || monoMs - o.monoStart < PLAY_LOG_SEGMENT_MS) return;
    this.close('segment', monoMs);
    if (!this.stopped(wallMs)) this.open = { shown: o.shown, wallStart: Math.round(wallMs), monoStart: monoMs };
  }

  /** Close whatever is open as cut short (page exit, stop). */
  interrupt(monoMs: number): void {
    this.close('interrupted', monoMs);
  }

  private close(reason: CloseReason, monoMs: number): void {
    const o = this.open;
    this.open = null;
    if (!o) return;
    const shownMs = Math.max(0, Math.round(monoMs - o.monoStart));
    if (shownMs < PLAY_LOG_MIN_SHOWN_MS) return;
    const planned = o.shown.plannedMs;
    const completed = planned !== null ? shownMs >= planned - PLAY_LOG_COMPLETE_SLACK_MS : reason !== 'interrupted';
    this.push({
      startedAt: o.wallStart,
      shownMs,
      completed,
      playlistId: o.shown.playlistId,
      itemId: o.shown.itemId,
      assetId: o.shown.assetId,
    });
  }

  push(e: PlayLogEntry): void {
    this.queue.push(e);
    if (this.queue.length > PLAY_LOG_MAX_QUEUE) this.queue.splice(0, this.queue.length - PLAY_LOG_MAX_QUEUE);
    this.dirty = true;
  }

  /** The batch to send now, or null. Never while an alert is on glass. */
  takeBatch(wallMs: number, monoMs: number): PlayLogEntry[] | null {
    if (this.inFlight || this.emergency || this.stopped(wallMs)) return null;
    if (monoMs < this.nextUploadAt || this.queue.length === 0) return null;
    const batch = this.queue.slice(0, PLAY_LOG_BATCH);
    this.inFlight = new Set(batch.map(entryKey));
    return batch;
  }

  /** Apply the server's answer to the batch in flight. */
  settle(result: { status: number | null; json: any }, wallMs: number, monoMs: number): void {
    const sent = this.inFlight;
    this.inFlight = null;
    if (!sent) return;
    const { status, json } = result;
    const ok = status !== null && status >= 200 && status < 300;
    if (ok && json && json.stop === true) {
      const ms = Number(json.retryAfterMs);
      this.stopUntil = wallMs + (Number.isFinite(ms) && ms > 0 ? Math.min(ms, 7 * 86_400_000) : PLAY_LOG_DEFAULT_STOP_MS);
      this.queue = [];
      this.open = null;
      this.dirty = true;
      this.nextUploadAt = monoMs + PLAY_LOG_UPLOAD_INTERVAL_MS;
      return;
    }
    // 2xx = stored (or already stored); 400 / 413 = a batch the server will
    // never take — drop it rather than resend it forever. Anything else
    // (401, 429, 5xx, no answer) keeps the entries for the next slot.
    if (ok || status === 400 || status === 413) {
      this.queue = this.queue.filter((e) => !sent.has(entryKey(e)));
      this.dirty = true;
    }
    const backlog = ok && this.queue.length >= PLAY_LOG_BATCH;
    this.nextUploadAt = monoMs + (backlog ? PLAY_LOG_DRAIN_INTERVAL_MS : PLAY_LOG_UPLOAD_INTERVAL_MS);
  }

  serialize(screenId: string): string {
    return JSON.stringify({
      v: 1,
      s: screenId,
      u: this.stopUntil,
      q: this.queue.map((e) => [e.startedAt, e.shownMs, e.completed ? 1 : 0, e.playlistId, e.itemId, e.assetId]),
    });
  }

  /** Restore a persisted queue. Another screen's queue (a re-pair) is dropped. */
  load(raw: string | null, screenId: string): void {
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      if (!p || p.v !== 1 || p.s !== screenId) return;
      if (typeof p.u === 'number' && Number.isFinite(p.u)) this.stopUntil = p.u;
      const q: PlayLogEntry[] = [];
      for (const t of Array.isArray(p.q) ? p.q : []) {
        if (!Array.isArray(t) || typeof t[0] !== 'number' || typeof t[1] !== 'number') continue;
        const playlistId = cleanId(t[3]);
        const itemId = cleanId(t[4]);
        if (!playlistId || !itemId) continue;
        q.push({ startedAt: t[0], shownMs: t[1], completed: t[2] === 1, playlistId, itemId, assetId: cleanId(t[5]) });
      }
      this.queue = q.slice(-PLAY_LOG_MAX_QUEUE);
    } catch {
      /* unreadable — start empty */
    }
  }
}

export interface PlayLogHandle {
  observe(shown: PlayLogShown | null, emergency: boolean): void;
  stop(): void;
}

export interface PlayLogDeps {
  screenId: string;
  getToken: () => string | null;
  apiRoot: () => string;
  /** Server minus device clock, ms (the AUTH_OK-learned offset). */
  clockOffsetMs: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  post?: (url: string, init: RequestInit) => Promise<{ status: number | null; json: any }>;
  now?: () => number;
  mono?: () => number;
}

async function defaultPost(url: string, init: RequestInit): Promise<{ status: number | null; json: any }> {
  try {
    const out = await fetchJsonBounded(url, init, 15_000);
    return { status: out.res.status, json: out.json };
  } catch (e) {
    return { status: headersStatusOf(e), json: null };
  }
}

/** The glue: timers, storage, network. Every path swallows its failures. */
export function startPlayLog(deps: PlayLogDeps): PlayLogHandle {
  const now = deps.now || (() => Date.now());
  const mono = deps.mono || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const wall = () => {
    let off = 0;
    try { off = Number(deps.clockOffsetMs()) || 0; } catch { off = 0; }
    return now() + off;
  };
  let storage: PlayLogDeps['storage'] = null;
  try { storage = deps.storage !== undefined ? deps.storage : window.localStorage; } catch { storage = null; }
  const post = deps.post || defaultPost;
  const jitter = Math.floor(Math.random() * 60_000);
  const core = new PlayLogCore(mono(), PLAY_LOG_FIRST_UPLOAD_MS + jitter);
  try { core.load(storage ? storage.getItem(PLAY_LOG_STORAGE_KEY) : null, deps.screenId); } catch { /* ignore */ }
  let stopped = false;

  const persist = () => {
    if (!core.dirty || !storage) return;
    try {
      storage.setItem(PLAY_LOG_STORAGE_KEY, core.serialize(deps.screenId));
      core.dirty = false;
    } catch {
      // Quota or a locked store: shed the older half so the alert cache and
      // everything else in localStorage keep their room; retry next tick.
      core.queue = core.queue.slice(Math.floor(core.queue.length / 2));
    }
  };

  const upload = () => {
    let batch: PlayLogEntry[] | null = null;
    try {
      const token = deps.getToken();
      if (!token) return;
      batch = core.takeBatch(wall(), mono());
      if (!batch) return;
      const url = `${deps.apiRoot()}/api/v1/screens/${encodeURIComponent(deps.screenId)}/play-log`;
      post(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entries: batch }),
      })
        .then((r) => { try { core.settle(r, wall(), mono()); persist(); } catch { /* dropped */ } })
        .catch(() => { try { core.settle({ status: null, json: null }, wall(), mono()); } catch { /* dropped */ } });
    } catch {
      if (batch) { try { core.settle({ status: null, json: null }, wall(), mono()); } catch { /* dropped */ } }
    }
  };

  const tick = () => {
    if (stopped) return;
    try { core.tick(wall(), mono()); } catch { /* dropped */ }
    persist();
    upload();
  };
  const timer = setInterval(tick, PLAY_LOG_TICK_MS);
  const onHide = () => {
    try { core.interrupt(mono()); } catch { /* dropped */ }
    persist();
  };
  try { window.addEventListener('pagehide', onHide); } catch { /* no window */ }

  return {
    observe(shown, emergency) {
      if (stopped) return;
      try { core.observe(shown, emergency, wall(), mono()); } catch { /* dropped */ }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try { window.removeEventListener('pagehide', onHide); } catch { /* no window */ }
      onHide();
    },
  };
}
