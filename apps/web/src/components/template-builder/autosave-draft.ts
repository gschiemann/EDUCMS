/**
 * Local draft autosave + crash recovery — Wave C / editor-crush C1
 * (2026-07-02).
 *
 * Audit finding (05-EDITOR-CRUSH-LENSES.md, editor-workflow lens,
 * "Autosave is disabled and there is zero draft recovery"): explicit
 * Save stays the "this is live" step (AUTO_SAVE_IDLE_MS scaffolding in
 * BuilderShell.tsx was deliberately disabled because auto-persisting to
 * the SERVER made changes "stick" without the operator asking for it —
 * see the comment at BuilderShell.tsx ~376). That reasoning is sound
 * and untouched here. What was missing is a LOCAL-ONLY safety net: a
 * crash, killed tab, or battery death between two manual Saves loses
 * everything, because `beforeunload` never fires on those paths.
 *
 * This module continuously mirrors the dirty builder state into
 * localStorage (never the server), keyed by templateId, and exposes a
 * tiny API BuilderShell.tsx wires into a one-line restore/discard bar.
 * It is a pure OBSERVER of the store: it only calls
 * `useBuilderStore.getState()` to read a snapshot, never a store
 * action, so it can never push a history entry, open a transaction, or
 * otherwise interact with the undo/redo model the canvas relies on
 * (Wave A A2 keystroke-coalescing + the beginTransaction/
 * activeTransaction machinery). Autosave literally cannot see
 * `activeTransaction` because it never calls anything that reads it.
 *
 * Scheduling: a debounced flush ~3s after the last change, PLUS a hard
 * ceiling flush every ~30s while continuously dirty (so a long,
 * unbroken typing/dragging session is never more than 30s from a
 * local checkpoint — the debounce alone would keep resetting forever
 * on continuous activity and never actually write).
 */

const DEBOUNCE_MS = 3_000;
const MAX_INTERVAL_MS = 30_000;
/** Skip persisting (and log once) any draft whose JSON exceeds this —
 *  a giant base64 bgImage data URL or a runaway zones array shouldn't
 *  silently blow out localStorage's ~5-10MB origin quota and start
 *  evicting OTHER templates' drafts. */
const MAX_DRAFT_BYTES = 2 * 1024 * 1024; // 2MB
const KEY_PREFIX = 'educms_builder_draft_';

const draftKey = (templateId: string) => `${KEY_PREFIX}${templateId}`;

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Private-browsing Safari throws on ACCESS (not just on write) in
    // some old versions; SSR has no window at all. Either way, autosave
    // degrades to a no-op — the explicit Save button still works.
    return null;
  }
}

/** The shape written to localStorage. Mirrors exactly what handleSave
 *  persists (zones + meta + the two touch scalars) so a restored draft
 *  is a faithful stand-in for "what I would have saved." `savedAt` is
 *  wall-clock ms, compared against the server template's `updatedAt`
 *  to decide whether the draft is actually newer (see isDraftNewer). */
export interface BuilderDraft {
  templateId: string;
  savedAt: number;
  zones: unknown[];
  meta: Record<string, unknown>;
  isTouchEnabled?: boolean;
  idleResetMs?: number;
}

/**
 * Best-effort write. Never throws — a draft is a nice-to-have, not a
 * load-bearing operation, and a failure here must never surface to the
 * operator or block their edit.
 *
 * Capacity guard: (a) skip entirely (with a one-time console.warn, not
 * a thrown error) if this draft alone exceeds MAX_DRAFT_BYTES; (b) on
 * a QuotaExceededError from setItem (localStorage full — shared origin
 * quota across every open template's draft plus everything else the
 * app stores there), evict the SINGLE oldest educms_builder_draft_*
 * entry and retry once. One eviction is enough for the common case
 * (one stale draft from a template closed weeks ago); if it still
 * fails after that we give up silently rather than loop.
 */
export function writeDraft(draft: BuilderDraft): void {
  const storage = getStorage();
  if (!storage) return;
  let serialized: string;
  try {
    serialized = JSON.stringify(draft);
  } catch {
    return; // circular/unserializable state — should never happen, but never throw
  }
  if (serialized.length > MAX_DRAFT_BYTES) {
    console.warn(
      `[autosave] draft for template ${draft.templateId} is ${Math.round(serialized.length / 1024)}KB — over the ${MAX_DRAFT_BYTES / 1024 / 1024}MB cap, skipping local draft this cycle`,
    );
    return;
  }
  try {
    storage.setItem(draftKey(draft.templateId), serialized);
  } catch {
    // Likely QuotaExceededError (private-mode Safari caps localStorage
    // very low, or the origin's quota is genuinely full of old drafts).
    // Evict the oldest OTHER draft and retry once.
    if (evictOldestDraft(draft.templateId)) {
      try {
        storage.setItem(draftKey(draft.templateId), serialized);
      } catch {
        /* still full — give up silently, explicit Save is unaffected */
      }
    }
  }
}

