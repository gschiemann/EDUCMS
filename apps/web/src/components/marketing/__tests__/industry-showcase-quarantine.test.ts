import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUARANTINED_BOARD_URLS } from '@cms/api-types';

/**
 * S3 (audit W0-08) — the PUBLIC marketing homepage (IndustryShowcase, mounted
 * on app/page.tsx) must not render a quarantined board. TemplateEmbed loads the
 * LIVE iframe on desktop, so a quarantined placeholder board (e.g. the QSR
 * drive-thru "2150×1000" box or the Fashion "Drop look photo" lookbook) showed
 * a broken-looking gray placeholder right on the primary funnel.
 *
 * This scans the component source for any quarantined board URL so a future
 * edit can't silently reintroduce one on the homepage.
 */
describe('S3 — homepage renders no quarantined board', () => {
  const source = readFileSync(join(__dirname, '..', 'IndustryShowcase.tsx'), 'utf8');

  it('no quarantined board URL appears as an iframe src in IndustryShowcase.tsx', () => {
    // Only count a URL as a real reference if it's used as a src value (inside
    // quotes) — not merely mentioned in an explanatory code comment.
    const referenced = [...QUARANTINED_BOARD_URLS].filter(
      (url) => source.includes(`'${url}'`) || source.includes(`"${url}"`),
    );
    expect(referenced).toEqual([]);
  });
});
