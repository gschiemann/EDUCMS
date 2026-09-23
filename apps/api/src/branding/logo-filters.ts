/**
 * logo-filters — pure, I/O-free scoring rules that keep third-party
 * social icons, vendor badges and page PHOTOGRAPHY out of the branding
 * wizard's logo candidate list.
 *
 * Why this file exists (2026-08-25, operator report + screenshot):
 *   "why is it loading a pintrest logo when i have the company logo
 *    selected … it needs to look good for the customer on the first try"
 *
 * The scrape of a real customer site returned 8 "logo" candidates: the
 * actual brand mark (a colored lotus), a **Pinterest** circular P, a stock
 * photo of a hydrogen truck, and a photo of an airport terminal. The
 * scraper already rejected third-party badges — but ONLY on the inline-SVG
 * branch. `<link rel="apple-touch-icon">` (base score 85, the HIGHEST in
 * iconRelPriority), og:image, twitter:image and `<img>` all had no such
 * filter, so a social icon or a share card could out-rank the real mark.
 *
 * Design contract — deliberately conservative, because a wrongly-REJECTED
 * real logo is worse than one extra candidate in the gallery:
 *
 *   1. HARD REJECT only on a third-party HOST (pinterest.com, fbcdn.net,
 *      twimg.com, …). A URL served by Pinterest's CDN is definitively not
 *      this tenant's brand mark. Guarded by `siteHost`: if the site being
 *      scraped IS that company, nothing is rejected.
 *   2. DEMOTE (multiply the score) for everything softer — a social/share/
 *      sprite/badge token in the path, a photographic aspect + size, a
 *      hero/banner/stock-photo path token, a `.jpg` extension. Demoted
 *      candidates stay visible; they just stop out-ranking the real mark.
 *   3. `ensureSurvivor()` guarantees the list is never emptied: if every
 *      candidate was rejected, the best rejected one comes back (demoted).
 *
 * No I/O, no cheerio, no NestJS — unit-tested in isolation.
 */

export type LogoFilterVerdict = {
  /** true → drop the candidate entirely (host-level third-party only). */
  reject: boolean;
  /** Multiplier applied to the candidate's score (1 = untouched). */
  factor: number;
  /** Human-readable reasons, surfaced in logs / tests. */
  reasons: string[];
};

/**
 * Hosts that serve OTHER companies' marks. A logo URL on one of these is
 * never the tenant's own brand (unless the tenant IS that company — see
 * the `siteHost` guard in `classifyLogoUrl`).
 *
 * Split into the social networks + their asset CDNs, and the app-store /
 * school-CMS vendor badges the inline-SVG branch already knew about.
 */
export const THIRD_PARTY_LOGO_HOSTS: RegExp =
  /(^|\.)(?:pinterest\.[a-z.]+|pinimg\.com|facebook\.[a-z.]+|fbcdn\.net|fbsbx\.com|instagram\.[a-z.]+|cdninstagram\.com|twitter\.com|x\.com|twimg\.com|linkedin\.[a-z.]+|licdn\.com|tiktok\.[a-z.]+|tiktokcdn\.com|youtube\.[a-z.]+|youtu\.be|ytimg\.com|ggpht\.com|whatsapp\.[a-z.]+|snapchat\.com|sc-cdn\.net|reddit\.com|redditstatic\.com|threads\.net|vimeo\.com|vimeocdn\.com|yelp\.[a-z.]+|yelpcdn\.com|tripadvisor\.[a-z.]+|tacdn\.com|play\.google\.com|apps\.apple\.com|itunes\.apple\.com|finalsite\.com|blackboard\.com|schoolwires\.com|schoolmessenger\.com|edlio\.com|apptegy\.com|smart-?sites\.com|echalk\.com|addthis\.com|addtoany\.com|sharethis\.com|gravatar\.com|w\.org|wp\.com)$/i;

