/**
 * Screen PIN for the on-screen Unpair (2026-11-09, player stability gap 6).
 *
 * THE THREAT. Somebody at a screen with a USB keyboard opens the Back menu and
 * chooses Unpair. `handleUnpair` (page.tsx) is SERVER-FIRST: it calls
 * `POST /api/v1/screens/unpair/:fp`, then tears down local state and calls the
 * native unpair. A tenant may now set a screen PIN; the SERVER verifies it
 * (`apps/api/src/screens/screen-pin.ts`). This file is the player's half and is
 * pure (no React, no DOM), so every rule is unit-tested in
 * `__tests__/unpairPin.test.ts`:
 *
 *  1. `unpairPinRequired` comes from the last NON-emergency manifest (the key
 *     is absent for a tenant with no PIN; an emergency manifest never carries
 *     it and never moves it). Persisted, so an offline boot still knows.
 *  2. The decision after the server call (`decideUnpairAnswer`). With NO PIN
 *     known the answer is exactly today's: anything except a PIN refusal
 *     proceeds with the local teardown. With a PIN known, ONLY a 2xx proceeds
 *     (and a 401 — that credential is already dead, the screen is already off
 *     the channel, and refusing would only strand a broken screen).
 *  3. OFFLINE + PIN: refused. The device cannot verify a PIN, and a local-only
 *     teardown is not harmless: the screen re-registers with a fingerprint
 *     alone, gets a bootstrap credential every device route refuses, and so
 *     drops off the alert channel exactly as the attack intends. Nothing
 *     brute-forceable (no hash) is ever on the device. The remedy is the
 *     dashboard ("Remove screen"), which is never PIN-gated.
 *  4. PIN entry is a D-pad keypad (`stepPinPad`): parked on "1", arrows move a
 *     visible highlight, OK presses the key, Back always cancels, and a USB
 *     keyboard types digits / Backspace / Enter directly.
 *
 * "Exit to device home" is deliberately NOT gated: without device owner the
 * hardware Home key leaves the app anyway, so a gate adds no security and
 * could strand a technician who must reach Wi-Fi settings on an offline screen.
 */

export const UNPAIR_PIN_STORAGE_KEY = 'edu_unpair_pin_required';
export const UNPAIR_PIN_MIN = 4;
export const UNPAIR_PIN_MAX = 8;

/** Mirrors `apps/api/src/screens/screen-pin.ts`. */
export const UNPAIR_PIN_CODES = {
  required: 'SCREEN_UNPAIR_PIN_REQUIRED',
  wrong: 'SCREEN_UNPAIR_PIN_WRONG',
  locked: 'SCREEN_UNPAIR_PIN_LOCKED',
} as const;

// ── 1. The manifest flag ──────────────────────────────────────────────────

/** The next known value: an emergency manifest keeps the previous one; any other manifest states it. */
export function readManifestUnpairPin(previous: boolean, manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object') return previous;
  const m = manifest as { isEmergency?: unknown; unpairPinRequired?: unknown };
  if (m.isEmergency === true) return previous;
  return m.unpairPinRequired === true;
}

