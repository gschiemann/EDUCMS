/**
 * designer-structures.ts — the layouts the AI Designer builds, per board purpose
 * (2026-09-22, AI Designer rework).
 *
 * Replaces the three "art directions" (full-bleed editorial / clean premium /
 * vibrant graphic) and the three "content emphases". Those varied MOOD, all
 * three asked for a medallion / sphere / translucent initial, and two of the
 * three told the model not to lead with the items — on a menu board. The three
 * candidates of a batch now differ in STRUCTURE, chosen for what the board is
 * for, and the structures describe what the approved boards actually do (the
 * Super Taco wall for menus and offers; the approved gym-welcome and
 * morning-news sets, pending a legibility pass, for the others).
 *
 * `id`s match `structure` on the compiled reference boards
 * (designer-exemplars.generated.ts), which is how a candidate is shown the
 * reference built the same way. Pure data + two tiny helpers.
 */

/** What a board is FOR. The Designer's structures and references are keyed on this. */
export type DesignerPurpose = 'menu' | 'offer' | 'event' | 'announcement' | 'welcome';
export const DESIGNER_PURPOSES: readonly DesignerPurpose[] = ['menu', 'offer', 'event', 'announcement', 'welcome'];

export interface DesignerStructure {
  /** Stable id — matches an exemplar's `structure` and the web's label key. */
  id: string;
  /** Short English label (audit rows, the API's `artDirection` field). */
  label: string;
  /** What to build, in one paragraph the model reads. */
  brief: string;
}

