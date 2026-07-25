import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';
import { resolvePresetVerticalTag } from './ensure-system-presets';

/**
 * Portrait siblings must inherit their landscape preset's vertical.
 *
 * 2026-07-24 regression: the id→industry regex was `^preset-sig-(.+)-\d+$`,
 * which a portrait id (`preset-sig-worship-01-portrait`) does not match because
 * it doesn't end in digits. Every one of the 36 new portrait boards silently
 * kept the K12 default — hiding them from Worship/QSR AND leaking church + QSR
 * menu boards into the K-12 gallery. Caught only by querying the seeded rows.
 *
 * These asserts make the invariant structural: a `-portrait` preset always
 * resolves to exactly the same vertical as the landscape preset it pairs with,
 * and no signage preset falls through to the K12 default by accident.
 */
describe('portrait preset vertical parity', () => {
  const ids = new Set(SYSTEM_TEMPLATE_PRESETS.map((p: any) => p.id as string));
  const portraitIds = [...ids].filter((id) => id.endsWith('-portrait'));

  it('has portrait siblings to check (guard has teeth)', () => {
    expect(portraitIds.length).toBeGreaterThan(0);
  });

  it('every portrait sibling resolves to its landscape preset’s vertical', () => {
    const mismatched: string[] = [];
    for (const pid of portraitIds) {
      const landscapeId = pid.replace(/-portrait$/, '');
      if (!ids.has(landscapeId)) continue; // standalone portrait preset — nothing to pair
      const p = resolvePresetVerticalTag(pid);
      const l = resolvePresetVerticalTag(landscapeId);
      if (p !== l) mismatched.push(`${pid} -> ${p} but ${landscapeId} -> ${l}`);
    }
    expect(mismatched).toEqual([]);
  });

  it('no preset-sig-* board silently falls back to the K12 default', () => {
    // Signage boards are industry packs; none of them are K-12 content. A K12
    // tag here means the id didn't match the industry regex (the bug above).
    const leaked = [...ids]
      .filter((id) => id.startsWith('preset-sig-') && !id.startsWith('preset-sig-hs-'))
      .filter((id) => resolvePresetVerticalTag(id) === 'K12');
    expect(leaked).toEqual([]);
  });
});
