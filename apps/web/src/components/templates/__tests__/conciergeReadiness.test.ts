import {
  conciergeGuidance,
  detectTouchIntent,
  humanizeMissing,
  MAX_MISSING_SHOWN,
} from '../conciergeReadiness';

/**
 * The operator's 2026-08-25 session, in tests.
 *
 *   "the flow was off, i didnt know when to stop chatting and actually generate
 *    the images...it should lead you to clicking that button"
 *
 * …and the same brief asked for "a touch-friendly menu with our services tied to
 * links with URLs" and came back a passive poster, silently.
 */

describe('humanizeMissing', () => {
  it('turns schema words into operator language', () => {
    expect(humanizeMissing(['palette'])).toEqual(['your colors (or paste your website)']);
    expect(humanizeMissing(['widgets'])).toEqual(['which elements to show']);
    expect(humanizeMissing(['CTA'])).toEqual(['what you want people to do']);
    expect(humanizeMissing(['purpose'])).toEqual(['what the screen is for']);
    expect(humanizeMissing(['the actual menu items and prices'])).toEqual(['your items and prices']);
    expect(humanizeMissing(['event date'])).toEqual(['the date and time']);
  });

  it('passes a genuinely plain label through, lightly cleaned', () => {
    expect(humanizeMissing(['How many people it seats.'])).toEqual(['how many people it seats']);
  });

  it('dedupes after mapping (two schema words, one operator concern)', () => {
    expect(humanizeMissing(['palette', 'brand colors'])).toEqual(['your colors (or paste your website)']);
  });

  it('caps the checklist so it stays scannable', () => {
    const many = ['purpose', 'palette', 'widgets', 'cta', 'headline', 'photo', 'logo'];
    expect(humanizeMissing(many)).toHaveLength(MAX_MISSING_SHOWN);
  });

  it('is safe on junk input', () => {
    expect(humanizeMissing(null)).toEqual([]);
    expect(humanizeMissing(undefined)).toEqual([]);
    expect(humanizeMissing('nope' as unknown)).toEqual([]);
    expect(humanizeMissing([null, '', '   ', 42])).toEqual(['42']);
  });
});

describe('detectTouchIntent', () => {
  it('catches the operator’s actual request', () => {
    const out = detectTouchIntent('a touch-friendly menu with our services tied to links with URLs');
    expect(out.wants).toBe(true);
    expect(out.matched).toContain('touch');
  });

  it.each([
    'make it interactive',
    'people should be able to tap each service',
    'add buttons for each department',
    'a kiosk for the lobby',
    'each one linked to its page',
    'put a QR code on it',
    'visitors can browse our services',
  ])('detects: %s', (text) => {
    expect(detectTouchIntent(text).wants).toBe(true);
  });

  it.each([
    'a lunch menu board for the counter',
    'welcome board for our clinic lobby',
    'happy hour specials, bright and loud',
    'our hours and address, nothing fancy',
  ])('does NOT fire on a passive brief: %s', (text) => {
    expect(detectTouchIntent(text).wants).toBe(false);
  });

  it('is empty on empty input', () => {
    expect(detectTouchIntent('')).toEqual({ wants: false, matched: [] });
  });
});

describe('conciergeGuidance', () => {
  const base = { hasUserTurn: true, ready: false, missing: [], operatorText: 'a welcome board' };

  it('before the first turn, points at the composer instead of the button', () => {
    const g = conciergeGuidance({ ...base, hasUserTurn: false });
    expect(g.stage).toBe('start');
    expect(g.checklist).toEqual([]);
  });

  it('while gathering, shows WHAT IS MISSING in plain words', () => {
    const g = conciergeGuidance({ ...base, missing: ['palette', 'the actual menu items'] });
    expect(g.stage).toBe('gathering');
    expect(g.title).toBe('Still to nail down');
    expect(g.checklist).toEqual(['your colors (or paste your website)', 'your items and prices']);
    // Generating early stays explicitly allowed — this is guidance, not a gate.
    expect(g.hint).toMatch(/generate now/i);
  });

  it('when ready, says so unmistakably and points at Generate', () => {
    const g = conciergeGuidance({ ...base, ready: true, missing: ['palette'] });
    expect(g.stage).toBe('ready');
    expect(g.title).toBe('I’ve got what I need');
    expect(g.checklist).toEqual([]); // nothing left to nag about
    expect(g.hint).toMatch(/Generate/);
  });

  it('surfaces the tap request — what we WILL do and what they must still do', () => {
    const g = conciergeGuidance({
      ...base,
      operatorText: 'a touch-friendly menu with our services tied to links with URLs',
    });
    expect(g.touchNotice).not.toBeNull();
    expect(g.touchNotice!.title).toMatch(/tappable/i);
    // The half that stops the NEXT silent failure: a hot zone with no
    // destination does nothing, so the operator has to be told to wire them.
    expect(g.touchNotice!.body).toMatch(/won’t guess where they go/);
    expect(g.touchNotice!.body).toMatch(/pick its link/);
  });

  it('says nothing about taps when the operator never asked', () => {
    expect(conciergeGuidance(base).touchNotice).toBeNull();
  });
});
