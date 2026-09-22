/**
 * A ConciergeReference for a restaurant site whose menu we could read.
 *
 * FIXTURE PROVENANCE — this is not hand-written. It is the VERBATIM JSON
 * returned by the real producer, `POST /templates/concierge/reference/url`
 * (`TemplatesController.conciergeReferenceUrl`), driven end-to-end on the API
 * side over a schema.org-shaped JSON-LD menu page: the branding scrape produced
 * the summary/palette/logo/hero, and `extractMenuFromSite` produced `menu`,
 * including its own normalisations — note `"$3"`, not `"$3.00"`, for the two
 * drinks priced `3.00` in the source document, and the two items that carry no
 * `description` at all. Writing those by hand is exactly how a fixture ends up
 * agreeing with the code instead of with reality.
 *
 * To regenerate: stand a `TemplatesController` up with a BrandingPreview double
 * and `ai.extractSiteMenu` wired to a real `extractMenuFromSite` run (see
 * `apps/api/src/templates/concierge-reference-menu.spec.ts`, which builds its
 * fixture the same way) and print the returned object.
 */
import type { ConciergeReference } from '@cms/api-types';

export const MENU_REFERENCE = {
  kind: 'url',
  label: 'supertaco.example',
  summary:
    'Menu found on /menu: 9 items in 3 sections (Tacos, Burritos, Drinks). USE THESE EXACT items and prices. Brand: Super Taco. What they are / sell (use this to pick the RIGHT content — never invent a different cuisine/industry): "Street tacos and aguas frescas in the Mission". The brand\'s REAL on-site messaging — ECHO this actual voice + the services/industries it names; do NOT invent generic copy: "Handmade tortillas, every morning". Brand palette: #e2452a, #f4c430. Fonts: Anton / Inter. Has a LOGO image — place the real logo on the board (top-left or in the header), do not just typeset the name. Has a real hero/work PHOTO from the site — use it as the hero background (with a brand scrim so text stays legible), not a flat gradient.',
  palette: ['#e2452a', '#f4c430'],
  imageUrl: 'https://supertaco.example/hero.jpg',
  logoUrl: 'https://supertaco.example/logo.svg',
  menu: {
    sections: [
      {
        name: 'Tacos',
        items: [
          { name: 'Al Pastor', price: '$4.25', description: 'marinated pork, pineapple, cilantro' },
          { name: 'Carnitas', price: '$4.25', description: 'slow-braised pork' },
          { name: 'Pescado', price: '$5.50', description: 'beer-battered cod, slaw' },
          { name: 'Carne Asada', price: '$4.75' },
          { name: 'Veggie', price: '$3.95', description: 'grilled nopales, queso fresco' },
        ],
      },
      {
        name: 'Burritos',
        items: [
          { name: 'California', price: '$11.50' },
          { name: 'Super Carnitas', price: '$12.75' },
        ],
      },
      {
        name: 'Drinks',
        items: [
          { name: 'Horchata', price: '$3' },
          { name: 'Jamaica', price: '$3' },
        ],
      },
    ],
    itemCount: 9,
    source: { url: 'https://supertaco.example/menu', method: 'jsonld' },
  },
} as unknown as ConciergeReference;

/** Every (name, price) pair the reference carries — what a board must show. */
export const MENU_ROWS: Array<[string, string]> = [
  ['Al Pastor', '$4.25'],
  ['Carnitas', '$4.25'],
  ['Pescado', '$5.50'],
  ['Carne Asada', '$4.75'],
  ['Veggie', '$3.95'],
  ['California', '$11.50'],
  ['Super Carnitas', '$12.75'],
  ['Horchata', '$3'],
  ['Jamaica', '$3'],
];
