/**
 * conciergeVenueName — the business a Concierge board is FOR (2026-09-22).
 *
 * FIXTURE PROVENANCE: MENU_REFERENCE is the verbatim JSON the real
 * `POST /templates/concierge/reference/url` returned (see its own header), so
 * the "Brand: <name>." sentence here is the one `summarizeUrlReference` writes.
 */
import type { ConciergeReference } from '@cms/api-types';
import { conciergeVenueName } from '../conciergeVenue';
import { MENU_REFERENCE } from './concierge-menu-reference.fixture';

const url = (summary: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'url', label: 'example.com', summary, ...extra }) as unknown as ConciergeReference;

describe('conciergeVenueName', () => {
  it('reads the brand out of the real reference summary (after the menu note)', () => {
    expect(conciergeVenueName([MENU_REFERENCE])).toBe('Super Taco');
  });

  it('keeps a name that itself contains periods', () => {
    expect(conciergeVenueName([url('Brand: St. Louis Bread Co. What they are / sell: "bakery".')])).toBe('St. Louis Bread Co');
    expect(conciergeVenueName([url('Brand: Joe\'s Diner.')])).toBe("Joe's Diner");
  });

  it('prefers a structured name when the reference carries one', () => {
    expect(conciergeVenueName([url('Brand: Old Name. Tagline: "x".', { venueName: 'New Name' })])).toBe('New Name');
  });

  it('ignores image references and summaries without a brand sentence', () => {
    expect(conciergeVenueName([{ kind: 'image', summary: 'Brand: Photo Guess. A warm cafe look.' } as unknown as ConciergeReference])).toBeUndefined();
    expect(conciergeVenueName([url('Website https://x.example (limited brand info could be read).')])).toBeUndefined();
    expect(conciergeVenueName([])).toBeUndefined();
    expect(conciergeVenueName(undefined)).toBeUndefined();
  });
});