export function readStoredUnpairPin(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(UNPAIR_PIN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStoredUnpairPin(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, required: boolean): void {
  try {
    if (!storage) return;
    if (required) storage.setItem(UNPAIR_PIN_STORAGE_KEY, '1');
    else storage.removeItem(UNPAIR_PIN_STORAGE_KEY);
  } catch {
    /* the in-memory value still serves this document */
  }
}

// ── 2. The server call and the decision after it ──────────────────────────

export type UnpairServerAnswer =
  | { readonly kind: 'network' }
  | { readonly kind: 'http'; readonly status: number; readonly code: string | null; readonly attemptsLeft?: number; readonly retryAfterSeconds?: number };

export type UnpairDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'pin-required' }
  | { readonly kind: 'pin-wrong'; readonly attemptsLeft: number | null }
  | { readonly kind: 'pin-locked'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unreachable' };

/** The refusals only a PIN-holding tenant's server ever sends. */
function pinRefusal(answer: UnpairServerAnswer): UnpairDecision | null {
  if (answer.kind !== 'http') return null;
  if (answer.code === UNPAIR_PIN_CODES.required) return { kind: 'pin-required' };
  if (answer.code === UNPAIR_PIN_CODES.wrong) {
    return { kind: 'pin-wrong', attemptsLeft: typeof answer.attemptsLeft === 'number' ? answer.attemptsLeft : null };
  }
  if (answer.code === UNPAIR_PIN_CODES.locked) {
    return { kind: 'pin-locked', retryAfterSeconds: typeof answer.retryAfterSeconds === 'number' ? answer.retryAfterSeconds : null };
  }
  return null;
}

export function decideUnpairAnswer(answer: UnpairServerAnswer, pinKnown: boolean): UnpairDecision {
  const refusal = pinRefusal(answer);
  if (refusal) return refusal;
  // No PIN known: today's behaviour, byte for byte — the teardown never
  // depended on the server's answer (offline, 5xx, a throttle 429 all proceed).
  if (!pinKnown) return { kind: 'proceed' };
  if (answer.kind === 'network') return { kind: 'unreachable' };
  if (answer.status >= 200 && answer.status < 300) return { kind: 'proceed' };
  if (answer.status === 401) return { kind: 'proceed' };
  // A throttle 429 without our code is still "too many attempts".
  if (answer.status === 429) return { kind: 'pin-locked', retryAfterSeconds: null };
  return { kind: 'unreachable' };
}

export interface ServerUnpairRequest {
  apiRoot: string;
  fingerprint: string;
  token: string;
  /** Omitted = the exact request the player has always sent (no body). */
  pin?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * `POST /api/v1/screens/unpair/:fp`, bounded across the body read. The PIN
 * rides in the JSON body — never in the URL. Never throws.
 */
export async function requestServerUnpair(req: ServerUnpairRequest): Promise<UnpairServerAnswer> {
  const f = req.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!f) return { kind: 'network' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), req.timeoutMs ?? 4000) : null;
  try {
    const headers: Record<string, string> = req.token ? { Authorization: `Bearer ${req.token}` } : {};
    const init: RequestInit = { method: 'POST', headers, signal: controller?.signal };
    if (req.pin !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ pin: req.pin });
    }
    const res = await f(`${req.apiRoot}/api/v1/screens/unpair/${encodeURIComponent(req.fingerprint)}`, init);
    let json: any = null;
    try { json = await res.json(); } catch { /* an empty or non-JSON body has no code */ }
    return {
      kind: 'http',
      status: res.status,
      code: typeof json?.code === 'string' ? json.code : null,
      attemptsLeft: typeof json?.attemptsLeft === 'number' ? json.attemptsLeft : undefined,
      retryAfterSeconds: typeof json?.retryAfterSeconds === 'number' ? json.retryAfterSeconds : undefined,
    };
  } catch {
    return { kind: 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── 3. The keypad ─────────────────────────────────────────────────────────

/** Keypad layout, row by row. '<' = delete, 'ok' = submit. */
export const PIN_PAD_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['<', '0', 'ok'],
];

export type PinPadMessage = 'none' | 'wrong' | 'locked' | 'unreachable' | 'required';

export type PinPadState =
  | { readonly open: false }
  | {
      readonly open: true;
      readonly digits: string;
      readonly row: number;
      readonly col: number;
      /** A submit is in flight: input is ignored until the answer lands. */
      readonly busy: boolean;
      readonly message: PinPadMessage;
      readonly attemptsLeft: number | null;
      readonly retryAfterSeconds: number | null;
    };

export type PinPadEvent =
  | { readonly type: 'open'; readonly message?: PinPadMessage }
  | { readonly type: 'move'; readonly direction: 'up' | 'down' | 'left' | 'right' }
  /** OK on the highlighted key. */
  | { readonly type: 'activate' }
  /** A tap / click (`typed` false), or a key typed on a keyboard (`typed` true). */
  | { readonly type: 'press'; readonly key: string; readonly typed?: boolean }
  | { readonly type: 'back' }
  | { readonly type: 'refused'; readonly decision: UnpairDecision }
  | { readonly type: 'close' };

export interface PinPadStep {
  readonly state: PinPadState;
  /** Set when this event submitted a complete PIN. */
  readonly submit: string | null;
  /** Set when this event cancelled the pad (Back). */
  readonly cancelled: boolean;
}

export const PIN_PAD_CLOSED: PinPadState = Object.freeze({ open: false as const });

const none = (state: PinPadState): PinPadStep => ({ state, submit: null, cancelled: false });

function pressKey(state: Extract<PinPadState, { open: true }>, key: string): PinPadStep {
  if (/^[0-9]$/.test(key)) {
    if (state.digits.length >= UNPAIR_PIN_MAX) return none(state);
    return none({ ...state, digits: state.digits + key, message: state.message === 'wrong' ? 'none' : state.message });
  }
  if (key === '<') {
    if (!state.digits) return none(state);
    return none({ ...state, digits: state.digits.slice(0, -1) });
  }
  if (key === 'ok') {
    if (state.digits.length < UNPAIR_PIN_MIN) return none(state);
    return { state: { ...state, busy: true }, submit: state.digits, cancelled: false };
  }
  return none(state);
}

export function stepPinPad(state: PinPadState, event: PinPadEvent): PinPadStep {
  if (!state.open) {
    if (event.type !== 'open') return none(state);
    return none({
      open: true, digits: '', row: 0, col: 0, busy: false,
      message: event.message ?? 'none', attemptsLeft: null, retryAfterSeconds: null,
    });
  }
  switch (event.type) {
    case 'open':
      return none(state);
    case 'back':
      // Back ALWAYS escapes, even mid-submit.
      return { state: PIN_PAD_CLOSED, submit: null, cancelled: true };
    case 'close':
      return none(PIN_PAD_CLOSED);
    case 'refused': {
      const d = event.decision;
      const message: PinPadMessage =
        d.kind === 'pin-wrong' ? 'wrong'
          : d.kind === 'pin-locked' ? 'locked'
            : d.kind === 'pin-required' ? 'required'
              : d.kind === 'unreachable' ? 'unreachable' : 'none';
      return none({
        ...state, busy: false, digits: '', message,
        attemptsLeft: d.kind === 'pin-wrong' ? d.attemptsLeft : null,
        retryAfterSeconds: d.kind === 'pin-locked' ? d.retryAfterSeconds : null,
      });
    }
    default:
      break;
  }
  if (state.busy) return none(state);
  if (event.type === 'move') {
    const rows = PIN_PAD_KEYS.length;
    const cols = PIN_PAD_KEYS[0].length;
    let { row, col } = state;
    if (event.direction === 'up') row = Math.max(0, row - 1);
    if (event.direction === 'down') row = Math.min(rows - 1, row + 1);
    if (event.direction === 'left') col = Math.max(0, col - 1);
    if (event.direction === 'right') col = Math.min(cols - 1, col + 1);
    return row === state.row && col === state.col ? none(state) : none({ ...state, row, col });
  }
  if (event.type === 'activate') return pressKey(state, PIN_PAD_KEYS[state.row][state.col]);
  if (event.type === 'press') {
    const step = pressKey(state, event.key);
    // A keyboard user types digits and then presses Enter: after a TYPED
    // digit or delete the highlight parks on OK, so Enter submits instead of
    // adding the highlighted digit. A remote or a tap keeps its position.
    if (!event.typed || !step.state.open || step.submit !== null) return step;
    const last = PIN_PAD_KEYS.length - 1;
    const okCol = PIN_PAD_KEYS[last].indexOf('ok');
    return none({ ...step.state, row: last, col: okCol });
  }
  return none(state);
}

/** A keyboard key → a keypad key ('0'-'9', '<', 'ok'), or null. Escape / Back are the page's (they cancel). */
export function pinPadKeyFor(e: { key?: string; keyCode?: number }): string | null {
  const k = e.key;
  if (k && /^[0-9]$/.test(k)) return k;
  if (k === 'Backspace' || k === 'Delete') return '<';
  // Legacy WebViews that report no `key`: DOM keyCode 48-57 are the digit keys.
  if ((!k || k === 'Unidentified') && typeof e.keyCode === 'number' && e.keyCode >= 48 && e.keyCode <= 57) {
    return String(e.keyCode - 48);
  }
  return null;
}
