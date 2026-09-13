/**
 * No system preset may ship a FIXED countdown date (template-maker audit,
 * 2026-09-13).
 *
 * Four starter cards in the new-template wizard read "Field Trip in 0 DAYS" /
 * "Homecoming in 0 DAYS" / "Graduation in 0 DAYS": their seeded
 * `countdownDate` values (May–June 2026) had simply gone by. A literal date
 * in a preset is stale the day after it passes and the gallery is the first
 * thing an operator sees. Presets show a SAMPLE number instead (the widgets
 * fall back to `countdownNumber` / a built-in sample when no date is set);
 * the operator sets the real date in the editor.
 *
 * The boot-time defaultConfig sync in ensure-system-presets.ts pushes this
 * change to existing single-zone system rows, so prod previews heal on the
 * next deploy without a migration.
 */
import { ALL_PRESETS } from './ensure-system-presets';

describe('system presets carry no fixed countdown date', () => {
  it('every zone of every preset has an empty or absent countdownDate', () => {
    const offenders: string[] = [];
    for (const preset of ALL_PRESETS as Array<{ id: string; zones: Array<{ defaultConfig?: Record<string, unknown> }> }>) {
      for (const zone of preset.zones || []) {
        const d = zone.defaultConfig?.countdownDate;
        if (typeof d === 'string' && d.trim() !== '') offenders.push(`${preset.id} → ${d}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