/**
 * Social-network / share-widget tokens in the FILENAME or path. Matched on
 * token boundaries (`/`, `-`, `_`, `.`) so `logo-facebook.svg` and
 * `/icons/pinterest.png` hit while a real brand like `flexinstagram-co`
 * does not. Demote-only — a site CAN legitimately name a file
 * "share-logo.svg" and mean its own mark.
 */
export const SOCIAL_ASSET_TOKEN: RegExp =
  /(?:^|[/_.-])(?:pinterest|pin-?it|facebook|fb-?icon|meta-?icon|instagram|insta|twitter|tweet|x-?logo|x-?icon|linked-?in|tiktok|tik-?tok|youtube|yt-?icon|whatsapp|snapchat|threads|vimeo|yelp|tripadvisor|reddit|social(?:-?media|-?icons?)?|share(?:-?this|-?icons?|-?button)?|follow-?us|sprite|spritesheet|icon-?sprite|badge|app-?store|play-?store|google-?play|powered-?by|made-?by|hosted-?by)(?:[/_.-]|$)/i;

/**
 * Path tokens that say "this is page PHOTOGRAPHY, not a mark" — the
 * hydrogen-truck and airport-terminal shots from the operator's screenshot.
 * Also covers the stock-photo libraries those images are bought from.
 */
export const PHOTO_PATH_TOKEN: RegExp =
  /(?:^|[/_.-])(?:hero|banner|slide|slider|carousel|photo|photos|photography|stock|cover|background|backgrounds|bg-image|header-image|feature[ds]?-image|gallery|slideshow|masthead-image|shutterstock|istockphoto|istock|unsplash|pexels|gettyimages|adobestock|dreamstime|depositphotos)(?:[/_.-]|$)/i;

/**
 * The same idea for ALT / class / aria TEXT, but a deliberately NARROWER
 * list. A path segment named `gallery` or `cover` is a strong photo signal;
 * the same words in prose ("Gallery Coffee Co logo") are not. Only phrases
 * that are unambiguously about page imagery live here.
 */
export const PHOTO_TEXT_TOKEN: RegExp =
  /(?:^|[\s/_.-])(?:hero|banner|slide|slider|carousel|slideshow|background\s?image|header\s?image|stock\s?photo|photograph)(?:[\s/_.-]|$)/i;

/** Extensions that are photographic containers. Logos are ~never JPEG. */
const PHOTO_EXT: RegExp = /\.(?:jpe?g|avif|heic|heif)(?:[?#]|$)/i;

/**
 * Award / accreditation / partner BADGES (2026-09-22). supertacomex.com shows
 * a "Best of Sacramento" badge in its header, right before the real wordmark;
 * both scored 78 and the badge came first in page order. A badge names
 * SOMEBODY ELSE's program, so it is demoted — never rejected, because a
 * gallery that hides the operator's own upload is worse than one extra tile.
 *
 * Matched on token boundaries against alt / class / id / filename. Not "won"
 * (Won Ton House), not "seal" alone (a school seal IS its logo).
 */
export const AWARD_BADGE_TOKEN: RegExp =
  /(?:^|[\s/_.,-])(?:best[\s_-]*of|awards?|awarded|winners?|certified|certification|accredited|accreditation|readers?[\s_-]*choice|voted|rated|top[\s_-]*\d{1,3}|seal[\s_-]*of|as[\s_-]*seen[\s_-]*(?:on|in)|featured[\s_-]*(?:on|in)|proud[\s_-]*member|member[\s_-]*of|partners?|sponsors?|sponsored|michelin|zagat|diners[\s_-]*choice|bbb)(?:[\s/_.,-]|$)/i;

/** Discovery paths that yield a site-icon or a share card, never a header mark. */
export const ICON_LOGO_KINDS: ReadonlySet<string> = new Set([
  'icon',
  'apple-touch',
  'mask',
  'og',
  'twitter',
]);

export function isIconLogoKind(kind: string | undefined | null): boolean {
  return !!kind && ICON_LOGO_KINDS.has(kind);
}

/** Lowercase, accent-stripped, alphanumerics only — "Super Taco" → "supertaco". */
export function normalizeBrandText(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return '';
  let t = s;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep the raw text */
  }
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Brand keys to look for in a logo's filename / alt text: the display name,
 * og:site_name, the host's root word. A leading "The " is dropped and keys
 * under 4 characters are ignored (too many false matches).
 */
export function brandKeysFrom(
  ...names: Array<string | null | undefined>
): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n || typeof n !== 'string') continue;
    const k = normalizeBrandText(n.replace(/^\s*the\s+/i, ''));
    if (k.length >= 4) out.add(k);
  }
  return [...out];
}