/** Removes the oldest draft (by `savedAt`) other than `excludeTemplateId`.
 *  Returns true if something was evicted (so the caller knows a retry
 *  might succeed). Corrupt/unparseable entries are treated as
 *  infinitely old so they get cleaned up first. */
function evictOldestDraft(excludeTemplateId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    if (key === draftKey(excludeTemplateId)) continue;
    let at = -1;
    try {
      const parsed = JSON.parse(storage.getItem(key) || '{}');
      at = typeof parsed?.savedAt === 'number' ? parsed.savedAt : -1;
    } catch {
      at = -1; // corrupt entry — evict it first (treat as oldest)
    }
    if (at < oldestAt) {
      oldestAt = at;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    try {
      storage.removeItem(oldestKey);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Reads back the draft for a template, or null if none / corrupt. */
export function readDraft(templateId: string): BuilderDraft | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(templateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.zones)) return null;
    return parsed as BuilderDraft;
  } catch {
    return null;
  }
}

/** Clears the draft — called on successful Save (the server now has
 *  this state, so the local safety net for it is stale) and on
 *  explicit Discard of a restore prompt. */
export function clearDraft(templateId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(draftKey(templateId));
  } catch {
    /* non-fatal */
  }
}

/**
 * A draft is worth offering to restore only when it is NEWER than the
 * template's last known server save — otherwise the operator would be
 * "restoring" something already superseded (or just re-showing their
 * own already-saved state, which is a confusing no-op prompt). `null`/
 * `undefined` serverUpdatedAt (a template with no updatedAt threaded
 * through, or one that's never been saved) treats any draft as newer.
 */
export function isDraftNewer(draft: BuilderDraft | null, serverUpdatedAt: string | null | undefined): boolean {
  if (!draft) return false;
  if (!serverUpdatedAt) return true;
  const serverMs = Date.parse(serverUpdatedAt);
  if (Number.isNaN(serverMs)) return true;
  return draft.savedAt > serverMs;
}

/**
 * The debounce + max-interval scheduler. One instance is created per
 * mounted builder (BuilderShell owns the lifecycle: create on mount,
 * `dispose()` on unmount). `notifyChange()` is called from a
 * lightweight store subscription every time zones/meta/isDirty
 * changes; it does NOT read activeTransaction or push history — it
 * only decides WHEN to call the read-only `getSnapshot` the caller
 * supplied.
 */
export interface AutosaveScheduler {
  /** Call whenever the watched store slice changes. Cheap — just
   *  (re)arms timers; the actual write only happens when a timer fires. */
  notifyChange(): void;
  /** Stop all pending timers. Call on unmount / after a successful Save
   *  (immediately followed by clearDraft so nothing stale reappears). */
  dispose(): void;
}

export function createAutosaveScheduler(getSnapshot: () => BuilderDraft): AutosaveScheduler {
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let maxIntervalHandle: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = () => {
    if (disposed) return;
    if (debounceHandle) { clearTimeout(debounceHandle); debounceHandle = null; }
    if (maxIntervalHandle) { clearTimeout(maxIntervalHandle); maxIntervalHandle = null; }
    writeDraft(getSnapshot());
  };

  return {
    notifyChange() {
      if (disposed) return;
      // Reset the debounce window — a fresh 3s of quiet writes a draft.
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(flush, DEBOUNCE_MS);
      // The max-interval ceiling is armed ONCE per "burst" (i.e. only
      // when nothing is already pending) so continuous activity still
      // forces a checkpoint every ~30s instead of debounce perpetually
      // postponing it.
      if (!maxIntervalHandle) {
        maxIntervalHandle = setTimeout(flush, MAX_INTERVAL_MS);
      }
    },
    dispose() {
      disposed = true;
      if (debounceHandle) { clearTimeout(debounceHandle); debounceHandle = null; }
      if (maxIntervalHandle) { clearTimeout(maxIntervalHandle); maxIntervalHandle = null; }
    },
  };
}

/** Human-friendly "5 min ago" for the restore bar. Mirrors
 *  BuilderToolbar.tsx's formatRelative so the two surfaces read
 *  consistently; kept as a separate tiny copy rather than an import
 *  since that helper isn't exported and this module must stay
 *  independent of the toolbar. */
export function formatDraftAge(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const sec = Math.floor(delta / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}
