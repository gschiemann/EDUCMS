/**
 * DRIFT GUARD — the server's mechanism enums vs the DEVICE's real provider ids.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE P0 THIS EXISTS TO PREVENT (2026-08-13 verify wave, P0-2)
 * ─────────────────────────────────────────────────────────────────────
 * Wave 2 changed `DisplayCapabilityProbe.verdict()` to report the id of the
 * provider that `DisplayControlRegistry` actually resolved — "vendor-recipe",
 * "sysfs-backlight", "screen-timeout". The API's zod enums still only
 * accepted the older heuristic vocabulary, so
 * `POST /screens/:id/display-capabilities` 400'd on EVERY screen in the
 * fleet: no screen could self-describe, every capability-gated control stayed
 * on the unknown-verdict path, and nothing in CI noticed because both halves
 * were internally consistent and separately green.
 *
 * Contract C5 resolves it: THE DEVICE'S VOCABULARY IS AUTHORITATIVE. This
 * spec is the enforcement. It PARSES THE KOTLIN — the provider chains in
 * DisplayControlRegistry.kt, the `override val id` constants in each
 * *Provider.kt, and the probe's own fallback string literals in
 * DisplayCapabilityProbe.kt — and asserts that every value the device can
 * emit for a verdict key is accepted by the matching server enum.
 *
 * WHY PARSE RATHER THAN HARDCODE A LIST: a hardcoded list is a THIRD copy of
 * the vocabulary and drifts exactly like the first two did. Renaming a
 * provider id, or adding a provider to a chain, must fail here.
 *
 * DIRECTION OF THE ASSERTION: device ids ⊆ server enum. The server may accept
 * MORE (the enums deliberately retain the legacy 'device-owner'/'none' blank
 * values, so an older or odd report degrades rather than 400s) but it may
 * never accept LESS — accepting less is the outage.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DISPLAY_BLANK_MECHANISMS,
  DISPLAY_BRIGHTNESS_MECHANISMS,
  DISPLAY_HARD_POWER_OFF_MECHANISMS,
  DISPLAY_REBOOT_MECHANISMS,
  DISPLAY_VOLUME_MECHANISMS,
  DisplayCapabilityReportSchema,
  normalizeVerdict,
} from '@cms/api-types';

// apps/api/src/display → repo root
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const DISPLAY_DIR = path.join(
  REPO_ROOT,
  'apps/player/app/src/main/java/com/educms/player/display',
);

const read = (file: string): string =>
  fs.readFileSync(path.join(DISPLAY_DIR, file), 'utf8');

/** `override val id: String = "software-dim"` → software-dim */
function providerId(file: string): string {
  const src = read(file);
  const m = src.match(/override\s+val\s+id\s*:\s*String\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`no 'override val id' found in ${file}`);
  return m[1];
}

/**
 * Pull the provider OBJECT names out of one `Capability.X to listOf(...)`
 * entry of DisplayControlRegistry.CHAINS.
 */
function chainProviders(capability: string): string[] {
  const src = read('DisplayControlRegistry.kt');
  const re = new RegExp(
    `Capability\\.${capability}\\s+to\\s+listOf\\(([\\s\\S]*?)\\)\\s*,\\s*(?:Capability\\.|\\))`,
  );
  const m = src.match(re);
  if (!m) throw new Error(`no CHAINS entry for Capability.${capability}`);
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /Provider$/.test(s));
}

/** Every provider id reachable for one capability, via its resolution chain. */
function chainIds(capability: string): string[] {
  return chainProviders(capability).map((obj) => providerId(`${obj}.kt`));
}

/**
 * The probe's own heuristic fallbacks — the `?: "literal"` / `when { … }`
 * strings in DisplayCapabilityProbe.verdict(), which are what a box emits
 * when the `control` section itself threw and the registry answer is absent.
 * These are part of the device vocabulary too.
 */
