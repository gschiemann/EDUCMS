/**
 * The web half of the boot + registration proof (2026-09-02, P0-2).
 *
 * Two properties matter here and nothing else does:
 *   1. the CLASSIFIER is right, including its honesty limit — a browser
 *      cannot tell DNS from TLS, so it must never claim either; and
 *   2. every reporter is TOTAL. These calls sit inside the register loop,
 *      whose catch block IS the retry engine. A diagnostics throw would be
 *      indistinguishable from a registration failure and would corrupt the
 *      backoff of the very screen it was meant to explain.
 */

// Makes this file a MODULE rather than a global script — without it `w`
// below collides with the identically-named helper in nativeBridge.test.ts
// under `tsc --noEmit` (Jest isolates files; TypeScript does not).
export {};

const REAL_WINDOW = global.window;

function w(): any {
  return global.window as any;
}

function load() {
  let mod: any;
  jest.isolateModules(() => {
    mod = require('../bootDiagnostics');
  });
  return mod;
}

afterEach(() => {
  delete w().EduCmsNative;
  delete w().EduCmsNativeChannel;
  delete w().__eduCmsNativeChannelMethods;
  jest.resetModules();
});

describe('classifyRegisterFailure', () => {
  it('reads the status out of the register loop’s own HTTP throw', () => {
    const { classifyRegisterFailure } = load();
    const out = classifyRegisterFailure(
      new Error('Registration HTTP 429 SCREEN_REGISTER_RATE_LIMITED — try again'),
    );
    expect(out.cls).toBe('http');
    expect(out.status).toBe(429);
  });

  it('treats an AbortError as a timeout — that is fetchJsonBounded’s deadline', () => {
    const { classifyRegisterFailure } = load();
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(classifyRegisterFailure(err).cls).toBe('timeout');
  });

  it('maps every browser flavour of "the request never landed" to network', () => {
    const { classifyRegisterFailure } = load();
    for (const m of [
      'Failed to fetch',        // Chromium
      'Load failed',            // WebKit
      'NetworkError when attempting to fetch resource', // Gecko
    ]) {
      const err = new TypeError(m);
      expect(classifyRegisterFailure(err).cls).toBe('network');
    }
  });

  it('NEVER claims dns or tls — the browser cannot see the difference', () => {
    // The honesty limit (player rule 10). Only the native probe, which sees
    // the real exception type, may name those. A confident wrong cause in
    // front of an installer is worse than the vague message it replaces.
    const { classifyRegisterFailure } = load();
    const samples = [
      new TypeError('Failed to fetch'),
      new Error('net::ERR_NAME_NOT_RESOLVED'),
      new Error('net::ERR_CERT_DATE_INVALID'),
    ];
    for (const s of samples) {
      expect(['dns', 'tls']).not.toContain(classifyRegisterFailure(s).cls);
    }
  });

  it('recognises a storage fault, which looks like a credential fault', () => {
    const { classifyRegisterFailure } = load();
    const err = new Error('QuotaExceeded');
    err.name = 'QuotaExceededError';
    expect(classifyRegisterFailure(err).cls).toBe('storage');
  });

  it('degrades to unknown rather than throwing on junk', () => {
    const { classifyRegisterFailure } = load();
    expect(classifyRegisterFailure(null).cls).toBe('unknown');
    expect(classifyRegisterFailure(undefined).cls).toBe('unknown');
    expect(classifyRegisterFailure({} as any).cls).toBe('unknown');
    expect(classifyRegisterFailure('a string').cls).toBe('unknown');
  });

  it('truncates the message — an API body must not become an unbounded post', () => {
    const { classifyRegisterFailure } = load();
    const out = classifyRegisterFailure(new Error('x'.repeat(5_000)));
    expect((out.message ?? '').length).toBeLessThanOrEqual(300);
  });
});

describe('the reporters are total and silent without an APK', () => {
  it('no-ops in a plain browser', () => {
    const m = load();
    expect(() => {
      m.reportClientBooted();
      m.reportRegisterAttempt();
      m.reportRegisterSuccess();
      m.reportRegisterFailure(new Error('Registration HTTP 500'));
    }).not.toThrow();
  });

  it('calls the legacy bridge when the APK implements the methods', () => {
    const legacy = {
      bootProof: jest.fn(),
      registerAttempt: jest.fn(),
      registerResult: jest.fn(),
    };
    w().EduCmsNative = legacy;
    const m = load();
    m.reportClientBooted();
    m.reportRegisterAttempt();
    m.reportRegisterSuccess();
    expect(legacy.bootProof).toHaveBeenCalledTimes(1);
    expect(legacy.registerAttempt).toHaveBeenCalledTimes(1);
    expect(JSON.parse(legacy.registerResult.mock.calls[0][0])).toEqual({ ok: true });
  });

  it('sends the classified failure as JSON the Kotlin side can read', () => {
    const legacy = { registerResult: jest.fn() };
    w().EduCmsNative = legacy;
    const m = load();
    m.reportRegisterFailure(new Error('Registration HTTP 503 — upstream'));
    const payload = JSON.parse(legacy.registerResult.mock.calls[0][0]);
    expect(payload.ok).toBe(false);
    expect(payload.class).toBe('http');
    expect(payload.status).toBe(503);
  });

  it('SKIPS the call on a pre-1.1.13 APK instead of posting an unknown method', () => {
    // Player rule 9: the three methods are excluded from KNOWN_METHODS until
    // the fleet floor is 1.1.13, so a manifest-less channel answers false and
    // the post is never made. A dropped post costs nothing; an unknown method
    // posted to an old channel is a silently discarded frame.
    const posted: string[] = [];
    w().EduCmsNativeChannel = { postMessage: (s: string) => posted.push(s) };
    const m = load();
    m.reportClientBooted();
    m.reportRegisterAttempt();
    m.reportRegisterSuccess();
    expect(posted).toHaveLength(0);
  });

  it('uses the channel once the APK advertises the methods', () => {
    const posted: string[] = [];
    w().EduCmsNativeChannel = { postMessage: (s: string) => posted.push(s) };
    w().__eduCmsNativeChannelMethods = ['bootProof', 'registerAttempt', 'registerResult'];
    const m = load();
    m.reportClientBooted();
    expect(JSON.parse(posted[0]).method).toBe('bootProof');
  });

  it('swallows a bridge that throws — the register loop must not see it', () => {
    w().EduCmsNative = {
      bootProof: () => { throw new Error('binder died'); },
    };
    const m = load();
    expect(() => m.reportClientBooted()).not.toThrow();
  });
});

// Guard against a stray global leak between suites.
afterAll(() => {
  global.window = REAL_WINDOW;
});
