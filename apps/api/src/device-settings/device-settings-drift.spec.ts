/**
 * DRIFT GUARD — the player's settings vocabulary and this API's must be the
 * same strings (2026-10-18). The unit's report is parsed against the zod
 * enums in `@cms/api-types/device-settings.ts`; a key or code the Kotlin
 * emits and the server does not know would be read as `unsupported`, a
 * dropped reason or — for a key or a status — a dropped report. This reads
 * the real Kotlin (`DeviceSettingKey.kt`) and fails on any difference, the
 * same way `display-mechanism-drift.spec.ts` pins the display vocabulary.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DEVICE_SETTING_ATTENTIVE_TIMEOUTS_MS,
  DEVICE_SETTING_CAPABILITY_CODES,
  DEVICE_SETTING_KEYS,
  DEVICE_SETTING_STATUSES,
  DEVICE_SETTING_TIMEOUTS_MS,
  DEVICE_SETTING_WHY_CODES,
  DEVICE_SETTINGS_HEADER,
  DEVICE_SETTINGS_MAX_HEADER_CHARS,
  DEVICE_SETTINGS_MIN_BRIGHTNESS,
  DEVICE_WIFI_APPROVAL,
} from '@cms/api-types';

// apps/api/src/device-settings → repo root
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SETTINGS_DIR = path.join(REPO_ROOT, 'apps/player/app/src/main/java/com/educms/player/settings');
const read = (file: string) => fs.readFileSync(path.join(SETTINGS_DIR, file), 'utf8');

const keySrc = read('DeviceSettingKey.kt');

/** Every `const val NAME = "value"` inside `object DeviceSettingCodes { … }`. */
function codeConstants(): Map<string, string> {
  const start = keySrc.indexOf('object DeviceSettingCodes');
  const end = keySrc.indexOf('object DeviceSettingDomains');
  const body = keySrc.slice(start, end);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/const val ([A-Z_]+) = "([^"]+)"/g)) out.set(m[1], m[2]);
  return out;
}

describe('device settings — Kotlin ↔ TypeScript vocabulary', () => {
  it('the keys are the enum DeviceSettingKey wire names, in order', () => {
    const wire = [...keySrc.matchAll(/^\s+[A-Z_]+\("([a-zA-Z]+)", (?:true|false)\)[,;]/gm)].map((m) => m[1]);
    expect(wire).toEqual([...DEVICE_SETTING_KEYS]);
  });

  it('every capability code, waiting reason and failure code is known to the server', () => {
    const codes = new Set(codeConstants().values());
    const capabilities = new Set<string>(DEVICE_SETTING_CAPABILITY_CODES);
    const why = new Set<string>(DEVICE_SETTING_WHY_CODES);
    for (const code of codes) {
      expect(capabilities.has(code) || why.has(code)).toBe(true);
    }
    // …and nothing the server accepts is unknown to the player.
    for (const code of [...capabilities, ...why]) expect(codes.has(code)).toBe(true);
  });

  it('the capability reasons the player lists are exactly the server’s', () => {
    const constants = codeConstants();
    const listed = keySrc.match(/val CAPABILITY_REASONS = setOf\(([\s\S]*?)\)/)![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => constants.get(name));
    expect(new Set(listed)).toEqual(new Set(DEVICE_SETTING_CAPABILITY_CODES.filter((c) => c !== 'ok')));
  });

  it('the statuses match DeviceSettingsPolicy.Status', () => {
    const src = read('DeviceSettingsPolicy.kt');
    const statuses = [...src.matchAll(/^\s+[A-Z]+\("([a-z]+)"\)[,;]/gm)].map((m) => m[1]);
    expect(new Set(statuses)).toEqual(new Set(DEVICE_SETTING_STATUSES));
  });

  it('the value rules agree: brightness floor, timeouts, header name and size, approval vocabulary', () => {
    expect(keySrc).toContain(`const val MIN_BRIGHTNESS = ${DEVICE_SETTINGS_MIN_BRIGHTNESS}`);
    const timeouts = keySrc.match(/val TIMEOUTS_MS: Set<Int> = setOf\(([^)]*)\)/)![1]
      .split(',')
      .map((s) => s.trim().replace(/_/g, ''))
      .map((s) => (s === 'TIMEOUTNEVER' ? 2_147_483_647 : Number(s)));
    expect(timeouts).toEqual([...DEVICE_SETTING_TIMEOUTS_MS]);
    const attentive = keySrc.match(/val ATTENTIVE_TIMEOUTS_MS: Set<Int> = setOf\(([^)]*)\)/)![1]
      .split(',')
      .map((s) => s.trim().replace(/_/g, ''))
      .map((s) => (s === 'ATTENTIVENEVER' ? -1 : Number(s)));
    expect(attentive).toEqual([...DEVICE_SETTING_ATTENTIVE_TIMEOUTS_MS]);
    expect(read('DeviceSettings.kt')).toContain(`const val HEADER = "${DEVICE_SETTINGS_HEADER}"`);
    expect(read('DeviceSettingsWire.kt')).toContain(`const val MAX_REPORT_CHARS = ${DEVICE_SETTINGS_MAX_HEADER_CHARS}`);
    const facts = read('DeviceSettingsFacts.kt');
    for (const a of DEVICE_WIFI_APPROVAL) expect(facts).toContain(`= "${a}"`);
  });
});
