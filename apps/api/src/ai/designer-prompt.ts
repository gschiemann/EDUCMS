/**
 * designer-prompt.ts — the AI Designer's instructions (rewritten 2026-09-22).
 *
 * GPT-6 Sol made the Super Taco menu wall Greg praised when Codex drove it, and
 * sparse, price-less posters when THIS file drove it. The model was not the
 * problem (docs/research/2026-09-22-ai-designer-rework/01-*.md): the old prompt
 * was ~50k characters with seven competing "#1" priorities, a one-filled-box
 * rule that banned the header band / rail / card grid a menu board is made of,
 * "4-8 items MAX", leader rows as the only row shape, a mood map and CSS
 * snippets pushing medallions and spheres, and ONE 1080p cafe poster as the
 * only example.
 *
 * The rewrite: SHOW, then say little.
 *   - The user message opens with approved reference boards
 *     (designer-exemplars.ts — compiled from our own production boards).
 *   - The system prompt is the contract: output, facts, layout, type, color,
 *     editability, LED-safe CSS — in about 2k tokens.
 *   - Each candidate builds a different per-PURPOSE structure
 *     (designer-structures.ts), not a different mood.
 *
 * Pure functions only (prompt builders + HTML sanitizer + Taurus audit), so
 * every prompt here unit-tests offline, with no provider and no Nest container.
 */
import {
  designerStructuresFor,
  normalizeDesignerPurpose,
  type DesignerPurpose,
  type DesignerStructure,
} from './designer-structures';
import { formatExemplarsForPrompt, type DesignerExemplar } from './designer-exemplars';
import { documentIncompleteness, DesignerHtmlIncompleteError } from './designer-document-completeness';

export type { DesignerPurpose, DesignerStructure };
export { designerStructuresFor, normalizeDesignerPurpose };

/**
 * Font families the web renderer actually loads (SIGNAGE_FONTS_HREF in
 * WidgetRenderer.tsx). The AI MUST pick display+body ONLY from this list — a
 * family the renderer doesn't load silently falls back to system-ui (the exact
 * "looks unstyled" failure). Kept in sync with that href.
 */
export const DESIGNER_FONTS = [
  'Inter', 'Oswald', 'Poppins', 'Montserrat', 'Cormorant Garamond', 'Barlow',
  'Playfair Display', 'Sora', 'Space Grotesk', 'Fraunces', 'Anton', 'Archivo',
  'Fredoka', 'Source Serif 4', 'Nunito Sans', 'Mulish', 'Barlow Condensed',
  // Script/handwritten accents. Self-contained boards load these via their own
  // fonts <link>.
  'Caveat', 'Patrick Hand',
] as const;

export interface DesignerBoardOptions {
  /** Operator's brief / what the board is for. */
  prompt: string;
  /** Canvas in px (e.g. 3840×2160 landscape, 2160×3840 portrait, LED sizes). */
  width: number;
  height: number;
  /**
   * The BOARD's venue type (inferDesignerVertical) — which may differ from the
   * tenant's column: a K-12 account designing a taqueria's board gets
   * "restaurant", not "k12".
   */
  vertical?: string;
  /** The venue's brand palette (hex). First is treated as primary. */
  palette?: string[];
  /** Venue name + tagline + logo, when known. */
  venueName?: string;
  tagline?: string;
  logoUrl?: string;
  /** Where the logo came from: their website, or an upload the vision read called their logo. */
  logoSource?: 'site' | 'upload';
  /** A photo of theirs (their website / an upload) for a framed photo slot. */
  heroImageUrl?: string;
  /**
   * Where the photo came from (2026-09-23): their website, an operator upload,
   * their POS, or a stock library. A stock photo is never the venue's own and
   * the Photo: line says so; absent = say nothing about whose it is.
   */
  heroImageSource?: 'site' | 'upload' | 'pos' | 'stock';
  /** Real content the board must show (menu items+prices, headline, hours…). */
  content?: string;
  /** Reference summary (scraped site / uploaded image). */
  reference?: string;
  /** What the board is FOR — picks the structures, references and directives. */
  purpose?: DesignerPurpose;
  /** THIS candidate's layout (designer-structures.ts). */
  structure?: DesignerStructure;
  /** The other candidates' layouts, named so this one stays distinct. */
  otherStructures?: DesignerStructure[];
  /** Approved reference boards shown before the brief (designer-exemplars.ts). */
  exemplars?: readonly DesignerExemplar[];
  /**
   * SAMPLE-MENU MODE — the operator asked for typical items and supplied no
   * menu. Generic dish names are allowed; every price is an EMPTY slot.
   */
  sampleMenu?: SampleMenuRequest | null;
  /**
   * PER-TENANT STYLE MEMORY — a compact "house style" fingerprint distilled from
   * the boards THIS operator has kept. Null for a new operator.
   */
  houseStyle?: string;
  /**
   * INTERPRETATION HEDGING (2026-07-01) — the structured brief extracted (or
   * client-confirmed) from the operator's prompt before the fan-out, so every
   * candidate shares one reading of what's wanted. Optional.
   */
  brief?: DesignerBrief;
  /**
   * TAP TARGETS (2026-08-25) — the operator's own words asked for touch / links
   * / buttons, so this board must carry [data-action] hot zones. Off by default.
   */
  interactive?: boolean;
  /**
   * DRAW-TIME VISION (2026-09-23) — which of the logo / photo named in this
   * message also ride along as IMAGES the model can see (only ever our own
   * re-hosted copies). Empty/absent: nothing is attached, nothing is said.
   */
  attachedImages?: ReadonlyArray<'logo' | 'photo'>;
}

const FONT_LIST = DESIGNER_FONTS.join(', ');

/**
 * The legibility floor the runtime enforces (VOS-FIT-ENGINE `MINPX` in
 * designer-edit-shim.ts: 2.4% of the canvas short side, clamped to 24–60 px).
 * The prompt states the same numbers so nothing has to be rescued.
 */
export function designerSizeFloor(width: number, height: number): { caption: number; body: number; item: number; headline: number } {
  const s = Math.max(1, Math.min(width || 1920, height || 1080));
  return {
    caption: Math.max(24, Math.min(60, Math.round(s * 0.024))),
    body: Math.round(s * 0.03),
    item: Math.round(s * 0.036),
    headline: Math.round(s * 0.075),
  };
}

/**
 * The system prompt. Everything the model must do on EVERY board, stated once
 * and positively. What a board should LOOK like is shown, not told: the user
 * message opens with approved reference boards.
 */
