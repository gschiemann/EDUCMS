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

/** `internal const val CAPABILITY_NONE = "none"` → none */
function probeConst(name: string): string | null {
  const src = read('DisplayCapabilityProbe.kt');
  const m = src.match(
    new RegExp(`const\\s+val\\s+${name}\\s*(?::\\s*String\\s*)?=\\s*"([^"]+)"`),
  );
  return m ? m[1] : null;
}

/**
 * Resolve one MECHANISM-VALUED symbol the probe's fallback can emit.
 *
 * `AudioManagerProvider.id` → that provider's `override val id`;
 * `CAPABILITY_NONE` / `HARD_POWER_OFF_SERIAL` → the probe's own const.
 * Returns null for anything that is not a mechanism (local vals, JSON
 * section names, the SCREAMING_CASE registry lookup keys).
 */
function resolveProbeSymbol(sym: string): string | null {
  const provider = sym.match(/^([A-Za-z0-9_]+Provider)\.id$/);
  if (provider) {
    try {
      return providerId(`${provider[1]}.kt`);
    } catch {
      return null;
    }
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(sym)) return probeConst(sym);
  return null;
}

/**
 * The probe's own heuristic fallbacks — what a box emits when the `control`
 * section itself threw and the registry answer is absent. Part of the device
 * vocabulary too.
 *
 * READS SYMBOLS AS WELL AS LITERALS (fixed 2026-08-14 sweep). This used to
 * scrape ONLY quoted strings out of the `v.put("<key>", …)` call. The probe
 * has since been refactored to reference the same constants the providers
 * expose — `AudioManagerProvider.id`, `SoftwareDimProvider.id`,
 * `CAPABILITY_NONE`, `HARD_POWER_OFF_SERIAL` — so four of the five keys
 * (volume, screenBlank, reboot, hardPowerOff) yielded ZERO strings and the
 * suite failed its own `expect(literals.length).toBeGreaterThan(0)` guard.
 * That guard did its job: it turned a silently-vacuous assertion into a red
 * one rather than letting the drift check quietly stop checking. Resolving
 * the symbols restores the assertion instead of deleting it — the refactor
 * was correct, the parser had simply not followed it.
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

  // Strip comments FIRST. The brightness block carries the line
  // `// SysfsBacklightProvider.id — NOT the bare "sysfs" this used to emit`,
  // and scraping that comment's quoted "sysfs" as if it were a mechanism the
  // probe emits is how a parse like this quietly stops describing the code:
  // it happens to be an accepted value today, so the assertion passed while
  // reporting a mechanism the probe explicitly no longer sends.
  const call = body
    .slice(lparen, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const quoted = [...call.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    // The verdict key itself, and the SCREAMING_CASE registry lookup keys
    // ("VOLUME"/"BRIGHTNESS"/"BLANK"), are not mechanism values.
    .filter((s) => s !== key && !/^[A-Z_]+$/.test(s));

  // …plus every symbol that RESOLVES to a mechanism string.
  const symbols = [
    ...call.matchAll(/\b([A-Za-z0-9_]+Provider\.id|[A-Z][A-Z0-9_]{2,})\b/g),
  ]
    .map((m) => resolveProbeSymbol(m[1]))
    .filter((s): s is string => !!s);

  return [...new Set([...quoted, ...symbols])];
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

  /**
   * PIN WHAT THE FALLBACK PARSE ACTUALLY RESOLVES TO.
   *
   * `expect(literals.length).toBeGreaterThan(0)` proves the parse found
   * SOMETHING; it does not prove it found the right thing. Since the probe
   * now names mechanisms symbolically, a parser bug could resolve a symbol to
   * a plausible-but-wrong id and every membership assertion below would still
   * pass. These are read off DisplayCapabilityProbe.verdict() by hand.
   */
  it('resolves the probe fallback symbols to the real mechanism strings', () => {
    expect(probeVerdictLiterals('volume').sort()).toEqual(['audiomanager', 'none']);
    expect(probeVerdictLiterals('brightness').sort()).toEqual([
      'settings',
      'software-dim',
      'sysfs-backlight',
    ]);
    expect(probeVerdictLiterals('screenBlank')).toEqual(['software-dim']);
    expect(probeVerdictLiterals('reboot').sort()).toEqual(['device-owner', 'none']);
    expect(probeVerdictLiterals('hardPowerOff').sort()).toEqual([
      'none',
      'serial-candidate',
    ]);
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
