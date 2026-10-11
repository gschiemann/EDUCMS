/**
 * infoOverlayEvidence.ts — ONE open policy for the screen-information card,
 * and a bounded journal of what opened it (2026-10-10).
 *
 * THE BUG (Vision Core X80, APK 1.1.24, web 78a4130): the blue information
 * card (Sync / Resize / Stop) was found sitting over unattended, playing
 * video on a screen nobody had touched. The persistence half was fixed by the
 * 30-second idle dismissal (7abab895). THIS module is about the other half —
 * the UNEXPECTED OPENING — which the owner named as the actual bug.
 *
 * Source audits of the photographed bundle (Sol + Astra, docs/research/
 * 2026-10-07-fleet-verification/) found no timer, loop-end, watchdog or
 * lifecycle path that sets `showOverlay`; every writer is input-driven: the
 * global Home/i/I shortcut, the root's Enter/Space, and ANY bubbling click on
 * the role=button playback root. The concrete accidental paths were children
 * rendered INSIDE that root whose clicks bubbled into the toggle (the update
 * prompt, the reconnect toast, the trust/status chips, the BLANK layer, the
 * connecting hero), plus a global shortcut that did not care which phase the
 * screen was in or whether the key came from a typing surface.
 *
 * Two jobs, both pure (no React, no network — unit-tested without mounting
 * the 14k-line page):
 *
 *  1. `infoOpenDecision` — the SINGLE policy every opener consults. The card
 *     opens only on playing/offline content, only from an unmodified key or a
 *     click that did not originate on a control / typing / status surface,
 *     never while BLANK, never while playback is deliberately stopped, never
 *     while it is already open. CLOSE is deliberately NOT governed here — the
 *     Back/Escape path and the root toggle still close the card from any
 *     phase, so the remote always has an escape (CLAUDE.md player rule 15).
 *
 *  2. `createInfoOverlayEvidence` — the opener journal. Only ACTUAL openings
 *     persist (two, per face, per tenant+screen, in localStorage); the three
 *     most recent raw inputs stay in memory so an opening can say what
 *     preceded it; refused open attempts are counted in memory by reason so a
 *     screen that keeps receiving a stray Enter on its connecting hero can say
 *     so. The snapshot rides in EVERY 15 s WS HEARTBEAT (`metrics.playerInfo`)
 *     because the gateway REPLACES the metrics hash on each beat — an empty
 *     later beat would erase it — and it stays well under the existing 4 KiB
 *     metrics cap.
 *
 * HONESTY LIMITS — read before drawing conclusions from a journal row:
 *  - `trusted` is the browser's `isTrusted`. It says the event was constructed
 *    by the user agent, NOT that a human touched the device: an OEM remote
 *    driver, a USB HID glitch, an accessibility service or a CEC bridge all
 *    produce trusted events. A synthetic (`dispatchEvent`) click is untrusted
 *    but is also how some accessibility tooling activates buttons, so it is
 *    NEVER rejected on that basis alone — it is only recorded.
 *  - `detail` on a click is the browser's click count; a trusted click with
 *    `detail: 0` and no recent pointerdown is the signature of a keyboard
 *    activation or a programmatic `.click()`, which is useful but not proof.
 *  - `recent` is what THIS document observed in the two seconds before the
 *    opening. An input the WebView consumed natively never reaches it.
 *  - This journal cannot explain the 2026-10-10 photograph; that bundle had no
 *    journal. It can only describe the NEXT opening.
 *
 * NEVER recorded: typed text, non-whitelisted key names, content URLs, asset
 * ids, element ids/classes/text, coordinates, tokens, or whole event objects.
 * Everything restored from storage is rebuilt field-by-field from enums,
 * numbers and booleans; unknown fields do not survive. A disabled, full or
 * corrupt store is caught and can never affect playback.
 */

// ─── Enums (the only strings that ever reach storage or the wire) ──────────
const SOURCES = ['remote-key', 'template-click', 'template-key', 'media-click', 'media-key'] as const;
export type InfoOpenSource = typeof SOURCES[number];
const TARGETS = ['canvas', 'update-prompt', 'information', 'control', 'typing', 'content', 'other'] as const;
export type InfoInputTarget = typeof TARGETS[number];
const TYPES = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'] as const;
const KEYS = ['Home', 'i', 'I', 'Enter', ' ', 'Escape', 'Backspace', 'GoBack', 'Back'] as const;
const POINTERS = ['mouse', 'touch', 'pen'] as const;
/** Why an open request was refused. `target` = control/typing/status/prompt surface. */
const REFUSALS = ['already-open', 'blank', 'stopped', 'phase', 'target', 'modified'] as const;
export type InfoOpenRefusal = typeof REFUSALS[number];
/** Phases on which the card may open: content is on the glass (or the offline copy of it). */
export const INFO_OPEN_PHASES: readonly string[] = ['playing', 'offline'];
/** Input surfaces that are never a canvas activation, for OPEN or CLOSE. */
export const INFO_CONTAINED_TARGETS: readonly InfoInputTarget[] = ['control', 'typing', 'update-prompt', 'information'];