export const DESIGNER_SYSTEM_PROMPT = [
  'You design ONE digital-signage board as a complete, self-contained HTML document. It hangs on a real wall in a real business: a 43–98 inch screen, read from across the room in a few seconds.',
  '',
  'THE BAR',
  '- When the message opens with REFERENCE BOARDS, those are approved boards from our production library, made for these same screens. Match their craft: horizontal bands that add up exactly to the canvas; a confident type scale with huge display type and nothing small; one disciplined palette carried by the brand colors; real structure — rails, card grids, framed photo panels, ruled footers — wherever the content is a list; every region of the canvas doing work.',
  "- Bring that finish to THIS venue's brand, content and layout. A reference board's words, prices and photos are placeholders (VENUE NAME, Menu Item One, $0.00, empty frames) and its colors are only tokens: none of them goes on this board.",
  '- Build the layout named for this option in the message. The brief outranks a reference; the rules below outrank both.',
  '',
  'OUTPUT',
  '- Return only the HTML document, starting with <!doctype html>. No markdown fences, no commentary.',
  '- The FIRST child of <body> is one stage <div> sized exactly to the canvas in px (position:relative; overflow:hidden). Do not scale it yourself: the platform scales the stage to the screen and runs a fit engine.',
  '- Inline <style> plus one <link> to Google Fonts for the families and weights you use.',
  '- No <script> of any kind (every script is stripped), no <iframe>/<object>/<embed>, no on* handler attributes, no javascript: URLs. Images only from https URLs you were given.',
  '',
  'FACTS',
  '- Every name, price, number, date, time, address, phone, URL, rating and offer on the board comes from the brief, the REAL CONTENT block or the website text you were given. Names and prices are written exactly as supplied.',
  "- Copy is yours to write — headlines, kickers, one-line descriptions, a call to action — in the venue's voice. Facts are not.",
  "- Build copy from the venue's own words when you have them (their website's headlines, what they sell); never generic filler, never lorem ipsum or \"[Your text here]\".",
  '- Where no price was supplied, the board shows none. Where a section has no supplied facts, that section is left out and the rest of the board takes its space.',
  '- Every supplied item appears on the board, exactly once.',
  '',
  'LAYOUT',
  '- Build in bands: a header, the content, a footer — optionally a rail beside the content. The band heights (plus any borders) add up exactly to the canvas height; write the sum as a CSS comment.',
  '- Keep a safe margin of about 4–5% of the short side on every edge; nothing touches the canvas edge.',
  '- Fill the canvas: every region carries content, a designed brand field or a framed photo. A photo slot with no photo still shows a finished on-palette panel. No dead space, no empty column.',
  '- Content sits in normal flow (flex or grid) inside its band. position:absolute is only for decoration, photo layers and pinned bands — never for text that could collide with other text.',
  '- Size the grid to the item count so every item fits at the size floor; with many items, drop per-item photos and description lines before you shrink type, and add a column before you drop anything.',
  '- Cards, rails, bands and framed panels are how menus and schedules read — use them. The one box to avoid: a filled box behind a single word inside running text.',
  '',
  'TYPE',
  '- The message states the size floor for this canvas. Nothing is smaller than it; body lines are larger; item names and prices larger again; the headline or venue name far larger. The platform enlarges anything under the floor, which breaks the layout around it — author it right.',
  `- Exactly two families, from this list only (anything else falls back to a system font): ${FONT_LIST}. One characterful display face for the venue name, headlines, item names and prices; one clean text face for the rest. Use weights the family has (Anton has only 400).`,
  '- Prices and numbers use font-variant-numeric:tabular-nums and line up on one edge. Leave room for a 7-character price and a two-line name.',
  '- Put data-fit and data-fit-min (the floor) on every text element whose length can change: names, prices, headlines, descriptions, footer lines. The fit engine shrinks, then wraps, text to its own box — never below the floor.',
  '- Hierarchy comes from size, weight and color, never from opacity. Contrast at least 4.5:1 for display text and 7:1 for small text, at the worst point behind the letters.',
  '',
  'COLOR AND IMAGES',
  '- The supplied brand palette is the backbone: one strong brand field (a rail, the header or the footer band), a paper or canvas neutral, a dark ink, and one accent for prices, kickers and rules. With no palette, choose a confident palette that fits the venue.',
  '- A supplied logo URL goes in the header as <img data-imgslot="logo">, sized to its slot with object-fit:contain, with the venue name typeset as its fallback.',
  '- A supplied photo URL goes in a framed photo panel or slot (<img data-imgslot="hero"> with object-fit:cover), never as a wash behind running text.',
  '- Never write a stock-photo URL (Unsplash, Pexels, …): the platform strips them. A photo slot you have no photo for keeps its data-imgslot and a designed on-palette fallback.',
  '',
  'EDITABILITY',
  '- Every piece of text carries data-field="<key>"; every photo and logo carries data-imgslot="<key>". Keys are short and stable (headline, subhead, venue, footer.left …).',
  '- Items use item.N.category, item.N.name, item.N.desc, item.N.price and item.N.image, with N from 0 in the supplied order; each item\'s whole container carries data-menu-row="N". Section titles use section.K.title.',
  '',
  'LED-SAFE CSS (these boards also run on older Chromium signage players)',
  '- Write top/right/bottom/left, never the inset shorthand. No gap on flex containers — use margins; gap on display:grid is fine. No :has(), @container, color-mix(), oklch() or CSS nesting. mask needs -webkit-mask beside it. backdrop-filter only over a solid fallback background.',
  '- Motion is optional. If you animate, animate transform or opacity only, on decoration or a whole card; the board is complete and correct with every animation at rest.',
  '',
  'TAP TARGETS',
  '- Only when the message says this board is tapped: put data-action="<shortKey>" on each whole tappable block (a card, row or button, at least ~120×64 px), make it look tappable, and write no destination — no href, no URL; the operator wires each key afterwards. Otherwise write no data-action at all.',
  '',
  'BEFORE YOU ANSWER, CHECK',
  '- Every supplied item is on the board once, with its supplied name and price.',
  '- No text is under the floor; nothing crosses its band, its card or the canvas edge.',
  '- The bands add up to the canvas; no region is empty.',
  '- Every fact traces to the brief, the content or the website text.',
].join('\n');

// ───────────────────────────────────────────────────────────────────────────
// Content: menu rows, POS-bound rows, sample-menu requests
// ───────────────────────────────────────────────────────────────────────────

/** A currency amount, the crispest signal that a line is a priced menu row. */
const MENU_ROW_MONEY_RE = /[$€£¥₹]\s?\d|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|dollars?)\b/i;

/**
 * POS-BOUND ROW CONTRACT (2026-09-22, the lead's contract for the POS-bound
 * generation agent — docs/research/2026-09-22-ai-designer-rework/04-*.md,
 * section 4 Phase 3). The server builds a POS-bound menu itself and sends it as
 *
 *     LIVE POS MENU from Toast. 21 items in 2 sections, bound to the venue's POS.
 *     Tacos:
 *     [item.0] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef — photo: item.0.photo
 *     [item.1] Tacos — Fish Taco — $4.50
 *     Item photos (…):
 *     item.0.photo: https://…/ai-designer/<tenant>/item-<hash>.jpg
 *
 * The model never sees or copies a POS id: it keeps each row's NUMBER and wraps
 * the row in one element carrying `data-menu-row="N"`. After generation the
 * binder stamps `data-pos-item` (the external id) and `data-seed` (the catalog
 * name) on that element — the same slot key (`item.N`) Codex's Super Taco
 * boards take their `posItemBindings` on.
 *
 * ITEM PHOTOS (2026-09-23). A row whose POS photo was checked and copied to our
 * bucket ends "— photo: item.N.photo", and our URL is listed after the rows
 * (pos-binding-plan.ts formatPosPlanContent). The directive asks for exactly
 * `<img data-imgslot="item.N.photo" src="<that URL>" alt="">` in that row's
 * card, and for no photo frame at all on a row without one — never a stock
 * photo, never another row's photo. The binder enforces the same rule on the
 * board that comes back (menu-binding.ts, `plan.itemPhotos`).
 */
export const DESIGNER_MENU_ROW_ATTR = 'data-menu-row';
/** Attributes the binder stamps after generation; every revise must keep them. */
export const DESIGNER_BINDER_ATTRS = ['data-menu-row', 'data-pos-item', 'data-seed'] as const;

const POS_ROW_RE = /^\s*\[item\.(\d{1,3})\]\s*(.*)$/;
/** `— photo: item.N.photo` closing a POS row: our copy of the POS's photo of that dish exists. */
const POS_ROW_PHOTO_RE = /\s[—–]\s+photo:\s*item\.(\d{1,3})\.photo\s*$/i;
/** `item.N.photo: https://…` — one line of the Item photos list after the rows. */
const POS_PHOTO_LINE_RE = /^\s*item\.(\d{1,3})\.photo:\s*(https:\/\/[^\s"'<>()]+)\s*$/i;

/** One `[item.N]` row of a POS-bound content block. */
export interface PosBoundRow {
  n: number;
  line: string;
  /**
   * OUR copy of the POS's photo of this dish — present only when the row says
   * "photo: item.N.photo" (its own number) AND the Item photos list gives an
   * https URL for it. Anything else: no photo.
   */
  photo?: string;
}

/** Every `[item.N]` row of a POS-bound content block, in order, with its photo when it has one. */
export function parsePosBoundRows(content?: string | null): PosBoundRow[] {
  const out: PosBoundRow[] = [];
  const photos = new Map<number, string>();
  for (const raw of String(content || '').split('\n')) {
    const m = POS_ROW_RE.exec(raw);
    if (m) {
      out.push({ n: Number(m[1]), line: m[2].trim() });
      continue;
    }
    const p = POS_PHOTO_LINE_RE.exec(raw);
    if (p && !photos.has(Number(p[1]))) photos.set(Number(p[1]), p[2]);
  }
  for (const row of out) {
    const mark = POS_ROW_PHOTO_RE.exec(row.line);
    // A row only ever names its OWN photo; a marker naming another row is ignored.
    if (!mark || Number(mark[1]) !== row.n) continue;
    const url = photos.get(row.n);
    if (url) row.photo = url;
  }
  return out;
}

/**
 * How many lines of a REAL CONTENT block are menu rows. A POS-bound `[item.N]`
 * line always counts; otherwise a line with a currency amount or an em-dash
 * delimited shape (`Section — Item — $4.25 — description`, `Name — $4.50`).
 * Prose and headers ("LIVE POS MENU from Toast. 21 items…", "Tacos:") never
 * count.
 */
export function countMenuContentRows(content?: string): number {
  if (!content) return 0;
  let rows = 0;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.length > 300) continue;
    if (POS_ROW_RE.test(t) || MENU_ROW_MONEY_RE.test(t) || t.split(' — ').filter((p) => p.trim()).length >= 2) rows += 1;
  }
  return rows;
}