export interface LogoSignalInput {
  /** alt / class / id / filename text. */
  text: string;
  brandKeys?: string[];
  /** The mark is wrapped in a link to the site's home page. */
  linksHome?: boolean;
  width?: number;
  height?: number;
}

/**
 * Positive evidence that an <img> is THE site's logo (2026-09-22). A header
 * logo that links home, whose file is named after the brand, in a wordmark
 * shape, is the textbook logo; an award badge beside it has none of those.
 *
 *   brand name in the filename / alt     +15
 *   wrapped in a link to the home page   +10
 *   wordmark aspect (2.5:1 – 12:1)        +6
 */
export function logoSignalBonus(input: LogoSignalInput): {
  bonus: number;
  brandMatch: boolean;
} {
  let bonus = 0;
  const text = normalizeBrandText(input.text || '');
  const brandMatch =
    !!text &&
    (input.brandKeys || []).some((k) => k.length >= 4 && text.includes(k));
  if (brandMatch) bonus += 15;
  if (input.linksHome) bonus += 10;
  const w = input.width || 0;
  const h = input.height || 0;
  if (w > 0 && h > 0) {
    const aspect = w / h;
    if (aspect >= 2.5 && aspect <= 12) bonus += 6;
  }
  return { bonus, brandMatch };
}

/**
 * Demote an award / partner badge. A candidate whose text also carries the
 * BRAND name is exempt — "Best Of Philly Cheesesteaks" may call its own logo
 * `best-of-philly-logo.png`.
 */
export function awardBadgeDemotion(
  text: string,
  url: string,
  brandKeys: string[] = [],
): LogoFilterVerdict {
  const reasons: string[] = [];
  let pathPart = '';
  try {
    pathPart = decodeURIComponent(new URL(url).pathname);
  } catch {
    pathPart = url || '';
  }
  const haystack = `${text || ''} ${pathPart}`;
  if (!AWARD_BADGE_TOKEN.test(haystack))
    return { reject: false, factor: 1, reasons };
  const norm = normalizeBrandText(haystack);
  if (brandKeys.some((k) => k.length >= 4 && norm.includes(k))) {
    return { reject: false, factor: 1, reasons };
  }
  reasons.push('award/partner badge');
  return { reject: false, factor: 0.3, reasons };
}

/**
 * A candidate that is plausibly the site's own mark: an <img> / inline-SVG
 * logo that no filter has demoted. Favicons, touch icons and share cards never
 * count — they are the fallback, not the logo.
 */
export function isRealLogoCandidate(
  c: { kind?: string; filterReasons?: string[] } | null | undefined,
): boolean {
  if (!c) return false;
  if (
    !(
      c.kind === 'img-logo' ||
      c.kind === 'img-wordmark' ||
      c.kind === 'svg-inline'
    )
  )
    return false;
  return !(c.filterReasons && c.filterReasons.length);
}

/**
 * "A favicon / apple-touch-icon / og / twitter image is never the logo when a
 * real header logo candidate exists" (2026-09-22). supertacomex.com's
 * apple-touch-icon (base 85) beat its real header wordmark (78) — and the icon
 * was a crop of a food photo. When any real candidate exists, every
 * icon/share-card candidate is capped at 90% of the best real one. Mutates and
 * returns `logos`; a no-op when there is no real candidate.
 */
