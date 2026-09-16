/**
 * pickBrandSegment — brand-name extraction from SEO <title> strings.
 *
 * Regression coverage for the recurring "can't brand Domino's" report
 * (2026-06-01): dominos.com has no og:site_name, so the scraper landed the
 * full SEO title "Pizza Delivery & Carryout, Pasta, Wings & More | Domino's"
 * as the display name. The brand is the short trailing segment.
 *
 * Plus VisionCore-incident hardening (2026-07-21): background-ish
 * near-white demotion in color ranking + font-family sanitization — the
 * scrape of a Wix site stored the page background (#fcf9e2 cream) as
 * palette.primary and junk like ")" / "var(--hover-font" as brand fonts.
 */
import {
  pickBrandSegment,
  sanitizeFontFamilyName,
  backgroundishColorDemotion,
  BrandingScraperService,
  RankedColor,
  RankedFont,
} from './branding-scraper.service';

describe('pickBrandSegment', () => {
  it('pulls the brand out of a "<SEO phrase> | Brand" title (Domino\'s)', () => {
    expect(
      pickBrandSegment("Pizza Delivery & Carryout, Pasta, Wings & More | Domino's"),
    ).toBe("Domino's");
  });

  it('keeps the team name and drops the domain segment', () => {
    expect(pickBrandSegment('Los Angeles Dodgers | MLB.com')).toBe('Los Angeles Dodgers');
  });

  it('prefers an exact og:site_name match among brand-like segments', () => {
    expect(pickBrandSegment('Order Online | Acme Pizza Co', 'Acme Pizza Co')).toBe('Acme Pizza Co');
  });

  it('leaves a single-segment name untouched', () => {
    expect(pickBrandSegment("Domino's")).toBe("Domino's");
    expect(pickBrandSegment('The Home Depot')).toBe('The Home Depot');
  });

  it('does not split a hyphenated brand name', () => {
    expect(pickBrandSegment('Coca-Cola')).toBe('Coca-Cola');
  });

  it('leaves it unchanged when NO segment is clearly brand-like (no bad guesses)', () => {
    const t = 'Big Long Marketing Phrase, With Commas | Another Long Descriptive Phrase Here Too';
    expect(pickBrandSegment(t)).toBe(t);
  });

  // Real titles observed in a 2026-06-01 sweep of live brand sites.
  it('splits on colon+space and takes the brand (McDonald\'s)', () => {
    expect(pickBrandSegment("McDonald's: Burgers, Fries & More. Quality Ingredients.")).toBe("McDonald's");
  });

  it('handles "Target : Expect More. Pay Less." → "Target"', () => {
    expect(pickBrandSegment('Target : Expect More. Pay Less.')).toBe('Target');
  });

  it('strips a bare-domain TLD (Nike.com → Nike)', () => {
    expect(pickBrandSegment('Nike.com')).toBe('Nike');
  });

  it('does NOT split a time-like "10:30 Diner" (no space after colon)', () => {
    expect(pickBrandSegment('10:30 Diner')).toBe('10:30 Diner');
  });

  it('handles null safely', () => {
    expect(pickBrandSegment(null)).toBeNull();
    expect(pickBrandSegment(undefined)).toBeNull();
  });
});

describe('sanitizeFontFamilyName (VisionCore junk-font hardening, 2026-07-21)', () => {
  it('rejects the literal junk that reached the VisionCore tenant_branding row', () => {
    expect(sanitizeFontFamilyName(')')).toBeNull();
    expect(sanitizeFontFamilyName('))')).toBeNull();
    expect(sanitizeFontFamilyName('var(--hover-font')).toBeNull();
  });

  it('rejects var() indirections wholesale (the first family IS the var)', () => {
    expect(sanitizeFontFamilyName('var(--font-main), "Roboto", sans-serif')).toBeNull();
    expect(sanitizeFontFamilyName('VAR(--x)')).toBeNull();
    expect(sanitizeFontFamilyName('var(--font-body, Arial)')).toBeNull();
  });

  it('takes the first family in a comma list and strips quotes', () => {
    expect(sanitizeFontFamilyName('"Playfair Display", Georgia, serif')).toBe('Playfair Display');
    expect(sanitizeFontFamilyName("'Inter'")).toBe('Inter');
    expect(sanitizeFontFamilyName('  Open Sans  ')).toBe('Open Sans');
    expect(sanitizeFontFamilyName('Lato, sans-serif')).toBe('Lato');
  });

  it('accepts real-world names with digits, spaces, ampersands, dots, hyphens', () => {
    expect(sanitizeFontFamilyName('Source Sans 3')).toBe('Source Sans 3');
    expect(sanitizeFontFamilyName('M PLUS 1p')).toBe('M PLUS 1p');
    expect(sanitizeFontFamilyName('IBM Plex Sans')).toBe('IBM Plex Sans');
  });

  it('rejects empties, leading punctuation, over-long names, and CSS junk', () => {
    expect(sanitizeFontFamilyName('')).toBeNull();
    expect(sanitizeFontFamilyName(null)).toBeNull();
    expect(sanitizeFontFamilyName(undefined)).toBeNull();
    expect(sanitizeFontFamilyName('-apple-system')).toBeNull(); // must start alphanumeric
    expect(sanitizeFontFamilyName('a'.repeat(41))).toBeNull();  // 40-char cap
    expect(sanitizeFontFamilyName('!important')).toBeNull();
    expect(sanitizeFontFamilyName('"\u200b"')).toBeNull(); // zero-width-space junk
  });
});