export const DESIGNER_STRUCTURES: Record<DesignerPurpose, readonly DesignerStructure[]> = {
  menu: [
    {
      id: 'rail-cards',
      label: 'Rail + cards',
      brief:
        'A dark or brand-colored rail down one side (about a quarter of the width; a band across the top in portrait) holding a kicker or section number, a huge section title, one supporting line and a framed photo slot. Beside it, a heading row and the items as a grid of cards: category kicker, a name that may run two lines, one description line, and the price large on a ruled footer. Choose the grid for the item count (2×3 for six, 3×4 for twelve, 4×5 beyond); past twelve items drop the card photo and the description line.',
    },
    {
      id: 'hero-cards',
      label: 'Hero + cards',
      brief:
        'A large framed hero panel (about 40% of the width; the top third in portrait) with a photo slot, a kicker, a two-line headline and one line of copy over a dark gradient foot. Beside or below it, a heading row and the items as two columns of cards: category kicker, name, one description line, price on a ruled footer. Past twelve items the hero shrinks to a band across the top and the cards take the full width.',
    },
    {
      id: 'leader-rows',
      label: 'Leader rows',
      brief:
        'A compact header band (logo, venue name, one kicker line) over the menu set as sections in columns: two or three columns in landscape, stacked blocks in portrait. Each section has a titled header with a rule; each row is the name (a short description under it when one was supplied), a dotted leader, and the price, all prices on one right edge in tabular numerals. The most scalable layout: it holds 30+ items at the size floor.',
    },
  ],
  offer: [
    {
      id: 'split-offer',
      label: 'Photo + offer',
      brief:
        'The canvas split into a full-height framed photo slot (about half; the top half in portrait) and a saturated brand panel: a kicker, an item number or offer label, the offer name huge, one line of detail, and the price or terms as the largest thing on the board on a ruled footer with a short note beside it.',
    },
    {
      id: 'headline-poster',
      label: 'Headline poster',
      brief:
        'The offer set as a giant two- to three-line headline across the full width, one supporting line, the price or terms in the accent at display size, and a solid footer band with the logo, the fine print and where to order.',
    },
    {
      id: 'offer-stack',
      label: 'Lead offer + more',
      brief:
        'The lead offer large across the top two-thirds (photo slot, name, price), and up to three supporting offers as cards in a row beneath. Only offers that were supplied; with nothing else supplied, the lead offer takes the whole canvas.',
    },
  ],
  event: [
    {
      id: 'date-block',
      label: 'Date block',
      brief:
        'A tall solid-color block holding the day, the date and the time stacked at display size, beside the event name set huge, one line of description, and a footer band with where and the call to action.',
    },
    {
      id: 'photo-band',
      label: 'Photo + info band',
      brief:
        'A framed photo slot across the top 55–60%, the event name set large on a solid label overlapping its bottom edge, and an info band below split into when · where · how (tickets, RSVP).',
    },
    {
      id: 'program',
      label: 'Program',
      brief:
        "A headline band and the event's program as rows (time · what · where) with the first or next item highlighted, when a schedule was supplied; without one, the event name and a large date panel share the canvas.",
    },
  ],
  announcement: [
    {
      id: 'headline-split',
      label: 'Headline + photo',
      brief:
        "A light story panel with an accent edge (kicker, a two- to three-line headline, a short summary, and a when / where pair on a hairline rule) beside a framed photo slot; an 'up next' strip along the bottom for supporting notices when there are any.",
    },
    {
      id: 'poster',
      label: 'Poster',
      brief:
        'One giant headline filling the width over a strong brand field, a supporting paragraph at body size, and a header band with the logo and the date.',
    },
    {
      id: 'bulletin',
      label: 'Bulletin',
      brief:
        'A header band, the main notice as the lead block (about 60% of the width), and a column of two to four supporting notices, each a titled row with a hairline rule. With a single notice, it takes the full width and the column carries when / where / who to ask.',
    },
    // INFORMATION BOARDS ARE ANNOUNCEMENT-FAMILY (2026-09-23). There is no
    // `information` purpose: a bell schedule and a wayfinder tell a passer-by
    // what is on and where to go, which is what an announcement is for. These
    // two are APPENDED, so designerStructuresFor('announcement', 3) — the three
    // layouts a batch builds — is unchanged; they name the approved schedule and
    // wayfinding reference boards' layouts (designer-exemplars.generated.ts).
    {
      id: 'schedule',
      label: 'Schedule',
      brief:
        "A header band (the venue, the day, the time now), a large now-panel (what is on now, where, until when, and a countdown to the next change), and the day's schedule as rows — time · what · where · now / next / later — with the current row highlighted and the next one called out; a footer band carries the day's notice.",
    },
    {
      id: 'directory',
      label: 'Directory',
      brief:
        "A header band (the venue, the time now) and the destinations as large rows or tiles — each a name, a direction arrow and a short where (room, wing, floor) — beside a simple you-are-here diagram; a footer band carries today's access notice.",
    },
  ],
  welcome: [
    {
      id: 'name-hero',
      label: 'Welcome hero',
      brief:
        'A huge two-line welcome (the greeting in the accent, the venue or guest name at display size), one line of copy, and a side column of two or three working cards (hours, today, where to go).',
    },
    {
      id: 'split-welcome',
      label: 'Split welcome',
      brief:
        "Two halves across a diagonal or straight seam: the welcome and a short checklist on one side, the key info (hours, contact, today's highlights) on the other, joined by one shared element over the seam.",
    },
    {
      id: 'scene',
      label: 'Scene',
      brief:
        'A photo slot or a drawn brand scene as the backdrop, the welcome typeset on a solid panel over it, and a footer band for hours, wifi or the call to action.',
    },
  ],
};

/** The first `count` structures for a purpose — each candidate gets a different one. */
export function designerStructuresFor(purpose: DesignerPurpose, count = 3): DesignerStructure[] {
  const all = DESIGNER_STRUCTURES[purpose] ?? DESIGNER_STRUCTURES.announcement;
  return all.slice(0, Math.max(1, Math.min(count, all.length)));
}

/** A structure by id, across every purpose. */
export function findDesignerStructure(id: string | null | undefined): DesignerStructure | null {
  if (!id) return null;
  for (const p of DESIGNER_PURPOSES) {
    const hit = DESIGNER_STRUCTURES[p].find((s) => s.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Map an incoming purpose (the Concierge intake's `purpose`, or a guided-form
 * value) onto a Designer purpose. Unknown → null, so the caller infers.
 */
export function normalizeDesignerPurpose(raw: unknown): DesignerPurpose | null {
  const v = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'menu') return 'menu';
  if (v === 'promo' || v === 'offer' || v === 'deal' || v === 'sale' || v === 'special') return 'offer';
  if (v === 'event' || v === 'countdown') return 'event';
  if (v === 'welcome' || v === 'greeting') return 'welcome';
  if (v === 'announcement' || v === 'feature' || v === 'photo-hero' || v === 'news' || v === 'notice') return 'announcement';
  return null;
}
