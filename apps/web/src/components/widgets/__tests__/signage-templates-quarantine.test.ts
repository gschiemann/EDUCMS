import { QUARANTINED_BOARD_URLS } from '@cms/api-types';
import { SIGNAGE_TEMPLATES, SELECTABLE_SIGNAGE_TEMPLATES } from '../signage-templates';

/**
 * S2 (audit W0-08) — the builder's "Industry Signage" picker must NEVER offer a
 * quarantined board. Before this fix the picker was populated straight from the
 * full static `SIGNAGE_TEMPLATES` catalog, so 20 of the 21 quarantined boards
 * were still selectable and could be published to a live screen. The quarantine
 * only touched the API's DB gallery query; the static frontend catalog bypassed
 * it entirely.
 *
 * The picker now reads `SELECTABLE_SIGNAGE_TEMPLATES`, filtered against the SAME
 * shared `@cms/api-types` denylist the API seeds ARCHIVED — one source of truth,
 * no drift.
 */
describe('S2 — signage picker excludes quarantined boards', () => {
  it('SELECTABLE_SIGNAGE_TEMPLATES contains NO quarantined URL', () => {
    const leaked = SELECTABLE_SIGNAGE_TEMPLATES.filter((t) => QUARANTINED_BOARD_URLS.has(t.url));
    expect(leaked).toEqual([]);
  });

  it('actually removed the quarantined boards that were in the catalog (20 of 21 appear here)', () => {
    // The Domino's board (21st) is not in the frontend catalog, so 20 of the 21
    // quarantined URLs are present in the FULL list and must all be filtered out.
    const inCatalog = SIGNAGE_TEMPLATES.filter((t) => QUARANTINED_BOARD_URLS.has(t.url));
    expect(inCatalog.length).toBe(20);
    expect(SELECTABLE_SIGNAGE_TEMPLATES.length).toBe(SIGNAGE_TEMPLATES.length - inCatalog.length);
  });

  it('keeps every NON-quarantined board offerable (nothing over-filtered)', () => {
    const expected = SIGNAGE_TEMPLATES.filter((t) => !QUARANTINED_BOARD_URLS.has(t.url));
    expect(SELECTABLE_SIGNAGE_TEMPLATES).toEqual(expected);
  });

  it('spot-check: the drive-thru flagship is filtered out but a real QSR board remains', () => {
    const urls = new Set(SELECTABLE_SIGNAGE_TEMPLATES.map((t) => t.url));
    expect(urls.has('/templates/signage/qsr/01-drive-thru-flagship.html')).toBe(false); // quarantined
    expect(urls.has('/templates/signage/qsr/03-order-ready.html')).toBe(true); // clean
  });
});