describe('backgroundishColorDemotion (VisionCore cream-as-primary hardening)', () => {
  it('leaves saturated mid-lightness colors untouched (factor 1) in any context', () => {
    expect(backgroundishColorDemotion('#7c1034', true)).toBe(1);
    expect(backgroundishColorDemotion('#7c1034', false)).toBe(1);
    expect(backgroundishColorDemotion('#4f46e5', true)).toBe(1);
    expect(backgroundishColorDemotion('#ffd700', true)).toBe(1); // gold lum ≈0.71 — below threshold
  });

  it('demotes the VisionCore cream hard in background context — but never to zero', () => {
    const f = backgroundishColorDemotion('#fcf9e2', true); // lum ≈0.94
    expect(f).toBeLessThanOrEqual(0.15);
    expect(f).toBeGreaterThan(0); // demoted, never hard-rejected
  });

  it('demotes near-white only mildly outside background context', () => {
    const bg = backgroundishColorDemotion('#fcf9e2', true);
    const fg = backgroundishColorDemotion('#fcf9e2', false);
    expect(fg).toBeGreaterThan(bg);
    expect(fg).toBeLessThan(1);
  });

  it('ramps: a barely-over-threshold pale gets a gentle nudge, not the floor', () => {
    // ~lum 0.82 pale pink — inside the ramp, far from the floor.
    const f = backgroundishColorDemotion('#ffe4ec', true);
    expect(f).toBeGreaterThan(0.5);
    expect(f).toBeLessThan(1);
  });
});

describe('extractFromCss — demotion + font sanitization through the real parser', () => {
  const runCss = (css: string) => {
    const svc = new BrandingScraperService();
    const colors = new Map<string, RankedColor>();
    const fonts = new Map<string, RankedFont>();
    (svc as any).extractFromCss(css, colors, fonts);
    return { colors, fonts };
  };

  it('a page-background cream no longer out-scores the saturated button color (the VisionCore failure)', () => {
    // Cream as the page canvas in MANY rules; the real brand color in a
    // handful of brand-ish spots. Pre-fix, the cream won on occurrences.
    const creamRules = Array.from({ length: 20 }, (_, i) => `.section-${i} { background-color: #fcf9e2; }`).join('\n');
    const css = `
      body { background: #fcf9e2; }
      ${creamRules}
      .btn-primary { background-color: #7c1034; color: #fdfdfd; }
      a:hover { color: #7c1034; }
    `;
    const { colors } = runCss(css);
    const ranked = [...colors.values()].sort((a, b) => b.score - a.score);
    expect(ranked[0].hex).toBe('#7c1034');
    // Demoted, NOT rejected — the cream stays available as a candidate.
    expect(colors.has('#fcf9e2')).toBe(true);
  });

  it('a legitimately pale brand still wins when no saturated candidate exists', () => {
    const { colors } = runCss('body { background: #fcf9e2; } .card { background: #fcf9e2; }');
    const ranked = [...colors.values()].sort((a, b) => b.score - a.score);
    expect(ranked[0].hex).toBe('#fcf9e2');
  });

  it('var()-mangled font declarations never become candidates; real fonts do', () => {
    const css = `
      h1 { font-family: var(--hover-font, sans-serif); }
      h2 { font: 700 24px/1.2 var(--font-x); }
      .title { font-family: "Playfair Display", Georgia, serif; }
      body { font-family: 'Lato', sans-serif; }
    `;
    const { fonts } = runCss(css);
    const families = [...fonts.values()].map((f) => f.family);
    expect(families).toContain('Playfair Display');
    expect(families).toContain('Lato');
    for (const f of families) {
      expect(f).not.toMatch(/[()]/);
      expect(f.toLowerCase()).not.toContain('var(');
    }
  });
});