type Input = { type: string; key: string | null; trusted: boolean; target: InfoInputTarget };
type Opening = Input & {
  at: number; source: InfoOpenSource; bundle: string; document: string; uptimeMs: number;
  detail: number | null; pointer: string | null; focused: InfoInputTarget; modifiers: string;
  recent: (Input & { ageMs: number })[];
};
type Refusal = Input & { at: number; reason: InfoOpenRefusal; source: InfoOpenSource; phase: string };

/** The subset of a DOM event this module reads. Never the whole object. */
export type EventLike = {
  type?: string; key?: string; isTrusted: boolean; target?: EventTarget | null;
  detail?: number; pointerType?: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
};

/** The player state the open policy needs. Read from refs at event time, never from a stale closure. */
export type InfoOpenState = {
  phase: string;
  /** `softBlankRef.current` — a dashboard BLANK or soft off-schedule is on the glass. */
  blank: boolean;
  /** `playbackStopped` — the operator's deliberate Stop/Resume surface is up. */
  stopped: boolean;
  /** The card is already open. */
  open: boolean;
};

// ─── Target classification ────────────────────────────────────────────────
/**
 * What kind of surface an event started on. Order matters: the update prompt
 * and the information card are checked before the generic control test so
 * their TEXT (not just their buttons) classifies as contained; a status chip
 * carries `data-edu-player-control-surface` because `role="alert"` text is
 * content to the DOM but an operator surface to a person.
 */
export function infoInputTarget(target: EventTarget | null | undefined): InfoInputTarget {
  if (!(target instanceof Element)) return 'other';
  if (target.closest('[data-edu-update-prompt]')) return 'update-prompt';
  if (target.closest('[data-edu-player-info-panel]')) return 'information';
  if (target.closest('[data-edu-reconnect-toast],[data-edu-player-control-surface]')) return 'control';
  if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return 'typing';
  const control = target.closest('button,a,[role="button"],[role="dialog"]');
  if (control && !control.hasAttribute('data-edu-player-root')) return 'control';
  if (target.hasAttribute('data-edu-player-root')) return 'canvas';
  return target.closest('[data-edu-player-root]') ? 'content' : 'other';
}

/** Unmodified key / plain click that did not start on a contained surface. */
export function infoShortcutAllowed(event: EventLike): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey &&
    !INFO_CONTAINED_TARGETS.includes(infoInputTarget(event.target));
}

/**
 * THE open policy. Every opener (global Home/i, root Enter/Space, root click)
 * asks this and nothing else, so there is exactly one answer to "may the card
 * open right now". Returns `'open'` or the first reason it may not.
 *
 * Deliberately NOT part of the policy: `isTrusted` (see the honesty limits
 * above — accessibility activation is legitimate) and `detail` (a keyboard
 * activation of the root is a real remote press).
 */
export function infoOpenDecision(state: InfoOpenState, event: EventLike): 'open' | InfoOpenRefusal {
  if (state.open) return 'already-open';
  if (state.blank) return 'blank';
  if (state.stopped) return 'stopped';
  if (!INFO_OPEN_PHASES.includes(state.phase)) return 'phase';
  if (INFO_CONTAINED_TARGETS.includes(infoInputTarget(event.target))) return 'target';
  if (event.ctrlKey || event.altKey || event.metaKey) return 'modified';
  return 'open';
}

// ─── Sanitisers ───────────────────────────────────────────────────────────
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  list.includes(value as T) ? (value as T) : null;
const bounded = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(max, Math.round(value))) : 0;

function safeInput(event: EventLike): Input {
  return {
    type: oneOf(TYPES, event.type) ?? 'click',
    key: oneOf(KEYS, event.key),
    trusted: event.isTrusted === true,
    target: infoInputTarget(event.target),
  };
}

function cleanInput(value: Record<string, unknown>): Input {
  return {
    type: oneOf(TYPES, value.type) ?? 'click',
    key: oneOf(KEYS, value.key),
    trusted: value.trusted === true,
    target: oneOf(TARGETS, value.target) ?? 'other',
  };
}

