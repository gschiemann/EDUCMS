/**
 * Double-sided displays, operator side — folding Screen rows back into
 * DISPLAYS (2026-09-16).
 *
 * The server models one face as one `Screen` row, which is right for
 * schedules, emergency delivery and fleet health — and wrong for the
 * operator, who installed ONE display. This module is the translation, and
 * these are the rules every publish surface depends on.
 */

import {
  displayedSideIds,
  groupScreensIntoUnits,
  publishTargetsForSides,
  sideLabel,
  unitForScreenId,
  unitSelection,
} from '../screen-faces';

const FRONT = { id: 'd1', name: 'Entrance Display' };
const BACK_MIRROR = {
  id: 'd1b',
  name: 'Entrance Display — Back',
  faceOfScreenId: 'd1',
  faceIndex: 1,
  faceContentMode: 'MIRROR',
};
const BACK_OWN = { ...BACK_MIRROR, faceContentMode: 'OWN' };
const PLAIN = { id: 's9', name: 'Gym Ribbon' };

describe('groupScreensIntoUnits', () => {
  it('folds a front and its back into ONE display', () => {
    const units = groupScreensIntoUnits([FRONT, BACK_MIRROR, PLAIN]);
    expect(units).toHaveLength(2);

    const display = units.find((u) => u.primary.id === 'd1')!;
    expect(display.isMultiSided).toBe(true);
    expect(display.sides.map((s) => s.label)).toEqual(['Front', 'Back']);
    expect(display.sidesAreCombined).toBe(true);
  });

  it('keeps ordinary screens as one-sided units — no separate code path', () => {
    // This is what makes the feature invisible on a fleet that has none.
    const units = groupScreensIntoUnits([PLAIN]);
    expect(units).toHaveLength(1);
    expect(units[0].isMultiSided).toBe(false);
    expect(units[0].sidesAreCombined).toBe(false);
    expect(units[0].sides).toHaveLength(1);
  });

  it('reads a display as NOT combined once a side has its own content', () => {
    const units = groupScreensIntoUnits([FRONT, BACK_OWN]);
    expect(units[0].sidesAreCombined).toBe(false);
    expect(units[0].sides[1].mirrors).toBe(false);
  });

  it('treats a missing faceContentMode as MIRROR — the safe default', () => {
    const units = groupScreensIntoUnits([FRONT, { id: 'd1b', name: 'Back', faceOfScreenId: 'd1' }]);
    expect(units[0].sidesAreCombined).toBe(true);
  });

  it('orders sides by face index, not by list order', () => {
    const third = { id: 'd1c', name: 'Third', faceOfScreenId: 'd1', faceIndex: 2 };
    const units = groupScreensIntoUnits([third, FRONT, BACK_MIRROR]);
    const display = units.find((u) => u.primary.id === 'd1')!;
    expect(display.sides.map((s) => s.screen.id)).toEqual(['d1', 'd1b', 'd1c']);
  });

  it('returns an ORPHAN face as its own unit rather than hiding it', () => {
    // A face whose front was filtered out by a search must still be
    // selectable. Silently hiding a screen is how a publish quietly reaches
    // fewer screens than the operator believes.
    const units = groupScreensIntoUnits([BACK_MIRROR]);
    expect(units).toHaveLength(1);
    expect(units[0].primary.id).toBe('d1b');
    expect(units[0].isMultiSided).toBe(false);
  });

  it('survives an empty or absent list', () => {
    expect(groupScreensIntoUnits([])).toEqual([]);
    expect(groupScreensIntoUnits(null)).toEqual([]);
    expect(groupScreensIntoUnits([null, undefined])).toEqual([]);
  });
});

describe('unitSelection — what the operator has actually picked', () => {
  const combined = groupScreensIntoUnits([FRONT, BACK_MIRROR])[0];
  const split = groupScreensIntoUnits([FRONT, BACK_OWN])[0];

  it('a COMBINED display is fully reached by its front alone', () => {
    // The mirroring side has no schedules of its own, so requiring it to be
    // ticked would misrepresent what publishing does.
    expect(unitSelection(combined, new Set(['d1']))).toBe('all');
    expect(unitSelection(combined, new Set())).toBe('none');
    expect(unitSelection(combined, new Set(['d1b']))).toBe('none');
  });

  it('a SPLIT display reports partial selection honestly', () => {
    expect(unitSelection(split, new Set())).toBe('none');
    expect(unitSelection(split, new Set(['d1']))).toBe('partial');
    expect(unitSelection(split, new Set(['d1', 'd1b']))).toBe('all');
  });
});

describe('publishTargetsForSides — never schedule onto a mirror', () => {
  it('excludes a mirroring side', () => {
    // A row pointed at a mirroring side would be written, stored and ignored
    // forever. Excluding it is the difference between a real target and a
    // dead field.
    const combined = groupScreensIntoUnits([FRONT, BACK_MIRROR])[0];
    expect(publishTargetsForSides(combined.sides)).toEqual(['d1']);
  });

  it('includes a side that has its own content', () => {
    const split = groupScreensIntoUnits([FRONT, BACK_OWN])[0];
    expect(publishTargetsForSides(split.sides)).toEqual(['d1', 'd1b']);
  });
});

describe('displayedSideIds — what will actually be on glass', () => {
  it('a mirroring side lights up when its front does', () => {
    const combined = groupScreensIntoUnits([FRONT, BACK_MIRROR])[0];
    expect(displayedSideIds(combined, new Set(['d1']))).toEqual(['d1', 'd1b']);
  });

  it('a side with its own content does NOT follow the front', () => {
    const split = groupScreensIntoUnits([FRONT, BACK_OWN])[0];
    expect(displayedSideIds(split, new Set(['d1']))).toEqual(['d1']);
  });
});

describe('labels and lookup', () => {
  it('names sides the way an operator standing at the display would', () => {
    expect(sideLabel(0)).toBe('Front');
    expect(sideLabel(null)).toBe('Front');
    expect(sideLabel(1)).toBe('Back');
    expect(sideLabel(2)).toBe('Side 3');
  });

  it('finds a display from either of its sides', () => {
    const units = groupScreensIntoUnits([FRONT, BACK_MIRROR, PLAIN]);
    expect(unitForScreenId(units, 'd1')?.primary.id).toBe('d1');
    expect(unitForScreenId(units, 'd1b')?.primary.id).toBe('d1');
    expect(unitForScreenId(units, 'nope')).toBeNull();
  });
});
