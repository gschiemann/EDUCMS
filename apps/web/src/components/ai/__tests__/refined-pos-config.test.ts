/**
 * "Edit with words" on a POS-bound AI board (2026-09-22): refine-designer
 * re-derives the board's bindings and returns them as `pos`; the builder merges
 * them into the zone config with the new html (ChatToEditBox → onApply merges
 * defaultConfig shallowly, so undefined keys CLEAR the old values).
 */
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'platform' }));
import { refinedPosConfig } from '../ChatToEditBox';

describe('refinedPosConfig', () => {
  it('a board that is still bound carries its re-derived config (Codex\'s slot map)', () => {
    const pos = { posSync: true, dataSource: 'POS', posProvider: 'toast', posConnectionId: 'c1', posItemBindings: { 'item.0': 'guid-a' } };
    expect(refinedPosConfig({ pos })).toEqual(pos);
  });
  it('a board with nothing left bound stops asking for the live menu', () => {
    const patch = refinedPosConfig({ pos: null });
    const merged = { ...{ html: 'old', posSync: true, dataSource: 'POS', posItemBindings: { 'item.0': 'g' } }, ...patch };
    expect(merged.posSync).toBe(false);
    expect(merged.dataSource).toBeUndefined();
    expect(JSON.parse(JSON.stringify(merged))).toEqual({ html: 'old', posSync: false });
  });
  it('a board that was never bound: nothing changes', () => {
    expect(refinedPosConfig({})).toEqual({});
    expect(refinedPosConfig(null)).toEqual({});
  });
});
