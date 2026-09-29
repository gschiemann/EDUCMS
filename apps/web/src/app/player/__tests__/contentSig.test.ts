import { itemContentSigInput } from '../contentSig';

/**
 * F3 (docs/research/2026-09-29-video-loop/REPORT.md): a transition-only edit
 * must change the item's content signature, or the player discards the new
 * manifest as "the same playlist".
 */
describe('itemContentSigInput', () => {
  const base = { asset_hash: 'abc123', muted: true, transition_type: 'FADE' };

  it('changes when ONLY the transition changes', () => {
    expect(itemContentSigInput({ ...base, transition_type: 'SLIDE_LEFT' }, 'k')).not.toBe(itemContentSigInput(base, 'k'));
  });

  it('a transition set for the first time (none → FADE) also changes it', () => {
    expect(itemContentSigInput({ ...base, transition_type: null }, 'k')).not.toBe(itemContentSigInput(base, 'k'));
    expect(itemContentSigInput({ ...base, transition_type: undefined }, 'k'))
      .toBe(itemContentSigInput({ ...base, transition_type: null }, 'k')); // absent and null are the same "none"
  });

  it('still changes with the bytes (a replaced file) and with the mute flag', () => {
    expect(itemContentSigInput({ ...base, asset_hash: 'def456' }, 'k')).not.toBe(itemContentSigInput(base, 'k'));
    expect(itemContentSigInput({ ...base, muted: false }, 'k')).not.toBe(itemContentSigInput(base, 'k'));
  });

  it('is stable for an unchanged item, so a quiet poll never restarts the playlist', () => {
    expect(itemContentSigInput({ ...base }, 'k')).toBe(itemContentSigInput({ ...base }, 'k'));
  });

  it('falls back to the URL key only when the manifest has no hash', () => {
    expect(itemContentSigInput({ ...base, asset_hash: null }, 'url-key')).toContain('url-key');
    expect(itemContentSigInput(base, 'url-key')).not.toContain('url-key');
  });
});
