import {
  QUARANTINED_BOARD_URLS,
  QUARANTINED_PRESET_IDS,
  QUARANTINED_URLS_WITHOUT_PRESET,
} from './ensure-system-presets';

/**
 * Interim template quarantine (audit W0-08).
 *
 * The 2026-07-12 audit named a set of EXTERNAL_HTML boards as launch-blockers
 * (dimension-placeholder content, clipping, or the Domino's demo-only brand
 * pack). They are seeded/kept ARCHIVED so they never reach a customer gallery.
 *
 * These asserts keep the denylist honest:
 *  - every denylisted URL resolves to a real preset (a typo would otherwise
 *    silently quarantine nothing),
 *  - the count matches the audit list,
 *  - the licensing-risk Domino's board is included.
 */
describe('template quarantine denylist (W0-08)', () => {
  it('every quarantined URL resolves to a real preset (no typos / stale paths)', () => {
    expect(QUARANTINED_URLS_WITHOUT_PRESET).toEqual([]);
  });

  it('resolves the full audit list to preset ids', () => {
    // 21 boards: 17 dimension-placeholder + 3 clipping + 1 Domino's brand risk.
    expect(QUARANTINED_BOARD_URLS.size).toBe(21);
    expect(QUARANTINED_PRESET_IDS.size).toBe(21);
  });

  it('quarantines the Domino’s demo-only brand board (licensing risk)', () => {
    expect(QUARANTINED_BOARD_URLS.has('/templates/signage/qsr/11-dominos-pizza-board.html')).toBe(
      true,
    );
  });

  it('quarantines the confirmed clipping boards', () => {
    for (const url of [
      '/templates/signage/qsr/02-counter-menu.html',
      '/templates/signage/qsr/04-lto-promo.html',
      '/templates/signage/hospitality/05-dining-tonight.html',
    ]) {
      expect(QUARANTINED_BOARD_URLS.has(url)).toBe(true);
    }
  });
});