/** Row labels for the directive: "item.0, item.3 and item.7" (the first eight, then "and N more"). */
function posRowList(nums: number[]): string {
  const shown = nums.slice(0, 8).map((n) => `item.${n}`);
  const more = nums.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown.join('');
}

/**
 * The directive for a POS-bound menu. One isolated section the POS agent can
 * import. Item photos (2026-09-23): a row gets a photo frame only when it came
 * with our copy of the POS's photo of that dish (`photo`, from
 * parsePosBoundRows); every other row gets none — never a stock photo, never
 * another row's photo.
 */
export function buildPosBoundRowsDirective(rows: Array<Pick<PosBoundRow, 'n' | 'photo'>>): string[] {
  const nums = rows.map((r) => r.n);
  const last = nums.length ? Math.max(...nums) : 0;
  const withPhoto = rows.filter((r) => typeof r.photo === 'string' && r.photo).map((r) => r.n);
  const lines = [
    `POS-BOUND MENU — the ${rows.length} [item.N] rows above (item.0 … item.${last}) are bound to the venue's POS; the platform keeps their names and prices live after you finish.`,
    '- Render every [item.N] row exactly once and keep its number N. Never write the [item.N] tag itself on the board.',
    '- Wrap each row in exactly ONE element carrying data-menu-row="N". Inside it: data-field="item.N.name", data-field="item.N.price", and data-field="item.N.desc" when the row has a description.',
  ];
  if (withPhoto.length) {
    lines.push(
      `- ITEM PHOTOS — ${withPhoto.length === rows.length ? 'every row ends' : `${withPhoto.length} of the rows (${posRowList(withPhoto)}) end${withPhoto.length === 1 ? 's' : ''}`} "photo: item.N.photo": the venue's own photo of that dish, its URL listed under "Item photos" above (that list is for the photo frames, never text on the board). Give that row's card a photo frame holding exactly <img data-imgslot="item.N.photo" src="(that row's URL)" alt=""> with object-fit:cover.`,
      "- A photo belongs to its own row only: never put one row's photo in another row's card, and never use a photo twice.",
    );
  }
  if (withPhoto.length < rows.length) {
    lines.push(
      withPhoto.length
        ? '- A row without a photo gets no photo frame — a flat brand-colour panel is fine — and never a stock photo or a picture of some other dish.'
        : '- None of these rows comes with a photo: give the item cards no photo frames — a flat brand-colour panel is fine — and never a stock photo or a picture of some other dish.',
    );
  }
  if (withPhoto.length) {
    lines.push('- If the grid is too dense for photos at the size floor, leave the item photos out rather than shrink the type.');
  }
  lines.push(
    '- Section titles use data-field="section.K.title", K from 0 in the order the sections appear.',
    '- Copy names and prices verbatim. Leave room for a 7-character price and a two-line name — the live menu can change both. Never hide or drop a row.',
    '- Do not write data-pos-item or data-seed yourself: the platform stamps them.',
  );
  return lines;
}

/**
 * FULL-MENU directive — fires when the board's PURPOSE is a menu and the
 * content carries rows (2026-09-22: it used to fire on "8+ rows", which let a
 * 6-item menu become a poster with a garnish of menu).
 */
export function buildFullMenuDirective(rowCount: number): string[] {
  return [
    `THIS BOARD IS THE MENU — the content above has ${rowCount} item${rowCount === 1 ? '' : 's'}.`,
    `- Render every one, exactly once, in the supplied order and sections. No "…and more", no "see our full menu", no picking favorites: the board carries ${rowCount}.`,
    '- Each item is one data-menu-row="N" container with its item.N.* fields; sections get a visible title (section.K.title) and become the columns or blocks of the layout.',
    '- Make it fit with the grid and the type scale — step the whole scale down together, never below the floor; then drop descriptions, then per-item photos. Items are never what goes.',
    '- All three options carry the same complete menu; they differ in layout only.',
  ];
}

/**
 * SAMPLE-MENU MODE (report 02 §4). "Create a menu board using standard Mexican
 * food items" with no menu anywhere: the operator wants a finished-looking menu
 * they will fill in, not a blank board — and never guessed prices.
 */
export interface SampleMenuRequest {
  /** The operator's own words that asked for it ("standard Mexican food items"). */
  phrase: string;
}

// Not "popular" or "best-selling": "the popular items from our POS" means the
// venue's own best sellers, and treating it as a sample request would switch
// the POS menu off.
const SAMPLE_ADJECTIVES = 'standard|typical|common|classic|generic|sample|example|placeholder|traditional|usual|basic|staple|default';
const SAMPLE_NOUNS = "items?|dish(?:es)?|foods?|menu(?:\\s+items?)?|drinks?|favou?rites|fare|options|offerings|selections?|plates?|entr[eé]es?";
const SAMPLE_PHRASE_RE = new RegExp(`\\b(${SAMPLE_ADJECTIVES})\\b((?:\\s+[\\w'’&-]+){0,3})\\s+(${SAMPLE_NOUNS})\\b`, 'gi');
const SAMPLE_EXPLICIT_RE = /\b(?:(?:make|made|come)\s+up|invent|fill\s+in\s+with|dummy|fake|filler)\b[^.\n]{0,30}\b(?:items?|dish(?:es)?|menu|drinks?)\b/i;
/** "our standard menu", "my usual items" — their own menu, not a sample. */
const OWN_MENU_BEFORE_RE = /\b(?:our|my|their|the\s+restaurant'?s|the\s+venue'?s)(?:\s+\w+)?\s*$/i;

/**
 * Did the operator explicitly ask for typical / sample items? Returns the phrase
 * that asked, or null. Only meaningful when no real menu was supplied — the
 * caller checks that.
 */
export function detectSampleMenuRequest(texts: Array<string | null | undefined>): SampleMenuRequest | null {
  for (const raw of texts) {
    const text = String(raw || '');
    if (!text) continue;
    SAMPLE_PHRASE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SAMPLE_PHRASE_RE.exec(text)) !== null) {
      if (OWN_MENU_BEFORE_RE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      return { phrase: m[0].trim().slice(0, 120) };
    }
    const e = SAMPLE_EXPLICIT_RE.exec(text);
    if (e) return { phrase: e[0].trim().slice(0, 120) };
  }
  return null;
}

/** The sample-menu directive: generic names allowed, every price an empty designed slot. */
export function buildSampleMenuDirective(req: SampleMenuRequest): string[] {
  return [
    `SAMPLE MENU — the operator asked for "${req.phrase}" and supplied no menu. Build a complete, finished-looking menu board they will fill in:`,
    '- Use 6–8 generic, widely known items for this kind of venue (plain dish names, no invented specials, no brand names), each with a one-line description.',
    '- EVERY price is an empty designed slot, never a number: <span data-field="item.N.price" data-vos-sample-price="1">$ —</span>. Keep the price column in the design at full size so the operator can type prices in.',
    '- No deal, no "from $…", no discount anywhere on the board.',
  ];
}