function cleanOpening(item: unknown, now: number): Opening[] {
  if (!item || typeof item !== 'object') return [];
  const value = item as Record<string, unknown>;
  const source = oneOf(SOURCES, value.source);
  if (!source || typeof value.at !== 'number' || value.at > now + 60_000 || now - value.at > 24 * 60 * 60_000) return [];
  return [{
    ...cleanInput(value),
    at: bounded(value.at, Number.MAX_SAFE_INTEGER),
    source,
    // Provenance travels WITH the opening (a restored row keeps the bundle and
    // document it happened in; `snapshot()` carries the current ones beside it).
    bundle: typeof value.bundle === 'string' && /^(?:[a-f0-9]{1,64}|dev)$/.test(value.bundle) ? value.bundle : 'unknown',
    document: typeof value.document === 'string' && /^[a-z0-9]{1,12}$/.test(value.document) ? value.document : 'unknown',
    uptimeMs: bounded(value.uptimeMs, Number.MAX_SAFE_INTEGER),
    detail: typeof value.detail === 'number' ? bounded(value.detail, 10) : null,
    pointer: oneOf(POINTERS, value.pointer),
    focused: oneOf(TARGETS, value.focused) ?? 'other',
    modifiers: typeof value.modifiers === 'string' && /^[cams]{0,4}$/.test(value.modifiers) ? value.modifiers : '',
    recent: Array.isArray(value.recent)
      ? value.recent.slice(-3).flatMap((r: unknown) => r && typeof r === 'object'
        ? [{ ...cleanInput(r as Record<string, unknown>), ageMs: bounded((r as Record<string, unknown>).ageMs, 2000) }]
        : [])
      : [],
  }];
}

const modifiersOf = (e: EventLike) =>
  `${e.ctrlKey ? 'c' : ''}${e.altKey ? 'a' : ''}${e.metaKey ? 'm' : ''}${e.shiftKey ? 's' : ''}`;

// ─── The journal ──────────────────────────────────────────────────────────
/**
 * Per-face, per-tenant journal. Only actual openings write storage; routine
 * inputs and refusals remain in memory. Retain the snapshot in EVERY existing
 * WS heartbeat because the gateway replaces metrics, including with an empty
 * object. localStorage keeps an offline opening available after reconnect or
 * reload. This is observation, never a playback-health verdict or a recovery
 * trigger — nothing reads it on the player.
 *
 * `uptimeMs` on an opening is the time since THIS journal was created in the
 * document that recorded it (identity known), not since the document booted.
 */
export function createInfoOverlayEvidence(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  bundle: string,
  now = Date.now,
) {
  const started = now();
  const documentId = Math.random().toString(36).slice(2, 12);
  const recent: (Input & { at: number })[] = [];
  const refused: Partial<Record<InfoOpenRefusal, number>> = {};
  let lastRefused: Refusal | null = null;
  let events: Opening[] = [];
  try {
    const raw = storage.getItem(key);
    if (raw && raw.length < 4096) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) events = parsed.slice(-2).flatMap(item => cleanOpening(item, now()));
    }
  } catch { /* A disabled/corrupt/full store never affects the player. */ }

  return {
    /** Passive capture observer — never preventDefault, never focus, never synthesize. */
    input(event: EventLike) {
      recent.push({ ...safeInput(event), at: now() });
      if (recent.length > 3) recent.shift();
    },
    /** An opener was refused by `infoOpenDecision`. Counted in memory only. */
    refused(reason: InfoOpenRefusal, source: InfoOpenSource, event: EventLike, phase: string) {
      refused[reason] = Math.min(999, (refused[reason] ?? 0) + 1);
      lastRefused = { ...safeInput(event), at: now(), reason, source, phase: /^[a-z-]{1,16}$/.test(phase) ? phase : 'other' };
    },
    /** The card actually opened. The only call that writes storage. */
    opened(source: InfoOpenSource, event: EventLike) {
      const at = now();
      events.push({
        ...safeInput(event), at, source, bundle, document: documentId, uptimeMs: Math.max(0, at - started),
        detail: typeof event.detail === 'number' ? bounded(event.detail, 10) : null,
        pointer: oneOf(POINTERS, event.pointerType),
        focused: infoInputTarget(typeof document === 'undefined' ? null : document.activeElement),
        modifiers: modifiersOf(event),
        recent: recent.filter(r => at - r.at <= 2000).map(({ at: inputAt, ...input }) => ({ ...input, ageMs: Math.max(0, at - inputAt) })),
      });
      events = events.slice(-2);
      try { storage.setItem(key, JSON.stringify(events)); } catch { /* Memory evidence still works. */ }
    },
    /** What every heartbeat carries. Never cleared after a send. */
    snapshot(open: boolean) {
      return { v: 2, document: documentId, bundle, open, events, refused: { ...refused }, lastRefused };
    },
  };
}

export type InfoOverlayEvidence = ReturnType<typeof createInfoOverlayEvidence>;
