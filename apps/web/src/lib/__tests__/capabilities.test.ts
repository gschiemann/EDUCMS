/**
 * Contract tests for the capability-detection module.
 *
 * These exist because of the 2026-09-05 change that removed three dynamic
 * `import()` calls for polyfill packages that were never installed
 * (`intersection-observer`, `resize-observer-polyfill`, `broadcast-channel`).
 * The bundler resolved those specifiers at BUILD time, so each one printed
 * `Module not found` on every build and every dev compile — three times over
 * — while the try/catch around them only ever caught the runtime rejection.
 *
 * What must not regress:
 *   • `ensurePolyfill` NEVER throws or rejects, for any feature, in either
 *     branch. Callers treat it as best-effort.
 *   • When the native API is present it is a silent no-op — no warning.
 *   • When the native API is absent it resolves and warns AT MOST ONCE per
 *     feature (the old implementation warned on every call).
 *   • `detectCapabilities` is feature-based and memoized.
 */
import {
  detectCapabilities,
  ensurePolyfill,
  _resetCapabilitiesForTest,
  type PolyfillFeature,
} from '../capabilities';

const FEATURES: PolyfillFeature[] = [
  'intersection-observer',
  'resize-observer',
  'broadcast-channel',
];

const NATIVE_BY_FEATURE: Record<PolyfillFeature, string> = {
  'intersection-observer': 'IntersectionObserver',
  'resize-observer': 'ResizeObserver',
  'broadcast-channel': 'BroadcastChannel',
};

describe('detectCapabilities', () => {
  beforeEach(() => _resetCapabilitiesForTest());

  it('detects by feature presence, not by user-agent version', () => {
    (window as any).IntersectionObserver = function () {};
    const caps = detectCapabilities();
    expect(caps.intersectionObserver).toBe(true);

    // Removing the global does NOT change the answer — detection is memoized
    // for the page lifetime (the device's engine cannot change mid-session).
    delete (window as any).IntersectionObserver;
    expect(detectCapabilities().intersectionObserver).toBe(true);

    // ...and re-detects only through the explicit test hook.
    _resetCapabilitiesForTest();
    expect(detectCapabilities().intersectionObserver).toBe(false);
  });
});

describe('ensurePolyfill', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    _resetCapabilitiesForTest();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    for (const g of Object.values(NATIVE_BY_FEATURE)) delete (window as any)[g];
  });

  it.each(FEATURES)('is a silent no-op when %s is native', async (feature) => {
    (window as any)[NATIVE_BY_FEATURE[feature]] = function () {};
    _resetCapabilitiesForTest();

    await expect(ensurePolyfill(feature)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(FEATURES)(
    'resolves (never rejects) when %s is missing and no polyfill is bundled',
    async (feature) => {
      delete (window as any)[NATIVE_BY_FEATURE[feature]];
      _resetCapabilitiesForTest();

      // The load-bearing assertion: a missing polyfill degrades, it never
      // throws. Every caller is expected to have its own fallback.
      await expect(ensurePolyfill(feature)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(feature);
    },
  );

  it('warns at most once per feature, however many times it is called', async () => {
    delete (window as any).IntersectionObserver;
    _resetCapabilitiesForTest();

    await ensurePolyfill('intersection-observer');
    await ensurePolyfill('intersection-observer');
    await ensurePolyfill('intersection-observer');

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