/** A menu board with no menu and no sample request: no prices, no invented list. */
export function buildNoMenuDirective(): string[] {
  return [
    'NO MENU WAS SUPPLIED — show no prices and no price column. If the brief names dishes, feature those as a specialties board (the names, a one-line description each, a photo slot). Otherwise build a brand board about the venue and what it serves, with a clear invitation to order.',
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// Purpose + venue type — from what the operator said, not the tenant column
// ───────────────────────────────────────────────────────────────────────────

const PURPOSE_SIGNALS: Array<{ purpose: DesignerPurpose; re: RegExp }> = [
  { purpose: 'menu', re: /\b(menus?|price\s+list|tap\s+list|drink\s+list|wine\s+list|cocktail\s+list|food\s+items?|dishes|entr[eé]es)\b/i },
  { purpose: 'offer', re: /\b(promo(?:tion)?s?|special\s+offers?|specials|deals?|sale|%\s*off|discounts?|limited[-\s]time|bogo|coupons?|happy\s+hour)\b/i },
  { purpose: 'event', re: /\b(events?|concerts?|tournaments?|festivals?|fairs?|galas?|fundraisers?|countdowns?|tickets?|rsvp|kick[-\s]?off|game\s+(?:day|night)|opening\s+night|grand\s+opening|recital|showcase)\b/i },
  { purpose: 'welcome', re: /\b(welcome|greeting|greet)\b/i },
  { purpose: 'announcement', re: /\b(announcements?|notices?|news|reminders?|updates?|closures?|hours)\b/i },
];

/**
 * What the board is FOR, when the request did not say. Real menu rows decide it
 * outright; otherwise the operator's words, in the order above (a "happy hour
 * menu" is a menu; a "happy hour" poster is an offer).
 */
export function inferDesignerPurpose(opts: { prompt?: string; brief?: DesignerBrief | null; content?: string }): DesignerPurpose {
  if (countMenuContentRows(opts.content) >= 3) return 'menu';
  const text = [opts.prompt, opts.brief?.occasion, opts.brief?.headline, ...(opts.brief?.items || [])].filter(Boolean).join(' ');
  for (const s of PURPOSE_SIGNALS) if (s.re.test(text)) return s.purpose;
  return 'announcement';
}

/**
 * Venue-type signals. Strong words name the kind of business; weak words are
 * things several kinds of business have (a school cafeteria serves pizza too).
 */
const VERTICAL_SIGNALS: Array<{ vertical: string; strong: RegExp; weak?: RegExp }> = [
  { vertical: 'K12', strong: /\b(school|students?|teachers?|cafeteria|district|principal|pta|homeroom|classrooms?|elementary|middle\s+school|high\s+school|recess)\b/gi, weak: /\b(parents|campus|bell\s+schedule|lunch\s+menu|spirit\s+week)\b/gi },
  { vertical: 'QSR', strong: /\b(taqueria|drive[-\s]?thru|fast[-\s]food|quick[-\s]service|counter\s+service)\b/gi, weak: /\b(tacos?|burritos?|burgers?|fries|pizza|combo|wings|nachos|quesadillas?|boba|donuts?)\b/gi },
  { vertical: 'RESTAURANT', strong: /\b(restaurants?|bistro|trattoria|eatery|steakhouse|brasserie|diner|cafe|café|bakery|coffee\s+shop)\b/gi, weak: /\b(food|dishes|entr[eé]es|appetizers?|cuisine|chef|kitchen|brunch|dinner|mexican|italian|thai|sushi|ramen|coffee|espresso)\b/gi },
  { vertical: 'BAR', strong: /\b(bar|pub|taproom|brewery|brewpub|nightclub|tap\s+list|wine\s+bar|cocktail\s+bar|lounge)\b/gi, weak: /\b(cocktails?|beers?|on\s+tap|happy\s+hour|spirits|wine)\b/gi },
  { vertical: 'GYM', strong: /\b(gym|fitness|crossfit|pilates|workouts?|personal\s+training|athletic\s+club)\b/gi, weak: /\b(trainers?|members?hip|classes|yoga|spin)\b/gi },
  { vertical: 'WORSHIP', strong: /\b(church|parish|ministry|worship|sermon|congregation|temple|synagogue|mosque|chapel)\b/gi, weak: /\b(pastor|sunday\s+service|faith|prayer)\b/gi },
  { vertical: 'HEALTHCARE', strong: /\b(clinic|hospital|dental|dentist|medical|pharmacy|urgent\s+care|veterinary|physicians?|pediatrics?)\b/gi, weak: /\b(patients?|appointments?|wellness)\b/gi },
  { vertical: 'HOSPITALITY', strong: /\b(hotel|resort|motel|lodge|inn)\b/gi, weak: /\b(guests?|check[-\s]?in|concierge|suites?)\b/gi },
  { vertical: 'FASHION', strong: /\b(boutique|fashion|apparel|couture|lookbook)\b/gi, weak: /\b(collection|runway|styles?)\b/gi },
  { vertical: 'RETAIL', strong: /\b(retail|store|shop|showroom)\b/gi, weak: /\b(shoppers?|new\s+arrivals?|clearance|in\s+stock)\b/gi },
  { vertical: 'SPORTS', strong: /\b(stadium|arena|ballpark|athletics|varsity|scoreboard)\b/gi, weak: /\b(game\s+day|fans|kick[-\s]?off|tip[-\s]?off|playoffs?|tournament)\b/gi },
  { vertical: 'CORPORATE', strong: /\b(corporate|headquarters|office|town\s+hall|all[-\s]hands|employees)\b/gi, weak: /\b(company|team|staff|visitors)\b/gi },
];

// `designerVerticalFamily` lives in designer-structures.ts (dependency-free) so the exemplar
// selector can use it WITHOUT importing this module — designer-prompt.ts imports the
// selector, and a cycle between the two is one load-order accident away from an undefined.
import { designerVerticalFamily } from './designer-structures';
export { designerVerticalFamily };

function countMatches(re: RegExp | undefined, text: string): number {
  if (!re) return 0;
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

/**
 * The BOARD's venue type (report 01, cause #6). The web used to send the
 * tenant's vertical column, so a K-12 account (RIOT) designing a taqueria's
 * menu got "AUDIENCE — a K-12 school … TODAY'S LUNCH" and "Vertical: k12".
 * The venue type now comes from what the request is about — the brief, the
 * website's "what they sell", the menu, the venue name — and falls back to the
 * tenant's column only when those say nothing clearer. Strong words count 3,
 * weak words 1; the tenant's own vertical wins ties.
 */
export function inferDesignerVertical(opts: {
  prompt?: string | null;
  reference?: string | null;
  content?: string | null;
  venueName?: string | null;
  brief?: DesignerBrief | null;
  tenantVertical?: string | null;
}): { vertical: string; source: 'board' | 'tenant' } {
  const tenant = String(opts.tenantVertical || '').trim().toUpperCase() || 'VENUE';
  const text = [
    opts.prompt,
    opts.venueName,
    opts.brief?.occasion,
    opts.brief?.headline,
    ...(opts.brief?.items || []),
    opts.reference,
    // Menu rows are food evidence, but only a sample of them — a 60-row menu
    // must not drown out what the operator said.
    String(opts.content || '').split('\n').slice(0, 12).join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
  const scores = VERTICAL_SIGNALS.map((s) => ({ vertical: s.vertical, score: countMatches(s.strong, text) * 3 + countMatches(s.weak, text) }));
  const tenantScore = scores.find((s) => s.vertical === tenant)?.score ?? 0;
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a), { vertical: tenant, score: tenantScore });
  if (best.vertical === tenant || best.score <= tenantScore || best.score < 2) return { vertical: tenant, source: 'tenant' };
  // Same family as the tenant (a QSR account's "restaurant" board): keep the
  // tenant's own, more specific voice.
  if (designerVerticalFamily(best.vertical) === designerVerticalFamily(tenant)) return { vertical: tenant, source: 'tenant' };
  return { vertical: best.vertical, source: 'board' };
}

const VERTICAL_LABELS: Record<string, string> = {
  K12: 'school', QSR: 'quick-service restaurant', RESTAURANT: 'restaurant', BAR: 'bar',
  GYM: 'gym', FITNESS: 'gym', RETAIL: 'store', FASHION: 'boutique', CORPORATE: 'office',
  SPORTS: 'sports venue', HEALTHCARE: 'healthcare facility', HOSPITALITY: 'hotel',
  WORSHIP: 'house of worship', VENUE: 'venue',
};

/** "QSR" → "quick-service restaurant"; unknown → lower-cased as given. */
export function designerVerticalLabel(vertical?: string | null): string {
  const v = String(vertical || '').trim();
  return VERTICAL_LABELS[v.toUpperCase()] || v.toLowerCase() || 'venue';
}

/**
 * Does the tenant's saved BRAND VOICE belong on this board? Not when the board
 * is plainly for another business: a venue name that shares no word with the
 * tenant's names, or a venue type the request itself established that is a
 * different kind of business from the tenant's.
 */
export function tenantBrandVoiceApplies(opts: {
  tenantNames: Array<string | null | undefined>;
  venueName?: string | null;
  tenantVertical?: string | null;
  board: { vertical: string; source: 'board' | 'tenant' };
}): boolean {
  if (opts.board.source === 'board' && designerVerticalFamily(opts.board.vertical) !== designerVerticalFamily(opts.tenantVertical)) return false;
  const words = (s: string | null | undefined) =>
    new Set((s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['the', 'and', 'inc', 'llc', 'co'].includes(w)));
  const venue = words(opts.venueName);
  if (!venue.size) return true;
  const tenant = new Set(opts.tenantNames.flatMap((n) => [...words(n)]));
  if (!tenant.size) return true;
  for (const w of venue) if (tenant.has(w)) return true;
  return false;
}

/**
 * The tenant's saved palette (TenantBranding.palette: {primary, accent, ink,
 * surface, …}) as the ordered hex list the Designer takes. Used when a request
 * says `palette: 'brand'` (the Concierge's intake does, when the tenant has
 * brand colors on file).
 */
export function designerPaletteFromBrand(palette: unknown): string[] {
  const p = (palette && typeof palette === 'object' ? palette : {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['primary', 'accent', 'ink', 'surface', 'surfaceAlt']) {
    const raw = p[k];
    const v = typeof raw === 'string' ? raw.trim() : '';
    const hex = /^#?[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/.test(v) ? (v.startsWith('#') ? v : `#${v}`) : '';
    if (hex && !out.includes(hex.toLowerCase())) out.push(hex.toLowerCase());
  }
  return out;
}

/**
 * The website summary, minus the instructions baked into it upstream
 * ("use it as the hero background (with a brand scrim…)", "place the real
 * logo…") — the logo and photo lines of the Designer message now say exactly
 * how to use each — and minus a scraper's "Fonts: [object Object]" slip.
 */
export function cleanReferenceForDesigner(reference?: string | null): string {
  return String(reference || '')
    .replace(/\s*Has a (?:LOGO image|real hero\/work PHOTO)\b.*?\.(?=\s+[A-Z]|\s*$)/gs, '')
    .replace(/\s*Fonts:\s*\[object Object\][^.]*\./g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────────────────────────────────
// The user message
// ───────────────────────────────────────────────────────────────────────────

const PURPOSE_LABEL: Record<DesignerPurpose, string> = {
  menu: 'menu board',
  offer: 'offer / promotion board',
  event: 'event board',
  announcement: 'announcement board',
  welcome: 'welcome board',
};

/** Build the user-turn message for one board generation. */
export function buildDesignerUserPrompt(opts: DesignerBoardOptions): string {
  const orient = opts.height > opts.width ? 'portrait' : 'landscape';
  const floor = designerSizeFloor(opts.width, opts.height);
  const lines: string[] = [];

  const refs = formatExemplarsForPrompt(opts.exemplars || []);
  if (refs) lines.push(refs, '');

  lines.push(
    'THIS BOARD',
    `PRECEDENCE — when these disagree, the earlier one wins: (1) the operator's own words in the Brief, ${opts.brief ? '(2) the confirmed reading of it, (3)' : '(2)'} the real content and their website, then last the venue type. The venue type is a fallback for what the operator did NOT say; it never overrides what they did say.`,
    '',
    `Brief: ${opts.prompt}`,
  );
  const purpose = opts.purpose;
  lines.push(
    `Board: ${purpose ? PURPOSE_LABEL[purpose] : 'signage board'} · canvas ${opts.width} × ${opts.height} px (${orient}) · size floor ${floor.caption} px (smallest text), ${floor.body} px body, ${floor.item} px item names and prices, ${floor.headline} px+ headline — use data-fit-min="${floor.caption}".`,
  );
  const venueBits = [opts.venueName ? `Venue: ${opts.venueName}` : '', `venue type: ${designerVerticalLabel(opts.vertical)}`].filter(Boolean);
  lines.push(`${venueBits.join(' · ')}.`);
  if (opts.tagline) lines.push(`Tagline: ${opts.tagline}.`);

  if (opts.structure) {
    const others = (opts.otherStructures || []).filter((s) => s.id !== opts.structure!.id).map((s) => s.label.toLowerCase());
    // The reference boards are ONE set per batch (a shared, cacheable prefix),
    // so each option is told which of them — if any — is its own layout.
    const refs = opts.exemplars || [];
    const ref = refs.findIndex((e) => e.structure === opts.structure!.id);
    const refNote = !refs.length
      ? ''
      : ref >= 0
        ? ` Reference ${ref + 1} is this layout — follow its structure.`
        : ' None of the references is this layout — borrow their craft, not their structure.';
    lines.push(
      '',
      `LAYOUT FOR THIS OPTION — ${opts.structure.label.toUpperCase()}: ${opts.structure.brief}${others.length ? ` The other options are ${others.join(' and ')}; make this one unmistakably ${opts.structure.label.toLowerCase()}.` : ''}${refNote}`,
    );
  }

  if (opts.palette && opts.palette.length) {
    lines.push(`Brand palette (first = primary): ${opts.palette.join(', ')}. Build the board's color on these: one as a strong field (a rail, the header or the footer band), one as the accent for prices, kickers and rules, with a paper or canvas neutral and a dark ink.`);
  }
  // Whose logo / photo it is, said plainly (2026-09-23): the reference's
  // logoSource / imageSource, carried in the request. A stock photo is named as
  // stock so the board never captions it as the venue's own.
  if (opts.logoUrl) {
    const whose =
      opts.logoSource === 'upload'
        ? "the venue's own logo, uploaded by the operator"
        : opts.logoSource === 'site'
          ? "the venue's own logo, from their website"
          : '';
    lines.push(`Logo: ${opts.logoUrl}${whose ? ` — ${whose}` : ''} — put it in the header as <img data-imgslot="logo" src="${opts.logoUrl}" alt="${(opts.venueName || 'Logo').replace(/"/g, '')}"> sized to its slot with object-fit:contain, and typeset the venue name as its fallback.`);
  }
  if (opts.heroImageUrl) {
    const whose =
      opts.heroImageSource === 'stock'
        ? 'a stock photo, not the venue\'s own — never caption it as theirs (no "our kitchen", "our team" or "made here")'
        : opts.heroImageSource === 'upload'
          ? "the venue's own photo, uploaded by the operator"
          : opts.heroImageSource === 'pos'
            ? "the venue's own photo of one of their menu items, from their point-of-sale system"
            : opts.heroImageSource === 'site'
              ? "the venue's own photo, from their website"
              : '';
    lines.push(`Photo: ${opts.heroImageUrl}${whose ? ` — ${whose}` : ''} — use it in the layout's framed photo panel or slot as <img data-imgslot="hero" src="${opts.heroImageUrl}" alt=""> with object-fit:cover. Not as a wash behind running text.`);
  }
  if (opts.attachedImages && opts.attachedImages.length) {
    const logo = opts.attachedImages.includes('logo');
    const photo = opts.attachedImages.includes('photo');
    lines.push(
      logo && photo
        ? 'The logo and the photo above are attached as images so you can see them: take the real colors and wordmark from the logo, and frame the photo around what it shows.'
        : logo
          ? 'The logo above is attached as an image so you can see it: take the real colors and wordmark from it.'
          : 'The photo above is attached as an image so you can see it: frame it around what it shows.',
    );
  }

  const content = String(opts.content || '').trim();
  const rowCount = countMenuContentRows(content);
  const posRows = parsePosBoundRows(content);
  if (content) {
    lines.push('', 'REAL CONTENT — render all of it; names and prices exactly as written:', content);
  }
  if (posRows.length) {
    lines.push('', ...buildPosBoundRowsDirective(posRows));
  }
  if (purpose === 'menu' && rowCount > 0) {
    lines.push('', ...buildFullMenuDirective(rowCount));
  } else if (opts.sampleMenu) {
    lines.push('', ...buildSampleMenuDirective(opts.sampleMenu));
  } else if (purpose === 'menu') {
    lines.push('', ...buildNoMenuDirective());
  }

  const reference = cleanReferenceForDesigner(opts.reference);
  if (reference) lines.push('', `From their website / reference (for the look, the voice and what they sell): ${reference}`);
  if (opts.brief) lines.push('', formatBriefForPrompt(opts.brief));
  if (opts.interactive) {
    lines.push(
      '',
      'THIS BOARD IS TAPPED — follow the TAP TARGETS rule: mark every block a visitor should tap with data-action="<shortKey>", make each one look and size like a real tap target, and write no destination (no href, no URL).',
    );
  }
  if (opts.houseStyle) lines.push('', opts.houseStyle);
  lines.push('', 'Return only the complete HTML document.');
  return lines.join('\n');
}

/**
 * Where a candidate's OWN instructions start in its Designer message. Every
 * character before it — the shared reference boards, the brief, the canvas and
 * the venue — is identical across a batch's candidates (and each board's review
 * revise), which is what lets the vendor cache that prefix once for all of them.
 */
export const DESIGNER_PER_CANDIDATE_MARKER = '\n\nLAYOUT FOR THIS OPTION';

/** The batch-shared prefix of a Designer user message (see DESIGNER_PER_CANDIDATE_MARKER). */
export function designerSharedPrefix(userPrompt: string): string {
  const at = userPrompt.indexOf(DESIGNER_PER_CANDIDATE_MARKER);
  if (at >= 0) return userPrompt.slice(0, at);
  const board = userPrompt.indexOf('THIS BOARD');
  return board > 0 ? userPrompt.slice(0, board).replace(/\s+$/, '') : '';
}

/**
 * "Edit with words" / dial-it-in for an already-generated designer board. The
 * operator types a plain-language tweak ("make the headline bigger", "use our
 * red") and the model REVISES the existing board rather than designing a new
 * one. Paired with DESIGNER_SYSTEM_PROMPT as the system.
 */
export function buildDesignerRevisePrompt(opts: {
  currentHtml: string;
  instruction: string;
  width: number;
  height: number;
  vertical?: string;
  palette?: string[];
}): string {
  const orient = opts.height > opts.width ? 'portrait' : 'landscape';
  const floor = designerSizeFloor(opts.width, opts.height);
  const lines: string[] = [
    "You are REVISING an existing signage board, not designing a new one. Below is its COMPLETE current HTML. Apply ONLY the operator's requested change and return the COMPLETE revised HTML document.",
    '',
    `Canvas: ${opts.width} × ${opts.height} px (${orient}). Venue type: ${designerVerticalLabel(opts.vertical)}. Size floor: ${floor.caption} px.`,
  ];
  if (opts.palette && opts.palette.length) {
    lines.push(`Brand palette (hex, first = primary): ${opts.palette.join(', ')}. When the operator says "our color"/"brand color", use these.`);
  }
  lines.push(
    '',
    'REVISION RULES:',
    '- Change ONLY what the operator asked. Keep every other element, the layout, the content, and the design language. This is a surgical edit, not a redesign.',
    `- Keep every data-field, data-imgslot, data-action and data-vos-sample-price attribute, and keep ${DESIGNER_BINDER_ATTRS.join(', ')} EXACTLY as they are, on the same elements — the live POS menu binds to them.`,
    '- Keep obeying the standing rules: nothing under the size floor, facts only from what was supplied, fonts loaded via <link>, LED-safe CSS (longhand top/right/bottom/left, no flex gap).',
    '- If the change would break those rules (e.g. "make everything huge" would overflow), satisfy the intent as far as the rules allow.',
    '- Do NOT add any stock-photo URL. Keep existing images. Keep it self-contained (no scripts).',
    '',
    `OPERATOR'S REQUESTED CHANGE: ${opts.instruction}`,
    '',
    'CURRENT BOARD HTML:',
    opts.currentHtml,
    '',
    'Return ONLY the complete revised HTML document — nothing else.',
  );
  return lines.join('\n');
}

/**
 * PER-TENANT STYLE MEMORY — distill a compact "house style" fingerprint from the
 * raw HTML of boards an operator has KEPT (recurring palette, favored fonts,
 * motion tendency). Pure + deterministic (no AI call, no DB) so it's unit-testable
 * and free. Returns null when there's no usable signal. Fed into the next
 * generation via DesignerBoardOptions.houseStyle.
 */
export function summarizeHouseStyle(htmls: string[]): string | null {
  const real = (htmls || []).filter((h) => typeof h === 'string' && h.length > 200);
  if (!real.length) return null;
  const colorCount: Record<string, number> = {};
  const fonts: string[] = [];
  let motionBoards = 0;
  for (const h of real) {
    for (const c of h.match(/#[0-9a-fA-F]{6}\b/g) || []) {
      const k = c.toLowerCase();
      colorCount[k] = (colorCount[k] || 0) + 1;
    }
    for (const m of h.matchAll(/font-family:\s*([^;}"'<]+)/gi)) {
      const f = (m[1] || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (f && f.length < 40 && !/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui)$/i.test(f) && !fonts.includes(f)) {
        fonts.push(f);
      }
    }
    if (/@keyframes/.test(h)) motionBoards++;
  }
  const topColors = Object.entries(colorCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  const topFonts = fonts.slice(0, 4);
  if (!topColors.length && !topFonts.length) return null;
  const parts: string[] = [];
  if (topColors.length) parts.push(`recurring palette ${topColors.join(', ')}`);
  if (topFonts.length) parts.push(`fonts they favor ${topFonts.join(' / ')}`);
  parts.push(
    motionBoards >= Math.ceil(real.length / 2)
      ? 'they tend to use subtle motion'
      : 'they tend to keep boards mostly still',
  );
  return `THIS OPERATOR'S HOUSE STYLE (learned from boards they have KEPT — lean toward this established, on-brand look UNLESS the new brief clearly calls for something different; do NOT copy any past board's layout, bring this STYLE to the NEW brief): ${parts.join('; ')}.`;
}

/**
 * LEARN FROM REFINES (2026-07-01, launch-sprint #268 item 4) — the operator's
 * chat-to-edit "refine" instructions ("bigger text", "less clutter", "use our
 * red") are gold signal we otherwise throw away after applying them once.
 * Pure keyword-frequency heuristic (NO extra AI call, NO fuzzy matching) over
 * the tenant's last ~10 AI_DESIGNER_REFINE instructions: when 2+ refines hint
 * at the SAME recurring preference, fold it into a standing house-style line
 * so the NEXT generation gets it right the first time instead of the operator
 * having to ask again. Deterministic + unit-testable; returns null when there
 * is no recurring signal (a single one-off refine is not a standing
 * preference — needs at least 2 hits to count as "recurring").
 */
const REFINE_PREFERENCE_RULES: Array<{ keywords: RegExp; line: string }> = [
  { keywords: /\b(bigger|larger|increase.*size|too small|hard to read|can'?t read)\b/i, line: 'they tend to ask for BIGGER text/headlines than the default — start larger than usual' },
  { keywords: /\b(smaller|too big|too large|shrink|reduce.*size)\b/i, line: 'they tend to ask for smaller/more restrained sizing than the default' },
  { keywords: /\b(less clutter|too busy|too much|simplify|cleaner|minimal)\b/i, line: 'they tend to prefer a CLEANER, less cluttered layout — favor fewer elements and more whitespace' },
  { keywords: /\b(more (color|colou?rful)|too plain|too boring|add (some )?color)\b/i, line: 'they tend to want MORE color/vibrancy than the default' },
  { keywords: /\b(our (red|blue|green|color|brand color)|use our|brand color)\b/i, line: 'they tend to insist on the exact brand palette over invented accents' },
  { keywords: /\b(darker|dark (mode|theme|field)|too light|too bright)\b/i, line: 'they tend to prefer a DARKER field/theme than the default' },
  { keywords: /\b(lighter|too dark|brighten)\b/i, line: 'they tend to prefer a LIGHTER field/theme than the default' },
  { keywords: /\b(remove|drop|delete|get rid of|no (photo|image))\b/i, line: 'they tend to trim elements down rather than add them — when in doubt, do less' },
  { keywords: /\b(more (playful|fun|energetic)|too serious|too formal|less (formal|stiff))\b/i, line: 'they tend to want a more PLAYFUL/energetic tone than the default' },
  { keywords: /\b(more (premium|elegant|formal|professional)|too (playful|casual))\b/i, line: 'they tend to want a more PREMIUM/restrained tone than the default' },
  { keywords: /\b(still|no (motion|animation)|stop (moving|animating))\b/i, line: 'they tend to prefer boards STILL — avoid animation unless asked' },
  { keywords: /\b(animat|motion|movement|make it move)\b/i, line: 'they tend to want some MOTION on their boards' },
];

/** Cap how many distilled refine-preference lines can join houseStyle, so
 *  prompt-lean growth stays bounded (see summarizeHouseStyleWithRefines). */
const MAX_REFINE_PREFERENCES = 2;

export function distillRefinePreferences(instructions: string[]): string[] {
  const clean = (instructions || []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 10);
  if (!clean.length) return [];
  const hits: Array<{ line: string; count: number }> = [];
  for (const rule of REFINE_PREFERENCE_RULES) {
    const count = clean.filter((s) => rule.keywords.test(s)).length;
    if (count >= 2) hits.push({ line: rule.line, count });
  }
  hits.sort((a, b) => b.count - a.count);
  return hits.slice(0, MAX_REFINE_PREFERENCES).map((h) => h.line);
}

/**
 * Combine the keep-derived house style with the refine-derived preferences
 * into ONE bounded house-style string. Kept as a separate composer (rather
 * than folding into summarizeHouseStyle) so each signal source stays
 * independently unit-testable and the caller can supply either, both, or
 * neither without restructuring. Returns null only when NEITHER source has
 * signal (matches summarizeHouseStyle's existing null contract).
 */
export function summarizeHouseStyleWithRefines(htmls: string[], refineInstructions: string[]): string | null {
  const base = summarizeHouseStyle(htmls);
  const refinePrefs = distillRefinePreferences(refineInstructions);
  if (!refinePrefs.length) return base;
  const refineLine = `Also, from their past edit requests: ${refinePrefs.join('; ')}.`;
  if (!base) {
    // No keep-derived signal yet, but refine history exists (e.g. an
    // operator who has refined boards but not yet kept one via this path).
    return `THIS OPERATOR'S HOUSE STYLE (learned from their past edit requests — lean toward this UNLESS the new brief clearly calls for something different): ${refinePrefs.join('; ')}.`;
  }
  return `${base} ${refineLine}`;
}

/**
 * Stock-photo hosts an LLM "guesses" by emitting an opaque ID it can't verify.
 * A guessed ID resolves to a random, usually-wrong image (a sunset on a pizza
 * board). We never trust a model-authored photo URL from these.
 */
const GUESSED_PHOTO_HOST_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:unsplash\.com|pexels\.com|pixabay\.com|istockphoto\.com|shutterstock\.com|gettyimages\.com|picsum\.photos|loremflickr\.com|placekitten\.com|placehold\.co|via\.placeholder\.com|source\.unsplash\.com)\/[^"'\s>]*/i;

/**
 * Remove the `src` from any <img> pointing at a guessed stock-photo host (and
 * any inline background-image using one), so a wrong photo can NEVER render. The
 * element keeps its data-imgslot/data-photo-query so the platform can fill a
 * real, keyword-matched photo later; until then the on-palette gradient shows.
 */
export function stripGuessedStockPhotos(html: string): string {
  if (typeof html !== 'string' || !html) return html;
  return html
    // <img ... src="<stock>" ...> → drop the src attribute (keep the tag + data-*)
    .replace(/(<img\b[^>]*?)\s+src\s*=\s*("|')(?:[^"']*)\2/gi, (m, pre: string, q: string) => {
      return GUESSED_PHOTO_HOST_RE.test(m) ? pre : m;
    })
    // inline style background-image:url(<stock>) → neutralize the url()
    .replace(/background(-image)?\s*:\s*url\(([^)]*)\)/gi, (m: string) =>
      GUESSED_PHOTO_HOST_RE.test(m) ? 'background-image:none' : m,
    );
}

/**
 * W0-02 operational kill switch. Set AI_DESIGNER_DISABLED=1 (or true/yes) to
 * stop NEW raw-HTML Designer generation, refinement, and publishing without a
 * deploy — the containment emergency brake the audit requires. Existing
 * persisted boards keep rendering (they pass through the render-side
 * sanitizer + CSP in apps/web/src/lib/designer-safe-srcdoc.ts).
 */
export function designerKillSwitchOn(): boolean {
  const v = String(process.env.AI_DESIGNER_DISABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Result of sanitizing AI-authored board HTML. */
export interface SanitizedDesignerHtml {
  html: string;
  /** Non-fatal Chromium-83 (Taurus) issues found — for logging + prompt tuning. */
  taurusWarnings: string[];
}

/**
 * Sanitize AI-authored board HTML for the sandboxed-iframe render. The iframe is
 * null-origin (sandbox="allow-scripts", NO allow-same-origin) so the document
 * can't reach the parent, cookies, or storage.
 *
 * W0-02 (audit 2026-07-12, P0 "AI-authored JavaScript can control the
 * player"): model-authored JavaScript is NO LONGER preserved. The sandbox
 * blocks cookies/parent-DOM but NOT script execution, postMessage, outbound
 * requests, or CPU burn — so every <script>, on* handler attribute,
 * javascript: URL, and meta-refresh the model writes is stripped here, at
 * the source. The jobs those scripts used to do (stage self-scale, column
 * auto-fit) are performed by TRUSTED platform runtimes instead: the baked
 * EDUCMS-SHIM-V7 + VOS-FIT-ENGINE at persist, and VOS-STAGE-SCALE injected
 * at render (apps/web/src/lib/designer-safe-srcdoc.ts — which also strips
 * again and adds a nonce CSP, containing LEGACY persisted boards).
 * Throws on unusable input.
 */
export function sanitizeDesignerHtml(raw: unknown): SanitizedDesignerHtml {
  if (typeof raw !== 'string') throw new Error('Designer HTML must be a string.');
  let html = raw.trim();
  // Strip accidental markdown fences the model sometimes wraps around the doc.
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If the model prepended prose, cut to the first doctype/<html>/<!-- so we keep
  // only the document.
  const docStart = html.search(/<!doctype html|<html[\s>]/i);
  if (docStart > 0) html = html.slice(docStart);
  if (html.length < 200 || !/<(body|main|div|section|html)[\s>]/i.test(html)) {
    throw new Error('Designer HTML is not a usable document.');
  }
  // 2026-09-23 — a document cut off before it ended (the vendor hit its output
  // ceiling mid-board) used to pass: ≥200 chars and a block tag, so half a board
  // reached the picker. A document that opens <!doctype/<html must close
  // </html>, one that opens <body must close it (designer-board-defects.ts).
  const incomplete = documentIncompleteness(html);
  if (incomplete) throw new DesignerHtmlIncompleteError(incomplete);
  // SECURITY (W0-02): drop EVERY script (inline included), event-handler
  // attribute, javascript: URL, meta refresh, <base>, and nested-framing
  // vector the model authored. Trusted runtimes are injected AFTER this.
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/((?:href|src|action|formaction|xlink:href)\s*=\s*)(['"]?)\s*javascript:[^'">\s]*(\2)/gi, '$1$2#$3');
  // on* handler attributes — looped: removing one can expose another match.
  {
    const onAttr = /(<[a-zA-Z][^>]*?)\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
    let prev = '';
    let guard = 0;
    while (html !== prev && guard < 10) {
      prev = html;
      html = html.replace(onAttr, '$1');
      guard++;
    }
  }
  // IMAGERY GUARD (2026-06-29 "sunset on a Domino's board"): the model cannot
  // know what an opaque stock-photo ID actually depicts, so any hand-written
  // stock URL resolves to a RANDOM, usually-wrong image. Strip the src from any
  // <img> pointing at a stock host — the element keeps its data-imgslot so the
  // platform can fill a REAL keyword-matched photo later (Pexels/BYOK), and
  // until then the on-palette gradient behind it shows (intentional, never wrong).
  html = stripGuessedStockPhotos(html);
  return { html, taurusWarnings: auditDesignerHtmlTaurus(html) };
}

/**
 * Flag Chromium-83-unsafe CSS (NovaStar Taurus floor). Non-fatal — returned for
 * logging + prompt tuning; the prompt forbids these, and a live Taurus check is
 * the backstop. (We don't auto-rewrite — that's brittle on free-form CSS.)
 */
/**
 * Does any flex container carry `gap`? (Flex gap is Chromium 84+; GRID gap has
 * worked since Chromium 66, so it is allowed — the old blanket `gap` ban also
 * outlawed the card grids the approved menu boards are built on.) Looks at
 * each declaration block and each inline style; a rule that sets only `gap`
 * counts when a rule with the same selector makes it a flex container.
 */
function flexGapUsed(html: string): boolean {
  const FLEX_RE = /(?:^|[;{\s])display\s*:\s*(?:inline-)?flex\b/i;
  const GAP_RE = /(?:^|[;{\s])(?:row-|column-)?gap\s*:/i;
  const css = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const flexSelectors = new Set(rules.filter((r) => FLEX_RE.test(r.body)).map((r) => r.sel));
  for (const r of rules) {
    if (!GAP_RE.test(r.body)) continue;
    if (FLEX_RE.test(r.body) || flexSelectors.has(r.sel)) return true;
  }
  for (const m of html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const style = m[2] ?? m[3] ?? '';
    if (FLEX_RE.test(style) && GAP_RE.test(style)) return true;
  }
  return false;
}

export function auditDesignerHtmlTaurus(html: string): string[] {
  const warns: string[] = [];
  if (/\binset\s*:/.test(html)) warns.push('uses `inset:` shorthand (Chromium 83 drops it — use top/right/bottom/left)');
  if (flexGapUsed(html)) warns.push('uses `gap:` on a flex container (Chromium 84+ — use margins; gap on a grid is fine)');
  if (/:has\(/.test(html)) warns.push('uses :has() (not in Chromium 83)');
  if (/@container\b/.test(html)) warns.push('uses container queries (not in Chromium 83)');
  if (/\bcolor-mix\(|\boklch\(/.test(html)) warns.push('uses color-mix()/oklch() (not in Chromium 83)');
  if (/\bbox-decoration-break\b/.test(html)) warns.push('uses box-decoration-break (not in Chromium 83 — renders a multi-line emphasis span as one wrong block; emphasize with color only)');
  // A masked donut/halo MUST ship both `mask:` and `-webkit-mask:` — Chromium 83
  // only honors the prefixed form, so a bare `mask:` drops the cutout and the ring
  // renders as a SOLID opaque disc over content (the gold-standard ray-halo trap).
  if (/[;{]\s*mask\s*:/.test(html) && !/-webkit-mask\s*:/.test(html)) warns.push('uses `mask:` without a `-webkit-mask:` twin (Chromium 83 drops the cutout — a masked halo/donut renders as a solid disc; ship both on adjacent lines)');
  return warns;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIEF EXTRACTION (2026-07-01, launch-sprint #268 item 2) — "we hedge STYLE,
// not INTERPRETATION". Before the 3× fan-out, one CHEAP small call turns the
// operator's free-text prompt into a structured brief. All 3 candidates then
// share a CONFIRMED reading of WHAT the customer wants (occasion/headline/
// items/date/tone/CTA) instead of each art-direction call re-guessing the
// same ambiguous brief independently — so a misread can't miss all 3 the
// same way. Pure functions only (prompt + defensive parse) so this unit-tests
// without the Nest container or a real provider call; AiService owns the
// actual dispatch + the "never block generation" fallback.
// ═══════════════════════════════════════════════════════════════════════════

/** The structured reading of an operator's free-text signage brief. */
export interface DesignerBrief {
  /** What the board is for, in a few words ("happy hour promo", "back to school welcome"). */
  occasion: string;
  /** The single headline the board should carry, in the venue's voice. */
  headline: string;
  /** Concrete items/offers the board should feature (menu items, prices, features). Empty array if none apply. */
  items: string[];
  /** A date/time/schedule string the board should show, if the brief implies one (e.g. "Fridays 4-6pm", "Sept 12"). Empty string if none. */
  dateTime: string;
  /** One or two words describing the tone ("playful", "premium", "urgent", "warm"). */
  tone: string;
  /** A call-to-action phrase, if the brief implies one ("Order now", "RSVP today"). Empty string if none. */
  callToAction: string;
}

/** Hard cap on brief-extraction output — this is a cheap disambiguation
 *  pass, not a generation; keep it small on purpose (economics + speed). */
export const BRIEF_EXTRACTION_MAX_TOKENS = 500;

/** Short abort ceiling for the extraction call — it must fail fast and let
 *  the caller fall back to the un-extracted path rather than eating into the
 *  operator's patience before the real (expensive) 3× fan-out even starts. */
export const BRIEF_EXTRACTION_TIMEOUT_MS = 18_000;

const BRIEF_JSON_CONTRACT = [
  '{',
  '  "occasion": string,      // what the board is for, a few words',
  '  "headline": string,      // the single headline the board should carry, in the venue voice',
  '  "items": string[],       // concrete items/offers/features (menu items+prices, bullet points) — [] if none apply',
  '  "dateTime": string,      // a date/time/schedule the board implies — "" if none',
  '  "tone": string,          // one or two words: playful | premium | urgent | warm | bold | calm | ...',
  '  "callToAction": string,  // e.g. "Order now" — "" if none implied',
  '}',
].join('\n');

/** Build the system+user prompt pair for the brief-extraction call. Small,
 *  cheap, deterministic-leaning (the caller sets a low temperature via the
 *  normal dispatch path — this module only builds text). */
export function buildBriefExtractionSystemPrompt(): string {
  return [
    'You read a signage operator\'s short brief and extract a STRUCTURED reading of what they actually want — nothing more. You are NOT designing anything; you are disambiguating the request so a downstream designer never misreads it.',
    '',
    'OUTPUT CONTRACT — return ONLY raw JSON matching this exact shape, no markdown fences, no commentary:',
    BRIEF_JSON_CONTRACT,
    '',
    'RULES:',
    '- Extract only what the brief actually implies. NEVER invent a date, price, or item that is not stated or strongly implied — leave the field empty ("" or []) instead of guessing.',
    '- "items" holds concrete, nameable things (menu items, prices, features, session names) — not vague filler like "great food".',
    '- Keep every field terse (a few words to one short sentence). This is a disambiguation summary, not a copy draft.',
    '- If the brief is already crisp and unambiguous, your job is still to structure it faithfully — do not editorialize or add detail beyond the brief.',
  ].join('\n');
}

export function buildBriefExtractionUserPrompt(opts: { prompt: string; vertical?: string; content?: string }): string {
  const lines = [`Operator's brief: ${opts.prompt}`];
  if (opts.vertical) lines.push(`Vertical: ${opts.vertical}.`);
  if (opts.content) lines.push('', 'Content already supplied (use this to fill items/dateTime, do not contradict it):', opts.content);
  lines.push('', 'Return ONLY the JSON object.');
  return lines.join('\n');
}

/**
 * Defensively parse the model's brief-extraction reply. Returns null on ANY
 * malformed / unusable output so the caller can fall back to generating
 * exactly as it did before this feature existed — this pass must NEVER be
 * able to break or block a generation.
 */
export function parseDesignerBrief(raw: unknown): DesignerBrief | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let text = raw.trim();
  // Strip accidental markdown fences.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If the model prepended/appended prose, cut to the outermost {...}.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  text = text.slice(start, end + 1);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 400) : '');
  const items = Array.isArray(parsed.items)
    ? parsed.items.filter((i: unknown) => typeof i === 'string' && i.trim()).map((i: string) => i.trim().slice(0, 200)).slice(0, 30)
    : [];
  const brief: DesignerBrief = {
    occasion: str(parsed.occasion),
    headline: str(parsed.headline),
    items,
    dateTime: str(parsed.dateTime),
    tone: str(parsed.tone),
    callToAction: str(parsed.callToAction),
  };
  // Require at least SOME signal — an all-empty brief carries no value over
  // skipping extraction, and likely means the model returned garbage.
  if (!brief.occasion && !brief.headline && !brief.items.length && !brief.dateTime && !brief.tone && !brief.callToAction) {
    return null;
  }
  return brief;
}

/** Re-validate a CLIENT-supplied brief object (the brief-echo confirm chips
 *  round-trip through the browser) with the exact same shape rules as the
 *  parser above, so a tampered/malformed client payload can never inject
 *  oversized or wrong-typed fields into the designer prompt. Returns null
 *  (never throws) on anything unusable — caller falls back to extracting
 *  fresh / generating unextracted. */
export function sanitizeClientDesignerBrief(input: unknown): DesignerBrief | null {
  if (!input || typeof input !== 'object') return null;
  return parseDesignerBrief(JSON.stringify(input));
}

/** Format a confirmed brief into the designer user-prompt as an authoritative
 *  reading the model must honor (distinct from the raw free-text `prompt`,
 *  which stays too as color/voice context). */
export function formatBriefForPrompt(brief: DesignerBrief): string {
  const lines: string[] = ['CONFIRMED BRIEF (a structured reading of the operator\'s request — authoritative for WHAT to include; the free-text brief above is supporting color and voice). It OUTRANKS the venue type: where this brief and a usual board for that kind of venue disagree, build THIS brief\'s board. It does not add facts — a price or date appears only if it is written here or in the content above (the FACTS rule):'];
  if (brief.occasion) lines.push(`- Occasion: ${brief.occasion}`);
  if (brief.headline) lines.push(`- Headline direction: ${brief.headline}`);
  if (brief.items.length) lines.push(`- Feature these items/offers: ${brief.items.join('; ')}`);
  if (brief.dateTime) lines.push(`- Date/time: ${brief.dateTime}`);
  if (brief.tone) lines.push(`- Tone: ${brief.tone}`);
  if (brief.callToAction) lines.push(`- Call to action: ${brief.callToAction}`);
  return lines.join('\n');
}
