import { FeatureFlagsService, FLAGS } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  const originals: Record<string, string | undefined> = {};

  const restore = () => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  afterEach(restore);

  it('returns false by default when the env var is unset', () => {
    originals.FF_EMERGENCY_NEW_UI = process.env.FF_EMERGENCY_NEW_UI;
    delete process.env.FF_EMERGENCY_NEW_UI;
    const svc = new FeatureFlagsService();
    expect(svc.isEnabled(FLAGS.EMERGENCY_NEW_UI)).toBe(false);
  });

  it('returns true when env is exactly "true"', () => {
    originals.FF_TEMPLATE_BUILDER_V2 = process.env.FF_TEMPLATE_BUILDER_V2;
    process.env.FF_TEMPLATE_BUILDER_V2 = 'true';
    const svc = new FeatureFlagsService();
    expect(svc.isEnabled(FLAGS.TEMPLATE_BUILDER_V2)).toBe(true);
  });

  it('does not accept truthy-but-not-"true" values', () => {
    originals.FF_SIS_INTEGRATION = process.env.FF_SIS_INTEGRATION;
    process.env.FF_SIS_INTEGRATION = '1';
    const svc = new FeatureFlagsService();
    expect(svc.isEnabled(FLAGS.SIS_INTEGRATION)).toBe(false);
  });

  it('allFlags returns every registered flag', () => {
    const svc = new FeatureFlagsService();
    const all = svc.allFlags();
    expect(Object.keys(all).sort()).toEqual(
      Object.values(FLAGS).sort(),
    );
  });
});
