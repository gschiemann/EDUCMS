/**
 * Screen PIN for the on-screen Unpair — the pure half (unpairPin.ts).
 * The page wiring is pinned by unpairPinWiring.test.ts; the server half by
 * apps/api/src/screens/screen-pin.spec.ts.
 */
import {
  PIN_PAD_CLOSED,
  UNPAIR_PIN_STORAGE_KEY,
  decideUnpairAnswer,
  pinPadKeyFor,
  readManifestUnpairPin,
  readStoredUnpairPin,
  requestServerUnpair,
  stepPinPad,
  writeStoredUnpairPin,
  type PinPadEvent,
  type PinPadState,
  type UnpairServerAnswer,
} from '../unpairPin';

const http = (status: number, code: string | null = null, extra: Record<string, number> = {}): UnpairServerAnswer => ({ kind: 'http', status, code, ...extra });

describe('the manifest flag', () => {
  it('a normal manifest states it; the key absent means no PIN', () => {
    expect(readManifestUnpairPin(false, { unpairPinRequired: true, playlists: [] })).toBe(true);
    expect(readManifestUnpairPin(true, { playlists: [] })).toBe(false);
    expect(readManifestUnpairPin(true, { unpairPinRequired: 'yes' })).toBe(false);
  });
  it('an emergency manifest never moves it, nor does garbage', () => {
    expect(readManifestUnpairPin(true, { isEmergency: true })).toBe(true);
    expect(readManifestUnpairPin(false, { isEmergency: true, unpairPinRequired: true })).toBe(false);
    expect(readManifestUnpairPin(true, null)).toBe(true);
  });
  it('persists and survives broken storage', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    writeStoredUnpairPin(storage, true);
    expect(map.get(UNPAIR_PIN_STORAGE_KEY)).toBe('1');
    expect(readStoredUnpairPin(storage)).toBe(true);
    writeStoredUnpairPin(storage, false);
    expect(readStoredUnpairPin(storage)).toBe(false);
    const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(readStoredUnpairPin(broken)).toBe(false);
    expect(() => writeStoredUnpairPin(broken, true)).not.toThrow();
  });
});

describe('the decision after the server call', () => {
  it('NO PIN known = today: every answer proceeds (offline, 5xx, 401, a throttle 429, 2xx)', () => {
    for (const a of [{ kind: 'network' } as const, http(500), http(401), http(429), http(200), http(404)]) {
      expect(decideUnpairAnswer(a, false)).toEqual({ kind: 'proceed' });
    }
  });
  it('a PIN refusal is honoured even when no PIN was known yet (the flag was stale)', () => {
    expect(decideUnpairAnswer(http(403, 'SCREEN_UNPAIR_PIN_REQUIRED'), false)).toEqual({ kind: 'pin-required' });
    expect(decideUnpairAnswer(http(403, 'SCREEN_UNPAIR_PIN_WRONG', { attemptsLeft: 2 }), true)).toEqual({ kind: 'pin-wrong', attemptsLeft: 2 });
    expect(decideUnpairAnswer(http(429, 'SCREEN_UNPAIR_PIN_LOCKED', { retryAfterSeconds: 900 }), true)).toEqual({ kind: 'pin-locked', retryAfterSeconds: 900 });
  });
  it('PIN known: only a 2xx (or a dead credential, 401) proceeds; OFFLINE is refused', () => {
    expect(decideUnpairAnswer(http(200), true)).toEqual({ kind: 'proceed' });
    expect(decideUnpairAnswer(http(401), true)).toEqual({ kind: 'proceed' });
    expect(decideUnpairAnswer({ kind: 'network' }, true)).toEqual({ kind: 'unreachable' });
    expect(decideUnpairAnswer(http(503), true)).toEqual({ kind: 'unreachable' });
    expect(decideUnpairAnswer(http(429), true)).toEqual({ kind: 'pin-locked', retryAfterSeconds: null });
  });
});

