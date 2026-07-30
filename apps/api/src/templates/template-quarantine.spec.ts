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
    // 16 boards: 12 dimension-placeholder + 3 clipping + 1 Domino's brand risk.
    // (Was 21; all 4 redesigned fashion boards — 01, 02, 04, 05 — were
    // un-quarantined 2026-07-23 after the redesign cleared the W0-08 trigger:
    // 02/05 verified per-board, 01/04 fixed by baking in stock photos.
    // 2026-07-30: hospitality/01 un-quarantined after the Greg-authorized
    // "Golden Hour" redesign — photos baked, key-gate 40→73/0 removed,
    // 0 errors chromium+webkit both orientations. See quarantine.ts.)
    expect(QUARANTINED_BOARD_URLS.size).toBe(16);
    expect(QUARANTINED_PRESET_IDS.size).toBe(16);
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
