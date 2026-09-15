/**
 * The rule that keeps "what is behind this template" from being a question
 * two surfaces answer differently. See template-background.ts for why the
 * editor's white and the player's black are both correct, and why the row
 * therefore has to state its own answer.
 */
import {
  TEMPLATE_DEFAULT_BG,
  backgroundToPersist,
  statesNoBackground,
} from './template-background';

describe('statesNoBackground', () => {
  it('is true only when nothing on the row says what is behind the zones', () => {
    expect(statesNoBackground({})).toBe(true);
    expect(statesNoBackground({ bgColor: null, bgImage: null, bgGradient: null })).toBe(true);
    // Empty strings are how the builder spells "cleared", and they draw
    // nothing — so they are silence too, not an answer.
    expect(statesNoBackground({ bgColor: '', bgImage: '', bgGradient: '' })).toBe(true);
  });

  it('is false when ANY of the three is set', () => {
    expect(statesNoBackground({ bgColor: '#111827' })).toBe(false);
    expect(statesNoBackground({ bgImage: 'https://cdn.example/x.jpg' })).toBe(false);
    expect(statesNoBackground({ bgGradient: 'linear-gradient(#000,#fff)' })).toBe(false);
  });
});

describe('backgroundToPersist', () => {
  it('fills in paper white when the row says nothing', () => {
    expect(TEMPLATE_DEFAULT_BG).toBe('#ffffff');
    expect(backgroundToPersist({})).toBe('#ffffff');
  });

  it('prefers the tenant brand surface when there is one', () => {
    expect(backgroundToPersist({}, '#0b2545')).toBe('#0b2545');
    // …and ignores a blank one rather than writing empty.
    expect(backgroundToPersist({}, '')).toBe('#ffffff');
    expect(backgroundToPersist({}, null)).toBe('#ffffff');
  });

  // ── The controls: it must never overwrite an answer the row already has ──
  it('returns undefined for a row that already states a background', () => {
    expect(backgroundToPersist({ bgColor: '#111827' })).toBeUndefined();
    expect(backgroundToPersist({ bgColor: '#111827' }, '#0b2545')).toBeUndefined();
  });

  it('leaves a gradient or image alone — those are backgrounds too', () => {
    // A photo board deliberately has no bgColor. Writing white under it
    // would be harmless where the image covers, and wrong everywhere it
    // does not — a letterboxed portrait on a landscape wall.
    expect(backgroundToPersist({ bgGradient: 'linear-gradient(#000,#fff)' })).toBeUndefined();
    expect(backgroundToPersist({ bgImage: 'https://cdn.example/x.jpg' }, '#0b2545')).toBeUndefined();
  });
});
