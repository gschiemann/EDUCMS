/**
 * Review must not invent overlaps across scenes, and must still diagnose
 * locked zones (Codex T02, 2026-09-13). Mutation checks: evaluate all zones in
 * one group → test 1 fails; restore `if (z.locked) continue` → test 3 fails.
 */
import { computeSuggestions } from '../suggestions';
import type { Zone } from '../types';

const text = (id: string, over: Partial<Zone> = {}): Zone => ({ id, name: id, widgetType: 'TEXT', x: 10, y: 10, width: 30, height: 20, zIndex: 1, sortOrder: 0, defaultConfig: {}, ...over } as Zone);
const run = (zones: Zone[]) => computeSuggestions({ zones, screenWidth: 1920, screenHeight: 1080, isTouchEnabled: false });
const overlaps = (zones: Zone[]) => run(zones).filter((s) => s.id.startsWith('overlap:'));

describe('overlapping text is evaluated per scene', () => {
  it('the same rect in two DIFFERENT scenes is not an overlap', () => {
    expect(overlaps([text('a', { sceneId: 's1' }), text('b', { sceneId: 's2' })])).toHaveLength(0);
  });
  it('the same rect in the SAME scene is', () => {
    expect(overlaps([text('a', { sceneId: 's1' }), text('b', { sceneId: 's1' })])).toHaveLength(1);
  });
  it('a shared zone is checked against every scene, and shared-vs-shared is reported once', () => {
    const zones = [text('shared1'), text('shared2'), text('s1', { sceneId: 's1', x: 90 }), text('s2', { sceneId: 's2', x: 90 }), text('s3', { sceneId: 's3' })];
    const ids = overlaps(zones).map((s) => s.id);
    expect(ids.filter((i) => i === 'overlap:shared1~shared2')).toHaveLength(1);
    expect(ids).toContain('overlap:s3~shared1');
  });
  it('a board without scenes is one group', () => {
    expect(overlaps([text('a'), text('b')])).toHaveLength(1);
  });
});

describe('locked zones', () => {
  it('a locked off-screen zone is still reported — without a one-tap fix, with the reason', () => {
    const out = run([text('off', { x: 95, width: 30, locked: true } as Partial<Zone>)]);
    const hit = out.find((s) => s.zoneId === 'off');
    expect(hit).toBeDefined();
    expect(hit!.fix).toBeUndefined();
    expect(hit!.detail).toMatch(/locked/i);
  });
  it('the same zone unlocked carries the fix', () => {
    const out = run([text('off', { x: 95, width: 30 })]);
    expect(out.find((s) => s.zoneId === 'off')!.fix).toBeDefined();
  });
});
