/**
 * create-template-flow — the rules, as pure predicates.
 *
 * These are the FLOOR, not the ceiling: a green predicate test says
 * nothing about whether the component is wired to it (this repo has a
 * scar — `AddSidebar` carried six green tests for a rail that had been
 * un-mounted for 3.5 months). The wiring is proven separately, by
 * mounting the real page in
 * `app/[schoolId]/templates/__tests__/create-flow-wiring.test.tsx`.
 */

import {
  DEFAULT_CANVAS,
  canvasLabel,
  matchesOrientation,
  needsResize,
  orientationOfSize,
  presetOrientation,
  selectCreatePresets,
  type PresetLike,
} from '../create-template-flow';

function p(over: Partial<PresetLike> & { id: string }): PresetLike & { isSystem: boolean } {
  return {
    name: over.id,
    category: 'LOBBY',
    isSystem: true,
    screenWidth: 1920,
    screenHeight: 1080,
    ...over,
  } as PresetLike & { isSystem: boolean };
}

describe('shape is the one question', () => {
  it('reads the canvas, not the orientation column', () => {
    // A row whose text column disagrees with its own pixels: the pixels
    // are what renders on the wall.
    expect(presetOrientation({ id: 'x', name: 'x', screenWidth: 1080, screenHeight: 1920, orientation: 'LANDSCAPE' }))
      .toBe('PORTRAIT');
  });

  it('falls back to the orientation column only when there are no dimensions', () => {
    expect(presetOrientation({ id: 'x', name: 'x', screenWidth: 0, screenHeight: 0, orientation: 'PORTRAIT' })).toBe('PORTRAIT');
    expect(presetOrientation({ id: 'x', name: 'x', screenWidth: 0, screenHeight: 0 })).toBe('LANDSCAPE');
  });

  it('treats a square canvas as neither — it qualifies for both galleries', () => {
    const square = p({ id: 'sq', screenWidth: 1080, screenHeight: 1080 });
    expect(matchesOrientation(square, 'LANDSCAPE')).toBe(true);
    expect(matchesOrientation(square, 'PORTRAIT')).toBe(true);
  });

  it('defaults the canvas from the shape, matching the previous create default', () => {
    expect(DEFAULT_CANVAS.LANDSCAPE).toEqual({ w: 3840, h: 2160 });
    expect(DEFAULT_CANVAS.PORTRAIT).toEqual({ w: 2160, h: 3840 });
    expect(orientationOfSize(3840, 2160)).toBe('LANDSCAPE');
    expect(orientationOfSize(2160, 3840)).toBe('PORTRAIT');
    // An LED banner is extreme, but it is still landscape.
    expect(orientationOfSize(2500, 500)).toBe('LANDSCAPE');
    // An LED poster chain is portrait, and the gallery must treat it so.
    expect(orientationOfSize(320, 1080)).toBe('PORTRAIT');
  });
});

describe('selectCreatePresets — what the operator lands on', () => {
  const catalogue = [
    p({ id: 'land-a', name: 'Lobby Welcome', category: 'LOBBY' }),
    p({ id: 'land-b', name: 'Cafeteria Menu', category: 'CAFETERIA' }),
    p({ id: 'port-a', name: 'Hallway Totem', category: 'HALLWAY', screenWidth: 1080, screenHeight: 1920 }),
    p({ id: 'mine', name: 'My Board', isSystem: false }),
  ];

  it('only offers system presets — never the operator\'s own templates', () => {
    const out = selectCreatePresets({ templates: catalogue, orientation: 'LANDSCAPE', verticalKnown: true });
    expect(out.map((t) => t.id)).not.toContain('mine');
  });

  it('filters to the shape that was chosen', () => {
    expect(selectCreatePresets({ templates: catalogue, orientation: 'LANDSCAPE', verticalKnown: true }).map((t) => t.id))
      .toEqual(expect.arrayContaining(['land-a', 'land-b']));
    expect(selectCreatePresets({ templates: catalogue, orientation: 'LANDSCAPE', verticalKnown: true }).map((t) => t.id))
      .not.toContain('port-a');
    expect(selectCreatePresets({ templates: catalogue, orientation: 'PORTRAIT', verticalKnown: true }).map((t) => t.id))
      .toEqual(['port-a']);
  });

  it('searches name, description and category', () => {
    const out = selectCreatePresets({
      templates: [...catalogue, p({ id: 'desc', name: 'Zed', description: 'happy hour promo' })],
      orientation: 'LANDSCAPE',
      verticalKnown: true,
      query: 'happy hour',
    });
    expect(out.map((t) => t.id)).toEqual(['desc']);
  });

  it('orders by the tenant\'s own category order when the vertical is KNOWN', () => {
    const out = selectCreatePresets({
      templates: catalogue,
      orientation: 'LANDSCAPE',
      verticalKnown: true,
      categoryOrder: ['CAFETERIA', 'LOBBY'],
    });
    expect(out.map((t) => t.id)).toEqual(['land-b', 'land-a']);
  });

  it('IGNORES the category order when the vertical is only INFERRED', () => {
    // The bug this guards: normalizeVertical() answers K12 for a MISSING
    // value, so an unknown tenant would otherwise be handed a school
    // catalogue's ordering as if it had been chosen for them.
    const out = selectCreatePresets({
      templates: catalogue,
      orientation: 'LANDSCAPE',
      verticalKnown: false,
      categoryOrder: ['CAFETERIA', 'LOBBY'],
    });
    expect(out.map((t) => t.id)).toEqual(['land-a', 'land-b']);
  });

  it('spreads across categories when the vertical is unknown, instead of front-loading one', () => {
    const many = [
      p({ id: 'a1', category: 'CAFETERIA' }),
      p({ id: 'a2', category: 'CAFETERIA' }),
      p({ id: 'a3', category: 'CAFETERIA' }),
      p({ id: 'b1', category: 'LOBBY' }),
      p({ id: 'c1', category: 'ATHLETICS' }),
    ];
    const out = selectCreatePresets({ templates: many, orientation: 'LANDSCAPE', verticalKnown: false });
    // First screenful spans three categories rather than three cafeteria boards.
    expect(out.slice(0, 3).map((t) => t.id)).toEqual(['a1', 'b1', 'c1']);
    expect(out).toHaveLength(5);
  });

  it('returns an empty list rather than inventing a match', () => {
    expect(selectCreatePresets({ templates: [], orientation: 'PORTRAIT', verticalKnown: true })).toEqual([]);
  });
});

describe('canvas carry-over', () => {
  it('only resizes when the chosen canvas actually differs', () => {
    const preset = p({ id: 'x', screenWidth: 3840, screenHeight: 2160 });
    expect(needsResize(preset, { width: 3840, height: 2160 })).toBe(false);
    expect(needsResize(preset, { width: 1920, height: 1080 })).toBe(true);
  });

  it('labels a canvas one way everywhere', () => {
    expect(canvasLabel(3840, 2160)).toBe('3840 × 2160');
  });
});