// 2026-09-16 — Greg adopted https://www.nba.com/kings/ and got a slate-grey
// brand with "VideoJS" as the heading font. The scrape's own ranking showed
// why: primary #2b333f came from `.vjs-loading-spinner` (Video.js's loading
// spinner) and accent #73859f from a selector literally recorded as "0%" — a
// keyframe STEP that postcss walks into as if it were a rule.
describe('third-party widget CSS is not the brand (nba.com/kings, 2026-09-16)', () => {
  const runCss = (css: string) => {
    const svc = new BrandingScraperService();
    const colors = new Map<string, RankedColor>();
    const fonts = new Map<string, RankedFont>();
    (svc as any).extractFromCss(css, colors, fonts);
    return { colors, fonts };
  };

  it('a keyframe STEP never contributes a brand color', () => {
    const css = `
      @keyframes vjs-spinner-fade { 0% { background-color: #73859f; } 100% { background-color: #8192ab; } }
      .btn-primary { background-color: #7d298e; }
    `;
    const { colors } = runCss(css);
    expect(colors.has('#73859f')).toBe(false);
    expect(colors.has('#8192ab')).toBe(false);
    expect(colors.has('#7d298e')).toBe(true);
  });

  it('a video player stylesheet cannot out-mass the real brand color', () => {
    // The player ships MANY rules; the brand has a handful. Occurrences alone
    // used to decide it.
    const vjs = Array.from({ length: 20 }, (_, i) => `.vjs-control-${i} { background-color: #2b333f; }`).join('\n');
    const css = `
      ${vjs}
      .vjs-loading-spinner { background-color: #2b333f; }
      .btn-primary { background-color: #7d298e; }
      a:hover { color: #7d298e; }
    `;
    const { colors } = runCss(css);
    const ranked = [...colors.values()].sort((a, b) => b.score - a.score);
    expect(ranked[0].hex).toBe('#7d298e');
    // Demoted, not rejected — a site with nothing else must still get a color.
    expect(colors.has('#2b333f')).toBe(true);
  });

  it('a library FONT never becomes a candidate, but the real one does', () => {
    const css = `
      .vjs-button { font-family: VideoJS; }
      .video-js .vjs-icon { font-family: "VideoJS"; }
      h1 { font-family: "Playfair Display", Georgia, serif; }
    `;
    const { fonts } = runCss(css);
    const families = [...fonts.values()].map((f) => f.family.toLowerCase());
    expect(families).not.toContain('videojs');
    expect(families).toContain('playfair display');
  });
});

// 2026-08-25 — operator: "cap the tagline so it fits what looks good."
// A 150-char meta description clipped mid-phrase in the sidebar rail with the
// remainder on hover (invisible on a touch panel). The scrape now ships a
// tagline that fits.
describe('condenseTagline', () => {
  const { condenseTagline, TAGLINE_DISPLAY_MAX } = require('./branding-scraper.service');

  it('leaves a tagline that already fits completely alone', () => {
    const short = 'Every screen, every venue — one platform.';
    expect(condenseTagline(short)).toBe(short);
  });

  it('prefers the FIRST SENTENCE over a mid-phrase cut', () => {
    const raw =
      'Amplify your brand with stunning visuals. From banners and signs to marketing materials tailored to your needs.';
    expect(condenseTagline(raw)).toBe('Amplify your brand with stunning visuals.');
  });

  it('word-boundary trims when there is no usable sentence, never mid-word', () => {
    const raw =
      'Amplify your brand presence with stunning visuals and unparalleled quality across every single location you operate';
    const out = condenseTagline(raw)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(TAGLINE_DISPLAY_MAX + 1);
    // the character before the ellipsis must end a whole word
    const body = out.slice(0, -1);
    expect(raw.startsWith(body)).toBe(true);
    expect(raw[body.length] === ' ' || body.length === raw.length).toBe(true);
  });

  it('does not split on a decimal or an abbreviation', () => {
    const raw =
      'Trusted by 3.5 million fans across the U.S. every single season of the year and then some more text here';
    const out = condenseTagline(raw)!;
    expect(out).not.toBe('Trusted by 3.');
    expect(out).not.toBe('Trusted by 3.5 million fans across the U.');
  });

  it('never reduces a tagline to a stub sentence', () => {
    const raw = 'Since 1974. Serving every district in the county with signage that actually works for them.';
    expect(condenseTagline(raw)).not.toBe('Since 1974.');
  });

  it('collapses whitespace and handles empty input', () => {
    expect(condenseTagline('  Clean   copy  ')).toBe('Clean copy');
    expect(condenseTagline('')).toBeNull();
    expect(condenseTagline(null)).toBeNull();
  });

  it('drops trailing punctuation before the ellipsis', () => {
    const raw = 'Signage, wayfinding, menus, and emergency alerts for schools, venues, restaurants, and retail locations';
    const out = condenseTagline(raw)!;
    expect(out).not.toMatch(/[,;:]…$/);
  });
});
