import {
  BURST_THRESHOLD,
  BURST_WINDOW_MS,
  FALLBACK_ERROR_MESSAGE,
  OFFLINE_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  SESSION_ERROR_MESSAGE,
  humanizeMutationError,
  initialBurstState,
  isGlobalErrorSuppressed,
  isHumanReadable,
  planErrorToast,
  type BurstState,
} from '../mutation-error-toast';

/** Build the shape apiFetch throws (see lib/api-client.ts ~line 310). */
function apiError(message: string, status?: number, body?: unknown) {
  const e: any = new Error(message);
  if (status !== undefined) e.status = status;
  if (body !== undefined) e.body = body;
  return e;
}

describe('isHumanReadable', () => {
  it('accepts a real sentence', () => {
    expect(isHumanReadable('A screen with that name already exists.')).toBe(true);
  });

  it.each([
    ['a bare code token', 'FORBIDDEN'],
    ['an ALL_CAPS code', 'AUTH_NO_BEARER_TOKEN'],
    ['spaced caps codes', 'AUTH REFRESH SCOPE CHANGED'],
    ["apiFetch's own placeholder", 'API error: 500'],
    ['an HTML error page', '<html><body>502 Bad Gateway</body></html>'],
    ['a single word', 'Unauthorized'],
    ['something too short', 'no'],
  ])('rejects %s', (_label, value) => {
    expect(isHumanReadable(value)).toBe(false);
  });

  it('rejects a stack trace', () => {
    expect(isHumanReadable('Boom happened\n    at foo (bar.js:1:1)')).toBe(false);
  });

  it('rejects a novel', () => {
    expect(isHumanReadable('word '.repeat(80))).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isHumanReadable(undefined)).toBe(false);
    expect(isHumanReadable(42)).toBe(false);
  });
});

describe('humanizeMutationError', () => {
  it('prefers the server sentence when it reads like one', () => {
    const err = apiError('A screen with that name already exists.', 409, {
      message: 'A screen with that name already exists.',
    });
    expect(humanizeMutationError(err)).toBe('A screen with that name already exists.');
  });

  it('joins class-validator message arrays', () => {
    const err = apiError('a,b', 400, {
      message: ['name must be shorter than 60 characters', 'slug must be lowercase'],
    });
    expect(humanizeMutationError(err)).toBe(
      'name must be shorter than 60 characters. slug must be lowercase',
    );
  });

  it('never leaks the API origin from the network-failure message', () => {
    const err = apiError(
      "Can't reach the server at https://api.internal.example. The API may be restarting — please try again in a moment.",
    );
    expect(humanizeMutationError(err)).toBe(OFFLINE_ERROR_MESSAGE);
    expect(humanizeMutationError(err)).not.toContain('https://');
  });

  it('explains an expired session', () => {
    expect(humanizeMutationError(apiError('Session expired. Please log in again.', 401))).toBe(
      SESSION_ERROR_MESSAGE,
    );
    expect(humanizeMutationError(apiError('Unauthorized', 401))).toBe(SESSION_ERROR_MESSAGE);
  });

  it('falls back to plain English on a 5xx with no usable sentence', () => {
    expect(humanizeMutationError(apiError('API error: 500', 500))).toBe(SERVER_ERROR_MESSAGE);
  });

  it('falls back on a bare code', () => {
    expect(humanizeMutationError(apiError('FORBIDDEN', 403, { message: 'FORBIDDEN' }))).toBe(
      FALLBACK_ERROR_MESSAGE,
    );
  });

  it('falls back on junk', () => {
    expect(humanizeMutationError(null)).toBe(FALLBACK_ERROR_MESSAGE);
    expect(humanizeMutationError('boom')).toBe(FALLBACK_ERROR_MESSAGE);
    expect(humanizeMutationError(undefined)).toBe(FALLBACK_ERROR_MESSAGE);
  });
});

describe('isGlobalErrorSuppressed', () => {
  it('only opts out on an explicit true', () => {
    expect(isGlobalErrorSuppressed({ suppressGlobalError: true })).toBe(true);
    expect(isGlobalErrorSuppressed({ suppressGlobalError: false })).toBe(false);
    expect(isGlobalErrorSuppressed({})).toBe(false);
    expect(isGlobalErrorSuppressed(undefined)).toBe(false);
    // Truthy-but-not-true must NOT silence a failure.
    expect(isGlobalErrorSuppressed({ suppressGlobalError: 'yes' })).toBe(false);
  });
});

describe('planErrorToast', () => {
  it('names the specific problem for the first errors', () => {
    let s: BurstState = initialBurstState;
    const a = planErrorToast(s, 0);
    s = a.state;
    const b = planErrorToast(s, 100);
    expect(a.collapsed).toBe(false);
    expect(b.collapsed).toBe(false);
  });

  it(`collapses once ${BURST_THRESHOLD} land inside the window`, () => {
    let s: BurstState = initialBurstState;
    s = planErrorToast(s, 0).state;
    s = planErrorToast(s, 100).state;
    expect(planErrorToast(s, 200).collapsed).toBe(true);
  });

  it('stays collapsed while the burst rages', () => {
    let s: BurstState = initialBurstState;
    s = planErrorToast(s, 0).state;
    s = planErrorToast(s, 10).state;
    s = planErrorToast(s, 20).state;
    const fourth = planErrorToast(s, 30);
    expect(fourth.collapsed).toBe(true);
    expect(planErrorToast(fourth.state, 40).collapsed).toBe(true);
  });

  it('does not collapse errors spread out beyond the window', () => {
    let s: BurstState = initialBurstState;
    s = planErrorToast(s, 0).state;
    s = planErrorToast(s, BURST_WINDOW_MS + 1).state;
    expect(planErrorToast(s, BURST_WINDOW_MS * 2 + 2).collapsed).toBe(false);
  });

  it('returns to naming the problem once the window has drained', () => {
    let s: BurstState = initialBurstState;
    s = planErrorToast(s, 0).state;
    s = planErrorToast(s, 10).state;
    s = planErrorToast(s, 20).state; // collapsed
    expect(planErrorToast(s, 20 + BURST_WINDOW_MS + 1).collapsed).toBe(false);
  });

  it('respects a caller-supplied window + threshold', () => {
    let s: BurstState = initialBurstState;
    const opts = { windowMs: 100, threshold: 2 };
    s = planErrorToast(s, 0, opts).state;
    expect(planErrorToast(s, 50, opts).collapsed).toBe(true);
    expect(planErrorToast(s, 500, opts).collapsed).toBe(false);
  });

  it('prunes state so it cannot grow without bound', () => {
    let s: BurstState = initialBurstState;
    for (let i = 0; i < 50; i++) s = planErrorToast(s, i * 1000).state;
    // Only timestamps inside the 2s window survive.
    expect(s.recent.length).toBeLessThanOrEqual(BURST_THRESHOLD);
  });
});
