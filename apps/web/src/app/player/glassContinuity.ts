/**
 * Glass continuity (2026-10-11, launch readiness W4 — "nothing unexpected on
 * the glass").
 *
 * The owner's bar for the first customer: a PAIRED screen that has shown
 * content never shows our chrome — no splash, no white/navy "Connecting /
 * Downloading / Content Unavailable / Nothing scheduled" card, no toast, no
 * banner — during normal operation. A reload, a failed file, a cache report
 * that reads empty, a server blip: the glass keeps the last good picture, a
 * still frame, or plain black for a true gap. Our chrome stays where a person
 * is actually installing or operating the screen: the unpaired / first-run
 * splash, the pairing code, and the Back-key "Screen options" surface.
 *
 * Every decision that rule needs lives here, pure (no React, no DOM, no
 * timers, no network), so each shape is tested on its own
 * (`__tests__/glassContinuity.test.ts`). The page owns the effects.
 *
 * NEVER for an emergency: the alert decision precedes everything (player
 * rule 11) and nothing here changes how an alert or its never-evict cache
 * behaves. `quietGlass` is false whenever an alert is up, so an alert's own
 * content keeps exactly the surfaces it had.
 */

import { GLASS_SHOWN_PREFIX, LEGACY_MANIFEST_KEY, MANIFEST_CACHE_PREFIX, MANIFEST_PAIRING_PREFIX } from './offlineBoot';

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The screen id a stored device credential names, or null (no token, not a device token, junk). */
export function tokenScreenId(token: string | null | undefined): string | null {
  try {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) return null;
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4)));
    return p && p.kind === 'device' && typeof p.sub === 'string' && UUID.test(p.sub) ? p.sub : null;
  } catch {
    return null;
  }
}

function recordHasContent(raw: string | null, screenId: string): boolean {
  if (!raw) return false;
  try {
    const r = JSON.parse(raw);
    const m = r && r.m;
    return !!m && m.screenId === screenId && Array.isArray(m.playlists) && m.playlists.length > 0;
  } catch {
    return false;
  }
}

/**
 * Has THIS screen (the one the stored credential names) put operator content
 * on the glass before — this boot or any earlier one? The persisted flag is
 * the primary fact; a playable manifest snapshot that carries playlists is
 * accepted too, so screens already in the field (no flag yet) get the quiet
 * boot on their very first reload after this ships. A screen the server
 * retired (`unpaired` verdict) is never quiet: it must show its pairing code.
 *
 * `quietBootInline.ts` is the ES5 copy of this rule for the first paint; the
 * test runs both against the same fixtures.
 */
export function hasShownContentBefore(store: ReadStore | null | undefined, token: string | null | undefined): boolean {
  if (!store) return false;
  const sid = tokenScreenId(token);
  if (!sid) return false;
  try {
    if (store.getItem(MANIFEST_PAIRING_PREFIX + sid) === 'unpaired') return false;
    if (store.getItem(GLASS_SHOWN_PREFIX + sid) === '1') return true;
    if (recordHasContent(store.getItem(MANIFEST_CACHE_PREFIX + sid + ':playing'), sid)) return true;
    return recordHasContent(store.getItem(LEGACY_MANIFEST_KEY), sid);
  } catch {
    return false;
  }
}

/** Persist "this screen has shown content". Best effort; cleared by clearOfflineManifests. */
export function markContentShown(store: WriteStore | null | undefined, screenId: string | null | undefined): void {
  if (!store || !screenId || !UUID.test(screenId)) return;
  try { store.setItem(GLASS_SHOWN_PREFIX + screenId, '1'); } catch { /* best effort */ }
}

export interface QuietGlassInput {
  /** hasShownContentBefore at boot, or content rendered during this boot. */
  everShown: boolean;
  phase: string;
  /** The operator asked for the Back-key surface — a person is at the screen. */
  playbackStopped: boolean;
  /** Any alert on glass (activeEmergency, a pushed message, an emergency playlist). */
  emergency: boolean;
  /** Dashboard "Open in browser" preview — keeps its diagnostic surfaces. */
  preview: boolean;
}

/**
 * Is our chrome suppressed on this screen right now? True on a paired screen
 * that has shown content, outside the pairing code, outside the operator's
 * Back-key surface, and never while an alert is up.
 */
export function quietGlass(input: QuietGlassInput): boolean {
  return input.everShown && !input.preview && !input.emergency && !input.playbackStopped && input.phase !== 'pairing';
}

// ── Keep the last good file (single-video playlist, all items failed) ────────

export type FailureVerdict = 'set-aside' | 'retry-in-place';

export interface FailureInput {
  isEmergency: boolean;
  syncLocked: boolean;
  /** The failing item played on THIS page before (decoded / painted). */
  provenGood: boolean;
  /** Items other than the failing one that are playable right now. */
  othersPlayable: number;
}

