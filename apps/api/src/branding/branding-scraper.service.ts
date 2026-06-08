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
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

import { safeFetch, SsrfError } from './safe-fetch';
import { parseColor, derivePalette, contrastRatio, wcagGrade, DerivedPalette, ContrastReport } from './color-utils';
import { matchGoogleFont, buildGoogleFontsUrl } from './google-fonts';

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
}

export interface HeroCandidate {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
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
    // UA matters here. The default safeFetch UA — "EduSignage-Branding/
    // 1.0 (+https://edusignage.example)" — trips Cloudflare bot
    // management on any site with stricter WAF rules (school districts
    // like LAUSD ship with aggressive defaults). They return either a
    // 403 block page or the "Just a moment…" JS challenge HTML, and
    // cheerio happily parses THAT instead of the real page, leaving
    // the operator with empty branding output and a confusing error.
    //
    // Operator (2026-05-25): "i tried to use the sample LAUSD link
    // for branding and it gave me some crazy cloud flare error."
    //
    // Mimicking a real Chrome UA gets us through Cloudflare's default
    // ruleset. The same trick every commercial branding API uses
    // (Brandfetch, Logo.dev, Clearbit). School-district sites publish
    // their brand assets PUBLICLY anyway — this isn't bypassing access
    // control, just reading the homepage the way a browser would.
    const htmlRes = await safeFetch(url, {
      timeoutMs: Math.min(remaining(), 10_000),
      maxBytes: 5 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
    const PLACEHOLDER_RE = /^data:image\/svg\+xml|placeholder|blank\.(gif|png)|1x1\.(gif|png)|spacer\.(gif|png)/i;
    const isPlaceholder = (src: string): boolean => PLACEHOLDER_RE.test(src);
    const pickLargestSrcset = (srcset: string): string | null => {
      let best: { url: string; width: number } | null = null;
      for (const raw of srcset.split(',')) {
        const part = raw.trim();
        if (!part) continue;
        const [url, descriptor] = part.split(/\s+/);
        if (!url) continue;
        const width = descriptor ? parseInt(descriptor.replace(/[^\d]/g, ''), 10) || 0 : 0;
        if (!best || width > best.width) best = { url, width };
      }
      return best?.url ?? null;
    };
    const bestImageSrc = ($el: cheerio.Cheerio<any>): string | null => {
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

      // Srcset variants (some lazy plugins put srcset in data-srcset).
      const srcsetAttr = $el.attr('srcset')
        || $el.attr('data-srcset')
        || $el.attr('data-lazy-srcset')
        || '';
      if (srcsetAttr) {
        const largest = pickLargestSrcset(srcsetAttr);
        if (largest && !isPlaceholder(largest)) return absolutize(largest);
      }

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
    const tagline = taglineCandidates
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

    const ogImage = absolutize($('meta[property="og:image"]').attr('content'));
    const twitterImage = absolutize($('meta[name="twitter:image"]').attr('content'));

    // 3. Logo candidates.
    const logos: LogoCandidate[] = [];
    const seenLogoUrls = new Set<string>();
    const pushLogo = (c: LogoCandidate) => {
      const k = (c.url || c.svgInline || '').slice(0, 200);
      if (!k || seenLogoUrls.has(k)) return;
      seenLogoUrls.add(k);
      logos.push(c);
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

    if (ogImage) pushLogo({ url: ogImage, kind: 'og', score: 60 });
    if (twitterImage) pushLogo({ url: twitterImage, kind: 'twitter', score: 55 });

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

      pushLogo({ url: '', kind: 'svg-inline', score, isSvg: true, svgInline: outer });
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
      pushLogo({ url: src, kind: /wordmark/.test(combined) ? 'img-wordmark' : 'img-logo', score, area, width: w, height: h, isSvg });
    });

    logos.sort((a, b) => b.score - a.score);

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
        prev.score += 0.5;
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

    // 7. Fallback — if we couldn't find a primary color at all, pick
    // the dominant color in the og:image or fall back to indigo.
    let primaryHex: string;
    let accentHex: string | undefined;
    if (colors.length >= 1) {
      primaryHex = colors[0].hex;
      accentHex = colors[1]?.hex;
    } else {
      primaryHex = '#4f46e5';
      warnings.push('No brand colors found — defaulting to indigo. Use the manual picker to tweak.');
    }

    const palette = derivePalette(primaryHex, accentHex);

    // 8. Hero image candidates.
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
      if (w < 800 && h < 500) return;
      const alt = $el.attr('alt') || '';
      if (heroImages.length < 12) {
        heroImages.push({ url: src, kind: 'large-img', width: w || undefined, height: h || undefined, alt, score: 40 + Math.min(30, Math.log2(Math.max(1, w * h)) * 2) });
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

    const rawSnapshot = {
      title: pageTitle,
      ogSiteName, ogTitle, ogDesc, metaDesc,
      ogImage, twitterImage,
      stylesheetCount: stylesheetUrls.length,
      rankedColors: colors,
      rankedFonts: fonts.slice(0, 10),
      logoCount: logos.length,
    };

    return {
      sourceUrl: url,
      finalUrl,
      displayName,
      tagline,
      logos: logos.slice(0, 8),
      favicon,
      ogImage,
      colors,
      palette,
      contrastReport: palette.contrastReport,
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

  /** Parse a CSS string and add scored hits to the color/font maps. */
  private extractFromCss(
    css: string,
    colors: Map<string, RankedColor>,
    fonts: Map<string, RankedFont>,
  ): void {
    let root: postcss.Root;
    try { root = postcss.parse(css); } catch { return; }

    root.walkRules((rule) => {
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
          this.captureColors(val, weight, colors, selector);
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
  ): void {
    // Walk every word of the value; PostCSS value parser picks up fns + literals
    try {
      const parsed = valueParser(val);
      const visit = (nodes: any[]) => {
        for (const n of nodes) {
          if (n.type === 'word' && /^#[0-9a-fA-F]{3,8}$/.test(n.value)) {
            const c = parseColor(n.value);
            if (c && c.alpha >= 0.5 && !isNoiseColor(c.hex)) {
              this.bumpColor(map, c.hex, weight, sampleSelector, isCustomProp);
            }
          } else if (n.type === 'function' && /^(rgb|rgba|hsl|hsla)$/i.test(n.value)) {
            const text = valueParser.stringify(n);
            const c = parseColor(text);
            if (c && c.alpha >= 0.5 && !isNoiseColor(c.hex)) {
              this.bumpColor(map, c.hex, weight, sampleSelector, isCustomProp);
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
    const families = stack.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    const first = families[0];
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
