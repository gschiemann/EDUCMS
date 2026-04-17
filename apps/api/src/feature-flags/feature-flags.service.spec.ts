/**
 * FeatureFlagsService test suite.
 *
 * Covers:
 *  1. Legacy env-var fallback (GrowthBook env vars absent / provider fails).
 *  2. OpenFeature delegation path (mocked client).
 */

import { FeatureFlagsService, FLAGS } from './feature-flags.service';
import { OpenFeature, InMemoryProvider } from '@openfeature/server-sdk';

// ---------------------------------------------------------------------------
// Helpers — capture & restore env vars
// ---------------------------------------------------------------------------
const saved: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
}

// Ensure GrowthBook env vars are absent by default so tests use env fallback
beforeEach(() => {
  setEnv({
    GROWTHBOOK_API_HOST: undefined,
    GROWTHBOOK_CLIENT_KEY: undefined,
  });
});

afterEach(restoreEnv);

// ---------------------------------------------------------------------------
// Section 1 — env-var fallback (preserved original tests)
// ---------------------------------------------------------------------------
describe('FeatureFlagsService — env-var fallback', () => {
  it('returns false by default when the env var is unset', async () => {
    setEnv({ FF_EMERGENCY_NEW_UI: undefined });
    const svc = new FeatureFlagsService();
    await svc.onModuleInit();
    expect(svc.isEnabled(FLAGS.EMERGENCY_NEW_UI)).toBe(false);
  });

  it('returns true when env is exactly "true"', async () => {
    setEnv({ FF_TEMPLATE_BUILDER_V2: 'true' });
    const svc = new FeatureFlagsService();
    await svc.onModuleInit();
    expect(svc.isEnabled(FLAGS.TEMPLATE_BUILDER_V2)).toBe(true);
  });

  it('does not accept truthy-but-not-"true" values', async () => {
    setEnv({ FF_SIS_INTEGRATION: '1' });
    const svc = new FeatureFlagsService();
    await svc.onModuleInit();
    expect(svc.isEnabled(FLAGS.SIS_INTEGRATION)).toBe(false);
  });

  it('allFlags returns every registered flag', async () => {
    const svc = new FeatureFlagsService();
    await svc.onModuleInit();
    const all = svc.allFlags();
    expect(Object.keys(all).sort()).toEqual(Object.values(FLAGS).sort());
  });

  it('isEnabledAsync falls back to env var when provider is not ready', async () => {
    setEnv({ FF_EMERGENCY_NEW_UI: 'true' });
    const svc = new FeatureFlagsService();
    await svc.onModuleInit();
    await expect(svc.isEnabledAsync(FLAGS.EMERGENCY_NEW_UI)).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — OpenFeature delegation (mock client via InMemoryProvider)
// ---------------------------------------------------------------------------
describe('FeatureFlagsService — OpenFeature delegation', () => {
  afterEach(async () => {
    // Reset OpenFeature to avoid provider leaking between tests
    try {
      await OpenFeature.clearProviders();
    } catch {
      // ignore
    }
  });

  it('delegates isEnabledAsync to the OpenFeature client when provider is ready', async () => {
    // Use InMemoryProvider from the SDK — no real GrowthBook required
    const provider = new InMemoryProvider({
      [FLAGS.EMERGENCY_NEW_UI]: {
        variants: { on: true, off: false },
        defaultVariant: 'on',
        disabled: false,
      },
    });

    await OpenFeature.setProviderAndWait(provider);

    const svc = new FeatureFlagsService();
    // Manually mark provider as ready (bypasses GrowthBook init path)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).openFeatureReady = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).ofClient = OpenFeature.getClient();

    const result = await svc.isEnabledAsync(FLAGS.EMERGENCY_NEW_UI);
    expect(result).toBe(true);
  });

  it('falls back to env var when OpenFeature client throws during evaluation', async () => {
    setEnv({ FF_TEMPLATE_BUILDER_V2: 'true' });

    const svc = new FeatureFlagsService();
    // Mark ready but inject a client that always throws
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).openFeatureReady = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).ofClient = {
      getBooleanValue: jest.fn().mockRejectedValue(new Error('provider error')),
    };

    await expect(svc.isEnabledAsync(FLAGS.TEMPLATE_BUILDER_V2)).resolves.toBe(true);
  });
});