function probeVerdictLiterals(key: string): string[] {
  const src = read('DisplayCapabilityProbe.kt');
  const start = src.indexOf('private fun verdict(');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start);

  // Find the `v.put(` whose FIRST argument is this key — the multi-line form
  // puts the key on its own line, so match both.
  const open = body.search(
    new RegExp(`v\\.put\\(\\s*\\n?\\s*"${key}"`),
  );
  if (open < 0) throw new Error(`verdict() never puts "${key}"`);
  const lparen = body.indexOf('(', open);

  // Balanced-paren slice of the WHOLE put(...) call. Slicing to "the next
  // v.put(" instead swept in the intervening `val` statements and their
  // JSON section names ("serial", "backlightNodes"), which are not
  // mechanisms — a false failure that hid the real signal.
  let depth = 0;
  let end = -1;
  for (let i = lparen; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(lparen);

  return [...body.slice(lparen, end).matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    // The verdict key itself, and the SCREAMING_CASE registry lookup keys
    // ("VOLUME"/"BRIGHTNESS"/"BLANK"), are not mechanism values.
    .filter((s) => s !== key && !/^[A-Z_]+$/.test(s));
}

describe('display mechanism vocabulary — device ids vs server enums', () => {
  it('finds the Kotlin display package (the parse below is meaningless otherwise)', () => {
    expect(fs.existsSync(DISPLAY_DIR)).toBe(true);
    expect(fs.existsSync(path.join(DISPLAY_DIR, 'DisplayControlRegistry.kt'))).toBe(
      true,
    );
  });

  it('parses the real provider ids (and catches a rename)', () => {
    // Spot-check the two that the wave-2 brief got WRONG. The brief said the
    // sysfs provider's id was "sysfs"; it is "sysfs-backlight". Anything that
    // trusts the prose instead of the code re-opens P0-2.
    expect(providerId('SysfsBacklightProvider.kt')).toBe('sysfs-backlight');
    expect(providerId('SoftwareDimProvider.kt')).toBe('software-dim');
    expect(providerId('VendorRecipeProvider.kt')).toBe('vendor-recipe');
    expect(providerId('ScreenTimeoutBlankProvider.kt')).toBe('screen-timeout');
    expect(providerId('DeviceAdminBlankProvider.kt')).toBe('device-admin');
    expect(providerId('AudioManagerProvider.kt')).toBe('audiomanager');
    expect(providerId('DeviceOwnerRebootProvider.kt')).toBe('device-owner');
  });

  const cases: Array<{
    verdictKey: string;
    capability: string | null;
    accepted: readonly string[];
  }> = [
    {
      verdictKey: 'brightness',
      capability: 'BRIGHTNESS',
      accepted: DISPLAY_BRIGHTNESS_MECHANISMS,
    },
    {
      verdictKey: 'screenBlank',
      capability: 'BLANK',
      accepted: DISPLAY_BLANK_MECHANISMS,
    },
    { verdictKey: 'volume', capability: 'VOLUME', accepted: DISPLAY_VOLUME_MECHANISMS },
    { verdictKey: 'reboot', capability: 'REBOOT', accepted: DISPLAY_REBOOT_MECHANISMS },
    // hardPowerOff has no provider chain — it is probe-heuristic only.
    {
      verdictKey: 'hardPowerOff',
      capability: null,
      accepted: DISPLAY_HARD_POWER_OFF_MECHANISMS,
    },
  ];

  describe.each(cases)('$verdictKey', ({ verdictKey, capability, accepted }) => {
    it('accepts every provider id its resolution chain can produce', () => {
      if (!capability) return;
      const ids = chainIds(capability);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect({ key: verdictKey, id, accepted: accepted.includes(id) }).toEqual({
          key: verdictKey,
          id,
          accepted: true,
        });
      }
    });

    it("accepts every literal the probe's own heuristic fallback can emit", () => {
      const literals = probeVerdictLiterals(verdictKey);
      expect(literals.length).toBeGreaterThan(0);
      for (const lit of literals) {
        expect({ key: verdictKey, lit, accepted: accepted.includes(lit) }).toEqual({
          key: verdictKey,
          lit,
          accepted: true,
        });
      }
    });
  });

  it('WAVE-2 REGRESSION: a registry-resolved verdict now PARSES instead of 400ing', () => {
    // Verbatim the shape a Goodview box with a vendor recipe reports.
    const report = {
      schema: 1,
      probedAt: 1_760_000_000_000,
      build: { manufacturer: 'Goodview', model: 'ECBox3576', sdk: 30 },
      verdict: {
        volume: 'audiomanager',
        brightness: 'vendor-recipe',
        screenBlank: 'vendor-recipe',
        reboot: 'none',
        hardPowerOff: 'serial-candidate',
        deviceOwnerPath: 'provisionable-after-factory-reset',
      },
    };
    const parsed = DisplayCapabilityReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    expect(normalizeVerdict(report.verdict)).toEqual(report.verdict);
  });

  it('REGRESSION: the sysfs-backlight + screen-timeout verdict parses too', () => {
    const verdict = {
      volume: 'audiomanager',
      brightness: 'sysfs-backlight',
      screenBlank: 'screen-timeout',
      reboot: 'none',
      hardPowerOff: 'none',
      deviceOwnerPath: 'provisionable-after-factory-reset',
    };
    expect(
      DisplayCapabilityReportSchema.safeParse({ verdict }).success,
    ).toBe(true);
    expect(normalizeVerdict(verdict)).toEqual(verdict);
  });

  it('still degrades an UNKNOWN mechanism to the least-capable value (storage stays bounded)', () => {
    const v = normalizeVerdict({
      volume: 'made-up',
      brightness: 'made-up',
      screenBlank: 'made-up',
      reboot: 'made-up',
      hardPowerOff: 'made-up',
      deviceOwnerPath: 'made-up',
    });
    expect(v).toEqual({
      volume: 'none',
      brightness: 'software-dim',
      screenBlank: 'none',
      reboot: 'none',
      hardPowerOff: 'none',
      deviceOwnerPath: 'provisionable-after-factory-reset',
    });
  });
});
