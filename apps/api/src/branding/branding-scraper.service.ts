/**
 * BrandingScraperService — static fast-path (Tier A) scraper that
 * extracts a tenant's visual brand from a public website URL. This is
 * the guts of the "paste your school's URL and our CMS looks like
 * your school" flagship feature.
 *
 * Security posture: every outbound fetch flows through `safeFetch`
 * (SSRF-guarded). Inputs are bounded (byte cap, timeout, redirect
 * count, stylesheet count cap). This service NEVER persists — it
 * produces a BrandingPreview DTO the caller (controller) can show
 * to the user before they adopt it.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

import { safeFetch, SsrfError } from './safe-fetch';
import { parseColor, derivePalette, contrastRatio, wcagGrade, relativeLuminance, DerivedPalette, ContrastReport } from './color-utils';
import { matchGoogleFont, buildGoogleFontsUrl } from './google-fonts';
import {
  scoreLogoCandidate,
  ensureSurvivor,
  photoSignalDemotion,
  brandKeysFrom,
  logoSignalBonus,
  capIconsBelowRealLogo,
  decodedPhotoDemotion,
} from './logo-filters';
import {
  extractSvgColors,
  dominantColorsFromRgba,
  averageOpaqueLuminance,
  paletteFromLogoColors,
  suggestLogoBackground,
  svgInkLuminance,
  imagePixelStats,
  looksPhotographic,
  LogoBackground,
} from './logo-colors';
import {
  isPlaceholderImageUrl,
  largestSrcsetCandidate,
  originalImageUrl,
  SrcsetCandidate,
} from './image-url';

// ── Types (also exported to the web via api-types later) ──────────

export interface RankedColor {
  hex: string;
  score: number;
  weight: number;
  occurrences: number;
  sampleSelector?: string;
  isCustomProp?: boolean;
}

export interface RankedFont {
  family: string;
  googleFont: string | null;
  score: number;
  occurrences: number;
  weightsSeen: number[];
  role: 'heading' | 'body' | 'either';
}

export interface LogoCandidate {
  url: string;
  kind: 'icon' | 'apple-touch' | 'mask' | 'og' | 'twitter' | 'img-logo' | 'img-wordmark' | 'svg-inline';
  score: number;
  area?: number;
  width?: number;
  height?: number;
  isSvg?: boolean;
  svgInline?: string;
  /**
   * The mark's own dominant chromatic colors, most-covering first
   * (2026-08-25 — "colors that dont look good with the logo"). Populated
   * for the top few candidates only; `[]` means monochrome, `undefined`
   * means we never analyzed this one. The wizard re-derives the palette
   * from THIS array when the operator picks a different candidate, so the
   * client can never disagree with what the server would have derived.
   */
  brandColors?: string[];
  /** Best-guess backdrop for this mark — the 3rd picker's default. */
  logoBackground?: LogoBackground;
  /** Mean luminance of the mark's opaque ink (0..1), when known. */
  inkLuminance?: number;
  /** Why this candidate was demoted, if it was. Diagnostics only. */
  filterReasons?: string[];
  /**
   * The decoded pixels read as a PHOTOGRAPH, not a mark (2026-09-22 — the
   * Super Taco apple-touch-icon was a crop of a food photo). Such a candidate
   * never supplies the brand palette.
   */
  photographic?: boolean;
  /**
   * Evidence this is THE site's logo, not just a logo-named image: it sits in
   * the header / nav / banner, links to the home page, or is named after the
   * brand. Only a header mark pushes favicons and share cards aside.
   */
  headerMark?: boolean;
}

export interface HeroCandidate {
  url: string;
  alt?: string;
  /** The page's width/height ATTRIBUTES — a display box, not pixels. */
  width?: number;
  height?: number;
  /** The image's true size where the page states it (Wix `data-image-info`). */
  naturalWidth?: number;
  naturalHeight?: number;
  /** The biggest `w` descriptor in the image's srcset. */
  srcsetWidth?: number;
  /** `url` is a loading placeholder (e.g. a Wix `blur_2` LQIP) — use its CDN original. */
  placeholder?: boolean;
  kind: 'og' | 'twitter' | 'large-img';
  score: number;
}

/**
 * Pull a brand name out of a multi-segment SEO <title>.
 *
 * Many homepages have NO og:site_name and a <title> like
 *   "Pizza Delivery & Carryout, Pasta, Wings & More | Domino's"
 * where the real brand is the short trailing segment. The earlier
 * suffix-stripper (cleanTitleString) only removes GENERIC suffixes
 * ("| Home", "| Official Site"), so a real brand after the pipe survived
 * and the long SEO phrase got stored as the display name (the recurring
 * "can't brand Domino's" bug — verified 2026-06-01 against the live row).
 *
 * Deliberately conservative — a bad guess is worse than the raw title:
 * split on separators, keep "brand-like" segments (no comma, ≤4 words,
 * not a domain, not a generic word, 2–30 chars). If og:site_name matches a
 * segment use it; else if there are brand-like segments return the SHORTEST;
 * otherwise return the input unchanged (single-segment names are untouched).
 */