export function capIconsBelowRealLogo<
  T extends { kind?: string; score: number; filterReasons?: string[] },
>(logos: T[]): T[] {
  let best = -Infinity;
  for (const c of logos)
    if (isRealLogoCandidate(c) && c.score > best) best = c.score;
  if (!Number.isFinite(best)) return logos;
  const ceiling = Math.max(1, +(best * 0.9).toFixed(2));
  for (const c of logos) {
    if (!isIconLogoKind(c.kind) || c.score <= ceiling) continue;
    c.score = ceiling;
    c.filterReasons = [
      ...(c.filterReasons || []),
      'site icon / share card — the site has a real logo',
    ];
  }
  return logos;
}

/**
 * Demotion for a candidate whose DECODED pixels read as a photograph (see
 * `looksPhotographic` in logo-colors.ts). A square icon cut from a food photo
 * must lose to a wordmark.
 */
export function decodedPhotoDemotion(photographic: boolean): LogoFilterVerdict {
  return photographic
    ? { reject: false, factor: 0.2, reasons: ['decodes as a photograph'] }
    : { reject: false, factor: 1, reasons: [] };
}

/** Lowercased hostname of a URL, or '' when it isn't parseable/absolute. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Is `host` the same site as `siteHost` (exact, or a dot-boundary suffix)?
 * Mirrors the player trust-guard matching so `evil-pinterest.com` never
 * counts as `pinterest.com`.
 */
function sameSite(host: string, siteHost: string): boolean {
  if (!host || !siteHost) return false;
  if (host === siteHost) return true;
  return host.endsWith('.' + siteHost) || siteHost.endsWith('.' + host);
}

/**
 * Classify a candidate logo URL. Applied at the single `pushLogo` choke
 * point so EVERY discovery path (link rel=icon / apple-touch-icon,
 * og:image, twitter:image, <img>, inline SVG) gets the same treatment.
 *
 * @param url       absolute candidate URL ('' for inline SVGs)
 * @param siteHost  hostname of the page being scraped — the "is this
 *                  actually OUR mark?" guard for rule 1
 */
export function classifyLogoUrl(url: string, siteHost = ''): LogoFilterVerdict {
  const reasons: string[] = [];
  if (!url) return { reject: false, factor: 1, reasons };

  const host = hostOf(url);
  const lower = url.toLowerCase();

  // ── Rule 1: third-party HOST → hard reject (unless it's our own site).
  if (host && THIRD_PARTY_LOGO_HOSTS.test(host) && !sameSite(host, siteHost)) {
    reasons.push(`third-party host ${host}`);
    return { reject: true, factor: 0, reasons };
  }

  // Everything below is demote-only.
  let factor = 1;

  // ── Rule 2: social / share / sprite / badge token in the path.
  // Test the path + filename only — a brand whose DOMAIN contains one of
  // these words (e.g. `sharehouse.com/logo.svg`) must not be penalized.
  let pathPart = lower;
  try {
    const u = new URL(url);
    pathPart = (u.pathname + u.search).toLowerCase();
  } catch {
    /* relative/inline — test the whole string */
  }
  if (SOCIAL_ASSET_TOKEN.test(pathPart)) {
    factor *= 0.2;
    reasons.push('social/share/badge asset name');
  }

  return { reject: false, factor, reasons };
}

export interface PhotoSignalInput {
  url: string;
  width?: number;
  height?: number;
  /** Candidate kind — og/twitter share cards are photos far more often than marks. */
  kind?: string;
  /** alt / class / id text, already lowercased by the caller if convenient. */
  text?: string;
}

