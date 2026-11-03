import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { ESSENTIALS_TEMPLATE_PRESETS } from './essentials-presets';
import {
  ALL_PRESETS,
  QUARANTINED_PRESET_IDS,
  resolvePresetVerticalTag,
} from './ensure-system-presets';

const EXPECTED_VERTICALS: Record<string, string> = {
  hospitality: 'HOSPITALITY',
  corporate: 'CORPORATE',
  gym: 'GYM',
  healthcare: 'HEALTHCARE',
};

// These are hand-maintained picker entries, so read only the marked block and
// compare its declared IDs with the API-generated catalog.
function webEssentialsIds(): string[] {
  const repoRoot = path.resolve(__dirname, '../../../../');
  const registryPath = path.join(repoRoot, 'apps/web/src/components/widgets/signage-templates.ts');
  const source = readFileSync(registryPath, 'utf8');
  const startMarker = '// GUEST ESSENTIALS COLLECTION';
  const endMarker = '// END GUEST ESSENTIALS COLLECTION';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Guest Essentials picker block markers are missing');

  return source
    .slice(start + startMarker.length, end)
    .split('\n')
    .map((line) => line.match(/"id":\s*"(preset-essentials-[^"]+)"/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1]);
}

describe('Guest Essentials preset catalog', () => {
  it('registers 24 unique presets exactly once and exposes the same IDs in the web picker', () => {
    expect(ESSENTIALS_TEMPLATE_PRESETS).toHaveLength(24);
    const essentialsIds = ESSENTIALS_TEMPLATE_PRESETS.map((preset) => preset.id);
    expect(new Set(essentialsIds).size).toBe(24);

    for (const id of essentialsIds) {
      expect(ALL_PRESETS.filter((preset) => preset.id === id)).toHaveLength(1);
      expect(QUARANTINED_PRESET_IDS.has(id)).toBe(false);
    }

    const pickerIds = webEssentialsIds();
    expect(pickerIds).toHaveLength(24);
    expect(new Set(pickerIds).size).toBe(24);
    expect(new Set(pickerIds)).toEqual(new Set(essentialsIds));
  });

  it('keeps each business vertical scoped correctly in both orientations', () => {
    for (const preset of ESSENTIALS_TEMPLATE_PRESETS) {
      const business = Object.keys(EXPECTED_VERTICALS).find((key) => preset.id.startsWith(`preset-essentials-${key}-`));
      expect(business).toBeDefined();
      const expectedVertical = EXPECTED_VERTICALS[business!];
      const actualVertical = resolvePresetVerticalTag(preset.id);
      expect(actualVertical).toBe(expectedVertical);
      expect(actualVertical).not.toContain('K12');
    }
  });

  it('pairs landscape and portrait entries with matching URLs, dimensions, and real source files', () => {
    const repoRoot = path.resolve(__dirname, '../../../../');
    expect(ESSENTIALS_TEMPLATE_PRESETS.filter((preset) => preset.orientation === 'LANDSCAPE')).toHaveLength(12);
    expect(ESSENTIALS_TEMPLATE_PRESETS.filter((preset) => preset.orientation === 'PORTRAIT')).toHaveLength(12);

    for (const preset of ESSENTIALS_TEMPLATE_PRESETS) {
      const portrait = preset.orientation === 'PORTRAIT';
      const url = preset.zones[0].defaultConfig?.url;
      expect([preset.screenWidth, preset.screenHeight]).toEqual(portrait ? [2160, 3840] : [3840, 2160]);
      expect(url).toEqual(expect.stringMatching(portrait ? /\.html\?o=portrait$/ : /\.html$/));

      const sourcePath = url!.split('?')[0].replace(/^\//, '');
      expect(existsSync(path.join(repoRoot, 'apps/web/public', sourcePath))).toBe(true);

      const baseId = preset.id.replace(/-portrait$/, '');
      const sibling = ESSENTIALS_TEMPLATE_PRESETS.find((candidate) => candidate.id === baseId + (portrait ? '' : '-portrait'));
      expect(sibling).toBeDefined();
      const siblingUrl = sibling!.zones[0].defaultConfig?.url;
      expect(portrait ? url : siblingUrl).toBe(`${portrait ? siblingUrl : url}?o=portrait`);
    }
  });
});