export function pickBrandSegment(name: string | null | undefined, ogSiteName?: string | null): string | null {
  if (!name) return name ?? null;
  // Bare-domain names (an og:site_name like "Nike.com") → drop the TLD → "Nike".
  const bare = name.trim().match(/^([A-Za-z0-9][A-Za-z0-9-]*)\.(com|net|org|io|co|app|us|biz|store|shop)$/i);
  if (bare) return bare[1];
  // Separators: pipe / bullet / en-em dash, a spaced hyphen " - ", and a
  // colon+space ": " — so "McDonald's: Burgers…" and "Target : Expect…" split
  // to the brand, while a time like "10:30 Diner" (no space after the colon)
  // does NOT split.
  const parts = name.split(/\s*[|•·–—]\s*|\s+-\s+|:\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return name; // no separator → leave it alone
  const looksDomain = (s: string) => /^www\./i.test(s) || /\.(com|net|org|io|app|co|gov|edu|biz|us)\b/i.test(s);
  const isGeneric = (s: string) =>
    /^(home|welcome|official site|official website|home page|menu|order online|the official site|official)$/i.test(s);
  const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const brandLike = parts.filter(
    (p) => !p.includes(',') && wordCount(p) <= 4 && !looksDomain(p) && !isGeneric(p) && p.length >= 2 && p.length <= 30,
  );
  if (brandLike.length === 0) return name; // nothing clearly a brand → unchanged
  if (ogSiteName) {
    const match = brandLike.find((p) => p.toLowerCase() === ogSiteName.trim().toLowerCase());
    if (match) return match;
  }
  return brandLike.slice().sort((a, b) => a.length - b.length)[0];
}

export interface BrandingPreview {
  sourceUrl: string;
  finalUrl: string;
  displayName: string | null;
  tagline: string | null;
  /**
   * Business descriptor — "what this venue IS / sells" (e.g. Domino's:
   * "Pizza Delivery & Carryout, Pasta, Wings & More"). Distinct from
   * `tagline` (which is deduped/boilerplate-filtered for the branding
   * wizard): this keeps the raw descriptor EVEN IF it overlaps the name,
   * because the AI template generator needs the business TYPE so it doesn't
   * invent the wrong cuisine (the 2026-06-29 "Domino's -> burger menu"
   * failure: the scrape knew the name + colors but never "pizza").
   */
  description: string | null;
  /**
   * The brand's REAL on-page headlines/positioning (h1 + section h2/h3),
   * deduped + boilerplate-filtered. Feeds the AI template generator the
   * actual brand voice + the services/industries it names, so a generated
   * board REPRESENTS the business instead of inventing generic copy.
   */
  keyMessages: string[];
  logos: LogoCandidate[];
  favicon: string | null;
  ogImage: string | null;
  colors: RankedColor[];
  palette: DerivedPalette;
  /**
   * WCAG contrast adjustments applied to `palette.primary` /
   * `palette.accent`. Mirror of `palette.contrastReport` lifted to
   * the top level so the wizard UI can render a "we adjusted
   * your yellow for legibility — undo?" panel without descending
   * into the palette object.
   */
  contrastReport: ContrastReport;
  /**
   * Backdrop treatment for the tenant logo — the wizard's THIRD picker
   * (2026-08-25: "just add another picker like we already have just have
   * 3 now"). Server picks the best default for the top logo candidate;
   * the operator can override. Persisted inside `palette.logoBackground`
   * (a Json column key — no schema change).
   */
  logoBackground: LogoBackground;
  /** Where palette.primary/accent came from: the mark, the page, or both. */
  paletteSource: 'logo' | 'logo+page' | 'page';
  fonts: {
    heading: RankedFont | null;
    body: RankedFont | null;
    all: RankedFont[];
  };
  fontsCssUrl: string | null;
  heroImages: HeroCandidate[];
  confidence: {
    logo: number;      // 0..1
    palette: number;
    fonts: number;
    displayName: number;
    overall: number;
  };
  warnings: string[];
  rawSnapshot: unknown; // for re-derive
  scrapedAt: string;
  durationMs: number;
}

// ── Selector weight table ─────────────────────────────────────────
// Selectors that imply "brand color" get higher weights. Tuned empirically
// from real K-12 district sites.

// ── Third-party widget CSS (2026-09-16) ──────────────────────────────────
//
// Greg adopted https://www.nba.com/kings/ and got a slate-grey brand. The
// winning color came from `.vjs-loading-spinner` — Video.js's LOADING SPINNER
// — and the winning FONT was "VideoJS" on 39 occurrences. A page that embeds a
// video player ships that player's whole stylesheet, so its chrome can out-mass
// the brand's own colors on occurrence count alone.
//
// Demote, never hard-reject (same rule as the near-white demotion above): a
// site whose ONLY colors come from a bundled widget should still get something
// rather than nothing.
const LIBRARY_SELECTOR =
  /(^|[\s,>+~])\.?(vjs|video-js|videojs|plyr|jwplayer|mejs|flowplayer|slick|swiper|owl-carousel|fancybox|lightbox|tox-|cke_|select2|pika|flatpickr|leaflet|mapbox|recaptcha|grecaptcha)[-_a-z0-9]*/i;
const LIBRARY_SELECTOR_DEMOTION = 0.12;

/** Families shipped BY a widget library — never the site's typography. */
const LIBRARY_FONT = new Set([
  'videojs',
  'video-js',
  'vjs',
  'vjs-icons',
  'videojs-icons',
  'plyr',
  'jwplayer',
  'mejs',
  'flowplayer',
  'swiper-icons',
  'revicons',
]);

const SELECTOR_WEIGHTS: Array<[RegExp, number]> = [
  [/(^|\s|,)(nav|header)[\s,>{]/i, 2.5],
  [/\.(navbar|site-header|main-header|top-bar|masthead)/i, 2.5],
  [/\[class\*=["']primary/i, 3],
  [/\[class\*=["']brand/i, 3],
  [/\.btn-primary|\.button-primary|\.primary-btn/i, 3],
  [/\.(logo|wordmark|mark|brand)/i, 2.5],
  [/\.(cta|hero|banner)/i, 2],
  [/a(:hover|:focus)?/i, 1.2],
  [/button/i, 2],
  [/body/i, 0.6],
  [/\.footer|footer/i, 0.9],
];

// CSS custom props named these get massive boost — designers literally
// label them as the brand.
const BRAND_CUSTOM_PROP = /^--(brand|primary|accent|theme|site|school|color-primary|color-brand|color-accent|main|action)/i;
const HEADING_CUSTOM_PROP = /^--(font-heading|heading-font|font-display|display-font|font-primary)/i;
const BODY_CUSTOM_PROP = /^--(font-body|body-font|font-base|font-sans|font-text)/i;

// Ignore near-black / near-white / fully-transparent — these are noise.
const NOISE_HEX = new Set([
  '#000000', '#ffffff', '#111111', '#222222', '#333333',
  '#f0f0f0', '#f5f5f5', '#fafafa', '#eeeeee', '#cccccc',
  '#999999', '#666666', '#777777', '#888888', '#aaaaaa', '#bbbbbb',
]);

function isNoiseColor(hex: string): boolean {
  if (NOISE_HEX.has(hex)) return true;
  // Near-greyscale detection
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 12) return true;                 // near-grey
  return false;
}

// ── Background-ish color demotion (2026-07-21 VisionCore incident) ────────
//
// The scraper stored a Wix site's page BACKGROUND (#fcf9e2 cream) as
// palette.primary: background declarations carry the highest prop weight
// (1.5) and a page-wide canvas color appears in dozens of rules, so the
// cream out-scored the real saturated brand color on occurrences alone. A
// near-white is almost never the brand primary — it's the canvas the brand
// sits ON.
//
// Demote, never hard-reject (some brands are legitimately pale, and when no
// saturated candidate exists the pale one must still win): any color whose
// WCAG relative luminance exceeds 0.8 has its per-hit weight scaled down —
// hardest when the hit came from a background-ish declaration
// (background*/bgcolor), mildly elsewhere. The ramp reaches its floor by
// luminance ≈0.92, so true near-whites (cream 0.94, ivory, eggshell) are
// decisively out-scored by ANY saturated mid-lightness candidate.

const BACKGROUNDISH_LUM_THRESHOLD = 0.8;

export function backgroundishColorDemotion(hex: string, isBackgroundContext: boolean): number {
  const lum = relativeLuminance(hex);
  if (lum <= BACKGROUNDISH_LUM_THRESHOLD) return 1;
  const t = Math.min(1, (lum - BACKGROUNDISH_LUM_THRESHOLD) / 0.12);
  const floor = isBackgroundContext ? 0.1 : 0.4;
  return 1 - t * (1 - floor);
}

// ── Font-family sanitization (2026-07-21 VisionCore incident) ─────────────
//
// The same scrape persisted font_heading = ")" and rankedFonts entries like
// "))" and "var(--hover-font": the `font:` shorthand extractor + the naive
// comma-split mangle CSS var() indirections into paren fragments. The web
// injector's FONT_RE keeps them out of the style tag (inert), but they must
// never be STORED as a brand font in the first place. A real font family
// name is short and alphanumeric-ish; anything else returns null.

const FONT_FAMILY_NAME_RE = /^[a-z0-9][a-z0-9 '&.-]{1,39}$/i;

/**
 * Reduce a raw font-family value to a single clean family name, or null.
 * Takes the FIRST family in a comma list, strips quotes, collapses
 * whitespace; rejects var() indirections, paren fragments, and anything
 * outside FONT_FAMILY_NAME_RE. Applied at capture time (fontHeading /
 * fontBody / rankedFonts all flow from there) AND at the adopt persist
 * boundary in branding.controller.ts (client round-trips are untrusted).
 */
export function sanitizeFontFamilyName(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const first = raw
    .split(',')[0]
    .replace(/^\s*['"]+|['"]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!first) return null;
  if (/var\(/i.test(first) || first.includes('(') || first.includes(')')) return null;
  if (!FONT_FAMILY_NAME_RE.test(first)) return null;
  return first;
}

/**
 * Normalize an operator-typed site URL. They shouldn't have to type the scheme —
 * "riotcolor.com" must work, not only "https://riotcolor.com". Without this,
 * new URL()/safeFetch throw on a scheme-less string and the scrape fails with a
 * misleading "couldn't read that site" error and no reason (2026-06-30 report:
 * http:// worked, a bare domain errored). Prepend https:// when no http(s)
 * scheme is present; leave a valid scheme untouched.
 */
/**
 * Condense a scraped tagline to something that actually FITS the sidebar.
 *
 * 2026-08-25 — operator: "cap the tagline so it fits what looks good". The
 * candidate filter accepts up to 160 chars because a long meta description is
 * still a legitimate SOURCE, but the sidebar rail renders ~32 chars per line
 * at 11px, so a 150-char marketing paragraph clipped mid-phrase with the rest
 * reachable only by hover — which on a touch panel is not reachable at all.
 *
 * Two steps, in order, because a clean sentence beats a clean cut:
 *   1. Take the FIRST SENTENCE when the text has one and it earns its place
 *      (>= MIN so we never reduce a tagline to "Since 1974.").
 *   2. If that is still long, trim at the last WORD boundary under the cap and
 *      add an ellipsis — never mid-word, never mid-"don't".
 *
 * The result is what gets stored, so the sidebar's `title` tooltip matches the
 * visible text instead of hiding half of it. The operator can always type a
 * different tagline in the branding wizard; this only decides the DEFAULT.
 */
export const TAGLINE_DISPLAY_MAX = 90;
const TAGLINE_SENTENCE_MIN = 24;

export function condenseTagline(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= TAGLINE_DISPLAY_MAX) return text;

  // 1. First sentence — terminator followed by a space (so "U.S. Bank" and
  // "3.5 stars" don't split) or sitting at the very end of the string.
  const sentence = text.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim();
  if (sentence && sentence.length >= TAGLINE_SENTENCE_MIN && sentence.length <= TAGLINE_DISPLAY_MAX) {
    return sentence;
  }

  // 2. Word-boundary trim. Slice one past the cap so a word ENDING exactly at
  // the cap is kept whole rather than eaten by the lastIndexOf.
  const slice = text.slice(0, TAGLINE_DISPLAY_MAX + 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = (lastSpace > TAGLINE_SENTENCE_MIN ? slice.slice(0, lastSpace) : text.slice(0, TAGLINE_DISPLAY_MAX)).trim();
  // Drop trailing punctuation that reads badly right before an ellipsis.
  return `${cut.replace(/[\s,;:._-]+$/, '')}\u2026`;
}

export function normalizeWebUrl(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/+/, '');
}

@Injectable()
export class BrandingScraperService {
  private readonly logger = new Logger(BrandingScraperService.name);

  /** Scrape a URL and return a BrandingPreview. Throws on SSRF / fetch errors. */
  async scrape(url: string, budgetMs = 10_000): Promise<BrandingPreview> {
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    const remaining = () => Math.max(500, deadline - Date.now());

    const warnings: string[] = [];

    // 1. Fetch the HTML.
    //
    // UA matters here — a browser UA gets us past Cloudflare's default
    // ruleset, which otherwise answers a 403 block page or the "Just a
    // moment…" JS challenge that cheerio would parse as the real page.
    //
    // Operator (2026-05-25): "i tried to use the sample LAUSD link
    // for branding and it gave me some crazy cloud flare error."
    //
    // This used to carry its own inline copy of the Chrome UA because the
    // safeFetch DEFAULT was a crawler string. That split was the 2026-09-16
    // logo bug: the scrape (this call) got through, and the re-host of the
    // logo it found did not. The default IS this UA now, so the override is
    // gone — see DEFAULT_USER_AGENT in safe-fetch.ts for the measurements.
    const htmlRes = await safeFetch(url, {
      timeoutMs: Math.min(remaining(), 10_000),
      maxBytes: 5 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    const html = htmlRes.body.toString('utf-8');

    // Cloudflare-block detection. Even with a browser UA, some sites
    // serve the JS challenge OR an outright block page. Cheerio would
    // parse that as the "real" page and produce empty / nonsense
    // branding. Recognize the standard signatures and throw a
    // recognizable error so handleScrapeError can surface friendly
    // copy to the operator.
    if (
      htmlRes.status === 403 ||
      /Just a moment\.\.\.|<title>Attention Required! \| Cloudflare<\/title>|cf-browser-verification|cf-challenge-running|Sorry, you have been blocked|cloudflare\.com\/5xx-errors/i.test(
        html.slice(0, 10000),
      )
    ) {
      const err: any = new Error(
        // Plain text — this string is rendered as-is in the wizard (not JSX),
        // so NO HTML entities (a literal "&rsquo;" showed up on screen). Also
        // vertical-neutral: this is multi-vertical, the tenant may be a
        // business, not a school. Cloudflare protection is intermittent, so a
        // site that scraped fine before can be challenged on a later retry —
        // that's expected, not a misconfiguration.
        'This site blocks automated tools (Cloudflare bot protection), which can ' +
          'happen intermittently even on a site that scanned fine before. ' +
          'Try a smaller sub-page (e.g. the About or Contact page), or just upload ' +
          'your logo + pick colors manually — no scan needed.',
      );
      err.name = 'BotProtectionError';
      err.status = htmlRes.status;
      throw err;
    }

    const $ = cheerio.load(html);
    const finalUrl = htmlRes.finalUrl;
    const pageOrigin = new URL(finalUrl).origin;
    const absolutize = (href: string | undefined): string | null => {
      if (!href) return null;
      try { return new URL(href, finalUrl).toString(); } catch { return null; }
    };

    // Operator-reported bug 2026-04-27: pasting a school URL where the
    // homepage uses lazy-loaded images returned a brand kit with no
    // hero/top images. Real cause: scraper only checked `src` and
    // `data-src`, missing the WPRocket-specific `data-lazy-src` and
    // a half-dozen other lazy-load attribute variants used in the
    // wild (jQuery LazyLoad, BLazy, Verlok, etc).
    //
    // bestImageSrc tries every known attribute in priority order,
    // skips obvious 1x1/SVG placeholders, and falls back to picking
    // the largest URL from a srcset descriptor. Returns null if
    // nothing usable was found.
    //
    // 2026-09-22 — the BIGGEST srcset candidate now wins over `src` (a page's
    // `src` is the 1x / phone rendition), and srcsets are parsed the way a
    // browser parses them: Wix URLs carry commas INSIDE the URL
    // (`w_35,h_35,al_c`), which the old `split(',')` cut in half. Placeholder
    // detection is shared with the designer-asset resolver (image-url.ts) and
    // now knows Wix `blur_N` LQIPs, `?blur=` and Cloudinary `e_blur`.
    const isPlaceholder = (src: string): boolean => isPlaceholderImageUrl(src);
    const bestSrcsetOf = (
      $el: cheerio.Cheerio<any>,
    ): SrcsetCandidate | null => {
      for (const attr of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
        const v = $el.attr(attr);
        if (!v) continue;
        const best = largestSrcsetCandidate(v);
        if (best) return best;
      }
      return null;
    };
    const bestImageSrc = ($el: cheerio.Cheerio<any>): string | null => {
      const fromSrcset = bestSrcsetOf($el);
      if (fromSrcset) {
        const abs = absolutize(fromSrcset.url);
        if (abs) return abs;
      }
      // Direct src wins UNLESS it's a known placeholder pattern (in
      // which case we know the real URL is in a lazy-load attribute).
      const direct = $el.attr('src') || '';
      if (direct && !isPlaceholder(direct)) return absolutize(direct);

      // Lazy-load attribute fallbacks (priority order — WPRocket and
      // generic LazyLoad first, others by historical popularity).
      for (const attr of [
        'data-lazy-src',     // WPRocket
        'data-src',          // generic LazyLoad / Verlok / BLazy
        'data-original',     // jQuery Lazy Load (Mika Tuupola)
        'data-lazyload-src', // some custom plugins
        'data-lazy',
        'data-img',
        'data-bg',           // sometimes used for img tags
      ]) {
        const v = $el.attr(attr);
        if (v && !isPlaceholder(v)) return absolutize(v);
      }

      // (Srcset variants — including data-srcset — were tried first, above.)

      // Last resort — return the placeholder src so we at least know
      // there WAS an image. The downstream filter at the rehost step
      // will skip if it's truly broken.
      return absolutize(direct);
    };

    // 2. Metadata: display name, tagline, og/twitter images.
    //
    // 2026-05-26 — operator caught "Pizza Delivery &amp; Carryout"
    // rendering literally in the sidebar after scraping dominos.com.
    // Cheerio's `.attr('content')` returns the RAW attribute value —
    // HTML entities are NOT decoded. So `<meta property="og:title"
    // content="Pizza Delivery &amp; Carryout">` came back as the
    // literal string "Pizza Delivery &amp; Carryout" and got stored.
    // The wizard's input field happens to render decoded (some path
    // through React JSX), but the sidebar's <h1> + the rest of the
    // chrome shows the raw entity. Fix: decode HTML entities on EVERY
    // meta-attribute read at the source — one helper, all callers.
    //
    // Common entities the scraper hits in the wild (in priority order):
    //   &amp; → &  /  &#38; → &
    //   &lt; → <   /  &#60; → <
    //   &gt; → >   /  &#62; → >
    //   &quot; → " /  &#34; → "
    //   &#39; → '  /  &apos; → '  /  &rsquo; → '
    //   &nbsp; → (space)
    //   &ldquo; / &rdquo; → " / "
    // Use cheerio's text-decoding by routing through a hidden element,
    // OR a tiny manual decoder. Manual is more deterministic.
    const decodeEntities = (s: string | undefined | null): string | undefined => {
      if (!s) return s ?? undefined;
      return s
        .replace(/&amp;|&#38;/gi, '&')
        .replace(/&lt;|&#60;/gi, '<')
        .replace(/&gt;|&#62;/gi, '>')
        .replace(/&quot;|&#34;/gi, '"')
        .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
        .replace(/&ldquo;|&rdquo;/gi, '"')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&ndash;/gi, '–')
        .replace(/&mdash;/gi, '—')
        // Generic numeric entities (decimal + hex) for anything we
        // didn't list above (e.g. &#8211; em-dash, &#x2019; smart
        // apostrophe). Limit to 4 hex digits / 5 decimal digits as a
        // bound so a maliciously crafted &#9999999; can't OOM us.
        .replace(/&#(\d{1,5});/g, (_, d) => {
          const code = parseInt(d, 10);
          return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        })
        .replace(/&#x([0-9a-f]{1,4});/gi, (_, h) => {
          const code = parseInt(h, 16);
          return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        });
    };
    const ogSiteName = decodeEntities($('meta[property="og:site_name"]').attr('content')?.trim());
    const ogTitle = decodeEntities($('meta[property="og:title"]').attr('content')?.trim());
    const twitterTitle = decodeEntities($('meta[name="twitter:title"]').attr('content')?.trim());
    // <title> uses .text() which DOES decode entities — but routing
    // through decodeEntities is idempotent and defensive against any
    // cheerio version that ever changes that contract.
    const pageTitle = decodeEntities($('title').first().text().trim()) || '';
    // 2026-05-25 — operator: "is the name and tagline really what we
    // found? cant we do better than this?" — scraping mlb.com/dodgers
    // returned name="MLB.com" (og:site_name) when "Los Angeles Dodgers"
    // (og:title) is what the operator obviously wanted.
    //
    // Improvements vs. before:
    //  1. Build cleanedTitle by ALSO stripping any "| <ogSiteName>"
    //     or "- <ogSiteName>" suffix from the page <title>. So
    //     "Los Angeles Dodgers | MLB.com" → "Los Angeles Dodgers".
    //  2. For sub-path URLs (URL path !== "/"), prefer the page-
    //     specific title (ogTitle / cleanedTitle) over the site-wide
    //     ogSiteName, because the operator is intentionally pointing
    //     us at the team/section, not the site.
    //  3. For root URLs (URL path === "/"), keep the old order —
    //     ogSiteName is right when scraping the homepage.
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 2026-05-25 — operator on the preview: "the sample view looks good
    // but the preview looks bad" — mlb.com/dodgers returned the
    // bloated og:title "Official Los Angeles Dodgers Website | MLB.com"
    // and we routed it straight to displayName, sidebar, and the
    // "Welcome back to ..." preview hero. Cleanup helper now applies
    // to EVERY title candidate (ogTitle/twitterTitle/pageTitle), not
    // just <title>:
    //   1. Strip site-name suffix ("| MLB.com")
    //   2. Strip generic boilerplate suffix
    //      ("| Home", "| Welcome", "| Official Site", "| Home Page")
    //   3. Strip filler words around the brand:
    //      - leading "The ", "Official " (e.g. "Official Los Angeles
    //        Dodgers Website" → "Los Angeles Dodgers Website")
    //      - trailing " Website", " Official Site", " Home Page",
    //        " Home" (→ "Los Angeles Dodgers")
    //   4. Final trim of leftover hanging separators
    const cleanTitleString = (raw: string | null | undefined): string => {
      if (!raw) return '';
      let s = raw;
      // Strip site-name suffix first since it's the most reliable
      // signal that everything after the pipe is metadata, not name.
      if (ogSiteName) {
        s = s.replace(new RegExp(`\\s*[|\\-–—]\\s*${escapeRe(ogSiteName)}\\s*$`, 'i'), '');
      }
      // Generic suffix: "X | Home", "X – Welcome", etc.
      s = s.replace(/\s*[|\-–—]\s*(Home|Welcome|Official Site|Home Page|Official Website|Official|The Official Site)\b.*$/i, '');
      // Trailing filler words attached to the brand name itself.
      s = s.replace(/\s+(Official Website|Official Site|Home Page|Website)\s*$/i, '');
      // Leading filler — "Official " / "The Official " prefix.
      s = s.replace(/^(The\s+)?Official\s+/i, '');
      // Stray hanging separator at the end.
      s = s.replace(/\s*[|\-–—]\s*$/g, '');
      return s.trim();
    };
    const cleanedTitle = cleanTitleString(pageTitle);
    const cleanedOgTitle = cleanTitleString(ogTitle);
    const cleanedTwitterTitle = cleanTitleString(twitterTitle);
    const hostDerivedName = (() => {
      try {
        const h = new URL(finalUrl).hostname.replace(/^www\./, '');
        const root = h.split('.').slice(0, -1).join(' ');
        return root.split(/[-_]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      } catch { return null; }
    })();
    // hasSubpath — is the URL pointing at something deeper than the
    // bare homepage? Trailing-slash + index-style paths count as root.
    const hasSubpath = (() => {
      try {
        const p = new URL(finalUrl).pathname || '/';
        const stripped = p.replace(/\/+(index\.[a-z]+)?$/i, '');
        return stripped.length > 0 && stripped !== '';
      } catch { return false; }
    })();
    const rawDisplayName = hasSubpath
      ? (cleanedOgTitle || cleanedTwitterTitle || cleanedTitle || ogSiteName || hostDerivedName || null)
      : (ogSiteName || cleanedOgTitle || cleanedTwitterTitle || cleanedTitle || hostDerivedName || null);
    // 2026-06-01 — final pass: when the chosen name is still a multi-segment
    // SEO title (dominos.com has no og:site_name, so this lands as "Pizza
    // Delivery & Carryout, Pasta, Wings & More | Domino's"), pull out the
    // brand segment ("Domino's"). Conservative — only overrides when exactly
    // one separated segment is clearly brand-like; otherwise untouched.
    const displayName = pickBrandSegment(rawDisplayName, ogSiteName);

    // 2026-05-07 — operator: "you ask for the name and tagline, and
    // it always just picks up the name twice".
    //
    // Old logic: tagline = ogDesc || metaDesc || firstH2.
    // Problem: many school sites set og:description to the school
    // NAME (e.g. "Buena Park High School") — same string as
    // displayName. Tagline came back identical to the name.
    //
    // New heuristics, tried in order:
    //   1. og:description, IF different from displayName
    //   2. meta name=description, IF different from displayName and
    //      not just "Welcome to <name>" or "<name> Home Page" boilerplate
    //   3. Hero subtitle/motto: first <p> or <h2> inside header/banner
    //   4. "Home of the X" pattern anywhere in the page
    //   5. Schema.org slogan property if present
    //   6. null (don't fake one)
    // 2026-05-26 — same HTML-entity decode as the title path above
    // (decodeEntities defined earlier in this function).
    const metaDesc = decodeEntities($('meta[name="description"]').attr('content')?.trim());
    const ogDesc = decodeEntities($('meta[property="og:description"]').attr('content')?.trim());
    const twitterDesc = decodeEntities($('meta[name="twitter:description"]').attr('content')?.trim());
    const firstH2 = $('h2').first().text().trim();
    // Schema.org JSON-LD slogan field — many school sites have it
    const schemaSlogan = (() => {
      try {
        const ld = $('script[type="application/ld+json"]').first().html();
        if (!ld) return null;
        const parsed = JSON.parse(ld);
        return parsed?.slogan || parsed?.description || null;
      } catch { return null; }
    })();
    // Hero header text — common pattern: school motto in the masthead
    const headerHeroText = $('header p, .hero p, .banner p, [class*="motto"], [class*="tagline"], [class*="slogan"]')
      .first().text().trim();
    // Look for "Home of the X" pattern anywhere visible
    const homeOfMatch = $('body').text().match(/\b(Home of (?:the )?[A-Z][\w\s]{2,40}?)(?:[.!]|\s*$|\s*\n)/);
    const homeOf = homeOfMatch?.[1]?.trim() || null;

    // KEY MESSAGES — the brand's REAL on-page positioning/voice (h1 + section
    // h2/h3 headlines). Without these the AI template generator only sees a
    // one-line meta description + colors and INVENTS generic copy that
    // misrepresents the business (the 2026-06-29 riotcolor.com case: an
    // experiential-graphics brand whose site says "Branding Beyond Boundaries /
    // Spaces That Spark Discovery" came out as a generic "24-48hr banners" quick
    // print shop). Capturing the real headlines lets the generator echo the
    // brand's actual message + the industries/services it actually names.
    const keyMessages: string[] = (() => {
      const seen = new Set<string>();
      const out: string[] = [];
      $('h1, h2, h3').each((_i, el) => {
        if (out.length >= 14) return;
        const t = decodeEntities($(el).text().replace(/\s+/g, ' ').trim());
        if (!t) return;
        const norm = t.toLowerCase();
        // Skip nav/boilerplate + too-short/too-long fragments.
        if (t.length < 4 || t.length > 90) return;
        if (seen.has(norm)) return;
        if (/^(home|about|contact|menu|search|login|sign in|careers|blog|news|shop|cart|services|products|gallery|faq|more|next|previous)$/i.test(t)) return;
        seen.add(norm);
        out.push(t);
      });
      return out;
    })();

    const taglineCandidates: Array<string | null | undefined> = [
      ogDesc,
      twitterDesc,
      metaDesc,
      schemaSlogan,
      headerHeroText,
      homeOf,
      firstH2,
    ];

    // Filter out anything that's:
    //   - empty / whitespace
    //   - identical (case-insensitive, trimmed) to displayName
    //   - just "Welcome to <name>" / "<name> Home Page" boilerplate
    //   - shorter than 5 chars or longer than 160 chars
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const dnNorm = displayName ? normalize(displayName) : '';
    const isBoilerplate = (s: string) => {
      const lower = s.toLowerCase();
      return (
        /^welcome to /i.test(lower) ||
        /^home of (?:the )?[a-z]+ (?:home|website|site)$/i.test(lower) ||
        /^home page$/i.test(lower) ||
        /^official (?:site|website)$/i.test(lower) ||
        /^the official (?:site|website|page) of/i.test(lower)
      );
    };
    // 2026-05-25 — operator caught the tagline coming back as
    // "Headlines" on mlb.com/dodgers. That's not a tagline — it's a
    // nav-section label that landed in `firstH2`. A real tagline is
    // a sentence, not a section header. Reject any candidate that's
    // a single-word common section label.
    const isSectionLabel = (s: string) => {
      const trimmed = s.trim();
      if (/\s/.test(trimmed)) return false; // multi-word → keep
      return /^(headlines?|news|schedule|scores?|roster|stats?|standings?|about|contact|home|menu|shop|store|gallery|photos?|videos?|tickets?|subscribe|login|search|more|live|events?|teams?|players?|results?|recap)$/i.test(trimmed);
    };
    // 2026-06-08 — beta customer ARC Imaging scraped a tagline of
    // "Shopping Cart: 0 Items" (the site's cart widget text, full of literal
    // \n\t). A tagline is a slogan, never e-commerce / nav chrome. Reject the
    // common cart / account / nav-control strings so they never reach the
    // sidebar. (The whitespace-collapse below also kills the \n\t runs that
    // made it render as a broken multi-line blob.)
    const isEcommerceJunk = (s: string) => {
      const lower = s.toLowerCase();
      return (
        /shopping cart|add to cart|your cart|view cart|empty cart|cart\s*:?\s*\d|\b\d+\s*items?\b|checkout|sign\s?in|log\s?in|create account|my account|wishlist|free shipping|skip to (?:main )?content|toggle (?:nav|menu)|main menu|search\.\.\.|view all|read more/i.test(lower)
      );
    };
    const taglineRaw = taglineCandidates
      // Collapse internal whitespace (scraped hero/cart text is riddled with
      // \n\t runs) BEFORE length + content checks so they operate on clean text.
      .map((s) => s?.replace(/\s+/g, ' ').trim())
      .filter((s): s is string => !!s && s.length >= 5 && s.length <= 160)
      .filter((s) => !dnNorm || normalize(s) !== dnNorm)
      .filter((s) => !isBoilerplate(s))
      .filter((s) => !isSectionLabel(s))
      .filter((s) => !isEcommerceJunk(s))
      .filter((s) => !dnNorm || !normalize(s).startsWith(dnNorm)) // "BPHS - Home of..." → strip "BPHS" prefix elsewhere; here just reject equal-prefix cases
      [0] || null;
    // Shorten the winner to what the sidebar can actually show (see
    // condenseTagline). Selection above still sees the FULL text, so a long
    // meta description can still win on merit — it just doesn't ship long.
    const tagline = condenseTagline(taglineRaw);

    const ogImage = absolutize($('meta[property="og:image"]').attr('content'));
    const twitterImage = absolutize($('meta[name="twitter:image"]').attr('content'));

    // 3. Logo candidates.
    const logos: LogoCandidate[] = [];
    const rejectedLogos: LogoCandidate[] = [];
    const seenLogoUrls = new Set<string>();
    // Host of the page we're scraping — the "unless the tenant IS that
    // company" guard for the third-party-host reject (logo-filters.ts).
    const siteHost = (() => {
      try { return new URL(finalUrl || url).hostname.toLowerCase(); } catch { return ''; }
    })();
    // 2026-09-22 — what the brand is CALLED, to recognise a logo file named
    // after it (`super_taco_logo_(1).png`) over a badge beside it
    // (`BOSLogo19_edited.png`, "Best of Sacramento").
    const brandKeys = brandKeysFrom(displayName, ogSiteName, hostDerivedName);
    // A logo wrapped in a link to the site's own home page is the textbook
    // header mark; an award badge links elsewhere or nowhere.
    const homeHost = siteHost.replace(/^www\./, '');
    const linksToHome = ($el: cheerio.Cheerio<any>): boolean => {
      const href = $el.closest('a[href]').attr('href');
      const abs = href ? absolutize(href) : null;
      if (!abs || !homeHost) return false;
      try {
        const u = new URL(abs);
        if (u.hostname.toLowerCase().replace(/^www\./, '') !== homeHost)
          return false;
        return /^\/(?:index\.(?:html?|php)|home\/?)?$/i.test(u.pathname || '/');
      } catch {
        return false;
      }
    };
    /**
     * THE single choke point for every logo discovery path — link
     * rel=icon / apple-touch-icon, og:image, twitter:image, <img>, and
     * inline SVG. Before 2026-08-25 only the inline-SVG branch filtered
     * third-party badges, so a Pinterest icon on the base-85
     * `apple-touch-icon` path could out-rank the real brand mark (the
     * operator's screenshot). Now EVERY candidate is classified here.
     *
     * @param text alt/class/id/aria text for the photo-signal check.
     */
    const pushLogo = (c: LogoCandidate, text?: string) => {
      const k = (c.url || c.svgInline || '').slice(0, 200);
      if (!k || seenLogoUrls.has(k)) return;
      seenLogoUrls.add(k);
      const verdict = scoreLogoCandidate(
        { url: c.url, score: c.score, width: c.width, height: c.height, kind: c.kind, text },
        siteHost,
        { brandKeys },
      );
      if (verdict.reject) {
        rejectedLogos.push({ ...c, filterReasons: verdict.reasons });
        return;
      }
      logos.push(
        verdict.reasons.length
          ? { ...c, score: verdict.score, filterReasons: verdict.reasons }
          : c,
      );
    };

    const iconRelPriority: Record<string, { kind: LogoCandidate['kind']; base: number }> = {
      'apple-touch-icon': { kind: 'apple-touch', base: 85 },
      'apple-touch-icon-precomposed': { kind: 'apple-touch', base: 83 },
      'mask-icon': { kind: 'mask', base: 75 },
      'icon': { kind: 'icon', base: 70 },
      'shortcut icon': { kind: 'icon', base: 68 },
    };

    $('link[rel]').each((_, el) => {
      const rel = ($(el).attr('rel') || '').toLowerCase().trim();
      const href = absolutize($(el).attr('href') || '');
      if (!href) return;
      const prio = iconRelPriority[rel];
      if (!prio) return;
      // Prefer larger icons
      const sizes = ($(el).attr('sizes') || '').toLowerCase();
      let score = prio.base;
      if (/192|256|512/.test(sizes)) score += 12;
      else if (/144|152|167|180/.test(sizes)) score += 8;
      else if (/32|48|64/.test(sizes)) score += 2;
      pushLogo({ url: href, kind: prio.kind, score });
    });

    // og:/twitter: share cards. These are a PHOTO far more often than a
    // mark (the hydrogen-truck + airport-terminal shots in the operator's
    // 2026-08-25 screenshot came in this way), so their alt text rides
    // along to the photo-signal check in pushLogo.
    const ogImageAlt = ($('meta[property="og:image:alt"]').attr('content') || '').toLowerCase();
    const twitterImageAlt = ($('meta[name="twitter:image:alt"]').attr('content') || '').toLowerCase();
    if (ogImage) pushLogo({ url: ogImage, kind: 'og', score: 60 }, ogImageAlt);
    if (twitterImage) pushLogo({ url: twitterImage, kind: 'twitter', score: 55 }, twitterImageAlt);

    // Inline SVGs that look like the brand mark. Broader net than just
    // `header svg` because many sites put the wordmark in <a class="logo">
    // outside any header tag, or as a top-of-body element.
    $(
      // Brand-named ancestors
      '[class*="logo"] svg, [class*="brand"] svg, [class*="wordmark"] svg, [class*="masthead"] svg, [class*="navbar-brand"] svg, ' +
      // Brand-named SVGs themselves
      'svg[class*="logo"], svg[class*="brand"], svg[class*="wordmark"], ' +
      // Anchor/link wrappers commonly used on the wordmark
      'a[href="/"] svg, a[aria-label*="home" i] svg, ' +
      // Header / nav fallback
      'header > a svg, header > div > a svg, nav > a svg, [role="banner"] svg'
    ).each((_, el) => {
      const $el = $(el);
      const outer = $.html(el);
      if (!outer || outer.length > 20_000) return;

      // Reject obvious icons (star, phone, social, hamburger, search, cart, chevron).
      const ancestorCls = ($el.parents('a, button, span, div').first().attr('class') || '').toLowerCase();
      const ownCls = ($el.attr('class') || '').toLowerCase();
      const ariaLabel = ($el.attr('aria-label') || '').toLowerCase();
      const combined = `${ancestorCls} ${ownCls} ${ariaLabel}`;
      const iconHints = /(\b|-)(star|rating|phone|tel|search|cart|menu|hamburger|chevron|arrow|caret|close|facebook|twitter|instagram|youtube|linkedin|tiktok|social|share|toggle|spinner|loading|chat)\b/;
      if (iconHints.test(combined)) return;

      // 2026-05-07 — operator: "the svg logos dont display in the
      // preview window" + screenshot showed Smart Sites / Google
      // Play / App Store badges polluting the candidate list.
      //
      // Reject obvious THIRD-PARTY badges that aren't the school's
      // logo. We detect via:
      //   - Text content of the SVG (e.g. "Google Play", "App Store")
      //   - Parent <a> href pointing at known badge hosts
      //   - aria-label / class hints
      //
      // These badges are valid SVGs with shapes + viewBox that pass
      // every other check, so they need their own filter.
      const svgText = $el.text().toLowerCase();
      const parentHref = ($el.parents('a').first().attr('href') || '').toLowerCase();
      const thirdPartyBadgeText = /\b(google play|app store|microsoft store|amazon appstore|huawei appgallery|samsung galaxy store|smart\s*sites|powered by|made by|hosted by|finalsite|blackboard|schoolwires|schoolmessenger|edlio|apptegy|e\s*chalk)\b/i;
      const thirdPartyBadgeHost = /(play\.google\.com|apps\.apple\.com|itunes\.apple\.com|microsoft\.com\/store|finalsite\.com|blackboard\.com|schoolwires\.com|schoolmessenger\.com|edlio\.com|apptegy\.com|smart-?sites\.com|echalk\.com)/i;
      const badgeClasses = /(badge|app-?store|play-?store|store-?icon|download-?app|powered-?by|partner-?logo|vendor-?logo)/i;
      if (
        thirdPartyBadgeText.test(svgText) ||
        thirdPartyBadgeText.test(combined) ||
        thirdPartyBadgeText.test(ariaLabel) ||
        thirdPartyBadgeHost.test(parentHref) ||
        badgeClasses.test(combined)
      ) {
        return;
      }

      // Reject tiny icons by viewBox (e.g. 24x24 social glyphs).
      const viewBox = ($el.attr('viewBox') || '').split(/[ ,]+/).map(Number);
      if (viewBox.length === 4) {
        const vbW = viewBox[2], vbH = viewBox[3];
        const aspect = vbW && vbH ? vbW / vbH : 1;
        // Pure square ≤ 32px is almost always an icon, not a wordmark.
        if (vbW <= 32 && vbH <= 32 && aspect > 0.7 && aspect < 1.4) return;
      }

      // Reject SVGs with no shape primitives — these are almost always
      // decorative text-only elements the site embeds as a label, not
      // the real wordmark. Chardon's site has one such sibling <svg>
      // that cheerio finds first; without this check it wins score 90
      // and the branding adopt ships 224 bytes of whitespace + alt
      // text to Supabase.
      const hasShape = /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(outer);
      if (!hasShape) return;

      // Wordmark heuristic: wide aspect (>2:1) bumps the score.
      let score = 90;
      if (viewBox.length === 4 && viewBox[2] / Math.max(viewBox[3], 1) > 2) score += 10;
      if (/wordmark/.test(combined)) score += 5;

      // A header mark when it sits in the header / nav / banner or links home
      // (the brand-named selectors above also catch footer partner strips).
      const headerMark =
        $el.closest('header, nav, [role="banner"]').length > 0 ||
        linksToHome($el);
      pushLogo(
        {
          url: '',
          kind: 'svg-inline',
          score,
          isSvg: true,
          svgInline: outer,
          headerMark,
        },
        combined,
      );
    });

    // <img> candidates that look like logos. Score by area + position +
    // naming signals + "header" ancestry.
    $('img').each((_, el) => {
      const $el = $(el);
      // Use bestImageSrc which understands data-lazy-src etc — many
      // school sites use WPRocket / LazyLoad and the real URL isn't
      // in `src` until JS runs (which our scraper doesn't do).
      const src = bestImageSrc($el);
      if (!src) return;
      const alt = ($el.attr('alt') || '').toLowerCase();
      const cls = ($el.attr('class') || '').toLowerCase();
      const id = ($el.attr('id') || '').toLowerCase();
      const combined = `${alt} ${cls} ${id} ${src.toLowerCase()}`;
      const logoRe = /(logo|wordmark|brand|mark|crest|shield|seal)/;
      if (!logoRe.test(combined)) return;
      // 2026-05-07 — same third-party-badge filter as inline-SVG branch.
      // Google Play / App Store / Smart Sites / Finalsite vendor
      // wordmarks frequently include "logo" in their alt text (e.g.
      // alt="Google Play store logo") so they slip past the logoRe
      // filter. Reject by content text + URL host + class hints.
      const thirdPartyBadgeText = /\b(google\s*play|app\s*store|microsoft\s*store|amazon\s*appstore|huawei|samsung|smart\s*sites|powered\s*by|made\s*by|hosted\s*by|finalsite|blackboard|schoolwires|schoolmessenger|edlio|apptegy|e\s*chalk)\b/i;
      const thirdPartyBadgeHost = /(play\.google\.com|apps\.apple\.com|itunes\.apple\.com|microsoft\.com\/store|finalsite\.com|blackboard\.com|schoolwires\.com|schoolmessenger\.com|edlio\.com|apptegy\.com|smart-?sites\.com|echalk\.com)/i;
      const badgeClasses = /(badge|app-?store|play-?store|store-?icon|download-?app|powered-?by|partner-?logo|vendor-?logo)/i;
      if (
        thirdPartyBadgeText.test(alt) ||
        thirdPartyBadgeText.test(cls) ||
        thirdPartyBadgeText.test(id) ||
        thirdPartyBadgeHost.test(src.toLowerCase()) ||
        badgeClasses.test(combined)
      ) return;
      const w = parseInt(($el.attr('width') || '0') as string, 10) || undefined;
      const h = parseInt(($el.attr('height') || '0') as string, 10) || undefined;
      const area = (w || 0) * (h || 0);
      const isSvg = /\.svg(\?|$)/i.test(src);
      // Position boost if ancestor is header/nav
      const inHeader = $el.closest('header, nav, [role="banner"]').length > 0;
      let score = 50;
      if (inHeader) score += 20;
      if (isSvg) score += 15;       // SVGs scale perfectly, always preferable
      if (/wordmark/.test(combined)) score += 10;
      if (area > 10_000) score += 8;
      else if (area && area < 400) score -= 10;
      // 2026-09-22 — positive evidence this is THE site's logo: named after
      // the brand, linked to the home page, wordmark-shaped. supertacomex.com's
      // real wordmark and its "Best of Sacramento" badge both scored 78 here,
      // and the badge came first in the page.
      const fileName = (() => {
        try {
          return new URL(src).pathname.split('/').pop() || '';
        } catch {
          return '';
        }
      })();
      const linksHome = linksToHome($el);
      const signal = logoSignalBonus({
        text: `${alt} ${fileName}`,
        brandKeys,
        linksHome,
        width: w,
        height: h,
      });
      score += signal.bonus;
      pushLogo(
        {
          url: src,
          kind: /wordmark/.test(combined) ? 'img-wordmark' : 'img-logo',
          score,
          area,
          width: w,
          height: h,
          isSvg,
          headerMark: inHeader || linksHome || signal.brandMatch,
        },
        combined,
      );
    });

    // Never hand the wizard an EMPTY gallery: if the third-party-host
    // reject swept the whole list (a site that serves its own mark from a
    // social CDN), the best rejected candidate comes back heavily demoted
    // so the operator still has something to pick.
    const survivingLogos = ensureSurvivor(logos, rejectedLogos);
    if (survivingLogos !== logos) {
      logos.length = 0;
      logos.push(...survivingLogos);
      warnings.push('Every logo we found is served by a third-party host — showing the best one anyway. Upload your logo for a clean result.');
    }
    // A site icon or share card never out-ranks a real logo (2026-09-22 —
    // supertacomex.com's apple-touch-icon, a crop of a food photo, scored 85
    // against its header wordmark's 78 and became the logo on every board).
    capIconsBelowRealLogo(logos);
    logos.sort((a, b) => b.score - a.score);

    // Kick off logo COLOR analysis now so it overlaps the stylesheet
    // fetches below. Awaited at step 7, right before derivePalette.
    const logoAnalysis = this.analyzeLogoCandidates(logos, deadline, remaining);

    const favicon = logos.find(l => l.kind === 'icon' || l.kind === 'apple-touch')?.url ?? null;

    // 4. Collect stylesheets (cap count + total bytes) and inline <style>.
    const stylesheetUrls: string[] = [];
    $('link[rel~="stylesheet"]').each((_, el) => {
      const href = absolutize($(el).attr('href') || '');
      if (href) stylesheetUrls.push(href);
    });
    const MAX_CSS = 30;
    const capped = stylesheetUrls.slice(0, MAX_CSS);
    if (stylesheetUrls.length > MAX_CSS) {
      warnings.push(`Only scanned the first ${MAX_CSS} of ${stylesheetUrls.length} stylesheets`);
    }

    const inlineStyleBlocks: string[] = [];
    $('style').each((_, el) => {
      const t = $(el).text();
      if (t && t.length < 200_000) inlineStyleBlocks.push(t);
    });

    // Fetch stylesheets concurrently with a hard byte budget
    const cssTexts: string[] = [...inlineStyleBlocks];
    const cssBudget = 2 * 1024 * 1024; // 2MB total across all stylesheets
    let cssBudgetRemaining = cssBudget;
    const cssResults = await Promise.allSettled(capped.map(async (u) => {
      if (Date.now() > deadline || cssBudgetRemaining <= 0) return null;
      try {
        const r = await safeFetch(u, { timeoutMs: Math.min(remaining(), 4000), maxBytes: Math.min(cssBudgetRemaining, 512 * 1024), accept: 'text/css' });
        cssBudgetRemaining -= r.body.length;
        return r.body.toString('utf-8');
      } catch (e) {
        return null;
      }
    }));
    for (const r of cssResults) {
      if (r.status === 'fulfilled' && r.value) cssTexts.push(r.value);
    }

    // Harvest inline style="" attributes as low-weight CSS
    const inlineInlineStyles: string[] = [];
    $('[style]').each((_, el) => {
      const s = $(el).attr('style');
      if (s) inlineInlineStyles.push(`[inline-${(el as any).tagName || 'x'}] { ${s} }`);
    });
    if (inlineInlineStyles.length) cssTexts.push(inlineInlineStyles.join('\n'));

    // 5. Extract colors + fonts from every CSS text.
    const colorScores = new Map<string, RankedColor>();
    const fontScores = new Map<string, RankedFont>();

    for (const css of cssTexts) {
      try {
        this.extractFromCss(css, colorScores, fontScores);
      } catch (e) {
        // PostCSS throws on exotic selectors — keep going.
      }
    }

    // Extract colors from the HTML's computed inline attributes too
    // (e.g., <font color=...>, bgcolor=, SVG fill/stroke).
    $('[color], [bgcolor], [fill], [stroke]').each((_, el) => {
      const attrs = ['color', 'bgcolor', 'fill', 'stroke'];
      for (const a of attrs) {
        const v = $(el).attr(a);
        if (!v) continue;
        const c = parseColor(v);
        if (!c || c.alpha < 0.5) continue;
        if (isNoiseColor(c.hex)) continue;
        const prev = colorScores.get(c.hex) ?? { hex: c.hex, score: 0, weight: 1, occurrences: 0 };
        prev.occurrences += 1;
        // Same near-white demotion as the CSS path (bgcolor = background
        // context) — VisionCore hardening.
        prev.score += 0.5 * backgroundishColorDemotion(c.hex, a === 'bgcolor');
        colorScores.set(c.hex, prev);
      }
    });

    // 6. Rank.
    const colors = [...colorScores.values()]
      .filter(c => !isNoiseColor(c.hex))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const fonts = [...fontScores.values()]
      .sort((a, b) => b.score - a.score);

    // Heading vs body disambiguation: a font scored predominantly in
    // heading selectors wins heading; others drop to body.
    const heading = fonts.find(f => f.role === 'heading' || f.role === 'either') || null;
    const body = fonts.find(f => f !== heading && (f.role === 'body' || f.role === 'either')) || heading;

    // 7. Palette source of truth = THE CHOSEN LOGO (2026-08-25).
    //
    // Operator: "why do you use colors that dont look good with the logo".
    // The page's CSS colors describe the WEBSITE; the mark describes the
    // BRAND. When the top logo candidate yields chromatic colors we build
    // primary/accent from those and only borrow the page for a missing
    // accent. A monochrome mark (or a fetch we couldn't decode) falls all
    // the way back to the old page-color behavior — unchanged.
    await logoAnalysis;
    // The analysis may have re-scored candidates on their REAL decoded
    // dimensions (a 1200x630 share photo is not a logo), so re-sort. A real
    // candidate the decode demoted must not let an icon climb back over it.
    capIconsBelowRealLogo(logos);
    logos.sort((a, b) => b.score - a.score);

    const pageColorHexes = colors.map((c) => c.hex);
    const topLogo = logos[0];
    // Never a palette from a PHOTOGRAPH (2026-09-22): the Super Taco brand
    // came out brown + pale blue because its "logo" was a food-photo icon.
    // A photographic top candidate falls back to page colors, exactly as a
    // monochrome or undecodable mark always has.
    const topLogoColors =
      topLogo && !topLogo.photographic ? topLogo.brandColors || [] : [];
    const logoChoice = paletteFromLogoColors(
      topLogoColors.map((hex) => ({ hex, count: 1, share: 1 })),
      pageColorHexes,
    );

    let primaryHex: string;
    let accentHex: string | undefined;
    let paletteSource: 'logo' | 'logo+page' | 'page';
    if (logoChoice) {
      primaryHex = logoChoice.primary;
      accentHex = logoChoice.accent;
      paletteSource = logoChoice.source;
    } else if (colors.length >= 1) {
      primaryHex = colors[0].hex;
      accentHex = colors[1]?.hex;
      paletteSource = 'page';
    } else {
      primaryHex = '#4f46e5';
      accentHex = undefined;
      paletteSource = 'page';
      warnings.push('No brand colors found — defaulting to indigo. Use the manual picker to tweak.');
    }

    const palette = derivePalette(primaryHex, accentHex);

    // Backdrop default for every analyzed candidate now that we know the
    // primary they'd sit next to (the "primary chip" rule needs it).
    for (const cand of logos) {
      if (typeof cand.inkLuminance !== 'number' && !cand.brandColors) continue;
      cand.logoBackground = suggestLogoBackground({
        luminance: typeof cand.inkLuminance === 'number' ? cand.inkLuminance : null,
        dominantHex: cand.brandColors?.[0] ?? null,
        primaryHex: palette.primary,
      });
    }
    const logoBackground: LogoBackground =
      topLogo?.logoBackground ??
      suggestLogoBackground({
        luminance: typeof topLogo?.inkLuminance === 'number' ? topLogo.inkLuminance : null,
        dominantHex: topLogo?.brandColors?.[0] ?? null,
        primaryHex: palette.primary,
      });
    (palette as any).logoBackground = logoBackground;

    // 8. Hero image candidates.
    //
    // 2026-09-22 — sized by what the page says the IMAGE is, not by the box
    // it is drawn in. Wix renders every background photo as a blurred 151×101
    // placeholder <img> whose width/height ATTRIBUTES are the display box
    // (1805×670 for Super Taco's hero); the true size (6000×4000) sits in the
    // wrapping <wow-image data-image-info> JSON. A srcset's biggest `w` is the
    // next-best signal; the attributes stay the last resort. A placeholder the
    // CDN cannot turn back into an original is dropped, and a thin strip
    // (a divider or a header band) is never a hero photo.
    const wixNaturalSize = (
      $el: cheerio.Cheerio<any>,
    ): { width: number; height: number } | null => {
      const raw =
        $el.closest('wow-image[data-image-info]').attr('data-image-info') ||
        $el.attr('data-image-info');
      if (!raw || raw.length > 20_000) return null;
      try {
        const info = JSON.parse(raw) as {
          imageData?: { width?: unknown; height?: unknown };
        } | null;
        const w = Number(info?.imageData?.width);
        const h = Number(info?.imageData?.height);
        return w > 0 && h > 0 && w < 100_000 && h < 100_000
          ? { width: w, height: h }
          : null;
      } catch {
        return null;
      }
    };
    const heroImages: HeroCandidate[] = [];
    if (ogImage) heroImages.push({ url: ogImage, kind: 'og', score: 80 });
    if (twitterImage && twitterImage !== ogImage) heroImages.push({ url: twitterImage, kind: 'twitter', score: 70 });
    $('img').each((_, el) => {
      const $el = $(el);
      // bestImageSrc also covers data-lazy-src + srcset for hero
      // images. Without this, sites using WPRocket lazy-loading
      // returned brand kits with no hero/top images.
      const src = bestImageSrc($el);
      if (!src) return;
      const w = parseInt(($el.attr('width') || '0') as string, 10) || 0;
      const h = parseInt(($el.attr('height') || '0') as string, 10) || 0;
      const natural = wixNaturalSize($el);
      const srcsetWidth = bestSrcsetOf($el)?.width || 0;
      const placeholder = isPlaceholder(src);
      if (placeholder && originalImageUrl(src) === src && !natural) return; // nothing to recover
      const knownW = natural?.width || srcsetWidth || w;
      const knownH =
        natural?.height ||
        (srcsetWidth && w && h ? Math.round((srcsetWidth * h) / w) : h);
      if (knownW < 800 && knownH < 500) return;
      const aspect = knownW && knownH ? knownW / knownH : 1;
      if (aspect > 4 || aspect < 0.25) return;
      const alt = $el.attr('alt') || '';
      if (heroImages.length < 12) {
        heroImages.push({
          url: src,
          kind: 'large-img',
          width: w || undefined,
          height: h || undefined,
          ...(natural
            ? { naturalWidth: natural.width, naturalHeight: natural.height }
            : {}),
          ...(srcsetWidth ? { srcsetWidth } : {}),
          ...(placeholder ? { placeholder: true } : {}),
          alt,
          // Stays below the og:image's 80, but a 24-MP photo now out-ranks a
          // 1-MP one (the old ×2 curve saturated at 30 for anything ≥ 0.03 MP).
          score:
            40 + Math.min(35, Math.log2(Math.max(1, knownW * knownH)) * 1.4),
        });
      }
    });
    heroImages.sort((a, b) => b.score - a.score);
    const topHeroes = heroImages.slice(0, 5);

    // 9. Confidence scoring.
    const confidence = {
      logo: logos.length === 0 ? 0 : logos[0].score >= 90 ? 0.95 : logos[0].score >= 70 ? 0.8 : 0.5,
      palette: colors.length >= 3 ? 0.9 : colors.length === 2 ? 0.7 : colors.length === 1 ? 0.5 : 0.1,
      fonts: heading ? (heading.googleFont ? 0.85 : 0.6) : 0.3,
      // 2026-05-25 — for sub-paths ogTitle is the page-specific name
      // that beat ogSiteName above, so it's the high-confidence source.
      displayName: hasSubpath
        ? (ogTitle ? 0.9 : cleanedTitle ? 0.75 : ogSiteName ? 0.6 : 0.4)
        : (ogSiteName ? 0.95 : ogTitle ? 0.85 : cleanedTitle ? 0.7 : 0.4),
      overall: 0,
    };
    confidence.overall = +(confidence.logo * 0.3 + confidence.palette * 0.35 + confidence.fonts * 0.2 + confidence.displayName * 0.15).toFixed(2);

    // 10. Google Fonts URL for the matched pair.
    const fontsCssUrl = (heading?.googleFont || body?.googleFont)
      ? buildGoogleFontsUrl([
          ...(heading?.googleFont ? [{ name: heading.googleFont, weights: [400, 600, 700] }] : []),
          ...(body?.googleFont && body.googleFont !== heading?.googleFont ? [{ name: body.googleFont, weights: [400, 500, 600] }] : []),
        ])
      : null;

    // 11. WCAG enforcement — derivePalette() already nudged the
    // primary/accent toward legibility. Surface a warning ONLY for
    // anything that's still capped (couldn't hit AA even at the
    // luminance extreme) so the operator can pick a manual override.
    // Anything that was simply adjusted is reported via
    // `palette.contrastReport.adjustments` — the wizard renders the
    // "we adjusted your yellow → undo?" prompt from that, no warning
    // needed.
    const cappedKeys = palette.contrastReport.adjustments
      .filter((a) => a.capped)
      .map((a) => a.key);
    if (cappedKeys.length > 0) {
      warnings.push(
        `Couldn't hit WCAG AA contrast (4.5:1) for ${cappedKeys.join(', ')} — ` +
          `even at the limit the color reads poorly against its ink. Consider a darker/lighter manual override.`,
      );
    }
    // Belt-and-braces: a forged palette (e.g. somebody hands a manual
    // tweak with primary === primaryInk) should still warn. ensureContrast
    // catches this but the report flags it explicitly.
    const primaryTextRatio = contrastRatio(palette.primary, palette.primaryInk);
    if (wcagGrade(primaryTextRatio) === 'fail') {
      warnings.push(
        `Primary color contrast still ${primaryTextRatio.toFixed(1)}:1 against ink — ` +
          `WCAG AA wants 4.5:1. Consider a manual override.`,
      );
    }

    const durationMs = Date.now() - startedAt;

    // Business descriptor for the AI template generator — the raw "what they
    // sell" signal, kept even if it overlaps the brand name (unlike tagline).
    // Prefer the social/meta description; fall back to the descriptive segment
    // of the SEO <title> (the part that is NOT the brand name) — e.g.
    // "Pizza Delivery & Carryout, Pasta, Wings & More". Cheap, no extra fetch.
    const description = (() => {
      const cands = [ogDesc, metaDesc, twitterDesc]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);
      let best = cands.find((s) => s.length >= 12) || cands[0] || '';
      if (!best && pageTitle) {
        const segs = pageTitle.split(/\s*[|\-–—]\s*/).map((s) => s.trim()).filter(Boolean);
        best =
          segs
            .filter((s) => !dnNorm || normalize(s) !== dnNorm)
            .sort((a, b) => b.length - a.length)[0] || '';
      }
      return best ? best.slice(0, 300) : null;
    })();

    const rawSnapshot = {
      title: pageTitle,
      ogSiteName, ogTitle, ogDesc, metaDesc,
      ogImage, twitterImage,
      stylesheetCount: stylesheetUrls.length,
      rankedColors: colors,
      rankedFonts: fonts.slice(0, 10),
      logoCount: logos.length,
      paletteSource,
      logoBackground,
      logoBrandColors: topLogo?.brandColors ?? null,
    };

    return {
      sourceUrl: url,
      finalUrl,
      displayName,
      tagline,
      description,
      keyMessages,
      logos: logos.slice(0, 8),
      favicon,
      ogImage,
      colors,
      palette,
      contrastReport: palette.contrastReport,
      logoBackground,
      paletteSource,
      fonts: { heading, body: body ?? null, all: fonts.slice(0, 6) },
      fontsCssUrl,
      heroImages: topHeroes,
      confidence,
      warnings,
      rawSnapshot,
      scrapedAt: new Date().toISOString(),
      durationMs,
    };
  }

  /**
   * Populate `brandColors` / `inkLuminance` on the top logo candidates, and
   * re-score any candidate whose REAL decoded dimensions prove it is a
   * photograph rather than a mark.
   *
   * Budgeted on purpose — this runs inside the 10s scrape budget:
   *   - inline SVGs are FREE (the markup is already in memory)
   *   - at most MAX_FETCHES network candidates, concurrently
   *   - 512KB / 3s per fetch, and nothing starts past the deadline
   *
   * Every failure path is silent: a candidate we couldn't decode simply
   * keeps `brandColors === undefined`, which makes the palette fall back to
   * page colors exactly as it did before this feature existed.
   */
  private async analyzeLogoCandidates(
    logos: LogoCandidate[],
    deadline: number,
    remaining: () => number,
  ): Promise<void> {
    const MAX_FETCHES = 4;
    let fetched = 0;
    const jobs: Promise<void>[] = [];

    for (const cand of logos) {
      // (a) Inline SVG — free, synchronous, no network.
      if (cand.svgInline) {
        cand.brandColors = extractSvgColors(cand.svgInline).map((c) => c.hex);
        const lum = svgInkLuminance(cand.svgInline);
        if (lum !== null) cand.inkLuminance = lum;
        continue;
      }
      if (!cand.url || fetched >= MAX_FETCHES) continue;
      // .ico/.icns are browser-tab icons; sharp can't read them anyway.
      if (/\.(ico|icns)(\?|#|$)/i.test(cand.url)) continue;
      fetched++;
      jobs.push(this.analyzeOneLogo(cand, deadline, remaining));
    }

    await Promise.allSettled(jobs);
  }

  /** Fetch + decode ONE candidate. Never throws. */
  private async analyzeOneLogo(
    cand: LogoCandidate,
    deadline: number,
    remaining: () => number,
  ): Promise<void> {
    if (Date.now() > deadline) return;
    try {
      const res = await safeFetch(cand.url, {
        timeoutMs: Math.min(remaining(), 3000),
        // 1.5 MB (was 512 KB): candidates now carry the srcset's BIGGEST
        // rendition, and a 2x wordmark PNG must not fail the cap and silently
        // cost the brand its logo colours.
        maxBytes: 1536 * 1024,
        accept: 'image/*',
      });

      // A URL-referenced SVG is text, not a raster — parse the markup the
      // same way we parse an inline one (sharp needs librsvg for SVG and
      // that is not guaranteed in the Alpine image).
      const isSvg =
        /image\/svg/i.test(res.contentType || '') || /\.svg(\?|#|$)/i.test(cand.url);
      if (isSvg) {
        const text = res.body.toString('utf-8');
        cand.brandColors = extractSvgColors(text).map((c) => c.hex);
        const lum = svgInkLuminance(text);
        if (lum !== null) cand.inkLuminance = lum;
        return;
      }

      // Raster. `sharp` is already an API dependency (it powers
      // storage/media-optimization.service.ts), so this adds no package and
      // no extra process cost — the module is loaded either way.
      //
      // Imported STATICALLY on purpose: this package compiles with
      // `module: "nodenext"`, which PRESERVES `await import()` as a true
      // dynamic import. That works in production but throws inside jest's
      // CJS VM ("dynamic import callback was invoked without
      // --experimental-vm-modules") — and since every failure here is
      // swallowed by design, a lazy import would have degraded raster
      // analysis to a silent no-op in every test run.
      const img = sharp(res.body, { failOn: 'none' });
      const meta = await img.metadata();

      // Real-dimension photo demotion. The declared width/height attribute
      // is usually absent on modern sites, so the ONLY reliable shape
      // signal is the decoded one — this is what actually kills the
      // hydrogen-truck + airport-terminal shots from the 2026-08-25 report.
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (w && h) {
        cand.width = cand.width || w;
        cand.height = cand.height || h;
        const verdict = photoSignalDemotion({ url: cand.url, width: w, height: h, kind: cand.kind });
        if (verdict.factor < 1) {
          cand.score = Math.max(1, +(cand.score * verdict.factor).toFixed(2));
          cand.filterReasons = [...(cand.filterReasons || []), ...verdict.reasons];
        }
      }

      // A mark or a PHOTOGRAPH? (2026-09-22.) Nothing in a URL or a declared
      // size says so — supertacomex.com's apple-touch-icon is a 180×180 crop
      // of a food photo — only the pixels do (see looksPhotographic).
      const sample = await img
        .clone()
        .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        looksPhotographic(
          imagePixelStats(sample.data, sample.info.width, sample.info.height),
        )
      ) {
        const verdict = decodedPhotoDemotion(true);
        cand.photographic = true;
        cand.score = Math.max(1, +(cand.score * verdict.factor).toFixed(2));
        cand.filterReasons = [
          ...(cand.filterReasons || []),
          ...verdict.reasons,
        ];
      }

      const { data } = await img
        .resize(48, 48, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      cand.brandColors = dominantColorsFromRgba(data).map((c) => c.hex);
      const lum = averageOpaqueLuminance(data);
      if (lum !== null) cand.inkLuminance = lum;
    } catch {
      // Bot-blocked, 404, un-decodable, out of budget — leave the candidate
      // un-analyzed. The palette then falls back to page colors.
    }
  }

  /** Parse a CSS string and add scored hits to the color/font maps. */
  private extractFromCss(
    css: string,
    colors: Map<string, RankedColor>,
    fonts: Map<string, RankedFont>,
  ): void {
    let root: postcss.Root;
    try { root = postcss.parse(css); } catch { return; }

    root.walkRules((rule) => {
      // A keyframe STEP is not a selector. postcss walks into @keyframes, so
      // "0%" / "50%" / "100%" arrived here as rules and their colors were
      // banked as brand evidence — that is where the nba.com accent #73859f
      // came from (its sampleSelector was literally "0%").
      const parent: any = rule.parent;
      if (parent && parent.type === 'atrule' && /keyframes$/i.test(String(parent.name || ''))) return;
      const selector = rule.selector || '';
      const selectorWeight = this.scoreSelector(selector);
      rule.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        const val = decl.value;

        // ── CUSTOM PROPS ────────────────────────────────────────
        if (prop.startsWith('--')) {
          if (BRAND_CUSTOM_PROP.test(prop)) {
            this.captureColors(val, 5.0 * selectorWeight, colors, selector, /*isCustom*/ true);
          }
          if (HEADING_CUSTOM_PROP.test(prop)) {
            this.captureFont(val, 5.0, 'heading', fonts);
          } else if (BODY_CUSTOM_PROP.test(prop)) {
            this.captureFont(val, 5.0, 'body', fonts);
          }
        }

        // ── COLORS ──────────────────────────────────────────────
        if (/color|background|border|fill|stroke|shadow/i.test(prop)) {
          const weight = this.propColorWeight(prop) * selectorWeight;
          // background*/bgcolor declarations are "canvas" evidence — a
          // near-white here gets the hard demotion (VisionCore).
          this.captureColors(val, weight, colors, selector, false, /^background/.test(prop));
        }

        // ── FONTS ───────────────────────────────────────────────
        if (prop === 'font-family' || prop === 'font') {
          const role = this.selectorFontRole(selector);
          const stack = prop === 'font' ? this.extractFontFamilyFromShorthand(val) : val;
          this.captureFont(stack, selectorWeight, role, fonts);
        }
      });
    });

    // Also harvest @font-face families (so we know the site uses them)
    root.walkAtRules('font-face', (atRule) => {
      atRule.walkDecls('font-family', (decl) => {
        this.captureFont(decl.value, 0.3, 'either', fonts);
      });
    });
  }

  private scoreSelector(sel: string): number {
    let w = 1.0;
    for (const [re, mult] of SELECTOR_WEIGHTS) {
      if (re.test(sel)) w = Math.max(w, mult);
    }
    // A bundled widget's own chrome is not this site's brand.
    if (LIBRARY_SELECTOR.test(sel)) w *= LIBRARY_SELECTOR_DEMOTION;
    return w;
  }

  private propColorWeight(prop: string): number {
    if (/^background(-color)?$/.test(prop)) return 1.5;
    if (/^color$/.test(prop)) return 1.2;
    if (/^border(-[a-z]+)?-color$/.test(prop)) return 1.0;
    if (/fill|stroke/.test(prop)) return 1.1;
    return 0.8;
  }

  private captureColors(
    val: string,
    weight: number,
    map: Map<string, RankedColor>,
    sampleSelector: string,
    isCustomProp = false,
    isBackgroundContext = false,
  ): void {
    // Walk every word of the value; PostCSS value parser picks up fns + literals
    try {
      const parsed = valueParser(val);
      // VisionCore hardening: near-white hits are demoted per-color (hard in
      // background declarations, mildly elsewhere) so a page canvas can't
      // out-score the saturated brand color. See backgroundishColorDemotion.
      const add = (hex: string) => {
        const w = weight * backgroundishColorDemotion(hex, isBackgroundContext);
        this.bumpColor(map, hex, w, sampleSelector, isCustomProp);
      };
      const visit = (nodes: any[]) => {
        for (const n of nodes) {
          if (n.type === 'word' && /^#[0-9a-fA-F]{3,8}$/.test(n.value)) {
            const c = parseColor(n.value);
            if (c && c.alpha >= 0.5 && !isNoiseColor(c.hex)) {
              add(c.hex);
            }
          } else if (n.type === 'function' && /^(rgb|rgba|hsl|hsla)$/i.test(n.value)) {
            const text = valueParser.stringify(n);
            const c = parseColor(text);
            if (c && c.alpha >= 0.5 && !isNoiseColor(c.hex)) {
              add(c.hex);
            }
          }
          if (n.nodes) visit(n.nodes);
        }
      };
      visit(parsed.nodes);
    } catch {}
  }

  private bumpColor(map: Map<string, RankedColor>, hex: string, weight: number, selector: string, isCustom: boolean) {
    const prev = map.get(hex) ?? { hex, score: 0, weight: 0, occurrences: 0, sampleSelector: selector, isCustomProp: false };
    prev.occurrences += 1;
    prev.weight = Math.max(prev.weight, weight);
    prev.score += weight;
    if (isCustom) prev.isCustomProp = true;
    if (!prev.sampleSelector || prev.sampleSelector.length > selector.length) prev.sampleSelector = selector;
    map.set(hex, prev);
  }

  private selectorFontRole(sel: string): 'heading' | 'body' | 'either' {
    if (/\b(h[1-6])\b/i.test(sel)) return 'heading';
    if (/\.(title|heading|headline|display)/i.test(sel)) return 'heading';
    if (/\bbody\b|\.content|\.prose|p\b/.test(sel)) return 'body';
    return 'either';
  }

  private extractFontFamilyFromShorthand(val: string): string {
    // font: italic 1rem/1.2 "Foo", Bar, sans-serif
    // Rough extraction: everything after the last `/` and size token.
    const match = val.match(/(?:\d+(?:px|em|rem|%|pt|cm|mm|in|pc)?|xx-small|x-small|small|medium|large|x-large|xx-large)[^,]*?(?:\/\s*[^ ]+\s*)?\s*(.+)$/);
    if (match) return match[1];
    return val;
  }

  private captureFont(
    stack: string,
    weight: number,
    role: 'heading' | 'body' | 'either',
    map: Map<string, RankedFont>,
  ): void {
    if (!stack) return;
    // VisionCore hardening (2026-07-21): mangled `font:` shorthand
    // extractions and var() indirections must never become a candidate —
    // ")", "))", "var(--hover-font" all reached a real tenant_branding row.
    const first = sanitizeFontFamilyName(stack);
    if (!first) return;
    // Skip generic system stacks and CSS keywords
    if (/^(inherit|initial|unset|revert|sans-serif|serif|monospace|cursive|fantasy|system-ui|-apple-system|BlinkMacSystemFont)$/i.test(first)) return;
    // 2026-05-25 — Reject icon-fonts. Many sites declare a font-family
    // of "slick" (jQuery Slick carousel arrow icons), "FontAwesome",
    // "Material Icons" etc. for icon glyphs. These are NEVER the
    // brand's typography but were getting captured as candidates,
    // landing as "Heading: slick / Body: slick — System fallback" on
    // mlb.com/dodgers (operator caught it 2026-05-25). Whole-family
    // match (after lowercasing) — the FontAwesome family names include
    // version numbers like "Font Awesome 6 Free" so we use `startsWith`
    // for those.
    if (this.isIconFont(first)) return;
    // Player/widget libraries ship their own family ("VideoJS" won nba.com on
    // 39 occurrences). Same class of non-brand font as the icon families.
    if (LIBRARY_FONT.has(first.trim().toLowerCase())) return;
    const key = first.toLowerCase();
    const prev = map.get(key) ?? { family: first, googleFont: matchGoogleFont(first), score: 0, occurrences: 0, weightsSeen: [], role };
    prev.occurrences += 1;
    prev.score += weight;
    // Role precedence: heading > body > either
    if (role === 'heading') prev.role = 'heading';
    else if (role === 'body' && prev.role === 'either') prev.role = 'body';
    map.set(key, prev);
  }

  /**
   * Recognize icon-font family names so they never get returned as a
   * brand typography candidate. Operator caught it on 2026-05-25 when
   * scraping mlb.com/dodgers produced Heading + Body = "slick" (the
   * jQuery Slick carousel arrow font).
   *
   * Each entry is matched against the (lowercased) family name —
   * `startsWith` for families that carry version suffixes ("Font
   * Awesome 6 Free", "Material Symbols Outlined"), exact-match for
   * simple-name fonts. Order matters only for readability; both
   * branches run.
   */
  private isIconFont(family: string): boolean {
    const f = family.trim().toLowerCase();
    if (!f) return true;
    // startsWith — these have variants ("Font Awesome 5 Pro",
    // "Material Symbols Rounded", "Material Design Icons Mono"…).
    const prefixes = [
      'font awesome',
      'fontawesome',
      'material icons',
      'material symbols',
      'material design icons',
      'mdi-',
      'fa-',
      'simple-line-icons',
    ];
    if (prefixes.some((p) => f.startsWith(p))) return true;
    // exact-match — single-word library fonts that don't come in
    // variants. "slick" is the carousel arrow font; the others are
    // their library counterparts.
    const exact = new Set([
      'slick',
      'glyphicons',
      'glyphicons halflings',
      'ionicons',
      'feather',
      'feather-icons',
      'icomoon',
      'themify',
      'entypo',
      'octicons',
      'dripicons',
      'et-line',
      'elegant icons',
      'lineicons',
      'owl-carousel',
      'swiper-icons',
      'revicons',
      'eleganticons',
      'flat-icons',
      'fontello',
      'iconfont',
      'icon',
      'icons',
    ]);
    return exact.has(f);
  }
}
