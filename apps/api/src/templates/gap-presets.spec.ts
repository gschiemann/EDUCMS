import { VERTICALS } from '@cms/api-types';
import { GAP_TEMPLATE_PRESETS } from './gap-presets';
import { ALL_PRESETS, QUARANTINED_PRESET_IDS, resolvePresetVerticalTag, verticalTagIncludes } from './ensure-system-presets';

describe('new workflow gallery availability', () => {
  it('offers each workflow in both orientations with unique, registered ids', () => {
    expect(GAP_TEMPLATE_PRESETS).toHaveLength(6);
    const ids = ALL_PRESETS.map((preset) => preset.id);
    for (const preset of GAP_TEMPLATE_PRESETS) {
      expect(ids.filter((id) => id === preset.id)).toHaveLength(1);
      expect(QUARANTINED_PRESET_IDS.has(preset.id)).toBe(false);
      const portrait = preset.orientation === 'PORTRAIT';
      expect([preset.screenWidth, preset.screenHeight]).toEqual(portrait ? [2160, 3840] : [3840, 2160]);
      expect(preset.zones[0].defaultConfig?.url).toEqual(expect.stringMatching(portrait ? /\?o=portrait$/ : /\.html$/));
    }
  });

  it('offers ordinary service notices to every supported industry in both orientations', () => {
    for (const id of ['preset-sig-corporate-20', 'preset-sig-corporate-20-portrait']) {
      for (const vertical of VERTICALS) {
        expect(verticalTagIncludes(resolvePresetVerticalTag(id), vertical)).toBe(true);
      }
    }
  });

  it('keeps care and school content in the intended galleries, including portrait', () => {
    for (const suffix of ['', '-portrait']) {
      expect(resolvePresetVerticalTag('preset-sig-clinic-02' + suffix)).toBe('HEALTHCARE');
      expect(resolvePresetVerticalTag('preset-school-commencement-guide' + suffix)).toBe('K12');
    }
  });
});