/**
 * Demote candidates whose shape screams "hero photograph".
 *
 * Signals (each independent, multiplied together):
 *   - a photo path token (hero/banner/stock/unsplash/…)          × 0.25
 *   - a JPEG/AVIF/HEIC extension                                  × 0.5
 *   - big AND photo-shaped: ≥600×≥340 with a 1.2–2.4 aspect       × 0.35
 *     (1200×630 og cards, 16:9 sliders, 3:2 stock shots). A wide
 *     WORDMARK is much thinner than 1.2:1… wordmarks run 3:1–8:1,
 *     so this window can't catch them.
 *   - an og:/twitter: share card that ALSO tripped a photo signal  × 0.6
 *
 * Never rejects. A tiny logo that happens to live at /images/hero/ still
 * shows up in the gallery — it just stops beating the real mark.
 */
export function photoSignalDemotion(
  input: PhotoSignalInput,
): LogoFilterVerdict {
  const reasons: string[] = [];
  let factor = 1;

  const url = input.url || '';
  let pathPart = url.toLowerCase();
  try {
    pathPart = new URL(url).pathname.toLowerCase();
  } catch {
    /* keep the raw string */
  }

  const text = (input.text || '').toLowerCase();

  if (
    (url && PHOTO_PATH_TOKEN.test(pathPart)) ||
    (text && PHOTO_TEXT_TOKEN.test(text))
  ) {
    factor *= 0.25;
    reasons.push('photographic path/alt token');
  }
  if (url && PHOTO_EXT.test(url)) {
    factor *= 0.5;
    reasons.push('photographic file extension');
  }

  const w = input.width || 0;
  const h = input.height || 0;
  if (w >= 600 && h >= 340) {
    const aspect = w / h;
    if (aspect >= 1.2 && aspect <= 2.4) {
      factor *= 0.35;
      reasons.push(`photo-shaped ${w}x${h} (aspect ${aspect.toFixed(2)})`);
    }
  }

  const isShareCard = input.kind === 'og' || input.kind === 'twitter';
  if (isShareCard && reasons.length > 0) {
    factor *= 0.6;
    reasons.push('share-card image with photo signals');
  }

  return { reject: false, factor, reasons };
}

/**
 * The combined gate used by the scraper's `pushLogo`. Returns the final
 * score (never below 1 so ordering stays stable and a demoted candidate is
 * still selectable) plus the reject flag + reasons.
 */
export function scoreLogoCandidate(
  candidate: {
    url: string;
    score: number;
    width?: number;
    height?: number;
    kind?: string;
    text?: string;
  },
  siteHost = '',
  opts: { brandKeys?: string[] } = {},
): { reject: boolean; score: number; reasons: string[] } {
  const urlVerdict = classifyLogoUrl(candidate.url, siteHost);
  if (urlVerdict.reject) {
    return { reject: true, score: 0, reasons: urlVerdict.reasons };
  }
  const photoVerdict = photoSignalDemotion({
    url: candidate.url,
    width: candidate.width,
    height: candidate.height,
    kind: candidate.kind,
    text: candidate.text,
  });
  const awardVerdict = awardBadgeDemotion(
    candidate.text || '',
    candidate.url,
    opts.brandKeys || [],
  );
  const factor = urlVerdict.factor * photoVerdict.factor * awardVerdict.factor;
  const reasons = [
    ...urlVerdict.reasons,
    ...photoVerdict.reasons,
    ...awardVerdict.reasons,
  ];
  return {
    reject: false,
    score: Math.max(1, +(candidate.score * factor).toFixed(2)),
    reasons,
  };
}

/**
 * Safety net for rule 3: never hand the wizard an EMPTY logo list. If the
 * host filter rejected everything, restore the best rejected candidate at a
 * heavily-demoted score so the operator still has something to pick (and
 * can see why it looks wrong) instead of "we couldn't pull a logo".
 */
export function ensureSurvivor<T extends { score: number }>(
  kept: T[],
  rejected: T[],
): T[] {
  if (kept.length > 0 || rejected.length === 0) return kept;
  const best = rejected.slice().sort((a, b) => b.score - a.score)[0];
  return [{ ...best, score: Math.max(1, Math.round(best.score * 0.1)) }];
}