/**
 * A failed item normally leaves the rotation for UNPLAYABLE_RETRY_MS
 * (unplayableMedia.ts) — right when there is something else to show. When it
 * is the LAST thing that can be shown and it has played on this screen
 * before, setting it aside would put a card (or black) where the customer's
 * content was, for five minutes, over one decode error or a stall: the file
 * stays and is re-mounted in place on a short backoff instead. A file that
 * never played here, an emergency playlist (unchanged) and a frame-locked
 * sync group (the timeline owns the slot; held slots are unchanged) keep the
 * old rule.
 */
export function decideItemFailure(input: FailureInput): FailureVerdict {
  if (input.isEmergency || input.syncLocked) return 'set-aside';
  if (!input.provenGood) return 'set-aside';
  return input.othersPlayable > 0 ? 'set-aside' : 'retry-in-place';
}

const RETRY_STEPS_MS = [2_000, 5_000, 10_000, 30_000];
export const LAST_GOOD_RETRY_MAX_MS = 60_000;

/** Backoff for re-mounting the last good file in place (attempt 1, 2, …). */
export function lastGoodRetryDelayMs(attempt: number): number {
  const i = Math.max(1, Math.floor(attempt)) - 1;
  return i < RETRY_STEPS_MS.length ? RETRY_STEPS_MS[i] : LAST_GOOD_RETRY_MAX_MS;
}

// ── An empty cache report is not a fact about the file on glass ──────────────

/**
 * The 30 s cache report said the playlist tier holds 0 files (OS eviction, or
 * a misleading reply). That used to clear every "on disk" mark and unmount
 * the large video that was PLAYING, dropping the screen to the download card.
 * Now the report is only a reason to ask: the page looks each URL up
 * (CACHE_LOOKUP) and this decides what to forget — only URLs the worker says
 * are definitely absent, never a key that is on the glass (`protect`), and
 * nothing at all when the lookup could not answer (unknown ≠ not cached).
 * Returns `prev` itself when nothing changes.
 */
export function reconcileCachedKeys(
  prev: ReadonlySet<string>,
  lookup: Record<string, { present: boolean }> | null | undefined,
  keyOf: (url: string) => string,
  protect: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!lookup) return prev;
  let next: Set<string> | null = null;
  for (const url of Object.keys(lookup)) {
    if (lookup[url]?.present !== false) continue;
    const key = keyOf(url);
    if (!prev.has(key) || protect.has(key)) continue;
    if (!next) next = new Set(prev);
    next.delete(key);
  }
  return next ?? prev;
}

// ── One server answer never takes a playing screen to the pairing code ───────

/** How long a "you are unpaired / a different screen" answer must persist. */
export const UNPAIR_CONFIRM_MS = 60_000;

export type IdentityAction = 'accept' | 'apply' | 'hold';

export interface IdentityAnswer {
  /** `paired` from /screens/register. */
  paired: boolean | undefined;
  /** `screenId` from /screens/register. */
  screenId: string;
  /** The screen this page registered as (null before any registration). */
  knownScreenId: string | null;
}

/**
 * Credential recovery / renewal re-registers; its answer can say "unpaired"
 * or name a DIFFERENT screen. Applied at once that tears down the playlist
 * and shows the pairing code until someone re-pairs — on ONE answer, which a
 * server-side blip can produce. On a screen that has shown content the
 * answer is held: content keeps playing, and the teardown happens only when
 * a second, identical answer arrives at least UNPAIR_CONFIRM_MS after the
 * first. An authenticated TENANT_CHANGED / unpair is a separate, immediate
 * path and does not pass through here. Tokens are untouched either way —
 * the session store (the one writer) already holds whatever the server
 * minted; this only decides what the PAGE shows.
 *
 * `accept`: a benign answer (paired, same screen) — any pending verdict is
 * dropped. `apply`: tear down now. `hold`: keep playing; confirm later.
 */
export class IdentityVerdictGate {
  private pending: { key: string; at: number } | null = null;

  constructor(private readonly confirmMs: number = UNPAIR_CONFIRM_MS) {}

  decide(answer: IdentityAnswer, holding: boolean, nowMs: number): IdentityAction {
    const changed = !!answer.knownScreenId && answer.screenId !== answer.knownScreenId;
    if (answer.paired !== false && !changed) {
      this.pending = null;
      return 'accept';
    }
    if (!holding) {
      this.pending = null;
      return 'apply';
    }
    const key = `${answer.paired === false ? 'unpaired' : 'paired'}:${answer.screenId}`;
    if (this.pending && this.pending.key === key) {
      if (nowMs - this.pending.at >= this.confirmMs) {
        this.pending = null;
        return 'apply';
      }
      return 'hold';
    }
    this.pending = { key, at: nowMs };
    return 'hold';
  }

  /** When a held verdict may be confirmed (ms epoch), or null. */
  confirmDueAt(): number | null {
    return this.pending ? this.pending.at + this.confirmMs : null;
  }

  get isPending(): boolean {
    return this.pending !== null;
  }
}
