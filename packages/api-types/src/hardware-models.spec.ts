/**
 * Runtime sanity check for the HardwareModel ↔ HARDWARE_CATALOG pairing.
 *
 * TypeScript already enforces this at compile time via
 * `Record<HardwareModel, HardwareCapabilities>` — adding a new model
 * literal without a catalog entry fails to compile. This spec is
 * belt-and-suspenders: if anyone widens the catalog typing in the
 * future (e.g. to `Partial<Record<…>>`), the runtime check still fires
 * loudly.
 *
 * 2026-05-27 — co-located with the source per CLAUDE.md "Testing"
 * convention: `*.spec.ts` next to the file under test. The api-types
 * tsconfig excludes `*.spec.ts` from the published build (only the
 * compiled .d.ts / .js ship to the API and web). Jest is opt-in here;
 * apps/api's `jest` is rooted at `apps/api/src`, so this file is a
 * documentation-grade assertion that any package-level test runner
 * (or a future `pnpm --filter @cms/api-types test`) will pick up.
 */

import {
  HARDWARE_MODELS,
  HARDWARE_CATALOG,
  HardwareModel,
  capabilitiesFor,
  resolveHardwareModel,
} from './hardware-models';

describe('hardware-models catalog', () => {
  it('exposes a HARDWARE_CATALOG entry for every HardwareModel literal', () => {
    for (const model of HARDWARE_MODELS) {
      const entry = HARDWARE_CATALOG[model];
      expect(entry).toBeDefined();
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.socOs).toBe('string');
      expect(entry.socOs.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.recommendedVerticals)).toBe(true);
      expect(entry.caps).toBeDefined();
      expect(typeof entry.caps.serialPorts).toBe('number');
      expect(typeof entry.caps.gpioIn).toBe('number');
      expect(typeof entry.caps.gpioOut).toBe('number');
      expect(typeof entry.caps.hdmiIn).toBe('boolean');
      expect(typeof entry.caps.hdmiOut).toBe('boolean');
      expect(typeof entry.caps.chromiumMin).toBe('number');
      expect(entry.caps.chromiumMin).toBeGreaterThan(0);
    }
  });

  it('HARDWARE_CATALOG has no orphan keys (every key is a known HardwareModel)', () => {
    const modelSet = new Set<string>(HARDWARE_MODELS);
    for (const key of Object.keys(HARDWARE_CATALOG)) {
      expect(modelSet.has(key)).toBe(true);
    }
  });

  it('EP6N reports the canonical sports-vertical I/O ring', () => {
    const ep6n = HARDWARE_CATALOG['goodview-ep6n'];
    expect(ep6n.caps.serialPorts).toBe(2);
    expect(ep6n.caps.rs485).toBe(true);
    expect(ep6n.caps.gpioIn).toBe(2);
    expect(ep6n.caps.gpioOut).toBe(2);
    expect(ep6n.caps.hdmiIn).toBe(true);
    expect(ep6n.caps.rj45In).toBe(true);
    expect(ep6n.caps.rj45Out).toBe(true);
    expect(ep6n.caps.powerOutVolts).toBe(12);
    expect(ep6n.caps.npuTops).toBe(6);
    expect(ep6n.caps.duty247Rated).toBe(true);
    expect(ep6n.caps.fanless).toBe(true);
  });

  it('NovaStar Taurus reports Chromium 83 — CLAUDE.md rule #10 trigger', () => {
    expect(HARDWARE_CATALOG['novastar-taurus'].caps.chromiumMin).toBe(83);
  });

  it('unknown model defaults to all-false / 0 capabilities (safe UI default)', () => {
    const unk = HARDWARE_CATALOG['unknown'];
    expect(unk.caps.serialPorts).toBe(0);
    expect(unk.caps.gpioIn).toBe(0);
    expect(unk.caps.gpioOut).toBe(0);
    expect(unk.caps.hdmiIn).toBe(false);
    expect(unk.caps.hdmiOut).toBe(false);
    expect(unk.caps.rj45In).toBe(false);
    expect(unk.caps.rj45Out).toBe(false);
    expect(unk.caps.duty247Rated).toBe(false);
  });

  describe('resolveHardwareModel', () => {
    it('returns "unknown" for null / undefined / empty', () => {
      expect(resolveHardwareModel(null)).toBe('unknown');
      expect(resolveHardwareModel(undefined)).toBe('unknown');
      expect(resolveHardwareModel('')).toBe('unknown');
    });

    it('returns "unknown" for a value not in the catalog', () => {
      expect(resolveHardwareModel('made-up-vendor')).toBe('unknown');
    });

    it('normalizes case and trims whitespace', () => {
      expect(resolveHardwareModel(' Goodview-EP6N ')).toBe('goodview-ep6n');
    });

    it('round-trips every known model', () => {
      for (const m of HARDWARE_MODELS) {
        expect(resolveHardwareModel(m)).toBe(m);
      }
    });
  });

  describe('capabilitiesFor', () => {
    it('returns the unknown-model caps for invalid input', () => {
      const c = capabilitiesFor('not-a-real-model');
      expect(c).toBe(HARDWARE_CATALOG['unknown']);
    });

    it('returns EP6N caps for a valid input', () => {
      const c = capabilitiesFor('goodview-ep6n');
      expect(c).toBe(HARDWARE_CATALOG['goodview-ep6n']);
    });
  });

  it('compile-time guard: HardwareModel type and HARDWARE_MODELS array stay in sync', () => {
    // This is a documentation assertion. If a future agent adds a new
    // HardwareModel literal to the union but forgets to add it to
    // HARDWARE_MODELS, TypeScript won't catch it (the union and the
    // tuple are independent declarations). We fall back to a runtime
    // check that every catalog key appears in the array.
    const arrSet = new Set<string>(HARDWARE_MODELS);
    for (const key of Object.keys(HARDWARE_CATALOG)) {
      expect(arrSet.has(key)).toBe(true);
    }
    // And the reverse — every array entry has a catalog key.
    const catSet = new Set(Object.keys(HARDWARE_CATALOG));
    for (const m of HARDWARE_MODELS) {
      expect(catSet.has(m as string)).toBe(true);
    }
    // Type-level sanity: assignment compiles only if HardwareModel
    // matches the catalog keys.
    const sample: HardwareModel = 'goodview-ep6n';
    expect(HARDWARE_CATALOG[sample]).toBeDefined();
  });
});