describe('requestServerUnpair', () => {
  const res = (status: number, body: unknown) => ({ status, json: async () => body }) as unknown as Response;

  it('without a PIN sends EXACTLY the old request: POST, bearer only, no body', async () => {
    const fetchImpl = jest.fn(async () => res(200, { ok: true }));
    const a = await requestServerUnpair({ apiRoot: 'https://api', fingerprint: 'fp/1', token: 'tok', fetchImpl: fetchImpl as any });
    expect(a).toEqual({ kind: 'http', status: 200, code: null, attemptsLeft: undefined, retryAfterSeconds: undefined });
    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe('https://api/api/v1/screens/unpair/fp%2F1');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
  });

  it('with a PIN: JSON body, never in the URL; reads the refusal code', async () => {
    const fetchImpl = jest.fn(async () => res(403, { code: 'SCREEN_UNPAIR_PIN_WRONG', attemptsLeft: 3 }));
    const a = await requestServerUnpair({ apiRoot: 'https://api', fingerprint: 'fp', token: 'tok', pin: '4821', fetchImpl: fetchImpl as any });
    expect(a).toMatchObject({ kind: 'http', status: 403, code: 'SCREEN_UNPAIR_PIN_WRONG', attemptsLeft: 3 });
    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).not.toContain('4821');
    expect(init.body).toBe(JSON.stringify({ pin: '4821' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('a network failure, a timeout or a non-JSON body never throws', async () => {
    expect(await requestServerUnpair({ apiRoot: 'x', fingerprint: 'f', token: '', fetchImpl: (async () => { throw new TypeError('offline'); }) as any })).toEqual({ kind: 'network' });
    const nonJson = { status: 502, json: async () => { throw new SyntaxError('html'); } } as unknown as Response;
    expect(await requestServerUnpair({ apiRoot: 'x', fingerprint: 'f', token: '', fetchImpl: (async () => nonJson) as any })).toMatchObject({ kind: 'http', status: 502, code: null });
    jest.useFakeTimers();
    try {
      const hang = jest.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const p = requestServerUnpair({ apiRoot: 'x', fingerprint: 'f', token: 't', timeoutMs: 4000, fetchImpl: hang as any });
      jest.advanceTimersByTime(4000);
      expect(await p).toEqual({ kind: 'network' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the keypad', () => {
  const run = (events: PinPadEvent[], from: PinPadState = PIN_PAD_CLOSED) => {
    let state = from;
    const submits: string[] = [];
    let cancelled = 0;
    for (const e of events) {
      const step = stepPinPad(state, e);
      state = step.state;
      if (step.submit) submits.push(step.submit);
      if (step.cancelled) cancelled += 1;
    }
    return { state, submits, cancelled };
  };

  it('opens parked on "1" and the D-pad enters a PIN: arrows move, OK presses', () => {
    const r = run([
      { type: 'open' },
      { type: 'activate' }, // 1
      { type: 'move', direction: 'right' }, { type: 'activate' }, // 2
      { type: 'move', direction: 'down' }, { type: 'activate' }, // 5
      { type: 'move', direction: 'down' }, { type: 'move', direction: 'down' }, { type: 'activate' }, // 0
      { type: 'move', direction: 'right' }, { type: 'activate' }, // ok
    ]);
    expect(r.submits).toEqual(['1250']);
    expect(r.state).toMatchObject({ open: true, busy: true });
  });

  it('starts parked on 1, clamps at the edges', () => {
    const r = run([{ type: 'open' }, { type: 'move', direction: 'up' }, { type: 'move', direction: 'left' }]);
    expect(r.state).toMatchObject({ row: 0, col: 0, digits: '' });
  });

  it('a USB keyboard types digits, deletes, and Enter submits (typed digits park on OK)', () => {
    const r = run([
      { type: 'open' },
      { type: 'press', key: '9', typed: true }, { type: 'press', key: '8', typed: true },
      { type: 'press', key: '7', typed: true }, { type: 'press', key: '<', typed: true },
      { type: 'press', key: '6', typed: true }, { type: 'press', key: '5', typed: true },
      { type: 'activate' }, // Enter on the parked OK
    ]);
    expect(r.submits).toEqual(['9865']);
  });

  it('never submits fewer than 4 digits and never takes more than 8', () => {
    let r = run([{ type: 'open' }, { type: 'press', key: '1' }, { type: 'press', key: '2' }, { type: 'press', key: '3' }, { type: 'press', key: 'ok' }]);
    expect(r.submits).toEqual([]);
    r = run([{ type: 'open' }, ...Array.from({ length: 12 }, () => ({ type: 'press', key: '7' }) as PinPadEvent)]);
    expect(r.state).toMatchObject({ digits: '77777777' });
  });

  it('Back ALWAYS escapes — empty, mid-entry, even while a submit is in flight', () => {
    expect(run([{ type: 'open' }, { type: 'back' }])).toMatchObject({ state: PIN_PAD_CLOSED, cancelled: 1 });
    expect(run([{ type: 'open' }, { type: 'press', key: '1' }, { type: 'back' }]).state).toBe(PIN_PAD_CLOSED);
    const busy = run([{ type: 'open' }, ...'1234'.split('').map((key) => ({ type: 'press', key }) as PinPadEvent), { type: 'press', key: 'ok' }]);
    expect(busy.state).toMatchObject({ busy: true });
    expect(run([{ type: 'back' }], busy.state)).toMatchObject({ state: PIN_PAD_CLOSED, cancelled: 1 });
  });

  it('ignores input while busy; a refusal clears the digits and says why', () => {
    const busy = run([{ type: 'open' }, ...'1234'.split('').map((key) => ({ type: 'press', key }) as PinPadEvent), { type: 'press', key: 'ok' }]).state;
    expect(run([{ type: 'press', key: '5' }, { type: 'move', direction: 'down' }], busy).state).toBe(busy);
    const wrong = run([{ type: 'refused', decision: { kind: 'pin-wrong', attemptsLeft: 3 } }], busy).state;
    expect(wrong).toMatchObject({ busy: false, digits: '', message: 'wrong', attemptsLeft: 3 });
    const locked = run([{ type: 'refused', decision: { kind: 'pin-locked', retryAfterSeconds: 900 } }], busy).state;
    expect(locked).toMatchObject({ message: 'locked', retryAfterSeconds: 900 });
    expect(run([{ type: 'refused', decision: { kind: 'unreachable' } }], busy).state).toMatchObject({ message: 'unreachable' });
  });

  it('an open with a message (learned from the server) shows it', () => {
    expect(run([{ type: 'open', message: 'required' }]).state).toMatchObject({ message: 'required' });
  });

  it('maps keyboard keys', () => {
    expect(pinPadKeyFor({ key: '7' })).toBe('7');
    expect(pinPadKeyFor({ key: 'Backspace' })).toBe('<');
    expect(pinPadKeyFor({ key: 'Delete' })).toBe('<');
    expect(pinPadKeyFor({ keyCode: 52 })).toBe('4');
    expect(pinPadKeyFor({ key: 'Escape' })).toBeNull();
    expect(pinPadKeyFor({ key: 'Enter' })).toBeNull();
  });
});
